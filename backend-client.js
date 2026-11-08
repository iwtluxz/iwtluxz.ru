(() => {
  "use strict";

  const maximumUploadBytes = 4 * 1024 * 1024;
  const mediaKinds = new Set(["avatar", "background", "music", "musicCover", "customFont", "favicon", "customCursor"]);
  const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/webm"]);
  const videoTypes = new Set(["video/mp4", "video/webm"]);
  const fontTypes = new Set(["font/woff", "font/woff2", "font/ttf", "font/otf"]);
  const declaredFontTypes = new Set([...fontTypes, "application/font-woff", "application/x-font-woff", "application/x-font-ttf", "application/x-font-opentype", "application/vnd.ms-opentype", "application/octet-stream", ""]);
  const reservedUsernames = new Set(["iwtlu", "shakzy", "icetearz", "eris", "admin", "api", "index", "assets"]);
  let client;
  let publicClient;
  const clientContexts = new WeakMap();
  const memoryStorage = new Map();
  let customizationReady = false;
  let profileFeaturesReady = false;
  const recoveryStorageKey = "iwtxz:auth:recovery";
  const identityLinkStorageKey = "iwtxz:auth:identity-link";
  const oauthProviders = new Set(["google", "discord"]);

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
        const response = await window.fetch(input, { ...options, cache: "no-store", signal: controller.signal });
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
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce",
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
    if (client === instance) { client = null; customizationReady = false; profileFeaturesReady = false; }
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

  function realEmail(value) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith(`@${config().accountEmailDomain}`)) {
      throw error(400, "Укажи действующий адрес почты.", "invalid_email");
    }
    return email;
  }

  function readFlow(key) {
    try { return JSON.parse(window.sessionStorage?.getItem(key) || "null"); } catch { return null; }
  }

  function writeFlow(key, value) {
    try {
      if (value === null) window.sessionStorage?.removeItem(key);
      else window.sessionStorage?.setItem(key, JSON.stringify(value));
    } catch {}
    // Private browsing may disable storage. The active page can still finish its flow.
    memoryStorage[value === null ? "delete" : "set"](key, value);
  }

  function activeFlow(key) { return readFlow(key) || memoryStorage.get(key) || null; }

  function callbackUrl(kind) {
    let site;
    try { site = new URL(window.IWTXZ_BACKEND_CONFIG?.authSiteUrl || "https://iwtxz.su"); } catch {}
    const localDevelopment = site && site.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(site.hostname);
    if (!site || (site.protocol !== 'https:' && !localDevelopment) || site.username || site.password || site.search || site.hash || !['','/'].includes(site.pathname)) {
      throw error(503, "Не настроен адрес возврата на сайт.", "backend_setup_required");
    }
    if (site.origin !== window.location.origin) {
      throw error(409, "Открой iwtxz.su и начни подтверждение там, чтобы вернуться в свой аккаунт.", "auth_origin_mismatch");
    }
    const url = new URL("/", site.origin);
    url.searchParams.set("auth", kind);
    return url.href;
  }

  function isOAuthUser(user) {
    return user?.identities?.some(identity => oauthProviders.has(identity.provider)) || user?.app_metadata?.providers?.some(provider => oauthProviders.has(provider));
  }

  function recoveryFor(user) {
    const recovery = activeFlow(recoveryStorageKey);
    return Boolean(recovery && recovery.userId === user?.id && recovery.expiresAt > Date.now());
  }

  async function authUser(assertActive = () => {}) {
    const data = throwIfError(await getClient().auth.getUser());
    assertActive();
    if (!data?.user) throw error(401, "Сначала войди в аккаунт.", "unauthorized");
    return data.user;
  }

  function accountAuthState(user) {
    const serviceEmail = !user.email || user.email.toLowerCase().endsWith(`@${config().accountEmailDomain}`);
    const providers = [...new Set((user.identities || []).map(identity => identity.provider).filter(provider => oauthProviders.has(provider)))];
    for (const provider of user.app_metadata?.providers || []) if (oauthProviders.has(provider) && !providers.includes(provider)) providers.push(provider);
    return {
      email: serviceEmail ? "" : user.email,
      pendingEmail: user.new_email || "",
      emailVerified: !serviceEmail && Boolean(user.email_confirmed_at),
      providers,
      hasPassword: (user.identities || []).some(identity => identity.provider === "email") || (user.app_metadata?.providers || []).includes("email") || serviceEmail
    };
  }

  function clearCallbackUrl(url) {
    for (const name of ["code", "auth", "error", "error_code", "error_description", "sb_flow_id"]) url.searchParams.delete(name);
    url.hash = "";
    try { window.history?.replaceState(window.history.state, "", url.href); } catch {}
  }

  function processAuthCallback(assertActive) {
    const context = clientContexts.get(getClient());
    if (context.callbackResult) return context.callbackResult;
    const url = new URL(window.location.href || window.location.origin);
    const kind = url.searchParams.get("auth");
    if (!["callback", "link", "recovery", "email"].includes(kind)) return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    const code = url.searchParams.get("code");
    const failure = url.searchParams.get("error") || fragment.get("error");
    if (!code && !fragment.get("access_token") && !failure) return null;
    context.callbackResult = (async () => {
      try {
        if (failure) throw error(400, "Вход не завершён. Попробуй ещё раз.", "oauth_cancelled");
        let data;
        if (code) data = throwIfError(await getClient().auth.exchangeCodeForSession(code), "callback");
        else {
          const access_token = fragment.get("access_token"), refresh_token = fragment.get("refresh_token");
          if (!access_token || !refresh_token) throw error(400, "Ссылка неполная. Запроси новую.", "invalid_callback");
          data = throwIfError(await getClient().auth.setSession({ access_token, refresh_token }), "callback");
        }
        assertActive();
        if (!data?.session || !data.user) throw error(400, "Ссылка устарела. Начни вход ещё раз.", "invalid_callback");
        if (kind === "link") {
          const expected = activeFlow(identityLinkStorageKey);
          writeFlow(identityLinkStorageKey, null);
          if (!expected || expected.userId !== data.user.id || expected.expiresAt <= Date.now()) {
            await getClient().auth.signOut({ scope: "local" });
            throw error(409, "Привязка не завершена: аккаунт изменился. Войди в свой аккаунт и повтори.", "identity_mismatch");
          }
        }
        const recovery = ["recovery", "PASSWORD_RECOVERY"].includes(data.redirectType) || (!code && fragment.get("type") === "recovery");
        if (recovery) writeFlow(recoveryStorageKey, { userId: data.user.id, expiresAt: Date.now() + 20 * 60 * 1000 });
        else writeFlow(recoveryStorageKey, null);
        return { emailConfirmed: kind === "email", recoveryRequired: recovery };
      } finally { clearCallbackUrl(url); }
    })();
    return context.callbackResult;
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
    if (["provider_disabled", "oauth_provider_not_supported", "validation_failed"].includes(code) && operation === "oauth") return error(503, "Этот способ входа ещё не подключён. Пока используй логин и пароль.", "oauth_not_configured");
    if (["identity_already_exists", "identity_already_linked"].includes(code)) return error(409, "Этот аккаунт уже привязан к другой странице. Войди через него отдельно.", "identity_exists");
    if (code === "manual_linking_disabled") return error(503, "Привязка способов входа ещё не включена на сервере.", "identity_linking_disabled");
    if (["flow_state_not_found", "flow_state_expired", "bad_code_verifier", "otp_expired"].includes(code)) return error(400, "Ссылка устарела или открыта в другом браузере. Запроси новую и открой в том же браузере.", "invalid_callback");
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
    if (!row?.username) throw error(503, "Аккаунт существует, но его профиль не настроен на сервере.", isOAuthUser(user) ? "profile_setup_required" : "backend_setup_required");
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
    const pendingCallback = processAuthCallback(assertActive);
    const callback = pendingCallback ? await pendingCallback : null;
    const session = throwIfError(await getClient().auth.getSession());
    assertActive();
    if (!session?.session) return { user: null };
    if (recoveryFor(session.session.user)) return { user: null, recoveryRequired: true };
    try {
      const account = await requireAccount(assertActive);
      return { user: { username: account.username }, ...(callback?.emailConfirmed ? { emailConfirmed: true } : {}) };
    } catch (cause) {
      assertActive();
      if (cause.code === "profile_setup_required") return { user: null, needsUsername: true };
      if (cause.code === "unauthorized") {
        await getClient().auth.signOut({ scope: "local" });
        return { user: null };
      }
      throw cause;
    }
  }

  async function authenticate(mode, body, assertActive) {
    writeFlow(recoveryStorageKey, null);
    writeFlow(identityLinkStorageKey, null);
    const emailLogin = mode === "login" && String(body.username || "").includes("@");
    const username = emailLogin ? null : normalizeUsername(body.username);
    const password = mode === "signup" ? validatePassword(body.password) : body.password;
    if (typeof password !== "string" || !password || password.length > 128) throw error(400, "Введите пароль.", "invalid_password");
    const email = emailLogin ? realEmail(body.username) : `${username}@${config().accountEmailDomain}`;
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
    } else {
      result = await getClient().auth.signInWithPassword({ email, password });
      assertActive();
      // Existing users keep their original password flow. Only a failed alias
      // login reaches the private server resolver after a real-email binding.
      if (!emailLogin && ["invalid_credentials", "invalid_grant"].includes(result?.error?.code) && window.IWTXZ_BACKEND_CONFIG?.usernameAuthUrl) {
        try {
          const tokens = await usernameAuthRequest("POST", { username, password });
          assertActive();
          result = await getClient().auth.setSession(tokens);
        } catch (cause) {
          // A not-yet-deployed resolver must not turn an ordinary incorrect
          // password into a deployment error. Binding checks readiness first.
          if (cause.code !== "backend_setup_required") throw cause;
        }
      }
    }
    const data = throwIfError(result, mode);
    assertActive();
    if (!data?.session || !data?.user) {
      throw error(503, "Регистрация требует подтверждение служебной почты. Владелец должен отключить Confirm email в настройках сервера.", "email_confirmation_required");
    }
    const account = await accountForUser(data.user, assertActive);
    assertActive();
    if (!emailLogin && account.username !== username) {
      await getClient().auth.signOut({ scope: "local" });
      throw error(409, "Логин аккаунта не совпадает с профилем. Обратись к владельцу сайта.", "identity_mismatch");
    }
    return { user: { username: account.username } };
  }

  function usernameAuthEndpoint() {
    let url;
    try { url = new URL(window.IWTXZ_BACKEND_CONFIG?.usernameAuthUrl); } catch {}
    if (!url || url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw error(503, "Привязка почты ещё не настроена. Вход по логину продолжает работать.", "backend_setup_required");
    return url;
  }

  async function usernameAuthRequest(method, body) {
    const settings = config();
    const instance = getClient();
    const response = await timedFetch(clientContexts.get(instance), usernameAuthEndpoint().href, {
      method, credentials: "omit", headers: { apikey: settings.key, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    let result;
    try { result = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 429) throw error(429, "Слишком много попыток. Попробуй позже.", "rate_limited");
      if (response.status === 400 || response.status === 401) throw error(401, "Неверный логин или пароль.", "invalid_login");
      throw error(503, "Вход по привязанному логину ещё не настроен. Используй почту и пароль.", "backend_setup_required");
    }
    if (method === "GET") {
      if (result?.ready !== true) throw error(503, "Привязка почты ещё не готова на сервере. Попробуй позже.", "backend_setup_required");
      return result;
    }
    if (typeof result?.access_token !== "string" || typeof result?.refresh_token !== "string") throw error(503, "Сервер входа вернул неверный ответ.", "invalid_response");
    return { access_token: result.access_token, refresh_token: result.refresh_token };
  }

  async function requestAuthExtension(mode, body, assertActive) {
    // PKCE verification data belongs to this origin. Reject a foreign/local
    // start before requesting mail or creating an OAuth flow on another site.
    if (["recover", "oauth", "email"].includes(mode)) callbackUrl(mode);
    if (mode === "recover") {
      const email = realEmail(body.email);
      throwIfError(await getClient().auth.resetPasswordForEmail(email, { redirectTo: callbackUrl("recovery") }), "recover");
      assertActive();
      return { ok: true };
    }
    if (mode === "oauth") {
      if (!oauthProviders.has(body.provider)) throw error(400, "Этот способ входа не поддерживается.", "invalid_provider");
      const link = body.link === true;
      const instance = getClient();
      const providerResponse = await timedFetch(clientContexts.get(instance), `${config().url}/auth/v1/settings`, { headers: { apikey: config().key } });
      let providerSettings;
      try { providerSettings = await providerResponse.json(); } catch {}
      assertActive();
      if (!providerResponse.ok) throw error(503, "Не удалось проверить способы входа. Попробуй ещё раз.", "service_unavailable");
      if (providerSettings?.external?.[body.provider] !== true) throw error(503, "Этот способ входа ещё не подключён. Пока используй логин и пароль.", "oauth_not_configured");
      const user = link ? await authUser(assertActive) : null;
      if (link) writeFlow(identityLinkStorageKey, { userId: user.id, expiresAt: Date.now() + 15 * 60 * 1000 });
      const options = { redirectTo: callbackUrl(link ? "link" : "callback"), skipBrowserRedirect: true };
      if (body.provider === "google") options.queryParams = { prompt: "select_account" };
      try {
        const data = throwIfError(await instance.auth[link ? "linkIdentity" : "signInWithOAuth"]({ provider: body.provider, options }), "oauth");
        assertActive();
        let target;
        try { target = new URL(data?.url); } catch {}
        const providerTarget = target && link && ((body.provider === "google" && target.hostname === "accounts.google.com" && /^\/o\/oauth2\/(?:v2\/)?auth$/.test(target.pathname)) || (body.provider === "discord" && target.hostname === "discord.com" && /^\/(?:api\/)?oauth2\/authorize$/.test(target.pathname)));
        if (!target || target.protocol !== "https:" || target.username || target.password || target.port || (target.origin !== config().url && !providerTarget)) throw error(503, "Не удалось начать вход. Попробуй ещё раз.", "invalid_response");
        return { url: target.href };
      } catch (cause) { if (link) writeFlow(identityLinkStorageKey, null); throw cause; }
    }
    const user = await authUser(assertActive);
    if (mode === "account") return accountAuthState(user);
    if (mode === "email") {
      const email = realEmail(body.email);
      await usernameAuthRequest("GET");
      assertActive();
      const data = throwIfError(await getClient().auth.updateUser({ email }, { emailRedirectTo: callbackUrl("email") }), "email");
      assertActive();
      return { ok: true, ...accountAuthState(data?.user || user) };
    }
    if (mode === "recovery-password") {
      if (!recoveryFor(user)) throw error(403, "Открой действующую ссылку восстановления из письма.", "recovery_required");
      const password = validatePassword(body.newPassword);
      throwIfError(await getClient().auth.updateUser({ password }), "password");
      assertActive();
      writeFlow(recoveryStorageKey, null);
      const revocation = await getClient().auth.signOut({ scope: "others" });
      assertActive();
      return { ok: true, ...await getMe(assertActive), ...(revocation.error ? { sessionRevocationWarning: true } : {}) };
    }
    if (mode === "complete") {
      if (!isOAuthUser(user)) throw error(403, "Сначала войди через Google или Discord.", "oauth_required");
      const username = normalizeUsername(body.username);
      throwIfError(await getClient().rpc("builder_complete_oauth_profile", { requested_username: username }));
      assertActive();
      const account = await accountForUser(user, assertActive);
      return { user: { username: account.username } };
    }
    throw error(404, "Страница не найдена.", "not_found");
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

  async function requireCustomization(capabilities) {
    if (customizationReady) return;
    const result = capabilities || await getClient().rpc("builder_capabilities");
    if (result?.error || !(result?.data?.profileSettingsVersion >= 2)) {
      throw error(503, "Владелец сайта должен обновить сервер для новых настроек. Файл: supabase/migrations/20261030_profile_customization.sql. Твои сохранённые настройки не потеряны.", "backend_update_required");
    }
    customizationReady = true;
  }

  async function requireProfileFeatures(capabilities) {
    if (profileFeaturesReady) return;
    const result = capabilities || await getClient().rpc("builder_capabilities");
    if (result?.error || !(result?.data?.profileSettingsVersion >= 3) || result?.data?.profileEffects !== true) {
      throw error(503, "Новые настройки ещё не включены на сервере. Обратись к владельцу сайта.", "backend_features_update_required");
    }
    customizationReady = true;
    profileFeaturesReady = true;
  }

  async function requestMusic(mode, options, assertActive) {
    let base;
    try { base = new URL(window.IWTXZ_BACKEND_CONFIG?.musicApiUrl); } catch { throw error(503, "Музыкальная библиотека пока подключается.", "music_not_configured"); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw error(503, "Не удалось подключиться к библиотеке.", "music_not_configured");
    const instance = getClient();
    const session = throwIfError(await instance.auth.getSession());
    assertActive();
    if (!session?.session?.access_token) throw error(401, "Войди в аккаунт ещё раз.", "unauthorized");
    const controller = new AbortController();
    const context = clientContexts.get(instance);
    context.controllers.add(controller);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      const response = await fetch(new URL(`/v1/${mode}`, base), {
        method: mode === "library" ? "GET" : "POST", credentials: "omit", cache: "no-store", signal: controller.signal,
        headers: { authorization: `Bearer ${session.session.access_token}`, ...(mode === "library" ? {} : { "content-type": "application/json" }) },
        ...(mode === "library" ? {} : { body: JSON.stringify(jsonBody(options)) })
      });
      const data = await response.json();
      assertActive();
      if (!response.ok) throw error(response.status, typeof data?.error === "string" ? data.error.slice(0, 300) : "Не удалось загрузить библиотеку.", "music_failed");
      return data;
    } finally { options.signal?.removeEventListener("abort", abort); context.controllers.delete(controller); }
  }

  async function dispatchRequest(path, options = {}, assertActive) {
    if (typeof path !== "string" || !path.startsWith("/api/builder/")) throw error(404, "Страница не найдена.", "not_found");
    const url = new URL(path, window.location.origin);
    const method = String(options.method || "GET").toUpperCase();
    const mode = url.pathname.split("/").pop();
    const isGet = ["/api/builder/auth/me", "/api/builder/auth/account", "/api/builder/music/library"].includes(url.pathname) || /^\/api\/builder\/sites\/(list|get)$/.test(url.pathname) || /^\/api\/builder\/profile\/[a-z0-9_-]+$/i.test(url.pathname);
    if (method !== (isGet ? "GET" : "POST")) throw error(405, isGet ? "Используйте GET." : "Используйте POST.", "method_not_allowed");
    if (url.pathname === "/api/builder/auth/me") return getMe(assertActive);
    if (/^\/api\/builder\/auth\/(signup|login)$/.test(url.pathname)) return authenticate(mode, jsonBody(options), assertActive);
    if (/^\/api\/builder\/auth\/(oauth|recover|recovery-password|account|email|complete)$/.test(url.pathname)) return requestAuthExtension(mode, isGet ? {} : jsonBody(options), assertActive);
    if (url.pathname === "/api/builder/auth/logout") {
      throwIfError(await getClient().auth.signOut({ scope: "local" }));
      writeFlow(recoveryStorageKey, null);
      writeFlow(identityLinkStorageKey, null);
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
    if (/^\/api\/builder\/music\/(library|import|remember|remove)$/.test(url.pathname)) return requestMusic(mode, options, assertActive);
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
        const passwordUser = await authUser(assertActive);
        const verified = throwIfError(await verificationClient.auth.signInWithPassword({
          email: passwordUser.email, password: body.currentPassword
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
      const newSocials = ["vk", "youtube", "twitch", "tiktok", "instagram", "github", "spotify", "x", "soundcloud", "reddit", "boosty", "website"];
      const hasFeatures = (site.nicknameAnimation && site.nicknameAnimation !== "none") || (site.avatarDecoration && site.avatarDecoration !== "none") || newSocials.some(key => Boolean(site[key]));
      let settingsCapabilities;
      const loadCapabilities=()=>settingsCapabilities ||= Promise.resolve(getClient().rpc('builder_capabilities'));
      if (Array.isArray(site.discordHiddenBadges) && site.discordHiddenBadges.length) {
        const capabilities=await loadCapabilities();
        if(capabilities.error||capabilities.data?.discordBadgeVisibility!==true)throw error(503,'Для сохранения переключателей значков Discord выполни обновление базы 20261108_discord_badge_visibility.sql. Настройки остались в редакторе.','backend_features_update_required');
      }
      if (Array.isArray(site.discordBadges) && (site.discordBadges.length || ['iwtlu','shakzy','strelokk'].includes(account.username))) {
        const capabilities=await loadCapabilities();
        if(capabilities.error||capabilities.data?.discordBadges!==true)throw error(503,'Для сохранения значков Discord выполни обновление базы 20261108_discord_badge_catalog.sql. Выбранные значки остаются в редакторе.','backend_features_update_required');
      }
      const oldAnimations=new Set(['none','glow','pulse','float','shimmer','glitch','typewriter','blur','flicker','bounce','wave']);
      const oldDecorations=new Set(['none','discord','phoenix','heartbloom','shy','sakura','moon','embers','aurora','cat']);
      if((site.descriptionAnimation&&site.descriptionAnimation!=='none')||(site.layoutVersion===2&&Object.keys(site.objectPositions||{}).length)||(site.nicknameAnimation&&!oldAnimations.has(site.nicknameAnimation))||(site.avatarDecoration&&!oldDecorations.has(site.avatarDecoration))){
        const capabilities=await loadCapabilities();
        if(capabilities.error||capabilities.data?.profileSettingsVersion<7||capabilities.data?.editorV2!==true)throw error(503,'Для новых эффектов и координат нужно обновление базы 20261105_profile_editor_v2.sql. Выбор остался в редакторе.','backend_features_update_required');
      }
      const advancedDefaults={descriptionSize:16,cursorSize:24,cursorOpacity:100,cursorColor:'#ffffff',cursorHotspot:'center',typewriterEnabled:false,typewriterText:'',typewriterSpeed:70,seasonalTheme:'none'};
      if(Object.entries(advancedDefaults).some(([key,value])=>site[key]!==undefined&&site[key]!==value)||Object.keys(site.objectPositions||{}).length){
        const capabilities=await loadCapabilities();
        if(capabilities.error||capabilities.data?.profileSettingsVersion<6||capabilities.data?.freeLayout!==true)throw error(503,'Для новых настроек нужно обновление базы 20261105_free_layout_and_halloween.sql. Выбор сохранён в редакторе.','backend_features_update_required');
      }
      if((site.nicknameSize!==undefined&&site.nicknameSize!==32)||(site.profileScale!==undefined&&site.profileScale!==100)||site.discordShowCopyHint===false){
        const capabilities=await loadCapabilities();
        if(capabilities.error||capabilities.data?.profileSettingsVersion<5||capabilities.data?.profileLayout!==true)throw error(503,'Для масштаба и подсказки копирования нужно обновление базы 20261102_profile_layout_controls.sql.','backend_features_update_required');
      }
      if((site.backgroundEffect&&site.backgroundEffect!=='none')||site.profileTilt||(site.cursorStyle&&site.cursorStyle!=='default')||site.customCursor||site.favicon||site.avatarFit==='contain'){
        const result=await loadCapabilities();
        if(result.error||result.data?.profileSettingsVersion<4||result.data?.interactiveEffects!==true)throw error(503,'Для этих эффектов нужно обновление базы 20261102_interactive_profiles.sql.','backend_features_update_required');
      }
      if (hasFeatures) await requireProfileFeatures(settingsCapabilities?await settingsCapabilities:undefined);
      else if (site.font === "custom" || ["customFont", "musicPlayerStyle", "avatarShape", "nicknameGradient", "nicknameGradientStart", "nicknameGradientEnd", "nicknameGradientAngle", "discordUserId", "discordSync", "discordCardStyle", "discordCardColor", "discordCardOpacity", "discordCardRadius", "discordUseAvatar", "discordShowStatus", "discordShowBadges", "discordShowActivity", "profileBadges", "showButterfly"].some((key) => Object.hasOwn(site, key))) await requireCustomization(settingsCapabilities?await settingsCapabilities:undefined);
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
    const location = new URL(window.location.href || window.location.origin);
    const callback = path === "/api/builder/auth/me" && ["callback", "link", "recovery", "email"].includes(location.searchParams.get("auth")) && (location.searchParams.has("code") || location.hash.includes("access_token="));
    const freshSession = !options.signal?.aborted && ((/^\/api\/builder\/auth\/(signup|login)$/.test(path) && String(options.method).toUpperCase() === "POST") || (callback && !clientContexts.get(client)?.callbackPending));
    const instance = typeof path === "string" && /^\/api\/builder\/profile\/[a-z0-9_-]+$/i.test(path) ? getPublicClient() : getClient(freshSession);
    if (callback) clientContexts.get(instance).callbackPending = true;
    return boundedOperation(instance, (assertActive) => dispatchRequest(path, options, assertActive), { ...options, authMutation: /^\/api\/builder\/auth\/(signup|login|password|oauth|email|complete|recovery-password)$/.test(path) });
  }

  async function getPublishedProfile(username) {
    return boundedOperation(getPublicClient(), () => readPublishedProfile(username));
  }

  window.IwtxzBackend = Object.freeze({ isConfigured, request, getPublishedProfile });
})();
