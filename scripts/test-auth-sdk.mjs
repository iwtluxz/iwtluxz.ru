import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const sdk = await readFile(new URL("../vendor/supabase-2.102.0.min.js", import.meta.url), "utf8");
const adapter = await readFile(new URL("../backend-client.js", import.meta.url), "utf8");
const user = { id: "967385a2-8f95-4499-97b1-8ff92d973cfe", email: "alice@accounts.iwtxz.ru", user_metadata: { username: "alice" } };
const sessionKey = "iwtxz-fixture-auth-v2";
const session = (token, expiresAt = Math.floor(Date.now() / 1000) + 3600) => ({ access_token: token, refresh_token: `${token}-refresh`, expires_at: expiresAt, expires_in: 3600, token_type: "bearer", user });
const credentials = { method: "POST", body: JSON.stringify({ username: "alice", password: "Test-password-123!" }) };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Node 20/22 do not expose Web Locks. Keep the same exclusive-lock behavior
// there; newer Node versions exercise the native LockManager.
function testLocks() {
  const queues = new Map();
  return { request(name, options, callback) {
    const previous = queues.get(name);
    if (options.ifAvailable && previous) return Promise.resolve().then(() => callback(null));
    const release = deferred();
    queues.set(name, release.promise);
    return (async () => {
      try {
        if (previous) await previous;
        if (options.signal?.aborted) throw options.signal.reason;
        return await callback({ name });
      } finally {
        release.resolve();
        if (queues.get(name) === release.promise) queues.delete(name);
      }
    })();
  } };
}

