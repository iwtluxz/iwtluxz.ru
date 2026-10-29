import { lstat, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validUsername = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const reservedNames = new Set([
  "index", "profile", "404", "api", "assets", "img", "sound", "font", "vendor",
  "data", "scripts", "supabase", "netlify", "dist", "node_modules",
  "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
]);
const generatedHeader = /^(?:\uFEFF)?<!doctype html>\r?\n<!-- iwtxz-generated-profile-route: ([a-z0-9][a-z0-9_-]{2,31}) -->\r?\n/i;

function generatedUsername(content) {
  return content.match(generatedHeader)?.[1] || null;
}

function routePath(root, username) {
  if (!validUsername.test(username)) throw new Error("Invalid published username; no routes were changed.");
  const target = resolve(root, `${username}.html`);
  if (dirname(target) !== root) throw new Error("Profile route must stay inside the project root.");
  return target;
}

async function publicConfig(root) {
  const context = { window: {} };
  vm.runInNewContext(await readFile(join(root, "backend-config.js"), "utf8"), context, { timeout: 1000 });
  const config = context.window.IWTXZ_BACKEND_CONFIG;
  if (config?.provider !== "supabase" || typeof config.url !== "string" || typeof config.publishableKey !== "string") {
    throw new Error("A public Supabase configuration is required to sync profile routes.");
  }
  const url = new URL(config.url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("The public Supabase URL must be an HTTPS origin.");
  }
  const key = config.publishableKey;
  let isPublic = key.startsWith("sb_publishable_");
  if (!isPublic && key.split(".").length === 3) {
    try { isPublic = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch { /* Not a public JWT. */ }
  }
  if (!isPublic) throw new Error("Profile route sync requires a publishable or anon key, never a secret key.");
  return { url: url.origin, key };
}

async function publishedUsernames(config, fetchImpl) {
  const usernames = new Set();
  const limit = 1000;
  let offset = 0;
  for (let page = 0; page < 10000; page += 1) {
    const url = new URL("/rest/v1/profile_published", config.url);
    url.search = new URLSearchParams({ select: "username", order: "username.asc", limit: String(limit), offset: String(offset) });
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { apikey: config.key, Accept: "application/json" },
        signal: AbortSignal.timeout(30000)
      });
    } catch {
      throw new Error("Could not fetch published profiles; no routes were changed.");
    }
    if (!response.ok) throw new Error(`Published profiles request failed (HTTP ${response.status}); no routes were changed.`);
    let rows;
    try { rows = await response.json(); } catch { throw new Error("Invalid profiles response; no routes were changed."); }
    if (!Array.isArray(rows) || rows.length > limit) throw new Error("Invalid profiles response; no routes were changed.");
    for (const row of rows) {
      if (!row || typeof row.username !== "string" || !validUsername.test(row.username) || usernames.has(row.username)) {
        throw new Error("Invalid or repeated published username; no routes were changed.");
      }
      usernames.add(row.username);
    }
    if (rows.length < limit) return usernames;
    offset += rows.length;
  }
  throw new Error("Published profile pagination did not finish; no routes were changed.");
}

function renderRoute(template, username) {
  const newline = template.includes("\r\n") ? "\r\n" : "\n";
  return template
    .replace(/^(\uFEFF?<!doctype html>)/i, `$1${newline}<!-- iwtxz-generated-profile-route: ${username} -->`)
    .replace(/(<head(?:\s[^>]*)?>)/i, `$1${newline}  <meta name="iwtxz-profile" content="${username}">`);
}

/** Build public HTML entry points, leaving every hand-written page untouched. */
export async function syncProfileRoutes({ root = projectRoot, fetch: fetchImpl = globalThis.fetch } = {}) {
  root = await realpath(resolve(root));
  const config = await publicConfig(root);
  const template = await readFile(join(root, "profile.html"), "utf8");
  if (!/^(?:\uFEFF)?<!doctype html>/i.test(template) || !/<head(?:\s[^>]*)?>/i.test(template) || generatedUsername(template)) {
    throw new Error("profile.html must be the shared profile HTML template.");
  }
  const blocked = new Set(reservedNames);
  const owned = new Map();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const extension = extname(entry.name);
    const stem = entry.name.slice(0, extension ? -extension.length : undefined).toLowerCase();
    if (entry.isFile() && extension.toLowerCase() === ".html" && validUsername.test(stem)) {
      const content = await readFile(join(root, entry.name), "utf8");
      if (entry.name === `${stem}.html` && generatedUsername(content) === stem) {
        owned.set(stem, content);
        continue;
      }
    }
    blocked.add(entry.name.toLowerCase());
    blocked.add(stem);
  }

  // Complete and validate every API page before writing or removing any file.
  const usernames = await publishedUsernames(config, fetchImpl);
  const result = { created: 0, updated: 0, removed: 0, skipped: 0 };
  for (const username of usernames) {
    if (blocked.has(username)) { result.skipped += 1; continue; }
    const target = routePath(root, username);
    const next = renderRoute(template, username);
    const previous = owned.get(username);
    if (previous === next) continue;
    if (previous !== undefined) {
      const info = await lstat(target);
      if (!info.isFile() || info.nlink !== 1 || generatedUsername(await readFile(target, "utf8")) !== username) {
        throw new Error("A generated route changed during sync; refusing to overwrite it.");
      }
    }
    await writeFile(target, next, { encoding: "utf8", flag: previous === undefined ? "wx" : "w" });
    result[previous === undefined ? "created" : "updated"] += 1;
  }
  for (const username of owned.keys()) {
    if (usernames.has(username)) continue;
    const target = routePath(root, username);
    const info = await lstat(target);
    if (!info.isFile() || info.nlink !== 1 || generatedUsername(await readFile(target, "utf8")) !== username) {
      throw new Error("A generated route changed during sync; refusing to remove it.");
    }
    await unlink(target);
    result.removed += 1;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await syncProfileRoutes();
    console.log(`Profile routes: ${result.created} created, ${result.updated} updated, ${result.removed} removed, ${result.skipped} preserved.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
