import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../backend-client.js', import.meta.url), 'utf8');
const sdkSource = await readFile(new URL('../vendor/supabase-2.102.0.min.js', import.meta.url), 'utf8');
const project = 'https://fixture.supabase.co';
const uid = '8e3f4561-f854-4444-a202-36567eefc491';
const post = body => ({ method: 'POST', body: JSON.stringify(body) });
const recoveryKey = 'iwtxz:auth:recovery';
const linkKey = 'iwtxz:auth:identity-link';
const apiError = code => ({ name: 'AuthApiError', status: 400, code });

function fixture(options = {}) {
  const state = { active: true, calls: [], username: 'alice', storage: new Map(), providers: { google: true, discord: true }, ...options };
  state.user = options.user || { id: uid, email: 'alice@accounts.iwtxz.ru', email_confirmed_at: '2026-01-01', identities: [{ provider: 'email' }] };
  const session = () => ({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', user: state.user });
  const auth = {
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: state.active ? session() : null }, error: null }),
    getUser: async () => ({ data: { user: state.active ? state.user : null }, error: null }),
    async signInWithPassword(value) {
      state.calls.push(['password', value]);
      return state.aliasInvalid && value.email.endsWith('@accounts.iwtxz.ru') ? { data: null, error: apiError('invalid_credentials') } : { data: { user: state.user, session: session() }, error: null };
    },
    async setSession(value) { state.calls.push(['setSession', value]); state.active = true; return { data: { session: session(), user: state.user }, error: null }; },
    async exchangeCodeForSession(code) {
      state.calls.push(['exchange', code]);
      if (state.exchangeError) return { data: null, error: apiError(state.exchangeError) };
      state.active = true;
      return { data: { user: state.user, session: session(), redirectType: state.redirectType || null }, error: null };
    },
    async signInWithOAuth(value) { state.calls.push(['oauth', value]); return { data: { url: state.oauthUrl || `${project}/auth/v1/authorize?provider=${value.provider}` }, error: null }; },
    async linkIdentity(value) { state.calls.push(['link', value]); return { data: { url: state.linkUrl || (value.provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth?state=signed-state' : 'https://discord.com/api/oauth2/authorize?state=signed-state') }, error: null }; },
    async resetPasswordForEmail(email, options) { state.calls.push(['recover', email, options]); return { data: {}, error: null }; },
    async updateUser(value, options) { state.calls.push(['update', value, options]); if (value.email) state.user = { ...state.user, new_email: value.email }; return { data: { user: state.user }, error: null }; },
    async signOut(value) { state.calls.push(['signOut', value]); if (value.scope !== 'others') state.active = false; return { error: null }; }
  };
  const client = {
    auth,
    from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: state.noProfile ? null : { username: state.username }, error: null }) }; },
    async rpc(name, args) { state.calls.push(['rpc', name, args]); state.noProfile = false; state.username = args.requested_username; return { data: { username: state.username }, error: null }; }
  };
  const currentUrl = new URL(options.url || 'https://iwtxz.su/index.html');
  const storage = { getItem: key => state.storage.get(key) || null, setItem: (key, value) => state.storage.set(key, value), removeItem: key => state.storage.delete(key) };
  const window = {
    IWTXZ_BACKEND_CONFIG: { provider: 'supabase', url: project, publishableKey: 'sb_publishable_fixture', usernameAuthUrl: `${project}/functions/v1/account-login` },
    location: { href: currentUrl.href, origin: currentUrl.origin },
    history: { replaceState(_state, _unused, url) { state.cleanedUrl = url; window.location.href = url; } },
    sessionStorage: storage,
    crypto: webcrypto,
    dispatchEvent() {},
    async fetch(url, request = {}) {
      state.calls.push(['fetch', url, request]);
      if (url === `${project}/auth/v1/settings`) return Response.json({ external: state.providers });
      if (String(url).includes('/functions/v1/account-login')) {
        if (request.method === 'GET') return Response.json({ ready: state.ready !== false }, { status: state.healthStatus || 200 });
        return Response.json(state.proxyStatus ? { error: 'invalid_credentials' } : { access_token: 'proxy-access', refresh_token: 'proxy-refresh' }, { status: state.proxyStatus || 200 });
      }
      throw new Error(`Unexpected network request ${url}`);
    },
    supabase: { createClient(_url, _key, options) { state.clientOptions = options; return client; } }
  };
  const context = vm.createContext({ window, URL, URLSearchParams, Response, Headers, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, atob, CustomEvent: class {} });
  vm.runInContext(source, context);
  return { api: window.IwtxzBackend, state, window };
}

