(() => {
  "use strict";

  const profile = document.currentScript?.dataset.profile;
  if (!/^[a-z0-9_-]{3,32}$/.test(profile || "") || window.location.protocol === "file:") return;

  function safeAsset(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, document.baseURI);
      if (url.username || url.password) return "";
      if (url.protocol === "https:") return url.href;
      if (url.origin === window.location.origin && url.protocol === "http:" && /^\/(?:img\/|sound\/|api\/builder\/assets\/file\/)/.test(url.pathname)) return url.pathname + url.search;
    } catch {}
    return "";
  }

  function safeSocial(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }

  function apply(site) {
    if (!site || typeof site !== "object" || site.owner !== profile) return;
    window.iwtxzPublishedSettings = site;
    const nickname = typeof site.nickname === "string" ? site.nickname.slice(0, 40) : profile;
    if (typeof fullName !== "undefined") fullName = nickname;
    if (typeof tabTitlePrefix !== "undefined") tabTitlePrefix = String(site.title || nickname).slice(0, 80);
    const name = document.querySelector(".name-text");
    if (name) { name.textContent = nickname; name.dataset.text = nickname; }
    document.querySelector(".name")?.setAttribute("aria-label", nickname);
    const description = document.querySelector(".tagline-text");
    if (description) description.textContent = typeof site.description === "string" ? site.description.slice(0, 500) : "";
    const avatar = document.querySelector(".avatar");
    const avatarUrl = safeAsset(site.avatar);
    if (avatar && avatarUrl) avatar.style.backgroundImage = `url(${JSON.stringify(avatarUrl)})`;
    if (avatar) avatar.style.display = avatarUrl ? "" : "none";
    const size = Number(site.avatarSize);
    if (avatar && Number.isFinite(size)) {
      const pixels = `${Math.max(80, Math.min(220, size))}px`;
      avatar.style.width = pixels;
      avatar.style.height = pixels;
    }
    const font = site.font === "system" ? '"Trebuchet MS", "Segoe UI", sans-serif' : '"Minecraft", "Trebuchet MS", "Segoe UI", sans-serif';
    document.body.style.fontFamily = font;
    if (site.font !== "system" && !document.querySelector("style[data-builder-font]")) {
      const style = document.createElement("style");
      style.dataset.builderFont = "true";
      style.textContent = '@font-face{font-family:"Minecraft";src:url("/font/minecraft.ttf") format("truetype");font-display:swap}';
      document.head.append(style);
    }
    if (/^#[0-9a-f]{6}$/i.test(site.accentColor || "")) {
      document.documentElement.style.setProperty("--text", site.accentColor);
      document.documentElement.style.setProperty("--muted", site.accentColor);
      const heading = document.querySelector(".name");
      if (heading) heading.style.color = site.accentColor;
    }
    const background = safeAsset(site.background);
    const dim = Number(site.backgroundDim);
    const opacity = Number.isFinite(dim) ? Math.max(0, Math.min(85, dim)) / 100 : 0.58;
    const shade = `linear-gradient(rgba(0,0,0,${opacity}),rgba(0,0,0,${opacity}))`;
    let video = document.querySelector(".page-bg-video");
    let videoShade = document.querySelector("[data-builder-video-shade]");
    if (site.backgroundType === "video" && background) {
      if (!video) {
        video = document.createElement("video");
        video.className = "page-bg-video";
        video.setAttribute("aria-hidden", "true");
        Object.assign(video.style, { position: "fixed", inset: "0", zIndex: "-3", width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" });
        document.body.prepend(video);
      }
      video.src = background;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.hidden = false;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) void video.play().catch(() => {});
      else video.pause();
      if (!videoShade) {
        videoShade = document.createElement("div");
        videoShade.dataset.builderVideoShade = "true";
        videoShade.setAttribute("aria-hidden", "true");
        Object.assign(videoShade.style, { position: "fixed", inset: "0", zIndex: "-2", pointerEvents: "none" });
        document.body.prepend(videoShade);
      }
      videoShade.style.background = shade;
      document.body.style.background = "none";
      document.body.style.backgroundColor = "#09090c";
    } else {
      if (video) { video.pause(); video.style.display = "none"; }
      videoShade?.remove();
      document.body.style.background = background ? `${shade},url(${JSON.stringify(background)}) center / cover fixed no-repeat #09090c` : "#09090c";
    }
    const discord = typeof site.discord === "string" ? site.discord.slice(0, 60) : "";
    document.querySelectorAll("[data-discord-copy]").forEach((button) => {
      button.dataset.discordCopy = discord;
      button.title = discord;
      button.setAttribute("aria-label", `Скопировать Discord: ${discord}`);
      if (!discord || (button.classList.contains("discord-card") && site.showDiscord === false)) button.style.display = "none";
      else button.style.removeProperty("display");
    });
    const discordName = document.querySelector(".discord-card-name");
    if (discordName) discordName.textContent = discord;
    const discordAvatar = document.querySelector(".discord-card-avatar");
    if (discordAvatar && avatarUrl) discordAvatar.src = avatarUrl;
    if (discordAvatar) {
      const wrapper = discordAvatar.closest(".discord-card-media") || discordAvatar;
      wrapper.style.display = avatarUrl ? "" : "none";
    }
    document.querySelectorAll(".discord-card-status, .discord-card-badges").forEach((element) => { element.style.display = "none"; });
    for (const [label, field] of [["Telegram", "telegram"], ["Steam", "steam"]]) {
      let link = document.querySelector(`.socials a[aria-label="${label}"]`);
      const url = safeSocial(site[field]);
      if (!link && url) {
        link = document.createElement("a");
        link.className = "social-link";
        link.setAttribute("aria-label", label);
        const image = document.createElement("img");
        image.src = `/img/${field}.png`;
        image.alt = "";
        link.append(image);
        document.querySelector(".socials")?.append(link);
      }
      if (link) {
        link.style.display = url ? "" : "none";
        if (url) { link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      }
    }
    const music = safeAsset(site.music);
    const musicTitle = typeof site.musicTitle === "string" ? site.musicTitle.slice(0, 100) : "sound";
    const track = document.querySelector("[data-track-title]");
    if (track) track.textContent = musicTitle;
    const coverUrl = safeAsset(site.musicCover);
    document.querySelectorAll(".track-card-cover").forEach((image) => {
      if (coverUrl) image.src = coverUrl;
      const wrapper = image.closest(".track-card-cover-wrap") || image;
      wrapper.style.display = coverUrl ? "" : "none";
    });
    const player = document.querySelector(".track-card");
    if (player) {
      player.style.display = music ? "" : "none";
      if (!coverUrl) player.style.gridTemplateColumns = "minmax(0, 1fr)";
      else player.style.removeProperty("grid-template-columns");
    }
    document.querySelectorAll(".entry-volume, .audio-toggle").forEach((control) => { control.style.display = music ? "" : "none"; });
    if (typeof bgAudio !== "undefined") {
      bgAudio.loop = site.musicLoop !== false;
      if (typeof playlist !== "undefined" && playlist[0]) { playlist[0].title = musicTitle; playlist[0].src = music; }
      if (music && typeof loadTrack === "function") loadTrack(0, { autoplay: document.body.classList.contains("is-entered") });
      else if (!music) {
        if (typeof cancelAudioFade === "function") cancelAudioFade();
        if (typeof setAudioRetryListening === "function") setAudioRetryListening(false);
        if (typeof audioShouldPlay !== "undefined") audioShouldPlay = false;
        bgAudio.pause();
        bgAudio.removeAttribute("src");
        bgAudio.load();
      }
    }
    const entry = document.getElementById("entryButton");
    if (entry) entry.textContent = typeof site.entryText === "string" ? site.entryText.slice(0, 80) : "click to enter…";
    if (typeof lockNameSize === "function") {
      lockNameSize();
      document.fonts?.ready.then(lockNameSize);
    }
  }

  if (window.IwtxzBackend?.isConfigured()) {
    window.IwtxzBackend.request(`/api/builder/profile/${encodeURIComponent(profile)}`)
      .then((data) => { if (data?.site) apply(data.site); })
      .catch(() => {});
  } else if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    fetch(`/api/builder/profile/${encodeURIComponent(profile)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.site) apply(data.site); })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  }
})();
