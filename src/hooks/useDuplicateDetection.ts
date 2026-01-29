import { useState, useEffect, useCallback, useRef } from "react";
import { useMainContext } from "../MainContext";

interface DuplicateResult {
  postId: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  confidence: number;
  reason?: string;
}

interface DuplicateMap {
  [postId: string]: DuplicateResult;
}

const useDuplicateDetection = () => {
  const context: any = useMainContext();
  const [duplicateMap, setDuplicateMap] = useState<DuplicateMap>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analyzedPostIds = useRef<Set<string>>(new Set());
  const pendingBatch = useRef<any[]>([]);
  const batchTimeout = useRef<NodeJS.Timeout | null>(null);

  // Batch size for API calls
  const BATCH_SIZE = 100;
  const BATCH_DELAY = 1000; // Wait 1 second to collect posts before analyzing

  const analyzePostsInternal = useCallback(async (posts: any[]) => {
    if (posts.length === 0) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      // Filter out already analyzed posts
      const newPosts = posts.filter(
        (p) => !analyzedPostIds.current.has(p?.data?.id)
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

      // Prepare posts for the API
      const postsForApi = newPosts.map((p) => ({
        id: p?.data?.id,
        title: p?.data?.title,
        subreddit: p?.data?.subreddit,
        author: p?.data?.author,
        selftext: p?.data?.selftext?.substring(0, 300), // Limit text length
        url: p?.data?.url,
      }));

      // Call the API
      const response = await fetch("/api/detect-duplicates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Token would need to be obtained from the session or environment
          ...(context?.copilotToken ? { "x-github-token": context.copilotToken } : {}),
        },
        body: JSON.stringify({ posts: postsForApi }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to analyze posts");
      }

      const data = await response.json();
      const results: DuplicateResult[] = data.results;

      // Update the duplicate map
      setDuplicateMap((prev) => {
        const newMap = { ...prev };
        results.forEach((result) => {
          newMap[result.postId] = result;
        });
        return newMap;
      });
    } catch (err) {
      console.error("Duplicate detection error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsAnalyzing(false);
    }
  }, [context?.copilotToken]);

  // Batched analysis - collects posts and analyzes them in batches
  const analyzePosts = useCallback((posts: any[]) => {
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
  }, [analyzePostsInternal]);

  // Check if a post is a duplicate
  const isDuplicate = useCallback(
    (postId: string): DuplicateResult | null => {
      return duplicateMap[postId] || null;
    },
    [duplicateMap]
  );

  // Clear the cache
  const clearCache = useCallback(() => {
    setDuplicateMap({});
    analyzedPostIds.current.clear();
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

  return {
    analyzePosts,
    isDuplicate,
    isAnalyzing,
    error,
    duplicateMap,
    clearCache,
  };
};

export default useDuplicateDetection;
