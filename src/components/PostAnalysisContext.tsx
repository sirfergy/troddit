import React, { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";
import { useMainContext } from "../MainContext";

// Types
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

interface PostAnalysisContextType {
  // Settings
  isEnabled: boolean;
  setIsEnabled: (enabled: boolean) => void;
  copilotToken: string;
  setCopilotToken: (token: string) => void;
  
  // Analysis state
  analysisResults: Map<string, AnalysisResult>;
  isAnalyzing: Set<string>;
  
  // Actions
  analyzePost: (post: any) => void;
  getResult: (postId: string) => AnalysisResult | undefined;
  isPostAnalyzing: (postId: string) => boolean;
  
  // History
  viewedHistory: ViewedPost[];
}

const PostAnalysisContext = createContext<PostAnalysisContextType | null>(null);

// localStorage keys
const STORAGE_KEYS = {
  ENABLED: "troddit_post_analysis_enabled",
  TOKEN: "troddit_copilot_token",
  HISTORY: "troddit_viewed_history",
  IMAGE_CACHE: "troddit_image_descriptions",
};

// Constants
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const HISTORY_MAX_ITEMS = 500;
const ANALYSIS_DEBOUNCE_MS = 500;

export function PostAnalysisProvider({ children }: { children: React.ReactNode }) {
  const { token: redditToken } = useMainContext();
  
  // Settings state
  const [isEnabled, setIsEnabledState] = useState(false);
  const [copilotToken, setCopilotTokenState] = useState("");
  
  // Analysis state
  const [analysisResults, setAnalysisResults] = useState<Map<string, AnalysisResult>>(new Map());
  const [isAnalyzing, setIsAnalyzing] = useState<Set<string>>(new Set());
  
  // History state
  const [viewedHistory, setViewedHistory] = useState<ViewedPost[]>([]);
  const imageDescriptionCache = useRef<Record<string, string>>({});
  
  // Queue for pending analyses
  const analysisQueue = useRef<Set<string>>(new Set());
  const processingRef = useRef(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const savedEnabled = localStorage.getItem(STORAGE_KEYS.ENABLED);
    if (savedEnabled === "true") setIsEnabledState(true);
    
    const savedToken = localStorage.getItem(STORAGE_KEYS.TOKEN);
    if (savedToken) setCopilotTokenState(savedToken);
    
    // Load and clean history
    const savedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (savedHistory) {
      try {
        const parsed: ViewedPost[] = JSON.parse(savedHistory);
        const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
        const cleaned = parsed.filter(p => p.viewedAt > cutoff);
        setViewedHistory(cleaned);
        
        // If we cleaned old entries, save back
        if (cleaned.length < parsed.length) {
          localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(cleaned));
        }
      } catch {
        setViewedHistory([]);
      }
    }
    
    // Load image cache
    const savedCache = localStorage.getItem(STORAGE_KEYS.IMAGE_CACHE);
    if (savedCache) {
      try {
        imageDescriptionCache.current = JSON.parse(savedCache);
      } catch {
        imageDescriptionCache.current = {};
      }
    }
  }, []);

  // Persist settings
  const setIsEnabled = useCallback((enabled: boolean) => {
    setIsEnabledState(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.ENABLED, String(enabled));
    }
  }, []);

  const setCopilotToken = useCallback((token: string) => {
    setCopilotTokenState(token);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    }
  }, []);

  // Add post to viewed history
  const addToHistory = useCallback((post: any, imageDescription?: string) => {
    setViewedHistory(prev => {
      // Check if already in history
      if (prev.some(p => p.id === post.id)) {
        return prev;
      }
      
      const newEntry: ViewedPost = {
        id: post.id,
        title: post.data?.title || post.title,
        subreddit: post.data?.subreddit || post.subreddit,
        author: post.data?.author || post.author,
        imageDescription,
        viewedAt: Date.now(),
      };
      
      const updated = [newEntry, ...prev].slice(0, HISTORY_MAX_ITEMS);
      
      // Persist to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(updated));
      }
      
      return updated;
    });
  }, []);

  // Save image description to cache
  const cacheImageDescription = useCallback((postId: string, description: string) => {
    imageDescriptionCache.current[postId] = description;
    
    // Keep cache size reasonable
    const keys = Object.keys(imageDescriptionCache.current);
    if (keys.length > 1000) {
      const toRemove = keys.slice(0, keys.length - 1000);
      for (const key of toRemove) {
        delete imageDescriptionCache.current[key];
      }
    }
    
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.IMAGE_CACHE, JSON.stringify(imageDescriptionCache.current));
    }
  }, []);

  // Process the analysis queue
  const processQueue = useCallback(async () => {
    if (processingRef.current || analysisQueue.current.size === 0) return;
    processingRef.current = true;
    
    const postId = analysisQueue.current.values().next().value;
    if (!postId) {
      processingRef.current = false;
      return;
    }
    
    analysisQueue.current.delete(postId);
    
    // Get the post data from somewhere - we'll need to pass it through
    // For now, skip if we don't have the data
    processingRef.current = false;
    
    // Continue processing queue
    if (analysisQueue.current.size > 0) {
      setTimeout(processQueue, ANALYSIS_DEBOUNCE_MS);
    }
  }, []);

  // Analyze a single post
  const analyzePost = useCallback(async (post: any) => {
    if (!isEnabled || !copilotToken) return;
    
    const postId = post.data?.id || post.id;
    if (!postId) return;
    
    // Skip if already analyzed or analyzing
    if (analysisResults.has(postId) || isAnalyzing.has(postId)) return;
    
    // Mark as analyzing
    setIsAnalyzing(prev => new Set(prev).add(postId));
    
    try {
      const postData = post.data || post;
      
      const response = await fetch("/api/analyze-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post: {
            id: postData.id,
            title: postData.title,
            subreddit: postData.subreddit,
            author: postData.author,
            selftext: postData.selftext,
            url: postData.url,
            thumbnail: postData.thumbnail,
            preview: postData.preview,
            post_hint: postData.post_hint,
            created_utc: postData.created_utc,
          },
          viewedHistory,
          token: copilotToken,
          cachedImageDescription: imageDescriptionCache.current[postId],
          redditAccessToken: redditToken,
        }),
      });
      
      if (response.ok) {
        const result: AnalysisResult = await response.json();
        
        // Store result
        setAnalysisResults(prev => new Map(prev).set(postId, result));
        
        // Cache image description if we got one
        if (result.imageDescription) {
          cacheImageDescription(postId, result.imageDescription);
        }
        
        // Add to history
        addToHistory(postData, result.imageDescription);
      }
    } catch (error) {
      console.error("[PostAnalysis] Error analyzing post:", postId, error);
    } finally {
      setIsAnalyzing(prev => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    }
  }, [isEnabled, copilotToken, analysisResults, isAnalyzing, viewedHistory, redditToken, cacheImageDescription, addToHistory]);

  // Get result for a post
  const getResult = useCallback((postId: string) => {
    return analysisResults.get(postId);
  }, [analysisResults]);

  // Check if a post is currently being analyzed
  const isPostAnalyzing = useCallback((postId: string) => {
    return isAnalyzing.has(postId);
  }, [isAnalyzing]);

  const value: PostAnalysisContextType = {
    isEnabled,
    setIsEnabled,
    copilotToken,
    setCopilotToken,
    analysisResults,
    isAnalyzing,
    analyzePost,
    getResult,
    isPostAnalyzing,
    viewedHistory,
  };

  return (
    <PostAnalysisContext.Provider value={value}>
      {children}
    </PostAnalysisContext.Provider>
  );
}

