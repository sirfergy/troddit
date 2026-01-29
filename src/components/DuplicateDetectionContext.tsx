import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useMainContext } from "../MainContext";

interface DuplicateResult {
  postId: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  confidence: number;
  reason?: string;
  isRepost?: boolean;
  originalPostAge?: string;
}

interface DuplicateMap {
  [postId: string]: DuplicateResult;
}

interface DuplicateDetectionContextType {
  duplicateMap: DuplicateMap;
  isAnalyzing: boolean;
  error: string | null;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  token: string;
  setToken: (token: string) => void;
  analyzePosts: (posts: any[]) => void;
  getDuplicateInfo: (postId: string) => DuplicateResult | null;
  clearCache: () => void;
}

const DuplicateDetectionContext = createContext<DuplicateDetectionContextType | null>(null);

export const useDuplicateDetection = () => {
  const context = useContext(DuplicateDetectionContext);
  if (!context) {
    throw new Error("useDuplicateDetection must be used within DuplicateDetectionProvider");
  }
  return context;
};

// Safe hook that doesn't throw if context is missing
export const useDuplicateDetectionSafe = () => {
  return useContext(DuplicateDetectionContext);
};

interface DuplicateDetectionProviderProps {
  children: React.ReactNode;
}

export const DuplicateDetectionProvider: React.FC<DuplicateDetectionProviderProps> = ({ children }) => {
  const [duplicateMap, setDuplicateMap] = useState<DuplicateMap>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  
  // Get Reddit token from MainContext for authenticated API calls
  const mainContext = useMainContext();
  const redditToken = mainContext?.token;
  
  const analyzedPostIds = useRef<Set<string>>(new Set());
  const previousPosts = useRef<Array<{id: string; title: string; subreddit: string; author: string;}>>([]);
  const pendingBatch = useRef<any[]>([]);
  const batchTimeout = useRef<NodeJS.Timeout | null>(null);
  const imageDescriptionCache = useRef<Record<string, string>>({});

  // Batch settings
  const BATCH_SIZE = 100;
  const BATCH_DELAY = 2000;
  const MAX_PREVIOUS_POSTS = 100; // Keep last 100 posts for cross-batch duplicate detection

  // Load enabled state and token from localStorage
  useEffect(() => {
    const storedEnabled = localStorage.getItem("troddit_duplicateDetection");
    if (storedEnabled !== null) {
      setEnabled(JSON.parse(storedEnabled));
    }
    const storedToken = localStorage.getItem("troddit_copilotToken");
    if (storedToken) {
      setToken(storedToken);
    }
    // Load cached image descriptions
    const storedImageCache = localStorage.getItem("troddit_imageDescriptionCache");
    if (storedImageCache) {
      try {
        imageDescriptionCache.current = JSON.parse(storedImageCache);
        console.log(`[DuplicateDetection] Loaded ${Object.keys(imageDescriptionCache.current).length} cached image descriptions`);
      } catch (e) {
        console.error("[DuplicateDetection] Failed to parse image cache:", e);
      }
    }
  }, []);

  // Save enabled state to localStorage
  useEffect(() => {
    localStorage.setItem("troddit_duplicateDetection", JSON.stringify(enabled));
  }, [enabled]);

  // Save token to localStorage
  useEffect(() => {
    if (token) {
      localStorage.setItem("troddit_copilotToken", token);
    } else {
      localStorage.removeItem("troddit_copilotToken");
    }
  }, [token]);

  const analyzePostsInternal = useCallback(async (posts: any[]) => {
    console.log("[DuplicateDetection] analyzePostsInternal called, posts:", posts.length, "enabled:", enabled);
    if (posts.length === 0 || !enabled) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      // Filter out already analyzed posts
      const newPosts = posts.filter(
        (p) => p?.data?.id && !analyzedPostIds.current.has(p.data.id)
      );

      if (newPosts.length === 0) {
        setIsAnalyzing(false);
        return;
      }

      // Mark posts as being analyzed
      newPosts.forEach((p) => {
        if (p?.data?.id) {
          analyzedPostIds.current.add(p.data.id);
        }
      });

      // Prepare posts for the API (include image-related fields)
      const postsForApi = newPosts.map((p) => ({
        id: p?.data?.id,
        title: p?.data?.title,
        subreddit: p?.data?.subreddit,
        author: p?.data?.author,
        selftext: p?.data?.selftext?.substring(0, 300),
        url: p?.data?.url,
        thumbnail: p?.data?.thumbnail,
        preview: p?.data?.preview,
        post_hint: p?.data?.post_hint,
      }));

      // Get cached image descriptions for posts that have them
      const cachedImageDescriptions: Record<string, string> = {};
      const cacheKeys = Object.keys(imageDescriptionCache.current);
      console.log(`[DuplicateDetection] Cache has ${cacheKeys.length} entries, checking ${postsForApi.length} posts`);
      for (const post of postsForApi) {
        if (post.id && imageDescriptionCache.current[post.id]) {
          cachedImageDescriptions[post.id] = imageDescriptionCache.current[post.id];
          console.log(`[DuplicateDetection] Found cached description for post ${post.id}`);
        }
      }
      console.log(`[DuplicateDetection] Sending ${Object.keys(cachedImageDescriptions).length} cached image descriptions`);

      // Call the API with current and previous posts
      const response = await fetch("/api/detect-duplicates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          posts: postsForApi, 
          previousPosts: previousPosts.current,
          token,
          cachedImageDescriptions,
          redditAccessToken: redditToken?.accessToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to analyze posts");
      }

      const data = await response.json();
      const results: DuplicateResult[] = data.results;
      const newImageDescriptions: Record<string, string> = data.newImageDescriptions || {};

      console.log("[DuplicateDetection] Results received:", results);
      console.log("[DuplicateDetection] Duplicates found:", results.filter(r => r.isDuplicate || r.isRepost));
      console.log("[DuplicateDetection] New image descriptions received:", Object.keys(newImageDescriptions).length);

      // Cache new image descriptions
      if (Object.keys(newImageDescriptions).length > 0) {
        imageDescriptionCache.current = { ...imageDescriptionCache.current, ...newImageDescriptions };
        // Limit cache size to last 1000 entries
        const cacheKeys = Object.keys(imageDescriptionCache.current);
        if (cacheKeys.length > 1000) {
          const keysToRemove = cacheKeys.slice(0, cacheKeys.length - 1000);
          for (const key of keysToRemove) {
            delete imageDescriptionCache.current[key];
          }
        }
        localStorage.setItem("troddit_imageDescriptionCache", JSON.stringify(imageDescriptionCache.current));
        console.log(`[DuplicateDetection] Image cache now has ${Object.keys(imageDescriptionCache.current).length} entries`);
      }

      // Add current posts to previousPosts for future batches
      const newPreviousPosts = postsForApi.map(p => ({
        id: p.id,
        title: p.title,
        subreddit: p.subreddit,
        author: p.author,
      }));
      previousPosts.current = [...newPreviousPosts, ...previousPosts.current].slice(0, MAX_PREVIOUS_POSTS);

      // Update the duplicate map - also mark the "original" posts as duplicates
      setDuplicateMap((prev) => {
        const newMap = { ...prev };
        
        // First pass: add all results
        results.forEach((result) => {
          newMap[result.postId] = result;
        });
        
        // Second pass: mark original posts as duplicates too
        results.forEach((result) => {
          if (result.isDuplicate && result.duplicateOf) {
            const originalId = result.duplicateOf;
            // If the original post exists in the map but isn't marked as duplicate, mark it
            if (newMap[originalId] && !newMap[originalId].isDuplicate) {
              newMap[originalId] = {
                ...newMap[originalId],
                isDuplicate: true,
                duplicateOf: result.postId, // Point back to this duplicate
                reason: newMap[originalId].reason || `Has duplicate: ${result.postId}`,
                confidence: Math.max(newMap[originalId].confidence || 0, result.confidence),
              };
            } else if (!newMap[originalId]) {
              // Original might be in previous posts, create entry for it
              newMap[originalId] = {
                postId: originalId,
                isDuplicate: true,
                duplicateOf: result.postId,
                confidence: result.confidence,
                reason: `Has duplicate: ${result.postId}`,
              };
            }
          }
        });
        
        return newMap;
      });
    } catch (err) {
      console.error("Duplicate detection error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      // Don't block the UI on errors - just log and continue
    } finally {
      setIsAnalyzing(false);
    }
  }, [enabled, token]);

  const analyzePosts = useCallback((posts: any[]) => {
    console.log("[DuplicateDetection] analyzePosts called, posts:", posts.length, "enabled:", enabled, "token:", token ? "set" : "not set");
    if (!enabled) return;
    
    // Add posts to pending batch
    pendingBatch.current = [...pendingBatch.current, ...posts];

    // Clear existing timeout
    if (batchTimeout.current) {
      clearTimeout(batchTimeout.current);
    }

    // If we have enough posts, analyze immediately
    if (pendingBatch.current.length >= BATCH_SIZE) {
      const batch = pendingBatch.current.slice(0, BATCH_SIZE);
      pendingBatch.current = pendingBatch.current.slice(BATCH_SIZE);
      analyzePostsInternal(batch);
    } else {
      // Otherwise, wait for more posts or timeout
      batchTimeout.current = setTimeout(() => {
        if (pendingBatch.current.length > 0) {
          const batch = [...pendingBatch.current];
          pendingBatch.current = [];
          analyzePostsInternal(batch);
        }
      }, BATCH_DELAY);
    }
  }, [enabled, analyzePostsInternal]);

  const getDuplicateInfo = useCallback(
    (postId: string): DuplicateResult | null => {
      return duplicateMap[postId] || null;
    },
    [duplicateMap]
  );

  const clearCache = useCallback(() => {
    setDuplicateMap({});
    analyzedPostIds.current.clear();
    previousPosts.current = [];
    pendingBatch.current = [];
    if (batchTimeout.current) {
      clearTimeout(batchTimeout.current);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimeout.current) {
        clearTimeout(batchTimeout.current);
      }
    };
  }, []);

  const value: DuplicateDetectionContextType = {
    duplicateMap,
    isAnalyzing,
    error,
    enabled,
    setEnabled,
    token,
    setToken,
    analyzePosts,
    getDuplicateInfo,
    clearCache,
  };

  return (
    <DuplicateDetectionContext.Provider value={value}>
      {children}
    </DuplicateDetectionContext.Provider>
  );
};
