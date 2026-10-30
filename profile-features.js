(() => {
  "use strict";
  const animations = [
    ["none", "Без анимации"], ["glow", "Мягкое свечение"], ["pulse", "Пульс"],
    ["float", "Парение"], ["shimmer", "Перелив"], ["glitch", "Глитч"],
    ["typewriter", "Печатная машинка"], ["blur", "Фокус"], ["flicker", "Мерцание"],
    ["bounce", "Пружина"], ["wave", "Волна"]
  ].map(([id, label]) => Object.freeze({ id, label }));
  const socials = [
    ["discord", "Discord", "username", "discord"], ["telegram", "Telegram", "https://t.me/username", "telegram"],
    ["steam", "Steam", "https://steamcommunity.com/id/username", "steam"], ["vk", "VK", "https://vk.com/username", "vk"],
    ["youtube", "YouTube", "https://youtube.com/@username", "youtube"], ["twitch", "Twitch", "https://twitch.tv/username", "twitch"],
    ["tiktok", "TikTok", "https://tiktok.com/@username", "tiktok"], ["instagram", "Instagram", "https://instagram.com/username", "instagram"],
    ["github", "GitHub", "https://github.com/username", "github"], ["spotify", "Spotify", "https://open.spotify.com/user/username", "spotify"],
    ["x", "X / Twitter", "https://x.com/username", "x"], ["soundcloud", "SoundCloud", "https://soundcloud.com/username", "soundcloud"],
    ["reddit", "Reddit", "https://reddit.com/user/username", "reddit"], ["boosty", "Boosty", "https://boosty.to/username", "boosty"],
    ["website", "Сайт", "https://example.com", null]
  ].map(([id, label, placeholder, slug]) => Object.freeze({ id, label, placeholder, slug, icon: `/img/socials/${id}.svg` }));
  const decorations = [
    ["phoenix", "Феникс", "a_0e839cd79500e7b68e2bbbed54790c28"],
    ["heartbloom", "Цветение", "a_3e1fc3c7ee2e34e8176f4737427e8f4f"],
    ["shy", "Смущение", "a_6b793a5f7e4e15eea6b10a4fde448511"],
    ["sakura", "Сакура", "a_7cf09c7e78d6eb35ae354acc1d5cc676"],
    ["moon", "Лунные фазы", "a_50cfb73a4c52235363491855d3c3c3bc"],
    ["embers", "Огоньки", "a_1005898c6acf56a9ac5010baf444f6fd"],
    ["aurora", "Аврора", "a_386445551be850bb16b73a225d0d0602"],
    ["cat", "Кошачьи ушки", "a_c3cffc19e9784f7d0b005eecdf1b566e"]
  ].map(([id, label, asset]) => Object.freeze({ id, label, asset, image: `/img/avatar-decorations/${id}.png` }));
  const animationIds = new Set(animations.map(item => item.id));
  const decorationMap = new Map(decorations.map(item => [item.id, item]));

  function applyNameAnimation(element, value) {
    if (!element) return;
    element.classList.add("iwtxz-animated-name");
    element.dataset.nameAnimation = animationIds.has(value) ? value : "none";
  }
  function decorationUrl(choice, discordDecoration) {
    if (choice === "discord") {
      const asset = discordDecoration?.asset;
      return typeof asset === "string" && /^(?:a_)?[a-f0-9]{32}$/i.test(asset)
        ? `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=256&passthrough=true` : "";
    }
    return decorationMap.get(choice)?.image || "";
  }
  function applyAvatarDecoration(avatar, choice, discordDecoration) {
    if (!avatar) return;
    const frame = avatar.tagName === "IMG" ? avatar.closest(".profile-avatar-frame") : avatar;
    if (!frame) return;
    let image = frame.querySelector(".iwtxz-avatar-decoration");
    const source = decorationUrl(choice, discordDecoration);
    if (avatar.tagName === "IMG") frame.hidden = avatar.hidden && !source;
    if (!image && !source) return;
    if (!image) {
      image = document.createElement("img");
      image.className = "iwtxz-avatar-decoration";
      image.alt = "";
      image.draggable = false;
      image.setAttribute("aria-hidden", "true");
      image.addEventListener("error", () => { image.hidden = true; });
      frame.append(image);
    }
    image.hidden = !source;
    if (!source) image.removeAttribute("src");
    else if (image.getAttribute("src") !== source) image.src = source;
  }
  function socialUrl(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 500) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }
  function renderSocials(container, site) {
    if (!container) return;
    container.classList.add("iwtxz-socials");
    for (const network of socials) {
      let element = container.querySelector(`[data-social-network="${network.id}"]`);
      if (!element && network.id === "discord") element = container.querySelector("[data-discord-copy], #discordButton");
      if (!element && network.id === "telegram") element = container.querySelector('[aria-label="Telegram"], #telegramLink');
      if (!element && network.id === "steam") element = container.querySelector('[aria-label="Steam"], #steamLink');
      const value = network.id === "discord" ? String(site.discord || "").trim().slice(0, 60) : socialUrl(site[network.id]);
      if (!element && !value) continue;
      if (!element) {
        element = document.createElement(network.id === "discord" ? "button" : "a");
        element.className = "social-link";
        if (network.id === "discord") {
          element.type = "button";
          element.addEventListener("click", async () => {
            try {
              await window.navigator.clipboard.writeText(element.dataset.discordCopy || "");
              element.title = "Discord скопирован";
            } catch { element.title = element.dataset.discordCopy || "Discord"; }
          });
        }
        container.append(element);
      }
      element.dataset.socialNetwork = network.id;
      element.setAttribute("aria-label", network.label);
      element.title = network.label;
      element.hidden = !value;
      element.style.display = value ? "" : "none";
      let icon = element.querySelector("img");
      if (!icon) { icon = document.createElement("img"); element.append(icon); }
      icon.src = network.icon;
      icon.alt = "";
      icon.draggable = false;
      if (network.id === "discord") element.dataset.discordCopy = value;
      else if (value) { element.href = value; element.target = "_blank"; element.rel = "noopener noreferrer"; }
      else element.removeAttribute("href");
    }
  }

  function setupJoinPrompt() {
    if (window.parent !== window || document.querySelector("#authForm") || new URLSearchParams(location.search).get("preview") === "1") return;
    const key = "iwtxz-join-prompt-v1";
    const alreadyShown = () => {
      try { if (window.localStorage.getItem(key) === "shown") return true; } catch {}
      try { return window.sessionStorage?.getItem(key) === "shown"; } catch { return false; }
    };
    if (alreadyShown()) return;
    let seconds = 0;
    const timer = setInterval(() => {
      if (alreadyShown()) { clearInterval(timer); return; }
      if (document.hidden || !document.body.classList.contains("is-entered")) return;
      if (++seconds < 12) return;
      clearInterval(timer);
      try { window.localStorage.setItem(key, "shown"); } catch { try { window.sessionStorage.setItem(key, "shown"); } catch {} }
      const notice = document.createElement("aside");
      notice.className = "iwtxz-join-prompt";
      notice.setAttribute("aria-label", "Создать свою страницу");
      const label = document.createElement("span"); label.textContent = "Хочешь такую же страницу?";
      const link = document.createElement("a"); link.href = "/?auth=signup"; link.textContent = "Создать ↗";
      const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", "Закрыть уведомление");
      close.addEventListener("click", () => notice.remove());
      notice.append(label, link, close); document.body.append(notice);
    }, 1000);
    window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  }

  window.IwtxzProfileFeatures = Object.freeze({ animations, socials, decorations, applyNameAnimation, applyAvatarDecoration, decorationUrl, renderSocials, socialUrl });
  if (typeof document !== "undefined") {
    const ready = () => {
      for (const container of document.querySelectorAll?.(".socials, .profile-socials") || []) {
        container.classList.add("iwtxz-socials");
        for (const network of socials.slice(0, 3)) {
          const element = network.id === "discord" ? container.querySelector("[data-discord-copy], #discordButton") : container.querySelector(`[aria-label="${network.label}"]`);
          const image = element?.querySelector("img");
          if (image) { image.src = network.icon; element.dataset.socialNetwork = network.id; }
        }
      }
      setupJoinPrompt();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
  }
})();
