import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "backend-client.js"), "utf8");
const linksSource = await readFile(resolve(root, "profile-links.js"), "utf8");
const userId = "967385a2-8f95-4499-97b1-8ff92d973cfe";
const project = "https://fixture.supabase.co";
const goodConfig = { provider: "supabase", url: project, publishableKey: "sb_publishable_fixture", accountEmailDomain: "accounts.iwtxz.ru", bucket: "profile-assets" };

function authError(code, status = 400) {
  return { name: "AuthApiError", code, status, message: "SDK error" };
}

function load(overrides = {}) {
  const state = {
    active: true, username: "alice", password: "Initial-test-password-1!", createCalls: 0,
    calls: [], uploads: [], events: [], published: new Map(), ...overrides
  };
  const accountUser = () => ({ id: userId, email: `${state.username}@accounts.iwtxz.ru`, user_metadata: { username: state.username } });
  const currentSession = () => ({ user: accountUser(), access_token: "SDK-managed-session-token" });
  const client = {
    auth: {
      onAuthStateChange(callback) { state.authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { if (state.hangSession) return new Promise(resolve => { state.resolveSession = resolve; }); return { data: { session: state.active ? currentSession() : null }, error: state.sessionError || null }; },
      async getUser() { state.calls.push({ method: "getUser" }); return state.getUserError ? { data: { user: null }, error: state.getUserError } : { data: { user: state.active ? accountUser() : null }, error: null }; },
      async signUp(credentials) {
        state.calls.push({ method: "signUp", credentials });
        if (state.signupError) return { data: {}, error: state.signupError };
        state.username = credentials.options.data.username;
        state.password = credentials.password;
        state.active = !state.confirmEmail;
        return { data: { user: accountUser(), session: state.active ? currentSession() : null }, error: null };
      },
      async signInWithPassword(credentials) {
        state.calls.push({ method: "signInWithPassword", credentials });
        if (state.loginError || credentials.password !== state.password) return { data: {}, error: state.loginError || authError("invalid_credentials", 400) };
        state.active = true;
        return { data: { user: accountUser(), session: currentSession() }, error: null };
      },
      async updateUser(credentials) {
        state.calls.push({ method: "updateUser", credentials });
        // Match the observed hosted API: updateUser does not verify current_password.
        if (state.updateError) return { data: {}, error: state.updateError };
        state.password = credentials.password;
        return { data: { user: accountUser() }, error: null };
      },
      async signOut(options) {
        state.calls.push({ method: "signOut", options });
        if (options.scope !== "others") state.active = false;
        return { error: null };
      }
    },
    from(table) {
      let columns, filter;
      return {
        select(value) { columns = value; return this; },
        eq(key, value) { filter = [key, value]; return this; },
        async maybeSingle() {
          state.calls.push({ method: "query", table, columns, filter });
          if (state.queryError) return { data: null, error: state.queryError };
          if (table === "profile_accounts") return { data: state.missingAccount ? null : { username: state.username }, error: null };
          assert.equal(table, "profile_published");
          return { data: state.published.get(filter[1]) || null, error: null };
        }
      };
    },
    async rpc(name, input) {
      state.calls.push({ method: "rpc", name, input });
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (name === "builder_capabilities") return state.oldCustomizationServer
        ? { data: null, error: { code: "PGRST202" } }
        : { data: { profileSettingsVersion: 2, customFonts: true }, error: null };
      if (name === "builder_get_profile") return { data: state.draft || { id: state.username, owner: state.username, nickname: state.username }, error: null };
      if (name === "builder_save_profile") { state.draft = structuredClone(input.input); return { data: state.draft, error: null }; }
      if (name === "builder_publish_profile") {
        const publishedAt = Date.now();
        state.published.set(state.username, { username: state.username, settings: structuredClone(state.draft), published_at: new Date(publishedAt).toISOString() });
        return { data: { ok: true, slug: state.username, url: `/profile.html?u=${state.username}`, publishedAt }, error: null };
      }
      if (name === "builder_delete_profile") { state.draft = null; state.published.delete(state.username); return { data: { ok: true }, error: null }; }
      throw new Error("Unknown RPC fixture");
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, bytes, options) { state.uploads.push({ bucket, path, bytes: Buffer.from(bytes), options }); return { data: { path }, error: state.storageError || null }; },
          getPublicUrl(path) { return { data: { publicUrl: `${project}/storage/v1/object/public/${bucket}/${path}` } }; }
        };
      }
    }
  };
  const window = {
    IWTXZ_BACKEND_CONFIG: state.config === undefined ? { ...goodConfig } : state.config,
    location: { origin: "https://iwtxz.ru" },
    crypto: webcrypto,
    navigator: state.navigator,
    fetch: (...args) => state.fetch(...args),
    dispatchEvent(event) { state.events.push(event); },
    supabase: { createClient(url, key, options) {
      state.createCalls += 1;
      assert.equal(url, project);
      assert.equal(key, goodConfig.publishableKey);
      if (options.auth.storageKey?.startsWith("iwtxz-password-verification-")) {
        state.verificationOptions ??= [];
        state.verificationOptions.push(options);
        return { auth: {
          async signInWithPassword(credentials) {
            state.calls.push({ method: "verifyPassword", credentials });
            if (credentials.password !== state.password) return { data: {}, error: authError("invalid_credentials", 400) };
            if (state.hangVerifier) return new Promise(resolve => { state.resolveVerifier = resolve; });
            state.verifierActive = true;
            return { data: { user: { ...accountUser(), id: state.verifierUserId || userId }, session: currentSession() }, error: null };
          },
          async signOut(signOutOptions) {
            state.calls.push({ method: "verifierSignOut", options: signOutOptions });
            state.verifierActive = false;
            return { error: null };
          },
          stopAutoRefresh() { state.verifierRefreshStopped = true; }
        } };
      }
      state.clientOptions = options;
      state.clients ??= [];
      const instance = { ...client };
      state.clients.push({ instance, options });
      return instance;
    } }
  };
  const schedule = (callback, milliseconds) => setTimeout(callback, state.fastTimers && milliseconds >= 5000 ? Math.min(milliseconds / 1000, 30) : milliseconds);
  const context = vm.createContext({ window, URL, Headers, Response, Blob, Uint8Array, AbortController, setTimeout: schedule, clearTimeout, queueMicrotask, atob, CustomEvent: class { constructor(type, details) { this.type = type; this.detail = details.detail; } } });
  if (state.profileLinks) vm.runInContext(linksSource, context);
  vm.runInContext(source, context);
  return { api: window.IwtxzBackend, state, client };
}

