(() => {
  "use strict";
  const username = window.IwtxzProfileLinks?.usernameFromPath(location.pathname);
  if (!username) return;
  document.title = `${username} | iwtxz`;
  const frame = document.createElement("iframe");
  frame.title = `Страница ${username}`;
  frame.allow = "autoplay; clipboard-write";
  const url = new URL("/profile.html", location.origin);
  url.searchParams.set("u", username);
  if (new URLSearchParams(location.search).get("demo") === "1") url.searchParams.set("demo", "1");
  frame.src = url.href;
  frame.addEventListener("load", () => { document.getElementById("notFound").hidden = true; }, { once: true });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== "iwtxz-public-profile-ready") return;
    if (typeof event.data.title === "string") document.title = event.data.title.slice(0, 130);
  });
  document.body.append(frame);
})();
