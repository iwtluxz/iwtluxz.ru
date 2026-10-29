(() => {
  "use strict";
  const internalNames = new Set([
    "index", "profile", "404", "admin", "api", "assets", "vendor", "img", "font", "sound", "data", "scripts", "netlify", "supabase", "dist", "node_modules",
    "backend-client", "backend-config", "builder", "profile-settings", "profile-links", "profile-fallback", "package", "package-lock", "readme-builder", "cname", "deno"
  ]);
  const deviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  function normalize(value) {
    if (typeof value !== "string") return null;
    const username = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(username) ? username : null;
  }
  function urlForUser(value) {
    const username = normalize(value);
    if (!username) throw new Error("Неверный логин профиля.");
    return internalNames.has(username) || deviceName.test(username)
      ? `/profile.html?u=${encodeURIComponent(username)}`
      : `/${encodeURIComponent(username)}`;
  }
  function usernameFromPath(value) {
    if (typeof value !== "string") return null;
    let path;
    try { path = decodeURIComponent(value); } catch { return null; }
    const match = path.match(/^\/(?:u\/)?([a-z0-9][a-z0-9_-]{2,31})(?:\.html)?\/?$/i);
    const username = normalize(match?.[1]);
    return username && !internalNames.has(username) && !deviceName.test(username) ? username : null;
  }
  window.IwtxzProfileLinks = Object.freeze({ normalize, urlForUser, usernameFromPath });
})();
