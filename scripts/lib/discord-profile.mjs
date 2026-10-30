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
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    const discordCode = Number.isSafeInteger(details?.code) ? details.code : null;
    throw Object.assign(new Error(`Discord API returned ${response.status}`), { status: response.status, discordCode });
  }
  return response.json();
}

// Only documented public account flags describe earned Discord badges. Nitro is
// not a public bot field; a boost below refers only to this particular guild.
// https://docs.discord.com/developers/resources/user#user-object-user-flags
const badgeFlags = [
  [0, "staff", "Discord Staff"], [1, "partner", "Partnered Server Owner"],
  [2, "hypesquad-events", "HypeSquad Events"], [3, "bug-hunter-level-1", "Bug Hunter Level 1"],
  [6, "house-bravery", "HypeSquad Bravery"], [7, "house-brilliance", "HypeSquad Brilliance"],
  [8, "house-balance", "HypeSquad Balance"], [9, "early-supporter", "Early Supporter"],
  [14, "bug-hunter-level-2", "Bug Hunter Level 2"], [16, "verified-bot", "Verified Bot"],
  [17, "early-verified-developer", "Early Verified Bot Developer"], [18, "moderator-alumni", "Moderator Programs Alumni"]
];

export function getDiscordBadges(publicFlags, member) {
  const flags = Number.isSafeInteger(publicFlags) && publicFlags >= 0 ? BigInt(publicFlags) : 0n;
  const badges = badgeFlags.filter(([bit]) => (flags & (1n << BigInt(bit))) !== 0n)
    .map(([, id, label]) => ({ id, label }));
  if (typeof member?.premium_since === "string" && Number.isFinite(Date.parse(member.premium_since))) {
    badges.push({ id: "server-booster", label: "Server Booster" });
  }
  return badges;
}

export async function fetchDiscordMembership(userId, token, guildId) {
  if (!guildId) return { member: null, data: null };
  try {
    const data = await fetchDiscordJson(`/guilds/${guildId}/members/${userId}`, token, 6000);
    if (!data?.user || data.user.id !== userId) throw new Error("Invalid Discord member response");
    return { member: true, data };
  } catch (error) {
    if (error.status === 404 && error.discordCode === 10007) return { member: false, data: null };
    throw error;
  }
}

export async function fetchDiscordIdentity(userId, token, guildId, { requireMembership = false } = {}) {
  const membership = await fetchDiscordMembership(userId, token, guildId).catch(error => {
    if (requireMembership) throw error;
    return { member: null, data: null };
  });
  if (requireMembership && membership.member !== true) {
    return { id: userId, guildId: guildId || null, member: membership.member, badges: [] };
  }
  const user = await fetchDiscordJson(`/users/${userId}`, token);
  if (user.id !== userId || typeof user.username !== "string") throw new Error("Invalid Discord user response");
  const member = membership.data;
  return {
    id: user.id,
    guildId: guildId || null,
    member: membership.member,
    username: user.username,
    globalName: user.global_name ?? null,
    displayName: member?.nick || user.global_name || user.username,
    avatarHash: user.avatar ?? null,
    avatarUrl: getAvatarUrl(user),
    badges: getDiscordBadges(user.public_flags, member)
  };
}

export function getCustomStatus(presence) {
  // Offline users may omit their saved custom status: retain the last known text.
  if (!presence || !Array.isArray(presence.activities) || presence.status === "offline") return null;
  const activity = presence.activities.find((entry) => entry.type === 4);
  return typeof activity?.state === "string" ? activity.state : "";
}

export function getDiscordActivity(presence) {
  if (!presence || !Array.isArray(presence.activities) || presence.status === "offline") return null;
  const activity = presence.activities.find(entry => [0, 1, 2, 3, 5].includes(entry.type) && typeof entry.name === "string");
  if (!activity) return null;
  const clip = value => typeof value === "string" ? value.slice(0, 200) : "";
  return { type: activity.type, name: clip(activity.name), details: clip(activity.details), state: clip(activity.state) };
}

export function fetchDiscordPresences(token, guildId, userIds, {
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = 12000
} = {}) {
  if (!guildId || typeof WebSocketImpl !== "function" || !userIds.length) return Promise.resolve(new Map());
  // Discord accepts at most 100 explicit IDs per member request. Use one
  // connection for all batches, each with a distinct nonce.
  userIds = [...new Set(userIds)];
  const batches = Array.from({ length: Math.ceil(userIds.length / 100) }, (_, index) => userIds.slice(index * 100, index * 100 + 100));
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(DISCORD_GATEWAY);
    const presences = new Map();
    const pending = new Set(batches.map((_, index) => `profile-sync-${index}`));
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
          for (let index = 0; index < batches.length; index += 1) {
            send(8, { guild_id: guildId, user_ids: batches[index], presences: true, nonce: `profile-sync-${index}` });
          }
        } else if (message.t === "GUILD_CREATE" && message.d?.id === guildId) {
          remember(message.d.presences);
        } else if (message.t === "PRESENCE_UPDATE" && message.d?.guild_id === guildId) {
          remember([message.d]);
        } else if (message.t === "GUILD_MEMBERS_CHUNK" && message.d?.guild_id === guildId && pending.has(message.d.nonce)) {
          remember(message.d.presences);
          for (const member of message.d.members ?? []) {
            if (userIds.includes(member.user?.id) && !presences.has(member.user.id)) {
              presences.set(member.user.id, { user: member.user, status: "offline", activities: [] });
            }
          }
          if (message.d.chunk_index + 1 >= message.d.chunk_count) pending.delete(message.d.nonce);
          if (!pending.size) finish();
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
