import type { NextApiRequest, NextApiResponse } from "next";
import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotSession } from "@github/copilot-sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Constants
const USER_AGENT = "troddit-duplicate-detector/1.0";
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MODEL = "claude-4.5-haiku";

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
    }>;
  };
  post_hint?: string;
}

interface ViewedPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  imageDescription?: string;
  viewedAt: number;
}

interface AnalysisResult {
  postId: string;
  imageDescription?: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  duplicateSource?: "batch" | "reddit" | "history";
  confidence: number;
  reason?: string;
  isRepost?: boolean;
}

interface RedditSearchResult {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  created_utc: number;
  score: number;
  permalink: string;
}

function createClient(): CopilotClient {
  const port = process.env.COPILOT_CLI_PORT || 4321;
  return new CopilotClient({ 
    autoStart: false, 
    cliUrl: `http://localhost:${port}`,
    env: {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    },
  });
}

// Get the best image URL from a post
function getPostImageUrl(post: Post): string | null {
  if (post.post_hint !== "image" && !post.url?.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
    if (!post.preview?.images?.[0]?.source?.url) {
      return null;
    }
  }
  
  if (post.url?.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
    return post.url;
  }
  
  if (post.preview?.images?.[0]?.source?.url) {
    return post.preview.images[0].source.url.replace(/&amp;/g, "&");
  }
  
  if (post.thumbnail && post.thumbnail.startsWith("http") && !["default", "self", "nsfw", "spoiler"].includes(post.thumbnail)) {
    return post.thumbnail;
  }
  
  return null;
}

// Download image to temp file
async function downloadImageToTemp(imageUrl: string, postId: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    
    if (!response.ok) return null;
    
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_IMAGE_SIZE_BYTES) return null;
    
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) return null;
    
    const ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || "jpg";
    const tempPath = path.join(os.tmpdir(), `troddit-${postId}.${ext}`);
    fs.writeFileSync(tempPath, Buffer.from(buffer));
    
    return tempPath;
  } catch {
    return null;
  }
}

// Get image description from LLM
async function getImageDescription(
  post: Post,
  client: CopilotClient,
  cachedDescription?: string
): Promise<string | undefined> {
  if (cachedDescription) return cachedDescription;
  
  const imageUrl = getPostImageUrl(post);
  if (!imageUrl) return undefined;
  
  const tempPath = await downloadImageToTemp(imageUrl, post.id);
  if (!tempPath) return undefined;
  
  let session: CopilotSession | null = null;
  
  try {
    session = await client.createSession({
      model: MODEL,
      systemMessage: {
        mode: "append",
        content: "Describe images concisely for duplicate detection. Focus on: main subject, text/logos, style, recognizable elements. Keep under 50 words.",
      },
    });
    
    const response = await session.sendAndWait({
      prompt: "Describe this image briefly for duplicate detection.",
      attachments: [{ type: "file", path: tempPath, displayName: `image-${post.id}` }],
    }, 30000);
    
    return response?.data?.content?.trim();
  } catch {
    return undefined;
  } finally {
    if (session) {
      try { await session.destroy(); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
  }
}

// Have LLM generate a search query
async function generateSearchQuery(
  post: Post,
  imageDescription: string | undefined,
  client: CopilotClient
): Promise<string> {
  let session: CopilotSession | null = null;
  
  try {
    session = await client.createSession({
      model: MODEL,
      systemMessage: {
        mode: "append",
        content: "Generate Reddit search queries. Output ONLY the search terms, nothing else.",
      },
    });
    
    let prompt = `Generate a short Reddit search query (3-5 words) to find duplicates of this post:
Title: "${post.title}"
Subreddit: r/${post.subreddit}`;
    
    if (imageDescription) {
      prompt += `\nImage: ${imageDescription}`;
    }
    if (post.selftext) {
      prompt += `\nText preview: ${post.selftext.substring(0, 200)}`;
    }
    
    prompt += "\n\nOutput ONLY the search terms, no explanation.";
    
    const response = await session.sendAndWait({ prompt }, 15000);
    const query = response?.data?.content?.trim() || "";
    
    if (!query || query.length > 100) {
      return extractKeywords(post.title);
    }
    
    return query;
  } catch {
    return extractKeywords(post.title);
  } finally {
    if (session) {
      try { await session.destroy(); } catch { /* ignore */ }
    }
  }
}

// Fallback keyword extraction
function extractKeywords(title: string): string {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'and', 'but', 'or', 'this', 'that', 'i', 'me', 'my', 'you', 'your', 'he', 'she', 'it', 'we', 'they']);
  
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 5)
    .join(' ');
}

