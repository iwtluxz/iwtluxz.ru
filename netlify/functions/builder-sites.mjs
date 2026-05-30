import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";

const sessions = getStore("builder-sessions");
const sites = getStore("builder-sites");
const sessionCookie = "iwtxz_builder_session";
const profileTemplates = {
  iwtlu: {
    id: "iwtlu",
    title: "iwtlu",
    nickname: "iwtlu",
    description: "Ты знаешь номера, ты знаешь наши ники",
    discord: "meowixzz",
    telegram: "https://t.me/iwtluz",
    steam: "https://steamcommunity.com/id/meintofores",
    background: "img/photo.gif",
    avatar: "img/avatar.jpg",
    music: "sound/sound.mp3",
    musicTitle: "ща кабудта фильм",
    theme: "dark"
  },
  shakzy: {
    id: "shakzy",
    title: "shakzy",
    nickname: "shakzy",
    description: "Respect the past, create the future",
    discord: "mrshakzzy",
    telegram: "",
    steam: "",
    background: "img/gif_shakzy.gif",
    avatar: "img/avatar_shakzy.jpg",
    music: "sound/sound2.mp3",
    musicTitle: "RJ Pasin - Chad",
    theme: "dark"
  },
  strelok: {
    id: "strelokk",
    title: "strelokk",
    nickname: "strelokk",
    description: "The only way to do great work is to love what you do",
    discord: "phantom576",
    telegram: "",
    steam: "",
    background: "img/artem.gif",
    avatar: "img/avatar1.jpg",
    music: "sound/sound1.mp3",
    musicTitle: "whitek3d - STATUS",
    theme: "dark"
  },
  strelokk: {
    id: "strelokk",
    title: "strelokk",
    nickname: "strelokk",
    description: "The only way to do great work is to love what you do",
    discord: "phantom576",
    telegram: "",
    steam: "",
    background: "img/artem.gif",
    avatar: "img/avatar1.jpg",
    music: "sound/sound1.mp3",
    musicTitle: "whitek3d - STATUS",
    theme: "dark"
  }
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

function cleanText(value, fallback, max = 120) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, max);
}

function cleanAsset(value) {
  const text = String(value ?? "");
  return text.startsWith("data:")
    || text.startsWith("http://")
    || text.startsWith("https://")
    || text.startsWith("img/")
    || text.startsWith("sound/")
    ? text
    : "";
}

function normalizeSite(input, username) {
  return {
    id: cleanText(input.id, randomBytes(8).toString("hex"), 32).replace(/[^a-z0-9_-]/gi, ""),
    owner: username,
    title: cleanText(input.title, "my profile", 80),
    nickname: cleanText(input.nickname, username, 40),
    description: cleanText(input.description, "The only way to do great work is to love what you do", 240),
    discord: cleanText(input.discord, "", 60),
    telegram: cleanText(input.telegram, "", 200),
    steam: cleanText(input.steam, "", 200),
    background: cleanAsset(input.background),
    avatar: cleanAsset(input.avatar),
    music: cleanAsset(input.music),
    musicTitle: cleanText(input.musicTitle, "sound", 80),
    theme: cleanText(input.theme, "dark", 20),
    updatedAt: Date.now()
  };
}

async function readIndex(username) {
  return await sites.get(`users/${username}/index`, { consistency: "strong", type: "json" }) ?? { ids: [] };
}

async function writeIndex(username, index) {
  await sites.setJSON(`users/${username}/index`, index);
}

async function ensureProfileTemplate(username) {
  const template = profileTemplates[username];
  if (!template) {
    return;
  }

  const key = `users/${username}/sites/${template.id}`;
  const existing = await sites.get(key, { consistency: "strong", type: "json" });
  const index = await readIndex(username);

  if (!existing) {
    await sites.setJSON(key, {
      ...template,
      owner: username,
      updatedAt: Date.now()
    });
  }

  if (!index.ids.includes(template.id)) {
    index.ids.unshift(template.id);
    await writeIndex(username, index);
  }
}

export default async (req, context) => {
  const mode = context.params?.mode;
  const username = await requireUser(req);

  if (!username) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    if (mode === "list") {
      await ensureProfileTemplate(username);
      const index = await readIndex(username);
      const entries = await Promise.all(index.ids.map((id) => (
        sites.get(`users/${username}/sites/${id}`, { consistency: "strong", type: "json" })
      )));

      return json({ sites: entries.filter(Boolean) });
    }

    if (mode === "get") {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      const site = await sites.get(`users/${username}/sites/${id}`, { consistency: "strong", type: "json" });
      return site ? json({ site }) : json({ error: "not found" }, 404);
    }

    if (mode === "save") {
      if (req.method !== "POST") {
        return json({ error: "method not allowed" }, 405);
      }

      const body = await req.json().catch(() => ({}));
      const site = normalizeSite(body.site ?? body, username);
      const index = await readIndex(username);

      if (!index.ids.includes(site.id)) {
        index.ids.unshift(site.id);
      }

      await sites.setJSON(`users/${username}/sites/${site.id}`, site);
      await writeIndex(username, index);

      return json({ site });
    }

    if (mode === "delete") {
      if (req.method !== "POST") {
        return json({ error: "method not allowed" }, 405);
      }

      const body = await req.json().catch(() => ({}));
      const id = cleanText(body.id, "", 32).replace(/[^a-z0-9_-]/gi, "");
      const index = await readIndex(username);
      index.ids = index.ids.filter((entry) => entry !== id);
      await writeIndex(username, index);
      await sites.delete(`users/${username}/sites/${id}`);

      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  } catch {
    return json({ error: "builder storage unavailable" }, 503);
  }
};

export const config = {
  path: "/api/builder/sites/:mode"
};
