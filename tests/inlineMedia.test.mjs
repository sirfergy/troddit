import assert from "node:assert/strict";
import { test } from "node:test";
import { getInlineMedia, hasSupportedImageExtension } from "../lib/mediaLinks.ts";

test("keeps image previews and Giphy resolution", () => {
  const image = "https://images.example.com/photo.JPG?width=640#image";
  assert.deepEqual(getInlineMedia(image), { kind: "image", src: image });
  assert.deepEqual(getInlineMedia("https://giphy.com/gifs/y2i2oqWgzh5ioRp4Qa"), {
    kind: "image",
    src: "https://media.giphy.com/media/y2i2oqWgzh5ioRp4Qa/giphy.gif",
  });
});

test("recognizes direct videos by pathname and preserves signed URLs", () => {
  for (const extension of ["mp4", "m4v", "webm", "ogv", "mov", "MP4"]) {
    const link = `https://media.example.com/video.${extension}?token=keep-me&filename=poster.png#t=3`;
    assert.deepEqual(getInlineMedia(link), { kind: "video", src: link });
  }
});

test("resolves Tenor IDs without losing integer precision or retaining tracking data", () => {
  for (const link of [
    "https://tenor.com/view/seriously-side-eye-confused-gif-8776030",
    "https://www.tenor.com/view/8776030/?utm_source=share#gif",
    "https://tenor.com/it/view/seriously-gif-8776030",
    "https://tenor.com/en-GB/view/seriously-gif-8776030",
    "https://tenor.com/embed/8776030",
  ]) {
    assert.deepEqual(getInlineMedia(link), {
      kind: "embed", provider: "Tenor", src: "https://tenor.com/embed/8776030",
    });
  }
  const id = "1174838705394808298";
  assert.deepEqual(getInlineMedia(`https://tenor.com/view/good-morning-gif-${id}`), {
    kind: "embed", provider: "Tenor", src: `https://tenor.com/embed/${id}`,
  });
});

test("resolves Imgur albums and gallery permalinks to the provider's embed", () => {
  for (const link of [
    "https://imgur.com/a/Qpje3Dk",
    "https://www.imgur.com/a/example-album-Qpje3Dk/?utm_source=share",
    "https://imgur.com/gallery/Qpje3Dk#image",
    "https://imgur.com/gallery/example-album-Qpje3Dk",
  ]) {
    assert.deepEqual(getInlineMedia(link), {
      kind: "embed",
      provider: "Imgur",
      src: "https://imgur.com/a/Qpje3Dk/embed?pub=true&analytics=false",
    });
  }
});

test("does not turn unsupported or lookalike URLs into media embeds", () => {
  for (const link of [
    undefined, "", "https://", "/video.mp4", "//example.com/video.mp4",
    "http://example.com/video.mp4", "javascript:alert('video.mp4')",
    "https://user:password@example.com/video.mp4",
    "https://tenor.com@example.com/view/gif-8776030",
    "https://tenor.com.example.com/view/gif-8776030",
    "https://nottenor.com/view/gif-8776030",
    "https://tenor.com/search/cat-gifs", "https://tenor.com/view/no-id",
    "https://tenor.com/view/gif-8776030/extra",
    "https://tenor.com:8443/view/gif-8776030",
    "https://imgur.com.example.com/a/Qpje3Dk",
    "https://imgur.com/about", "https://imgur.com/a/",
    "https://imgur.com/a/Qpje3Dk/extra",
    "https://example.com/article?file=video.mp4",
    "https://example.com/article?file=photo.jpg",
    "https://example.com/article#photo.jpg",
  ]) {
    assert.equal(getInlineMedia(link), undefined, link);
  }
  assert.equal(hasSupportedImageExtension("https://example.com/article?file=photo.jpg"), false);
});