async function rejects(promise, status, code) {
  await assert.rejects(promise, (failure) => failure.status === status && failure.code === code);
}
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

test("drafts, publication and public reads expose the same working profile URL", async () => {
  for (const username of ["tshk", "builder"]) {
    const { api } = load({ username, profileLinks: true });
    const expected = username === "builder" ? "/profile.html?u=builder" : "/tshk";
    const draft = (await api.request("/api/builder/sites/get")).site;
    assert.equal(draft.publicUrl, expected);
    const saved = await api.request("/api/builder/sites/save", post({ site: { ...draft, publicUrl: "/old-link" } }));
    assert.equal(saved.site.publicUrl, expected);
    assert.equal((await api.request("/api/builder/sites/list")).sites[0].publicUrl, expected);
    assert.equal((await api.request("/api/builder/publish", post({}))).url, expected);
    assert.equal((await api.getPublishedProfile(username)).publicUrl, expected);
  }
});

test("missing configuration is explicit and never creates a fake local account", async () => {
  const { api, state } = load({ config: null });
  assert.equal(api.isConfigured(), false);
  await rejects(api.request("/api/builder/auth/me"), 503, "backend_not_configured");
  assert.equal(state.createCalls, 0);
});

test("secret/service-role keys are rejected before SDK initialization", async () => {
  const rolePayload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  for (const publishableKey of ["sb_secret_wrong_key", `header.${rolePayload}.signature`]) {
    const { api, state } = load({ config: { ...goodConfig, publishableKey } });
    assert.equal(api.isConfigured(), false);
    await rejects(api.request("/api/builder/auth/me"), 503, "backend_not_configured");
    assert.equal(state.createCalls, 0);
  }
});