function load({ expired = false, stallPassword = false, stallProfile = false, locks, sharedStorage } = {}) {
  const storage = sharedStorage || new Map(expired ? [[sessionKey, JSON.stringify(session("expired", 1))]] : []);
  const state = { calls: [], events: [], clients: [], logs: [], refreshStarted: deferred(), releaseRefresh: deferred(), stallPassword, stallProfile };
  const listeners = new Map();
  const window = {
    IWTXZ_BACKEND_CONFIG: { provider: "supabase", url: "https://fixture.supabase.co", publishableKey: "sb_publishable_fixture" },
    location: { origin: "https://example.test", href: "https://example.test/" },
    navigator: { locks: locks || globalThis.navigator?.locks || testLocks() }, crypto: webcrypto,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    addEventListener(type, callback) { const set = listeners.get(type) || new Set(); set.add(callback); listeners.set(type, set); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatchEvent(event) { state.events.push(event); },
    async fetch(input, options) {
      const url = new URL(input);
      state.calls.push(url.pathname + url.search);
      if (url.searchParams.get("grant_type") === "refresh_token") {
        state.refreshStarted.resolve();
        // Deliberately ignore abort to simulate a late transport response.
        await state.releaseRefresh.promise;
        return Response.json(session("late-expired-refresh"));
      }
      if (url.searchParams.get("grant_type") === "password") {
        if (state.stallPassword) return new Promise(() => {});
        return Response.json(session("fresh-login"));
      }
      if (url.pathname === "/auth/v1/user") return Response.json(user);
      if (url.pathname === "/rest/v1/profile_accounts") return Response.json({ username: "alice" });
      if (url.pathname === "/rest/v1/rpc/builder_get_profile") {
        if (state.stallProfile) return new Promise(() => {});
        return Response.json({ id: "alice", owner: "alice", title: "Saved profile", nickname: "Alice" });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
  };
  const context = vm.createContext({ window, document: { visibilityState: "hidden" }, navigator: window.navigator,
    URL, URLSearchParams, Headers, Request, Response, Blob, Uint8Array, TextEncoder, TextDecoder, AbortController,
    crypto: webcrypto, console: { ...console, warn: (...args) => state.logs.push(args), error: (...args) => state.logs.push(args) }, atob, btoa, setTimeout: (fn, ms) => setTimeout(fn, ms >= 5000 ? ms / 100 : ms),
    clearTimeout, setInterval, clearInterval, queueMicrotask, WebSocket: globalThis.WebSocket,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  vm.runInContext(sdk, context);
  window.supabase = { createClient(...args) {
    const client = context.supabase.createClient(...args);
    state.clients.push(client);
    return client;
  } };
  vm.runInContext(adapter, context);
  return { api: window.IwtxzBackend, state, storage, close() { for (const client of state.clients) void client.auth.stopAutoRefresh(); } };
}

test("real SDK: login bypasses expired-session recovery and loads the saved cabinet", { timeout: 3000 }, async () => {
  const { api, state, storage, close } = load({ expired: true });
  try {
    assert.equal((await api.request("/api/builder/auth/login", credentials)).user.username, "alice");
    assert.equal((await api.request("/api/builder/sites/list")).sites[0].title, "Saved profile");
    assert.equal(state.calls.some(call => call.includes("grant_type=refresh_token")), false);
    assert.equal(JSON.parse(storage.get(sessionKey)).access_token, "fresh-login");
  } finally { close(); }
});

test("real SDK: cancelling a stalled bootstrap releases its auth lock and protects the next session", { timeout: 3000 }, async () => {
  const { api, state, storage, close } = load({ expired: true });
  const controller = new AbortController();
  try {
    const bootstrap = api.request("/api/builder/auth/me", { signal: controller.signal });
    const rejected = assert.rejects(bootstrap, { code: "request_cancelled" });
    await state.refreshStarted.promise;
    controller.abort();
    await rejected;
    assert.equal((await api.request("/api/builder/auth/login", credentials)).user.username, "alice");
    state.releaseRefresh.resolve();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(JSON.parse(storage.get(sessionKey)).access_token, "fresh-login");
    assert.equal((await api.request("/api/builder/sites/list")).sites[0].nickname, "Alice");
  } finally { state.releaseRefresh.resolve(); close(); }
});

test("real SDK: a stalled sign-in fails and a second attempt succeeds", { timeout: 3000 }, async () => {
  const { api, state, close } = load({ stallPassword: true });
  try {
    await assert.rejects(api.request("/api/builder/auth/login", credentials), { code: "request_timeout" });
    state.stallPassword = false;
    assert.equal((await api.request("/api/builder/auth/login", credentials)).user.username, "alice");
  } finally { close(); }
});

test("real SDK: a stalled cabinet read fails after successful login and can be retried", { timeout: 3000 }, async () => {
  const { api, state, close } = load({ stallProfile: true });
  try {
    await api.request("/api/builder/auth/login", credentials);
    await assert.rejects(api.request("/api/builder/sites/list"), { code: "request_timeout" });
    state.stallProfile = false;
    assert.equal((await api.request("/api/builder/sites/list")).sites[0].title, "Saved profile");
  } finally { close(); }
});

function sessionWithScope(scope) {
  const token = `qa.${Buffer.from(JSON.stringify({ session_id: scope })).toString("base64url")}.fixture`;
  return session(token);
}

test("real SDK: a frozen tab's session lock cannot block a new login or its cabinet", { timeout: 3000 }, async () => {
  const heldName = `lock:${sessionKey}:session:old-session`;
  const held = deferred();
  const acquired = [];
  const available = testLocks();
  const locks = { request(name, options, action) {
    acquired.push(name);
    if (name !== heldName) return available.request(name, options, action);
    held.resolve();
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  } };
  const sharedStorage = new Map([[sessionKey, JSON.stringify(sessionWithScope("old-session"))], ["sb-fixture-auth-token", JSON.stringify(session("legacy-token"))]]);
  const { api, state, storage, close } = load({ locks, sharedStorage });
  const controller = new AbortController();
  try {
    const bootstrap = api.request("/api/builder/auth/me", { signal: controller.signal });
    const cancelled = assert.rejects(bootstrap, { code: "request_cancelled" });
    await held.promise;
    controller.abort();
    await cancelled;
    assert.equal((await api.request("/api/builder/auth/login", credentials)).user.username, "alice");
    assert.equal((await api.request("/api/builder/sites/list")).sites[0].nickname, "Alice");
    assert.equal(acquired.filter(name => name === heldName).length, 1);
    assert.ok(acquired.some(name => name.startsWith(`lock:${sessionKey}:session:`) && name !== heldName));
    assert.equal(JSON.parse(storage.get("sb-fixture-auth-token")).access_token, "legacy-token");
    assert.equal(JSON.parse(storage.get(sessionKey)).access_token, "fresh-login");
    assert.equal(state.logs.flat().some(value => value instanceof Error), false);
  } finally { close(); }
});

test("real SDK: tabs resuming the same session use the same refresh lock", { timeout: 3000 }, async () => {
  const acquired = [];
  const available = testLocks();
  const locks = { request(name, options, action) { acquired.push(name); return available.request(name, options, action); } };
  const sharedStorage = new Map([[sessionKey, JSON.stringify(sessionWithScope("shared-session"))]]);
  const first = load({ locks, sharedStorage });
  const second = load({ locks, sharedStorage });
  try {
    assert.equal((await first.api.request("/api/builder/auth/me")).user.username, "alice");
    assert.equal((await second.api.request("/api/builder/auth/me")).user.username, "alice");
    assert.ok(acquired.length >= 2);
    assert.ok(acquired.every(name => name === `lock:${sessionKey}:session:shared-session`));
  } finally { first.close(); second.close(); }
});
