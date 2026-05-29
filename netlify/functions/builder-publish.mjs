import { getStore } from "@netlify/blobs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const sessions = getStore("builder-sessions");
const sessionCookie = "iwtxz_builder_session";
const fixedSlugs = {
  iwtlu: "iwtlu",
  shakzy: "shakzy",
  strelok: "strelokk",
  strelokk: "strelokk"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, decodeURIComponent(value.join("=") || "")];
    }).filter(([key]) => key)
  );
}

async function requireUser(req) {
  const token = parseCookies(req.headers.get("cookie") ?? "")[sessionCookie];
  if (!token) {
    return null;
  }

  const session = await sessions.get(`sessions/${token}`, { consistency: "strong", type: "json" });
  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  return session.username;
}

function cleanText(value, fallback, max = 240) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, max);
}

function cleanUrl(value) {
  const text = String(value ?? "").trim();
  return text.startsWith("data:") || text.startsWith("http://") || text.startsWith("https://") || text.startsWith("img/") || text.startsWith("sound/")
    ? text
    : "";
}

function slugify(value, fallback) {
  return String(value || fallback || "profile")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "profile";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function normalizeSite(input, username) {
  return {
    id: slugify(input.id, username),
    title: cleanText(input.title, username, 80),
    nickname: cleanText(input.nickname, username, 40),
    description: cleanText(input.description, "The only way to do great work is to love what you do"),
    discord: cleanText(input.discord, "", 60),
    telegram: cleanUrl(input.telegram),
    steam: cleanUrl(input.steam),
    background: cleanUrl(input.background),
    avatar: cleanUrl(input.avatar),
    music: cleanUrl(input.music),
    musicTitle: cleanText(input.musicTitle, "sound", 80)
  };
}

function renderProfile(site) {
  const telegram = site.telegram
    ? `<a class="social" href="${escapeHtml(site.telegram)}" target="_blank" rel="noreferrer"><img src="img/telegram.png" alt=""></a>`
    : "";
  const steam = site.steam
    ? `<a class="social" href="${escapeHtml(site.steam)}" target="_blank" rel="noreferrer"><img src="img/steam.png" alt=""></a>`
    : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(site.title)} | iwtxz</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px 24px 112px;
      overflow: hidden;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      color: #fff;
      background:
        linear-gradient(rgba(0,0,0,.58), rgba(0,0,0,.58)),
        url("${escapeHtml(site.background)}") center center / cover no-repeat #09090c;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      backdrop-filter: blur(.75px);
      pointer-events: none;
    }
    .profile {
      position: relative;
      z-index: 1;
      display: grid;
      justify-items: center;
      gap: 12px;
      text-align: center;
    }
    .avatar {
      width: 112px;
      height: 112px;
      border-radius: 50%;
      object-fit: cover;
      box-shadow: 0 0 22px rgba(255,255,255,.28);
    }
    .name {
      margin: 0;
      font-size: clamp(34px, 6vw, 58px);
      line-height: .95;
      text-shadow: 0 0 18px rgba(255,255,255,.82);
    }
    .desc {
      margin: 0;
      max-width: 640px;
      font-weight: 700;
      white-space: pre-line;
      text-shadow: 0 2px 10px rgba(0,0,0,.72);
    }
    .socials {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 4px;
    }
    .social {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      filter: drop-shadow(0 0 8px rgba(255,255,255,.68));
    }
    .social img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .discord {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
      padding: 8px 12px 8px 8px;
      border-radius: 16px;
      background: rgba(0,0,0,.28);
      backdrop-filter: blur(7px);
      text-align: left;
    }
    .discord img {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      object-fit: cover;
    }
    .discord strong {
      display: block;
      font-size: 14px;
    }
    .discord span {
      display: block;
      margin-top: 2px;
      font-size: 12px;
      color: rgba(255,255,255,.86);
    }
    .discord b {
      color: #4ade80;
    }
    .music {
      position: fixed;
      left: 50%;
      bottom: 28px;
      z-index: 2;
      transform: translateX(-50%);
      width: min(620px, calc(100% - 32px));
      font-weight: 700;
      text-shadow: 0 2px 10px rgba(0,0,0,.7);
    }
    .music-line {
      height: 4px;
      margin-top: 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.28);
    }
  </style>
</head>
<body>
  <main class="profile">
    <img class="avatar" src="${escapeHtml(site.avatar)}" alt="">
    <h1 class="name">${escapeHtml(site.nickname)}</h1>
    <p class="desc">${escapeHtml(site.description)}</p>
    <div class="socials">
      <span class="social"><img src="img/discord.png" alt=""></span>
      ${telegram}
      ${steam}
    </div>
    <div class="discord">
      <img src="${escapeHtml(site.avatar)}" alt="">
      <div>
        <strong>${escapeHtml(site.discord || site.nickname)}</strong>
        <span><b>♫</b> • status</span>
      </div>
    </div>
  </main>
  <div class="music">
    <div>${escapeHtml(site.musicTitle)}</div>
    <div class="music-line"></div>
  </div>
  <audio src="${escapeHtml(site.music)}" autoplay loop></audio>
</body>
</html>`;
}

async function ensureRedirect(root, slug) {
  const redirectsPath = join(root, "_redirects");
  let text = "";

  try {
    text = await readFile(redirectsPath, "utf8");
  } catch {
    text = "";
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const wanted = [`/${slug} /${slug}.html 200`, `/${slug}/ /${slug}.html 200`];

  for (const line of wanted) {
    if (!lines.includes(line)) {
      lines.push(line);
    }
  }

  await writeFile(redirectsPath, `${lines.join("\n")}\n`, "utf8");
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  if (!process.env.NETLIFY_DEV && process.env.BUILDER_ENABLE_FILE_PUBLISH !== "true") {
    return json({ error: "file publish works only in local dev" }, 403);
  }

  const username = await requireUser(req);
  if (!username) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const site = normalizeSite(body.site ?? body, username);
    const slug = fixedSlugs[username] ?? slugify(site.id || site.nickname, username);
    const root = resolve(process.cwd());
    const filePath = resolve(root, `${slug}.html`);

    if (!filePath.startsWith(`${root}\\`) && !filePath.startsWith(`${root}/`)) {
      return json({ error: "invalid file path" }, 400);
    }

    await writeFile(filePath, renderProfile(site), "utf8");
    await ensureRedirect(root, slug);

    return json({
      ok: true,
      slug,
      file: `${slug}.html`,
      url: `/${slug}`
    });
  } catch {
    return json({ error: "project file publish failed" }, 503);
  }
};

export const config = {
  path: "/api/builder/publish"
};