test("signed-out visitor stays signed out without reading profile rows", async () => {
  const { api, state } = load({ active: false });
  assert.equal((await api.request("/api/builder/auth/me")).user, null);
  assert.equal(state.calls.length, 0);
  assert.equal(state.clientOptions.auth.persistSession, true);
  assert.equal(state.clientOptions.auth.detectSessionInUrl, false);
});

test("registration normalizes the username and passes owner claim only to managed Auth", async () => {
  const { api, state } = load({ active: false });
  const result = await api.request("/api/builder/auth/signup", post({ username: " Strelok ", password: "New-test-password-5!", ownerClaim: "one-time-claim" }));
  assert.equal(result.user.username, "strelokk");
  const signup = state.calls.find((call) => call.method === "signUp");
  assert.equal(signup.credentials.email, "strelokk@accounts.iwtxz.ru");
  assert.equal(signup.credentials.options.data.owner_claim, "one-time-claim");
  assert.equal(signup.credentials.options.data.username, "strelokk");
  assert.equal(state.calls.some((call) => call.method === "rpc"), false);
});

test("email-confirmation misconfiguration never pretends registration also signed in", async () => {
  const { api } = load({ active: false, confirmEmail: true });
  await rejects(api.request("/api/builder/auth/signup", post({ username: "alice", password: "New-test-password-5!" })), 503, "email_confirmation_required");
});

test("reserved username without an owner code never starts a registration attempt", async () => {
  const { api, state } = load({ active: false });
  await rejects(api.request("/api/builder/auth/signup", post({ username: "iwtlu", password: "New-test-password-5!" })), 409, "reserved_username");
  assert.equal(state.calls.some((call) => call.method === "signUp"), false);
});

test("wrong password is a login failure, not a session-expiration signal", async () => {
  const { api, state } = load();
  await rejects(api.request("/api/builder/auth/login", post({ username: "alice", password: "wrong-password" })), 401, "invalid_login");
  assert.equal(state.active, true);
  assert.equal(state.calls.some((call) => call.method === "signOut"), false);
});

test("wrong current password blocks updateUser even when the server ignores current_password", async () => {
  const { api, state } = load();
  const previousPassword = state.password;
  await rejects(api.request("/api/builder/auth/password", post({ currentPassword: "wrong", newPassword: "Changed-test-password-5!" })), 401, "invalid_password");
  assert.equal(state.active, true);
  assert.equal(state.password, previousPassword);
  assert.equal(state.calls.some((call) => call.method === "updateUser"), false);
  assert.equal(state.calls.some((call) => call.method === "signOut"), false);
  assert.equal(state.calls.at(-1).method, "verifierSignOut");
  assert.equal(state.calls.at(-1).options.scope, "local");
  assert.equal(state.verifierActive, false);
  assert.equal(state.verifierRefreshStopped, true);
});

test("password verification uses a nonpersistent separate client, then revokes other sessions", async () => {
  const { api, state } = load();
  const result = await api.request("/api/builder/auth/password", post({ currentPassword: state.password, newPassword: "Changed-test-password-5!" }));
  assert.equal(result.ok, true);
  assert.equal(state.active, true);
  assert.equal(state.password, "Changed-test-password-5!");
  const options = state.verificationOptions[0].auth;
  assert.equal(options.persistSession, false);
  assert.equal(options.autoRefreshToken, false);
  assert.equal(options.detectSessionInUrl, false);
  assert.match(options.storageKey, /^iwtxz-password-verification-[a-f0-9]{32}$/);
  assert.equal(state.calls.find((call) => call.method === "verifyPassword").credentials.email, "alice@accounts.iwtxz.ru");
  assert.ok(state.calls.findIndex((call) => call.method === "verifyPassword") < state.calls.findIndex((call) => call.method === "updateUser"));
  assert.equal(state.calls.find((call) => call.method === "signOut").options.scope, "others");
  assert.equal(state.calls.at(-1).method, "verifierSignOut");
  assert.equal(state.calls.at(-1).options.scope, "local");
  assert.equal(state.verifierActive, false);
  assert.equal(state.events.length, 0);
});

test("a verifier for another user cannot change the logged-in user's password", async () => {
  const { api, state } = load({ verifierUserId: "92c657a8-aea5-422d-8600-13b8c82d4299" });
  const previousPassword = state.password;
  await rejects(api.request("/api/builder/auth/password", post({ currentPassword: previousPassword, newPassword: "Changed-test-password-5!" })), 401, "invalid_password");
  assert.equal(state.password, previousPassword);
  assert.equal(state.calls.some((call) => call.method === "updateUser"), false);
  assert.equal(state.verifierActive, false);
  assert.equal(state.active, true);
});

