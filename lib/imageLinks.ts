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

export const isExpandableImageLink = (link?: string) => {
  return !!link && /^https:\/\//i.test(link) && hasSupportedImageExtension(link);
};
