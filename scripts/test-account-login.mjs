import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createLoginHandler } from '../supabase/functions/account-login/handler.mjs';

const url = 'https://account-fixture.supabase.co';
const origin = 'https://iwtxz.su';
const serviceKey = 'test-service-key-never-return-this';
const anonKey = 'test-public-key';
const privateEmail = 'private-mailbox@example.test';
const password = 'Existing-password!';
const successfulTokens = { access_token: 'access-token', refresh_token: 'refresh-token' };

function fixture(options = {}) {
  const calls = [];
  const handler = createLoginHandler({ url, anonKey, serviceKey, cryptoImpl: webcrypto,
    async fetchImpl(address, init) {
      const body = JSON.parse(init.body);
      calls.push({ address, init, body });
      if (options.networkFailure) throw new Error(`Private failure: ${privateEmail} ${serviceKey}`);
      const path = new URL(address).pathname;
      let data, status = 200;
      if (path.endsWith('builder_private_login_attempt')) {
        if (options.rateFailure) return Response.json({ error: privateEmail }, { status: 503 });
        data = options.allowed === undefined ? true : options.allowed;
      } else if (path.endsWith('builder_private_login_email')) {
        if (options.resolverFailure) return Response.json({ error: privateEmail }, { status: 503 });
        data = options.email === undefined ? privateEmail : options.email;
      } else {
        status = options.authStatus || 200;
        data = options.authData || { ...successfulTokens, user: { email: privateEmail }, provider_token: 'provider-secret', ...options.extraAuthData };
      }
      return Response.json(data, { status });
    }
  });
  const request = (input = { username: 'alice', password }, headers = {}, method = 'POST') => new Request(url + '/functions/v1/account-login', {
    method, headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1', ...headers },
    ...(method === 'POST' ? { body: typeof input === 'string' ? input : JSON.stringify(input) } : {})
  });
  return { handler, calls, request };
}

async function jsonResult(handler, request) {
  const response = await handler(request);
  const text = await response.text();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!text.includes(privateEmail), text);
  assert.ok(!text.includes(serviceKey), text);
  assert.ok(!text.includes('provider-secret'), text);
  return { response, text, body: text ? JSON.parse(text) : null };
}

test('username password login resolves privately, checks the real password with Auth, and returns tokens only', async () => {
  const f = fixture();
  const result = await jsonResult(f.handler, f.request({ username: ' Alice ', password }));
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, successfulTokens);
  assert.deepEqual(f.calls.map(call => new URL(call.address).pathname), [
    '/rest/v1/rpc/builder_private_login_attempt', '/rest/v1/rpc/builder_private_login_email', '/auth/v1/token'
  ]);
  const [limit, resolver, auth] = f.calls;
  assert.equal(resolver.body.requested_username, 'alice');
  assert.deepEqual(auth.body, { email: privateEmail, password });
  assert.equal(new URL(auth.address).searchParams.get('grant_type'), 'password');
  assert.equal(auth.init.headers.apikey, anonKey);
  assert.equal(auth.init.headers.authorization, undefined);
  assert.equal(resolver.init.headers.authorization, `Bearer ${serviceKey}`);
  assert.equal(limit.body.attempt_keys.length, 2);
  for (const key of limit.body.attempt_keys) assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(limit.init.signal instanceof AbortSignal);
  assert.equal(result.response.headers.get('access-control-allow-origin'), origin);
});

test('unknown usernames follow the password grant and have the same outward failure as wrong passwords', async () => {
  const known = fixture({ authStatus: 400, authData: { error_description: `Bad credentials for ${privateEmail}` } });
  const unknown = fixture({ email: null, authStatus: 400, authData: { msg: 'Unknown account' } });
  const first = await jsonResult(known.handler, known.request());
  const second = await jsonResult(unknown.handler, unknown.request());
  assert.equal(first.response.status, 401);
  assert.equal(second.response.status, 401);
  assert.deepEqual(first.body, second.body);
  assert.equal(unknown.calls.at(-1).body.email, 'alice@accounts.iwtxz.ru');
  assert.equal(unknown.calls.at(-1).body.password, password);
});

test('rate limits apply before email lookup and fail closed for false or malformed results', async () => {
  for (const allowed of [false, null, 'true', {}, 1]) {
    const f = fixture({ allowed });
    const result = await jsonResult(f.handler, f.request());
    assert.equal(result.response.status, 429);
    assert.equal(f.calls.length, 1);
    assert.equal(result.body.code, 'over_request_rate_limit');
  }
  for (const options of [{ rateFailure: true }, { networkFailure: true }, { resolverFailure: true }]) {
    const f = fixture(options);
    const result = await jsonResult(f.handler, f.request());
    assert.equal(result.response.status, 503);
    assert.equal(result.body.code, 'login_unavailable');
    assert.ok(f.calls.every(call => !call.address.includes('/auth/v1/token')));
  }
});