test('real email sign-in uses managed Auth without exposing private email resolution', async () => {
  const { api, state } = fixture({ user: { id: uid, email: 'alice@example.com' } });
  const result = await api.request('/api/builder/auth/login', post({ username: ' Alice@Example.Com ', password: 'password-test' }));
  assert.equal(result.user.username, 'alice');
  assert.equal(state.calls.find(call => call[0] === 'password')[1].email, 'alice@example.com');
  assert.equal(state.calls.some(call => call[0] === 'fetch'), false);
  assert.equal(state.clientOptions.auth.flowType, 'pkce');
});

test('username sign-in keeps old alias first and only failed credentials reach private proxy', async () => {
  const { api, state } = fixture({ aliasInvalid: true });
  const result = await api.request('/api/builder/auth/login', post({ username: 'alice', password: 'password-test' }));
  assert.equal(state.calls[0][0], 'password');
  const request = state.calls.find(call => call[0] === 'fetch');
  assert.deepEqual(JSON.parse(request[2].body), { username: 'alice', password: 'password-test' });
  assert.equal(state.calls.filter(call => call[0] === 'setSession').length, 1);
  assert.equal(JSON.stringify(result).includes('proxy-access'), false);
  const legacy = fixture();
  await legacy.api.request('/api/builder/auth/login', post({ username: 'alice', password: 'password-test' }));
  assert.equal(legacy.state.calls.some(call => call[0] === 'fetch'), false);
  const rejected = fixture({ aliasInvalid: true, proxyStatus: 401 });
  await assert.rejects(rejected.api.request('/api/builder/auth/login', post({ username: 'alice', password: 'bad' })), { code: 'invalid_login' });
  assert.equal(rejected.state.calls.some(call => call[0] === 'setSession'), false);
  const absent = fixture({ aliasInvalid: true, proxyStatus: 404 });
  await assert.rejects(absent.api.request('/api/builder/auth/login', post({ username: 'alice', password: 'bad' })), { code: 'invalid_login' });
});

test('binding is blocked before any Auth mutation until private username login is ready', async () => {
  for (const options of [{ ready: false }, { healthStatus: 404 }]) {
    const { api, state } = fixture(options);
    await assert.rejects(api.request('/api/builder/auth/email', post({ email: 'real@example.com' })), { code: 'backend_setup_required' });
    assert.equal(state.calls.some(call => call[0] === 'update'), false);
  }
  const { api, state } = fixture();
  const result = await api.request('/api/builder/auth/email', post({ email: 'real@example.com' }));
  assert.equal(result.email, '');
  assert.equal(result.pendingEmail, 'real@example.com');
  assert.equal(result.emailVerified, false);
  assert.equal(state.calls.find(call => call[0] === 'update')[2].emailRedirectTo, 'https://iwtxz.su/index.html?auth=email');
});

test('owner account state distinguishes service alias, pending confirmation and verified personal address', async () => {
  const { api } = fixture({ user: { id: uid, email: 'real@example.com', new_email: 'other@example.com', email_confirmed_at: '2026-01-01', identities: [{ provider: 'discord' }, { provider: 'email' }] } });
  const state = await api.request('/api/builder/auth/account');
  assert.equal(state.email, 'real@example.com');
  assert.equal(state.pendingEmail, 'other@example.com');
  assert.equal(state.emailVerified, true);
  assert.equal(state.providers.join(','), 'discord');
  assert.equal(state.hasPassword, true);
  await assert.rejects(fixture({ active: false }).api.request('/api/builder/auth/account'), { code: 'unauthorized' });
});

test('recovery accepts only real email and uses the specific first-party callback', async () => {
  const { api, state } = fixture({ active: false });
  for (const email of ['alice', 'alice@accounts.iwtxz.ru', 'a@b', 'a b@example.com']) await assert.rejects(api.request('/api/builder/auth/recover', post({ email })), { code: 'invalid_email' });
  assert.equal(state.calls.length, 0);
  assert.equal((await api.request('/api/builder/auth/recover', post({ email: ' Real@Example.Com ' }))).ok, true);
  const call = state.calls.find(call => call[0] === 'recover');
  assert.equal(call[1], 'real@example.com');
  assert.equal(call[2].redirectTo, 'https://iwtxz.su/index.html?auth=recovery');
});

test('a recovery query parameter never authorizes a reset without an actual recovery session', async () => {
  const { api, state } = fixture({ url: 'https://iwtxz.su/index.html?auth=recovery' });
  assert.equal((await api.request('/api/builder/auth/me')).user.username, 'alice');
  await assert.rejects(api.request('/api/builder/auth/recovery-password', post({ newPassword: 'New-password-123!' })), { code: 'recovery_required' });
  assert.equal(state.calls.some(call => call[0] === 'update'), false);
});

