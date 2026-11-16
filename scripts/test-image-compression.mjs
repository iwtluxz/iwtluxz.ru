import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../image-compression.js", import.meta.url), "utf8");
const limit = 4 * 1024 * 1024;
function setup(sizes = [2 * 1024 * 1024]) {
  const calls = [];
  class Image {
    naturalWidth = 5000;
    naturalHeight = 2500;
    set src(value) { queueMicrotask(() => this.onload()); }
  }
  const canvas = {
    getContext() { return { drawImage() {} }; },
    toBlob(callback, type, quality) {
      calls.push({ type, quality, width: canvas.width, height: canvas.height });
      callback(new Blob([new Uint8Array(sizes[Math.min(calls.length - 1, sizes.length - 1)])], { type }));
    }
  };
  const window = {};
  const context = vm.createContext({ window, document: { createElement: () => canvas }, Image, File, Blob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, Uint8Array, DataView, Promise });
  vm.runInContext(source, context);
  return { compress: window.IwtxzImageCompression.compress, calls };
}

test("small images are unchanged, larger photographs are encoded below the upload limit", async () => {
  const { compress, calls } = setup([limit + 1, limit - 1]);
  const small = new File(["small"], "avatar.jpg", { type: "image/jpeg" });
  assert.equal(await compress(small, small.type), small);
  const large = new File([new Uint8Array(limit + 1)], "photo.jpg", { type: "image/jpeg" });
  const result = await compress(large, large.type);
  assert.ok(result.size <= limit);
  assert.equal(result.type, "image/jpeg");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].width, 4096);
});

test("large animated GIF, APNG and WebP are rejected instead of losing their animation", async () => {
  const { compress, calls } = setup();
  const apng = new Uint8Array(limit + 1);
  apng.set([0, 0, 0, 8, 97, 99, 84, 76], 8);
  const webp = new Uint8Array(limit + 1);
  webp.set([86, 80, 56, 88], 12); webp[20] = 2;
  for (const [bytes, name, type] of [
    [new Uint8Array(limit + 1), "animation.gif", "image/gif"],
    [apng, "animation.png", "image/png"],
    [webp, "animation.webp", "image/webp"]
  ]) await assert.rejects(compress(new File([bytes], name, { type }), type), /анимаци/i);
  assert.equal(calls.length, 0);
});

test("large still WebP retains an alpha-capable format", async () => {
  const { compress } = setup();
  const file = new File([new Uint8Array(limit + 1)], "background.webp", { type: "image/webp" });
  const result = await compress(file, file.type);
  assert.equal(result.type, "image/webp");
  assert.ok(result.size <= limit);
});
