(() => {
  "use strict";
  const root = document.getElementById("loginGallery");
  if (!root) return;
  const rows = root.querySelector("[data-gallery-rows]");
  const button = root.querySelector("[data-gallery-motion]");

  const safeImage = (value) => {
    if (typeof value !== "string" || !value) return "";
    if (/^https:\/\//i.test(value)) return value;
    return /^(?![a-z][a-z0-9+.-]*:|\/\/)[\w./%-]+$/i.test(value) ? value : "";
  };
  const safeColor = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback);
  const isVideo = (url) => /\.(?:mp4|webm)(?:[?#]|$)/i.test(url);

  function card(profile) {
    const link = document.createElement("a");
    link.className = "gallery-card";
    link.href = profile.publicUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const accent = safeColor(profile.accent, "#f5f5f7");
    link.style.setProperty("--card-accent", accent);
    const background = safeImage(profile.background);
    const cover = document.createElement("span");
    cover.className = "gallery-cover";
    if (background && !isVideo(background)) cover.style.backgroundImage = `url("${background.replace(/["\\]/g, "")}")`;
    const avatar = document.createElement("img");
    avatar.className = "gallery-avatar";
    avatar.alt = "";
    avatar.decoding = "async";
    avatar.src = safeImage(profile.avatar) || "img/tree.png";
    avatar.addEventListener("error", () => { avatar.src = "img/tree.png"; }, { once: true });
    const name = document.createElement("strong");
    name.className = "gallery-name";
    name.textContent = (profile.nickname || profile.username).slice(0, 40);
    if (profile.gradient === "true") {
      name.classList.add("gradient");
      name.style.setProperty("--g1", safeColor(profile.gradientStart, "#ffffff"));
      name.style.setProperty("--g2", safeColor(profile.gradientEnd, accent));
    }
    const handle = document.createElement("span");
    handle.className = "gallery-handle";
    handle.textContent = `@${profile.username}`;
    const about = document.createElement("span");
    about.className = "gallery-about";
    about.textContent = (profile.description || "").slice(0, 80);
    link.append(cover, avatar, name, handle, about);
    return link;
  }

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  async function load() {
    if (!window.IwtxzBackend?.isConfigured?.()) return;
    const profiles = shuffle(await window.IwtxzBackend.listPublishedProfiles(60));
    if (!profiles.length) return;
    const rowCount = profiles.length >= 6 ? 2 : 1;
    for (let r = 0; r < rowCount; r += 1) {
      const cards = profiles.filter((_, index) => index % rowCount === r).map(card);
      // Marquee needs the set repeated until it is wider than the screen.
      const copies = Math.max(2, Math.ceil(8 / cards.length) * 2);
      const track = document.createElement("div");
      track.className = "gallery-track";
      if (r % 2) track.classList.add("reverse");
      for (let i = 0; i < copies; i += 1) {
        const group = document.createElement("div");
        group.className = "gallery-group";
        if (i > 0) group.setAttribute("aria-hidden", "true");
        (i === 0 ? cards : cards.map(item => item.cloneNode(true))).forEach(item => {
          if (i > 0) item.tabIndex = -1;
          group.append(item);
        });
        track.append(group);
      }
      track.style.setProperty("--gallery-seconds", `${Math.max(30, cards.length * 6)}s`);
      track.style.setProperty("--gallery-copies", String(copies));
      rows.append(track);
    }
    root.hidden = false;
  }

  // Explicit choice wins; otherwise follow the system "reduce motion" setting.
  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const stored = () => { try { return localStorage.getItem("iwtxz-gallery-motion"); } catch { return null; } };
  function applyMotion(on) {
    root.dataset.motion = on ? "on" : "off";
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Анимации: вкл" : "Анимации: выкл";
  }
  applyMotion(stored() ? stored() === "on" : !motionQuery?.matches);
  button?.addEventListener("click", () => {
    const next = root.dataset.motion !== "on";
    try { localStorage.setItem("iwtxz-gallery-motion", next ? "on" : "off"); } catch { /* storage blocked */ }
    applyMotion(next);
  });

  const start = () => load().catch(error => console.warn("Галерея страниц недоступна:", error));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
