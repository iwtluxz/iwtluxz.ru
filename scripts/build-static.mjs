import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
if (dirname(output) !== root || output === root) throw new Error("Invalid build directory");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && (/\.(?:html|css|js)$/.test(entry.name) || entry.name === "_redirects"))
  .map((entry) => entry.name);
for (const name of [...files, "img", "font", "sound", "data/discord-profiles"]) {
  await cp(join(root, name), join(output, name), { recursive: true });
}
console.log(`Static site built: ${files.length} pages and scripts, plus public assets. Private data excluded.`);