test("temporary verifier session is revoked when the main password update fails", async () => {
  const { api, state } = load({ updateError: authError("request_timeout", 503) });
  const previousPassword = state.password;
  await rejects(api.request("/api/builder/auth/password", post({ currentPassword: previousPassword, newPassword: "Changed-test-password-5!" })), 504, "request_timeout");
  assert.equal(state.password, previousPassword);
  assert.equal(state.verifierActive, false);
  assert.equal(state.active, true);
  assert.equal(state.calls.at(-1).method, "verifierSignOut");
});

test("own drafts use RPCs and cross-account requests are rejected before mutation", async () => {
  const { api, state } = load();
  const list = await api.request("/api/builder/sites/list");
  assert.equal(list.sites[0].owner, "alice");
  await rejects(api.request("/api/builder/sites/save", post({ site: { owner: "bob", nickname: "stolen" } })), 403, "forbidden");
  await rejects(api.request("/api/builder/sites/get?id=bob"), 404, "not_found");
  const site = { id: "alice", owner: "alice", nickname: "Own draft" };
  const saved = await api.request("/api/builder/sites/save", post({ site }));
  assert.equal(saved.site.nickname, "Own draft");
  assert.equal(state.calls.find((call) => call.name === "builder_save_profile").input.input.nickname, "Own draft");
  await rejects(api.getPublishedProfile("alice"), 404, "not_found");
  const publication = await api.request("/api/builder/publish", post({}));
  assert.equal(publication.url, "/profile.html?u=alice");
  assert.equal((await api.getPublishedProfile("alice")).nickname, "Own draft");
});

test("anonymous published profile reads request only public columns and never authenticate", async () => {
  const { api, state } = load({ active: false });
  state.published.set("alice", { username: "alice", settings: { nickname: "Published", owner: "ignored" }, published_at: "2026-10-30T00:00:00Z" });
  const site = await api.getPublishedProfile("alice");
  assert.equal(site.owner, "alice");
  assert.equal(site.publicUrl, "/profile.html?u=alice");
  assert.equal(site.publishedAt, 1793318400000);
  assert.equal(state.calls.some((call) => call.method === "getUser"), false);
  assert.equal(state.calls[0].columns, "username,settings,published_at");
});

test("missing SQL schema reports setup failure instead of malformed profile success", async () => {
  const { api } = load({ rpcError: { code: "PGRST202", message: "Function not found" } });
  await rejects(api.request("/api/builder/sites/list"), 503, "backend_setup_required");
});

test("uploads sniff safe bytes, correct mislabeled media and use own immutable storage paths", async () => {
  const { api, state } = load();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aLMsAAAAASUVORK5CYII=", "base64");
  const upload = await api.request("/api/builder/assets/upload?kind=avatar&name=picture.jpg", { method: "POST", headers: { "content-type": "image/jpeg" }, body: new Blob([png], { type: "image/jpeg" }) });
  assert.equal(upload.type, "image/png");
  assert.equal(upload.size, png.length);
  assert.match(state.uploads[0].path, new RegExp(`^${userId}/[a-f0-9]{32}\\.png$`));
  assert.equal(state.uploads[0].options.upsert, false);
  assert.equal(state.uploads[0].options.contentType, "image/png");
  assert.ok(state.uploads[0].bytes.equals(png));
  assert.ok(upload.url.startsWith(project + "/storage/v1/object/public/profile-assets/" + userId));
  const mp4 = Buffer.from([0,0,0,24,102,116,121,112,77,52,65,32,0,0,0,0]);
  const audio = await api.request("/api/builder/assets/upload?kind=music&name=sound.mp3", { method: "POST", headers: { "content-type": "audio/mpeg" }, body: new Blob([mp4], { type: "audio/mpeg" }) });
  assert.equal(audio.type, "audio/mp4");
  assert.match(state.uploads[1].path, /\.m4a$/);
});

