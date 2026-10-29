(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const isPreview = params.get("preview") === "1" && window.parent !== window;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const byId = (id) => document.getElementById(id);
  const audio = byId("profileAudio");
  const backgroundVideo = byId("backgroundVideo");
  const backgroundImage = byId("backgroundImage");
  const player = byId("musicPlayer");
  const seek = byId("musicSeek");
  const volume = byId("musicVolume");
  const overlay = byId("entryOverlay");
  const entryButton = byId("entryButton");
  const pageMessage = byId("pageMessage");
  let currentSite = null;
  let entered = isPreview;
  let toastTimer;
  let mediaKey = "iwtxz-profile-volume";

  function text(value, limit = 240) {
    return typeof value === "string" ? value.slice(0, limit) : "";
  }

  function assetUrl(value, kind) {
    const candidate = text(value, 6_000_000).trim();
    if (!candidate) return "";
    if (isPreview && candidate.startsWith("blob:")) {
      try { return new URL(candidate).origin === window.location.origin ? candidate : ""; } catch { return ""; }
    }
    if (isPreview && /^data:(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/(?:mpeg|mp3|ogg|wav|x-wav|webm|mp4)|video\/(?:mp4|webm));base64,[A-Za-z0-9+/=]+$/.test(candidate)) {
      return candidate;
    }
    try {
      const url = new URL(candidate, document.baseURI);
      if (url.username || url.password) return "";
      if (url.protocol === "https:") return url.href;
      if (url.origin !== window.location.origin) return "";
      if (!["http:", "https:"].includes(url.protocol)) return "";
      if (!/^\/(?:img|sound)\//.test(url.pathname) && !/^\/api\/builder\/assets\/file\/[a-z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return "";
      return url.pathname + url.search;
    } catch {
      return "";
    }
  }

  function socialUrl(value) {
    try {
      const url = new URL(text(value, 500));
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function formatTime(value) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  }

  function syncAudio() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const playing = !audio.paused && !audio.ended;
    byId("musicCurrent").textContent = formatTime(current);
    byId("musicDuration").textContent = formatTime(duration);
    seek.disabled = duration <= 0;
    seek.value = duration > 0 ? String(Math.min(current / duration * 100, 100)) : "0";
    seek.setAttribute("aria-valuetext", `${formatTime(current)} из ${formatTime(duration)}`);
    player.classList.toggle("is-playing", playing);
    byId("musicToggle").setAttribute("aria-pressed", String(playing));
    byId("musicToggle").setAttribute("aria-label", playing ? "Приостановить музыку" : "Включить музыку");
  }

  function syncVolume() {
    const percent = Math.round(audio.volume * 100);
    volume.value = String(percent);
    volume.setAttribute("aria-valuetext", `${percent}%`);
  }

  function restoreVolume(owner) {
    mediaKey = `iwtxz-profile-${owner || "preview"}-volume`;
    let stored = null;
    try { stored = window.localStorage.getItem(mediaKey); } catch {}
    const amount = stored === null || stored.trim() === "" ? 0.45 : Number(stored);
    audio.volume = Number.isFinite(amount) ? Math.max(0, Math.min(amount, 1)) : 0.45;
    syncVolume();
  }

  function showToast(message) {
    byId("copyToast").textContent = message;
    byId("copyToast").classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => byId("copyToast").classList.remove("is-visible"), 1800);
  }

  async function copyDiscord() {
    if (!currentSite?.discord) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentSite.discord);
      } else {
        const field = document.createElement("textarea");
        field.value = currentSite.discord;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("copy unavailable");
      }
      showToast("Имя Discord скопировано");
    } catch {
      showToast(`Discord: ${currentSite.discord}`);
    }
  }

  async function playMusic() {
    if (!currentSite?.music) return;
    const errorLabel = byId("musicError");
    try {
      await audio.play();
      errorLabel.hidden = true;
    } catch {
      errorLabel.textContent = "Не удалось включить трек. Попробуй нажать воспроизведение ещё раз.";
      errorLabel.hidden = false;
    }
    syncAudio();
  }

  function enter() {
    if (!currentSite || entered) return;
    entered = true;
    document.body.classList.add("is-entered");
    overlay.classList.add("is-hidden");
    if (overlay.contains(document.activeElement)) {
      byId("profileName").tabIndex = -1;
      byId("profileName").focus({ preventScroll: true });
    }
    overlay.setAttribute("aria-hidden", "true");
    if (currentSite.music) void playMusic();
  }

  function applyBackground(site) {
    const url = assetUrl(site.background, "background");
    const video = site.backgroundType === "video";
    if (url && video) {
      backgroundImage.style.backgroundImage = "none";
      if (backgroundVideo.getAttribute("src") !== url) {
        backgroundVideo.pause();
        backgroundVideo.src = url;
        backgroundVideo.load();
      }
      backgroundVideo.hidden = reducedMotion.matches;
      if (!reducedMotion.matches) void backgroundVideo.play().catch(() => {});
      else backgroundVideo.pause();
    } else {
      backgroundVideo.pause();
      backgroundVideo.hidden = true;
      if (backgroundVideo.hasAttribute("src")) {
        backgroundVideo.removeAttribute("src");
        backgroundVideo.load();
      }
      backgroundImage.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : "none";
    }
  }

  function setLink(id, value) {
    const link = byId(id);
    const url = socialUrl(value);
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute("href");
  }

  function applySite(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    const site = {
      ...input,
      owner: text(input.owner || input.id, 32),
      title: text(input.title, 80),
      nickname: text(input.nickname, 40) || "nickname",
      description: text(input.description, 500),
      discord: text(input.discord, 60),
      musicTitle: text(input.musicTitle, 100) || "sound",
      music: assetUrl(input.music, "music")
    };
    const firstRender = !currentSite;
    const sourceChanged = audio.getAttribute("src") !== site.music;
    const ownerChanged = currentSite?.owner !== site.owner;
    currentSite = site;
    document.title = `${site.title || site.nickname} | iwtxz`;
    document.documentElement.style.setProperty("--accent", /^#[0-9a-f]{6}$/i.test(site.accentColor) ? site.accentColor : "#f5f5f7");
    const avatarSize = Number(site.avatarSize);
    document.documentElement.style.setProperty("--avatar-size", `${Number.isFinite(avatarSize) ? Math.min(220, Math.max(80, avatarSize)) : 150}px`);
    const dim = Number(site.backgroundDim);
    document.documentElement.style.setProperty("--background-dim", String(Number.isFinite(dim) ? Math.min(85, Math.max(0, dim)) / 100 : 0.58));
    document.documentElement.style.setProperty("--profile-font", site.font === "system" ? '"Trebuchet MS", "Segoe UI", sans-serif' : '"Minecraft", "Trebuchet MS", "Segoe UI", sans-serif');
    byId("profileName").textContent = site.nickname;
    byId("profileDescription").textContent = site.description;
    const avatar = assetUrl(site.avatar, "avatar");
    byId("profileAvatar").hidden = !avatar;
    byId("discordAvatar").hidden = !avatar;
    if (avatar) {
      byId("profileAvatar").src = avatar;
      byId("discordAvatar").src = avatar;
    } else {
      byId("profileAvatar").removeAttribute("src");
      byId("discordAvatar").removeAttribute("src");
    }
    byId("profileAvatar").alt = `Аватар ${site.nickname}`;
    byId("discordName").textContent = site.discord;
    byId("discordButton").hidden = !site.discord;
    byId("discordButton").setAttribute("aria-label", `Скопировать Discord: ${site.discord}`);
    byId("discordCard").hidden = !site.discord || site.showDiscord === false;
    byId("discordCard").setAttribute("aria-label", `Скопировать Discord: ${site.discord}`);
    setLink("telegramLink", site.telegram);
    setLink("steamLink", site.steam);
    byId("musicTitle").textContent = site.musicTitle;
    const cover = assetUrl(site.musicCover, "musicCover");
    byId("musicCover").hidden = !cover;
    player.classList.toggle("no-cover", !cover);
    if (cover) byId("musicCover").src = cover;
    else byId("musicCover").removeAttribute("src");
    player.hidden = !site.music;
    document.body.classList.toggle("no-music", !site.music);
    audio.loop = site.musicLoop !== false;
    if (sourceChanged) {
      audio.pause();
      if (site.music) audio.src = site.music;
      else audio.removeAttribute("src");
      audio.load();
      byId("musicError").hidden = true;
    }
    if (ownerChanged) restoreVolume(site.owner);
    applyBackground(site);
    entryButton.textContent = text(site.entryText, 80) || "click to enter…";
    byId("profile").hidden = false;
    pageMessage.hidden = true;
    document.body.classList.remove("is-loading");
    if (firstRender) {
      if (isPreview || params.get("demo") === "1") {
        entered = true;
        document.body.classList.add("is-entered");
        overlay.hidden = true;
      } else {
        overlay.hidden = false;
      }
    }
    syncAudio();
  }

  byId("discordButton").addEventListener("click", copyDiscord);
  byId("discordCard").addEventListener("click", copyDiscord);
  entryButton.addEventListener("click", enter);
  overlay.addEventListener("click", enter);
  window.addEventListener("keydown", (event) => {
    if (!entered && currentSite && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      enter();
    }
  });
  byId("musicToggle").addEventListener("click", () => {
    if (audio.paused) void playMusic();
    else audio.pause();
  });
  seek.addEventListener("input", () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(1, Number(seek.value) / 100)) * audio.duration;
    syncAudio();
  });
  volume.addEventListener("input", () => {
    audio.volume = Math.max(0, Math.min(1, Number(volume.value) / 100));
    try { window.localStorage.setItem(mediaKey, String(audio.volume)); } catch {}
    syncVolume();
  });
  for (const event of ["play", "pause", "ended", "timeupdate", "loadedmetadata", "durationchange", "emptied", "seeked"]) audio.addEventListener(event, syncAudio);
  audio.addEventListener("error", () => {
    if (!currentSite?.music) return;
    byId("musicError").textContent = "Трек недоступен. Владелец страницы может заменить файл в настройках.";
    byId("musicError").hidden = false;
    syncAudio();
  });
  byId("profileAvatar").addEventListener("error", (event) => {
    event.currentTarget.hidden = true;
  });
  byId("discordAvatar").addEventListener("error", (event) => { event.currentTarget.hidden = true; });
  byId("musicCover").addEventListener("error", (event) => {
    event.currentTarget.hidden = true;
    player.classList.add("no-cover");
  });
  reducedMotion.addEventListener("change", () => { if (currentSite) applyBackground(currentSite); });
  window.addEventListener("pagehide", () => { audio.pause(); backgroundVideo.pause(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) backgroundVideo.pause();
    else if (currentSite) applyBackground(currentSite);
  });

  if (isPreview) {
    document.body.classList.add("is-preview", "is-entered");
    pageMessage.textContent = "Настрой свою страницу в редакторе";
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      if (event.data?.type !== "iwtxz-profile-preview") return;
      applySite(event.data.site);
    });
    window.parent.postMessage({ type: "iwtxz-profile-ready" }, window.location.origin);
  } else {
    const path = window.location.pathname.match(/^\/u\/([a-z0-9_-]{3,32})\/?$/i);
    const selectedUsername = params.get("u") || path?.[1] || "";
    const username = /^[a-z0-9][a-z0-9_-]{2,31}$/i.test(selectedUsername) ? selectedUsername.toLowerCase() : "";
    if (!username) {
      pageMessage.textContent = "Профиль не выбран. Открой свою страницу из личного кабинета.";
      return;
    }
    const loadProfile = window.IwtxzBackend?.isConfigured()
      ? window.IwtxzBackend.request(`/api/builder/profile/${encodeURIComponent(username)}`)
      : ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
        ? fetch(`/api/builder/profile/${encodeURIComponent(username)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const error = new Error(response.status === 404 ? "Страница пока не опубликована или не существует." : "Не удалось загрузить страницу. Попробуй позже.");
          throw error;
        }
        return response.json();
      })
        : Promise.reject(new Error("Сервер профилей ещё не подключён владельцем сайта."));
    loadProfile
      .then((data) => {
        if (!data.site) throw new Error("Страница пока не опубликована.");
        applySite(data.site);
      })
      .catch((error) => { pageMessage.textContent = error.message || "Не удалось загрузить страницу."; });
  }
})();
