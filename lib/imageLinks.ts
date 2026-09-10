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
  `\\.(${supportedImageExtensions.join("|")})(?:[?#].*)?$`,
  "i"
);

export const hasSupportedImageExtension = (link?: string) => {
  return !!link?.split("#")?.[0]?.match(imageExtensionRegex);
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
