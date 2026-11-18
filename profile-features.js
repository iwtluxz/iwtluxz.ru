(() => {
  "use strict";
  const animations = [
    ["none", "Без анимации"], ["glow", "Мягкое свечение"], ["pulse", "Пульс"],
    ["float", "Парение"], ["shimmer", "Перелив"], ["glitch", "Глитч"],
    ["typewriter", "Печатная машинка"], ["blur", "Фокус"], ["flicker", "Мерцание"],
    ["bounce", "Пружина"], ["wave", "Волна"], ["neon", "Неон"],
    ["rainbow", "Радужный поток"], ["outline", "Живой контур"], ["scanline", "Сканирование"],
    ["spotlight", "Вспышка света"], ["echo", "Эхо"], ["orbit", "Орбита"], ["heartbeat", "Сердцебиение"]
  ].map(([id, label]) => Object.freeze({ id, label }));
  const descriptionAnimations = [
    ["none", "Без анимации"], ["glow", "Мягкое свечение"], ["pulse", "Дыхание"],
    ["float", "Парение"], ["shimmer", "Перелив света"], ["reveal", "Проявление"],
    ["flicker", "Мерцание"], ["wave", "Покачивание"], ["gradient", "Цветной перелив"]
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
  const bundledDecorations = [
    ["phoenix", "Феникс", "a_0e839cd79500e7b68e2bbbed54790c28"],
    ["heartbloom", "Цветение", "a_3e1fc3c7ee2e34e8176f4737427e8f4f"],
    ["shy", "Смущение", "a_6b793a5f7e4e15eea6b10a4fde448511"],
    ["sakura", "Сакура", "a_7cf09c7e78d6eb35ae354acc1d5cc676"],
    ["moon", "Лунные фазы", "a_50cfb73a4c52235363491855d3c3c3bc"],
    ["embers", "Огоньки", "a_1005898c6acf56a9ac5010baf444f6fd"],
    ["aurora", "Аврора", "a_386445551be850bb16b73a225d0d0602"],
    ["cat", "Кошачьи ушки", "a_c3cffc19e9784f7d0b005eecdf1b566e"]
  ].map(([id, label, asset]) => Object.freeze({ id, label, asset, image: `/img/avatar-decorations/${id}.png` }));
  const decorations=window.IwtxzAvatarDecorations?.items||bundledDecorations;
  const animationIds = new Set(animations.map(item => item.id));
  const descriptionAnimationIds = new Set(descriptionAnimations.map(item => item.id));
  const decorationMap = new Map(decorations.map(item => [item.id, item]));

  function applyNameAnimation(element, value) {
    if (!element) return;
    element.classList.add("iwtxz-animated-name");
    element.dataset.nameAnimation = animationIds.has(value) ? value : "none";
  }
  function applyGradientFlow(element, angle) {
    if (!element) return;
    const number = Number(angle);
    const radians = (Number.isFinite(number) ? Math.min(360, Math.max(0, number)) : 90) * Math.PI / 180;
    const x = Math.sin(radians) * 50, y = -Math.cos(radians) * 50;
    for (const [key, value] of [["from-x", 50-x], ["to-x", 50+x], ["from-y", 50-y], ["to-y", 50+y]]) {
      element.style.setProperty(`--gradient-${key}`, `${value.toFixed(3)}%`);
    }
  }
  function applyDescriptionAnimation(element, value) {
    if (!element) return;
    element.classList.add("iwtxz-animated-description");
    element.dataset.descriptionAnimation = descriptionAnimationIds.has(value) ? value : "none";
  }
  function applyDescriptionGradient(element, settings = {}) {
    if (!element) return;
    element.classList.add("iwtxz-animated-description");
    if (!element.dataset.descriptionAnimation) element.dataset.descriptionAnimation = "none";
    const enabled = settings.descriptionGradient === true;
    const animated = enabled && settings.descriptionGradientAnimated === true;
    element.classList.toggle("iwtxz-description-gradient", enabled);
    element.classList.toggle("iwtxz-description-gradient-animated", animated);
    if (!enabled) {
      for (const key of ["--description-gradient", "--description-gradient-speed", "--gradient-from-x", "--gradient-to-x", "--gradient-from-y", "--gradient-to-y"]) element.style.removeProperty(key);
      return;
    }
    const color = (value, fallback) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    const number = (value, min, max, fallback) => {
      const candidate = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
      return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : fallback;
    };
    const start = color(settings.descriptionGradientStart, "#ffffff"), end = color(settings.descriptionGradientEnd, "#8b5cf6");
    const angle = number(settings.descriptionGradientAngle, 0, 360, 90);
    const speed = number(settings.descriptionGradientSpeed, 2, 30, 6);
    element.style.setProperty("--description-gradient", `linear-gradient(${angle}deg,${start},${end}${animated ? `,${start}` : ""})`);
    element.style.setProperty("--description-gradient-speed", `${speed}s`);
    applyGradientFlow(element, angle);
  }
  function applyDescriptionStyle(element, settings = {}) {
    if (!element) return;
    applyDescriptionAnimation(element, settings.descriptionAnimation);
    applyDescriptionGradient(element, settings);
  }
  function decorationUrl(choice, discordDecoration) {
    if (choice === "discord") {
      const asset = discordDecoration?.asset;
      return typeof asset === "string" && /^(?:a_)?[a-f0-9]{32}$/i.test(asset)
        ? `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=256&passthrough=true` : "";
    }
    const item=window.IwtxzAvatarDecorations?.items.find(item=>item.id===choice)||decorationMap.get(choice);
    if(item)return item.image;
    return /^discord-a_[a-f0-9]{32}$/.test(choice||'')?`https://cdn.discordapp.com/avatar-decoration-presets/${choice.slice(8)}.png?size=240&passthrough=true`:'';
  }
  function applyAvatarDecoration(avatar, choice, discordDecoration) {
    if (!avatar) return;
    let frame = avatar.tagName === "IMG" ? avatar.closest(".profile-avatar-frame") : avatar;
    if (!frame && avatar.tagName === "IMG") {
      frame=document.createElement("span");frame.className="profile-avatar-frame";avatar.before(frame);frame.append(avatar);
    }
    if (!frame) return;
    let image = frame.querySelector(".iwtxz-avatar-decoration");
    const reduced = false;
    const item=window.IwtxzAvatarDecorations?.items.find(item=>item.id===choice)||decorationMap.get(choice);
    const fallback=item?.thumbnail||(item?.image?.startsWith('/img/avatar-decorations/')?item.image.replace(/\.png$/,'.webp'):'');
    let source = decorationUrl(choice, discordDecoration);
    if(reduced&&source)source=fallback||source.replace(/\.png(?:\?.*)?$/,'.webp?size=256&passthrough=true');
    if (avatar.tagName === "IMG") frame.hidden = avatar.hidden && !source;
    if (!image && !source) return;
    if (!image) {
      image = document.createElement("img");
      image.className = "iwtxz-avatar-decoration";
      image.alt = "";
      image.draggable = false;
      image.setAttribute("aria-hidden", "true");
      image.addEventListener("error", () => {
        const still=image.dataset.decorationFallback;
        if(still&&image.getAttribute('src')!==still&&image.dataset.decorationFallbackUsed!=='true'){
          image.dataset.decorationFallbackUsed='true';image.dataset.freeze='false';image.removeAttribute('crossorigin');image.src=still;image.hidden=false;
        }else image.hidden=true;
      });
      frame.append(image);
    }
    const key=(reduced?'still:':'animated:')+source;
    const update=image.dataset.decorationKey!==key;
    if(update||!source)image.hidden=!source;
    if (!source) {image.removeAttribute("src");image.dataset.decorationKey=key;}
    else if(update){
      image.dataset.decorationKey=key;image.dataset.freeze='false';image.dataset.decorationFallback=fallback;image.dataset.decorationFallbackUsed='false';
      image.removeAttribute('crossorigin');
      image.src=source;
    }
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
      if (icon.getAttribute("src") !== network.icon) icon.src = network.icon;
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

  let viewsNode, viewsOwner, viewsValue, viewsIcon, viewsLabel, viewsCount='…', viewsError=false, viewsUnavailable=false;
  const viewVisitors=new Map();
  function showProfileViews(site, { preview = false } = {}) {
    if (!document.querySelector(".profile-description, main.panel .tagline")) return;
    if (!viewsNode) {
      viewsNode = document.createElement("div");
      viewsNode.className = "iwtxz-profile-views";
      viewsNode.setAttribute("role", "status");
      viewsLabel=document.createElement('span');viewsLabel.className='iwtxz-views-label';viewsLabel.textContent='Просмотры ·';
      viewsIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');
      viewsIcon.setAttribute('viewBox','0 0 24 24');viewsIcon.setAttribute('aria-hidden','true');viewsIcon.classList.add('iwtxz-views-icon');
      const outline=document.createElementNS('http://www.w3.org/2000/svg','path');outline.setAttribute('d','M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z');
      const pupil=document.createElementNS('http://www.w3.org/2000/svg','circle');pupil.setAttribute('cx','12');pupil.setAttribute('cy','12');pupil.setAttribute('r','3');
      viewsIcon.append(outline,pupil);
      viewsValue=document.createElement('span');viewsValue.className='iwtxz-views-value';
      viewsNode.append(viewsLabel,viewsIcon,viewsValue);
      // Fixed viewport position must not inherit profile zoom, tilt or text animations.
      document.body.append(viewsNode);
    }
    viewsNode.hidden = site.showProfileViews !== true || (!preview && viewsOwner === site.owner && viewsUnavailable);
    viewsNode.dataset.viewsStyle=site.profileViewsStyle==='eye'?'eye':'text';
    const size=Number(site.profileViewsSize);
    viewsNode.style.setProperty('--views-size',(Number.isFinite(size)?Math.min(24,Math.max(10,size)):12)+'px');
    viewsNode.style.setProperty('--views-color',/^#[0-9a-f]{6}$/i.test(site.profileViewsColor||'')?site.profileViewsColor:'#b6b4bd');
    const notify=()=>{if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('iwtxz-profile-views-ready'));};
    const draw=()=>{
      viewsValue.textContent=viewsError?'—':String(viewsCount);
      viewsNode.setAttribute('aria-label',viewsError?'Просмотры недоступны':'Просмотры: '+viewsCount);
      viewsNode.title=viewsError?'Просмотры недоступны':'';
      notify();
    };
    if (viewsNode.hidden) { notify(); return; }
    if (preview) { viewsCount='—';viewsError=false;draw();return; }
    const owner = site.owner;
    if (owner === viewsOwner) { draw();return; }
    viewsOwner = owner;viewsCount='…';viewsError=false;viewsUnavailable=false;draw();
    Promise.resolve().then(() => {
      const key = 'iwtxz-profile-visitor:'+owner;
      let visitor=viewVisitors.get(owner);
      try { visitor ||= window.localStorage.getItem(key); } catch {}
      if (!visitor || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitor)) {
        visitor=window.crypto.randomUUID();
        try { window.localStorage.setItem(key,visitor); } catch {}
      }
      viewVisitors.set(owner,visitor);
      if (!window.IwtxzBackend?.isConfigured()) throw new Error("Сервер просмотров не подключён.");
      return window.IwtxzBackend.recordProfileView(owner, visitor);
    }).then(count => {
      if (viewsOwner !== owner) return;
      if (count === null) { viewsUnavailable=true;viewsNode.hidden=true;notify();return; }
      viewsCount=count.toLocaleString('ru-RU');viewsError=false;draw();
    }).catch(error => {
      if (viewsOwner !== owner) return;
      console.warn("Не удалось загрузить просмотры профиля:", error);
      viewsError=true;draw();
    });
  }

  window.IwtxzProfileFeatures = Object.freeze({ animations, descriptionAnimations, socials, decorations, applyNameAnimation, applyGradientFlow, applyDescriptionAnimation, applyDescriptionGradient, applyDescriptionStyle, applyAvatarDecoration, decorationUrl, renderSocials, socialUrl, showProfileViews });
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
