import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetchDiscordIdentity, fetchDiscordPresences, getAvatarUrl, getCustomStatus, getDiscordBadges, getDiscordActivity } from "./lib/discord-profile.mjs";
import { checkDiscordGuildAvailability, discoverDiscordProfiles, removeUnusedDiscordSnapshots, syncProfile } from "./sync-discord-avatars.mjs";

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
      ? { nick: "Дианка", user: { id: userId } }
      : { id: userId, username: "new_username", global_name: "Global", avatar: null });
  });
  const identity = await fetchDiscordIdentity(userId, "Bot test-token", guildId);
  assert.equal(identity.displayName, "Дианка");
  assert.equal(identity.username, "new_username");
});

test("public badges use documented flags and this guild's actual boost, never Nitro", () => {
  const flags = (1 << 6) | (1 << 17) | (1 << 19) | (1 << 22);
  assert.deepEqual(getDiscordBadges(flags, null).map(badge => badge.id), ["house-bravery", "early-verified-developer"]);
  assert.deepEqual(getDiscordBadges(0, { premium_since: "2026-01-01T00:00:00Z" }), [{ id: "server-booster", label: "Server Booster" }]);
  assert.deepEqual(getDiscordBadges(-1, { premium_type: 2 }), []);
  assert.deepEqual(getDiscordBadges("64", { premium_since: "bad date" }), []);
});

test("strict member checks never fetch a nonmember's account details", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(url);
    assert.ok(url.includes("/guilds/"));
    return Response.json({ code: 10007 }, { status: 404 });
  });
  const identity = await fetchDiscordIdentity(userId, "test-token", guildId, { requireMembership: true });
  assert.deepEqual(identity, { id: userId, guildId, member: false, badges: [] });
  assert.equal(calls.length, 1);
});

test("a denied member check is unavailable rather than a fabricated membership", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  await assert.rejects(fetchDiscordIdentity(userId, "test-token", guildId, { requireMembership: true }), error => error.status === 403);
});

test("unknown guild and unidentified 404 errors never masquerade as a nonmember", async t => {
  for (const code of [10004, null]) {
    const mockedFetch = t.mock.method(globalThis, "fetch", async () => Response.json({ code, message: "Do not retain this body" }, { status: 404 }));
    await assert.rejects(fetchDiscordIdentity(userId, "test-token", guildId, { requireMembership: true }), error => error.status === 404 && error.discordCode === code && !error.message.includes("retain"));
    mockedFetch.mock.restore();
  }
});

test("guild availability probe reports the target server without leaking response bodies", async t => {
  const logs = [];
  t.mock.method(console, "log", text => logs.push(text));
  t.mock.method(console, "warn", text => logs.push(text));
  let available = true;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `https://discord.com/api/v10/guilds/${guildId}`);
    assert.equal(options.headers.authorization, "Bot private-test-token");
    return available ? Response.json({ id: guildId, name: "Never log arbitrary guild data" }) : Response.json({ code: 10004, message: "Never log arbitrary error body" }, { status: 404 });
  });
  assert.equal(await checkDiscordGuildAvailability("private-test-token", guildId), true);
  available = false;
  assert.equal(await checkDiscordGuildAvailability("private-test-token", guildId), false);
  assert.match(logs[0], /available to the bot/);
  assert.match(logs[1], /unavailable.*Discord 10004.*bot must belong/);
  assert.ok(logs.every(text => !text.includes("private-test-token") && !text.includes("Never log")));
});

test("activities omit custom statuses and private activity metadata", () => {
  const presence = { status: "online", activities: [{ type: 4, state: "hello" }, { type: 2, name: "Spotify", details: "Track", state: "Artist", party: { id: "private" }, secrets: { join: "private" } }] };
  assert.deepEqual(getDiscordActivity(presence), { type: 2, name: "Spotify", details: "Track", state: "Artist" });
  assert.equal(getDiscordActivity({ ...presence, status: "offline" }), null);
});

