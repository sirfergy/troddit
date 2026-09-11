/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useId, useRef, useState } from "react";
import { CgArrowsExpandDownRight, CgArrowsExpandUpLeft } from "react-icons/cg";
import { useMainContext } from "../MainContext";
import type { InlineMedia } from "../../lib/mediaLinks";
import { recordEmbedFailure } from "../diagnostics/runtime";

const ParseATag = ({
  href,
  media,
  children,
}: {
  href: string;
  media: InlineMedia;
  children: React.ReactNode;
}) => {
  const context = useMainContext();
  const autoExpandImages =
    typeof context === "object" &&
    context !== null &&
    "expandImages" in context &&
    context.expandImages === true;
  const [userExpanded, setUserExpanded] = useState<boolean>();
  const expanded =
    userExpanded ?? (media.kind === "image" && autoExpandImages);
  const [failed, setFailed] = useState(false);
  const [embedSrc, setEmbedSrc] = useState<string>();
  const [embedHeight, setEmbedHeight] = useState(500);
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewId = useId();
  const label = media.kind === "embed" ? media.provider : media.kind;
  const isImgurEmbed = media.kind === "embed" && media.provider === "Imgur";

  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [expanded, failed]);

  useEffect(() => {
    if (!expanded || !isImgurEmbed || failed) {
      setEmbedSrc(undefined);
      setEmbedHeight(500);
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe) return;
    const measure = () => {
      if (iframe.clientWidth === 0) {
        setEmbedSrc(undefined);
        return;
      }
      const src = new URL(media.src);
      src.searchParams.set("w", String(iframe.clientWidth));
      // Imgur's embed contract includes a referrer; omit the page path and query.
      src.searchParams.set("ref", window.location.origin);
      setEmbedSrc(src.toString());
    };
    measure();
    let resizeTimeout: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(measure, 150);
    });
    observer.observe(iframe);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        event.origin !== "https://imgur.com" ||
        typeof event.data !== "string"
      ) return;
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
      }
      if (typeof data !== "object" || data === null || !("message" in data)) return;
      if (data.message === "404_imgur_embed") {
        recordEmbedFailure();
        setFailed(true);
      } else if (
        data.message === "resize_imgur" &&
        "height" in data &&
        (typeof data.height === "number" || typeof data.height === "string")
      ) {
        const height = Number(data.height);
        if (Number.isFinite(height) && height > 0) {
          setEmbedHeight(Math.min(2000, Math.max(200, Math.ceil(height))));
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      observer.disconnect();
      window.clearTimeout(resizeTimeout);
      window.removeEventListener("message", onMessage);
    };
  }, [expanded, isImgurEmbed, failed, media.src]);

  return (
    <span onClick={(event) => event.stopPropagation()}>
      {children}
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setUserExpanded((value) => !(value ?? expanded));
        }}
        aria-expanded={expanded}
        aria-controls={previewId}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${label} preview`}
        className="inline-flex items-center h-6 px-1 mx-1.5 border rounded-md border-th-border hover:border-th-borderHighlight text-th-text"
      >
        {expanded ? (
          <CgArrowsExpandUpLeft className="flex-none w-4 h-4" />
        ) : (
          <CgArrowsExpandDownRight className="flex-none w-4 h-4" />
        )}
      </button>
      <span
        id={previewId}
        data-troddit-media-preview
        hidden={!expanded}
        className="not-prose"
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        {expanded && (
          <span className="block max-w-xl my-2">
            {failed ? (
              <span role="status" className="block text-sm text-th-red">
                This preview could not be loaded. You can still open the original link.
              </span>
            ) : media.kind === "image" ? (
              <img
                className="max-h-[60vh] max-w-full mx-auto py-0 my-0"
                src={media.src}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setFailed(true)}
              />
            ) : media.kind === "video" ? (
              <video
                ref={videoRef}
                className="block w-full max-h-[60vh]"
                src={media.src}
                controls
                playsInline
                preload="none"
                aria-label="Inline video preview"
                onError={() => setFailed(true)}
              />
            ) : (
              <iframe
                ref={iframeRef}
                className="block w-full border-0"
                style={{
                  aspectRatio: "4 / 3",
                  height: isImgurEmbed ? embedHeight : undefined,
                }}
                src={isImgurEmbed ? embedSrc : media.src}
                title={`${media.provider} preview`}
                loading="lazy"
                sandbox="allow-scripts allow-same-origin allow-popups"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                referrerPolicy="no-referrer"
              />
            )}
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-1 text-sm underline text-th-link"
            >
              Open original
            </a>
          </span>
        )}
      </span>
    </span>
  );
};

export default ParseATag;