test("SVG, disguised HTML, oversized uploads and bad kinds never reach storage", async () => {
  const { api, state } = load();
  const attempt = (kind, type, contents) => api.request(`/api/builder/assets/upload?kind=${kind}`, { method: "POST", headers: { "content-type": type }, body: new Blob([contents], { type }) });
  await rejects(attempt("avatar", "image/svg+xml", "<svg></svg>"), 415, "invalid_asset_type");
  await rejects(attempt("avatar", "image/png", "<script>alert(1)</script>"), 415, "invalid_asset_type");
  await rejects(attempt("music", "audio/mpeg", new Uint8Array(4 * 1024 * 1024 + 1)), 413, "request_too_large");
  await rejects(attempt("script", "image/png", "x"), 400, "invalid_asset_kind");
  assert.equal(state.uploads.length, 0);
});

test("custom-font uploads validate real font bytes and store a canonical MIME and extension", async () => {
  const { api, state } = load();
  const ttf = await readFile(resolve(root, "font/minecraft.ttf"));
  const result = await api.request("/api/builder/assets/upload?kind=customFont&name=custom.ttf", {
    method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Blob([ttf])
  });
  assert.equal(result.type, "font/ttf");
  assert.equal(result.kind, "customFont");
  assert.ok(state.uploads[0].bytes.equals(ttf));
  assert.match(state.uploads[0].path, /[a-f0-9]{32}\.ttf$/);
  assert.equal(state.uploads[0].options.contentType, "font/ttf");
  const attempt = contents => api.request("/api/builder/assets/upload?kind=customFont", {
    method: "POST", headers: { "content-type": "font/ttf" }, body: new Blob([contents])
  });
  await rejects(attempt("<script>alert(1)</script>"), 415, "invalid_asset_type");
  await rejects(attempt(ttf.subarray(0, 50)), 415, "invalid_asset_type");
  const corrupt = Buffer.from(ttf);
  corrupt.writeUInt32BE(corrupt.length + 1, 20);
  await rejects(attempt(corrupt), 415, "invalid_asset_type");
  assert.equal(state.uploads.length, 1);
});

test("an old server cannot silently discard customization settings or accept a font upload", async () => {
  const { api, state } = load({ oldCustomizationServer: true });
  for (const update of [{ nicknameGradient: true }, { discordCardColor: "#111111" }, { discordUserId: "484816707798564894" }, { font: "custom" }]) {
    await rejects(api.request("/api/builder/sites/save", post({ site: { id: "alice", ...update } })), 503, "backend_update_required");
  }
  const ttf = await readFile(resolve(root, "font/minecraft.ttf"));
  await rejects(api.request("/api/builder/assets/upload?kind=customFont", { method: "POST", body: new Blob([ttf], { type: "font/ttf" }) }), 503, "backend_update_required");
  assert.equal(state.calls.some(call => call.name === "builder_save_profile"), false);
  assert.equal(state.uploads.length, 0);
});

test("expired session is cleared locally; logout never requests a global signout", async () => {
  const { api, state } = load({ getUserError: authError("session_not_found", 401) });
  assert.equal((await api.request("/api/builder/auth/me")).user, null);
  assert.equal(state.calls.at(-1).options.scope, "local");
  await api.request("/api/builder/auth/logout", post({}));
  assert.equal(state.calls.at(-1).options.scope, "local");
});

test("SDK auth state notifications expose no bearer tokens", async () => {
  const { api, state } = load();
  await api.request("/api/builder/auth/me");
  state.authListener("SIGNED_OUT", { access_token: "should-not-leak" });
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(state.events[0].type, "iwtxz-auth-change");
  assert.equal(JSON.stringify(state.events[0].detail), '{"event":"SIGNED_OUT"}');
});

test("blocked initialization times out before sign-up; a late result cannot overwrite a retried login", async () => {
  const { api, state } = load({ hangSession: true, fastTimers: true });
  await rejects(api.request("/api/builder/auth/signup", post({ username: "alice", password: "Initial-test-password-1!" })), 504, "request_timeout");
  const releaseOldSession = state.resolveSession;
  const oldListener = state.authListener;
  assert.equal(state.calls.some(call => call.method === "signUp"), false);
  state.hangSession = false;
  assert.equal((await api.request("/api/builder/auth/login", post({ username: "alice", password: state.password }))).user.username, "alice");
  assert.equal(state.createCalls, 2);
  releaseOldSession({ data: { session: null }, error: null });
  oldListener("SIGNED_OUT", { access_token: "retired-secret" });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.calls.some(call => call.method === "signUp"), false);
  assert.equal(state.events.length, 0);
  assert.equal(state.active, true);
});

