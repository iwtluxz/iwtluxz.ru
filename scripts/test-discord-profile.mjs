import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetchDiscordIdentity, fetchDiscordPresences, getAvatarUrl, getCustomStatus } from "./lib/discord-profile.mjs";
import { syncProfile } from "./sync-discord-avatars.mjs";

const userId = "484816707798564894";
const guildId = "123456789012345678";

test("animated and default avatars use Discord's correct URLs", () => {
  assert.match(getAvatarUrl({ id: userId, avatar: "a_example" }), /a_example\.gif\?size=256$/);
  assert.match(getAvatarUrl({ id: userId, avatar: "example" }), /example\.png\?size=256$/);
  assert.equal(getAvatarUrl({ id: userId, avatar: null, discriminator: "1337" }), "https://cdn.discordapp.com/embed/avatars/2.png");
  assert.equal(getAvatarUrl({ id: userId, avatar: null, discriminator: "0" }), `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) >> 22n) % 6n}.png`);
});

test("identity prefers the guild nickname and keeps username separate", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.headers.authorization, "Bot test-token");
    return Response.json(url.includes("/guilds/")
      ? { nick: "Дианка" }
      : { id: userId, username: "new_username", global_name: "Global", avatar: null });
  });
  const identity = await fetchDiscordIdentity(userId, "Bot test-token", guildId);
  assert.equal(identity.displayName, "Дианка");
  assert.equal(identity.username, "new_username");
});

test("a missing guild membership falls back to the global name", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => url.includes("/guilds/")
    ? new Response(null, { status: 404 })
    : Response.json({ id: userId, username: "user", global_name: "Global", avatar: null }));
  assert.equal((await fetchDiscordIdentity(userId, "test-token", guildId)).displayName, "Global");
});

test("unknown and offline statuses preserve text; an explicitly empty status clears it", () => {
  assert.equal(getCustomStatus(null), null);
  assert.equal(getCustomStatus({ status: "offline", activities: [] }), null);
  assert.equal(getCustomStatus({ status: "online", activities: [] }), "");
  assert.equal(getCustomStatus({ status: "idle", activities: [{ type: 4, state: "Привет\nмир" }] }), "Привет\nмир");
  assert.equal(getCustomStatus({ status: "online", activities: [{ type: 2, name: "Spotify" }] }), "");
});

class FakeSocket extends EventTarget {
  readyState = 1;
  sent = [];
  constructor() {
    super();
    FakeSocket.instance = this;
    queueMicrotask(() => this.message({ op: 10, d: { heartbeat_interval: 45000 } }));
  }
  message(payload) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
  send(text) {
    const packet = JSON.parse(text);
    this.sent.push(packet);
    if (packet.op === 2) {
      this.message({ op: 0, t: "READY", s: 1, d: {} });
    } else if (packet.op === 8) {
      assert.deepEqual(packet.d.user_ids, [userId, "958595335037542450"]);
      this.message({ op: 0, t: "GUILD_CREATE", s: 2, d: { id: guildId, presences: [] } });
      this.message({ op: 1 });
      this.message({ op: 0, t: "GUILD_MEMBERS_CHUNK", s: 3, d: {
        guild_id: guildId, nonce: packet.d.nonce, chunk_index: 0, chunk_count: 1,
        members: [{ user: { id: userId } }, { user: { id: "958595335037542450" } }],
        presences: [{ user: { id: userId }, status: "online", activities: [{ type: 4, state: "Новое описание" }] }]
      } });
    }
  }
  close() { this.readyState = 3; }
}

test("Gateway handles a burst of READY and chunk events and heartbeats with the sequence", async () => {
  const presences = await fetchDiscordPresences("test-token", guildId, [userId, "958595335037542450"], { WebSocketImpl: FakeSocket });
  assert.equal(getCustomStatus(presences.get(userId)), "Новое описание");
  assert.equal(presences.get("958595335037542450").status, "offline");
  assert.equal(FakeSocket.instance.sent.find((entry) => entry.op === 1).d, 2);
  assert.equal(FakeSocket.instance.sent.filter((entry) => entry.op === 2).length, 1);
  assert.equal(FakeSocket.instance.readyState, 3);
});

test("disabled Presence Intent produces an actionable error", async () => {
  class DeniedSocket extends FakeSocket {
    send() {
      const event = new Event("close");
      event.code = 4014;
      this.dispatchEvent(event);
    }
  }
  await assert.rejects(fetchDiscordPresences("test-token", guildId, [userId], { WebSocketImpl: DeniedSocket }), /enable Presence Intent/);
});

test("without a guild ID, no Gateway connection is opened", async () => {
  class UnexpectedSocket { constructor() { throw new Error("Must not connect"); } }
  assert.equal((await fetchDiscordPresences("test-token", "", [userId], { WebSocketImpl: UnexpectedSocket })).size, 0);
});

test("sync updates text despite a bad CDN response and safely clears a removed status", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "iwtlu-discord-test-"));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  });
  const snapshotPath = join(dir, "profile.json");
  const avatarPath = join(dir, "avatar.png");
  const htmlPath = join(dir, "profile.html");
  await writeFile(avatarPath, "existing-image");
  await writeFile(htmlPath, '<span class="discord-card-name" data-discord-display-name>old</span><span data-discord-status-text>old status</span>');
  t.mock.method(globalThis, "fetch", async (url) => url.startsWith("https://cdn.discordapp.com")
    ? new Response("error page", { status: 503 })
    : Response.json({ id: userId, username: "new_user", global_name: '$1 & <name>', avatar: "a_example" }));
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const profile = { name: "test", userId, outputs: [avatarPath], snapshotPath, htmlPath };
  await syncProfile(profile, "test-token", "", new Map([[userId, { status: "online", activities: [{ type: 4, state: '$& <script>\nПривет' }] }]]));
  let snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert.equal(snapshot.displayName, '$1 & <name>');
  assert.equal(snapshot.statusText, '$& <script>\nПривет');
  assert.equal(await readFile(avatarPath, "utf8"), "existing-image");
  assert.match(await readFile(htmlPath, "utf8"), /\$1 &amp; &lt;name&gt;/);
  assert.match(await readFile(htmlPath, "utf8"), /\$&amp; &lt;script&gt;/);

  await syncProfile(profile, "test-token", "", new Map());
  assert.equal(JSON.parse(await readFile(snapshotPath, "utf8")).statusText, snapshot.statusText);
  await syncProfile(profile, "test-token", "", new Map([[userId, { status: "online", activities: [] }]]));
  snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert.equal(snapshot.statusText, "");
  assert.match(await readFile(htmlPath, "utf8"), /data-discord-status-text><\/span>/);
  const content = await readFile(snapshotPath, "utf8");
  await syncProfile(profile, "test-token", "", new Map([[userId, { status: "online", activities: [] }]]));
  assert.equal(await readFile(snapshotPath, "utf8"), content, "unchanged profiles must not create repeated commits");
});
