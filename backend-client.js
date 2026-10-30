(() => {
  "use strict";

  const maximumUploadBytes = 4 * 1024 * 1024;
  const mediaKinds = new Set(["avatar", "background", "music", "musicCover", "customFont"]);
  const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/webm"]);
  const videoTypes = new Set(["video/mp4", "video/webm"]);
  const fontTypes = new Set(["font/woff", "font/woff2", "font/ttf", "font/otf"]);
  const declaredFontTypes = new Set([...fontTypes, "application/font-woff", "application/x-font-woff", "application/x-font-ttf", "application/x-font-opentype", "application/vnd.ms-opentype", "application/octet-stream", ""]);
  const reservedUsernames = new Set(["iwtlu", "shakzy", "strelokk", "icetearz", "eris", "admin", "api", "index", "assets"]);
  let client;
  let publicClient;
  const clientContexts = new WeakMap();
  const memoryStorage = new Map();
  let customizationReady = false;

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

  function requestTimeout() {
    return error(504, "Не удалось завершить запрос вовремя. Попробуй ещё раз.", "request_timeout");
  }

  function authSessionScope(storage, storageKey, fallback) {
    try {
      const session = JSON.parse(storage.getItem(storageKey));
      const payload = session?.access_token?.split(".")[1];
      const sessionId = payload && JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).session_id;
      if (typeof sessionId === "string" && /^[a-z0-9_-]{1,80}$/i.test(sessionId)) return sessionId;
    } catch {}
    return fallback;
  }

  async function boundedAuthLock(context, name, acquireTimeout, action) {
    const retiredResult = () => ({ data: { session: null, user: null }, error: requestTimeout() });
    if (context.retired) return retiredResult();
    const controller = new AbortController();
    context.controllers.add(controller);
    let timer;
    let abort;
    const interruption = new Promise((resolve, reject) => {
      // SDK 2.102 starts unobserved initial-session notifications. A retired
      // client's lock must settle without rejecting those background tasks.
      abort = () => context.retired ? resolve(retiredResult()) : reject(requestTimeout());
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const run = () => {
        clearTimeout(timer);
        if (context.retired) return retiredResult();
        if (controller.signal.aborted) throw requestTimeout();
        return Promise.race([Promise.resolve().then(action), interruption]);
      };
      if (typeof window.navigator?.locks?.request !== "function") return await run();
      // Auto-refresh uses a zero timeout to skip a busy lock, never queue it.
      const options = acquireTimeout === 0 ? { mode: "exclusive", ifAvailable: true }
        : { mode: "exclusive", signal: controller.signal };
      if (acquireTimeout !== 0) timer = setTimeout(() => controller.abort(), acquireTimeout > 0 ? Math.min(acquireTimeout, 5000) : 5000);
      return await Promise.race([
        window.navigator.locks.request(context.lockName?.(name) || name, options, async (lock) => {
          if (!lock) throw Object.assign(requestTimeout(), { isAcquireTimeout: true });
          return run();
        }),
        interruption
      ]);
    } catch (cause) {
      if (context.retired) return retiredResult();
      if (controller.signal.aborted) throw requestTimeout();
      throw cause;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      context.controllers.delete(controller);
    }
  }

  function sessionStorage(context, storageKey, freshSession) {
    let sessionWritten = false;
    return {
      getItem(key) {
        if (context.retired || (freshSession && key === storageKey && !sessionWritten)) return null;
        try { return window.localStorage ? window.localStorage.getItem(key) : memoryStorage.get(key) ?? null; }
        catch { return memoryStorage.get(key) ?? null; }
      },
      setItem(key, value) {
        if (context.retired) return;
        if (key === storageKey) sessionWritten = true;
        memoryStorage.set(key, value);
        try { window.localStorage?.setItem(key, value); } catch {}
      },
      removeItem(key) {
        if (context.retired) return;
        memoryStorage.delete(key);
        try { window.localStorage?.removeItem(key); } catch {}
      }
    };
  }

  async function timedFetch(context, input, options = {}) {
    if (context.retired) throw requestTimeout();
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    context.controllers.add(controller);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(requestTimeout()); }, /\/storage\/v1\/object\//.test(String(input)) ? 45000 : 15000);
    });
    try {
      return await Promise.race([(async () => {
        const response = await window.fetch(input, { ...options, signal: controller.signal });
        const bytes = await response.arrayBuffer();
        if (context.retired || controller.signal.aborted) throw requestTimeout();
        return new Response(bytes.byteLength && ![204, 205, 304].includes(response.status) ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(), timeout]);
    } finally { clearTimeout(timer); context.controllers.delete(controller); options.signal?.removeEventListener("abort", abort); }
  }

  function createSupabaseClient(authOptions = {}, freshSession = false) {
    const settings = config();
    if (typeof window.supabase?.createClient !== "function") {
      throw error(503, "Не загрузилась библиотека сервера. Обнови страницу.", "backend_library_missing");
    }
    const context = { retired: false, controllers: new Set(), operations: new Set(), subscription: null };
    // Keep the new session separate from old open versions of the site. Those
    // clients may still complete a stalled refresh and write their old tokens.
    const storageKey = authOptions.storageKey || `iwtxz-${new URL(settings.url).hostname.split(".")[0]}-auth-v2`;
    const storage = sessionStorage(context, storageKey, freshSession);
    const initialScope = [...window.crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    // Tabs sharing one session still serialize refreshes. A deliberate login
    // starts without that session and cannot queue behind its abandoned lock.
    context.lockName = name => `${name}:session:${authSessionScope(storage, storageKey, initialScope)}`;
    const instance = window.supabase.createClient(settings.url, settings.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
        storageKey, storage,
        lock: (name, timeout, action) => boundedAuthLock(context, name, timeout, action), ...authOptions },
      global: { fetch: (input, options) => timedFetch(context, input, options) }
    });
    clientContexts.set(instance, context);
    return instance;
  }

  function getClient(freshSession = false) {
    config();
    if (freshSession && client) retireClient(client);
    if (client) return client;
    const instance = createSupabaseClient({}, freshSession);
    client = instance;
    const context = clientContexts.get(instance);
    const listener = instance.auth.onAuthStateChange((event) => {
      setTimeout(() => {
        if (!context.retired && client === instance) window.dispatchEvent(new CustomEvent("iwtxz-auth-change", { detail: { event } }));
      }, 0);
    });
    context.subscription = listener?.data?.subscription;
    return client;
  }

  function getPublicClient() {
    if (!publicClient) publicClient = createSupabaseClient({ persistSession: false, autoRefreshToken: false, storageKey: "iwtxz-public-profile-reader" });
    return publicClient;
  }

  function retireClient(instance) {
    const context = clientContexts.get(instance);
    if (!context || context.retired) return;
    context.retired = true;
    for (const controller of context.controllers) controller.abort();
    context.subscription?.unsubscribe();
    // There is no SDK destroy method. Disconnect the retired client's channel
    // so a late refresh cannot broadcast an obsolete session to another tab.
    const channel = instance.auth.broadcastChannel;
    if (channel) { instance.auth.broadcastChannel = null; channel.close(); }
    try { void Promise.resolve(instance.auth.stopAutoRefresh?.()).catch(() => {}); } catch {}
    try { void instance.auth.initialize?.().then(() => instance.auth.stopAutoRefresh?.()).catch(() => {}); } catch {}
    if (client === instance) { client = null; customizationReady = false; }
    if (publicClient === instance) publicClient = null;
  }

  async function boundedOperation(instance, action, options = {}) {
    const context = clientContexts.get(instance);
    const operation = {};
    context.operations.add(operation);
    let failure = null;
    const assertActive = () => { if (failure || context.retired) throw failure || requestTimeout(); };
    let timer;
    let cancel;
    const interruption = new Promise((_, reject) => {
      timer = setTimeout(() => {
        failure = requestTimeout();
        context.operations.delete(operation);
        if (!context.operations.size || options.authMutation) retireClient(instance);
        reject(failure);
      }, options.upload ? 60000 : 20000);
      cancel = () => {
        failure = error(499, "Запрос отменён.", "request_cancelled");
        context.operations.delete(operation);
        if (!context.operations.size || options.authMutation) retireClient(instance);
        reject(failure);
      };
      if (options.signal?.aborted) cancel();
      else options.signal?.addEventListener("abort", cancel, { once: true });
    });
    try {
      if (options.signal?.aborted) return await interruption;
      return await Promise.race([Promise.resolve().then(() => { assertActive(); return action(assertActive); }), interruption]);
    } catch (cause) {
      if (cause?.code === "request_timeout" && (context.operations.size <= 1 || options.authMutation)) retireClient(instance);
      throw cause;
    } finally {
      clearTimeout(timer);
      context.operations.delete(operation);
      options.signal?.removeEventListener("abort", cancel);
    }
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

  function publicUrl(username) {
    return window.IwtxzProfileLinks?.urlForUser(username) || `/profile.html?u=${encodeURIComponent(username)}`;
  }

  function translateFailure(cause, operation = "request") {
    if (cause?.code === "request_timeout" || cause?.originalError?.code === "request_timeout" || ["Сервер не ответил вовремя.", requestTimeout().message].some(message => String(cause?.message || "").includes(message))) return requestTimeout();
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
    if (cause?.message && ["P0001", "22023"].includes(code)) return error(400, String(cause.message).slice(0, 350), "invalid_setting");
    return error(cause?.status >= 400 && cause?.status < 500 ? cause.status : 503, "Сервер временно недоступен. Проверь соединение и попробуй ещё раз.", "service_unavailable");
  }

  function throwIfError(result, operation) {
    if (result?.error) throw translateFailure(result.error, operation);
    return result?.data;
  }

  async function accountForUser(user, assertActive = () => {}) {
    assertActive();
    const result = await getClient().from("profile_accounts").select("username").eq("user_id", user.id).maybeSingle();
    assertActive();
    const row = throwIfError(result);
    if (!row?.username) throw error(503, "Аккаунт существует, но его профиль не настроен на сервере.", "backend_setup_required");
    const account = { userId: user.id, username: normalizeUsername(row.username) };
    clientContexts.get(getClient()).account = account;
    return account;
  }

  function emptyOwnProfile(username) {
    const site = { id: username, owner: username, title: username, nickname: username, publishedAt: null };
    const legacy = {
      iwtlu: { nickname: "Ɨ ω ŧ Ł υ", description: "малыш, ты знала, что все закончится так", discord: "iwtluz", telegram: "https://t.me/iwtluz", steam: "https://steamcommunity.com/id/meintofores" },
      shakzy: { description: "Respect the past, create the future", discord: "mrshakzzy", avatar: "img/avatar_shakzy.jpg", background: "img/gif_shakzy.gif", backgroundType: "image", music: "sound/sound2.mp3", musicTitle: "RJ Pasin - Chad", musicCover: "img/shakzysoundicon.png" },
      strelokk: { description: "The only way to do great work is to love what you do", discord: "phantom576.", avatar: "img/strelokkavatar.gif", background: "img/artem.gif", backgroundType: "image", music: "sound/sound1.mp3", musicTitle: "whitek3d - STATUS", musicCover: "img/strelokksoundicon.png" }
    };
    return Object.assign(site, Object.hasOwn(legacy, username) ? legacy[username] : {});
  }

  async function readOwnProfile(assertActive) {
    const instance = getClient();
    const session = throwIfError(await instance.auth.getSession());
    assertActive();
    if (!session?.session) throw error(401, "Сначала войди в аккаунт.", "unauthorized");
    let account = clientContexts.get(instance).account;
    if (!account || account.userId !== session.session.user?.id) account = await requireAccount(assertActive);
    assertActive();
    // Read the owner-scoped rows directly. The legacy get-profile RPC can
    // stall independently; both tables retain their existing RLS policies.
    const [draftResult, publishedResult] = await Promise.all([
      instance.from("profile_drafts").select("settings").eq("user_id", account.userId).maybeSingle(),
      instance.from("profile_published").select("settings,published_at").eq("username", account.username).maybeSingle()
    ]);
    assertActive();
    const draft = throwIfError(draftResult);
    const published = throwIfError(publishedResult);
    const saved = draft ? draft.settings : published?.settings;
    if (saved !== undefined && (!saved || typeof saved !== "object" || Array.isArray(saved))) throw error(503, "Сервер вернул неверные настройки профиля.", "invalid_response");
    const stamp = Date.parse(published?.published_at);
    return { ...(saved || emptyOwnProfile(account.username)), id: account.username, owner: account.username,
      publishedAt: Number.isFinite(stamp) ? stamp : null, publicUrl: publicUrl(account.username) };
  }

  async function requireAccount(assertActive = () => {}) {
    const result = await getClient().auth.getUser();
    assertActive();
    const data = throwIfError(result);
    if (!data?.user) throw error(401, "Сначала войди в аккаунт.", "unauthorized");
    return accountForUser(data.user, assertActive);
  }

  async function getMe(assertActive) {
    const session = throwIfError(await getClient().auth.getSession());
    assertActive();
    if (!session?.session) return { user: null };
    try {
      const account = await requireAccount(assertActive);
      return { user: { username: account.username } };
    } catch (cause) {
      assertActive();
      if (cause.code === "unauthorized") {
        await getClient().auth.signOut({ scope: "local" });
        return { user: null };
      }
      throw cause;
    }
  }

  async function authenticate(mode, body, assertActive) {
    const username = normalizeUsername(body.username);
    const password = mode === "signup" ? validatePassword(body.password) : body.password;
    if (typeof password !== "string" || !password || password.length > 128) throw error(400, "Введите пароль.", "invalid_password");
    const email = `${username}@${config().accountEmailDomain}`;
    // Finish session recovery before creating an account: a blocked browser auth
    // lock must not create a server account and leave the sign-up screen waiting.
    throwIfError(await getClient().auth.getSession());
    assertActive();
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
    assertActive();
    if (!data?.session || !data?.user) {
      throw error(503, "Регистрация требует подтверждение служебной почты. Владелец должен отключить Confirm email в настройках сервера.", "email_confirmation_required");
    }
    const account = await accountForUser(data.user, assertActive);
    assertActive();
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

  async function readPublishedProfile(value) {
    const username = normalizeUsername(value);
    const result = await getPublicClient().from("profile_published").select("username,settings,published_at").eq("username", username).maybeSingle();
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
    if (kind === "customFont") {
      if (bytes.length < 12) return "";
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const signature = ascii(0, 4);
      if (["wOFF", "wOF2"].includes(signature)) {
        const minimum = signature === "wOFF" ? 44 : 48;
        if (bytes.length < minimum || view.getUint32(8) !== bytes.length || !view.getUint16(12)) return "";
        if (view.getUint32(16) > 32 * 1024 * 1024) return "";
        if (signature === "wOFF") {
          const count = view.getUint16(12);
          if (44 + count * 20 > bytes.length) return "";
          for (let index = 0; index < count; index += 1) {
            const offset = view.getUint32(44 + index * 20 + 4);
            const length = view.getUint32(44 + index * 20 + 8);
            if (offset < 44 + count * 20 || offset + length > bytes.length) return "";
          }
          return "font/woff";
        }
        return view.getUint32(20) > 0 && view.getUint32(20) <= bytes.length - 48 ? "font/woff2" : "";
      }
      if (signature !== "OTTO" && view.getUint32(0) !== 0x00010000 && signature !== "true") return "";
      const count = view.getUint16(4);
      if (!count || 12 + count * 16 > bytes.length) return "";
      for (let index = 0; index < count; index += 1) {
        const offset = view.getUint32(12 + index * 16 + 8);
        const length = view.getUint32(12 + index * 16 + 12);
        if (offset < 12 + count * 16 || offset + length > bytes.length) return "";
      }
      return signature === "OTTO" ? "font/otf" : "font/ttf";
    }
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

  async function uploadAsset(url, options, account, assertActive) {
    const kind = url.searchParams.get("kind");
    if (!mediaKinds.has(kind)) throw error(400, "Неизвестный тип файла.", "invalid_asset_kind");
    if (kind === "customFont") await requireCustomization();
    assertActive();
    const body = options.body;
    if (!body || typeof body.arrayBuffer !== "function") throw error(400, "Выбери файл для загрузки.", "invalid_asset");
    if (!body.size || body.size > maximumUploadBytes) throw error(413, "Размер файла должен быть больше нуля и не больше 4 МБ.", "request_too_large");
    const declared = (new Headers(options.headers).get("content-type") || body.type || "").split(";")[0].trim().toLowerCase();
    const allowed = kind === "customFont" ? fontTypes : kind === "music" ? audioTypes : kind === "background" ? new Set([...imageTypes, ...videoTypes]) : imageTypes;
    if (!(kind === "customFont" ? declaredFontTypes : allowed).has(declared)) throw error(415, "Этот формат файла не поддерживается.", "invalid_asset_type");
    const bytes = new Uint8Array(await body.arrayBuffer());
    assertActive();
    if (!bytes.length || bytes.length > maximumUploadBytes) throw error(413, "Максимальный размер файла — 4 МБ.", "request_too_large");
    const type = sniffType(bytes, kind);
    if (!allowed.has(type)) throw error(415, "Содержимое файла не соответствует поддерживаемому формату.", "invalid_asset_type");
    if (!/^[a-f0-9-]{36}$/i.test(account.userId)) throw error(503, "Сервер вернул неверный аккаунт.", "invalid_response");
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "webm", "video/mp4": "mp4", "video/webm": "webm", "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf" }[type];
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

  async function requireCustomization() {
    if (customizationReady) return;
    const result = await getClient().rpc("builder_capabilities");
    if (result?.error || result?.data?.profileSettingsVersion !== 2) {
      throw error(503, "Владелец сайта должен обновить сервер для новых настроек. Файл: supabase/migrations/20261030_profile_customization.sql. Твои сохранённые настройки не потеряны.", "backend_update_required");
    }
    customizationReady = true;
  }

  async function dispatchRequest(path, options = {}, assertActive) {
    if (typeof path !== "string" || !path.startsWith("/api/builder/")) throw error(404, "Страница не найдена.", "not_found");
    const url = new URL(path, window.location.origin);
    const method = String(options.method || "GET").toUpperCase();
    const mode = url.pathname.split("/").pop();
    const isGet = url.pathname === "/api/builder/auth/me" || /^\/api\/builder\/sites\/(list|get)$/.test(url.pathname) || /^\/api\/builder\/profile\/[a-z0-9_-]+$/i.test(url.pathname);
    if (method !== (isGet ? "GET" : "POST")) throw error(405, isGet ? "Используйте GET." : "Используйте POST.", "method_not_allowed");
    if (url.pathname === "/api/builder/auth/me") return getMe(assertActive);
    if (/^\/api\/builder\/auth\/(signup|login)$/.test(url.pathname)) return authenticate(mode, jsonBody(options), assertActive);
    if (url.pathname === "/api/builder/auth/logout") {
      throwIfError(await getClient().auth.signOut({ scope: "local" }));
      return { ok: true };
    }
    if (/^\/api\/builder\/profile\/[a-z0-9_-]+$/i.test(url.pathname)) return { site: await readPublishedProfile(mode) };
    if (url.pathname === "/api/builder/sites/list" || url.pathname === "/api/builder/sites/get") {
      const site = await readOwnProfile(assertActive);
      if (mode === "get" && url.searchParams.get("id") && url.searchParams.get("id") !== site.owner) throw error(404, "Страница не найдена.", "not_found");
      return mode === "list" ? { sites: [site] } : { site };
    }
    const account = await requireAccount(assertActive);
    assertActive();
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
        assertActive();
        if (!verified?.session || verified?.user?.id !== account.userId) {
          throw error(401, "Текущий пароль неверный.", "invalid_password");
        }
        throwIfError(await getClient().auth.updateUser({ password: newPassword }), "password");
        assertActive();
        const revocation = await getClient().auth.signOut({ scope: "others" });
        return { ok: true, user: { username: account.username }, ...(revocation.error ? { sessionRevocationWarning: true } : {}) };
      } finally {
        try { await verificationClient.auth.signOut({ scope: "local" }); } catch {}
        try { await verificationClient.auth.stopAutoRefresh?.(); } catch {}
      }
    }
    if (url.pathname === "/api/builder/sites/save") {
      const body = jsonBody(options);
      const site = body.site ?? body;
      ownership(site, account);
      if (site.font === "custom" || ["customFont", "musicPlayerStyle", "avatarShape", "nicknameGradient", "nicknameGradientStart", "nicknameGradientEnd", "nicknameGradientAngle", "discordUserId", "discordSync", "discordCardStyle", "discordCardColor", "discordCardOpacity", "discordCardRadius", "discordUseAvatar", "discordShowStatus", "discordShowBadges", "discordShowActivity", "profileBadges", "showButterfly"].some((key) => Object.hasOwn(site, key))) await requireCustomization();
      assertActive();
      return { site: { ...await rpc("builder_save_profile", { input: site }), publicUrl: publicUrl(account.username) } };
    }
    if (url.pathname === "/api/builder/sites/delete") {
      ownership(jsonBody(options), account);
      return rpc("builder_delete_profile");
    }
    if (url.pathname === "/api/builder/publish") return { ...await rpc("builder_publish_profile"), url: publicUrl(account.username) };
    if (url.pathname === "/api/builder/assets/upload") return uploadAsset(url, options, account, assertActive);
    throw error(404, "Страница не найдена.", "not_found");
  }

  async function request(path, options = {}) {
    // A deliberate login must not wait for an expired session's refresh or a
    // cancelled bootstrap. Retired clients cannot write over the new session.
    const freshSession = /^\/api\/builder\/auth\/(signup|login)$/.test(path) && String(options.method).toUpperCase() === "POST" && !options.signal?.aborted;
    const instance = typeof path === "string" && /^\/api\/builder\/profile\/[a-z0-9_-]+$/i.test(path) ? getPublicClient() : getClient(freshSession);
    return boundedOperation(instance, (assertActive) => dispatchRequest(path, options, assertActive), { ...options, authMutation: /^\/api\/builder\/auth\/(signup|login|password)$/.test(path) });
  }

  async function getPublishedProfile(username) {
    return boundedOperation(getPublicClient(), () => readPublishedProfile(username));
  }

  window.IwtxzBackend = Object.freeze({ isConfigured, request, getPublishedProfile });
})();