test('verified PKCE recovery exchanges once, survives reload, sets password then enters cabinet', async () => {
  const { api, state } = fixture({ url: 'https://iwtxz.su/index.html?auth=recovery&code=secret-one-time-code', redirectType: 'PASSWORD_RECOVERY' });
  const results = await Promise.all([api.request('/api/builder/auth/me'), api.request('/api/builder/auth/me')]);
  assert.equal(results.every(result => result.recoveryRequired && result.user === null), true);
  assert.equal(state.calls.filter(call => call[0] === 'exchange').length, 1);
  assert.equal(state.cleanedUrl, 'https://iwtxz.su/index.html');
  const reload = fixture({ storage: state.storage });
  assert.equal((await reload.api.request('/api/builder/auth/me')).recoveryRequired, true);
  const result = await reload.api.request('/api/builder/auth/recovery-password', post({ newPassword: 'New-password-123!' }));
  assert.equal(result.user.username, 'alice');
  assert.equal(state.storage.has(recoveryKey), false);
  assert.equal(reload.state.calls.some(call => call[0] === 'signOut' && call[1].scope === 'others'), true);
});

test('ordinary PKCE callback cannot be relabeled as password recovery in the URL', async () => {
  const { api, state } = fixture({ url: 'https://iwtxz.su/index.html?auth=recovery&code=ordinary-oauth-code' });
  assert.equal((await api.request('/api/builder/auth/me')).user.username, 'alice');
  assert.equal(state.storage.has(recoveryKey), false);
  await assert.rejects(api.request('/api/builder/auth/recovery-password', post({ newPassword: 'New-password-123!' })), { code: 'recovery_required' });
});

test('legacy recovery fragments are verified and removed from browser history', async () => {
  const { api, state } = fixture({ url: 'https://iwtxz.su/index.html?auth=recovery#access_token=legacy-access&refresh_token=legacy-refresh&type=recovery' });
  assert.equal((await api.request('/api/builder/auth/me')).recoveryRequired, true);
  assert.equal(state.calls.find(call => call[0] === 'setSession')[1].access_token, 'legacy-access');
  assert.equal(state.cleanedUrl.includes('legacy-access'), false);
});

test('OAuth checks enabled providers, returns trusted PKCE URL and never redirects by itself', async () => {
  for (const provider of ['google', 'discord']) {
    const { api, state } = fixture();
    const result = await api.request('/api/builder/auth/oauth', post({ provider }));
    assert.equal(new URL(result.url).origin, project);
    const options = state.calls.find(call => call[0] === 'oauth')[1].options;
    assert.equal(options.skipBrowserRedirect, true);
    assert.equal(options.redirectTo, 'https://iwtxz.su/index.html?auth=callback');
  }
  const disabled = fixture({ providers: { google: false } });
  await assert.rejects(disabled.api.request('/api/builder/auth/oauth', post({ provider: 'google' })), { code: 'oauth_not_configured' });
  assert.equal(disabled.state.calls.some(call => call[0] === 'oauth'), false);
  await assert.rejects(fixture().api.request('/api/builder/auth/oauth', post({ provider: 'evil' })), { code: 'invalid_provider' });
  await assert.rejects(fixture({ oauthUrl: 'https://phishing.example/login' }).api.request('/api/builder/auth/oauth', post({ provider: 'google' })), { code: 'invalid_response' });
});

test('identity linking binds to original user and rejects a callback for a different account', async () => {
  const origin = fixture();
  const result = await origin.api.request('/api/builder/auth/oauth', post({ provider: 'discord', link: true }));
  assert.equal(new URL(result.url).origin, 'https://discord.com');
  assert.equal(origin.state.calls.find(call => call[0] === 'link')[1].options.redirectTo, 'https://iwtxz.su/index.html?auth=link');
  assert.equal(JSON.parse(origin.state.storage.get(linkKey)).userId, uid);
  const wrongUser = fixture({ storage: origin.state.storage, user: { id: 'different-user' }, url: 'https://iwtxz.su/index.html?auth=link&code=wrong-account' });
  await assert.rejects(wrongUser.api.request('/api/builder/auth/me'), { code: 'identity_mismatch' });
  assert.equal(wrongUser.state.calls.some(call => call[0] === 'signOut' && call[1].scope === 'local'), true);
  assert.equal(origin.state.storage.has(linkKey), false);
});

test('manual identity links accept only the requested provider authorization endpoint', async () => {
  const google = fixture();
  assert.equal(new URL((await google.api.request('/api/builder/auth/oauth', post({ provider: 'google', link: true }))).url).hostname, 'accounts.google.com');
  for (const linkUrl of ['https://accounts.google.com.evil.example/o/oauth2/auth', 'https://accounts.google.com/untrusted', 'https://discord.com/oauth2/authorize', 'https://accounts.google.com:444/o/oauth2/auth', 'http://accounts.google.com/o/oauth2/auth']) {
    const { api } = fixture({ linkUrl });
    await assert.rejects(api.request('/api/builder/auth/oauth', post({ provider: 'google', link: true })), { code: 'invalid_response' });
  }
});