export function usePostAnalysis() {
  const context = useContext(PostAnalysisContext);
  if (!context) {
    throw new Error("usePostAnalysis must be used within a PostAnalysisProvider");
  }
  return context;
}

// Safe version that returns null if not in provider
export function usePostAnalysisSafe() {
  return useContext(PostAnalysisContext);
}

// Hook for analyzing a post when it comes into view
export function usePostVisibilityAnalysis(post: any) {
  const { analyzePost, getResult, isPostAnalyzing, isEnabled } = usePostAnalysis();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const hasTriggered = useRef(false);
  
  const postId = post?.data?.id || post?.id;
  const result = postId ? getResult(postId) : undefined;
  const analyzing = postId ? isPostAnalyzing(postId) : false;
  
  // Set up intersection observer
  const setRef = useCallback((element: HTMLElement | null) => {
    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    
    elementRef.current = element;
    
    if (!element || !isEnabled || !post || hasTriggered.current) return;
    
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !hasTriggered.current) {
          hasTriggered.current = true;
          analyzePost(post);
          observerRef.current?.disconnect();
        }
      },
      {
        rootMargin: "1500px", // Start analyzing ~5 posts before visible
        threshold: 0.1,
      }
    );
    
    observerRef.current.observe(element);
  }, [isEnabled, post, analyzePost]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);
  
  return {
    ref: setRef,
    result,
    isAnalyzing: analyzing,
    isDuplicate: result?.isDuplicate || false,
    isRepost: result?.isRepost || false,
  };
}
