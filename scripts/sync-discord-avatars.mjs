import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const GUILD_PRESENCES_INTENT = 1 << 8;
const GUILDS_INTENT = 1 << 0;

const profiles = [
  {
    name: "iwtlu",
    userId: "1105558423359205489",
    outputs: ["img/discordimg.png"],
    htmlPath: "iwtlu.html"
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

function readDotEnvValue(name) {
  return readFile(".env", "utf8").then((text) => {
    const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${name}=`));
    return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
  }).catch(() => "");
}

async function getEnvValue(name) {
  return (process.env[name] || await readDotEnvValue(name)).trim();
}

async function getToken() {
  const token = await getEnvValue("DISCORD_BOT_TOKEN");
  return token.replace(/^Bot\s+/i, "");
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bot ${token}`,
      "user-agent": "iwtlu-profile-sync"
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

async function writeTextIfChanged(path, nextText) {
  const absolutePath = resolve(path);
  const currentText = await readFile(absolutePath, "utf8");

  if (currentText === nextText) {
    return false;
  }

  await writeFile(absolutePath, nextText);
  return true;
}

function getAvatarUrl(user) {
  if (!user.avatar) {
    return `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
  }

  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=256`;
}

function formatPresenceStatus(presence) {
  const activities = Array.isArray(presence?.activities) ? presence.activities : [];
  const customStatus = activities.find((activity) => activity.type === 4 && activity.state);

  if (customStatus?.state) {
    return customStatus.state;
  }

  const spotify = activities.find((activity) => activity.type === 2 && activity.name === "Spotify");
  if (spotify) {
    const parts = [spotify.details, spotify.state].filter(Boolean);
    if (parts.length) {
      return parts.join(" - ");
    }
  }

  const activity = activities.find((entry) => entry.type !== 4);
  if (!activity) {
    return "";
  }

  if (activity.type === 0) {
    return `играет в ${activity.name}`;
  }

  if (activity.type === 2) {
    return `слушает ${activity.details || activity.name}`;
  }

  if (activity.type === 3) {
    return `смотрит ${activity.name}`;
  }

  return activity.details || activity.state || activity.name || "";
}

function waitForGatewayMessage(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    const onMessage = (event) => {
      cleanup();
      resolve(JSON.parse(event.data));
    };

    const onError = () => {
      cleanup();
      reject(new Error("Discord gateway error"));
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Discord gateway closed"));
    };

    socket.addEventListener("message", onMessage, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}

async function fetchPresence(token, guildId, userId) {
  if (!guildId || typeof WebSocket !== "function") {
    return null;
  }

  const socket = new WebSocket(DISCORD_GATEWAY);
  const timer = setTimeout(() => socket.close(), 15000);

  try {
    const hello = await waitForGatewayMessage(socket);
    const heartbeatInterval = hello.d?.heartbeat_interval ?? 45000;
    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: 1, d: null }));
      }
    }, heartbeatInterval);

    socket.send(JSON.stringify({
      op: 2,
      d: {
        token,
        intents: GUILDS_INTENT | GUILD_PRESENCES_INTENT,
        properties: {
          os: "linux",
          browser: "iwtlu-profile-sync",
          device: "iwtlu-profile-sync"
        }
      }
    }));

    const deadline = Date.now() + 14000;
    while (Date.now() < deadline) {
      const message = await waitForGatewayMessage(socket);
      const presence = findPresenceInGatewayPayload(message, guildId, userId);

      if (presence) {
        clearInterval(heartbeat);
        return presence;
      }
    }

    clearInterval(heartbeat);
    return null;
  } catch (error) {
    console.warn(`presence unavailable for ${userId}: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

function findPresenceInGatewayPayload(message, guildId, userId) {
  if (message.t === "PRESENCE_UPDATE" && message.d?.user?.id === userId && message.d?.guild_id === guildId) {
    return message.d;
  }

  if (message.t === "READY" || message.t === "GUILD_CREATE") {
    const guilds = message.t === "READY" ? message.d?.guilds : [message.d];
    for (const guild of guilds ?? []) {
      if (guild?.id !== guildId) {
        continue;
      }

      const presence = guild.presences?.find((entry) => entry.user?.id === userId);
      if (presence) {
        return presence;
      }
    }
  }

  return null;
}

function updateDiscordStatusHtml(html, statusText) {
  if (!statusText) {
    return html;
  }

  const escaped = statusText.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  return html.replace(
    /(<span\s+data-discord-status-text>)([\s\S]*?)(<\/span>)/,
    `$1${escaped}$3`
  );
}

async function syncProfile(profile, token, guildId) {
  const user = await fetchJson(`${DISCORD_API}/users/${profile.userId}`, token);
  const avatarUrl = getAvatarUrl(user);
  const bytes = await fetchBytes(avatarUrl);
  let changed = false;

  for (const output of profile.outputs) {
    changed = await writeIfChanged(output, bytes) || changed;
  }

  if (profile.htmlPath) {
    const presence = await fetchPresence(token, guildId, profile.userId);
    const statusText = formatPresenceStatus(presence);

    if (statusText) {
      const currentHtml = await readFile(profile.htmlPath, "utf8");
      changed = await writeTextIfChanged(profile.htmlPath, updateDiscordStatusHtml(currentHtml, statusText)) || changed;
      console.log(`status ${profile.name}: ${statusText}`);
    } else {
      console.log(`status ${profile.name}: unchanged`);
    }
  }

  console.log(`${changed ? "updated" : "unchanged"} ${profile.name}: ${avatarUrl}`);
}

const token = await getToken();
const guildId = await getEnvValue("DISCORD_GUILD_ID");

if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is required.");
}

for (const profile of profiles) {
  await syncProfile(profile, token, guildId);
}
