import type { NextApiRequest, NextApiResponse } from "next";
import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotSession } from "@github/copilot-sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Constants
const USER_AGENT = "troddit-duplicate-detector/1.0";
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;
const SEARCH_DELAY_MS = 500;
const MODEL = "claude-haiku-3.5";

interface Post {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  selftext?: string;
  url?: string;
  created_utc?: number;
  thumbnail?: string;
  preview?: {
    images?: Array<{
      source?: { url: string; width: number; height: number };
      resolutions?: Array<{ url: string; width: number; height: number }>;
    }>;
  };
  post_hint?: string;
}

interface PreviousPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
}

interface DuplicateResult {
  postId: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  confidence: number;
  reason?: string;
  isRepost?: boolean;
  originalPostAge?: string;
}

interface RedditSearchResult {
  postId: string;
  title: string;
  subreddit: string;
  author: string;
  created_utc: number;
  url?: string;
  permalink: string;
  score: number;
}

function createClient(token?: string): CopilotClient {
  const env = { ...process.env };
  if (token) {
    env.GITHUB_TOKEN = token;
    env.GH_TOKEN = token;
  }
  return new CopilotClient({ 
    autoStart: false,
    env,
  });
}

// Get the best image URL from a post
function getPostImageUrl(post: Post): string | null {
  // Check if this is an image post
  if (post.post_hint !== "image" && !post.url?.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
    // Also check preview images
    if (!post.preview?.images?.[0]?.source?.url) {
      return null;
    }
  }
  
  // Try to get the direct image URL
  if (post.url?.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
    return post.url;
  }
  
  // Get from preview (Reddit encodes URLs in preview)
  if (post.preview?.images?.[0]?.source?.url) {
    // Reddit HTML-encodes URLs in preview, decode them
    return post.preview.images[0].source.url.replace(/&amp;/g, "&");
  }
  
  // Use thumbnail as fallback (not ideal but better than nothing)
  if (post.thumbnail && post.thumbnail.startsWith("http") && !["default", "self", "nsfw", "spoiler"].includes(post.thumbnail)) {
    return post.thumbnail;
  }
  
  return null;
}

// Download an image and save to temp file
async function downloadImageToTemp(imageUrl: string, postId: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    
    if (!response.ok) return null;
    
    const contentType = response.headers.get("content-type");
    if (!contentType?.startsWith("image/")) return null;
    
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) return null;
    
    const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
    const tempFilePath = path.join(os.tmpdir(), `troddit-img-${postId}.${ext}`);
    
    fs.writeFileSync(tempFilePath, Buffer.from(buffer));
    return tempFilePath;
  } catch {
    return null;
  }
}

// Clean up temp image files
function cleanupTempImages(filePaths: string[]): void {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }
}

interface ImageDescription {
  postId: string;
  description: string;
  imageUrl: string;
}

