import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const stores = new Map();
export const SESSION_COOKIE = "iwtxz_builder_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const reservedUsernames = new Set(["iwtlu", "shakzy", "strelok", "strelokk", "icetearz", "eris", "admin", "api", "index", "assets"]);

export class HttpError extends Error {
  constructor(status, message, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }
  });
}

export function failure(error) {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  console.error("Builder request failed:", error?.name ?? "Error", error?.code ?? "unknown", error?.syscall ?? "unknown");
  return json({ error: "Сервис временно недоступен. Попробуйте ещё раз.", code: "service_unavailable" }, 503);
}

async function fileOperation(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 6 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      // Windows scanners can briefly hold a JSON file during atomic replacement.
      await new Promise((done) => setTimeout(done, 10 * 2 ** attempt));
    }
  }
}

function localStore(name, directory) {
  const root = resolve(directory, name);
  function location(key) {
    if (!/^[a-zA-Z0-9_/-]+$/.test(key) || key.split("/").some((part) => !part)) throw new Error("Invalid storage key");
    const filename = resolve(root, `${key}.json`);
    const local = relative(root, filename);
    if (local.startsWith("..") || isAbsolute(local)) throw new Error("Invalid storage path");
    return filename;
  }
  return {
    async get(key) {
      for (let attempt = 0; ; attempt += 1) {
        try { return JSON.parse(await fileOperation(() => readFile(location(key), "utf8"))); }
        catch (error) {
          if (error.code === "ENOENT") return null;
          // An exclusive first creation may still be flushing its initial JSON.
          if (!(error instanceof SyntaxError) || attempt >= 5) throw error;
          await new Promise((done) => setTimeout(done, 10 * 2 ** attempt));
        }
      }
    },
    async setJSON(key, value, options = {}) {
      const filename = location(key);
      await fileOperation(() => mkdir(dirname(filename), { recursive: true }));
      const contents = JSON.stringify(value);
      const temporary = `${filename}.${randomBytes(8).toString("hex")}.tmp`;
      if (options.onlyIfNew) {
        try { await writeFile(filename, contents, { flag: "wx", mode: 0o600 }); return { modified: true }; }
        catch (error) { if (error.code === "EEXIST") return { modified: false }; throw error; }
      }
      try { await writeFile(temporary, contents, { mode: 0o600 }); await fileOperation(() => rename(temporary, filename)); }
      finally { await fileOperation(() => unlink(temporary)).catch(() => {}); }
      return { modified: true };
    },
    async delete(key) {
      try { await fileOperation(() => unlink(location(key))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };
}

// Read deployment credentials/context only while handling a request.
export function store(name) {
  if (!/^builder-[a-z-]+$/.test(name)) throw new Error("Invalid store name");
  const directory = process.env.BUILDER_LOCAL_DATA_DIR;
  const cacheKey = `${directory ?? "netlify"}/${name}`;
  if (directory) {
    if (!stores.has(cacheKey)) stores.set(cacheKey, localStore(name, directory));
    return stores.get(cacheKey);
  }
  return {
    async get(key) {
      const { getStore } = await import("@netlify/blobs");
      return getStore({ name, consistency: "strong" }).get(key, { type: "json", consistency: "strong" });
    },
    async setJSON(key, value, options) {
      const { getStore } = await import("@netlify/blobs");
      return getStore({ name, consistency: "strong" }).setJSON(key, value, options);
    },
    async delete(key) {
      const { getStore } = await import("@netlify/blobs");
      return getStore({ name, consistency: "strong" }).delete(key);
    }
  };
}

export function normalizeUsername(value) {
  const username = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) throw new HttpError(400, "Логин: 3–32 символа, латинские буквы, цифры, _ и -.", "invalid_username");
  return username === "strelok" ? "strelokk" : username;
}

export function safeMutation(req) {
  if (req.method !== "POST") throw new HttpError(405, "Используйте POST.", "method_not_allowed");
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site" || (origin && origin !== new URL(req.url).origin)) throw new HttpError(403, "Запрос с другого сайта отклонён.", "invalid_origin");
}

export async function readJson(req, maxBytes = 32 * 1024) {
  const declared = Number(req.headers.get("content-length"));
  if (declared > maxBytes) throw new HttpError(413, "Слишком большой запрос.", "request_too_large");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "Ожидается JSON.", "invalid_content_type");
  const bytes = await readLimitedBody(req, maxBytes);
  try {
    const result = JSON.parse(bytes.toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, "Некорректный JSON.", "invalid_json"); }
}

export async function readLimitedBody(req, maxBytes) {
  if (Number(req.headers.get("content-length")) > maxBytes) throw new HttpError(413, "Файл слишком большой.", "request_too_large");
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Максимальный размер запроса превышен.", "request_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

function tokenFromRequest(req) {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      try { const token = decodeURIComponent(value.join("=")); return /^[a-f0-9]{64}$/.test(token) ? token : null; }
      catch { return null; }
    }
  }
  return null;
}

