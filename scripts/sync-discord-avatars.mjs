import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const profiles = [
  {
    name: "iwtlu",
    userId: "1105558423359205489",
    outputs: ["img/avatar.jpg", "img/discordimg.png"]
  },
  {
    name: "strelokk",
    userId: "958595335037542450",
    outputs: ["img/avatar1.jpg"]
  },
  {
    name: "shakzy",
    userId: "788045714571132928",
    outputs: ["img/avatar_shakzy.jpg"]
  }
];

function readDotEnvToken() {
  return readFile(".env", "utf8").then((text) => {
    const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith("DISCORD_BOT_TOKEN="));
    return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
  }).catch(() => "");
}

async function getToken() {
  const token = process.env.DISCORD_BOT_TOKEN || await readDotEnvToken();
  return token.trim().replace(/^Bot\s+/i, "");
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bot ${token}`,
      "user-agent": "iwtlu-avatar-sync"
    }
  });

  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Avatar download failed: ${response.status} ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function writeIfChanged(path, bytes) {
  const absolutePath = resolve(path);

  try {
    const current = await readFile(absolutePath);
    if (Buffer.compare(current, bytes) === 0) {
      return false;
    }
  } catch {}

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return true;
}

async function syncProfile(profile, token) {
  const user = await fetchJson(`https://discord.com/api/v10/users/${profile.userId}`, token);
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=256`
    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
  const bytes = await fetchBytes(avatarUrl);
  let changed = false;

  for (const output of profile.outputs) {
    changed = await writeIfChanged(output, bytes) || changed;
  }

  console.log(`${changed ? "updated" : "unchanged"} ${profile.name}: ${avatarUrl}`);
}

const token = await getToken();

if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is required.");
}

for (const profile of profiles) {
  await syncProfile(profile, token);
}