// Get image descriptions from LLM
async function getImageDescriptions(
  posts: Post[],
  client: CopilotClient,
  cachedDescriptions: Record<string, string>
): Promise<{ descriptions: Map<string, ImageDescription>; newDescriptions: Record<string, string> }> {
  const descriptions = new Map<string, ImageDescription>();
  const newDescriptions: Record<string, string> = {};
  const tempFiles: string[] = [];
  
  try {
    // Find posts with images
    const imagePosts = posts
      .map(post => ({ post, imageUrl: getPostImageUrl(post) }))
      .filter((p): p is { post: Post; imageUrl: string } => p.imageUrl !== null);
    
    if (imagePosts.length === 0) return { descriptions, newDescriptions };
    
    // Separate cached and uncached posts
    const uncachedPosts: Array<{ post: Post; imageUrl: string }> = [];
    
    for (const imagePost of imagePosts) {
      if (cachedDescriptions[imagePost.post.id]) {
        descriptions.set(imagePost.post.id, {
          postId: imagePost.post.id,
          description: cachedDescriptions[imagePost.post.id],
          imageUrl: imagePost.imageUrl,
        });
      } else {
        uncachedPosts.push(imagePost);
      }
    }
    
    if (uncachedPosts.length === 0) return { descriptions, newDescriptions };
    
    console.log(`[DuplicateDetection] Analyzing ${uncachedPosts.length} images (${imagePosts.length - uncachedPosts.length} cached)`);
    
    // Download images in batches
    const downloadedImages: Array<{ post: Post; imageUrl: string; filePath: string }> = [];
    
    for (let i = 0; i < uncachedPosts.length; i += BATCH_SIZE) {
      const batch = uncachedPosts.slice(i, i + BATCH_SIZE);
      
      const downloadPromises = batch.map(async ({ post, imageUrl }) => {
        const filePath = await downloadImageToTemp(imageUrl, post.id);
        if (filePath) {
          tempFiles.push(filePath);
          return { post, imageUrl, filePath };
        }
        return null;
      });
      
      const batchResults = await Promise.all(downloadPromises);
      downloadedImages.push(...batchResults.filter((r): r is { post: Post; imageUrl: string; filePath: string } => r !== null));
      
      if (i + BATCH_SIZE < uncachedPosts.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    
    if (downloadedImages.length === 0) return { descriptions, newDescriptions };
    
    // Process images in parallel with up to 10 concurrent sessions
    const PARALLEL_LIMIT = 10;
    const sessions: CopilotSession[] = [];
    
    const analyzeImage = async (imageData: { post: Post; imageUrl: string; filePath: string }): Promise<void> => {
      const { post, imageUrl, filePath } = imageData;
      let session: CopilotSession | null = null;
      
      try {
        session = await client.createSession({
          model: MODEL,
          systemMessage: {
            mode: "append",
            content: `You are an image analyzer for duplicate detection. Describe images concisely, focusing on: main subject, notable text/logos, style (photo/meme/artwork), and recognizable elements. Keep under 100 words.`,
          },
        });
        sessions.push(session);
        
        const response = await session.sendAndWait({
          prompt: `Describe this image briefly for duplicate detection purposes. Focus on identifying details.`,
          attachments: [{ type: "file", path: filePath, displayName: `image-${post.id}` }],
        }, 30000);
        
        const description = response?.data?.content?.trim() || "";
        
        if (description) {
          descriptions.set(post.id, { postId: post.id, description, imageUrl });
          newDescriptions[post.id] = description;
        }
      } catch (error) {
        console.error(`[DuplicateDetection] Image analysis failed for ${post.id}:`, error);
      } finally {
        if (session) {
          try { await session.destroy(); } catch { /* ignore */ }
        }
      }
    };
    
    // Process in batches
    for (let i = 0; i < downloadedImages.length; i += PARALLEL_LIMIT) {
      const batch = downloadedImages.slice(i, i + PARALLEL_LIMIT);
      await Promise.all(batch.map(analyzeImage));
    }
    
  } finally {
    // Always cleanup temp files
    cleanupTempImages(tempFiles);
  }
  
  return { descriptions, newDescriptions };
}

// Search Reddit for similar posts
async function searchRedditForSimilar(post: Post, redditAccessToken?: string): Promise<RedditSearchResult[]> {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their']);
  
  const titleWords = post.title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 5);
  
  if (titleWords.length === 0) return [];
  
  const searchQuery = titleWords.join(' ');
  
  try {
    const isOAuth = !!redditAccessToken;
    const searchUrl = isOAuth
      ? `https://oauth.reddit.com/search?q=${encodeURIComponent(searchQuery)}&sort=relevance&t=all&limit=10&raw_json=1`
      : `https://www.reddit.com/search.json?q=${encodeURIComponent(searchQuery)}&sort=relevance&t=all&limit=10`;
    
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (isOAuth) headers['Authorization'] = `Bearer ${redditAccessToken}`;
    
    const response = await fetch(searchUrl, { headers });
    if (!response.ok) return [];
    
    const data = await response.json();
    return (data?.data?.children || [])
      .map((child: any) => child.data)
      .filter((p: any) => p.id !== post.id)
      .map((p: any) => ({
        postId: p.id,
        title: p.title,
        subreddit: p.subreddit,
        author: p.author,
        created_utc: p.created_utc,
        url: p.url,
        permalink: p.permalink,
        score: p.score,
      }));
  } catch {
    return [];
  }
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
  return `${Math.floor(diff / 31536000)} years ago`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ results: DuplicateResult[]; newImageDescriptions?: Record<string, string> } | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { posts, previousPosts, token, cachedImageDescriptions, redditAccessToken } = req.body as { 
    posts: Post[]; 
    previousPosts?: PreviousPost[];
    token?: string;
    cachedImageDescriptions?: Record<string, string>;
    redditAccessToken?: string;
  };

  if (!posts || !Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({ error: "Posts array is required" });
  }

  try {
    const { results, newImageDescriptions } = await detectDuplicates(
      posts, 
      previousPosts || [], 
      token, 
      cachedImageDescriptions || {}, 
      redditAccessToken
    );
    return res.status(200).json({ results, newImageDescriptions });
  } catch (error) {
    console.error("[DuplicateDetection] Error:", error);
    return res.status(500).json({ error: "Failed to detect duplicates" });
  }
}

