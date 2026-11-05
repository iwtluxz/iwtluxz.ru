(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  // A cached HTML page can request a newer script after a deployment.
  const uiVersion = "20261105-editor-v2";
  if (["effectIntensity", "backgroundEffect", "avatarFit", "ownMusicFiles", "discordDecorationHint", "profileScale", "nicknameSize", "discordShowCopyHint", "descriptionSize", "cursorSize", "typewriterText", "layoutEdit", "descriptionAnimation", "previewViewport", "previewStage"].some(id => !$("#"+id)) || document.querySelector('script[src*="halloween.js"]')) {
    const fresh = new URL(location.href);
    if (fresh.searchParams.get("_ui") !== uiVersion) { fresh.searchParams.set("_ui",uiVersion);location.replace(fresh.href); }
    else if ($("#authStatus")) $("#authStatus").textContent="Не удалось обновить интерфейс. Обнови страницу с очисткой кеша.";
    return;
  }
  const features = window.IwtxzProfileFeatures;
  const socialFields = features?.socials.map(item => item.id) || ["discord", "telegram", "steam"];
  const textFields = ["title", "nickname", "description", "entryText", "musicTitle", ...socialFields, "discordUserId", "typewriterText"];
  const numberFields = ["avatarSize", "backgroundDim", "nicknameGradientAngle", "discordCardOpacity", "discordCardRadius", "effectIntensity", "profileScale", "nicknameSize", "descriptionSize", "cursorSize", "cursorOpacity", "typewriterSpeed"];
  const optionFields = ["font", "accentColor", "backgroundType", "nicknameGradientStart", "nicknameGradientEnd", "musicPlayerStyle", "discordCardStyle", "discordCardColor", "nicknameAnimation", "avatarDecoration", "backgroundEffect", "cursorStyle", "avatarFit", "cursorColor", "cursorHotspot", "descriptionAnimation"];
  const boolFields = ["musicLoop", "showDiscord", "nicknameGradient", "discordSync", "discordUseAvatar", "discordShowStatus", "discordShowBadges", "discordShowActivity", "profileTilt", "discordShowCopyHint", "typewriterEnabled"];
  const assetFields = ["avatar", "background", "music", "musicCover", "customFont", "favicon", "customCursor"];
  const decorativeBadges = new Set(["star", "heart", "moon", "sparkle", "code", "music", "flower"]);
  const defaults = {
    ...Object.fromEntries(socialFields.map(key => [key, ""])),
    title: "", nickname: "", description: "", entryText: "click to enter...", discord: "", telegram: "", steam: "",
    avatar: "", background: "", backgroundType: "image",
    music: "", musicTitle: "", musicCover: "",
    avatarSize: 150, avatarShape: "circle", backgroundDim: 58, accentColor: "#f5f5f7", font: "minecraft", customFont: "", musicLoop: true, showDiscord: true,
    nicknameGradient: false, nicknameGradientStart: "#ffffff", nicknameGradientEnd: "#a1a1aa", nicknameGradientAngle: 90,
    musicPlayerStyle: "classic", showButterfly: false, profileBadges: [], discordUserId: "", discordSync: false,
    discordCardStyle: "glass", discordCardColor: "#111111", discordCardOpacity: 65, discordCardRadius: 18,
    discordUseAvatar: true, discordShowStatus: true, discordShowBadges: true, discordShowActivity: true,
    nicknameAnimation: "none", avatarDecoration: "none", avatarFit:"cover", backgroundEffect:"none",effectIntensity:50,profileTilt:false,cursorStyle:"default",customCursor:"",favicon:"",profileScale:100,nicknameSize:32,discordShowCopyHint:true,
    descriptionSize:16,cursorSize:24,cursorOpacity:100,cursorColor:'#ffffff',cursorHotspot:'center',typewriterEnabled:false,typewriterText:'',typewriterSpeed:70,seasonalTheme:'none',objectPositions:{},layoutVersion:1,descriptionAnimation:'none'
  };
  const fileHints = Object.fromEntries(all("[data-file-note]").map((e) => [e.dataset.fileNote, e.textContent]));
  const previewFrame = $("#previewFrame");
  try {
    const invite = new URL(window.IWTXZ_BACKEND_CONFIG?.discordInviteUrl);
    if (invite.protocol === "https:" && !invite.username && !invite.password &&
        ((invite.hostname === "discord.gg" && /^\/[a-z0-9-]+\/?$/i.test(invite.pathname)) ||
         (invite.hostname === "discord.com" && /^\/invite\/[a-z0-9-]+\/?$/i.test(invite.pathname)))) {
      $("#discordJoinLink").href = invite.href;
    }
  } catch {}
  let currentUser = null;
  let currentSite = { ...defaults };
  let savedServiceMusic='';
  function musicServiceLink(value){
    const track=window.IwtxzMusicServices?.source(value);if(track)return track.url;
    try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password&&(/^(?:www\.)?(?:soundcloud\.com|vimeo\.com)$/.test(url.hostname)||/^[a-z0-9-]+\.bandcamp\.com$/.test(url.hostname)))return url.href;}catch{}
    return '';
  }
  let previousEffects = null;
  const musicCatalog = window.IwtxzMusicCatalog?.create({ async onSelect(track, options) {
    if (!accountReady) throw new Error('Сначала войди в аккаунт.');
    const version=sessionVersion;
    const previousMusic=currentSite.music;
    const downloaded = await musicLibrary.importTrack(track,options);
    if (!accountReady || version!==sessionVersion) throw new DOMException('Аккаунт изменился.','AbortError');
    if(currentSite.music!==previousMusic)throw new Error('Трек скачан в библиотеку. Ты уже выбрал другую музыку; она осталась на странице.');
    currentSite.music = downloaded.url;
    currentSite.musicCover = track.cover || "";
    $("#musicUrl").value = downloaded.url;
    $("#musicTitle").value = track.metadataMissing?downloaded.title:`${track.artist} — ${track.title}`;
    const coverField = document.querySelector('[data-asset-url="musicCover"]');
    if (coverField) coverField.value = currentSite.musicCover;
    updatePreview(); toast("Трек скачан и выбран");
    return downloaded;
  } });
  const musicLibrary = window.IwtxzMusicLibrary?.create({ onSelect(track) {
    if (!accountReady) return;
    currentSite.music = track.url;
    $("#musicUrl").value = track.url;
    $("#musicTitle").value = track.title;
    updatePreview(); toast("Трек выбран");
  } });
  let savedSnapshot = "";
  let dirty = false;
  let authMode = "login";
  let authPending = false;
  let authAttemptVersion = 0;
  const bootstrapAuthController = new AbortController();
  let busy = false;
  let uploadCount = 0;
  let sessionVersion = 0;
  let accountReady = false;
  let accountLoadController = null;
  let previewTimer;
  let toastTimer;
  let discordSnapshotStatus = null;
  let layoutEditing = false;
  const positionKeys=['avatar','name','description','socials','discord','player'];
  let selectedLayoutBlock='',previewExpanded=false;
  const gridDefaults={visible:false,step:24,snap:true,centerLines:true,color:'#ffffff',opacity:15};
  let gridSettings={...gridDefaults};
  try{const stored=JSON.parse(window.localStorage?.getItem('iwtxz:layout-grid')||'{}');gridSettings={...gridSettings,...stored};}catch{}
  function sendGrid(){previewFrame.contentWindow?.postMessage({type:'iwtxz-layout-grid',grid:gridSettings},location.origin);}
  function updateGrid(){
    gridSettings={visible:$('#layoutGridVisible').checked,snap:$('#layoutGridSnap').checked,centerLines:$('#layoutCenterLines').checked,step:Math.min(80,Math.max(8,Number($('#layoutGridStep').value)||24)),color:/^#[a-f0-9]{6}$/i.test($('#layoutGridColor').value)?$('#layoutGridColor').value:'#ffffff',opacity:Math.min(60,Math.max(5,Number($('#layoutGridOpacity').value)||15))};
    try{window.localStorage?.setItem('iwtxz:layout-grid',JSON.stringify(gridSettings));}catch{}sendGrid();
  }
  function resizePreview(){
    const stage=$('#previewStage'),mode=$('#previewViewport').value||'1280x800';
    const [width,height]=mode==='window'?[window.innerWidth||1280,window.innerHeight||800]:mode.split('x').map(Number);
    const available=stage.clientWidth||420;
    const vertical=previewExpanded?Math.max(160,(window.innerHeight||800)-(($('.preview-panel')?.querySelector?.('.preview-stage')?.getBoundingClientRect?.().top)||180)-80):Infinity;
    const scale=Math.min(available/width,vertical/height,1);
    Object.assign(previewFrame.style,{width:`${width}px`,height:`${height}px`,transform:`scale(${scale})`,left:`${Math.max(0,(available-width*scale)/2)}px`});
    stage.style.height=`${Math.ceil(height*scale)}px`;$('#previewResolution').textContent=`${width} × ${height}`;
  }
  function expandPreview(enabled){
    previewExpanded=Boolean(enabled);$('.preview-panel')?.classList.toggle('is-expanded',previewExpanded);document.body.classList.toggle('preview-expanded',previewExpanded);
    $('#previewExpand').setAttribute('aria-pressed',String(previewExpanded));$('#previewExpand').textContent=previewExpanded?'Свернуть ↙':'Развернуть ↗';resizePreview();
  }
  function normalizePositions(value) {
    if(!value || typeof value!=='object' || Array.isArray(value))return {};
    return Object.fromEntries(positionKeys.filter(key=>value[key]&&['x','y'].every(axis=>typeof value[key][axis]==='number'&&Number.isFinite(value[key][axis])&&Math.abs(value[key][axis])<=40)).map(key=>[key,{x:Math.round(value[key].x*100)/100,y:Math.round(value[key].y*100)/100}]));
  }
  function setLayoutEditing(enabled) {
    layoutEditing=Boolean(enabled&&accountReady&&!busy);
    $('#layoutEdit').setAttribute('aria-pressed',String(layoutEditing));
    $('#layoutEdit').textContent=layoutEditing?'Завершить перемещение':'Переместить блоки';
    $('#layoutHint').textContent=layoutEditing?'Перетаскивай блоки мышью или пальцем. Стрелки — точный шаг, Esc — завершить.':'Расположение блоков можно менять прямо в превью.';
    previewFrame.contentWindow?.postMessage({type:'iwtxz-layout-edit',enabled:layoutEditing},location.origin);
    sendGrid();
  }
  let previewVisible = true;
  function sendPreviewVisibility() {
    previewFrame.contentWindow?.postMessage({type:"iwtxz-preview-visibility",visible:previewVisible&&!document.hidden},location.origin);
  }
  if (typeof IntersectionObserver === "function") {
    const observer=new IntersectionObserver(entries=>{previewVisible=entries[0]?.isIntersecting!==false;sendPreviewVisibility();},{rootMargin:"80px"});
    observer.observe(previewFrame);
    document.addEventListener("visibilitychange",sendPreviewVisibility);
  }
  let decorationAvatarSource = "", decorationAvatarThumbnail = "", decorationAvatarVersion = 0, discordDecoration = null;
  function updateDecorationAvatars() {
    const images=all('[data-decoration-avatar]');if(!images.length)return;
    const source=currentSite.avatar||'img/tree.png';
    const show=value=>all('[data-decoration-avatar]').forEach(image=>{if(image.getAttribute('src')!==value)image.src=value;});
    if(source===decorationAvatarSource){show(decorationAvatarThumbnail||source);return;}
    decorationAvatarSource=source;decorationAvatarThumbnail='';const version=++decorationAvatarVersion;
    show(source);
    const picture=new Image();picture.crossOrigin='anonymous';
    picture.onload=()=>{if(version!==decorationAvatarVersion)return;try{const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const context=canvas.getContext('2d');const ratio=Math.max(96/picture.naturalWidth,96/picture.naturalHeight);context.drawImage(picture,(96-picture.naturalWidth*ratio)/2,(96-picture.naturalHeight*ratio)/2,picture.naturalWidth*ratio,picture.naturalHeight*ratio);decorationAvatarThumbnail=canvas.toDataURL('image/png');show(decorationAvatarThumbnail);}catch{}};
    picture.src=source;
  }
  function updateDiscordDecoration() {
    const tile=document.querySelector('[data-decoration="discord"]');if(!tile)return;
    let image=tile.querySelector('.decoration-art');const url=currentSite.discordSync?features?.decorationUrl('discord',discordDecoration):'';
    if(!image&&url){image=document.createElement('img');image.className='decoration-art';image.alt='';tile.querySelector('.decoration-preview').append(image);}
    if(image){image.hidden=!url;if(url&&image.getAttribute('src')!==url)image.src=url;}
    const mode=tile.querySelector('.decoration-mode');if(mode)mode.hidden=Boolean(url);
    $('#discordDecorationHint').textContent=!currentSite.discordSync?'Для «Из Discord» включи синхронизацию и укажи свой ID в соцсетях.':url?'Текущее украшение твоего аватара в Discord.':discordSnapshotStatus?.state==='ready'?'В Discord сейчас нет украшения аватара.':'Ждём данные Discord. Проверь ID и участие в сервере.';
  }

  function status(selector, message, type = "") {
    const element = $(selector);
    element.textContent = message;
    element.classList.toggle("error", type === "error");
    element.classList.toggle("ok", type === "ok");
  }

  const decorationPicker=window.IwtxzAvatarDecorations?.createPicker({root:$('#decorationPicker'),input:$('#avatarDecoration'),getAvatarSource:()=>currentSite.avatar||'img/tree.png',onSelect:()=>{updatePreview();clearTimeout(previewTimer);sendPreview();},onRender:()=>{updateDecorationAvatars();updateDiscordDecoration();}});

  for(const [id,key] of [['layoutGridVisible','visible'],['layoutGridSnap','snap'],['layoutCenterLines','centerLines']])$('#'+id).checked=gridSettings[key]===true;
  for(const [id,key] of [['layoutGridStep','step'],['layoutGridColor','color'],['layoutGridOpacity','opacity']])$('#'+id).value=gridSettings[key];
  ['layoutGridVisible','layoutGridSnap','layoutCenterLines','layoutGridStep','layoutGridColor','layoutGridOpacity'].forEach(id=>$('#'+id).addEventListener('input',updateGrid));
  $('#previewViewport').addEventListener('change',resizePreview);
  $('.layout-grid-settings')?.addEventListener('toggle',resizePreview);
  $('#previewExpand').addEventListener('click',()=>expandPreview(!previewExpanded));
  for(const [id,axis] of [['layoutAlignHorizontal','horizontal'],['layoutAlignVertical','vertical'],['layoutAlignBoth','both']]){
    $('#'+id).disabled=true;$('#'+id).addEventListener('click',()=>{if(layoutEditing&&selectedLayoutBlock)previewFrame.contentWindow?.postMessage({type:'iwtxz-layout-align',axis},location.origin);});
  }
  if(typeof ResizeObserver==='function')new ResizeObserver(resizePreview).observe($('#previewStage'));
  window.addEventListener('resize',resizePreview);
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&previewExpanded)expandPreview(false);});
  resizePreview();

  function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
  }

  function friendlyError(error) {
    if (error.name === "AbortError") return "Сервер не ответил вовремя. Попробуй ещё раз.";
    if (error instanceof TypeError) return "Не удалось связаться с сервером. Проверь соединение.";
    return error.message || "Не получилось выполнить действие. Попробуй ещё раз.";
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    const cancelled = () => Object.assign(new Error("Запрос отменён."), { code: "request_cancelled" });
    let timeout;
    let abort;
    const interruption = new Promise((_, reject) => {
      abort = () => reject(cancelled());
      controller.signal.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(() => {
        reject(Object.assign(new Error("Сервер не ответил вовремя. Попробуй ещё раз."), { code: "request_timeout" }));
        controller.abort();
      }, options.upload ? 65000 : 22000);
    });
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw cancelled();
          return performApiRequest(path, { ...options, signal: controller.signal });
        }), interruption
      ]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", abort);
      options.signal?.removeEventListener("abort", cancel);
    }
  }

  async function performApiRequest(path, options) {
    if (location.protocol === "file:") throw new Error("Для входа открой кабинет через локальный сервер, а не как файл. Инструкция — в README-BUILDER.md.");
    if (window.IwtxzBackend?.isConfigured()) {
      try { return await window.IwtxzBackend.request(path, options); }
      catch (error) {
        if (options.signal.aborted) throw error;
        if (error.status === 401 && error.code === "unauthorized" && currentUser) {
          resetSession();
          status("#authStatus", "Время входа истекло. Войди ещё раз.", "error");
        }
        throw error;
      }
    }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
      const error = new Error("Сервер кабинета ещё не подключён. Владелец сайта должен указать настройки Supabase в backend-config.js.");
      error.code = "backend_not_configured";
      throw error;
    }
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (options.signal.aborted) throw Object.assign(new Error("Запрос отменён."), { code: "request_cancelled" });
    if (!data) throw new Error("Сервис кабинета недоступен. Убедись, что сайт открыт через сервер с поддержкой входа.");
    if (!response.ok) {
      const error = new Error(data.error || "Не получилось выполнить действие.");
      error.status = response.status;
      error.code = data.code;
      if (response.status === 401 && data.code === "unauthorized" && currentUser) {
        resetSession();
        status("#authStatus", "Время входа истекло. Войди ещё раз.", "error");
      }
      throw error;
    }
    return data;
  }

  function readEditor() {
    const site = { ...currentSite };
    site.seasonalTheme='none';
    site.layoutVersion=site.layoutVersion===2?2:1;
    site.objectPositions=normalizePositions(site.objectPositions);
    textFields.forEach((key) => { site[key] = $("#" + key).value.trim(); });
    numberFields.forEach((key) => { site[key] = Number($("#" + key).value); });
    optionFields.forEach((key) => { site[key] = $("#" + key).value; });
    boolFields.forEach((key) => { site[key] = $("#" + key).checked; });
    site.profileBadges = all("[data-profile-badge]:checked").map((input) => input.dataset.profileBadge).filter((badge) => decorativeBadges.has(badge));
    return site;
  }

  function snapshot(site) {
    return JSON.stringify(Object.fromEntries([...textFields, ...numberFields, ...optionFields, ...boolFields, ...assetFields, "profileBadges", "objectPositions", "layoutVersion"].map((key) => [key, key==='objectPositions'?normalizePositions(site[key]):site[key]])));
  }

  function writeEditor(site) {
    currentSite = { ...defaults, ...site };
    savedServiceMusic=musicServiceLink(site.music);
    textFields.concat(numberFields, optionFields).forEach((key) => { $("#" + key).value = currentSite[key] ?? ""; });
    boolFields.forEach((key) => { $("#" + key).checked = Boolean(currentSite[key]); });
    const badges = new Set(Array.isArray(currentSite.profileBadges) ? currentSite.profileBadges : []);
    all("[data-profile-badge]").forEach((input) => { input.checked = badges.has(input.dataset.profileBadge); });
    all("[data-asset-url]").forEach((field) => { field.value = /^https:\/\//i.test(currentSite[field.dataset.assetUrl] || "") ? currentSite[field.dataset.assetUrl] : ""; });
    all("[data-upload]").forEach((field) => { field.value = ""; });
    all("[data-file-note]").forEach((note) => { note.textContent = fileHints[note.dataset.fileNote]; });
    if (currentSite.customFont) document.querySelector('[data-file-note="customFont"]').textContent = "Свой шрифт добавлен · можно заменить другим файлом";
    savedSnapshot = snapshot(readEditor());
    dirty = false;
    updatePreview();
    updatePublication();
  }

  function sendPreview() {
    if (currentUser && previewFrame.contentWindow) {
      previewFrame.contentWindow.postMessage({ type: "iwtxz-profile-preview", site: readEditor() }, location.origin);
      previewFrame.contentWindow.postMessage({type:'iwtxz-layout-edit',enabled:layoutEditing},location.origin);
      sendGrid();
      sendPreviewVisibility();
    }
  }

  function updatePreview() {
    currentSite = readEditor();
    dirty = Boolean(currentUser) && snapshot(currentSite) !== savedSnapshot;
    $("#draftState").textContent = dirty ? "Есть изменения" : "Черновик сохранён";
    $("#draftState").classList.toggle("unsaved", dirty);
    $("#descriptionCount").textContent = `${$("#description").value.length} / 500`;
    $("#avatarSizeValue").value = `${currentSite.avatarSize} px`;
    $("#backgroundDimValue").value = `${currentSite.backgroundDim}%`;
    $("#nicknameGradientAngleValue").value = `${currentSite.nicknameGradientAngle}°`;
    $("#discordCardOpacityValue").value = `${currentSite.discordCardOpacity}%`;
    $("#discordCardRadiusValue").value = `${currentSite.discordCardRadius} px`;
    updateDiscordHint();
    for (const [id, source] of [["avatarThumbnail", currentSite.avatar], ["accountAvatar", currentSite.avatar], ["coverThumbnail", currentSite.musicCover]]) {
      const image = $("#" + id), value = source || "img/tree.png";
      if (image.getAttribute?.("src") !== value) image.src = value;
    }
    all("[data-social-field]").forEach(row => {
      const connected = Boolean(currentSite[row.dataset.socialField]);
      row.classList.toggle("connected", connected);
      row.querySelector("[data-social-state]").textContent = connected ? "Добавлено" : "Добавить";
    });
    all("[data-decoration]").forEach(button => {
      const selected = button.dataset.decoration === currentSite.avatarDecoration;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $("#decorationLabel").textContent = currentSite.avatarDecoration === "discord" ? "Из Discord"
      : features?.decorations.find(item => item.id === currentSite.avatarDecoration)?.label || "Без украшения";
    const animationLabel = features?.animations.find(item => item.id === currentSite.nicknameAnimation)?.label || "Без анимации";
    $("#effectsSummary").textContent = `${animationLabel} · ${$("#decorationLabel").textContent}`;
    $("#nicknameEffectDemo").textContent = currentSite.nickname || "nickname";
    features?.applyNameAnimation($("#nicknameEffectDemo"), currentSite.nicknameAnimation);
    $('#descriptionEffectDemo').textContent=currentSite.description||'Твоё описание';features?.applyDescriptionAnimation($('#descriptionEffectDemo'),currentSite.descriptionAnimation);
    decorationPicker?.update(currentSite.avatarDecoration,currentSite.avatar||'img/tree.png');
    const tabIcon=$('#previewTabIcon');if(tabIcon.getAttribute?.('src')!==(currentSite.favicon||'img/tree.png'))tabIcon.src=currentSite.favicon||'img/tree.png';
    updateDecorationAvatars();updateDiscordDecoration();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 70);
  }

  function updateDiscordHint() {
    const hint = $("#discordSyncHint");
    if (!currentSite.discordSync) {
      hint.textContent = "Синхронизация выключена. В карточке используются твои настройки.";
    } else if (!/^[0-9]{17,20}$/.test(currentSite.discordUserId)) {
      hint.textContent = "Укажи числовой ID Discord, чтобы обновлять карточку.";
    } else if (discordSnapshotStatus?.userId === currentSite.discordUserId) {
      const state = discordSnapshotStatus.state;
      if (state === "ready") {
        const time = Number(discordSnapshotStatus.updatedAt);
        hint.textContent = Number.isFinite(time) && time > 0
          ? `Данные Discord получены · ${new Date(time).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
          : "Данные Discord получены. Карточка обновляется автоматически.";
      } else if (state === "not-member") {
        hint.textContent = "Аккаунт пока не найден на сервере. Вступи по ссылке выше и дождись обновления.";
      } else {
        hint.textContent = "Данных пока нет. После вступления и публикации страницы дождись автоматического обновления.";
      }
    } else {
      hint.textContent = "Сохрани и примени настройки. После вступления на сервер данные появятся при следующем обновлении.";
    }
  }

  function profileUrl() {
    const username = currentUser?.username || "";
    return window.IwtxzProfileLinks?.urlForUser(username) || `/profile.html?u=${encodeURIComponent(username)}`;
  }

  function updatePublication() {
    if (!currentUser) return;
    const url = profileUrl();
    $("#pageAddress").textContent = `${location.host}${url}`;
    if (currentSite.publishedAt) $("#pageAddress").href = url;
    else $("#pageAddress").removeAttribute("href");
    $("#pageAddress").setAttribute("aria-disabled", String(!currentSite.publishedAt));
    $("#copyAddress").disabled = !currentSite.publishedAt;
    $("#publishedBanner").classList.toggle("hidden", !currentSite.publishedAt);
    $("#openProfileTop").href = url;
    $("#openProfile").href = url;
    $("#openProfile").classList.toggle("hidden", !currentSite.publishedAt);
    $("#publishedStatus").textContent = currentSite.publishedAt
      ? "Опубликовано · " + new Date(currentSite.publishedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "Страница ещё не опубликована";
  }

  function updateBusy() {
    $("#editorForm").inert = busy || !accountReady;
    $("#saveButton").disabled = busy || !accountReady || uploadCount > 0;
    $("#publishButton").disabled = busy || !accountReady || uploadCount > 0;
    $("#deleteButton").disabled = busy || !accountReady || uploadCount > 0;
    $("#logoutButton").disabled = busy;
    $('#layoutEdit').disabled=busy||!accountReady;
    $('#layoutReset').disabled=busy||!accountReady;
    if((busy||!accountReady)&&layoutEditing)setLayoutEditing(false);
  }

  function setSection(name) {
    musicCatalog?.close();
    if (name === "music" && accountReady) {
      musicCatalog?.open(currentSite.music);
      musicLibrary?.open(currentSite.music);
    }
    all("[data-settings-section]").forEach((section) => section.classList.toggle("hidden", section.dataset.settingsSection !== name));
    all("[data-section]").forEach((button) => {
      const active = button.dataset.section === name;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    $("#editorActions").classList.toggle("hidden", name === "security");
  }

  function resetSession() {
    musicLibrary?.reset(); musicCatalog?.reset(); previousEffects = null;
    authAttemptVersion += 1;
    sessionVersion += 1;
    accountLoadController?.abort();
    accountLoadController = null;
    accountReady = false;
    setLayoutEditing(false);
    document.body.classList.remove("account-unavailable");
    $("#accountLoadState").classList.add("hidden");
    currentUser = null;
    discordSnapshotStatus = null;
    discordDecoration = null;decorationAvatarSource="";decorationAvatarThumbnail='';++decorationAvatarVersion;
    dirty = false;
    savedSnapshot = "";
    document.body.classList.add("auth-locked");
    $("#accountControls").classList.add("hidden");
    $("#password").value = "";
    $("#password").type = "password";
    $("#showPassword").textContent = "Показать";
    $("#showPassword").setAttribute("aria-label", "Показать пароль");
    $("#showPassword").setAttribute("aria-pressed", "false");
    $("#confirmPassword").value = "";
    $("#ownerClaim").value = "";
    $("#passwordForm").reset();
    previewFrame.contentWindow?.postMessage({ type: "iwtxz-profile-preview", site: { ...defaults, avatar: "", background: "", music: "", title: "", nickname: "", showDiscord: false } }, location.origin);
    writeEditor(defaults);
    $("#pageAddress").textContent = "";
    $("#pageAddress").removeAttribute("href");
    $("#openProfileTop").removeAttribute("href");
    $("#publishedBanner").classList.add("hidden");
    $("#accountName").textContent = "";
    $("#openProfile").removeAttribute("href");
  }

  async function enterAccount(user, attempt = authAttemptVersion) {
    if (attempt !== authAttemptVersion) return;
    accountLoadController?.abort();
    const controller = new AbortController();
    accountLoadController = controller;
    sessionVersion += 1;
    const version = sessionVersion;
    currentUser = user;
    accountReady = false;
    $("#userLine").textContent = `@${user.username}`;
    $("#accountName").textContent = `@${user.username}`;
    $("#accountControls").classList.remove("hidden");
    document.body.classList.remove("auth-locked");
    document.body.classList.add("account-unavailable");
    status("#authStatus", "");
    $("#password").value = "";
    $("#confirmPassword").value = "";
    $("#ownerClaim").value = "";
    setSection("profile");
    $("#accountLoadState").classList.remove("hidden");
    $("#retryAccountLoad").classList.add("hidden");
    $("#retryAccountLoad").disabled = true;
    status("#accountLoadStatus", "Загружаем сохранённые настройки страницы…");
    updateBusy();
    try {
      const data = await api("/api/builder/sites/list", { signal: controller.signal });
      if (version !== sessionVersion || attempt !== authAttemptVersion) return;
      if (!Array.isArray(data.sites)) throw new Error("Сервер вернул неверные настройки страницы.");
      const site = data.sites[0] || { ...defaults, title: user.username, nickname: user.username };
      writeEditor(site);
      accountReady = true;
      document.body.classList.remove("account-unavailable");
      $("#accountLoadState").classList.add("hidden");
      status("#editorStatus", "Черновик виден только тебе. Изменения появятся на странице после применения.");
      sendPreview();
    } catch (error) {
      if (version !== sessionVersion || attempt !== authAttemptVersion) return;
      status("#accountLoadStatus", `Не удалось загрузить сохранённые настройки. ${friendlyError(error)}`, "error");
      $("#retryAccountLoad").classList.remove("hidden");
    } finally {
      if (version === sessionVersion) {
        accountLoadController = null;
        $("#retryAccountLoad").disabled = false;
        updateBusy();
      }
    }
  }

  $("#retryAccountLoad").addEventListener("click", () => {
    if (currentUser && !accountLoadController) void enterAccount(currentUser);
  });

  function validateSite() {
    const site = readEditor();
    const serviceMusic=musicServiceLink($('#musicUrl').value);
    if(serviceMusic&&serviceMusic!==savedServiceMusic){setSection('music');$('#ownMusicFiles').open=true;throw new Error('Это ссылка на музыкальный сервис. Вставь её в «Мою библиотеку» для скачивания или в поиск музыки выше.');}
    if (!site.nickname || !site.title) {
      setSection("profile");
      $(site.nickname ? "#title" : "#nickname").focus();
      throw new Error("Заполни ник и название вкладки.");
    }
    for (const key of socialFields.filter(key => key !== "discord")) {
      if (site[key]) {
        try { const url = new URL(site[key]); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
        catch { setSection("links"); $("#" + key).focus(); throw new Error("Ссылка должна начинаться с https:// и вести на твою страницу."); }
      }
    }
    for (const input of all("[data-asset-url]")) {
      if (input.value && !/^https:\/\//i.test(input.value)) throw new Error("Для файлов по ссылке используй адрес с https://.");
    }
    if (site.font === "custom" && !site.customFont) {
      setSection("appearance");
      $("#customFontFile").focus();
      throw new Error("Загрузи свой шрифт или добавь прямую ссылку на него.");
    }
    if (site.discordUserId && !/^[0-9]{17,20}$/.test(site.discordUserId)) {
      setSection("links");
      $("#discordUserId").focus();
      throw new Error("ID Discord должен состоять из 17–20 цифр.");
    }
    if (site.discordSync && !site.discordUserId) {
      setSection("links");
      $("#discordUserId").focus();
      throw new Error("Для обновления карточки укажи ID пользователя Discord.");
    }
    if (site.avatarDecoration === "discord" && (!site.discordSync || !site.discordUserId)) {
      setSection("links"); $("#discordUserId").focus();
      throw new Error("Для украшения из Discord укажи ID и включи синхронизацию.");
    }
    return site;
  }

  async function saveDraft() {
    const site = validateSite();
    const submittedSnapshot = snapshot(site);
    const data = await api("/api/builder/sites/save", { method: "POST", body: JSON.stringify({ site }) });
    const labels={avatarDecoration:"украшение аватара",nicknameAnimation:"анимацию ника",backgroundEffect:"эффект фона",profileTilt:"наклон карточки",cursorStyle:"курсор",customCursor:"свой курсор",favicon:"иконку вкладки",music:"трек",musicCover:"обложку",nicknameSize:"размер ника",profileScale:"масштаб",discordShowCopyHint:"подсказку копирования"};
    Object.assign(labels,{descriptionSize:'размер описания',cursorSize:'размер курсора',cursorOpacity:'непрозрачность курсора',cursorColor:'цвет курсора',cursorHotspot:'точку нажатия',typewriterEnabled:'печатную строку',typewriterText:'текст печатной строки',typewriterSpeed:'скорость печати'});
    Object.assign(labels,{descriptionAnimation:'анимацию описания'});if(Object.keys(site.objectPositions).length)labels.layoutVersion='координаты блоков';
    const lost=Object.keys(labels).filter(key=>Object.hasOwn(data.site||{},key)||site[key]!==defaults[key]).filter(key=>data.site?.[key]!==site[key]);
    if(JSON.stringify(normalizePositions(data.site?.objectPositions))!==JSON.stringify(normalizePositions(site.objectPositions)))lost.push('objectPositions');
    labels.objectPositions='расположение блоков';
    if(lost.length)throw new Error(`Сервер не подтвердил ${lost.map(key=>labels[key]).join(", ")}. Выбор остался в редакторе. Попробуй сохранить ещё раз.`);
    if(snapshot(readEditor())!==submittedSnapshot){
      savedSnapshot=snapshot(data.site);updatePreview();
      throw new Error("Черновик сохранён, но за время запроса появились новые изменения. Они остались в редакторе — примени их ещё раз.");
    }
    writeEditor(data.site);
    return data.site;
  }

  async function saveOrPublish(publish) {
    if (!accountReady) return;
    if (!currentUser || busy || uploadCount) return;
    busy = true;
    updateBusy();
    try {
      status("#editorStatus", publish ? "Сохраняем и применяем изменения…" : "Сохраняем черновик…");
      await saveDraft();
      if (publish) {
        const result = await api("/api/builder/publish", { method: "POST", body: "{}" });
        currentSite.publishedAt = result.publishedAt || Date.now();
        updatePublication();
        status("#editorStatus", "Готово. Изменения появились на твоей странице.", "ok");
        toast("Страница обновлена");
      } else status("#editorStatus", "Черновик сохранён. Чтобы обновить страницу для посетителей, нажми «Применить к странице».", "ok");
    } catch (error) { status("#editorStatus", friendlyError(error), "error"); }
    finally { busy = false; updateBusy(); }
  }

  const mimeByExtension = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
  async function uploadFile(input) {
    if (!accountReady) return;
    const file = input.files?.[0];
    if (!file || !currentUser) return;
    const key = input.dataset.upload;
    const version = sessionVersion;
    const extensionType = mimeByExtension[file.name.split(".").pop().toLowerCase()] || "";
    const type = key === "customFont" ? extensionType : file.type || extensionType;
    const image = /^image\/(png|jpeg|gif|webp)$/.test(type);
    const allowed = key === "customFont" ? /^font\/(woff|woff2|ttf|otf)$/.test(type)
      : key === "music" ? /^audio\/(mpeg|mp3|ogg|wav|x-wav|mp4|webm)$/.test(type)
      : image || (key === "background" && /^video\/(mp4|webm)$/.test(type));
    if (!allowed || !file.size || file.size > 4 * 1024 * 1024) {
      input.value = "";
      status("#editorStatus", !allowed ? "Этот формат не поддерживается. Выбери файл из списка под полем." : "Размер файла должен быть больше нуля и не больше 4 МБ.", "error");
      return;
    }
    input.disabled = true;
    uploadCount += 1;
    updateBusy();
    status("#editorStatus", `Загружаем «${file.name}»…`);
    try {
      const result = await api(`/api/builder/assets/upload?kind=${key}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "content-type": type }, body: file, upload: true });
      if (version !== sessionVersion) return;
      currentSite[key] = result.url;
      const urlInput = document.querySelector(`[data-asset-url="${key}"]`);
      if (urlInput) urlInput.value = "";
      if (key === "background") $("#backgroundType").value = type.startsWith("video/") ? "video" : "image";
      if (key === "music" && !$("#musicTitle").value) $("#musicTitle").value = file.name.replace(/\.[^.]+$/, "");
      if (key === "music") void musicLibrary?.remember(result.url, $("#musicTitle").value || file.name.replace(/\.[^.]+$/, ""));
      if (key === "customFont") $("#font").value = "custom";
      document.querySelector(`[data-file-note="${key}"]`).textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ · загружено`;
      updatePreview();
      status("#editorStatus", "Файл загружен. Сохрани черновик или примени изменения к странице.", "ok");
    } catch (error) { if (version === sessionVersion) status("#editorStatus", friendlyError(error), "error"); }
    finally { input.disabled = false; input.value = ""; uploadCount -= 1; updateBusy(); }
  }

  function updateOwnerClaimField() {
    const username = $("#username").value.trim().toLowerCase();
    const reserved = ["iwtlu", "shakzy", "strelok", "strelokk", "icetearz", "eris"].includes(username);
    $("#ownerClaimField").classList.toggle("hidden", authMode !== "signup" || !reserved);
  }
  $("#username").addEventListener("input", updateOwnerClaimField);
  all("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
    $("#switchToLogin").classList.add("hidden");
    authMode = button.dataset.authMode;
    all("[data-auth-mode]").forEach((tab) => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active)); });
    const signup = authMode === "signup";
    $("#confirmPasswordField").classList.toggle("hidden", !signup);
    $("#confirmPassword").required = signup;
    $("#password").minLength = signup ? 8 : 1;
    $("#password").autocomplete = signup ? "new-password" : "current-password";
    $("#authHeading").textContent = signup ? "Создать страницу" : "Войти";
    $("#authSubmit").textContent = signup ? "Создать страницу" : "Войти";
    updateOwnerClaimField();
    status("#authStatus", "");
  }));

  $("#showPassword").addEventListener("click", () => {
    const show = $("#password").type === "password";
    $("#password").type = show ? "text" : "password";
    $("#showPassword").textContent = show ? "Скрыть" : "Показать";
    $("#showPassword").setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
    $("#showPassword").setAttribute("aria-pressed", String(show));
  });

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (authPending) return;
    if (authMode === "signup" && $("#password").value !== $("#confirmPassword").value) { status("#authStatus", "Пароли не совпадают.", "error"); return; }
    const mode = authMode;
    const attempt = ++authAttemptVersion;
    bootstrapAuthController.abort();
    authPending = true;
    $("#switchToLogin").classList.add("hidden");
    const credentials = { username: $("#username").value.trim(), password: $("#password").value };
    let signedIn = false;
    if (mode === "signup" && $("#ownerClaim").value.trim()) credentials.ownerClaim = $("#ownerClaim").value.trim();
    all("#authForm button, [data-auth-mode]").forEach((button) => { button.disabled = true; });
    try {
      status("#authStatus", mode === "signup" ? "Создаём аккаунт…" : "Входим…");
      const result = await api(`/api/builder/auth/${mode}`, { method: "POST", body: JSON.stringify(credentials) });
      if (attempt !== authAttemptVersion) return;
      signedIn = true;
      status("#authStatus", mode === "signup" ? "Аккаунт создан. Загружаем кабинет…" : "Вход выполнен. Загружаем кабинет…");
      await enterAccount(result.user, attempt);
    } catch (error) {
      if (attempt !== authAttemptVersion) return;
      const duplicate = mode === "signup" && error.code === "username_taken";
      const timedOutSignup = mode === "signup" && error.code === "request_timeout";
      status("#authStatus", signedIn
        ? `Вход выполнен, но кабинет не загрузился. ${friendlyError(error)}`
        : duplicate
        ? "Этот логин уже зарегистрирован. Если ты уже создавал аккаунт, перейди ко входу и используй свой пароль."
        : timedOutSignup
          ? "Сервер не ответил вовремя. Аккаунт мог успеть создаться — попробуй войти с тем же логином и паролем."
          : friendlyError(error), "error");
      $("#switchToLogin").classList.toggle("hidden", !duplicate && !timedOutSignup);
    }
    finally { authPending = false; all("#authForm button, [data-auth-mode]").forEach((button) => { button.disabled = false; }); }
  });

  $("#switchToLogin").addEventListener("click", () => {
    document.querySelector('[data-auth-mode="login"]').click();
    $("#password").focus();
  });

  $("#logoutButton").addEventListener("click", async () => {
    if (uploadCount) { toast("Подожди, пока загрузятся файлы"); return; }
    if (dirty && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
    try { await api("/api/builder/auth/logout", { method: "POST", body: "{}" }); resetSession(); status("#authStatus", "Ты вышел из аккаунта."); }
    catch (error) { toast(friendlyError(error)); }
  });

  $("#editorForm").addEventListener("submit", (event) => event.preventDefault());
  $('#layoutEdit').addEventListener('click',()=>{setLayoutEditing(!layoutEditing);if(layoutEditing)previewFrame.scrollIntoView?.({behavior:'smooth',block:'center'});});
  $('#layoutReset').addEventListener('click',()=>{if(!accountReady||busy)return;currentSite.objectPositions={};updatePreview();clearTimeout(previewTimer);sendPreview();toast('Позиции блоков сброшены');});
  all("[data-social-remove]").forEach(button => button.addEventListener("click", () => {
    $("#" + button.dataset.socialRemove).value = "";
    button.closest("details").open = false;
    updatePreview();
  }));
  if(!decorationPicker)all("[data-decoration]").forEach(button => button.addEventListener("click", () => {
    $("#avatarDecoration").value = button.dataset.decoration;
    updatePreview();
    clearTimeout(previewTimer); sendPreview();
  }));
  $("#openEffects").addEventListener("click", () => setSection("effects"));
  $("#randomizeEffects").addEventListener("click", () => {
    previousEffects = { nicknameAnimation: $("#nicknameAnimation").value, avatarDecoration: $("#avatarDecoration").value };
    const choose = items => items[Math.floor(Math.random() * items.length)].id;
    $("#nicknameAnimation").value = choose(features.animations.filter(item => item.id !== "none" && item.id !== previousEffects.nicknameAnimation));
    $("#avatarDecoration").value = choose(features.decorations.filter(item => item.id !== previousEffects.avatarDecoration));
    $("#undoEffects").classList.remove("hidden");
    updatePreview(); clearTimeout(previewTimer); sendPreview();
  });
  $("#undoEffects").addEventListener("click", () => {
    if (!previousEffects) return;
    $("#nicknameAnimation").value = previousEffects.nicknameAnimation;
    $("#avatarDecoration").value = previousEffects.avatarDecoration;
    previousEffects = null; $("#undoEffects").classList.add("hidden"); updatePreview();
  });
  $('.service-catalog-section')?.addEventListener('toggle',()=>{if(!$('.service-catalog-section').open)musicCatalog?.close();});
  $("#editorForm").addEventListener("input", (event) => {
    if (event.target.type === "file") return;
    const key = event.target.dataset.assetUrl;
    if (key && !(key==='music'&&musicServiceLink(event.target.value.trim()))) currentSite[key] = event.target.value.trim();
    if (key === "customFont" && currentSite.customFont) $("#font").value = "custom";
    updatePreview();
  });
  $("#editorForm").addEventListener("change", (event) => { if (event.target.type !== "file") updatePreview(); });
  all("[data-upload]").forEach((input) => input.addEventListener("change", () => uploadFile(input)));
  all("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.remove;
    if (uploadCount) return;
    currentSite[key] = "";
    if (key === "customFont" && $("#font").value === "custom") $("#font").value = "minecraft";
    const field = document.querySelector(`[data-asset-url="${key}"]`);
    if (field) field.value = "";
    document.querySelector(`[data-file-note="${key}"]`).textContent = "Файл убран. Можно загрузить другой.";
    updatePreview();
  }));
  all("[data-section]").forEach((button) => button.addEventListener("click", () => setSection(button.dataset.section)));
  $("#saveButton").addEventListener("click", () => saveOrPublish(false));
  $("#publishButton").addEventListener("click", () => saveOrPublish(true));
  $("#copyAddress").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(new URL(profileUrl(), location.origin).href); toast("Адрес скопирован"); }
    catch { toast("Не получилось скопировать адрес. Его можно выделить вручную."); }
  });
  $("#deleteButton").addEventListener("click", async () => {
    if (!accountReady || busy || uploadCount || !confirm("Удалить черновик и опубликованную страницу? Это действие нельзя отменить.")) return;
    busy = true; updateBusy();
    try {
      await api("/api/builder/sites/delete", { method: "POST", body: "{}" });
      const data = await api("/api/builder/sites/list");
      writeEditor(data.sites[0]);
      setSection("profile");
      status("#editorStatus", "Страница удалена. Можно настроить новую.", "ok");
    } catch (error) { status("#passwordStatus", friendlyError(error), "error"); }
    finally { busy = false; updateBusy(); }
  });
  $("#passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || uploadCount) return;
    if ($("#newPassword").value !== $("#repeatNewPassword").value) { status("#passwordStatus", "Новые пароли не совпадают.", "error"); return; }
    const button = event.submitter;
    busy = true;
    updateBusy();
    if (button) button.disabled = true;
    try {
      await api("/api/builder/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: $("#currentPassword").value, newPassword: $("#newPassword").value }) });
      $("#passwordForm").reset();
      status("#passwordStatus", "Пароль изменён.", "ok");
    } catch (error) { status("#passwordStatus", friendlyError(error), "error"); }
    finally { if (button) button.disabled = false; busy = false; updateBusy(); }
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== previewFrame.contentWindow) return;
    if(event.data?.type==='iwtxz-layout-edit-ended')setLayoutEditing(false);
    if(event.data?.type==='iwtxz-layout-change'&&layoutEditing&&accountReady&&!busy){currentSite.objectPositions=normalizePositions(event.data.positions);currentSite.layoutVersion=event.data.layoutVersion===2?2:1;updatePreview();}
    if(event.data?.type==='iwtxz-title-preview'&&typeof event.data.title==='string')$('#previewTabTitle').textContent=event.data.title.slice(0,140);
    if(event.data?.type==='iwtxz-layout-selected'){
      selectedLayoutBlock=positionKeys.includes(event.data.key)?event.data.key:'';
      $('#layoutSelection').textContent=selectedLayoutBlock?`Выбран блок: ${String(event.data.label||selectedLayoutBlock).slice(0,40)}`:'Выбери блок в режиме перемещения';
      ['layoutAlignHorizontal','layoutAlignVertical','layoutAlignBoth'].forEach(id=>$('#'+id).disabled=!selectedLayoutBlock||!layoutEditing);
    }
    if (event.data?.type === "iwtxz-profile-ready") sendPreview();
    if (event.data?.type === "iwtxz-font-status" && event.data.source === currentSite.customFont) {
      const labels = {
        loading: "Шрифт загружается в превью…", ready: "Свой шрифт загружен. Интерфейс кабинета остаётся в Minecraft.",
        unavailable: "Не удалось загрузить шрифт. Проверь файл и доступ по ссылке; пока используется Minecraft.", disabled: ""
      };
      $("#customFontStatus").textContent = labels[event.data.state] || "";
    }
    if (event.data?.type === "iwtxz-discord-status" && event.data.userId === currentSite.discordUserId) {
      discordSnapshotStatus = { userId: event.data.userId, state: event.data.state, updatedAt: event.data.updatedAt };
      updateDiscordHint();
      updateDiscordDecoration();
    }
    if(event.data?.type==='iwtxz-discord-decoration'&&event.data.userId===currentSite.discordUserId){discordDecoration=event.data.decoration;updateDiscordDecoration();}
  });
  previewFrame.addEventListener("load", sendPreview);
  window.addEventListener("iwtxz-auth-change", (event) => {
    if (event.detail?.event === "SIGNED_OUT" && currentUser) {
      resetSession();
      status("#authStatus", "Сеанс завершён. Войди ещё раз.");
    }
  });
  window.addEventListener("beforeunload", (event) => { if (dirty || uploadCount) { event.preventDefault(); event.returnValue = ""; } });
  ["#avatarThumbnail", "#accountAvatar", "#coverThumbnail"].forEach((selector) => $(selector).addEventListener("error", (event) => { if (!event.target.src.endsWith("/img/tree.png")) event.target.src = "img/tree.png"; }));

  if (new URLSearchParams(location.search).get("auth") === "signup") document.querySelector('[data-auth-mode="signup"]').click();
  (async () => {
    const attempt = authAttemptVersion;
    try {
      const data = await api("/api/builder/auth/me", { signal: bootstrapAuthController.signal });
      if (attempt !== authAttemptVersion) return;
      if (data.user) await enterAccount(data.user, attempt);
      else status("#authStatus", "");
    } catch (error) { if (attempt === authAttemptVersion) status("#authStatus", friendlyError(error), "error"); }
  })();
})();
