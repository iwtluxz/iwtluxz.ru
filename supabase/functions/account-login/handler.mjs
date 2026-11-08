const origins = new Set(['https://iwtxz.su', 'https://www.iwtxz.su']);
const aliasDomain = 'accounts.iwtxz.ru';

export function createLoginHandler({ url, anonKey, serviceKey, fetchImpl = fetch, cryptoImpl = crypto }) {
  return async function handle(request) {
    const origin = request.headers.get('origin');
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'vary': 'Origin' };
    if (origin && !origins.has(origin)) return Response.json({ error: 'Недопустимый адрес сайта.' }, { status: 403, headers });
    if (origin) headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'content-type, apikey, authorization';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    const reply = (value, status = 200) => Response.json(value, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!url || !anonKey || !serviceKey) return reply({ error: 'Вход по логину ещё не настроен.' }, 503);
    const rpc = async (name, body) => {
      const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('Account service unavailable');
      return response.json();
    };
    try {
      if (request.method === 'GET') {
        await rpc('builder_private_login_email', { requested_username: '__iwtxz_healthcheck__' });
        return reply({ ready: true });
      }
      if (request.method !== 'POST') return reply({ error: 'Используй POST.' }, 405);
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'Введи логин и пароль.' }, 400);
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2048) { await reader.cancel(); return reply({ error: 'Запрос слишком большой.' }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let input;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: 'Введи логин и пароль.' }, 400); }
      const username = typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
      const password = input?.password;
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username) || typeof password !== 'string' || !password || password.length > 128) {
        return reply({ error: 'Введи логин и пароль.' }, 400);
      }
      const encoder = new TextEncoder();
      const key = await cryptoImpl.subtle.importKey('raw', encoder.encode(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const hash = async value => [...new Uint8Array(await cryptoImpl.subtle.sign('HMAC', key, encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      // Account limits remain effective even when a client changes its network address.
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const allowed = await rpc('builder_private_login_attempt', { attempt_keys: await Promise.all([hash(`user:${username}`), hash(`ip:${ip}`)]) });
      if (allowed !== true) return reply({ error: 'Слишком много попыток. Подожди пять минут.', code: 'over_request_rate_limit' }, 429);
      const resolvedEmail = await rpc('builder_private_login_email', { requested_username: username });
      // Unknown users take the same Auth password path and get the same outward response.
      const email = typeof resolvedEmail === 'string' && resolvedEmail ? resolvedEmail : `${username}@${aliasDomain}`;
      const response = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(12000)
      });
      const data = await response.json();
      if (response.status === 429) return reply({ error: 'Слишком много попыток. Попробуй позже.', code: 'over_request_rate_limit' }, 429);
      if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token) {
        return reply({ error: 'Неверный логин или пароль.', code: 'invalid_credentials' }, 401);
      }
      // No email, profile data, service credentials or provider tokens leave this function.
      return reply({ access_token: data.access_token, refresh_token: data.refresh_token });
    } catch {
      return reply({ error: 'Не удалось завершить вход. Попробуй ещё раз.', code: 'login_unavailable' }, 503);
    }
  };
}
