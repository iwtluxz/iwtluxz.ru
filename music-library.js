(() => {
  "use strict";
  function create({ onSelect }) {
    const root = document.querySelector("#musicLibrary");
    if (!root) return null;
    const list = root.querySelector("[data-library-list]");
    const message = root.querySelector("[data-library-status]");
    const input = root.querySelector("[data-library-url]");
    const submit = root.querySelector("[data-library-import]");
    let version = 0, active = false, timer, controller, selected = "", pendingSource = "";
    const configured = () => Boolean(window.IWTXZ_BACKEND_CONFIG?.musicApiUrl);
    const status = (text, failed = false) => { message.textContent = text; message.classList.toggle("error", failed); };
    const request = (path, body) => window.IwtxzBackend.request(`/api/builder/music/${path}`, { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: controller?.signal });
    function render(data) {
      const downloaded = data.tracks?.find(track => pendingSource && track.source === pendingSource);
      if (downloaded) { pendingSource=""; selected=downloaded.url; onSelect(downloaded); }
      list.replaceChildren();
      for (const track of Array.isArray(data.tracks) ? data.tracks : []) {
        const row = document.createElement("li");
        const button = document.createElement("button"); button.type = "button"; button.className = "library-track";
        button.classList.toggle("selected", track.url === selected);
        const title = document.createElement("strong"); title.textContent = track.title;
        const hint = document.createElement("small");
        const duration = Number(track.duration); hint.textContent = duration > 0 ? `${Math.floor(duration/60)}:${String(Math.floor(duration%60)).padStart(2,"0")} · Выбрать` : "Выбрать трек";
        button.append(title,hint); button.addEventListener("click", () => { selected = track.url; onSelect(track); render(data); });
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "library-remove"; remove.textContent = "×"; remove.setAttribute("aria-label", `Убрать ${track.title} из списка`);
        remove.addEventListener("click", async () => {
          const current = version; remove.disabled = true;
          try { await request("remove",{id:track.id}); if(current===version)void refresh(); }
          catch(error) { if(current===version) { status(error.message,true); remove.disabled=false; } }
        });
        row.append(button,remove); list.append(row);
      }
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const running = jobs.find(job => ["queued","downloading"].includes(job.state));
      if (downloaded) status("Трек добавлен и выбран. Примени изменения к странице.");
      else if (running) status(running.state === "queued" ? "Трек в очереди…" : "Скачиваем аудио на сервер…");
      else if (pendingSource && jobs[0]?.state === "error") { pendingSource=""; status(jobs[0].error,true); }
      else if (!data.tracks?.length) status("Сохрани первый трек по ссылке или загрузи файл ниже.");
      else if (!pendingSource) status(`${data.tracks.length} / 30 · Выбери трек для своей страницы`);
      submit.disabled = Boolean(running);
      clearTimeout(timer);
      if (running) timer = setTimeout(() => { if(active)void refresh(); }, 2500);
    }
    async function refresh() {
      if (!active) return;
      const current = version;
      try { const data=await request("library"); if (current===version&&active) render(data); }
      catch(error) { if (current===version&&active) { status(error.message,true); submit.disabled=false; } }
    }
    submit.addEventListener("click", async () => {
      const url=input.value.trim(); if (!url) { input.focus(); return; }
      const current=version; submit.disabled=true; pendingSource=url; status("Добавляем трек…");
      try { await request("import",{url}); if(current!==version)return; input.value=""; await refresh(); }
      catch(error) { if(current===version) { pendingSource=""; status(error.message,true); submit.disabled=false; } }
    });
    input.addEventListener("keydown",event=>{ if(event.key==="Enter") { event.preventDefault(); if(!submit.disabled)submit.click(); } });
    return {
      open(url) {
        selected=url||"";
        if (!configured()) { status("Библиотека подключается. Пока можно загрузить свой аудиофайл ниже."); input.disabled=true; submit.disabled=true; return; }
        if(!active) { active=true; controller=new AbortController(); ++version; }
        void refresh();
      },
      reset() { active=false; ++version; controller?.abort(); clearTimeout(timer); list.replaceChildren(); pendingSource=""; status(""); },
      async remember(url,title) {
        if(!configured())return;
        if(!active) { active=true; controller=new AbortController(); ++version; }
        const current=version;
        try { await request("remember",{url,title}); if(current===version)void refresh(); }
        catch(error) { if(current===version)status(`Файл загружен. ${error.message}`,true); }
      }
    };
  }
  window.IwtxzMusicLibrary=Object.freeze({create});
})();
