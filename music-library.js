(() => {
  "use strict";
  function create({ onSelect }) {
    const root = document.querySelector("#musicLibrary");
    if (!root) return null;
    const list = root.querySelector("[data-library-list]");
    const message = root.querySelector("[data-library-status]");
    const input = root.querySelector("[data-library-url]");
    const submit = root.querySelector("[data-library-import]");
    let version = 0, active = false, timer, controller, selected = "", importing = false;
    const configured = () => Boolean(window.IWTXZ_BACKEND_CONFIG?.musicApiUrl);
    const status = (text, failed = false) => { message.textContent = text; message.classList.toggle("error", failed); };
    const request = (path, body) => window.IwtxzBackend.request(`/api/builder/music/${path}`, { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: controller?.signal });
    function activate() {
      if (!configured()) throw new Error("Библиотека пока недоступна. Можно загрузить свой аудиофайл.");
      if (!active) { active = true; controller = new AbortController(); ++version; }
    }
    function render(data) {
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
      if (!importing) {
        if (running) status(running.state === "queued" ? "Трек в очереди…" : "Скачиваем аудио на сервер…");
        else if (!data.tracks?.length) status("Сохрани первый трек по ссылке или загрузи файл ниже.");
        else status(`${data.tracks.length} / 30 · Выбери трек для своей страницы`);
      }
      submit.disabled = importing || Boolean(running);
      clearTimeout(timer);
      if (running && !importing) timer = setTimeout(() => { if(active)void refresh(); }, 2500);
    }
    async function refresh() {
      if (!active) return;
      const current = version;
      try { const data=await request("library"); if (current===version&&active) render(data); }
      catch(error) { if (current===version&&active) { status(error.message,true); submit.disabled=false; } }
    }
    function pause(signal) {
      return new Promise((resolve,reject) => {
        const abort=()=>{clearTimeout(id);reject(new DOMException("Загрузка отменена", "AbortError"));};
        const id=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},2500);
        signal.addEventListener("abort",abort,{once:true});
        if(signal.aborted)abort();
      });
    }
    async function importTrack(track, {onProgress} = {}) {
      activate();
      if (importing) throw new Error("Дождись загрузки предыдущего трека.");
      const source = typeof track === "string" ? track : track?.url;
      if (!source) throw new Error("Укажи ссылку на трек.");
      importing=true;submit.disabled=true;clearTimeout(timer);
      const current=version, signal=controller.signal;
      const report=text=>{status(text);onProgress?.(text);};
      report("Добавляем трек…");
      try {
        const result=await request("import",{url:source});
        const deadline=Date.now()+270000;
        while(current===version && !signal.aborted) {
          const data=await request("library");
          if(current!==version || signal.aborted)break;
          render(data);
          const downloaded=data.tracks?.find(item=>result.trackId ? item.id===result.trackId : item.source===source);
          if(downloaded) { selected=downloaded.url;render(data);report("Аудиофайл скачан и готов. Примени изменения к странице.");return downloaded; }
          const job=data.jobs?.find(item=>item.id===result.jobId);
          if(job?.state==="error")throw new Error(job.error||"Не удалось скачать трек.");
          if(Date.now()>=deadline)throw new Error("Загрузка ещё не завершена. Открой «Мою библиотеку» чуть позже.");
          report(job?.state==="queued" ? "Трек в очереди…" : "Скачиваем аудио на сервер…");
          await pause(signal);
        }
        throw new DOMException("Загрузка отменена", "AbortError");
      } catch(error) {
        if(current===version && error.name!=="AbortError")status(error.message,true);
        throw error;
      } finally {
        if(current===version) { importing=false;submit.disabled=false; }
      }
    }
    submit.addEventListener("click", async () => {
      const url=input.value.trim(); if (!url) { input.focus(); return; }
      try { const track=await importTrack(url);input.value="";onSelect(track); }
      catch(error) { if(error.name!=="AbortError")status(error.message,true); }
    });
    input.addEventListener("keydown",event=>{ if(event.key==="Enter") { event.preventDefault(); if(!submit.disabled)submit.click(); } });
    return {
      importTrack,
      open(url) {
        selected=url||"";
        try {activate();void refresh();}
        catch(error) {status(error.message);input.disabled=true;submit.disabled=true;}
      },
      reset() { active=false; ++version; controller?.abort(); clearTimeout(timer); list.replaceChildren();importing=false;submit.disabled=false;status(""); },
      async remember(url,title) {
        if(!configured())return;
        activate();const current=version;
        try { await request("remember",{url,title}); if(current===version)void refresh(); }
        catch(error) { if(current===version)status(`Файл загружен. ${error.message}`,true); }
      }
    };
  }
  window.IwtxzMusicLibrary=Object.freeze({create});
})();
