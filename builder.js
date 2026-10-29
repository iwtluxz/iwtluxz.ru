(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const textFields = ["title", "nickname", "description", "entryText", "musicTitle", "discord", "telegram", "steam"];
  const numberFields = ["avatarSize", "backgroundDim"];
  const optionFields = ["font", "accentColor", "backgroundType"];
  const boolFields = ["musicLoop", "showDiscord"];
  const assetFields = ["avatar", "background", "music", "musicCover"];
  const defaults = {
    title: "", nickname: "", description: "", entryText: "click to enter...", discord: "", telegram: "", steam: "",
    avatar: "img/mainavatar.gif", background: "img/background.mp4", backgroundType: "video",
    music: "sound/sound.mp3", musicTitle: "one more time", musicCover: "img/mysoundicon.png",
    avatarSize: 150, backgroundDim: 58, accentColor: "#f5f5f7", font: "minecraft", musicLoop: true, showDiscord: true
  };
  const fileHints = Object.fromEntries(all("[data-file-note]").map((e) => [e.dataset.fileNote, e.textContent]));
  const previewFrame = $("#previewFrame");
  let currentUser = null;
  let currentSite = { ...defaults };
  let savedSnapshot = "";
  let dirty = false;
  let authMode = "login";
  let busy = false;
  let uploadCount = 0;
  let sessionVersion = 0;
  let previewTimer;
  let toastTimer;

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
    if (location.protocol === "file:") throw new Error("Для входа открой кабинет через локальный сервер, а не как файл. Инструкция — в README-BUILDER.md.");
    if (window.IwtxzBackend?.isConfigured()) {
      try { return await window.IwtxzBackend.request(path, options); }
      catch (error) {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.upload ? 45000 : 15000);
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    try {
      const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error("Сервис кабинета недоступен. Убедись, что сайт открыт через сервер с поддержкой входа.");
      if (!response.ok) {
        const error = new Error(data.error || "Не получилось выполнить действие.");
        error.status = response.status;
        if (response.status === 401 && data.code === "unauthorized" && currentUser) {
          resetSession();
          status("#authStatus", "Время входа истекло. Войди ещё раз.", "error");
        }
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }

  function readEditor() {
    const site = { ...currentSite };
    textFields.forEach((key) => { site[key] = $("#" + key).value.trim(); });
    numberFields.forEach((key) => { site[key] = Number($("#" + key).value); });
    optionFields.forEach((key) => { site[key] = $("#" + key).value; });
    boolFields.forEach((key) => { site[key] = $("#" + key).checked; });
    return site;
  }

  function snapshot(site) {
    return JSON.stringify(Object.fromEntries([...textFields, ...numberFields, ...optionFields, ...boolFields, ...assetFields].map((key) => [key, site[key]])));
  }

  function writeEditor(site) {
    currentSite = { ...defaults, ...site };
    textFields.concat(numberFields, optionFields).forEach((key) => { $("#" + key).value = currentSite[key] ?? ""; });
    boolFields.forEach((key) => { $("#" + key).checked = Boolean(currentSite[key]); });
    all("[data-asset-url]").forEach((field) => { field.value = /^https:\/\//i.test(currentSite[field.dataset.assetUrl] || "") ? currentSite[field.dataset.assetUrl] : ""; });
    all("[data-upload]").forEach((field) => { field.value = ""; });
    all("[data-file-note]").forEach((note) => { note.textContent = fileHints[note.dataset.fileNote]; });
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
    $("#avatarThumbnail").src = currentSite.avatar || "img/tree.png";
    $("#accountAvatar").src = currentSite.avatar || "img/tree.png";
    $("#coverThumbnail").src = currentSite.musicCover || "img/tree.png";
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 70);
  }

  function profileUrl() { return `/profile.html?u=${encodeURIComponent(currentUser?.username || "")}`; }

  function updatePublication() {
    if (!currentUser) return;
    const url = profileUrl();
    $("#pageAddress").textContent = `${location.host}${url}`;
    $("#openProfile").href = url;
    $("#openProfile").classList.toggle("hidden", !currentSite.publishedAt);
    $("#publishedStatus").textContent = currentSite.publishedAt
      ? "Опубликовано · " + new Date(currentSite.publishedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "Страница ещё не опубликована";
  }

  function updateBusy() {
    $("#editorForm").inert = busy;
    $("#saveButton").disabled = busy || uploadCount > 0;
    $("#publishButton").disabled = busy || uploadCount > 0;
    $("#deleteButton").disabled = busy || uploadCount > 0;
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
    sessionVersion += 1;
    currentUser = null;
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
    $("#accountName").textContent = "";
    $("#openProfile").removeAttribute("href");
  }

  async function enterAccount(user) {
    sessionVersion += 1;
    const version = sessionVersion;
    currentUser = user;
    const data = await api("/api/builder/sites/list");
    if (version !== sessionVersion) return;
    const site = data.sites?.[0] || { ...defaults, title: user.username, nickname: user.username };
    writeEditor(site);
    $("#userLine").textContent = `@${user.username}`;
    $("#accountName").textContent = `@${user.username}`;
    $("#accountControls").classList.remove("hidden");
    document.body.classList.remove("auth-locked");
    $("#password").value = "";
    $("#confirmPassword").value = "";
    $("#ownerClaim").value = "";
    setSection("profile");
    status("#editorStatus", "Черновик виден только тебе. Изменения появятся на странице после применения.");
    sendPreview();
  }

  function validateSite() {
    const site = readEditor();
    if (!site.nickname || !site.title) {
      setSection("profile");
      $(site.nickname ? "#title" : "#nickname").focus();
      throw new Error("Заполни ник и название вкладки.");
    }
    for (const key of ["telegram", "steam"]) {
      if (site[key]) {
        try { const url = new URL(site[key]); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
        catch { setSection("links"); $("#" + key).focus(); throw new Error("Ссылка должна начинаться с https:// и вести на твою страницу."); }
      }
    }
    for (const input of all("[data-asset-url]")) {
      if (input.value && !/^https:\/\//i.test(input.value)) throw new Error("Для файлов по ссылке используй адрес с https://.");
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

  const mimeByExtension = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" };
  async function uploadFile(input) {
    const file = input.files?.[0];
    if (!file || !currentUser) return;
    const key = input.dataset.upload;
    const version = sessionVersion;
    const type = file.type || mimeByExtension[file.name.split(".").pop().toLowerCase()] || "";
    const image = /^image\/(png|jpeg|gif|webp)$/.test(type);
    const allowed = key === "music" ? /^audio\/(mpeg|mp3|ogg|wav|x-wav|mp4|webm)$/.test(type)
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
    authMode = button.dataset.authMode;
    all("[data-auth-mode]").forEach((tab) => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active)); });
    const signup = authMode === "signup";
    $("#confirmPasswordField").classList.toggle("hidden", !signup);
    $("#confirmPassword").required = signup;
    $("#password").minLength = signup ? 8 : 1;
    $("#password").autocomplete = signup ? "new-password" : "current-password";
    $("#authSubmit").textContent = signup ? "Создать свою страницу" : "Войти в кабинет";
    updateOwnerClaimField();
    status("#authStatus", signup ? "Регистрация открыта. У каждого аккаунта своя страница." : "Войди, чтобы продолжить настройку страницы.");
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
    if (authMode === "signup" && $("#password").value !== $("#confirmPassword").value) { status("#authStatus", "Пароли не совпадают.", "error"); return; }
    const mode = authMode;
    const credentials = { username: $("#username").value.trim(), password: $("#password").value };
    if (mode === "signup" && $("#ownerClaim").value.trim()) credentials.ownerClaim = $("#ownerClaim").value.trim();
    all("#authForm button, [data-auth-mode]").forEach((button) => { button.disabled = true; });
    try {
      status("#authStatus", mode === "signup" ? "Создаём аккаунт…" : "Входим…");
      const result = await api(`/api/builder/auth/${mode}`, { method: "POST", body: JSON.stringify(credentials) });
      await enterAccount(result.user);
    } catch (error) { status("#authStatus", friendlyError(error), "error"); }
    finally { all("#authForm button, [data-auth-mode]").forEach((button) => { button.disabled = false; }); }
  });

  $("#logoutButton").addEventListener("click", async () => {
    if (uploadCount) { toast("Подожди, пока загрузятся файлы"); return; }
    if (dirty && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
    try { await api("/api/builder/auth/logout", { method: "POST", body: "{}" }); resetSession(); status("#authStatus", "Ты вышел из аккаунта."); }
    catch (error) { toast(friendlyError(error)); }
  });

  $("#editorForm").addEventListener("submit", (event) => event.preventDefault());
  $("#editorForm").addEventListener("input", (event) => {
    if (event.target.type === "file") return;
    const key = event.target.dataset.assetUrl;
    if (key) currentSite[key] = event.target.value.trim();
    updatePreview();
  });
  $("#editorForm").addEventListener("change", (event) => { if (event.target.type !== "file") updatePreview(); });
  all("[data-upload]").forEach((input) => input.addEventListener("change", () => uploadFile(input)));
  all("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.remove;
    if (uploadCount) return;
    currentSite[key] = "";
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
    if (busy || uploadCount || !confirm("Удалить черновик и опубликованную страницу? Это действие нельзя отменить.")) return;
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
    if (event.origin === location.origin && event.source === previewFrame.contentWindow && event.data?.type === "iwtxz-profile-ready") sendPreview();
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

  (async () => {
    try {
      const data = await api("/api/builder/auth/me");
      if (data.user) await enterAccount(data.user);
      else status("#authStatus", "Войди или создай аккаунт, чтобы настроить свою страницу.");
    } catch (error) { status("#authStatus", friendlyError(error), "error"); }
  })();
})();
