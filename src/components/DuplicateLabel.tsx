import React from "react";
import { BiCopy, BiHistory, BiLoaderAlt } from "react-icons/bi";

interface DuplicateLabelProps {
  confidence?: number;
  reason?: string;
  duplicateOf?: string;
  duplicateSource?: "batch" | "reddit" | "history";
  isRepost?: boolean;
  originalPostAge?: string;
  isAnalyzing?: boolean;
  showTooltip?: boolean;
}

const DuplicateLabel: React.FC<DuplicateLabelProps> = ({
  confidence = 0,
  reason,
  duplicateOf,
  duplicateSource,
  isRepost,
  originalPostAge,
  isAnalyzing,
  showTooltip = true,
}) => {
  // Show analyzing spinner
  if (isAnalyzing) {
    return (
      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-th-textLight bg-th-highlight">
        <BiLoaderAlt className="w-3 h-3 animate-spin" />
      </div>
    );
  }
  
  // Only show label if confidence is high enough
  if (confidence < 70) return null;

  const bgColor = confidence >= 90 
    ? "bg-amber-600" 
    : confidence >= 80 
    ? "bg-amber-500" 
    : "bg-amber-400";

  const repostBgColor = confidence >= 90
    ? "bg-purple-600"
    : confidence >= 80
    ? "bg-purple-500"
    : "bg-purple-400";

  let tooltipText = "";
  if (reason) {
    tooltipText = reason;
    if (duplicateSource === "history") {
      tooltipText += ` (from your history)`;
    } else if (duplicateSource === "reddit") {
      tooltipText += ` (found on Reddit)`;
    }
    tooltipText += ` - ${confidence}% confidence`;
  } else {
    tooltipText = `Likely duplicate - ${confidence}% confidence`;
  }
  
  if (isRepost && originalPostAge) {
    tooltipText += ` | ${originalPostAge}`;
  }

  // Show repost label if it's a repost (prioritize repost over dupe)
  if (isRepost) {
    return (
      <div
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-white ${repostBgColor} cursor-help`}
        title={showTooltip ? tooltipText : undefined}
      >
        <BiHistory className="w-3 h-3" />
        <span>REPOST</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-white ${bgColor} cursor-help`}
      title={showTooltip ? tooltipText : undefined}
    >
      <BiCopy className="w-3 h-3" />
      <span>DUPE</span>
    </div>
  );
};

export default DuplicateLabel;
