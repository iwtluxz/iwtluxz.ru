import { getStore } from "@netlify/blobs";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const AVATAR_CACHE_MS = 60 * 1000;
const allowedUsers = new Set([
  "1105558423359205489",
  "958595335037542450",
  "788045714571132928"
]);
const store = getStore("discord-profiles");

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function getDefaultAvatarUrl(userId) {
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function getAvatarUrl(user) {
  if (!user.avatar) {
    return getDefaultAvatarUrl(user.id);
  }

  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=256`;
}

async function readCachedProfile(userId) {
  return await store.get(`discord/${userId}`, {
    consistency: "strong",
    type: "json"
  });
}

async function writeCachedProfile(userId, profile) {
  await store.setJSON(`discord/${userId}`, profile);
}

export default async (_req, context) => {
  const { userId } = context.params ?? {};

  if (!allowedUsers.has(userId)) {
    return json({ error: "not found" }, 404);
  }

  const cachedProfile = await readCachedProfile(userId).catch(() => null);
  const now = Date.now();

  if (cachedProfile && now - cachedProfile.updatedAt < AVATAR_CACHE_MS) {
    return json(cachedProfile, 200, {
      "cache-control": "public, max-age=30, stale-while-revalidate=120"
    });
  }

  if (!process.env.DISCORD_BOT_TOKEN) {
    if (cachedProfile) {
      return json({ ...cachedProfile, stale: true }, 200, {
        "cache-control": "no-store"
      });
    }

    return json({ error: "discord token is not configured" }, 503, {
      "cache-control": "no-store"
    });
  }

  try {
    const response = await fetch(`${DISCORD_API_BASE}/users/${userId}`, {
      headers: {
        authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
      }
    });

    if (!response.ok) {
      throw new Error(`discord api returned ${response.status}`);
    }

    const user = await response.json();
    const profile = {
      id: user.id,
      username: user.username,
      globalName: user.global_name ?? null,
      avatarHash: user.avatar ?? null,
      avatarUrl: getAvatarUrl(user),
      updatedAt: now
    };

    await writeCachedProfile(userId, profile).catch(() => {});

    return json(profile, 200, {
      "cache-control": "public, max-age=30, stale-while-revalidate=120"
    });
  } catch {
    if (cachedProfile) {
      return json({ ...cachedProfile, stale: true }, 200, {
        "cache-control": "no-store"
      });
    }

    return json({ error: "discord profile unavailable" }, 503, {
      "cache-control": "no-store"
    });
  }
};

export const config = {
  path: "/api/discord/avatar/:userId"
};