test('only verified OAuth identities receive username setup and claim through authenticated RPC', async () => {
  const { api, state } = fixture({ noProfile: true, user: { id: uid, email: 'oauth@example.com', identities: [{ provider: 'google' }] } });
  const me = await api.request('/api/builder/auth/me');
  assert.equal(me.needsUsername, true);
  assert.equal(me.user, null);
  assert.equal((await api.request('/api/builder/auth/complete', post({ username: 'New_user' }))).user.username, 'new_user');
  const rpc = state.calls.find(call => call[0] === 'rpc');
  assert.equal(rpc[1], 'builder_complete_oauth_profile');
  assert.equal(rpc[2].requested_username, 'new_user');
  const forged = fixture({ noProfile: true, user: { id: uid, user_metadata: { provider: 'google' } } });
  await assert.rejects(forged.api.request('/api/builder/auth/complete', post({ username: 'owned' })), { code: 'oauth_required' });
  await assert.rejects(forged.api.request('/api/builder/auth/me'), { code: 'backend_setup_required' });
});

test('real vendored SDK: PKCE recovery preserves verifier, bypasses an expired session and requires password reset', { timeout: 3000 }, async () => {
  const key = 'iwtxz-fixture-auth-v2';
  const user = { id: uid, email: 'real@example.com', identities: [{ provider: 'email' }], email_confirmed_at: '2026-01-01' };
  const makeSession = expiresAt => ({ access_token: 'qa.e30.fixture', refresh_token: 'refresh-fixture', expires_in: 3600, expires_at: expiresAt, token_type: 'bearer', user });
  const state = { calls: [], clients: [] };
  const stored = new Map([[key, JSON.stringify(makeSession(1))], [`${key}-code-verifier`, JSON.stringify('fixture-code-verifier/PASSWORD_RECOVERY')]]);
  const tab = new Map();
  const storage = map => ({ getItem: name => map.get(name) || null, setItem: (name, value) => map.set(name, value), removeItem: name => map.delete(name) });
  const window = {
    IWTXZ_BACKEND_CONFIG: { provider: 'supabase', url: project, publishableKey: 'sb_publishable_fixture' },
    location: { origin: 'https://iwtxz.su', href: 'https://iwtxz.su/index.html?auth=recovery&code=one-time' },
    history: { replaceState(_state, _title, value) { window.location.href = value; } },
    localStorage: storage(stored), sessionStorage: storage(tab), crypto: webcrypto,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    async fetch(value, options) {
      const url = new URL(value);
      state.calls.push([url.pathname, url.search, options]);
      if (url.searchParams.get('grant_type') === 'refresh_token') throw new Error('Recovery must bypass expired-session refresh');
      if (url.searchParams.get('grant_type') === 'pkce') {
        assert.equal(JSON.parse(options.body).code_verifier, 'fixture-code-verifier');
        return Response.json(makeSession(Math.floor(Date.now() / 1000) + 3600));
      }
      if (url.pathname === '/auth/v1/user') return Response.json(user);
      if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
      if (url.pathname === '/rest/v1/profile_accounts') return Response.json({ username: 'alice' });
      throw new Error(`Unexpected SDK request ${url}`);
    }
  };
  const context = vm.createContext({ window, navigator: {}, document: { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} },
    URL, URLSearchParams, Headers, Request, Response, Blob, Uint8Array, TextEncoder, TextDecoder, AbortController,
    crypto: webcrypto, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval, console,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  vm.runInContext(sdkSource, context);
  window.supabase = { createClient(...args) { const client = context.supabase.createClient(...args); state.clients.push(client); return client; } };
  vm.runInContext(source, context);
  try {
    const result = await window.IwtxzBackend.request('/api/builder/auth/me');
    assert.equal(result.recoveryRequired, true);
    assert.equal(result.user, null);
    assert.equal(state.calls.some(call => call[0].startsWith('/rest/')), false);
    assert.equal(window.location.href, 'https://iwtxz.su/index.html');
    assert.equal(stored.has(`${key}-code-verifier`), false);
    const updated = await window.IwtxzBackend.request('/api/builder/auth/recovery-password', post({ newPassword: 'New-password-from-recovery-123!' }));
    assert.equal(updated.user.username, 'alice');
    assert.equal(tab.has(recoveryKey), false);
    assert.equal(state.calls.some(call => call[0] === '/auth/v1/user' && call[2].method === 'PUT' && JSON.parse(call[2].body).password === 'New-password-from-recovery-123!'), true);
  } finally { for (const client of state.clients) await client.auth.stopAutoRefresh(); }
});