test("a returned initialization error also prevents server account creation", async () => {
  const { api, state } = load({ sessionError: { status: 504, code: "request_timeout", message: "timeout" } });
  await rejects(api.request("/api/builder/auth/signup", post({ username: "alice", password: state.password })), 504, "request_timeout");
  assert.equal(state.calls.some(call => call.method === "signUp"), false);
});

test("a cancelled bootstrap does not retire or time out a later manual login", async () => {
  const { api, state } = load({ hangSession: true, fastTimers: true });
  const controller = new AbortController();
  const bootstrap = api.request("/api/builder/auth/me", { signal: controller.signal });
  await new Promise(resolve => queueMicrotask(resolve));
  const releaseBootstrap = state.resolveSession;
  controller.abort();
  await rejects(bootstrap, 499, "request_cancelled");
  state.hangSession = false;
  await api.request("/api/builder/auth/login", post({ username: "alice", password: state.password }));
  releaseBootstrap({ data: { session: null }, error: null });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(state.createCalls, 1);
  assert.equal(state.active, true);
});

test("public profile reads use a separate nonpersistent client without browser auth locks", async () => {
  const { api, state } = load({ hangSession: true, fastTimers: true });
  state.published.set("alice", { username: "alice", settings: { nickname: "Public" }, published_at: "2026-10-30T00:00:00Z" });
  const stalled = rejects(api.request("/api/builder/auth/me"), 504, "request_timeout");
  assert.equal((await api.getPublishedProfile("alice")).nickname, "Public");
  const options = state.clients.find(entry => entry.options.auth.persistSession === false).options;
  assert.equal(options.auth.autoRefreshToken, false);
  assert.equal(options.auth.storageKey, "iwtxz-public-profile-reader");
  assert.equal(await options.auth.lock("public-lock", -1, async () => "ready"), "ready");
  await stalled;
});

test("fetch timeout includes a stalled response body and preserves empty 204 responses", async () => {
  let signal;
  const { api, state } = load({ fastTimers: true, fetch: async (_input, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"unfinished":')); } }), { headers: { "content-type": "application/json" } });
  } });
  await api.request("/api/builder/auth/me");
  await rejects(state.clientOptions.global.fetch("https://fixture.supabase.co/auth/v1/user"), 504, "request_timeout");
  assert.equal(signal.aborted, true);
  state.fetch = async () => new Response(null, { status: 204 });
  const empty = await state.clientOptions.global.fetch("https://fixture.supabase.co/auth/v1/logout");
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
});

test("browser lock acquisition is bounded and never invokes an abandoned callback", async () => {
  let abandonedCallback;
  let acquired = false;
  const { api, state } = load({ fastTimers: true, navigator: { locks: { request(_name, _options, callback) { abandonedCallback = callback; return new Promise(() => {}); } } } });
  await api.request("/api/builder/auth/me");
  await rejects(state.clientOptions.auth.lock("fixture-lock", -1, async () => { acquired = true; }), 504, "request_timeout");
  await rejects(abandonedCallback({ name: "fixture-lock" }), 504, "request_timeout");
  assert.equal(acquired, false);
});

test("a late password verifier cannot update a fresh login after its request timed out", async () => {
  const { api, state } = load({ hangVerifier: true, fastTimers: true });
  await rejects(api.request("/api/builder/auth/password", post({ currentPassword: state.password, newPassword: "New-test-password-2!" })), 504, "request_timeout");
  const releaseVerifier = state.resolveVerifier;
  state.hangVerifier = false;
  await api.request("/api/builder/auth/login", post({ username: "alice", password: state.password }));
  releaseVerifier({ data: { user: { id: userId }, session: { access_token: "temporary" } }, error: null });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.calls.some(call => call.method === "updateUser"), false);
  assert.equal(state.calls.some(call => call.method === "signOut" && call.options.scope === "others"), false);
  assert.equal(state.verifierActive, false);
  assert.equal(state.active, true);
});
