import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getExpandableImageUrl,
  hasSupportedImageExtension,
  isExpandableImageLink,
  supportedImageExtensions,
} from "../lib/mediaLinks.ts";

test("preserves direct HTTPS image URLs and their query strings and fragments", () => {
  for (const extension of supportedImageExtensions) {
    for (const suffix of ["", "?width=640&format=auto", "#image", "?raw=1#image"]) {
      const link = `https://images.example.com/photo.${extension}${suffix}`;
      assert.equal(getExpandableImageUrl(link), link);
      assert.equal(isExpandableImageLink(link), true);
      assert.equal(hasSupportedImageExtension(link), true);
    }
  }

  const uppercase = "HTTPS://images.example.com/photo.JPEG?raw=1#image";
  assert.equal(getExpandableImageUrl(uppercase), uppercase);

  const giphyMedia = "https://media1.giphy.com/media/y2i2oqWgzh5ioRp4Qa/giphy.gif";
  assert.equal(getExpandableImageUrl(giphyMedia), giphyMedia);
});

test("resolves Giphy GIF page links to the original GIF", () => {
  const id = "y2i2oqWgzh5ioRp4Qa";
  const expected = `https://media.giphy.com/media/${id}/giphy.gif`;

  for (const host of ["giphy.com", "www.giphy.com", "GIPHY.COM"]) {
    for (const slug of [id, `first-half-they-had-us-in-the-inthe-${id}`]) {
      for (const suffix of ["", "/", "?utm_source=share#gif", "/?utm_source=share"]) {
        const link = `https://${host}/gifs/${slug}${suffix}`;
        assert.equal(getExpandableImageUrl(link), expected, link);
        assert.equal(isExpandableImageLink(link), true, link);
        assert.equal(hasSupportedImageExtension(link), false, link);
      }
    }
  }

  assert.equal(getExpandableImageUrl(`HTTPS://giphy.com/gifs/${id}`), expected);
  assert.equal(
    getExpandableImageUrl(`https://giphy.com/gifs/${id}?filename=share.gif`),
    expected
  );
});

test("does not expand insecure, missing, or unsupported links", () => {
  for (const link of [
    undefined,
    "",
    "not a URL",
    "/photo.png",
    "//images.example.com/photo.png",
    "http://images.example.com/photo.jpg",
    "http://giphy.com/gifs/y2i2oqWgzh5ioRp4Qa",
    "javascript:alert('photo.png')",
    "https://example.com/article",
    "https://example.com/movie.mp4",
    "https://example.com/#photo.png",
    "https://giphy.com",
    "https://giphy.com/search/cats",
    "https://giphy.com/gifs/",
    "https://giphy.com/gifs/title-",
    "https://giphy.com/gifs/id/extra",
    "https://giphy.com/gifs/id%2Fextra",
    "https://giphy.com/clips/not-a-gif",
  ]) {
    assert.equal(getExpandableImageUrl(link), undefined, link);
    assert.equal(isExpandableImageLink(link), false, link);
  }
});

test("only resolves Giphy page links on the supported hostnames", () => {
  for (const link of [
    "https://example.com/gifs/y2i2oqWgzh5ioRp4Qa",
    "https://giphy.com.example.com/gifs/y2i2oqWgzh5ioRp4Qa",
    "https://notgiphy.com/gifs/y2i2oqWgzh5ioRp4Qa",
    "https://example.com/giphy.com/gifs/y2i2oqWgzh5ioRp4Qa",
    "https://giphy.com@example.com/gifs/y2i2oqWgzh5ioRp4Qa",
    "https://example.com/?url=https://giphy.com/gifs/y2i2oqWgzh5ioRp4Qa",
  ]) {
    assert.equal(getExpandableImageUrl(link), undefined, link);
    assert.equal(isExpandableImageLink(link), false, link);
  }
});
