import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverDiscordProfiles } from "./sync-discord-avatars.mjs";
import { fetchDiscordIdentity, getCustomStatus, getDiscordActivity } from "./lib/discord-profile.mjs";

const require = createRequire(import.meta.url);
const gatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json";
const validId = /^\d{17,20}$/;

export function createDiscordLive({
  token, guildId, discover = discoverDiscordProfiles, identity = fetchDiscordIdentity,
  WebSocketImpl = globalThis.WebSocket || require("ws"), logger = console
}) {
  if (!token || !validId.test(guildId || "")) throw new Error("Discord token and guild ID are required.");
  const allowed = new Set(), listeners = new Map(), identities = new Map(), presences = new Map(), pendingIdentity = new Map(), revisions = new Map();
  const queued = new Set();
  let allowedAt = 0, socket, ready = false, stopped = false, sequence = null, heartbeat, reconnect, requestTimer, discoveryTimer, identityTimer, keepalive;
  let retryMs = 2000, acknowledged = true;

  function write(response, event, data) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function broadcast(id, event, data) {
    for (const response of listeners.get(id) || []) write(response, event, data);
  }
  function publish(id) {
    const user = identities.get(id), presence = presences.get(id);
    if (!ready || !allowed.has(id) || !user || user.member !== true || !presence) return;
    broadcast(id, "profile", { ...user, ...presence, updatedAt: Date.now() });
  }
  function invalidate(id) {
    revisions.set(id, (revisions.get(id) || 0) + 1);
    identities.delete(id);
    presences.delete(id);
  }
  async function refreshIdentity(id) {
    if (!allowed.has(id) || !listeners.has(id) || pendingIdentity.has(id)) return;
    const revision = revisions.get(id) || 0;
    const promise = Promise.resolve().then(() => identity(id, token, guildId, { requireMembership: true }));
    pendingIdentity.set(id, promise);
    try {
      const user = await promise;
      if (stopped || !allowed.has(id) || !listeners.has(id) || (revisions.get(id) || 0) !== revision) return;
      if (user?.id !== id || user.guildId !== guildId || user.member !== true) {
        identities.delete(id);
        presences.delete(id);
        broadcast(id, "unavailable", { reason: "membership" });
        return;
      }
      identities.set(id, user);
      publish(id);
    } catch (error) {
      if ((revisions.get(id) || 0) === revision) { identities.delete(id); broadcast(id, "unavailable", { reason: "identity" }); }
      logger.warn(`Discord identity unavailable: ${error.message}`);
    } finally {
      pendingIdentity.delete(id);
      if (!stopped && allowed.has(id) && listeners.has(id) && (revisions.get(id) || 0) !== revision) void refreshIdentity(id);
    }
  }
  function enqueue(ids) {
    for (const id of ids) if (allowed.has(id) && listeners.has(id)) queued.add(id);
    if (!requestTimer) requestTimer = setTimeout(sendRequests, 0);
  }
  function sendRequests() {
    requestTimer = null;
    if (!ready || !socket || socket.readyState !== 1) return;
    const ids = [...queued].filter(id => allowed.has(id) && listeners.has(id)).slice(0, 100);
    for (const id of ids) queued.delete(id);
    if (ids.length) socket.send(JSON.stringify({ op: 8, d: { guild_id: guildId, user_ids: ids, presences: true } }));
    if (queued.size) requestTimer = setTimeout(sendRequests, 1200);
  }
  function updatePresence(presence) {
    const id = presence?.user?.id;
    if (!validId.test(id || "") || !allowed.has(id) || !listeners.has(id)) return;
    if (!["online", "idle", "dnd", "offline"].includes(presence.status)) return;
    const previous = presences.get(id);
    presences.set(id, {
      status: presence.status,
      statusText: getCustomStatus(presence) ?? previous?.statusText ?? null,
      activity: getDiscordActivity(presence)
    });
    const user = identities.get(id), changed = presence.user;
    if (user && ((typeof changed.username === "string" && changed.username !== user.username) ||
      (Object.hasOwn(changed, "avatar") && changed.avatar !== user.avatarHash) ||
      (Object.hasOwn(changed, "global_name") && changed.global_name !== user.globalName))) void refreshIdentity(id);
    publish(id);
  }
  function resetGateway() {
    ready = false;
    clearInterval(heartbeat);
    clearTimeout(requestTimer);
    requestTimer = null;
    presences.clear();
    for (const id of listeners.keys()) broadcast(id, "unavailable", { reason: "gateway" });
  }
  function connect() {
    if (stopped) return;
    const current = new WebSocketImpl(gatewayUrl);
    socket = current;
    current.addEventListener("message", event => {
      if (current !== socket || stopped) return;
      try {
        const message = JSON.parse(event.data);
        if (message.s != null) sequence = message.s;
        if (message.op === 10) {
          acknowledged = true;
          heartbeat = setInterval(() => {
            if (!acknowledged) { current.close(); return; }
            acknowledged = false;
            current.send(JSON.stringify({ op: 1, d: sequence }));
          }, message.d.heartbeat_interval);
          current.send(JSON.stringify({ op: 2, d: {
            token, intents: (1 << 0) | (1 << 1) | (1 << 8),
            properties: { os: process.platform, browser: "iwtxz-live", device: "iwtxz-live" }
          } }));
        } else if (message.op === 11) acknowledged = true;
        else if (message.op === 1) current.send(JSON.stringify({ op: 1, d: sequence }));
        else if (message.op === 7 || message.op === 9) current.close();
        else if (message.t === "GUILD_CREATE" && message.d?.id === guildId && !message.d.unavailable) {
          ready = true;
          retryMs = 2000;
          enqueue(listeners.keys());
          (message.d.presences || []).forEach(updatePresence);
        } else if (message.t === "PRESENCE_UPDATE" && message.d?.guild_id === guildId) updatePresence(message.d);
        else if (message.t === "GUILD_DELETE" && message.d?.id === guildId) current.close();
        else if (message.t === "GUILD_MEMBERS_CHUNK" && message.d?.guild_id === guildId) {
          const online = new Set((message.d.presences || []).map(p => p.user?.id));
          (message.d.presences || []).forEach(updatePresence);
          for (const member of message.d.members || []) if (!online.has(member.user?.id)) updatePresence({ user: member.user, status: "offline", activities: [] });
        } else if (["GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE"].includes(message.t) && message.d?.guild_id === guildId) {
          void refreshIdentity(message.d.user?.id);
          enqueue([message.d.user?.id]);
        }
        else if (message.t === "GUILD_MEMBER_REMOVE" && message.d?.guild_id === guildId) {
          const id = message.d.user?.id;
          invalidate(id); broadcast(id, "unavailable", { reason: "membership" });
        }
      } catch (error) { logger.warn(`Discord gateway event rejected: ${error.message}`); current.close(); }
    });
    current.addEventListener("error", () => logger.warn("Discord gateway connection failed."));
    current.addEventListener("close", event => {
      if (current !== socket || stopped) return;
      resetGateway();
      logger.warn(`Discord gateway closed (${event.code}).`);
      reconnect = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 60000);
    });
  }
  async function refreshAllowed() {
    try {
      const result = await discover();
      if (result.guildId !== guildId) throw new Error("Unexpected Discord guild.");
      const next = new Set(result.profiles.map(profile => profile.userId).filter(id => validId.test(id)));
      allowed.clear();
      for (const id of next) allowed.add(id);
      allowedAt = Date.now();
      for (const [id, responses] of listeners) if (!allowed.has(id)) {
        invalidate(id); queued.delete(id);
        for (const response of responses) { write(response, "unavailable", { reason: "disabled" }); response.end(); }
        listeners.delete(id);
      }
    } catch (error) {
      logger.warn(`Published Discord profiles unavailable: ${error.message}`);
      if (Date.now() - allowedAt > 180000) {
        allowed.clear();
        allowedAt = 0;
        for (const [id, responses] of listeners) {
          for (const response of responses) { write(response, "unavailable", { reason: "discovery" }); response.end(); }
          invalidate(id);
        }
        listeners.clear();
      }
    }
  }
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/discord/health") {
      response.writeHead(ready && allowedAt ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ready: ready && Boolean(allowedAt) }));
      return;
    }
    const match = /^\/discord\/stream\/(\d{17,20})$/.exec(path), id = match?.[1];
    if (!id || !allowed.has(id)) { response.writeHead(404).end(); return; }
    const count = [...listeners.values()].reduce((total, items) => total + items.size, 0);
    if (count >= 500 || (listeners.get(id)?.size || 0) >= 50) { response.writeHead(503).end(); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "Connection": "keep-alive" });
    response.write("retry: 5000\n: connected\n\n");
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(response);
    response.on("close", () => {
      const group = listeners.get(id);
      group?.delete(response);
      if (group && !group.size) { listeners.delete(id); invalidate(id); queued.delete(id); }
    });
    if (!ready) write(response, "unavailable", { reason: "gateway" });
    void refreshIdentity(id);
    if (presences.has(id)) publish(id);
    else enqueue([id]);
  });
  return {
    async start(port = 8788, host = "127.0.0.1") {
      await refreshAllowed();
      connect();
      discoveryTimer = setInterval(refreshAllowed, 60000);
      identityTimer = setInterval(() => { for (const id of listeners.keys()) void refreshIdentity(id); }, 300000);
      keepalive = setInterval(() => { for (const group of listeners.values()) for (const response of group) response.write(": keepalive\n\n"); }, 20000);
      await new Promise((resolveListen, reject) => server.once("error", reject).listen(port, host, resolveListen));
      return server.address();
    },
    async stop() {
      stopped = true;
      clearInterval(discoveryTimer); clearInterval(identityTimer); clearInterval(keepalive); clearInterval(heartbeat);
      clearTimeout(reconnect); clearTimeout(requestTimer);
      if (socket) socket.close();
      for (const group of listeners.values()) for (const response of group) response.end();
      await new Promise(resolveClose => server.close(resolveClose));
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const live = createDiscordLive({ token: process.env.DISCORD_BOT_TOKEN?.replace(/^Bot\s+/i, "").trim(), guildId: process.env.DISCORD_GUILD_ID });
  await live.start(Number(process.env.PORT || 8788));
  console.log("Discord live service listening on localhost.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void live.stop().then(() => process.exit(0)); });
}
