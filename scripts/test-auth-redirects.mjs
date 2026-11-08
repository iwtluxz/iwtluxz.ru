import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../backend-client.js', import.meta.url), 'utf8');
const project = 'https://fixture.supabase.co';
const user = { id: '8e3f4561-f854-4444-a202-36567eefc491', email: 'alice@accounts.iwtxz.ru', identities: [{ provider: 'email' }] };
const post = value => ({ method: 'POST', body: JSON.stringify(value) });

function fixture({ href = 'https://iwtxz.su/index.html', authSiteUrl = 'https://iwtxz.su', redirectType = null } = {}) {
  const calls = [], storage = new Map();
  const current = new URL(href);
  const session = { user, access_token: 'fixture-access', refresh_token: 'fixture-refresh' };
  const auth = {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    async resetPasswordForEmail(email, options) { calls.push(['recover', email, options]); return { data: {}, error: null }; },
    async updateUser(input, options) { calls.push(['update', input, options]); return { data: { user: { ...user, new_email: input.email } }, error: null }; },
    async signInWithOAuth(input) { calls.push(['oauth', input]); return { data: { url: `${project}/auth/v1/authorize?provider=${input.provider}` }, error: null }; },
    async linkIdentity(input) { calls.push(['link', input]); return { data: { url: input.provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth?state=signed' : 'https://discord.com/api/oauth2/authorize?state=signed' }, error: null }; },
    async exchangeCodeForSession(code) { calls.push(['exchange', code]); return { data: { session, user, redirectType }, error: null }; }
  };
  const client = { auth, from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { username: 'alice' }, error: null }) }; } };
  const window = {
    IWTXZ_BACKEND_CONFIG: { provider: 'supabase', url: project, publishableKey: 'sb_publishable_fixture', usernameAuthUrl: `${project}/functions/v1/account-login`, ...(authSiteUrl === undefined ? {} : { authSiteUrl }) },
    location: { href: current.href, origin: current.origin },
    crypto: webcrypto,
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    history: { replaceState(_state, _unused, url) { calls.push(['history', url]); window.location.href = url; } },
    supabase: { createClient() { return client; } },
    dispatchEvent() {},
    async fetch(url) {
      if (String(url) === `${project}/auth/v1/settings`) return Response.json({ external: { google: true, discord: true } });
      if (String(url) === `${project}/functions/v1/account-login`) return Response.json({ ready: true });
      throw new Error('Unexpected network request');
    }
  };
  vm.runInNewContext(source, { window, URL, URLSearchParams, Response, Headers, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, atob, CustomEvent: class {} });
  return { api: window.IwtxzBackend, calls };
}

test('all confirmation flows use exactly the production root callbacks listed in Supabase', async () => {
  const f = fixture({ href: 'https://iwtxz.su/index.html?_ui=old&redirect_to=http://localhost:3000&next=https://evil.example/#access_token=untrusted' });
  await f.api.request('/api/builder/auth/recover', post({ email: 'alice@example.com' }));
  await f.api.request('/api/builder/auth/email', post({ email: 'alice@example.com' }));
  for (const provider of ['google', 'discord']) {
    await f.api.request('/api/builder/auth/oauth', post({ provider }));
    await f.api.request('/api/builder/auth/oauth', post({ provider, link: true }));
  }
  assert.equal(f.calls.find(call => call[0] === 'recover')[2].redirectTo, 'https://iwtxz.su/?auth=recovery');
  assert.equal(f.calls.find(call => call[0] === 'update')[2].emailRedirectTo, 'https://iwtxz.su/?auth=email');
  for (const call of f.calls.filter(call => call[0] === 'oauth')) assert.equal(call[1].options.redirectTo, 'https://iwtxz.su/?auth=callback');
  for (const call of f.calls.filter(call => call[0] === 'link')) assert.equal(call[1].options.redirectTo, 'https://iwtxz.su/?auth=link');
});

test('production configuration cannot initiate a PKCE confirmation from localhost or an unrelated origin', async () => {
  for (const href of ['http://localhost:3000/', 'http://127.0.0.1:8000/', 'https://iwtxz.su.evil.example/', 'https://unrelated.example/?redirect=https://iwtxz.su']) {
    for (const [path, body] of [['recover', { email: 'alice@example.com' }], ['email', { email: 'alice@example.com' }], ['oauth', { provider: 'google' }], ['oauth', { provider: 'discord', link: true }]]) {
      const f = fixture({ href });
      await assert.rejects(f.api.request(`/api/builder/auth/${path}`, post(body)), { code: 'auth_origin_mismatch' });
      assert.equal(f.calls.some(call => ['recover', 'update', 'oauth', 'link'].includes(call[0])), false, href + ' ' + path);
    }
  }
});

test('invalid configured callback origins cannot turn the confirmation flow into an open redirect', async () => {
  for (const authSiteUrl of ['javascript:alert(1)', 'http://iwtxz.su', 'https://user:password@iwtxz.su', 'https://iwtxz.su/?next=https://evil.example', 'https://iwtxz.su/#fragment', 'https://iwtxz.su/callback', 'https://evil.example']) {
    const f = fixture({ authSiteUrl });
    await assert.rejects(f.api.request('/api/builder/auth/recover', post({ email: 'alice@example.com' })));
    assert.equal(f.calls.some(call => call[0] === 'recover'), false, authSiteUrl);
  }
});

test('local development needs its own explicitly configured same-origin callback', async () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:8000']) {
    const f = fixture({ href: `${origin}/index.html?next=elsewhere`, authSiteUrl: origin });
    await f.api.request('/api/builder/auth/recover', post({ email: 'alice@example.com' }));
    assert.equal(f.calls.find(call => call[0] === 'recover')[2].redirectTo, `${origin}/?auth=recovery`);
  }
});

test('processed confirmation callbacks remove credentials and preserve unrelated page preferences', async () => {
  const f = fixture({ href: 'https://iwtxz.su/?auth=recovery&code=one-time-secret&_ui=current&view=profile', redirectType: 'PASSWORD_RECOVERY' });
  assert.equal((await f.api.request('/api/builder/auth/me')).recoveryRequired, true);
  const cleaned = new URL(f.calls.find(call => call[0] === 'history')[1]);
  assert.equal(cleaned.origin, 'https://iwtxz.su');
  assert.equal(cleaned.searchParams.get('_ui'), 'current');
  assert.equal(cleaned.searchParams.get('view'), 'profile');
  assert.equal(cleaned.searchParams.has('auth'), false);
  assert.equal(cleaned.searchParams.has('code'), false);
  assert.equal(cleaned.hash, '');
});