function sessionKey(token) { return `sessions/${createHash("sha256").update(token).digest("hex")}`; }

export function cookieHeader(req, token, maxAge = SESSION_MAX_AGE) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function getSession(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const session = await store("builder-sessions").get(sessionKey(token));
  if (!session || session.expiresAt <= Date.now()) return null;
  const user = await store("builder-users").get(`users/${session.username}`);
  if (!user || (session.version ?? 0) !== (user.sessionVersion ?? 0)) return null;
  return { ...session, token, user };
}

export async function requireSession(req) {
  const session = await getSession(req);
  if (!session) throw new HttpError(401, "Сначала войдите в аккаунт.", "unauthorized");
  return session;
}

export async function createSession(user) {
  const token = randomBytes(32).toString("hex");
  await store("builder-sessions").setJSON(sessionKey(token), {
    username: user.username, version: user.sessionVersion ?? 0,
    createdAt: Date.now(), expiresAt: Date.now() + SESSION_MAX_AGE * 1000
  });
  return token;
}

export async function revokeSession(req) {
  const token = tokenFromRequest(req);
  if (token) await store("builder-sessions").delete(sessionKey(token));
}

export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw new HttpError(400, "Пароль должен содержать от 8 до 128 символов.", "invalid_password");
  return value;
}

export async function passwordRecord(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, passwordHash: Buffer.from(hash).toString("hex") };
}

export async function verifyPassword(password, user) {
  const salt = user?.salt && /^[a-f0-9]{32}$/.test(user.salt) ? user.salt : "00000000000000000000000000000000";
  const attempt = await scrypt(password, salt, 64);
  const stored = Buffer.from(typeof user?.passwordHash === "string" ? user.passwordHash : "", "hex");
  return stored.length === attempt.length && timingSafeEqual(stored, attempt);
}

export async function rateLimit(req, context, action, limit = 20) {
  const ip = context?.ip ?? req.headers.get("x-nf-client-connection-ip") ?? "local";
  const key = `limits/${createHash("sha256").update(`${action}/${ip}`).digest("hex")}`;
  const limits = store("builder-rate-limits");
  let record = await limits.get(key);
  const now = Date.now();
  if (!record || record.expiresAt <= now) record = { count: 0, expiresAt: now + 15 * 60 * 1000 };
  if (record.count >= limit) throw new HttpError(429, "Слишком много попыток. Попробуйте через 15 минут.", "rate_limited");
  record.count += 1;
  await limits.setJSON(key, record);
}

export function defaultSite(username) {
  const site = {
    id: username, owner: username, title: username, nickname: username,
    description: "", discord: "", telegram: "", steam: "",
    avatar: "img/mainavatar.gif", background: "img/background.mp4", backgroundType: "video",
    music: "sound/sound.mp3", musicTitle: "sexy supra", musicCover: "img/mysoundicon.png",
    avatarSize: 150, backgroundDim: 58, accentColor: "#f5f5f7", font: "minecraft",
    entryText: "click to enter...", showDiscord: true, musicLoop: true,
    publicUrl: `/u/${username}`, updatedAt: Date.now()
  };
  if (username === "iwtlu") Object.assign(site, {
    nickname: "Ɨ ω ŧ Ł υ", description: "самый тёмный рыцарь, но не в самом тёмном замке",
    discord: "iwtluz", telegram: "https://t.me/iwtluz", steam: "https://steamcommunity.com/id/meintofores"
  });
  if (username === "shakzy") Object.assign(site, {
    description: "Respect the past, create the future", discord: "mrshakzzy",
    avatar: "img/avatar_shakzy.jpg", background: "img/gif_shakzy.gif", backgroundType: "image",
    music: "sound/sound2.mp3", musicTitle: "RJ Pasin - Chad", musicCover: "img/shakzysoundicon.png"
  });
  if (username === "strelokk") Object.assign(site, {
    description: "The only way to do great work is to love what you do", discord: "phantom576.",
    avatar: "img/strelokkavatar.gif", background: "img/artem.gif", backgroundType: "image",
    music: "sound/sound1.mp3", musicTitle: "whitek3d - STATUS", musicCover: "img/strelokksoundicon.png"
  });
  return site;
}

