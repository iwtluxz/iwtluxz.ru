(() => {
  'use strict';

  const icons = Object.freeze({
    google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.38ZM12 22c2.7 0 4.96-.9 6.62-2.4l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.58-4.13H3.08v2.6A10 10 0 0 0 12 22ZM6.42 13.92a6 6 0 0 1 0-3.84v-2.6H3.08a10 10 0 0 0 0 9.04l3.34-2.6ZM12 5.95c1.47 0 2.79.51 3.83 1.52l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.92 5.48l3.34 2.6C7.2 7.7 9.4 5.95 12 5.95Z"/></svg>',
    discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52l-.6 1.24a18.4 18.4 0 0 0-5.66 0l-.61-1.24a19.7 19.7 0 0 0-4.88 1.52C.59 8.95-.25 13.4.17 17.78a19.9 19.9 0 0 0 6 3.03l1.25-2.04a12.8 12.8 0 0 1-1.96-.94l.48-.37c3.78 1.75 7.9 1.75 11.63 0l.49.37c-.63.37-1.29.69-1.97.94l1.25 2.04a19.9 19.9 0 0 0 6-3.03c.5-5.08-.85-9.5-3.02-13.41ZM8.02 15.1c-1.14 0-2.07-1.05-2.07-2.34s.91-2.34 2.07-2.34 2.09 1.06 2.07 2.34c0 1.29-.91 2.34-2.07 2.34Zm7.96 0c-1.14 0-2.07-1.05-2.07-2.34s.91-2.34 2.07-2.34 2.09 1.06 2.07 2.34c0 1.29-.91 2.34-2.07 2.34Z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  });

  function create(options = {}) {
    const panel = document.querySelector('#authPanel');
    const ordinaryForm = document.querySelector('#authForm');
    if (!panel || !ordinaryForm || typeof options.api !== 'function') return null;
    if (panel.iwtxzAuthUi) return panel.iwtxzAuthUi;
    const api = options.api;
    const $ = selector => panel.querySelector(selector);
    const heading = $('#authHeading');
    const tabs = $('.auth-tabs');
    const username = $('#username');
    const usernameLabel = username?.closest('label');
    const usernameHint = usernameLabel?.querySelector('.hint');
    const signupPattern = username?.getAttribute('pattern') || '[a-zA-Z0-9][a-zA-Z0-9_\\-]{2,31}';
    const security = document.querySelector('[data-settings-section="security"]');
    const passwordForm = document.querySelector('#passwordForm');
    let view = 'login';
    let localBusy = false;
    let ordinaryBusy = false;
    let sessionFlow = '';
    let accountVersion = 0;
    let currentUser = null;
    let account = null;
    let disposed = false;

    panel.classList.add('auth-upgraded');
    const mark = document.createElement('div');
    mark.className = 'auth-wordmark';
    mark.textContent = 'iwtxz';
    mark.setAttribute('aria-hidden', 'true');
    panel.prepend(mark);
    const providerArea = document.createElement('div');
    providerArea.className = 'auth-provider-area';
    providerArea.innerHTML = `<div class="auth-providers" aria-label="Войти через сервис"><button class="auth-provider auth-provider-google" type="button" data-auth-provider="google">${icons.google}<span>Google</span></button><button class="auth-provider auth-provider-discord" type="button" data-auth-provider="discord">${icons.discord}<span>Discord</span></button></div><div class="auth-divider"><span>или по логину</span></div>`;
    tabs?.before(providerArea);
    if (!tabs) ordinaryForm.before(providerArea);
    const forgotten = document.createElement('button');
    forgotten.type = 'button';
    forgotten.className = 'text-button auth-forgotten';
    forgotten.textContent = 'Забыл пароль?';
    ordinaryForm.after(forgotten);
    const alternative = document.createElement('div');
    alternative.className = 'auth-alternative hidden';
    alternative.innerHTML = `
      <form class="auth-form auth-flow-form hidden" data-auth-view="recover">
        <p class="auth-flow-description">Отправим ссылку для нового пароля на привязанную почту.</p>
        <label class="field">Почта<input id="recoveryEmail" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required></label>
        <button class="button primary auth-submit" type="submit">Отправить ссылку</button>
        <p class="status" role="status" aria-live="polite" data-auth-status="recover"></p>
      </form>
      <form class="auth-form auth-flow-form hidden" data-auth-view="reset">
        <p class="auth-flow-description">Придумай новый пароль для своего аккаунта.</p>
        <label class="field">Новый пароль<input id="recoveryPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
        <label class="field">Ещё раз<input id="recoveryPasswordRepeat" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
        <button class="button primary auth-submit" type="submit">Сохранить пароль</button>
        <p class="status" role="status" aria-live="polite" data-auth-status="reset"></p>
      </form>
      <form class="auth-form auth-flow-form hidden" data-auth-view="complete">
        <p class="auth-flow-description">Остался один шаг — выбери адрес своей страницы.</p>
        <label class="field">Логин<span class="auth-address-field"><span aria-hidden="true">iwtxz.su/</span><input id="oauthUsername" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="32" pattern="[a-zA-Z0-9][a-zA-Z0-9_\\-]{2,31}" required></span><span class="hint">3–32 · a–z, 0–9, _ и -</span></label>
        <button class="button primary auth-submit" type="submit">Создать страницу</button>
        <p class="status" role="status" aria-live="polite" data-auth-status="complete"></p>
      </form>
      <button class="text-button auth-back" type="button">← Ко входу</button>`;
    forgotten.after(alternative);

    const identityGroup = document.createElement('div');
    identityGroup.className = 'auth-account-settings';
    identityGroup.innerHTML = `
      <div class="auth-email-card"><div class="auth-account-heading"><span class="auth-account-icon">${icons.mail}</span><div><h3>Почта</h3><p class="hint" id="accountEmailState">Загружаем…</p></div><button type="button" class="text-button" id="refreshAccountIdentity">Обновить</button></div>
      <p class="hint auth-email-pending hidden" id="accountEmailPending"></p>
      <form id="accountEmailForm"><label class="field"><span id="accountEmailLabel">Привязать почту</span><input id="accountEmail" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required></label><button class="button small" id="saveAccountEmail" type="submit">Отправить подтверждение</button><p class="status" id="accountEmailStatus" role="status" aria-live="polite"></p></form>
      <p class="hint auth-email-explanation">Для восстановления доступа и входа по почте.</p></div>
      <div class="auth-connected-accounts"><h3>Вход через сервисы</h3><p class="hint">Привяжи сервис здесь, чтобы входить в этот же аккаунт.</p><div class="auth-connected-row"><span class="auth-service-mark auth-service-google">${icons.google}</span><span>Google<small id="googleIdentityState">Не привязан</small></span><button class="button small" type="button" data-link-provider="google">Привязать</button></div><div class="auth-connected-row"><span class="auth-service-mark">${icons.discord}</span><span>Discord<small id="discordIdentityState">Не привязан</small></span><button class="button small" type="button" data-link-provider="discord">Привязать</button></div><p class="status" id="accountIdentityStatus" role="status" aria-live="polite"></p></div>
      <div class="auth-password-note hidden"><p class="hint">Для входа через Google или Discord пароль не нужен. Можно создать его через привязанную почту.</p><button class="button small" id="createAccountPassword" type="button">Создать пароль по почте</button><p class="status" id="createAccountPasswordStatus" role="status" aria-live="polite"></p></div>`;
    if (passwordForm) passwordForm.before(identityGroup);
    else security?.append(identityGroup);
    const accountElement = selector => identityGroup.querySelector(selector);

    function notice(node, message = '', kind = '') {
      if (!node) return;
      node.textContent = message;
      node.classList.toggle('error', kind === 'error');
      node.classList.toggle('success', kind === 'success');
    }
    function messageFor(error) {
      return typeof error?.message === 'string' && error.message ? error.message : 'Не удалось выполнить запрос. Попробуй ещё раз.';
    }
    function notifyFlow() {
      options.onAuthFlow?.({ view, busy: localBusy || ordinaryBusy, sessionFlow });
    }
    function updateBusy() {
      const busy = localBusy || ordinaryBusy;
      for (const button of panel.querySelectorAll('button')) button.disabled = busy;
      for (const button of identityGroup.querySelectorAll('button')) {
        const linked = button.dataset.linkProvider && (account?.providers || []).includes(button.dataset.linkProvider);
        button.disabled = busy || !currentUser || Boolean(linked);
      }
      panel.setAttribute('aria-busy', String(busy));
      alternative.querySelector('.auth-back').disabled = busy;
      notifyFlow();
    }
    function updateOrdinaryFields(mode) {
      const signup = mode === 'signup';
      if (username) {
        username.maxLength = signup ? 32 : 254;
        if (signup) username.setAttribute('pattern', signupPattern);
        else username.removeAttribute('pattern');
        username.setAttribute('inputmode', signup ? 'text' : 'email');
        username.placeholder = signup ? 'username' : 'username или you@example.com';
      }
      if (usernameLabel?.firstChild?.nodeType === 3) usernameLabel.firstChild.textContent = signup ? 'Логин' : 'Логин или почта';
      if (usernameHint) usernameHint.textContent = signup ? '3–32 · a–z, 0–9, _ и -' : 'Почта — если уже привязана к аккаунту';
      forgotten.classList.toggle('hidden', signup || view !== 'login');
    }
    function setView(next) {
      view = next;
      const normal = next === 'login';
      panel.dataset.authView = next;
      ordinaryForm.classList.toggle('hidden', !normal);
      tabs?.classList.toggle('hidden', !normal);
      providerArea.classList.toggle('hidden', !normal);
      alternative.classList.toggle('hidden', normal);
      for (const form of alternative.querySelectorAll('[data-auth-view]')) form.classList.toggle('hidden', form.dataset.authView !== next);
      if (heading) {
        const signup = tabs?.querySelector('[data-auth-mode="signup"]')?.classList.contains('active');
        heading.textContent = normal ? (signup ? 'Создать страницу' : 'Войти') : ({ recover: 'Восстановить доступ', reset: 'Новый пароль', complete: 'Твоя страница' }[next] || 'Войти');
      }
      updateOrdinaryFields(tabs?.querySelector('[data-auth-mode="signup"]')?.classList.contains('active') ? 'signup' : 'login');
      notifyFlow();
      if (!normal) requestAnimationFrame(() => { if (!disposed && view === next) alternative.querySelector(`[data-auth-view="${next}"] input`)?.focus(); });
    }
    async function post(path, body) {
      return api(`/api/builder/auth/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
    }
    async function run(task, statusNode) {
      if (localBusy || ordinaryBusy) return;
      localBusy = true;
      updateBusy();
      try { await task(); }
      catch (error) { if (!disposed) notice(statusNode, messageFor(error), 'error'); }
      finally { localBusy = false; if (!disposed) updateBusy(); }
    }
    async function authenticated(data) {
      if (handleAuthResult(data)) return;
      if (!data?.user?.username) throw new Error('Не удалось получить аккаунт. Войди ещё раз.');
      sessionFlow = '';
      setView('login');
      await options.onAuthenticated?.(data.user);
    }
    function navigateOAuth(url, provider, link = false) {
      const target = new URL(url);
      const backendOrigin = new URL(window.IWTXZ_BACKEND_CONFIG?.url).origin;
      const providerTarget = link && (
        (provider === 'google' && target.origin === 'https://accounts.google.com' && /^\/o\/oauth2\/(?:v2\/)?auth$/.test(target.pathname)) ||
        (provider === 'discord' && target.origin === 'https://discord.com' && ['/oauth2/authorize', '/api/oauth2/authorize'].includes(target.pathname))
      );
      if (target.protocol !== 'https:' || (!providerTarget && target.origin !== backendOrigin) || target.username || target.password) throw new Error('Сервис вернул неверную ссылку для входа.');
      window.location.assign(target.href);
    }

    for (const button of providerArea.querySelectorAll('[data-auth-provider]')) button.addEventListener('click', () => void run(async () => {
      notice($('#authStatus'), 'Открываем вход…');
      const result = await post('oauth', { provider: button.dataset.authProvider });
      navigateOAuth(result.url, button.dataset.authProvider);
    }, $('#authStatus')));
    forgotten.addEventListener('click', () => {
      const entered = username?.value.trim() || '';
      if (entered.includes('@')) $('#recoveryEmail').value = entered;
      notice($('[data-auth-status="recover"]'));
      setView('recover');
    });
    for (const button of panel.querySelectorAll('[data-auth-mode]')) button.addEventListener('click', () => {
      if (view === 'login') updateOrdinaryFields(button.dataset.authMode);
    });
    alternative.querySelector('.auth-back').addEventListener('click', () => void run(async () => {
      if (sessionFlow) await post('logout');
      sessionFlow = '';
      for (const form of alternative.querySelectorAll('form')) form.reset();
      setView('login');
      notice($('#authStatus'));
      username?.focus();
    }, alternative.querySelector(`[data-auth-status="${view}"]`)));
    $('[data-auth-view="recover"]').addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        const status = $('[data-auth-status="recover"]');
        notice(status, 'Отправляем…');
        await post('recover', { email: $('#recoveryEmail').value.trim() });
        notice(status, 'Если почта привязана к аккаунту, на неё придёт ссылка. Проверь также спам.', 'success');
      }, $('[data-auth-status="recover"]'));
    });
    $('[data-auth-view="reset"]').addEventListener('submit', event => {
      event.preventDefault();
      const status = $('[data-auth-status="reset"]');
      if ($('#recoveryPassword').value !== $('#recoveryPasswordRepeat').value) { notice(status, 'Пароли не совпадают.', 'error'); return; }
      void run(async () => {
        notice(status, 'Сохраняем пароль…');
        const result = await post('recovery-password', { newPassword: $('#recoveryPassword').value });
        $('#recoveryPassword').value = ''; $('#recoveryPasswordRepeat').value = '';
        await authenticated(result);
      }, status);
    });
    $('[data-auth-view="complete"]').addEventListener('submit', event => {
      event.preventDefault();
      const status = $('[data-auth-status="complete"]');
      void run(async () => {
        notice(status, 'Создаём страницу…');
        await authenticated(await post('complete', { username: $('#oauthUsername').value.trim().toLowerCase() }));
      }, status);
    });

    function renderAccount(next) {
      account = next;
      const email = typeof next.email === 'string' ? next.email : '';
      const pending = typeof next.pendingEmail === 'string' ? next.pendingEmail : '';
      const linked = Array.isArray(next.providers) ? next.providers : [];
      const state = accountElement('#accountEmailState');
      state.textContent = email ? `${email}${next.emailVerified ? ' · подтверждена' : ' · не подтверждена'}` : 'Пока не привязана';
      accountElement('#accountEmailLabel').textContent = email ? 'Изменить почту' : 'Привязать почту';
      const pendingNode = accountElement('#accountEmailPending');
      pendingNode.classList.toggle('hidden', !pending);
      pendingNode.textContent = pending ? `Ждёт подтверждения: ${pending}. Открой письмо по этому адресу.` : '';
      accountElement('#saveAccountEmail').textContent = pending ? 'Отправить другое подтверждение' : 'Отправить подтверждение';
      for (const provider of ['google', 'discord']) {
        const connected = linked.includes(provider);
        accountElement(`#${provider}IdentityState`).textContent = connected ? 'Привязан' : 'Не привязан';
        const button = accountElement(`[data-link-provider="${provider}"]`);
        button.textContent = connected ? 'Подключён' : 'Привязать';
        button.setAttribute('aria-label', `${connected ? 'Подключён' : 'Привязать'} ${provider === 'google' ? 'Google' : 'Discord'}`);
      }
      if (typeof next.hasPassword === 'boolean') {
        passwordForm?.classList.toggle('hidden', !next.hasPassword);
        accountElement('.auth-password-note').classList.toggle('hidden', next.hasPassword);
        accountElement('#createAccountPassword').classList.toggle('hidden', !email);
      }
      updateBusy();
    }
    async function refreshAccount() {
      const version = ++accountVersion;
      if (!currentUser) return;
      notice(accountElement('#accountIdentityStatus'));
      try {
        const result = await api('/api/builder/auth/account');
        if (!disposed && currentUser && version === accountVersion) renderAccount(result);
      } catch (error) {
        if (!disposed && currentUser && version === accountVersion) {
          accountElement('#accountEmailState').textContent = 'Не удалось загрузить данные';
          notice(accountElement('#accountIdentityStatus'), messageFor(error), 'error');
        }
      }
    }
    accountElement('#refreshAccountIdentity').addEventListener('click', () => void run(refreshAccount, accountElement('#accountIdentityStatus')));
    accountElement('#accountEmailForm').addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        const status = accountElement('#accountEmailStatus');
        notice(status, 'Отправляем подтверждение…');
        const result = await post('email', { email: accountElement('#accountEmail').value.trim() });
        if (!currentUser) return;
        renderAccount(result);
        accountElement('#accountEmail').value = '';
        notice(status, 'Проверь почту и открой ссылку в письме. Если подтверждение запрошено на старую почту, подтверди и там.', 'success');
      }, accountElement('#accountEmailStatus'));
    });
    for (const button of identityGroup.querySelectorAll('[data-link-provider]')) button.addEventListener('click', () => void run(async () => {
      if (!currentUser) return;
      notice(accountElement('#accountIdentityStatus'), 'Открываем привязку…');
      const result = await post('oauth', { provider: button.dataset.linkProvider, link: true });
      navigateOAuth(result.url, button.dataset.linkProvider, true);
    }, accountElement('#accountIdentityStatus')));
    accountElement('#createAccountPassword').addEventListener('click', () => void run(async () => {
      if (!currentUser || !account?.email) return;
      const status = accountElement('#createAccountPasswordStatus');
      notice(status, 'Отправляем ссылку…');
      await post('recover', { email: account.email });
      notice(status, 'Проверь почту. По ссылке можно создать пароль.', 'success');
    }, accountElement('#createAccountPasswordStatus')));

    function handleAuthResult(data) {
      if (data?.recoveryRequired) {
        sessionFlow = 'recovery';
        document.body.classList.add('auth-locked');
        setView('reset');
        return true;
      }
      if (data?.needsUsername) {
        sessionFlow = 'complete';
        document.body.classList.add('auth-locked');
        setView('complete');
        return true;
      }
      if (data?.emailConfirmed) notice($('#authStatus'), 'Почта подтверждена. Можно войти в аккаунт.', 'success');
      return false;
    }
    function reset() {
      ++accountVersion;
      currentUser = null;
      account = null;
      sessionFlow = '';
      for (const form of alternative.querySelectorAll('form')) form.reset();
      accountElement('#accountEmailForm').reset();
      for (const node of identityGroup.querySelectorAll('.status')) notice(node);
      accountElement('#accountEmailState').textContent = 'Войди в аккаунт';
      accountElement('#accountEmailPending').textContent = '';
      accountElement('#accountEmailPending').classList.add('hidden');
      for (const provider of ['google', 'discord']) accountElement(`#${provider}IdentityState`).textContent = 'Не привязан';
      passwordForm?.classList.remove('hidden');
      accountElement('.auth-password-note').classList.add('hidden');
      setView('login');
      updateBusy();
    }
    async function setAccount(user) {
      ++accountVersion;
      currentUser = user || null;
      if (!currentUser) { reset(); return; }
      sessionFlow = '';
      accountElement('#accountEmailState').textContent = 'Загружаем…';
      updateBusy();
      await refreshAccount();
    }
    const onAuthChange = event => {
      if (event.detail?.event === 'USER_UPDATED' && currentUser && !localBusy) void refreshAccount();
    };
    window.addEventListener('iwtxz-auth-change', onAuthChange);
    updateOrdinaryFields(tabs?.querySelector('[data-auth-mode="signup"]')?.classList.contains('active') ? 'signup' : 'login');
    updateBusy();
    const instance = Object.freeze({
      handleAuthResult, setAccount, reset, refreshAccount,
      setOrdinaryBusy(value) { ordinaryBusy = Boolean(value); updateBusy(); },
      isBusy: () => localBusy || ordinaryBusy,
      isFlowActive: () => view !== 'login',
      dispose() { disposed = true; ++accountVersion; window.removeEventListener('iwtxz-auth-change', onAuthChange); }
    });
    panel.iwtxzAuthUi = instance;
    return instance;
  }

  window.IwtxzAuthUi = Object.freeze({ create });
})();
