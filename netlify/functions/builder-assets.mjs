import { randomBytes } from "node:crypto";
import { HttpError, MAX_ASSET_BYTES, failure, json, normalizeUsername, rateLimit, readLimitedBody, requireSession, safeMutation, store } from "./lib/builder-common.mjs";

const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const videoTypes = new Set(["video/mp4", "video/webm"]);
const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/webm"]);

function matchesSignature(bytes, type) {
  const ascii = (start, end) => bytes.subarray(start, end).toString("ascii");
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  if (type === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (type === "audio/mpeg" || type === "audio/mp3") return ascii(0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (type === "audio/wav" || type === "audio/x-wav") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  if (type === "audio/ogg") return ascii(0, 4) === "OggS";
  if (type.endsWith("/mp4")) return ascii(4, 8) === "ftyp";
  if (type.endsWith("/webm")) return bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  return false;
}

export default async (req, context = {}) => {
  try {
    const mode = context.params?.mode;
    if (mode === "upload") {
      safeMutation(req);
      const { username } = await requireSession(req);
      await rateLimit(req, context, "upload", 100);
      const url = new URL(req.url);
      const kind = url.searchParams.get("kind");
      if (!["avatar", "background", "music", "musicCover"].includes(kind)) throw new HttpError(400, "Неизвестный тип файла.", "invalid_asset_kind");
      let type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const allowed = kind === "music" ? audioTypes : kind === "background" ? new Set([...imageTypes, ...videoTypes]) : imageTypes;
      if (!allowed.has(type)) throw new HttpError(415, "Этот формат не поддерживается. Используйте PNG, JPG, GIF, WebP, MP3, WAV, OGG, MP4 или WebM.", "invalid_asset_type");
      const bytes = await readLimitedBody(req, MAX_ASSET_BYTES);
      if (imageTypes.has(type)) {
        // Browsers infer image MIME from the extension; save the actual safe image type.
        const detected = [...imageTypes].find((candidate) => matchesSignature(bytes, candidate));
        if (detected) type = detected;
      }
      if (audioTypes.has(type)) {
        const detected = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm"].find((candidate) => matchesSignature(bytes, candidate));
        if (detected) type = detected;
      }
      if (!bytes.length || !matchesSignature(bytes, type)) throw new HttpError(415, "Содержимое файла не соответствует выбранному формату.", "invalid_asset_type");
      const id = randomBytes(16).toString("hex");
      const name = String(url.searchParams.get("name") ?? "file").replace(/[\r\n\x00-\x1f\\/]/g, "").slice(0, 150) || "file";
      await store("builder-assets").setJSON(`files/${username}/${id}`, { owner: username, name, type, size: bytes.length, kind, createdAt: Date.now(), data: bytes.toString("base64") });
      return json({ url: `/api/builder/assets/file/${username}/${id}`, name, size: bytes.length, type, kind }, 201);
    }
    if (mode === "file") {
      if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Используйте GET.", "method_not_allowed");
      const owner = normalizeUsername(context.params?.owner);
      const id = context.params?.id;
      if (!/^[a-f0-9]{32}$/.test(id ?? "")) throw new HttpError(404, "Файл не найден.", "not_found");
      const asset = await store("builder-assets").get(`files/${owner}/${id}`);
      if (!asset) throw new HttpError(404, "Файл не найден.", "not_found");
      const bytes = Buffer.from(asset.data, "base64");
      const headers = {
        "content-type": asset.type, "cache-control": "public, max-age=31536000, immutable", "accept-ranges": "bytes",
        "x-content-type-options": "nosniff", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "content-security-policy": "default-src 'none'; sandbox"
      };
      const range = req.headers.get("range");
      if (range && req.method === "GET") {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${bytes.length}` } });
        let start, end;
        if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, bytes.length - suffix); end = bytes.length - 1; }
        else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1; }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${bytes.length}` } });
        headers["content-range"] = `bytes ${start}-${end}/${bytes.length}`;
        headers["content-length"] = String(end - start + 1);
        return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
      }
      headers["content-length"] = String(bytes.length);
      return new Response(req.method === "HEAD" ? null : bytes, { headers });
    }
    throw new HttpError(404, "Страница не найдена.", "not_found");
  } catch (error) { return failure(error); }
};

export const config = { path: ["/api/builder/assets/:mode", "/api/builder/assets/:mode/:owner/:id"] };