async function detectDuplicates(
  posts: Post[], 
  previousPosts: PreviousPost[], 
  token?: string, 
  cachedImageDescriptions?: Record<string, string>, 
  redditAccessToken?: string
): Promise<{ results: DuplicateResult[]; newImageDescriptions: Record<string, string> }> {
  const client = createClient(token);
  let session: CopilotSession | null = null;
  let newImageDescriptions: Record<string, string> = {};
  
  const emptyResults = () => ({
    results: posts.map(p => ({ postId: p.id, isDuplicate: false, confidence: 0 })),
    newImageDescriptions,
  });
  
  try {
    await client.start();
    
    // Get image descriptions and historical searches in parallel
    const [imageDescResult, historicalSearches] = await Promise.all([
      getImageDescriptions(posts, client, cachedImageDescriptions || {}),
      searchAllPostsOnReddit(posts, redditAccessToken),
    ]);
    
    const imageDescriptions = imageDescResult.descriptions;
    newImageDescriptions = imageDescResult.newDescriptions;
    
    // Combine current posts with previous posts for analysis
    const allPosts = [...posts, ...previousPosts.map(p => ({ ...p, selftext: undefined, url: undefined }))];    
    const newPostIds = new Set(posts.map(p => p.id));
    
    // Build prompt
    const postSummaries = allPosts.map((p, idx) => {
      let summary = `[${idx}] ID: ${p.id} | r/${p.subreddit} | "${p.title}" | u/${p.author}`;
      if ((p as Post).selftext) {
        summary += ` | Text: "${(p as Post).selftext!.substring(0, 300)}..."`;
      }
      const imgDesc = imageDescriptions.get(p.id);
      if (imgDesc) {
        summary += ` | IMAGE: "${imgDesc.description}"`;
      }
      return summary;
    }).join("\n");

    const historicalContext = buildHistoricalContext(posts, historicalSearches);
    const prompt = buildDuplicateDetectionPrompt(postSummaries, historicalContext);

    // Create session and get response
    session = await client.createSession({
      model: MODEL,
      systemMessage: {
        mode: "append",
        content: `You are a Reddit duplicate post detector. Analyze posts and identify duplicates and reposts. Always respond with ONLY a JSON array.`,
      },
    });

    const response = await session.sendAndWait({ prompt }, 120000);
    const responseContent = response?.data?.content || "";

    // Parse JSON response
    const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[DuplicateDetection] No JSON found in response");
      return emptyResults();
    }

    const allResults: DuplicateResult[] = JSON.parse(jsonMatch[0]);
    const results = allResults.filter(r => newPostIds.has(r.postId));
    return { results, newImageDescriptions };
    
  } catch (error) {
    console.error("[DuplicateDetection] Error:", error);
    return emptyResults();
  } finally {
    if (session) {
      try { await session.destroy(); } catch { /* ignore */ }
    }
    try { await client.stop(); } catch { /* ignore */ }
  }
}

// Search Reddit for all posts in batches
async function searchAllPostsOnReddit(posts: Post[], redditAccessToken?: string): Promise<Map<string, RedditSearchResult[]>> {
  const searches = new Map<string, RedditSearchResult[]>();
  
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (post) => ({
        postId: post.id,
        results: await searchRedditForSimilar(post, redditAccessToken),
      }))
    );
    
    for (const { postId, results: searchResults } of results) {
      if (searchResults.length > 0) searches.set(postId, searchResults);
    }
    
    if (i + BATCH_SIZE < posts.length) {
      await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY_MS));
    }
  }
  return searches;
}

// Build historical context string from search results
function buildHistoricalContext(posts: Post[], historicalSearches: Map<string, RedditSearchResult[]>): string {
  if (historicalSearches.size === 0) return "";
  
  let context = "\n\n=== HISTORICAL REDDIT SEARCH RESULTS ===\n";
  context += "Similar posts found on Reddit:\n\n";
  
  for (const [postId, searchResults] of historicalSearches) {
    const originalPost = posts.find(p => p.id === postId);
    context += `For "${originalPost?.title}" (ID: ${postId}):\n`;
    for (const result of searchResults.slice(0, 3)) {
      context += `  - "${result.title}" in r/${result.subreddit} (${formatTimeAgo(result.created_utc)}, ${result.score} pts)\n`;
    }
    context += "\n";
  }
  return context;
}

