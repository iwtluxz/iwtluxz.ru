import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shared = ["backend-config.js", "backend-client.js", "builder.js", "builder.css", "profile.js", "profile-settings.js", "profile-links.js", "profile-fallback.js"];
const profileMedia = ["img/mainavatar.gif", "img/mysoundicon.png", "sound/sound.mp3"];
const hashes = new Map();
for (const asset of [...shared, ...profileMedia]) {
  hashes.set(asset, createHash("sha256").update(await readFile(join(root, asset))).digest("hex").slice(0, 12));
}
let changed = 0;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const path = join(root, entry.name);
  const previous = await readFile(path, "utf8");
  let content = previous;
  const assets = entry.name === "iwtlu.html" ? [...shared, ...profileMedia] : shared;
  for (const asset of assets) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reference = new RegExp(`(["'])${escaped}(?:\\?v=[a-zA-Z0-9_-]+)?\\1`, "g");
    content = content.replace(reference, (_match, quote) => `${quote}${asset}?v=${hashes.get(asset)}${quote}`);
  }
  if (content !== previous) { await writeFile(path, content, "utf8"); changed += 1; }
}
console.log(`Asset versions: ${changed} HTML files updated.`);
