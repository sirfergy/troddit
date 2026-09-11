/* eslint-disable react/display-name */
import React, { useEffect, useState } from "react";
import ParseATag from "../components/ParseATag";
import { getInlineMedia } from "../../lib/mediaLinks";

import HtmlToReact from "html-to-react";

const HtmlToReactParser = HtmlToReact.Parser;
const htmlToReactParser = HtmlToReactParser();
const isValidNode = function () {
  return true;
};

interface BodyNode {
  name?: string;
  attribs?: { href?: string };
  children?: BodyNode[];
}

const containsEmbeddedMedia = (node: BodyNode): boolean =>
  ["img", "picture", "video", "audio", "iframe"].includes(node.name) ||
  !!node.children?.some(containsEmbeddedMedia);

// Order matters. Instructions are processed in the order they're defined
const processNodeDefinitions = HtmlToReact.ProcessNodeDefinitions();
const processingInstructions = [
  {
    shouldProcessNode: function (node) {
      return (
        node.name === "a" &&
        !!getInlineMedia(node.attribs?.href) &&
        !containsEmbeddedMedia(node)
      );
    },
    processNode: function (node, children, index) {
      const href = node.attribs.href;
      const media = getInlineMedia(href);
      const anchor = processNodeDefinitions.processDefaultNode(node, children, index);
      return media ? (
        <ParseATag key={`${index}:${href}`} href={href} media={media}>
          {anchor}
        </ParseATag>
      ) : anchor;
    },
  },
  {
    // Anything else
    shouldProcessNode: function (node) {
      return true;
    },
    processNode: processNodeDefinitions.processDefaultNode,
  },
];
const useParseBodyHTML = ({ rawHTML, newTabLinks = false }) => {
  const [component, setComponent] = useState<any>();

  useEffect(() => {
    const PROTOCOL = window.location.protocol;
    const DOMAIN = window?.location?.host ?? "troddit.com";

    const blankTargets = (str) => {
      if (str?.includes("<a ")) {
        str = str?.replaceAll("<a ", '<a target="_blank" rel="noreferrer" ');
      }

      return str;
    };

    const replaceDomains = (str) => {
      if (typeof str == "undefined" || !str) return;
      let splitstr = str.split("<a");
      let replaceall: string[] = [];
      splitstr.forEach((substr) => replaceall.push(replaceUserDomains(substr)));
      return replaceall.join("<a");
    };

    const replaceUserDomains = (str: string) => {
      let redditRegex = /([A-z.]+\.)?(reddit(\.com)|redd(\.it))/gm;
      let matchRegex1 = /([A-z.]+\.)?(reddit(\.com)|redd(\.it))+(\/[ru]\/)/gm;
      let matchRegex2 = /([A-z.]+\.)?(reddit(\.com)|redd(\.it))+(\/user\/)/gm;
      let matchRegex3 =
        /([A-z.]+\.)?(reddit(\.com)|redd(\.it))+(\/)+([A-z0-9]){6}("|\s)/gm;
      // let youtubeRegex = /([A-z.]+\.)?youtu(be\.com|\.be)/gm;
      // let twitterRegex = /([A-z.]+\.)?twitter\.com/gm;
      // let instagramRegex = /([A-z.]+\.)?instagram.com/gm;
      if (
        str.match(matchRegex1) ||
        str.match(matchRegex2) ||
        str.match(matchRegex3)
      ) {
        str = str.replace(redditRegex, DOMAIN); //.replace(/(https:\/\/|http:\/\/)/g,PROTOCOL);
        if (str.includes("https:") && PROTOCOL !== "https:") {
          str = str.replace("https:", PROTOCOL);
        }
      }

      return str;
    };

    const parseHTML = (html) => {
      const reactElement = htmlToReactParser.parseWithInstructions(
        html,
        isValidNode,
        processingInstructions
      );
      return reactElement;
    };

    //let unescaped = unescape(html); //no longer need this due to html-to-react
    let result = replaceDomains(rawHTML);
    if (newTabLinks) {
      result = blankTargets(result);
    }
    let reactElement = parseHTML(result);
    setComponent(reactElement);
  }, [rawHTML, newTabLinks]);

  return component;
};

export default useParseBodyHTML;