function buildDuplicateDetectionPrompt(postSummaries: string, historicalContext: string): string {
  return `Analyze these posts for duplicates AND reposts.

DUPLICATE DETECTION RULES:
Two posts are considered duplicates if ANY of the following are true:
1. They cover the SAME NEWS EVENT or STORY - even if worded completely differently
2. They contain the SAME QUOTE, even with different framing or editorialization
3. They have similar titles with minor variations, typos, rephrasing, or different details about the same thing
4. They link to the same content, URL, or different articles about the same story
5. They are clearly about the same topic, person, event, or subject matter (even across different subreddits)
6. They appear to be karma farming (same content posted by different users or same user)
7. **IMAGE DUPLICATES**: They contain the same or very similar images based on the IMAGE CONTENT descriptions

IMAGE-BASED DUPLICATE DETECTION:
Some posts include an "IMAGE CONTENT:" field with a description of the image. Use this to detect:
- Same image posted with different titles (common karma farming tactic)
- Same meme with slight variations (different caption, same template)
- Screenshots of the same content
- Photos of the same subject/scene from similar angles
- Identical or near-identical artwork, photos, or graphics

If two posts have IMAGE CONTENT descriptions that describe the same or very similar images, mark them as duplicates even if the titles are completely different.

EXAMPLES OF DUPLICATES (mark the second one as duplicate of the first):
- "Minnesota Rep Ilhan Omar attacked at town hall meeting!" and "Minnesota Rep. Ilhan Omar rushed and sprayed with unknown substance at town hall" → DUPLICATES (same event)
- "Trump: 'With that being said, you can't have guns...'" and "Trump Against 2nd Amendment: 'With that being said, you can't have guns...'" → DUPLICATES (same quote, one just adds editorial framing)
- "Breaking: Major earthquake hits Japan" and "7.2 magnitude earthquake strikes Tokyo region" → DUPLICATES (same event)
- Post with IMAGE: "cat sitting in a cardboard box" and another with IMAGE: "orange tabby cat inside a box" → Likely DUPLICATES (same image)
- Post with IMAGE: "drake meme template - top panel saying no, bottom panel saying yes" appearing twice → DUPLICATES

BE LIBERAL in marking duplicates - if two posts are about the same underlying event, quote, news story, person, topic, OR IMAGE, they are duplicates even if:
- One has editorial commentary added (e.g., "Trump Against 2nd Amendment:" prefix)
- They use different words to describe the same thing
- They focus on different aspects of the same story
- They come from different subreddits
- The titles are completely different but the images are the same

The goal is to reduce redundant content in the feed.

REPOST DETECTION RULES:
A post is considered a REPOST if:

1. FROM HISTORICAL SEARCH: The search results below show very similar/identical titles posted previously, especially if they had high scores

2. FROM YOUR TRAINING KNOWLEDGE: You recognize the post as a classic/viral Reddit post you've seen before in your training data. This includes:
   - Famous Reddit posts that get reposted frequently (e.g., "Today you, tomorrow me", popular AMAs, viral TIFU stories)
   - Classic memes, images, or videos that circulate on Reddit periodically
   - Well-known karma farming content (popular reposts, recycled top posts)
   - Viral news stories or content that gets posted across many subreddits
   - "TIL" facts that get posted repeatedly
   - Popular shower thoughts, jokes, or observations that are commonly reposted
   - Classic Reddit stories or copypastas
   - FAMOUS IMAGES: If the IMAGE CONTENT description matches a famous/viral image you recognize (popular memes, iconic photos, etc.)

If you recognize a post from your training as something you've seen many times on Reddit, mark it as a repost even if it's not in the historical search results. Use your knowledge!

=== POSTS TO ANALYZE ===
${postSummaries}
${historicalContext}

Respond with ONLY a JSON array. For each post, provide:
{
  "postId": "the post ID",
  "isDuplicate": true/false (duplicate of another post in the list),
  "duplicateOf": "ID of the original post if duplicate, null otherwise",
  "confidence": 0-100,
  "reason": "brief explanation",
  "isRepost": true/false (if this appears to be a repost of older content),
  "originalPostAge": "estimated age if you recognize it, e.g. 'classic repost', '~2 years old', 'frequently reposted'" (only if isRepost is true)
}

Mark BOTH batch duplicates AND historical reposts. A post can be both a duplicate AND a repost.
Do NOT mark the first occurrence in the batch as a duplicate - only subsequent posts.
Be aggressive about identifying reposts you recognize from your training - Reddit has a lot of recycled content!`;
}
