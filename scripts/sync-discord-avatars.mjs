import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDiscordIdentity, fetchDiscordPresences, getCustomStatus } from "./lib/discord-profile.mjs";

const profiles = [
  { name: "iwtlu", userId: "484816707798564894", outputs: ["img/discordimg.png"] },
  { name: "strelokk", userId: "958595335037542450", outputs: ["img/avatar1.jpg"], htmlPath: "strelokk.html" },
  { name: "shakzy", userId: "788045714571132928", outputs: ["img/avatar_shakzy.jpg"] }
];

async function getEnvValue(name) {
  if (process.env[name]) return process.env[name].trim();
  const env = await readFile(".env", "utf8").catch(() => "");
  const line = env.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${name}=`));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
}

async function writeIfChanged(path, bytes) {
  const absolutePath = resolve(path);
  const current = await readFile(absolutePath).catch(() => null);
  if (current && Buffer.compare(current, bytes) === 0) return false;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return true;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export async function syncProfile(profile, token, guildId, presences) {
  const identity = await fetchDiscordIdentity(profile.userId, token, guildId);
  const snapshotPath = profile.snapshotPath || `data/discord-profiles/${profile.userId}.json`;
  const previous = await readFile(snapshotPath, "utf8").then(JSON.parse).catch(() => null);
  const presence = presences.get(profile.userId);
  const statusText = getCustomStatus(presence);
  const snapshot = {
    ...identity,
    statusText: statusText ?? previous?.statusText ?? null,
    status: presence?.status ?? previous?.status ?? null
  };
  const { updatedAt: _previousTimestamp, ...previousData } = previous ?? {};
  let changed = false;

  if (JSON.stringify(snapshot) !== JSON.stringify(previousData)) {
    snapshot.updatedAt = Date.now();
    changed = await writeIfChanged(snapshotPath, Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`));
  }

  // Text still updates if the CDN fails. Keep working fallback images on errors.
  try {
    const response = await fetch(identity.avatarUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
      throw new Error(`Invalid avatar response (${response.status})`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("Empty avatar response");
    for (const output of profile.outputs) changed = await writeIfChanged(output, bytes) || changed;
  } catch (error) {
    console.warn(`avatar ${profile.name}: ${error.message}; keeping the local image`);
  }

  if (profile.htmlPath) {
    const currentHtml = await readFile(profile.htmlPath, "utf8");
    let nextHtml = currentHtml.replace(
      /(<span\s+class="discord-card-name"\s+data-discord-display-name>)([\s\S]*?)(<\/span>)/,
      (_match, start, _text, end) => `${start}${escapeHtml(identity.displayName)}${end}`
    );
    if (statusText !== null) {
      nextHtml = nextHtml.replace(
        /(<span\s+data-discord-status-text>)([\s\S]*?)(<\/span>)/,
        (_match, start, _text, end) => `${start}${escapeHtml(statusText)}${end}`
      );
    }
    changed = await writeIfChanged(profile.htmlPath, Buffer.from(nextHtml)) || changed;
  }
  console.log(`${changed ? "updated" : "unchanged"} ${profile.name}`);
}

export async function main() {
  const token = (await getEnvValue("DISCORD_BOT_TOKEN")).replace(/^Bot\s+/i, "");
  const guildId = await getEnvValue("DISCORD_GUILD_ID");
  if (!token) throw new Error("DISCORD_BOT_TOKEN is required.");
  if (!guildId) console.warn("DISCORD_GUILD_ID is missing: custom statuses cannot be refreshed.");

  const presences = await fetchDiscordPresences(token, guildId, profiles.map((profile) => profile.userId)).catch((error) => {
    console.warn(`${error.message}; keeping the last known statuses`);
    return new Map();
  });
  if (guildId && !presences.size) console.warn("No presences received: check the guild ID, bot membership and Presence Intent.");

  let failures = 0;
  for (const profile of profiles) {
    try {
      await syncProfile(profile, token, guildId, presences);
    } catch (error) {
      failures += 1;
      console.error(`profile ${profile.name}: ${error.message}`);
    }
  }
  if (failures === profiles.length) throw new Error("All Discord profiles failed to sync.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
