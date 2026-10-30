(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const features = window.IwtxzProfileFeatures;
  const socialFields = features?.socials.map(item => item.id) || ["discord", "telegram", "steam"];
  const textFields = ["title", "nickname", "description", "entryText", "musicTitle", ...socialFields, "discordUserId"];
  const numberFields = ["avatarSize", "backgroundDim", "nicknameGradientAngle", "discordCardOpacity", "discordCardRadius"];
  const optionFields = ["font", "accentColor", "backgroundType", "nicknameGradientStart", "nicknameGradientEnd", "musicPlayerStyle", "discordCardStyle", "discordCardColor", "nicknameAnimation", "avatarDecoration"];
  const boolFields = ["musicLoop", "showDiscord", "nicknameGradient", "discordSync", "discordUseAvatar", "discordShowStatus", "discordShowBadges", "discordShowActivity"];
  const assetFields = ["avatar", "background", "music", "musicCover", "customFont"];
  const decorativeBadges = new Set(["star", "heart", "moon", "sparkle", "code", "music", "flower"]);
  const defaults = {
    ...Object.fromEntries(socialFields.map(key => [key, ""])),
    title: "", nickname: "", description: "", entryText: "click to enter...", discord: "", telegram: "", steam: "",
    avatar: "img/mainavatar.gif", background: "img/background.mp4", backgroundType: "video",
    music: "sound/sound.mp3", musicTitle: "one more time", musicCover: "img/mysoundicon.png",
    avatarSize: 150, avatarShape: "circle", backgroundDim: 58, accentColor: "#f5f5f7", font: "minecraft", customFont: "", musicLoop: true, showDiscord: true,
    nicknameGradient: false, nicknameGradientStart: "#ffffff", nicknameGradientEnd: "#a1a1aa", nicknameGradientAngle: 90,
    musicPlayerStyle: "classic", showButterfly: false, profileBadges: [], discordUserId: "", discordSync: false,
    discordCardStyle: "glass", discordCardColor: "#111111", discordCardOpacity: 65, discordCardRadius: 18,
    discordUseAvatar: true, discordShowStatus: true, discordShowBadges: true, discordShowActivity: true,
    nicknameAnimation: "none", avatarDecoration: "none"
  };
  const fileHints = Object.fromEntries(all("[data-file-note]").map((e) => [e.dataset.fileNote, e.textContent]));
  const previewFrame = $("#previewFrame");
  try {
    const invite = new URL(window.IWTXZ_BACKEND_CONFIG?.discordInviteUrl);
    if (invite.protocol === "https:" && !invite.username && !invite.password &&
        ((invite.hostname === "discord.gg" && /^\/[a-z0-9-]+\/?$/i.test(invite.pathname)) ||
         (invite.hostname === "discord.com" && /^\/invite\/[a-z0-9-]+\/?$/i.test(invite.pathname)))) {
      $("#discordJoinLink").href = invite.href;
    }
  } catch {}
  let currentUser = null;
  let currentSite = { ...defaults };
  let savedSnapshot = "";
  let dirty = false;
  let authMode = "login";
  let authPending = false;
  let authAttemptVersion = 0;
  const bootstrapAuthController = new AbortController();
  let busy = false;
  let uploadCount = 0;
  let sessionVersion = 0;
  let accountReady = false;
  let accountLoadController = null;
  let previewTimer;
  let toastTimer;
  let discordSnapshotStatus = null;

  function status(selector, message, type = "") {
    const element = $(selector);
    element.textContent = message;
    element.classList.toggle("error", type === "error");
    element.classList.toggle("ok", type === "ok");
  }

  function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
  }

  function friendlyError(error) {
    if (error.name === "AbortError") return "Сервер не ответил вовремя. Попробуй ещё раз.";
    if (error instanceof TypeError) return "Не удалось связаться с сервером. Проверь соединение.";
    return error.message || "Не получилось выполнить действие. Попробуй ещё раз.";
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    const cancelled = () => Object.assign(new Error("Запрос отменён."), { code: "request_cancelled" });
    let timeout;
    let abort;
    const interruption = new Promise((_, reject) => {
      abort = () => reject(cancelled());
      controller.signal.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(() => {
        reject(Object.assign(new Error("Сервер не ответил вовремя. Попробуй ещё раз."), { code: "request_timeout" }));
        controller.abort();
      }, options.upload ? 65000 : 22000);
    });
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw cancelled();
          return performApiRequest(path, { ...options, signal: controller.signal });
        }), interruption
      ]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", abort);
      options.signal?.removeEventListener("abort", cancel);
    }
  }

  async function performApiRequest(path, options) {
    if (location.protocol === "file:") throw new Error("Для входа открой кабинет через локальный сервер, а не как файл. Инструкция — в README-BUILDER.md.");
    if (window.IwtxzBackend?.isConfigured()) {
      try { return await window.IwtxzBackend.request(path, options); }
      catch (error) {
        if (options.signal.aborted) throw error;
        if (error.status === 401 && error.code === "unauthorized" && currentUser) {
          resetSession();
          status("#authStatus", "Время входа истекло. Войди ещё раз.", "error");
        }
        throw error;
      }
    }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
      const error = new Error("Сервер кабинета ещё не подключён. Владелец сайта должен указать настройки Supabase в backend-config.js.");
      error.code = "backend_not_configured";
      throw error;
    }
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (options.signal.aborted) throw Object.assign(new Error("Запрос отменён."), { code: "request_cancelled" });
    if (!data) throw new Error("Сервис кабинета недоступен. Убедись, что сайт открыт через сервер с поддержкой входа.");
    if (!response.ok) {
      const error = new Error(data.error || "Не получилось выполнить действие.");
      error.status = response.status;
      error.code = data.code;
      if (response.status === 401 && data.code === "unauthorized" && currentUser) {
        resetSession();
        status("#authStatus", "Время входа истекло. Войди ещё раз.", "error");
      }
      throw error;
    }
    return data;
  }

  function readEditor() {
    const site = { ...currentSite };
    textFields.forEach((key) => { site[key] = $("#" + key).value.trim(); });
    numberFields.forEach((key) => { site[key] = Number($("#" + key).value); });
    optionFields.forEach((key) => { site[key] = $("#" + key).value; });
    boolFields.forEach((key) => { site[key] = $("#" + key).checked; });
    site.profileBadges = all("[data-profile-badge]:checked").map((input) => input.dataset.profileBadge).filter((badge) => decorativeBadges.has(badge));
    return site;
  }

  function snapshot(site) {
    return JSON.stringify(Object.fromEntries([...textFields, ...numberFields, ...optionFields, ...boolFields, ...assetFields, "profileBadges"].map((key) => [key, site[key]])));
  }

  function writeEditor(site) {
    currentSite = { ...defaults, ...site };
    textFields.concat(numberFields, optionFields).forEach((key) => { $("#" + key).value = currentSite[key] ?? ""; });
    boolFields.forEach((key) => { $("#" + key).checked = Boolean(currentSite[key]); });
    const badges = new Set(Array.isArray(currentSite.profileBadges) ? currentSite.profileBadges : []);
    all("[data-profile-badge]").forEach((input) => { input.checked = badges.has(input.dataset.profileBadge); });
    all("[data-asset-url]").forEach((field) => { field.value = /^https:\/\//i.test(currentSite[field.dataset.assetUrl] || "") ? currentSite[field.dataset.assetUrl] : ""; });
    all("[data-upload]").forEach((field) => { field.value = ""; });
    all("[data-file-note]").forEach((note) => { note.textContent = fileHints[note.dataset.fileNote]; });
    if (currentSite.customFont) document.querySelector('[data-file-note="customFont"]').textContent = "Свой шрифт добавлен · можно заменить другим файлом";
    savedSnapshot = snapshot(readEditor());
    dirty = false;
    updatePreview();
    updatePublication();
  }

  function sendPreview() {
    if (currentUser && previewFrame.contentWindow) {
      previewFrame.contentWindow.postMessage({ type: "iwtxz-profile-preview", site: readEditor() }, location.origin);
    }
  }

  function updatePreview() {
    currentSite = readEditor();
    dirty = Boolean(currentUser) && snapshot(currentSite) !== savedSnapshot;
    $("#draftState").textContent = dirty ? "Есть изменения" : "Черновик сохранён";
    $("#draftState").classList.toggle("unsaved", dirty);
    $("#descriptionCount").textContent = `${$("#description").value.length} / 500`;
    $("#avatarSizeValue").value = `${currentSite.avatarSize} px`;
    $("#backgroundDimValue").value = `${currentSite.backgroundDim}%`;
    $("#nicknameGradientAngleValue").value = `${currentSite.nicknameGradientAngle}°`;
    $("#discordCardOpacityValue").value = `${currentSite.discordCardOpacity}%`;
    $("#discordCardRadiusValue").value = `${currentSite.discordCardRadius} px`;
    updateDiscordHint();
    $("#avatarThumbnail").src = currentSite.avatar || "img/tree.png";
    $("#accountAvatar").src = currentSite.avatar || "img/tree.png";
    $("#coverThumbnail").src = currentSite.musicCover || "img/tree.png";
    all("[data-social-field]").forEach(row => {
      const connected = Boolean(currentSite[row.dataset.socialField]);
      row.classList.toggle("connected", connected);
      row.querySelector("[data-social-state]").textContent = connected ? "Добавлено" : "Добавить";
    });
    all("[data-decoration]").forEach(button => {
      const selected = button.dataset.decoration === currentSite.avatarDecoration;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    all("[data-decoration-avatar]").forEach(image => { image.src = currentSite.avatar || "img/tree.png"; });
    $("#decorationLabel").textContent = currentSite.avatarDecoration === "discord" ? "Из Discord"
      : features?.decorations.find(item => item.id === currentSite.avatarDecoration)?.label || "Без украшения";
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 70);
  }

  function updateDiscordHint() {
    const hint = $("#discordSyncHint");
    if (!currentSite.discordSync) {
      hint.textContent = "Синхронизация выключена. В карточке используются твои настройки.";
    } else if (!/^[0-9]{17,20}$/.test(currentSite.discordUserId)) {
      hint.textContent = "Укажи числовой ID Discord, чтобы обновлять карточку.";
    } else if (discordSnapshotStatus?.userId === currentSite.discordUserId) {
      const state = discordSnapshotStatus.state;
      if (state === "ready") {
        const time = Number(discordSnapshotStatus.updatedAt);
        hint.textContent = Number.isFinite(time) && time > 0
          ? `Данные Discord получены · ${new Date(time).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
          : "Данные Discord получены. Карточка обновляется автоматически.";
      } else if (state === "not-member") {
        hint.textContent = "Аккаунт пока не найден на сервере. Вступи по ссылке выше и дождись обновления.";
      } else {
        hint.textContent = "Данных пока нет. После вступления и публикации страницы дождись автоматического обновления.";
      }
    } else {
      hint.textContent = "Сохрани и примени настройки. После вступления на сервер данные появятся при следующем обновлении.";
    }
  }

  function profileUrl() {
    const username = currentUser?.username || "";
    return window.IwtxzProfileLinks?.urlForUser(username) || `/profile.html?u=${encodeURIComponent(username)}`;
  }

  function updatePublication() {
    if (!currentUser) return;
    const url = profileUrl();
    $("#pageAddress").textContent = `${location.host}${url}`;
    if (currentSite.publishedAt) $("#pageAddress").href = url;
    else $("#pageAddress").removeAttribute("href");
    $("#pageAddress").setAttribute("aria-disabled", String(!currentSite.publishedAt));
    $("#copyAddress").disabled = !currentSite.publishedAt;
    $("#publishedBanner").classList.toggle("hidden", !currentSite.publishedAt);
    $("#openProfileTop").href = url;
    $("#openProfile").href = url;
    $("#openProfile").classList.toggle("hidden", !currentSite.publishedAt);
    $("#publishedStatus").textContent = currentSite.publishedAt
      ? "Опубликовано · " + new Date(currentSite.publishedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "Страница ещё не опубликована";
  }

  function updateBusy() {
    $("#editorForm").inert = busy || !accountReady;
    $("#saveButton").disabled = busy || !accountReady || uploadCount > 0;
    $("#publishButton").disabled = busy || !accountReady || uploadCount > 0;
    $("#deleteButton").disabled = busy || !accountReady || uploadCount > 0;
    $("#logoutButton").disabled = busy;
  }

  function setSection(name) {
    all("[data-settings-section]").forEach((section) => section.classList.toggle("hidden", section.dataset.settingsSection !== name));
    all("[data-section]").forEach((button) => {
      const active = button.dataset.section === name;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    $("#editorActions").classList.toggle("hidden", name === "security");
  }

  function resetSession() {
    authAttemptVersion += 1;
    sessionVersion += 1;
    accountLoadController?.abort();
    accountLoadController = null;
    accountReady = false;
    document.body.classList.remove("account-unavailable");
    $("#accountLoadState").classList.add("hidden");
    currentUser = null;
    discordSnapshotStatus = null;
    dirty = false;
    savedSnapshot = "";
    document.body.classList.add("auth-locked");
    $("#accountControls").classList.add("hidden");
    $("#password").value = "";
    $("#password").type = "password";
    $("#showPassword").textContent = "Показать";
    $("#showPassword").setAttribute("aria-label", "Показать пароль");
    $("#showPassword").setAttribute("aria-pressed", "false");
    $("#confirmPassword").value = "";
    $("#ownerClaim").value = "";
    $("#passwordForm").reset();
    previewFrame.contentWindow?.postMessage({ type: "iwtxz-profile-preview", site: { ...defaults, avatar: "", background: "", music: "", title: "", nickname: "", showDiscord: false } }, location.origin);
    writeEditor(defaults);
    $("#pageAddress").textContent = "";
    $("#pageAddress").removeAttribute("href");
    $("#openProfileTop").removeAttribute("href");
    $("#publishedBanner").classList.add("hidden");
    $("#accountName").textContent = "";
    $("#openProfile").removeAttribute("href");
  }

  async function enterAccount(user, attempt = authAttemptVersion) {
    if (attempt !== authAttemptVersion) return;
    accountLoadController?.abort();
    const controller = new AbortController();
    accountLoadController = controller;
    sessionVersion += 1;
    const version = sessionVersion;
    currentUser = user;
    accountReady = false;
    $("#userLine").textContent = `@${user.username}`;
    $("#accountName").textContent = `@${user.username}`;
    $("#accountControls").classList.remove("hidden");
    document.body.classList.remove("auth-locked");
    document.body.classList.add("account-unavailable");
    status("#authStatus", "");
    $("#password").value = "";
    $("#confirmPassword").value = "";
    $("#ownerClaim").value = "";
    setSection("profile");
    $("#accountLoadState").classList.remove("hidden");
    $("#retryAccountLoad").classList.add("hidden");
    $("#retryAccountLoad").disabled = true;
    status("#accountLoadStatus", "Загружаем сохранённые настройки страницы…");
    updateBusy();
    try {
      const data = await api("/api/builder/sites/list", { signal: controller.signal });
      if (version !== sessionVersion || attempt !== authAttemptVersion) return;
      if (!Array.isArray(data.sites)) throw new Error("Сервер вернул неверные настройки страницы.");
      const site = data.sites[0] || { ...defaults, title: user.username, nickname: user.username };
      writeEditor(site);
      accountReady = true;
      document.body.classList.remove("account-unavailable");
      $("#accountLoadState").classList.add("hidden");
      status("#editorStatus", "Черновик виден только тебе. Изменения появятся на странице после применения.");
      sendPreview();
    } catch (error) {
      if (version !== sessionVersion || attempt !== authAttemptVersion) return;
      status("#accountLoadStatus", `Не удалось загрузить сохранённые настройки. ${friendlyError(error)}`, "error");
      $("#retryAccountLoad").classList.remove("hidden");
    } finally {
      if (version === sessionVersion) {
        accountLoadController = null;
        $("#retryAccountLoad").disabled = false;
        updateBusy();
      }
    }
  }

  $("#retryAccountLoad").addEventListener("click", () => {
    if (currentUser && !accountLoadController) void enterAccount(currentUser);
  });

  function validateSite() {
    const site = readEditor();
    if (!site.nickname || !site.title) {
      setSection("profile");
      $(site.nickname ? "#title" : "#nickname").focus();
      throw new Error("Заполни ник и название вкладки.");
    }
    for (const key of socialFields.filter(key => key !== "discord")) {
      if (site[key]) {
        try { const url = new URL(site[key]); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
        catch { setSection("links"); $("#" + key).focus(); throw new Error("Ссылка должна начинаться с https:// и вести на твою страницу."); }
      }
    }
    for (const input of all("[data-asset-url]")) {
      if (input.value && !/^https:\/\//i.test(input.value)) throw new Error("Для файлов по ссылке используй адрес с https://.");
    }
    if (site.font === "custom" && !site.customFont) {
      setSection("appearance");
      $("#customFontFile").focus();
      throw new Error("Загрузи свой шрифт или добавь прямую ссылку на него.");
    }
    if (site.discordUserId && !/^[0-9]{17,20}$/.test(site.discordUserId)) {
      setSection("links");
      $("#discordUserId").focus();
      throw new Error("ID Discord должен состоять из 17–20 цифр.");
    }
    if (site.discordSync && !site.discordUserId) {
      setSection("links");
      $("#discordUserId").focus();
      throw new Error("Для обновления карточки укажи ID пользователя Discord.");
    }
    if (site.avatarDecoration === "discord" && (!site.discordSync || !site.discordUserId)) {
      setSection("links"); $("#discordUserId").focus();
      throw new Error("Для украшения из Discord укажи ID и включи синхронизацию.");
    }
    return site;
  }

  async function saveDraft() {
    const site = validateSite();
    const data = await api("/api/builder/sites/save", { method: "POST", body: JSON.stringify({ site }) });
    writeEditor(data.site);
    return data.site;
  }

  async function saveOrPublish(publish) {
    if (!accountReady) return;
    if (!currentUser || busy || uploadCount) return;
    busy = true;
    updateBusy();
    try {
      status("#editorStatus", publish ? "Сохраняем и применяем изменения…" : "Сохраняем черновик…");
      await saveDraft();
      if (publish) {
        const result = await api("/api/builder/publish", { method: "POST", body: "{}" });
        currentSite.publishedAt = result.publishedAt || Date.now();
        updatePublication();
        status("#editorStatus", "Готово. Изменения появились на твоей странице.", "ok");
        toast("Страница обновлена");
      } else status("#editorStatus", "Черновик сохранён. Чтобы обновить страницу для посетителей, нажми «Применить к странице».", "ok");
    } catch (error) { status("#editorStatus", friendlyError(error), "error"); }
    finally { busy = false; updateBusy(); }
  }

  const mimeByExtension = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
  async function uploadFile(input) {
    if (!accountReady) return;
    const file = input.files?.[0];
    if (!file || !currentUser) return;
    const key = input.dataset.upload;
    const version = sessionVersion;
    const extensionType = mimeByExtension[file.name.split(".").pop().toLowerCase()] || "";
    const type = key === "customFont" ? extensionType : file.type || extensionType;
    const image = /^image\/(png|jpeg|gif|webp)$/.test(type);
    const allowed = key === "customFont" ? /^font\/(woff|woff2|ttf|otf)$/.test(type)
      : key === "music" ? /^audio\/(mpeg|mp3|ogg|wav|x-wav|mp4|webm)$/.test(type)
      : image || (key === "background" && /^video\/(mp4|webm)$/.test(type));
    if (!allowed || !file.size || file.size > 4 * 1024 * 1024) {
      input.value = "";
      status("#editorStatus", !allowed ? "Этот формат не поддерживается. Выбери файл из списка под полем." : "Размер файла должен быть больше нуля и не больше 4 МБ.", "error");
      return;
    }
    input.disabled = true;
    uploadCount += 1;
    updateBusy();
    status("#editorStatus", `Загружаем «${file.name}»…`);
    try {
      const result = await api(`/api/builder/assets/upload?kind=${key}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "content-type": type }, body: file, upload: true });
      if (version !== sessionVersion) return;
      currentSite[key] = result.url;
      const urlInput = document.querySelector(`[data-asset-url="${key}"]`);
      if (urlInput) urlInput.value = "";
      if (key === "background") $("#backgroundType").value = type.startsWith("video/") ? "video" : "image";
      if (key === "music" && !$("#musicTitle").value) $("#musicTitle").value = file.name.replace(/\.[^.]+$/, "");
      if (key === "customFont") $("#font").value = "custom";
      document.querySelector(`[data-file-note="${key}"]`).textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ · загружено`;
      updatePreview();
      status("#editorStatus", "Файл загружен. Сохрани черновик или примени изменения к странице.", "ok");
    } catch (error) { if (version === sessionVersion) status("#editorStatus", friendlyError(error), "error"); }
    finally { input.disabled = false; input.value = ""; uploadCount -= 1; updateBusy(); }
  }

  function updateOwnerClaimField() {
    const username = $("#username").value.trim().toLowerCase();
    const reserved = ["iwtlu", "shakzy", "strelok", "strelokk", "icetearz", "eris"].includes(username);
    $("#ownerClaimField").classList.toggle("hidden", authMode !== "signup" || !reserved);
  }
  $("#username").addEventListener("input", updateOwnerClaimField);
  all("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
    $("#switchToLogin").classList.add("hidden");
    authMode = button.dataset.authMode;
    all("[data-auth-mode]").forEach((tab) => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active)); });
    const signup = authMode === "signup";
    $("#confirmPasswordField").classList.toggle("hidden", !signup);
    $("#confirmPassword").required = signup;
    $("#password").minLength = signup ? 8 : 1;
    $("#password").autocomplete = signup ? "new-password" : "current-password";
    $("#authHeading").textContent = signup ? "Создать страницу" : "Войти";
    $("#authSubmit").textContent = signup ? "Создать страницу" : "Войти";
    updateOwnerClaimField();
    status("#authStatus", "");
  }));

  $("#showPassword").addEventListener("click", () => {
    const show = $("#password").type === "password";
    $("#password").type = show ? "text" : "password";
    $("#showPassword").textContent = show ? "Скрыть" : "Показать";
    $("#showPassword").setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
    $("#showPassword").setAttribute("aria-pressed", String(show));
  });

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (authPending) return;
    if (authMode === "signup" && $("#password").value !== $("#confirmPassword").value) { status("#authStatus", "Пароли не совпадают.", "error"); return; }
    const mode = authMode;
    const attempt = ++authAttemptVersion;
    bootstrapAuthController.abort();
    authPending = true;
    $("#switchToLogin").classList.add("hidden");
    const credentials = { username: $("#username").value.trim(), password: $("#password").value };
    let signedIn = false;
    if (mode === "signup" && $("#ownerClaim").value.trim()) credentials.ownerClaim = $("#ownerClaim").value.trim();
    all("#authForm button, [data-auth-mode]").forEach((button) => { button.disabled = true; });
    try {
      status("#authStatus", mode === "signup" ? "Создаём аккаунт…" : "Входим…");
      const result = await api(`/api/builder/auth/${mode}`, { method: "POST", body: JSON.stringify(credentials) });
      if (attempt !== authAttemptVersion) return;
      signedIn = true;
      status("#authStatus", mode === "signup" ? "Аккаунт создан. Загружаем кабинет…" : "Вход выполнен. Загружаем кабинет…");
      await enterAccount(result.user, attempt);
    } catch (error) {
      if (attempt !== authAttemptVersion) return;
      const duplicate = mode === "signup" && error.code === "username_taken";
      const timedOutSignup = mode === "signup" && error.code === "request_timeout";
      status("#authStatus", signedIn
        ? `Вход выполнен, но кабинет не загрузился. ${friendlyError(error)}`
        : duplicate
        ? "Этот логин уже зарегистрирован. Если ты уже создавал аккаунт, перейди ко входу и используй свой пароль."
        : timedOutSignup
          ? "Сервер не ответил вовремя. Аккаунт мог успеть создаться — попробуй войти с тем же логином и паролем."
          : friendlyError(error), "error");
      $("#switchToLogin").classList.toggle("hidden", !duplicate && !timedOutSignup);
    }
    finally { authPending = false; all("#authForm button, [data-auth-mode]").forEach((button) => { button.disabled = false; }); }
  });

  $("#switchToLogin").addEventListener("click", () => {
    document.querySelector('[data-auth-mode="login"]').click();
    $("#password").focus();
  });

  $("#logoutButton").addEventListener("click", async () => {
    if (uploadCount) { toast("Подожди, пока загрузятся файлы"); return; }
    if (dirty && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
    try { await api("/api/builder/auth/logout", { method: "POST", body: "{}" }); resetSession(); status("#authStatus", "Ты вышел из аккаунта."); }
    catch (error) { toast(friendlyError(error)); }
  });

  $("#editorForm").addEventListener("submit", (event) => event.preventDefault());
  all("[data-social-remove]").forEach(button => button.addEventListener("click", () => {
    $("#" + button.dataset.socialRemove).value = "";
    button.closest("details").open = false;
    updatePreview();
  }));
  all("[data-decoration]").forEach(button => button.addEventListener("click", () => {
    $("#avatarDecoration").value = button.dataset.decoration;
    updatePreview();
  }));
  $("#editorForm").addEventListener("input", (event) => {
    if (event.target.type === "file") return;
    const key = event.target.dataset.assetUrl;
    if (key) currentSite[key] = event.target.value.trim();
    if (key === "customFont" && currentSite.customFont) $("#font").value = "custom";
    updatePreview();
  });
  $("#editorForm").addEventListener("change", (event) => { if (event.target.type !== "file") updatePreview(); });
  all("[data-upload]").forEach((input) => input.addEventListener("change", () => uploadFile(input)));
  all("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.remove;
    if (uploadCount) return;
    currentSite[key] = "";
    if (key === "customFont" && $("#font").value === "custom") $("#font").value = "minecraft";
    const field = document.querySelector(`[data-asset-url="${key}"]`);
    if (field) field.value = "";
    document.querySelector(`[data-file-note="${key}"]`).textContent = "Файл убран. Можно загрузить другой.";
    updatePreview();
  }));
  all("[data-section]").forEach((button) => button.addEventListener("click", () => setSection(button.dataset.section)));
  $("#saveButton").addEventListener("click", () => saveOrPublish(false));
  $("#publishButton").addEventListener("click", () => saveOrPublish(true));
  $("#copyAddress").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(new URL(profileUrl(), location.origin).href); toast("Адрес скопирован"); }
    catch { toast("Не получилось скопировать адрес. Его можно выделить вручную."); }
  });
  $("#deleteButton").addEventListener("click", async () => {
    if (!accountReady || busy || uploadCount || !confirm("Удалить черновик и опубликованную страницу? Это действие нельзя отменить.")) return;
    busy = true; updateBusy();
    try {
      await api("/api/builder/sites/delete", { method: "POST", body: "{}" });
      const data = await api("/api/builder/sites/list");
      writeEditor(data.sites[0]);
      setSection("profile");
      status("#editorStatus", "Страница удалена. Можно настроить новую.", "ok");
    } catch (error) { status("#passwordStatus", friendlyError(error), "error"); }
    finally { busy = false; updateBusy(); }
  });
  $("#passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || uploadCount) return;
    if ($("#newPassword").value !== $("#repeatNewPassword").value) { status("#passwordStatus", "Новые пароли не совпадают.", "error"); return; }
    const button = event.submitter;
    busy = true;
    updateBusy();
    if (button) button.disabled = true;
    try {
      await api("/api/builder/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: $("#currentPassword").value, newPassword: $("#newPassword").value }) });
      $("#passwordForm").reset();
      status("#passwordStatus", "Пароль изменён.", "ok");
    } catch (error) { status("#passwordStatus", friendlyError(error), "error"); }
    finally { if (button) button.disabled = false; busy = false; updateBusy(); }
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== previewFrame.contentWindow) return;
    if (event.data?.type === "iwtxz-profile-ready") sendPreview();
    if (event.data?.type === "iwtxz-font-status" && event.data.source === currentSite.customFont) {
      const labels = {
        loading: "Шрифт загружается в превью…", ready: "Свой шрифт загружен. Интерфейс кабинета остаётся в Minecraft.",
        unavailable: "Не удалось загрузить шрифт. Проверь файл и доступ по ссылке; пока используется Minecraft.", disabled: ""
      };
      $("#customFontStatus").textContent = labels[event.data.state] || "";
    }
    if (event.data?.type === "iwtxz-discord-status" && event.data.userId === currentSite.discordUserId) {
      discordSnapshotStatus = { userId: event.data.userId, state: event.data.state, updatedAt: event.data.updatedAt };
      updateDiscordHint();
    }
  });
  previewFrame.addEventListener("load", sendPreview);
  window.addEventListener("iwtxz-auth-change", (event) => {
    if (event.detail?.event === "SIGNED_OUT" && currentUser) {
      resetSession();
      status("#authStatus", "Сеанс завершён. Войди ещё раз.");
    }
  });
  window.addEventListener("beforeunload", (event) => { if (dirty || uploadCount) { event.preventDefault(); event.returnValue = ""; } });
  ["#avatarThumbnail", "#accountAvatar", "#coverThumbnail"].forEach((selector) => $(selector).addEventListener("error", (event) => { if (!event.target.src.endsWith("/img/tree.png")) event.target.src = "img/tree.png"; }));

  if (new URLSearchParams(location.search).get("auth") === "signup") document.querySelector('[data-auth-mode="signup"]').click();
  (async () => {
    const attempt = authAttemptVersion;
    try {
      const data = await api("/api/builder/auth/me", { signal: bootstrapAuthController.signal });
      if (attempt !== authAttemptVersion) return;
      if (data.user) await enterAccount(data.user, attempt);
      else status("#authStatus", "");
    } catch (error) { if (attempt === authAttemptVersion) status("#authStatus", friendlyError(error), "error"); }
  })();
})();
