(() => {
  "use strict";

  const minecraft = '"Minecraft", "Trebuchet MS", "Segoe UI", sans-serif';
  const system = '"Trebuchet MS", "Segoe UI", sans-serif';
  const badgeIds = new Set(["staff", "partner", "hypesquad-events", "bug-hunter-level-1", "house-bravery", "house-brilliance", "house-balance", "early-supporter", "bug-hunter-level-2", "verified-bot", "early-verified-developer", "moderator-alumni", "server-booster"]);
  const decorations = {
    star: ["Звезда", "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"],
    heart: ["Сердце", "M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"],
    moon: ["Луна", "M20.8 13.2A9 9 0 0 1 10.8 3a9 9 0 1 0 10 10.2Z"],
    sparkle: ["Искра", "m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z"],
    code: ["Код", "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"],
    music: ["Музыка", "M9 18V5l12-2v13M9 7l12-2M9 18c0 2-2 3-4 3s-3-1-3-2 2-3 4-3 3 1 3 2Zm12-2c0 2-2 3-4 3s-3-1-3-2 2-3 4-3 3 1 3 2Z"],
    flower: ["Цветок", "M12 8c-6-12-12 0-4 3-13 3-5 13 1 5-1 13 11 9 7 1 12 5 13-8 4-8 9-9-3-13-8-1Zm0 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"]
  };
  const snapshotCache = new Map();
  const discordGuildId = window.IWTXZ_BACKEND_CONFIG?.discordGuildId || "1557152366208229486";

  function clamp(value, min, max, fallback) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.min(max, Math.max(min, amount)) : fallback;
  }
  function color(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback; }
  function text(value, limit = 160) { return typeof value === "string" ? value.slice(0, limit) : ""; }
  function asset(value, font = false) {
    if (typeof value !== "string" || value.length > 2048 || !value.trim()) return "";
    try {
      const url = new URL(value, document.baseURI);
      if (url.username || url.password) return "";
      if (url.protocol === "https:") return url.href;
      if (url.origin === location.origin && url.protocol === "http:" && (font
        ? /^\/(?:font\/|api\/builder\/assets\/file\/)/.test(url.pathname)
        : /^\/(?:img\/|api\/builder\/assets\/file\/)/.test(url.pathname))) return url.href;
    } catch {}
    return "";
  }
  function discordAvatar(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "cdn.discordapp.com" && !url.username && !url.password && /^\/(?:avatars|guilds|embed\/avatars)\//.test(url.pathname) ? url.href : "";
    } catch { return ""; }
  }
  function icon(path) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(svg.namespaceURI, "path");
    shape.setAttribute("d", path);
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke", "currentColor");
    shape.setAttribute("stroke-width", "1.7");
    shape.setAttribute("stroke-linecap", "round");
    shape.setAttribute("stroke-linejoin", "round");
    svg.append(shape);
    return svg;
  }
  function badge(label, graphic, type) {
    const element = document.createElement("span");
    element.className = `iwtxz-badge iwtxz-badge-${type}`;
    element.title = label;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", label);
    element.append(graphic);
    return element;
  }
  function butterfly() {
    const image = document.createElement("img");
    image.src = "/img/butterfly.png";
    image.alt = "";
    return badge("Бабочка · украшение", image, "decoration");
  }
  function earnedBadge(item) {
    const label = text(item.label, 100) || item.id;
    let imagePath = "";
    if (item.id === "server-booster") imagePath = "/img/server_booster.png";
    if (imagePath) {
      const image = document.createElement("img");
      image.src = imagePath;
      image.alt = "";
      return badge(`${label} · Discord`, image, "discord");
    }
    const symbols = {
      "house-bravery": ["#9d78e5", "m5 19 3-3m-2-3 5 5M8 16 19 5l-4 1L6 15m9-9 3 3"],
      "house-brilliance": ["#ef9b59", "m12 2 9 10-9 10L3 12Zm0 0-4 10 4 10 4-10Zm-9 10h18"],
      "house-balance": ["#71d6b5", "M12 3v18m-6 0h12M4 7h16M6 7l-4 8h8Zm12 0-4 8h8Z"],
      "hypesquad-events": ["#e9bd6c", "m12 2 9 5v10l-9 5-9-5V7Zm0 4 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z"],
      staff: ["#62a8ea", "M12 3 5 7v10l7 4 7-4V7ZM8 8h8m-8 4h8m-8 4h5"],
      partner: ["#a78bfa", "m8 6 4 4 4-4 5 6-9 9-9-9Zm0 0-5 6 5 2 4-4 4 4 5-2"],
      "early-supporter": ["#ed8baa", "M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z"],
      "bug-hunter-level-1": ["#7acb82", "M8 7h8v10a4 4 0 0 1-8 0ZM9 3l3 4 3-4M4 9l4 2m8 0 4-2M3 15h5m8 0h5M4 21l4-3m8 0 4 3M12 7v13"],
      "bug-hunter-level-2": ["#e9b44c", "M8 7h8v10a4 4 0 0 1-8 0ZM9 3l3 4 3-4M4 9l4 2m8 0 4-2M3 15h5m8 0h5M4 21l4-3m8 0 4 3M12 7v13"],
      "verified-bot": ["#72b7f5", "M5 5h14v14H5ZM9 10l2 2 4-4M9 2v3m6-3v3M9 19v3m6-3v3"],
      "early-verified-developer": ["#b7a3ff", "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"],
      "moderator-alumni": ["#74a8da", "M12 2 4 5v6c0 5 8 11 8 11s8-6 8-11V5ZM8 12l3 3 5-6"]
    };
    const symbol = symbols[item.id] || ["#c2c0ff", "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"];
    const element = badge(`${label} · Discord`, icon(symbol[1]), "discord");
    element.style.color = symbol[0];
    return element;
  }
  async function snapshot(userId) {
    const cached = snapshotCache.get(userId);
    if (cached && Date.now() - cached.at < 55_000) return cached.promise;
    const promise = fetch(`/data/discord-profiles/${userId}.json`, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8000) })
      .then(async response => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Discord snapshot unavailable");
        const data = await response.json();
        if (data?.id !== userId) throw new Error("Unexpected Discord user");
        return data;
      });
    snapshotCache.set(userId, { at: Date.now(), promise });
    return promise;
  }

  function createCustomizer(nodes = {}) {
    let settings = {};
    let lastSnapshot = null;
    let requestedUser = "";
    let fetchSerial = 0;
    let fontSerial = 0;
    let fontKey = "";
    let loadedFont = null;
    let loadedFontFamily = "";
    let pollTimer = 0;
    let disposed = false;

    function notify(state, updatedAt) {
      if (window.parent !== window) window.parent.postMessage({ type: "iwtxz-discord-status", userId: requestedUser, state, updatedAt }, location.origin);
    }
    function notifyFont(state, source) {
      if (window.parent !== window) window.parent.postMessage({ type: "iwtxz-font-status", state, source: typeof source === "string" ? source : "" }, location.origin);
    }
    function font(site) {
      const source = site.font === "custom" ? asset(site.customFont, true) : "";
      const key = `${site.font || "minecraft"}:${source}`;
      if (key === fontKey) {
        const family = loadedFontFamily || (site.font === "system" ? system : minecraft);
        document.documentElement.style.setProperty("--profile-font", family);
        document.body.style.fontFamily = family;
        return;
      }
      fontKey = key;
      const serial = ++fontSerial;
      if (loadedFont) document.fonts?.delete(loadedFont);
      loadedFont = null;
      loadedFontFamily = "";
      const fallback = site.font === "system" ? system : minecraft;
      document.documentElement.style.setProperty("--profile-font", fallback);
      document.body.style.fontFamily = fallback;
      if (site.font !== "custom") { notifyFont("disabled", site.customFont); return; }
      if (!source || typeof FontFace !== "function") { notifyFont("unavailable", site.customFont); return; }
      notifyFont("loading", site.customFont);
      const family = `IwtxzCustom${serial}`;
      const face = new FontFace(family, `url(${JSON.stringify(source)})`, { display: "swap" });
      face.load().then(loaded => {
        if (disposed || serial !== fontSerial) return;
        document.fonts.add(loaded);
        loadedFont = loaded;
        loadedFontFamily = `"${family}", ${minecraft}`;
        document.documentElement.style.setProperty("--profile-font", loadedFontFamily);
        document.body.style.fontFamily = loadedFontFamily;
        notifyFont("ready", site.customFont);
        nodes.onFontReady?.();
      }).catch(() => {
        if (!disposed && serial === fontSerial && window.parent !== window) {
          notifyFont("unavailable", site.customFont);
        }
      });
    }
    function drawDiscord(data) {
      const valid = data?.member === true && data.guildId === discordGuildId && typeof data.updatedAt === "number" && Date.now() - data.updatedAt < 86_400_000 && data.updatedAt < Date.now() + 300_000;
      const profile = valid ? data : null;
      const copyName = text(profile?.username || settings.discord, 60);
      const displayName = text(profile?.displayName || copyName, 80);
      const enabled = Boolean(copyName || (settings.discordSync && requestedUser));
      if (nodes.discordName) nodes.discordName.textContent = displayName || "Discord";
      if (nodes.discordCard) {
        nodes.discordCard.hidden = settings.showDiscord === false || !enabled;
        nodes.discordCard.style.display = nodes.discordCard.hidden ? "none" : "";
        nodes.discordCard.setAttribute("aria-label", copyName ? `Скопировать Discord: ${copyName}` : "Discord");
        if (nodes.discordCard.hasAttribute("data-discord-copy")) nodes.discordCard.dataset.discordCopy = copyName;
      }
      if (nodes.socialDiscord) {
        nodes.socialDiscord.hidden = !copyName;
        nodes.socialDiscord.style.display = copyName ? "" : "none";
        if (nodes.socialDiscord.hasAttribute("data-discord-copy")) nodes.socialDiscord.dataset.discordCopy = copyName;
      }
      const avatar = settings.discordUseAvatar !== false && profile ? discordAvatar(profile.avatarUrl) || asset(settings.avatar) : asset(settings.avatar);
      if (nodes.discordAvatar) {
        if (avatar) nodes.discordAvatar.src = avatar;
        else nodes.discordAvatar.removeAttribute("src");
        nodes.discordAvatar.hidden = !avatar;
        const wrap = nodes.discordAvatar.closest(".discord-card-media, .discord-avatar-wrap");
        if (wrap) { wrap.hidden = !avatar; wrap.style.display = avatar ? "" : "none"; }
      }
      if (nodes.discordPresence) {
        nodes.discordPresence.hidden = !profile;
        nodes.discordPresence.dataset.presence = ["online", "idle", "dnd", "offline"].includes(profile?.status) ? profile.status : "offline";
        nodes.discordPresence.setAttribute("aria-label", { online: "В сети", idle: "Неактивен", dnd: "Не беспокоить", offline: "Не в сети" }[nodes.discordPresence.dataset.presence]);
      }
      const statusText = settings.discordShowStatus !== false && profile ? text(profile.statusText, 240) : "";
      if (nodes.discordStatus) { nodes.discordStatus.textContent = statusText; nodes.discordStatus.hidden = !statusText; nodes.discordStatus.style.display = statusText ? "" : "none"; }
      const activity = settings.discordShowActivity !== false && profile?.activity;
      const activityText = activity ? [text(activity.name, 80), text(activity.details, 100), text(activity.state, 100)].filter(Boolean).join(" · ") : "";
      if (nodes.discordActivity) { nodes.discordActivity.textContent = activityText; nodes.discordActivity.hidden = !activityText; }
      if (nodes.discordBadges) {
        const content = [];
        if (settings.showButterfly !== false) content.push(butterfly());
        if (profile && settings.discordShowBadges !== false && Array.isArray(profile.badges)) {
          const seen = new Set();
          for (const item of profile.badges.slice(0, 20)) {
            if (!item || !badgeIds.has(item.id) || seen.has(item.id)) continue;
            content.push(earnedBadge(item));
            seen.add(item.id);
          }
        }
        nodes.discordBadges.replaceChildren(...content);
        nodes.discordBadges.hidden = !content.length;
        nodes.discordBadges.style.display = content.length ? "inline-flex" : "none";
      }
      nodes.onDiscordUsername?.(copyName);
    }
    async function refreshDiscord(userId) {
      const serial = ++fetchSerial;
      try {
        const data = await snapshot(userId);
        if (disposed || serial !== fetchSerial || requestedUser !== userId) return;
        lastSnapshot = data;
        drawDiscord(data);
        const fresh = data && typeof data.updatedAt === "number" && Date.now() - data.updatedAt < 86_400_000 && data.updatedAt < Date.now() + 300_000;
        notify(data?.guildId === discordGuildId && data?.member === false ? "not-member" : data?.guildId === discordGuildId && data?.member === true && fresh ? "ready" : "waiting", data?.updatedAt);
      } catch {
        if (!disposed && serial === fetchSerial && requestedUser === userId) { lastSnapshot = null; drawDiscord(null); notify("unavailable"); }
      }
    }
    function apply(site) {
      if (disposed) return;
      settings = site;
      font(site);
      if (nodes.name) {
        const gradient = site.nicknameGradient === true;
        nodes.name.classList.toggle("iwtxz-gradient-name", gradient);
        nodes.name.style.setProperty("--nickname-gradient", `linear-gradient(${clamp(site.nicknameGradientAngle, 0, 360, 90)}deg, ${color(site.nicknameGradientStart, "#ffffff")}, ${color(site.nicknameGradientEnd, "#a1a1aa")})`);
      }
      if (nodes.avatar) {
        nodes.avatar.classList.add("iwtxz-round-avatar");
        nodes.avatar.style.borderRadius = "50%";
        if (nodes.avatar.tagName === "IMG") nodes.avatar.style.objectFit = "cover";
        else nodes.avatar.style.backgroundSize = "cover";
      }
      if (nodes.nicknameBadges) {
        const selected = Array.isArray(site.profileBadges) ? [...new Set(site.profileBadges)].filter(id => Object.hasOwn(decorations, id)).slice(0, 7) : [];
        nodes.nicknameBadges.replaceChildren(...selected.map(id => badge(`${decorations[id][0]} · украшение`, icon(decorations[id][1]), "decoration")));
        nodes.nicknameBadges.hidden = !selected.length;
      }
      if (nodes.discordCard) {
        const card = nodes.discordCard;
        card.classList.add("iwtxz-discord-card");
        card.dataset.cardStyle = ["solid", "minimal"].includes(site.discordCardStyle) ? site.discordCardStyle : "glass";
        card.style.setProperty("--discord-color", color(site.discordCardColor, "#111111"));
        card.style.setProperty("--discord-opacity", `${clamp(site.discordCardOpacity, 0, 100, 65)}%`);
        card.style.setProperty("--discord-radius", `${clamp(site.discordCardRadius, 0, 32, 18)}px`);
      }
      if (nodes.player) {
        const compact = site.musicPlayerStyle === "compact";
        nodes.player.classList.toggle("iwtxz-player-compact", compact);
        nodes.player.classList.toggle("iwtxz-player-classic", !compact);
      }
      const userId = site.discordSync === true && /^\d{17,20}$/.test(site.discordUserId || "") ? site.discordUserId : "";
      if (userId !== requestedUser) {
        requestedUser = userId;
        lastSnapshot = null;
        ++fetchSerial;
        clearInterval(pollTimer);
        pollTimer = 0;
        if (userId) {
          notify("waiting");
          void refreshDiscord(userId);
          pollTimer = setInterval(() => { if (!document.hidden) void refreshDiscord(requestedUser); }, 60_000);
        }
      }
      drawDiscord(lastSnapshot);
    }
    function dispose() {
      disposed = true;
      ++fetchSerial;
      ++fontSerial;
      clearInterval(pollTimer);
      if (loadedFont) document.fonts?.delete(loadedFont);
    }
    return Object.freeze({ apply, dispose });
  }
  window.IwtxzProfileCustomization = Object.freeze({ createCustomizer });
})();
