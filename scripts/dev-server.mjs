import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxRequestBytes = 4 * 1024 * 1024;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"
};

function json(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let length = 0;
    let exceeded = false;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > maxRequestBytes) exceeded = true;
      if (!exceeded) chunks.push(chunk);
    });
    request.on("end", () => exceeded
      ? reject(Object.assign(new Error("Файл слишком большой: максимум 4 МБ."), { status: 413 }))
      : resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function routeApi(pathname) {
  const auth = pathname.match(/^\/api\/builder\/auth\/([a-z-]+)$/);
  if (auth) return ["builder-auth.mjs", { mode: auth[1] }];
  const sites = pathname.match(/^\/api\/builder\/sites\/([a-z-]+)$/);
  if (sites) return ["builder-sites.mjs", { mode: sites[1] }];
  if (pathname === "/api/builder/publish") return ["builder-publish.mjs", {}];
  const profile = pathname.match(/^\/api\/builder\/profile\/([a-zA-Z0-9_-]+)$/);
  if (profile) return ["builder-profile.mjs", { username: profile[1] }];
  if (pathname === "/api/builder/assets/upload") return ["builder-assets.mjs", { mode: "upload" }];
  const asset = pathname.match(/^\/api\/builder\/assets\/file\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (asset) return ["builder-assets.mjs", { mode: "file", owner: asset[1], id: asset[2] }];
  return null;
}

function publicFile(pathname) {
  if (pathname === "/") return "index.html";
  if (/^\/u\/[a-zA-Z0-9_-]+\/?$/.test(pathname)) return "profile.html";
  if (/^\/(iwtlu|shakzy|strelokk)\/?$/.test(pathname)) return `${pathname.split("/")[1]}.html`;
  if (/^\/[a-zA-Z0-9_-]+\.(html|css|js)$/.test(pathname)) return pathname.slice(1);
  if (/^\/vendor\/[a-zA-Z0-9_.-]+\.(js|txt)$/.test(pathname)) return pathname.slice(1);
  if (/^\/data\/discord-profiles\/\d+\.json$/.test(pathname)) return pathname.slice(1);
  if (/^\/(img|sound|font)\/[a-zA-Z0-9_./-]+$/.test(pathname)
      && types[extname(pathname).toLowerCase()] && !pathname.split("/").includes("..")) return pathname.slice(1);
  return null;
}

async function serveFile(request, response, root, pathname) {
  const relativeFile = publicFile(pathname);
  if (!relativeFile) return json(response, 404, { error: "not found" });
  const absoluteFile = resolve(root, relativeFile);
  if (!absoluteFile.startsWith(`${root}${sep}`)) return json(response, 404, { error: "not found" });
  let info;
  try { info = await stat(absoluteFile); } catch { return json(response, 404, { error: "not found" }); }
  if (!info.isFile()) return json(response, 404, { error: "not found" });
  const headers = {
    "content-type": types[extname(absoluteFile).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-store", "x-content-type-options": "nosniff", "accept-ranges": "bytes"
  };
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const range = request.headers.range;
  if (range && info.size > 0) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parsed || (!parsed[1] && !parsed[2])) {
      response.writeHead(416, { ...headers, "content-range": `bytes */${info.size}` });
      return response.end();
    }
    start = parsed[1] ? Number(parsed[1]) : Math.max(info.size - Number(parsed[2]), 0);
    end = parsed[1] && parsed[2] ? Math.min(Number(parsed[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      response.writeHead(416, { ...headers, "content-range": `bytes */${info.size}` });
      return response.end();
    }
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
  }
  headers["content-length"] = String(info.size ? end - start + 1 : 0);
  response.writeHead(status, headers);
  if (request.method === "HEAD" || !info.size) return response.end();
  try { await pipeline(createReadStream(absoluteFile, { start, end }), response); }
  catch (error) { if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error; }
}

async function sendWebResponse(response, result, method) {
  const headers = Object.fromEntries(result.headers);
  const cookies = result.headers.getSetCookie?.();
  if (cookies?.length) headers["set-cookie"] = cookies;
  response.writeHead(result.status, headers);
  if (method === "HEAD" || !result.body) return response.end();
  response.end(Buffer.from(await result.arrayBuffer()));
}

export async function startDevServer({ root = defaultRoot, dataDir, port = 4173 } = {}) {
  root = resolve(root);
  process.env.BUILDER_LOCAL_DATA_DIR = resolve(dataDir ?? process.env.BUILDER_LOCAL_DATA_DIR ?? resolve(root, ".local-data"));
  const handlers = new Map();
  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "127.0.0.1";
      const origin = new URL(`http://${host}`);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
        return json(response, 400, { error: "invalid local host" });
      }
      const url = new URL(request.url ?? "/", origin);
      const pathname = decodeURIComponent(url.pathname);
      const route = routeApi(pathname);
      if (route) {
        if (Number(request.headers["content-length"] ?? 0) > maxRequestBytes) {
          request.resume();
          return json(response, 413, { error: "Файл слишком большой: максимум 4 МБ." });
        }
        const [file, params] = route;
        if (!handlers.has(file)) handlers.set(file, import(pathToFileURL(resolve(root, "netlify/functions", file)).href));
        const handler = (await handlers.get(file)).default;
        const body = ["GET", "HEAD"].includes(request.method) ? undefined : await readBody(request);
        const headers = new Headers();
        for (let index = 0; index < request.rawHeaders.length; index += 2) headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);
        const webRequest = new Request(url, { method: request.method, headers, body });
        const result = await handler(webRequest, { params, ip: "127.0.0.1" });
        return await sendWebResponse(response, result, request.method);
      }
      if (!["GET", "HEAD"].includes(request.method)) return json(response, 405, { error: "method not allowed" });
      await serveFile(request, response, root, pathname);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      json(response, error.status ?? 500, { error: error.status ? error.message : "Сервис временно недоступен." });
      if (!error.status) console.error(error.message);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListening);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}`, dataDir: process.env.BUILDER_LOCAL_DATA_DIR };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(resolve(defaultRoot, ".env")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const portArgument = process.argv.indexOf("--port");
  const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const { server, url } = await startDevServer({ port });
  console.log(`Local: ${url}`);
  console.log("Откройте адрес в браузере. Данные сохраняются только на этом компьютере.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
