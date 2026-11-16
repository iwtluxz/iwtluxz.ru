import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordLive } from "./discord-live.mjs";

const guildId = "123456789012345678", userId = "484816707798564894";
class Gateway {
  static current;
  constructor() {
    Gateway.current = this;
    this.readyState = 1;
    this.handlers = new Map();
    setImmediate(() => {
      this.emit("message", { op: 10, d: { heartbeat_interval: 60000 } });
      this.emit("message", { t: "GUILD_CREATE", d: { id: guildId } });
    });
  }
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  emit(type, data) { this.handlers.get(type)?.(type === "message" ? { data: JSON.stringify(data) } : data); }
  send(raw) {
    const message = JSON.parse(raw);
    if (message.op === 8) setImmediate(() => this.emit("message", {
      t: "GUILD_MEMBERS_CHUNK", d: { guild_id: guildId, members: [{ user: { id: userId } }],
        presences: [{ user: { id: userId }, status: "idle", activities: [] }] }
    }));
  }
  close() { this.readyState = 3; this.emit("close", { code: 1000 }); }
}

test("live Discord only streams opted-in members and pushes status changes", async () => {
  const service = createDiscordLive({
    token: "test-token", guildId, WebSocketImpl: Gateway,
    discover: async () => ({ guildId, profiles: [{ userId }] }),
    identity: async id => ({ id, guildId, member: true, username: "alice" }),
    logger: { warn() {} }
  });
  const address = await service.start(0);
  const base = `http://127.0.0.1:${address.port}`;
  const abort = new AbortController();
  try {
    assert.equal((await fetch(`${base}/discord/stream/999999999999999999`)).status, 404);
    const response = await fetch(`${base}/discord/stream/${userId}`, { signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let received = "";
    async function until(text) {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("Stream ended before update");
        received += decoder.decode(value);
      }
    }
    await until('"status":"idle"');
    Gateway.current.emit("message", { t: "PRESENCE_UPDATE", d: {
      guild_id: guildId, user: { id: userId }, status: "dnd", activities: [{ type: 4, state: "Занят" }]
    } });
    await until('"status":"dnd"');
    assert.match(received, /Занят/);
    assert.doesNotMatch(received, /test-token/);
    Gateway.current.emit("message", { t: "GUILD_MEMBER_REMOVE", d: { guild_id: guildId, user: { id: userId } } });
    await until('"reason":"membership"');
    await reader.cancel();
  } finally { abort.abort(); await service.stop(); }
});

test("live Discord refuses invalid configuration", () => {
  assert.throws(() => createDiscordLive({ token: "", guildId, WebSocketImpl: Gateway }), /required/);
  assert.throws(() => createDiscordLive({ token: "test", guildId: "invalid", WebSocketImpl: Gateway }), /required/);
});
