(() => {
  "use strict";

  const maximumUploadBytes = 4 * 1024 * 1024;
  const mediaKinds = new Set(["avatar", "background", "music", "musicCover"]);
  const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/webm"]);
  const videoTypes = new Set(["video/mp4", "video/webm"]);
  const reservedUsernames = new Set(["iwtlu", "shakzy", "strelokk", "icetearz", "eris", "admin", "api", "index", "assets"]);
  let client;

  function error(status, message, code = "request_failed") {
    return Object.assign(new Error(message), { status, code });
  }

  function config() {
    const value = window.IWTXZ_BACKEND_CONFIG;
    if (!value || value.provider !== "supabase" || typeof value.url !== "string" || typeof value.publishableKey !== "string" || !value.url.trim() || !value.publishableKey.trim()) {
      throw error(503, "Сервер кабинета ещё не подключён. Владелец сайта должен настроить backend-config.js.", "backend_not_configured");
    }
    let url;
    try { url = new URL(value.url); } catch { throw error(503, "Неверный адрес сервера в backend-config.js.", "backend_not_configured"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
      throw error(503, "Для сервера нужен HTTPS-адрес проекта Supabase без дополнительных путей.", "backend_not_configured");
    }
    const key = value.publishableKey.trim();
    let legacyRole;
    if (key.split(".").length === 3) {
      try { legacyRole = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; } catch {}
    }
    if (!key.startsWith("sb_publishable_") && legacyRole !== "anon") {
      throw error(503, "В настройках нужен публичный publishable/anon key. Секретный ключ использовать нельзя.", "backend_not_configured");
    }
    const accountEmailDomain = value.accountEmailDomain || "accounts.iwtxz.ru";
    const bucket = value.bucket || "profile-assets";
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(accountEmailDomain) || !/^[a-z0-9_-]+$/.test(bucket)) {
      throw error(503, "Неверные параметры сервера в backend-config.js.", "backend_not_configured");
    }
    return { url: url.origin, key, accountEmailDomain: accountEmailDomain.toLowerCase(), bucket };
  }

  function isConfigured() {
    try { config(); return true; } catch { return false; }
  }

  async function timedFetch(input, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), /\/storage\/v1\/object\//.test(String(input)) ? 45000 : 15000);
    try { return await window.fetch(input, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); }
  }

  function createSupabaseClient(authOptions = {}) {
    const settings = config();
    if (typeof window.supabase?.createClient !== "function") {
      throw error(503, "Не загрузилась библиотека сервера. Обнови страницу.", "backend_library_missing");
    }
    return window.supabase.createClient(settings.url, settings.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, ...authOptions },
      global: { fetch: timedFetch }
    });
  }

  function getClient() {
    config();
    if (client) return client;
    client = createSupabaseClient();
    client.auth.onAuthStateChange((event) => {
      queueMicrotask(() => window.dispatchEvent(new CustomEvent("iwtxz-auth-change", { detail: { event } })));
    });
    return client;
  }

  function normalizeUsername(value) {
    const username = String(value ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
      throw error(400, "Логин: 3–32 символа, латинские буквы, цифры, _ и -.", "invalid_username");
    }
    return username === "strelok" ? "strelokk" : username;
  }

  function validatePassword(value) {
    if (typeof value !== "string" || value.length < 8 || value.length > 128) {
      throw error(400, "Пароль должен содержать от 8 до 128 символов.", "invalid_password");
    }
    return value;
  }

  function publicUrl(username) { return `/profile.html?u=${encodeURIComponent(username)}`; }

  function translateFailure(cause, operation = "request") {
    if (cause?.status && cause?.code && cause instanceof Error && !cause.name?.startsWith("Auth")) return cause;
    const code = cause?.code || "";
    if (["invalid_credentials", "invalid_grant"].includes(code)) {
      return error(401, operation === "password" ? "Текущий пароль неверный." : "Неверный логин или пароль.", operation === "password" ? "invalid_password" : "invalid_login");
    }
    if (["user_already_exists", "email_exists", "user_already_registered"].includes(code)) return error(409, "Этот логин уже занят.", "username_taken");
    if (code === "weak_password") return error(400, "Пароль слишком простой. Выбери другой пароль.", "invalid_password");
    if (code === "same_password") return error(400, "Новый пароль должен отличаться от текущего.", "invalid_password");
    if (code === "email_not_confirmed") return error(403, "Сервер требует подтверждение служебного адреса. Владелец должен отключить Confirm email для входа по логину.", "email_confirmation_required");
    if (["email_address_not_authorized", "email_address_invalid"].includes(code)) return error(503, "Сервер регистрации ещё не настроен для входа по логину.", "backend_setup_required");
    if (code === "signup_disabled") return error(403, "Регистрация на сервере отключена.", "signup_disabled");
    if (cause?.status === 429 || code.startsWith("over_")) return error(429, "Слишком много попыток. Попробуй немного позже.", "rate_limited");
    if (["session_not_found", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt", "user_not_found"].includes(code) || cause?.name === "AuthSessionMissingError") {
      return error(401, "Время входа истекло. Войди ещё раз.", "unauthorized");
    }
    if (["PGRST202", "PGRST205", "42P01", "42883"].includes(code)) return error(503, "База кабинета ещё не настроена. Владелец должен выполнить SQL из папки supabase.", "backend_setup_required");
    if (code === "23505") return error(409, "Этот логин уже занят.", "username_taken");
    if (["PGRST301", "PGRST302"].includes(code)) return error(401, "Время входа истекло. Войди ещё раз.", "unauthorized");
    if (code === "42501") return error(403, "Нет доступа к этой операции.", "forbidden");
    if (cause?.message && code === "P0001") return error(400, String(cause.message).slice(0, 350), "invalid_setting");
    return error(cause?.status >= 400 && cause?.status < 500 ? cause.status : 503, "Сервер временно недоступен. Проверь соединение и попробуй ещё раз.", "service_unavailable");
  }

  function throwIfError(result, operation) {
    if (result?.error) throw translateFailure(result.error, operation);
    return result?.data;
  }

  async function accountForUser(user) {
    const result = await getClient().from("profile_accounts").select("username").eq("user_id", user.id).maybeSingle();
    const row = throwIfError(result);
    if (!row?.username) throw error(503, "Аккаунт существует, но его профиль не настроен на сервере.", "backend_setup_required");
    return { userId: user.id, username: normalizeUsername(row.username) };
  }

  async function requireAccount() {
    const result = await getClient().auth.getUser();
    const data = throwIfError(result);
    if (!data?.user) throw error(401, "Сначала войди в аккаунт.", "unauthorized");
    return accountForUser(data.user);
  }

  async function getMe() {
    const session = throwIfError(await getClient().auth.getSession());
    if (!session?.session) return { user: null };
    try {
      const account = await requireAccount();
      return { user: { username: account.username } };
    } catch (cause) {
      if (cause.code === "unauthorized") {
        await getClient().auth.signOut({ scope: "local" });
        return { user: null };
      }
      throw cause;
    }
  }

  async function authenticate(mode, body) {
    const username = normalizeUsername(body.username);
    const password = mode === "signup" ? validatePassword(body.password) : body.password;
    if (typeof password !== "string" || !password || password.length > 128) throw error(400, "Введите пароль.", "invalid_password");
    const email = `${username}@${config().accountEmailDomain}`;
    let result;
    if (mode === "signup") {
      const data = { username };
      const ownerClaim = body.ownerClaim ?? body.owner_claim;
      if (reservedUsernames.has(username) && !ownerClaim) {
        throw error(409, "Этот логин закреплён за существующей страницей. Для регистрации владельца нужен код подтверждения.", "reserved_username");
      }
      if (ownerClaim) {
        if (typeof ownerClaim !== "string" || ownerClaim.length > 256) throw error(400, "Неверный код владельца.", "invalid_owner_claim");
        data.owner_claim = ownerClaim.trim();
      }
      result = await getClient().auth.signUp({ email, password, options: { data } });
    } else result = await getClient().auth.signInWithPassword({ email, password });
    const data = throwIfError(result, mode);
    if (!data?.session || !data?.user) {
      throw error(503, "Регистрация требует подтверждение служебной почты. Владелец должен отключить Confirm email в настройках сервера.", "email_confirmation_required");
    }
    const account = await accountForUser(data.user);
    if (account.username !== username) {
      await getClient().auth.signOut({ scope: "local" });
      throw error(409, "Логин аккаунта не совпадает с профилем. Обратись к владельцу сайта.", "identity_mismatch");
    }
    return { user: { username: account.username } };
  }

  async function rpc(name, input) {
    const result = await getClient().rpc(name, input);
    const data = throwIfError(result);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw error(503, "Сервер вернул неверные настройки профиля.", "invalid_response");
    return data;
  }

  async function getPublishedProfile(value) {
    const username = normalizeUsername(value);
    const result = await getClient().from("profile_published").select("username,settings,published_at").eq("username", username).maybeSingle();
    const row = throwIfError(result);
    if (!row?.settings || typeof row.settings !== "object" || Array.isArray(row.settings)) throw error(404, "Страница пока не опубликована или не существует.", "not_found");
    const publishedAt = Date.parse(row.published_at);
    return { ...row.settings, id: username, owner: username, publicUrl: publicUrl(username), publishedAt: Number.isFinite(publishedAt) ? publishedAt : row.settings.publishedAt };
  }

  function ownership(input, account) {
    if ((input.owner && input.owner !== account.username) || (input.id && input.id !== account.username)) {
      throw error(403, "Можно изменять только свою страницу.", "forbidden");
    }
  }

  function sniffType(bytes, kind) {
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
    if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
    if (ascii(0, 4) === "OggS") return "audio/ogg";
    if (ascii(0, 3) === "ID3" || (bytes.length > 1 && bytes[0] === 255 && (bytes[1] & 224) === 224)) return "audio/mpeg";
    if (ascii(4, 8) === "ftyp") return kind === "music" ? "audio/mp4" : "video/mp4";
    if ([26, 69, 223, 163].every((byte, index) => bytes[index] === byte)) return kind === "music" ? "audio/webm" : "video/webm";
    return "";
  }

  async function uploadAsset(url, options, account) {
    const kind = url.searchParams.get("kind");
    if (!mediaKinds.has(kind)) throw error(400, "Неизвестный тип файла.", "invalid_asset_kind");
    const body = options.body;
    if (!body || typeof body.arrayBuffer !== "function") throw error(400, "Выбери файл для загрузки.", "invalid_asset");
    if (!body.size || body.size > maximumUploadBytes) throw error(413, "Размер файла должен быть больше нуля и не больше 4 МБ.", "request_too_large");
    const declared = (new Headers(options.headers).get("content-type") || body.type || "").split(";")[0].trim().toLowerCase();
    const allowed = kind === "music" ? audioTypes : kind === "background" ? new Set([...imageTypes, ...videoTypes]) : imageTypes;
    if (!allowed.has(declared)) throw error(415, "Этот формат файла не поддерживается.", "invalid_asset_type");
    const bytes = new Uint8Array(await body.arrayBuffer());
    if (!bytes.length || bytes.length > maximumUploadBytes) throw error(413, "Максимальный размер файла — 4 МБ.", "request_too_large");
    const type = sniffType(bytes, kind);
    if (!allowed.has(type)) throw error(415, "Содержимое файла не соответствует поддерживаемому формату.", "invalid_asset_type");
    if (!/^[a-f0-9-]{36}$/i.test(account.userId)) throw error(503, "Сервер вернул неверный аккаунт.", "invalid_response");
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "webm", "video/mp4": "mp4", "video/webm": "webm" }[type];
    const nonce = [...window.crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const path = `${account.userId}/${nonce}.${extension}`;
    const bucket = getClient().storage.from(config().bucket);
    throwIfError(await bucket.upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: false }));
    const publicResult = bucket.getPublicUrl(path);
    const publicAssetUrl = publicResult?.data?.publicUrl;
    let parsed;
    try { parsed = new URL(publicAssetUrl); } catch { throw error(503, "Не удалось получить адрес загруженного файла.", "invalid_response"); }
    if (parsed.origin !== config().url || !parsed.pathname.endsWith("/" + path)) throw error(503, "Сервер вернул неверный адрес файла.", "invalid_response");
    const name = String(url.searchParams.get("name") || body.name || "file").replace(/[\r\n\x00-\x1f\\/]/g, "").slice(0, 150);
    return { url: parsed.href, name, size: bytes.length, type, kind };
  }

  function jsonBody(options) {
    if (options.body === undefined || options.body === "") return {};
    try {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      return body;
    } catch { throw error(400, "Некорректный запрос.", "invalid_json"); }
  }

  async function request(path, options = {}) {
    getClient();
    if (typeof path !== "string" || !path.startsWith("/api/builder/")) throw error(404, "Страница не найдена.", "not_found");
    const url = new URL(path, window.location.origin);
    const method = String(options.method || "GET").toUpperCase();
    const mode = url.pathname.split("/").pop();
    const isGet = url.pathname === "/api/builder/auth/me" || /^\/api\/builder\/sites\/(list|get)$/.test(url.pathname) || /^\/api\/builder\/profile\/[a-z0-9_-]+$/i.test(url.pathname);
    if (method !== (isGet ? "GET" : "POST")) throw error(405, isGet ? "Используйте GET." : "Используйте POST.", "method_not_allowed");
    if (url.pathname === "/api/builder/auth/me") return getMe();
    if (/^\/api\/builder\/auth\/(signup|login)$/.test(url.pathname)) return authenticate(mode, jsonBody(options));
    if (url.pathname === "/api/builder/auth/logout") {
      throwIfError(await getClient().auth.signOut({ scope: "local" }));
      return { ok: true };
    }
    if (/^\/api\/builder\/profile\/[a-z0-9_-]+$/i.test(url.pathname)) return { site: await getPublishedProfile(mode) };
    const account = await requireAccount();
    if (url.pathname === "/api/builder/auth/password") {
      const body = jsonBody(options);
      const newPassword = validatePassword(body.newPassword);
      if (typeof body.currentPassword !== "string" || !body.currentPassword || body.currentPassword.length > 128) throw error(400, "Введите текущий пароль.", "invalid_password");
      // Verify the old password explicitly: hosted Auth versions may ignore current_password on updateUser.
      // The isolated client never persists its short-lived session or broadcasts into the main client.
      const nonce = [...window.crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const verificationClient = createSupabaseClient({
        persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: `iwtxz-password-verification-${nonce}`
      });
      try {
        const verified = throwIfError(await verificationClient.auth.signInWithPassword({
          email: `${account.username}@${config().accountEmailDomain}`, password: body.currentPassword
        }), "password");
        if (!verified?.session || verified?.user?.id !== account.userId) {
          throw error(401, "Текущий пароль неверный.", "invalid_password");
        }
        throwIfError(await getClient().auth.updateUser({ password: newPassword }), "password");
        const revocation = await getClient().auth.signOut({ scope: "others" });
        return { ok: true, user: { username: account.username }, ...(revocation.error ? { sessionRevocationWarning: true } : {}) };
      } finally {
        try { await verificationClient.auth.signOut({ scope: "local" }); } catch {}
        try { await verificationClient.auth.stopAutoRefresh?.(); } catch {}
      }
    }
    if (url.pathname === "/api/builder/sites/list" || url.pathname === "/api/builder/sites/get") {
      if (mode === "get" && url.searchParams.get("id") && url.searchParams.get("id") !== account.username) throw error(404, "Страница не найдена.", "not_found");
      const site = await rpc("builder_get_profile");
      return mode === "list" ? { sites: [site] } : { site };
    }
    if (url.pathname === "/api/builder/sites/save") {
      const body = jsonBody(options);
      const site = body.site ?? body;
      ownership(site, account);
      return { site: await rpc("builder_save_profile", { input: site }) };
    }
    if (url.pathname === "/api/builder/sites/delete") {
      ownership(jsonBody(options), account);
      return rpc("builder_delete_profile");
    }
    if (url.pathname === "/api/builder/publish") return rpc("builder_publish_profile");
    if (url.pathname === "/api/builder/assets/upload") return uploadAsset(url, options, account);
    throw error(404, "Страница не найдена.", "not_found");
  }

  window.IwtxzBackend = Object.freeze({ isConfigured, request, getPublishedProfile });
})();
