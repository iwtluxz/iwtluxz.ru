(() => {
  'use strict';
  if (window.IwtxzSiteChrome) return;
  const symbols = {
    telegram: '<svg viewBox="-1 .3 24 24" aria-hidden="true"><path d="m21.6 3.2-3.2 17c-.24 1.2-.88 1.5-1.8.94l-4.88-3.6-2.36 2.28c-.27.26-.5.48-1.02.48l.35-4.97 9.05-8.17c.4-.35-.08-.55-.6-.2L6 13.99l-4.79-1.5c-1.04-.32-1.06-1.03.22-1.53l18.73-7.22c.87-.32 1.63.2 1.44 1.46Z"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M8.5 4.2 12 7l3.5-2.8M8.5 19.8 12 17l3.5 2.8M3.5 10.9 7.7 9.5l-.7-4.4m10 13.8-.7-4.4 4.2-1.4M3.5 13.1l4.2 1.4-.7 4.4M17 5.1l-.7 4.4 4.2 1.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.4a1 1 0 0 1 1.55-.83l9 6a1.72 1.72 0 0 1 0 2.86l-9 6A1 1 0 0 1 9 18.6Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
  };
  let instance;
  const inert = Object.freeze({ configureAudio() {}, dispose() {} });
  function create() {
    if (instance) return instance;
    if (window.parent !== window) return inert;
    const cabinet = Boolean(document.getElementById('authForm'));
    const controller = new AbortController();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const listen = (node, type, handler, options = {}) => node.addEventListener(type, handler, { ...options, signal: controller.signal });
    const storage = {
      get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
      set(key, value) { try { localStorage.setItem(key, String(value)); } catch {} }
    };
    const make = (tag, className, label) => {
      const node = document.createElement(tag); node.className = className;
      if (label !== undefined) node.textContent = label;
      return node;
    };
    const icon = name => { const span = make('span', 'site-chrome-icon'); span.innerHTML = symbols[name]; return span; };
    const root = make('nav', 'iwtxz-site-chrome'); root.setAttribute('aria-label', 'Проект iwtxz');
    const host = cabinet ? document.querySelector('.topbar') : null;
    if (host) { root.classList.add('site-chrome-in-header'); host.append(root); }
    else { root.classList.add('site-chrome-floating'); document.body.append(root); }
    const telegram = make('a', 'site-project-telegram');
    telegram.href = 'https://t.me/iwt_su'; telegram.target = '_blank'; telegram.rel = 'noopener noreferrer';
    telegram.setAttribute('aria-label', 'Telegram проекта iwtxz — @iwt_su'); telegram.title = 'Telegram проекта — @iwt_su';
    const telegramIcon = icon('telegram'); telegramIcon.classList.add('site-telegram-icon');
    const telegramIconSlot = make('span', 'site-telegram-icon-slot');
    telegramIconSlot.append(telegramIcon);
    const telegramLabel = make('span', 'site-telegram-label');
    telegramLabel.append(make('strong', '', 'Telegram проекта'), make('span', '', '@iwt_su'));
    const telegramSurface = make('span', 'site-telegram-surface');
    telegramSurface.append(telegramIconSlot, telegramLabel); telegram.append(telegramSurface);
    let decor, garland, winterButton, musicButton, status, volumeOutput, volume, audio, disposed = false;
    let musicRequested = false, pendingPlay = false, mediaSource = '', mediaStart = 0, mediaVersion = 0, playSerial = 0;
    let configured = window.IWTXZ_SITE_AUDIO_CONFIG || {}, musicError = '';
    let winter = cabinet && storage.get('iwtxz:winter:enabled', '1') !== '0';

    function updateMotion() {
      document.body.classList.toggle('iwtxz-winter-reduced', motion.matches);
      document.body.classList.toggle('iwtxz-winter-paused', document.hidden);
    }
    function buildDecor() {
      if (decor) return;
      decor = make('div', 'site-winter-scene'); decor.setAttribute('aria-hidden', 'true');
      const lights = make('div', 'site-winter-lights');
      for (let i = 0; i < 18; i++) { const bulb = make('span', ''); bulb.style.setProperty('--bulb-index', i); lights.append(bulb); }
      garland = lights;
      garland.setAttribute('aria-hidden', 'true'); document.body.append(garland);
      for (let i = 0; i < 14; i++) {
        const snow = icon('snow'); snow.classList.add('site-winter-flake');
        snow.style.setProperty('--flake-x', `${3 + ((i * 37) % 94)}%`);
        snow.style.setProperty('--flake-y', `${8 + ((i * 29) % 79)}%`);
        snow.style.setProperty('--flake-size', `${7 + (i % 4) * 2}px`);
        snow.style.setProperty('--flake-delay', `${-i * 1.9}s`);
        snow.style.setProperty('--flake-time', `${24 + (i % 4) * 4}s`);
        decor.append(snow);
      }
      document.body.prepend(decor);
    }
    function setWinter(value, remember = true) {
      winter = Boolean(value);
      if (winter) buildDecor();
      if (decor) decor.hidden = !winter;
      if (garland) garland.hidden = !winter;
      document.body.classList.toggle('iwtxz-winter', winter);
      winterButton?.setAttribute('aria-pressed', String(winter));
      winterButton?.setAttribute('aria-label', winter ? 'Выключить новогоднее оформление' : 'Включить новогоднее оформление');
      if (remember) storage.set('iwtxz:winter:enabled', winter ? '1' : '0');
      updateMotion();
    }
    function safeAudio(value) {
      if (typeof value !== 'string' || !value.trim()) return '';
      try {
        const url = new URL(value, document.baseURI);
        if (url.username || url.password) return '';
        return url.protocol === 'https:' || (url.origin === location.origin && ['http:', 'file:'].includes(url.protocol) && /\/sound\//.test(url.pathname)) ? url.href : '';
      } catch { return ''; }
    }
    function reflectMusic(message) {
      if (!musicButton) return;
      const playing = Boolean(audio && !audio.paused && musicRequested);
      musicButton.replaceChildren(icon(playing ? 'pause' : 'play'));
      musicButton.setAttribute('aria-pressed', String(playing));
      musicButton.setAttribute('aria-label', playing ? 'Выключить музыку сайта' : 'Включить музыку сайта');
      musicButton.title = playing ? 'Выключить музыку сайта' : 'Включить музыку сайта';
      musicButton.classList.toggle('is-playing', playing);
      if (message || musicError) status.textContent = message || musicError;
      else status.textContent = playing ? 'Играет' : pendingPlay ? 'Загружается…' : 'Выключена';
    }
    function configureAudio(value = window.IWTXZ_SITE_AUDIO_CONFIG || {}) {
      configured = value && typeof value === 'object' ? value : {};
      musicError = '';
      const source = safeAudio(configured.url);
      const start = Number(configured.start);
      mediaStart = Number.isFinite(start) && start > 0 ? start : 0;
      if (source !== mediaSource) {
        mediaVersion++; playSerial++; mediaSource = source; musicRequested = false; pendingPlay = false;
        if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
      }
      if (musicButton) musicButton.disabled = !source;
      reflectMusic(source ? undefined : 'Музыка пока недоступна');
    }
    function getAudio() {
      if (audio) return audio;
      audio = document.createElement('audio'); audio.className = 'site-project-audio';
      audio.preload = 'none'; audio.loop = true; audio.src = mediaSource;
      root.append(audio);
      audio.volume = Math.min(1, Math.max(0, Number(volume.value) / 100));
      const current = audio;
      listen(current, 'loadedmetadata', () => {
        if (mediaStart && Number.isFinite(current.duration) && mediaStart < current.duration) {
          try { current.currentTime = mediaStart; } catch {}
        }
      });
      listen(current, 'play', () => reflectMusic());
      listen(current, 'pause', () => reflectMusic());
      listen(current, 'error', () => { musicRequested = false; pendingPlay = false; musicError = 'Не удалось загрузить музыку. Попробуй ещё раз.'; reflectMusic(); });
      return current;
    }
    async function playMusic() {
      const revision = mediaVersion, serial = ++playSerial;
      const track = getAudio(); pendingPlay = true; reflectMusic();
      try {
        await track.play();
        if (disposed || revision !== mediaVersion || !musicRequested || document.hidden) track.pause();
      } catch {
        if (serial === playSerial && revision === mediaVersion && !disposed && musicRequested) { musicRequested = false; musicError = 'Нажми ещё раз, чтобы включить музыку.'; reflectMusic(); }
      } finally { if (serial === playSerial && revision === mediaVersion) { pendingPlay = false; reflectMusic(); } }
    }
    if (cabinet) {
      winterButton = make('button', 'site-chrome-button site-winter-toggle'); winterButton.type = 'button';
      winterButton.append(icon('snow'), make('span', 'site-winter-toggle-label', 'Новый год'));
      listen(winterButton, 'click', () => setWinter(!winter));
      root.append(winterButton);
      const music = make('div', 'site-project-music');
      musicButton = make('button', 'site-chrome-button site-project-music-toggle'); musicButton.type = 'button';
      musicButton.setAttribute('aria-describedby', 'siteProjectMusicStatus');
      const panel = make('div', 'site-project-music-panel'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Настройки музыки сайта');
      panel.append(make('strong', '', 'Музыка сайта'));
      status = make('span', 'site-project-music-status', 'Выключена'); status.id = 'siteProjectMusicStatus'; status.setAttribute('role', 'status');
      const label = make('label', 'site-project-volume-label', 'Громкость');
      volumeOutput = make('output', '', '35%');
      volume = make('input', 'site-project-volume'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.step = '1'; volume.setAttribute('aria-label', 'Громкость музыки сайта');
      const stored = Number(storage.get('iwtxz:site-music:volume', '35'));
      volume.value = String(Number.isFinite(stored) ? Math.max(0, Math.min(100, stored)) : 35);
      volumeOutput.value = `${volume.value}%`;
      label.append(volumeOutput, volume); panel.append(status, label);
      music.append(musicButton, panel); root.append(music);
      listen(musicButton, 'click', event => {
        if (!event.isTrusted) return;
        if ((window.IWTXZ_SITE_AUDIO_CONFIG?.url || '') !== (configured.url || '')) configureAudio();
        if (!mediaSource) return;
        musicError = '';
        musicRequested = !musicRequested;
        if (musicRequested) void playMusic();
        else { playSerial++; pendingPlay = false; audio?.pause(); reflectMusic(); }
      });
      listen(volume, 'input', () => {
        const value = Math.min(100, Math.max(0, Number(volume.value) || 0));
        volumeOutput.value = `${value}%`; storage.set('iwtxz:site-music:volume', value);
        if (audio) audio.volume = value / 100;
      });
      configureAudio(configured); setWinter(winter, false);
    }
    root.append(telegram);
    listen(motion, 'change', updateMotion);
    listen(document, 'visibilitychange', () => {
      updateMotion();
      if (document.hidden) audio?.pause();
      else if (musicRequested && mediaSource) void playMusic();
    });
    listen(window, 'storage', event => { if (cabinet && event.key === 'iwtxz:winter:enabled') setWinter(storage.get('iwtxz:winter:enabled', '1') !== '0', false); });
    function dispose() {
      if (disposed) return;
      disposed = true; controller.abort(); musicRequested = false; audio?.pause();
      if (audio) { audio.removeAttribute('src'); audio.load(); }
      decor?.remove(); garland?.remove(); root.remove();
      document.body.classList.remove('iwtxz-winter', 'iwtxz-winter-paused', 'iwtxz-winter-reduced'); instance = undefined;
    }
    listen(window, 'pagehide', event => { if (event.persisted) audio?.pause(); else dispose(); });
    listen(window, 'pageshow', () => { updateMotion(); if (musicRequested && !document.hidden) void playMusic(); });
    instance = Object.freeze({ configureAudio, dispose });
    return instance;
  }
  window.IwtxzSiteChrome = Object.freeze({ create });
  create();
})();
