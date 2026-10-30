import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { fetchDiscordIdentity, fetchDiscordJson, fetchDiscordPresences, getCustomStatus, getDiscordActivity } from "./lib/discord-profile.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileGuildId = "1557152366208229486";
const dynamicMarker = "iwtxz-public-discord-sync";
const validUserId = /^\d{17,20}$/;

const profiles = [
  { name: "iwtlu", userId: "484816707798564894", outputs: ["img/discordimg.png"] },
  { name: "strelokk", userId: "958595335037542450", outputs: ["img/avatar1.jpg"], htmlPath: "strelokk.html" },
  { name: "shakzy", userId: "788045714571132928", outputs: ["img/avatar_shakzy.jpg"] }
];

/** Read only published opt-ins; a failed page never produces a partial list. */
export async function discoverDiscordProfiles({ root = projectRoot, fetch: fetchImpl = globalThis.fetch } = {}) {
  const context = { window: {} };
  vm.runInNewContext(await readFile(resolve(root, "backend-config.js"), "utf8"), context, { timeout: 1000 });
  const config = context.window.IWTXZ_BACKEND_CONFIG;
  if (config?.provider !== "supabase") return { guildId: profileGuildId, profiles: [] };
  const url = new URL(config.url);
  if (url.protocol !== "https:" || url.username || url.password || !["", "/"].includes(url.pathname) || url.search || url.hash
      || typeof config.publishableKey !== "string" || !config.publishableKey.startsWith("sb_publishable_")) {
    throw new Error("Discord discovery requires the public Supabase configuration.");
  }
  const guildId = validUserId.test(config.discordGuildId) ? config.discordGuildId : profileGuildId;
  const selected = new Map();
  const seen = new Set();
  const limit = 1000;
  for (let offset = 0; offset < 100000; offset += limit) {
    const endpoint = new URL("/rest/v1/profile_published", url.origin);
    endpoint.search = new URLSearchParams({ select: "username,settings", order: "username.asc", offset: String(offset), limit: String(limit) });
    const response = await fetchImpl(endpoint, { headers: { apikey: config.publishableKey, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Published Discord profiles unavailable (HTTP ${response.status}); existing snapshots preserved.`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > limit) throw new Error("Invalid published Discord profiles response.");
    for (const row of rows) {
      if (!row || typeof row.username !== "string" || !/^[a-z0-9][a-z0-9_-]{2,31}$/.test(row.username) || seen.has(row.username)
          || !row.settings || typeof row.settings !== "object" || Array.isArray(row.settings)) {
        throw new Error("Invalid or repeated published profile; existing Discord snapshots preserved.");
      }
      seen.add(row.username);
      if (row.settings.discordSync !== true || typeof row.settings.discordUserId !== "string" || !validUserId.test(row.settings.discordUserId)) continue;
      if (!selected.has(row.settings.discordUserId)) selected.set(row.settings.discordUserId, {
        name: row.username, userId: row.settings.discordUserId, outputs: [], dynamic: true
      });
    }
    if (rows.length < limit) return { guildId, profiles: [...selected.values()] };
  }
  throw new Error("Published Discord profile pagination did not finish; existing snapshots preserved.");
}

export async function removeUnusedDiscordSnapshots(activeIds, { root = projectRoot } = {}) {
  const directory = resolve(root, "data/discord-profiles");
  const preserve = new Set([...activeIds, ...profiles.map(profile => profile.userId)]);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{17,20}\.json$/.test(entry.name)) continue;
    const userId = entry.name.slice(0, -5);
    if (preserve.has(userId)) continue;
    const path = resolve(directory, entry.name);
    const previous = await readFile(path, "utf8").then(JSON.parse).catch(() => null);
    if (previous?.managedBy !== dynamicMarker || previous.id !== userId) continue;
    await unlink(path);
    removed += 1;
  }
  return removed;
}

export async function checkDiscordGuildAvailability(token, guildId) {
  try {
    const guild = await fetchDiscordJson(`/guilds/${guildId}`, token);
    if (guild?.id !== guildId) throw new Error("Unexpected Discord guild response");
    console.log(`Discord profile guild ${guildId}: available to the bot.`);
    return true;
  } catch (error) {
    const status = Number.isSafeInteger(error.status) ? ` HTTP ${error.status}` : "";
    const code = Number.isSafeInteger(error.discordCode) ? ` Discord ${error.discordCode}` : "";
    console.warn(`Discord profile guild ${guildId}: unavailable.${status}${code} The bot must belong to this server before automatic profile sync can work.`);
    return false;
  }
}

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

export async function syncProfile(profile, token, guildId, presences, { identity: suppliedIdentity } = {}) {
  const identity = suppliedIdentity ?? await fetchDiscordIdentity(profile.userId, token, guildId, { requireMembership: profile.dynamic === true });
  const snapshotPath = profile.snapshotPath || `data/discord-profiles/${profile.userId}.json`;
  const previous = await readFile(snapshotPath, "utf8").then(JSON.parse).catch(() => null);
  const presence = presences.get(profile.userId);
  const statusText = getCustomStatus(presence);
  const allowDetails = !profile.dynamic || identity.member === true;
  const snapshot = allowDetails ? {
    ...identity,
    statusText: statusText ?? previous?.statusText ?? null,
    status: presence?.status ?? previous?.status ?? null,
    activity: presence ? getDiscordActivity(presence) : previous?.activity ?? null,
    ...(profile.dynamic ? { managedBy: dynamicMarker } : {})
  } : {
    id: profile.userId, guildId: guildId || null, member: identity.member === false ? false : null,
    badges: [], status: null, statusText: null, activity: null, avatarDecoration: null, managedBy: dynamicMarker
  };
  const { updatedAt: _previousTimestamp, ...previousData } = previous ?? {};
  let changed = false;

  if (JSON.stringify(snapshot) !== JSON.stringify(previousData) || Date.now() - Number(previous?.updatedAt || 0) >= 6 * 60 * 60 * 1000) {
    snapshot.updatedAt = Date.now();
    changed = await writeIfChanged(snapshotPath, Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`));
  }

  // Text still updates if the CDN fails. Keep working fallback images on errors.
  if (allowDetails && profile.outputs?.length) try {
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

  if (allowDetails && profile.htmlPath) {
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

  const discovery = await discoverDiscordProfiles().catch(error => {
    console.warn(`${error.message}; keeping published-user Discord snapshots`);
    return null;
  });
  const profileGuildAvailable = discovery ? await checkDiscordGuildAvailability(token, discovery.guildId) : false;
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

  if (discovery) {
    // Check the invite guild before requesting a user's public profile. No
    // nonmember details, account metadata or bot token enter public snapshots.
    const identities = new Map();
    for (const profile of discovery.profiles) {
      const identity = profileGuildAvailable ? await fetchDiscordIdentity(profile.userId, token, discovery.guildId, { requireMembership: true }).catch(error => {
        console.warn(`Discord membership ${profile.userId}: ${error.message}`);
        return { id: profile.userId, guildId: discovery.guildId, member: null, badges: [] };
      }) : { id: profile.userId, guildId: discovery.guildId, member: null, badges: [] };
      identities.set(profile.userId, identity);
    }
    const members = discovery.profiles.filter(profile => identities.get(profile.userId).member === true);
    const dynamicPresences = await fetchDiscordPresences(token, discovery.guildId, members.map(profile => profile.userId)).catch(error => {
      console.warn(`${error.message}; keeping last known published-user presences`);
      return new Map();
    });
    for (const profile of discovery.profiles) {
      await syncProfile(profile, token, discovery.guildId, dynamicPresences, { identity: identities.get(profile.userId) });
    }
    await removeUnusedDiscordSnapshots(discovery.profiles.map(profile => profile.userId));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