test("a missing guild membership falls back to the global name", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => url.includes("/guilds/")
    ? Response.json({ code: 10007 }, { status: 404 })
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

test("Gateway batches more than 100 IDs using one connection and distinct nonces", async () => {
  const ids = Array.from({ length: 205 }, (_, index) => String(BigInt(userId) + BigInt(index)));
  class BatchedSocket extends FakeSocket {
    send(text) {
      const packet = JSON.parse(text);
      this.sent.push(packet);
      if (packet.op === 2) this.message({ op: 0, t: "READY", s: 1, d: {} });
      if (packet.op === 8) {
        assert.ok(packet.d.user_ids.length <= 100);
        this.message({ op: 0, t: "GUILD_MEMBERS_CHUNK", s: 2, d: {
          guild_id: guildId, nonce: packet.d.nonce, chunk_index: 0, chunk_count: 1,
          members: packet.d.user_ids.map(id => ({ user: { id } })), presences: []
        } });
      }
    }
  }
  const presences = await fetchDiscordPresences("test-token", guildId, ids, { WebSocketImpl: BatchedSocket });
  assert.equal(presences.size, 205);
  assert.equal(FakeSocket.instance.sent.filter(packet => packet.op === 2).length, 1);
  const requests = FakeSocket.instance.sent.filter(packet => packet.op === 8);
  assert.deepEqual(requests.map(packet => packet.d.user_ids.length), [100, 100, 5]);
  assert.equal(new Set(requests.map(packet => packet.d.nonce)).size, 3);
});

async function tempDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "iwtxz-discord-v2-"));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("discovery paginates complete published opt-ins and deduplicates Discord IDs", async t => {
  const root = await tempDirectory(t);
  await writeFile(join(root, "backend-config.js"), `window.IWTXZ_BACKEND_CONFIG={provider:'supabase',url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture',discordGuildId:'${guildId}'};`);
  const rows = Array.from({ length: 1001 }, (_, index) => ({ username: `user_${String(index).padStart(4, "0")}`, settings: { discordSync: true, discordUserId: String(BigInt(userId) + BigInt(index % 2)) } }));
  rows.push({ username: "opt_out", settings: { discordSync: false, discordUserId: userId } }, { username: "bad_id", settings: { discordSync: true, discordUserId: "../private" } });
  const offsets = [];
  const result = await discoverDiscordProfiles({ root, fetch: async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://fixture.supabase.co");
    assert.equal(url.searchParams.get("select"), "username,settings");
    assert.equal(options.headers.apikey, "sb_publishable_fixture");
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    return Response.json(rows.slice(offset, offset + 1000));
  } });
  assert.deepEqual(offsets, [0, 1000]);
  assert.equal(result.guildId, guildId);
  assert.deepEqual(result.profiles.map(profile => profile.userId), [userId, String(BigInt(userId) + 1n)]);
  assert.ok(result.profiles.every(profile => profile.dynamic === true && profile.outputs.length === 0));
});

test("a failed discovery page aborts instead of returning a partial cleanup list", async t => {
  const root = await tempDirectory(t);
  await writeFile(join(root, "backend-config.js"), "window.IWTXZ_BACKEND_CONFIG={provider:'supabase',url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'};");
  const rows = Array.from({ length: 1000 }, (_, index) => ({ username: `user_${index}`, settings: { discordSync: true, discordUserId: userId } }));
  await assert.rejects(discoverDiscordProfiles({ root, fetch: async input => new URL(input).searchParams.get("offset") === "0" ? Response.json(rows) : new Response(null, { status: 503 }) }), /existing snapshots preserved/);
});

test("nonmembers lose stale Discord details and only managed unused snapshots are removed", async t => {
  const root = await tempDirectory(t);
  const { mkdir } = await import("node:fs/promises");
  const directory = join(root, "data/discord-profiles");
  await mkdir(directory, { recursive: true });
  const dynamicId = "123456789012345678";
  const snapshotPath = join(directory, `${dynamicId}.json`);
  await writeFile(snapshotPath, JSON.stringify({ id: dynamicId, member: true, username: "old", avatarUrl: "old", badges: [{ id: "staff" }], statusText: "old", managedBy: "iwtxz-public-discord-sync" }));
  await syncProfile({ name: "new_user", userId: dynamicId, snapshotPath, dynamic: true, outputs: [] }, "unused-token", guildId, new Map(), { identity: { id: dynamicId, member: false, badges: [] } });
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert.equal(snapshot.member, false);
  assert.equal(snapshot.guildId, guildId);
  assert.deepEqual(snapshot.badges, []);
  assert.equal(snapshot.username, undefined);
  assert.equal(snapshot.avatarUrl, undefined);
  assert.equal(snapshot.statusText, null);
  const handWritten = join(directory, "223456789012345678.json");
  const legacyFile = join(directory, `${userId}.json`);
  await writeFile(handWritten, JSON.stringify({ id: "223456789012345678", username: "manual" }));
  await writeFile(legacyFile, JSON.stringify({ id: userId, managedBy: "iwtxz-public-discord-sync" }));
  assert.equal(await removeUnusedDiscordSnapshots([], { root }), 1);
  assert.equal(await readFile(handWritten, "utf8"), JSON.stringify({ id: "223456789012345678", username: "manual" }));
  assert.ok(await readFile(legacyFile, "utf8"));
  await assert.rejects(readFile(snapshotPath), error => error.code === "ENOENT");
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
