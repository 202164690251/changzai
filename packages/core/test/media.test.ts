// 常在 · 媒体工具单测
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyMediaPath,
  classifyDataUrl,
  extensionOf,
  isAllowedMedia,
  isWithinMediaSizeLimit,
  mediaStoragePath,
  mimeForPath,
  sanitizeMediaFileName,
} from "../src/media/index.ts";
import { MEDIA } from "@changzai/shared";

test("extensionOf：常见路径与无扩展名", () => {
  assert.equal(extensionOf("C:\\media\\a.JPG"), "jpg");
  assert.equal(extensionOf("a/b/c. tar.gz"), "gz");
  assert.equal(extensionOf("no-ext"), "");
  assert.equal(extensionOf("x.png?raw=1"), "png");
});

test("classifyMediaPath：图片/语音/其他", () => {
  assert.equal(classifyMediaPath("a.png"), "image");
  assert.equal(classifyMediaPath("a.WEBP"), "image");
  assert.equal(classifyMediaPath("a.mp3"), "voice");
  assert.equal(classifyMediaPath("a.silk"), "voice");
  assert.equal(classifyMediaPath("a.pdf"), "file");
});

test("isAllowedMedia：按类型限制扩展名", () => {
  assert.equal(isAllowedMedia("image", "x.jpg"), true);
  assert.equal(isAllowedMedia("image", "x.mp3"), false);
  assert.equal(isAllowedMedia("voice", "x.wav"), true);
  assert.equal(isAllowedMedia("voice", "x.png"), false);
});

test("mimeForPath：常见类型", () => {
  assert.equal(mimeForPath("a.png"), "image/png");
  assert.equal(mimeForPath("a.m4a"), "audio/mp4");
  assert.equal(mimeForPath("a.unknown"), "application/octet-stream");
});

test("sanitizeMediaFileName：保留中英文，清理非法字符，限制长度", () => {
  assert.equal(sanitizeMediaFileName("小林 的截图(1).png"), "小林_的截图_1_.png");
  assert.equal(sanitizeMediaFileName("../../etc/passwd"), ".._.._etc_passwd");
  assert.equal(sanitizeMediaFileName(""), "media");
  assert.ok(sanitizeMediaFileName("a".repeat(200)).length <= 80);
});

test("mediaStoragePath：按 persona/mediaId 约定落盘", () => {
  assert.equal(mediaStoragePath("p_1", "m_123", ".JPG"), "media/p_1/m_123.jpg");
  assert.equal(mediaStoragePath("p 1", "m:2", ""), "media/p_1/m_2");
});

test("isWithinMediaSizeLimit：0 与超限不算合法", () => {
  assert.equal(isWithinMediaSizeLimit(0), false);
  assert.equal(isWithinMediaSizeLimit(1), true);
  assert.equal(isWithinMediaSizeLimit(MEDIA.maxBytesPerFile), true);
  assert.equal(isWithinMediaSizeLimit(MEDIA.maxBytesPerFile + 1), false);
});

test("classifyDataUrl：从 dataUrl 推断类型", () => {
  assert.equal(classifyDataUrl("data:image/png;base64,AAAA"), "image");
  assert.equal(classifyDataUrl("data:audio/mpeg;base64,AAAA"), "voice");
  assert.equal(classifyDataUrl("data:application/pdf;base64,AAAA"), "file");
});