// Search Reddit for similar posts
async function searchReddit(
  query: string,
  excludeId: string,
  redditAccessToken?: string
): Promise<RedditSearchResult[]> {
  if (!query) return [];
  
  try {
    const isOAuth = !!redditAccessToken;
    const searchUrl = isOAuth
      ? `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=relevance&t=all&limit=10&raw_json=1`
      : `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=all&limit=10`;
    
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (isOAuth) headers['Authorization'] = `Bearer ${redditAccessToken}`;
    
    const response = await fetch(searchUrl, { headers });
    if (!response.ok) return [];
    
    const data = await response.json();
    return (data?.data?.children || [])
      .map((child: any) => child.data)
      .filter((p: any) => p.id !== excludeId)
      .slice(0, 5)
      .map((p: any) => ({
        id: p.id,
        title: p.title,
        subreddit: p.subreddit,
        author: p.author,
        created_utc: p.created_utc,
        score: p.score,
        permalink: p.permalink,
      }));
  } catch {
    return [];
  }
}

// Compare post against history and search results
async function analyzeForDuplicates(
  post: Post,
  imageDescription: string | undefined,
  redditResults: RedditSearchResult[],
  viewedHistory: ViewedPost[],
  client: CopilotClient
): Promise<{ isDuplicate: boolean; duplicateOf?: string; duplicateSource?: "reddit" | "history"; confidence: number; reason?: string; isRepost?: boolean }> {
  let session: CopilotSession | null = null;
  
  try {
    session = await client.createSession({
      model: MODEL,
      systemMessage: {
        mode: "append",
        content: "You are a duplicate post detector. Respond with ONLY valid JSON.",
      },
    });
    
    let prompt = `Analyze if this Reddit post is a duplicate or repost.

CURRENT POST:
- Title: "${post.title}"
- Subreddit: r/${post.subreddit}
- Author: u/${post.author}`;
    
    if (imageDescription) {
      prompt += `\n- Image: ${imageDescription}`;
    }
    if (post.selftext) {
      prompt += `\n- Text: ${post.selftext.substring(0, 200)}`;
    }
    
    if (redditResults.length > 0) {
      prompt += "\n\nSIMILAR POSTS FROM REDDIT SEARCH:";
      for (const r of redditResults) {
        const age = formatTimeAgo(r.created_utc);
        prompt += `\n- "${r.title}" in r/${r.subreddit} (${age}, ${r.score} pts)`;
      }
    }
    
    if (viewedHistory.length > 0) {
      prompt += "\n\nRECENTLY VIEWED POSTS (from user's history):";
      for (const h of viewedHistory.slice(0, 20)) {
        prompt += `\n- [${h.id}] "${h.title}" in r/${h.subreddit}`;
        if (h.imageDescription) {
          prompt += ` (Image: ${h.imageDescription})`;
        }
      }
    }
    
    prompt += `

Is this post a DUPLICATE of something in the viewed history, or a REPOST of something from the Reddit search?
A duplicate means essentially the same content (same news, same quote, same image).

Respond with ONLY this JSON:
{
  "isDuplicate": true/false,
  "duplicateOf": "post ID from history if duplicate, null otherwise",
  "duplicateSource": "history" or "reddit" or null,
  "confidence": 0-100,
  "reason": "brief explanation",
  "isRepost": true/false (if it matches something from Reddit search)
}`;
    
    const response = await session.sendAndWait({ prompt }, 30000);
    const content = response?.data?.content || "";
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { isDuplicate: false, confidence: 0 };
  } catch {
    return { isDuplicate: false, confidence: 0 };
  } finally {
    if (session) {
      try { await session.destroy(); } catch { /* ignore */ }
    }
  }
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalysisResult | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { post, viewedHistory, cachedImageDescription, redditAccessToken } = req.body as {
    post: Post;
    viewedHistory?: ViewedPost[];
    cachedImageDescription?: string;
    redditAccessToken?: string;
  };

  if (!post || !post.id) {
    return res.status(400).json({ error: "Post is required" });
  }

  const client = createClient();
  
  try {
    await client.start();
    
    const imageDescription = await getImageDescription(post, client, cachedImageDescription);
    const searchQuery = await generateSearchQuery(post, imageDescription, client);
    const redditResults = await searchReddit(searchQuery, post.id, redditAccessToken);
    
    // Filter out the current post from viewed history to avoid self-matching
    const filteredHistory = (viewedHistory || []).filter(h => h.id !== post.id);
    
    const analysis = await analyzeForDuplicates(
      post,
      imageDescription,
      redditResults,
      filteredHistory,
      client
    );
    
    const result: AnalysisResult = {
      postId: post.id,
      imageDescription,
      isDuplicate: analysis.isDuplicate,
      duplicateOf: analysis.duplicateOf,
      duplicateSource: analysis.duplicateSource,
      confidence: analysis.confidence,
      reason: analysis.reason,
      isRepost: analysis.isRepost,
    };
    
    return res.status(200).json(result);
  } catch (error) {
    console.error("[AnalyzePost] Error:", error);
    return res.status(500).json({ error: "Failed to analyze post" });
  } finally {
    try { await client.stop(); } catch { /* ignore */ }
  }
}
