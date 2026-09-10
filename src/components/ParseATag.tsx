/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useState } from "react";
import { CgArrowsExpandDownRight, CgArrowsExpandUpLeft } from "react-icons/cg";
import { useMainContext } from "../MainContext";
import { getExpandableImageUrl } from "../../lib/imageLinks";

const ParseATag = (props) => {
  const context: any = useMainContext();
  const [imageUrl, setImageUrl] = useState<string>();
  const [expand, setExpand] = useState(context.expandImages);
  const [linkText, setLinkText] = useState(props?.children?.data);
  useEffect(() => {
    //todo: preserve text formatting
    const findLinkText = (data, iter = 0) => {
      if (iter > 5) {
        return;
      }
      if (data?.data) {
        setLinkText(data?.data);
        return;
      } else if (data?.children?.[0]) {
        findLinkText(data?.children[0], iter + 1);
      }
      return;
    };

    const link = props?.children?.parent?.attribs?.href;
    findLinkText(props?.children);
    //prevent recurring nodes from all having expansion buttons
    if (props?.children?.next?.parent?.attribs?.href !== link) {
      setImageUrl(getExpandableImageUrl(link));
    }
  }, []);

  const handleClick = async (e) => {
    if (imageUrl) {
      e.preventDefault();
      e.stopPropagation();
      setExpand((e) => !e);
    }
  };
  if (!imageUrl) {
    return <>{linkText}</>;
  }

  return (
    <>
      <>
        {linkText}
        <button
          onClick={handleClick}
          aria-label="expand"
          className={
            "flex-row items-center h-6 px-1 space-x-1 border rounded-md border-th-border hover:border-th-borderHighlight  text-th-text inline-block mx-1.5"
          }
        >
          {expand ? (
            <CgArrowsExpandUpLeft className="flex-none w-4 h-4" />
          ) : (
            <CgArrowsExpandDownRight className="flex-none w-4 h-4" />
          )}
        </button>
      </>
      {expand && (
        <div
          className="flex flex-col"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <img className="max-h-[60vh] mx-auto py-0 my-0" src={imageUrl} alt="" />
        </div>
      )}
    </>
  );
};

export default ParseATag;
