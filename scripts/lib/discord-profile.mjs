const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

export function getAvatarUrl(user) {
  if (!user.avatar) {
    const index = user.discriminator && user.discriminator !== "0"
      ? Number(user.discriminator) % 5
      : Number((BigInt(user.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=256`;
}

export async function fetchDiscordJson(path, token, timeoutMs = 6000) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bot ${token.replace(/^Bot\s+/i, "").trim()}` }
  });
  if (!response.ok) throw new Error(`Discord API returned ${response.status}`);
  return response.json();
}

export async function fetchDiscordIdentity(userId, token, guildId) {
  const user = await fetchDiscordJson(`/users/${userId}`, token);
  if (user.id !== userId || typeof user.username !== "string") throw new Error("Invalid Discord user response");
  let member = null;
  if (guildId) {
    member = await fetchDiscordJson(`/guilds/${guildId}/members/${userId}`, token, 3000).catch(() => null);
  }
  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name ?? null,
    displayName: member?.nick || user.global_name || user.username,
    avatarHash: user.avatar ?? null,
    avatarUrl: getAvatarUrl(user)
  };
}

export function getCustomStatus(presence) {
  // Offline users may omit their saved custom status: retain the last known text.
  if (!presence || !Array.isArray(presence.activities) || presence.status === "offline") return null;
  const activity = presence.activities.find((entry) => entry.type === 4);
  return typeof activity?.state === "string" ? activity.state : "";
}

export function fetchDiscordPresences(token, guildId, userIds, {
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = 12000
} = {}) {
  if (!guildId || typeof WebSocketImpl !== "function" || !userIds.length) return Promise.resolve(new Map());
  // One connection for the batch; persistent listeners prevent lost READY/chunks.
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(DISCORD_GATEWAY);
    const presences = new Map();
    const nonce = "profile-sync";
    let sequence = null;
    let heartbeat = 0;
    let settled = false;
    let requested = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(heartbeat);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      if (socket.readyState === 0 || socket.readyState === 1) socket.close();
      if (error) reject(error);
      else resolve(presences);
    };
    const send = (op, d) => socket.send(JSON.stringify({ op, d }));
    const remember = (entries) => {
      for (const presence of entries ?? []) {
        if (userIds.includes(presence.user?.id)) presences.set(presence.user.id, presence);
      }
    };
    const onMessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.s != null) sequence = message.s;
        if (message.op === 10) {
          heartbeat = setInterval(() => send(1, sequence), message.d.heartbeat_interval);
          send(2, {
            token: token.replace(/^Bot\s+/i, "").trim(),
            intents: (1 << 0) | (1 << 8),
            properties: { os: process.platform, browser: "profile-sync", device: "profile-sync" }
          });
        } else if (message.op === 1) {
          send(1, sequence);
        } else if (message.op === 7 || message.op === 9) {
          finish(new Error("Discord gateway session unavailable"));
        } else if (message.t === "READY" && !requested) {
          requested = true;
          send(8, { guild_id: guildId, user_ids: userIds, presences: true, nonce });
        } else if (message.t === "GUILD_CREATE" && message.d?.id === guildId) {
          remember(message.d.presences);
        } else if (message.t === "PRESENCE_UPDATE" && message.d?.guild_id === guildId) {
          remember([message.d]);
        } else if (message.t === "GUILD_MEMBERS_CHUNK" && message.d?.guild_id === guildId && message.d.nonce === nonce) {
          remember(message.d.presences);
          for (const member of message.d.members ?? []) {
            if (userIds.includes(member.user?.id) && !presences.has(member.user.id)) {
              presences.set(member.user.id, { user: member.user, status: "offline", activities: [] });
            }
          }
          if (message.d.chunk_index + 1 >= message.d.chunk_count) finish();
        }
      } catch (error) { finish(error); }
    };
    const onError = () => finish(new Error("Discord gateway connection failed"));
    const onClose = (event) => finish(new Error(`Discord gateway closed (${event.code})${event.code === 4014 ? ": enable Presence Intent in the Developer Portal" : ""}`));
    const deadline = setTimeout(() => finish(), timeoutMs);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}
