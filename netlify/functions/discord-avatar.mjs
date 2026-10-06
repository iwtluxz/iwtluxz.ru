import { getStore } from "@netlify/blobs";
import { fetchDiscordIdentity } from "../../scripts/lib/discord-profile.mjs";

const AVATAR_CACHE_MS = 60 * 1000;
const allowedUsers = new Set([
  "484816707798564894",
  "958595335037542450",
  "788045714571132928"
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

async function readCachedProfile(userId) {
  return await getStore("discord-profiles").get(`discord/${userId}`, {
    consistency: "strong",
    type: "json"
  });
}

async function writeCachedProfile(userId, profile) {
  await getStore("discord-profiles").setJSON(`discord/${userId}`, profile);
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
    const profile = {
      ...await fetchDiscordIdentity(userId, process.env.DISCORD_BOT_TOKEN, process.env.DISCORD_GUILD_ID),
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
