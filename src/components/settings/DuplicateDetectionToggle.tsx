import React, { useState } from "react";
import Switch from "react-switch";
import { BiCopy, BiKey, BiShow, BiHide } from "react-icons/bi";
import { useDuplicateDetectionSafe } from "../DuplicateDetectionContext";

const DuplicateDetectionToggle = () => {
  const duplicateDetection = useDuplicateDetectionSafe();
  const [showToken, setShowToken] = useState(false);
  
  if (!duplicateDetection) {
    return null;
  }

  const { enabled, setEnabled, isAnalyzing, token, setToken } = duplicateDetection;

  return (
    <div className="flex flex-col w-full p-2 my-2 rounded-lg group hover:bg-th-highlight">
      <label className="flex flex-row items-center justify-between w-full cursor-pointer">
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            AI Duplicate Detection
            {isAnalyzing && (
              <span className="text-xs text-th-accent animate-pulse">
                (analyzing...)
              </span>
            )}
          </span>
          <span className="mr-2 text-xs opacity-70">
            Uses AI to detect duplicate or similar posts in your feed and labels them with a "DUPE" tag.
          </span>
        </span>
        <div className="flex-none">
          <Switch
            onChange={() => setEnabled(!enabled)}
            checked={enabled}
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
      
      {enabled && (
        <div className="flex flex-col gap-3 mt-3 pl-1">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <BiKey className="w-4 h-4" />
              GitHub Token
            </label>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter your GitHub token..."
                className="w-full px-3 py-2 pr-10 text-sm border rounded-md bg-th-background border-th-border focus:outline-none focus:ring-2 focus:ring-th-accent"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-th-textLight hover:text-th-text"
              >
                {showToken ? <BiHide className="w-4 h-4" /> : <BiShow className="w-4 h-4" />}
              </button>
            </div>
            <span className="text-xs opacity-60">
              GitHub token with Copilot access for AI duplicate detection.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default DuplicateDetectionToggle;