test('account rate key remains stable across different networks without storing usernames or IPs', async () => {
  const f = fixture({ allowed: false });
  await f.handler(f.request(undefined, { 'x-forwarded-for': '192.0.2.1' }));
  await f.handler(f.request(undefined, { 'x-forwarded-for': '198.51.100.5' }));
  assert.equal(f.calls[0].body.attempt_keys[0], f.calls[1].body.attempt_keys[0]);
  assert.notEqual(f.calls[0].body.attempt_keys[1], f.calls[1].body.attempt_keys[1]);
  assert.doesNotMatch(JSON.stringify(f.calls.map(call => call.body)), /alice|192\.0\.2|198\.51\.100/);
});

test('downstream Auth rate limits and malformed token responses never disclose emails', async () => {
  const limited = fixture({ authStatus: 429, authData: { email: privateEmail, message: serviceKey } });
  assert.equal((await jsonResult(limited.handler, limited.request())).response.status, 429);
  for (const authData of [{}, { access_token: 'a' }, { access_token: 123, refresh_token: 'r' }, { access_token: '', refresh_token: 'r' }, { access_token: 'a', refresh_token: '' }, { access_token: 'a', refresh_token: null }]) {
    const f = fixture({ authData });
    assert.equal((await jsonResult(f.handler, f.request())).response.status, 401);
  }
});

test('invalid usernames, missing passwords and overlong passwords are rejected before private lookups', async () => {
  for (const input of [null, [], {}, { username: 'al', password }, { username: '_alice', password }, { username: 'a'.repeat(33), password }, { username: 'alice@example.test', password }, { username: 'алиса', password }, { username: 'alice', password: '' }, { username: 'alice', password: 123 }, { username: 'alice', password: 'x'.repeat(129) }, '{broken']) {
    const f = fixture();
    const result = await jsonResult(f.handler, f.request(input));
    assert.equal(result.response.status, 400, JSON.stringify(input));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.handler(f.request({ username: 'alice', password: 'x'.repeat(128) }))).status, 200);
});

test('body byte limit cannot be bypassed using UTF-8 characters or chunked requests', async () => {
  for (const value of ['x'.repeat(2049), JSON.stringify({ username: 'alice', password, extra: 'ж'.repeat(1100) })]) {
    const f = fixture();
    const result = await jsonResult(f.handler, f.request(value));
    assert.equal(result.response.status, 413);
    assert.equal(f.calls.length, 0);
  }
  let canceled = false;
  const f = fixture();
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1100)); controller.enqueue(new Uint8Array(1100)); },
    cancel() { canceled = true; }
  });
  const result = await jsonResult(f.handler, new Request(url, { method: 'POST', headers: { origin }, body, duplex: 'half' }));
  assert.equal(result.response.status, 413);
  assert.equal(canceled, true);
  assert.equal(f.calls.length, 0);
});

test('CORS permits only project origins, rejects other origins before any backend access, and supports preflight', async () => {
  for (const badOrigin of ['https://iwtxz.su.evil.example', 'http://iwtxz.su', 'https://elsewhere.test', 'null']) {
    const f = fixture();
    const response = await f.handler(f.request(undefined, { origin: badOrigin }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(f.calls.length, 0);
  }
  for (const allowedOrigin of [origin, 'https://www.iwtxz.su']) {
    const f = fixture();
    const response = await f.handler(f.request(null, { origin: allowedOrigin }, 'OPTIONS'));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.match(response.headers.get('access-control-allow-headers'), /apikey/);
    assert.equal(f.calls.length, 0);
  }
});

test('healthcheck returns no account data, unknown methods and missing deployment config fail safely', async () => {
  const f = fixture();
  const health = await jsonResult(f.handler, f.request(null, {}, 'GET'));
  assert.deepEqual(health.body, { ready: true });
  assert.equal(f.calls[0].body.requested_username, '__iwtxz_healthcheck__');
  const denied = await jsonResult(f.handler, f.request(null, {}, 'DELETE'));
  assert.equal(denied.response.status, 405);
  const handler = createLoginHandler({ url, anonKey, cryptoImpl: webcrypto, fetchImpl() { throw new Error('Unexpected backend call'); } });
  assert.equal((await jsonResult(handler, f.request())).response.status, 503);
});
