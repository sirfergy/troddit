export const supportedImageExtensions = [
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jfif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
] as const;

const imageExtensionRegex = new RegExp(
  `\\.(${supportedImageExtensions.join("|")})$`,
  "i"
);

export const hasSupportedImageExtension = (link?: string) => {
  return !!link?.split(/[?#]/)?.[0]?.match(imageExtensionRegex);
};

export const getExpandableImageUrl = (link?: string): string | undefined => {
  if (!link || !/^https:\/\//i.test(link)) {
    return undefined;
  }

  const giphyId = link.match(
    /^https:\/\/(?:www\.)?giphy\.com\/gifs\/(?:[^/?#]+-)?([a-z\d]+)\/?(?:[?#].*)?$/i
  )?.[1];

  if (giphyId) {
    return `https://media.giphy.com/media/${giphyId}/giphy.gif`;
  }

  return hasSupportedImageExtension(link) ? link : undefined;
};

export const isExpandableImageLink = (link?: string) => {
  return !!getExpandableImageUrl(link);
};

export type InlineMedia =
  | { kind: "image"; src: string }
  | { kind: "video"; src: string }
  | { kind: "embed"; src: string; provider: "Tenor" | "Imgur" };

export const getInlineMedia = (link?: string): InlineMedia | undefined => {
  if (!link || !/^https:\/\//i.test(link)) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(link);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (url.username || url.password) return undefined;

  if (!url.port && ["tenor.com", "www.tenor.com"].includes(url.hostname)) {
    const id = url.pathname.match(
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:view\/(?:[^/?#]+-)?|embed\/)(\d+)\/?$/i
    )?.[1];
    if (id) {
      return { kind: "embed", provider: "Tenor", src: `https://tenor.com/embed/${id}` };
    }
  }

  if (!url.port && ["imgur.com", "www.imgur.com"].includes(url.hostname)) {
    const id = url.pathname.match(
      /^\/(?:a|gallery)\/(?:[^/?#]+-)?([a-z\d]{5,7})\/?$/i
    )?.[1];
    if (id) {
      return {
        kind: "embed",
        provider: "Imgur",
        src: `https://imgur.com/a/${id}/embed?pub=true&analytics=false`,
      };
    }
  }

  if (/\.(mp4|m4v|webm|ogv|mov)$/i.test(url.pathname)) {
    return { kind: "video", src: link };
  }

  const image = getExpandableImageUrl(link);
  return image ? { kind: "image", src: image } : undefined;
};
