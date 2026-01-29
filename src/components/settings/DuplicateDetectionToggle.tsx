import React from "react";
import Switch from "react-switch";
import { BiCopy, BiHistory } from "react-icons/bi";
import { usePostAnalysisSafe } from "../PostAnalysisContext";

const DuplicateDetectionToggle = () => {
  const postAnalysis = usePostAnalysisSafe();
  
  if (!postAnalysis) {
    return null;
  }

  const { isEnabled, setIsEnabled, isAnalyzing, viewedHistory } = postAnalysis;
  const analyzingCount = isAnalyzing.size;

  return (
    <div className="flex flex-col w-full p-2 my-2 rounded-lg group hover:bg-th-highlight">
      <label className="flex flex-row items-center justify-between w-full cursor-pointer">
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            AI Duplicate Detection
            {analyzingCount > 0 && (
              <span className="text-xs text-th-accent animate-pulse">
                (analyzing {analyzingCount}...)
              </span>
            )}
          </span>
          <span className="mr-2 text-xs opacity-70">
            Analyzes posts as you scroll to detect duplicates and reposts using AI.
          </span>
        </span>
        <div className="flex-none">
          <Switch
            onChange={() => setIsEnabled(!isEnabled)}
            checked={isEnabled}
            checkedIcon={
              <div className="flex items-center justify-center w-full h-full">
                <BiCopy className="w-4 h-4" />
              </div>
            }
            uncheckedIcon={
              <div className="flex items-center justify-center w-full h-full">
                <BiCopy className="w-4 h-4 opacity-50" />
              </div>
            }
            offColor="#4B5563"
            onColor="#10B981"
            height={24}
            width={48}
            handleDiameter={20}
          />
        </div>
      </label>
      
      {isEnabled && (
        <div className="flex flex-col gap-3 mt-3 pl-1">
          <div className="flex items-center gap-2 text-xs opacity-70">
            <BiHistory className="w-4 h-4" />
            <span>{viewedHistory.length} posts in history (1 week retention)</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default DuplicateDetectionToggle;