function text(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new HttpError(400, "Некорректный текст настройки.", "invalid_setting");
  if (value.length > max) throw new HttpError(400, `Текст превышает ${max} символов.`, "invalid_setting");
  return value.trim();
}

function social(value) {
  const result = text(value, "", 500);
  if (!result) return "";
  try { const parsed = new URL(result); if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.href; } catch {}
  throw new HttpError(400, "Ссылки на соцсети должны начинаться с https://.", "invalid_url");
}

export function cleanAsset(value, username) {
  const asset = text(value, "", 2048);
  if (!asset) return "";
  if (/^(?:img|sound)\/[a-zA-Z0-9_./-]+(?:\?[a-zA-Z0-9_=&.-]*)?$/.test(asset) && !asset.split(/[/?]/).includes("..")) return asset;
  if (new RegExp(`^/api/builder/assets/file/${username}/[a-f0-9]{32}$`).test(asset)) return asset;
  try {
    const url = new URL(asset);
    if (url.protocol === "https:" && !url.username && !url.password) {
      if (url.pathname.startsWith("/api/builder/assets/file/") && !new RegExp(`^/api/builder/assets/file/${username}/[a-f0-9]{32}$`).test(url.pathname)) throw new Error("Foreign upload");
      return url.href;
    }
  } catch {}
  throw new HttpError(400, "Неверная ссылка на файл или файл другого пользователя.", "invalid_asset");
}

function number(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, "Размер или прозрачность вне допустимого диапазона.", "invalid_setting");
  return Math.round(value);
}

function bool(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new HttpError(400, "Некорректный переключатель.", "invalid_setting");
  return value;
}

export function normalizeSite(input, username) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Некорректные настройки страницы.", "invalid_profile");
  const defaults = defaultSite(username);
  const result = { id: username, owner: username, publicUrl: `/u/${username}`, updatedAt: Date.now() };
  for (const [key, max] of Object.entries({ title: 80, nickname: 40, description: 500, discord: 60, musicTitle: 100, entryText: 80 })) result[key] = text(input[key], defaults[key], max);
  result.title ||= username;
  result.nickname ||= username;
  result.entryText ||= defaults.entryText;
  for (const key of ["telegram", "steam"]) result[key] = social(input[key]);
  for (const key of ["avatar", "background", "music", "musicCover"]) result[key] = cleanAsset(input[key] === undefined ? defaults[key] : input[key], username);
  result.backgroundType = input.backgroundType ?? defaults.backgroundType;
  if (!["video", "image"].includes(result.backgroundType)) throw new HttpError(400, "Выберите картинку или видео для фона.", "invalid_setting");
  result.font = input.font ?? defaults.font;
  if (!["minecraft", "system"].includes(result.font)) throw new HttpError(400, "Неизвестный шрифт.", "invalid_setting");
  result.accentColor = input.accentColor ?? defaults.accentColor;
  if (typeof result.accentColor !== "string" || !/^#[a-fA-F0-9]{6}$/.test(result.accentColor)) throw new HttpError(400, "Некорректный цвет.", "invalid_setting");
  result.avatarSize = number(input.avatarSize, defaults.avatarSize, 80, 220);
  result.backgroundDim = number(input.backgroundDim, defaults.backgroundDim, 0, 85);
  result.showDiscord = bool(input.showDiscord, defaults.showDiscord);
  result.musicLoop = bool(input.musicLoop, defaults.musicLoop);
  return result;
}

export async function ownDraft(username) {
  const key = `users/${username}/sites/${username}`;
  const saved = await store("builder-sites").get(key);
  return saved ? normalizeSite(saved, username) : defaultSite(username);
}

export async function withPublication(site) {
  const published = await store("builder-published").get(`profiles/${site.owner}`);
  return { ...site, publishedAt: published?.publishedAt ?? null, publicUrl: `/u/${site.owner}` };
}
