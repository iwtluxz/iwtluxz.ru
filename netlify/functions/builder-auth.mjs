import {
  HttpError, cookieHeader, createSession, failure, getSession, json, normalizeUsername,
  passwordRecord, rateLimit, readJson, requireSession, reservedUsernames, revokeSession,
  safeMutation, store, validatePassword, verifyPassword
} from "./lib/builder-common.mjs";

export default async (req, context = {}) => {
  const mode = context.params?.mode;
  try {
    if (mode === "me") {
      if (req.method !== "GET") throw new HttpError(405, "Используйте GET.", "method_not_allowed");
      const session = await getSession(req);
      return json({ user: session ? { username: session.username } : null });
    }
    if (!["signup", "login", "logout", "password"].includes(mode)) throw new HttpError(404, "Страница не найдена.", "not_found");
    safeMutation(req);
    if (mode === "logout") {
      await revokeSession(req);
      return json({ ok: true }, 200, { "set-cookie": cookieHeader(req, "", 0) });
    }
    const body = await readJson(req);
    const users = store("builder-users");
    if (mode === "password") {
      const session = await requireSession(req);
      await rateLimit(req, context, "password", 10);
      const newPassword = validatePassword(body.newPassword);
      if (typeof body.currentPassword !== "string" || body.currentPassword.length > 128 || !(await verifyPassword(body.currentPassword, session.user))) throw new HttpError(401, "Текущий пароль неверный.", "invalid_password");
      const user = { ...session.user, ...await passwordRecord(newPassword), sessionVersion: (session.user.sessionVersion ?? 0) + 1, passwordChangedAt: Date.now() };
      await users.setJSON(`users/${session.username}`, user);
      await revokeSession(req);
      const token = await createSession(user);
      return json({ ok: true, user: { username: user.username } }, 200, { "set-cookie": cookieHeader(req, token) });
    }
    await rateLimit(req, context, mode, mode === "signup" ? 10 : 30);
    const username = normalizeUsername(body.username);
    const password = mode === "signup" ? validatePassword(body.password) : String(body.password ?? "");
    if (!password || password.length > 128) throw new HttpError(400, "Введите пароль.", "invalid_password");
    const key = `users/${username}`;
    let user = await users.get(key);
    if (mode === "signup") {
      if (reservedUsernames.has(username)) throw new HttpError(409, "Этот логин закреплён за существующим профилем. Выберите другой.", "reserved_username");
      if (user) throw new HttpError(409, "Этот логин уже занят.", "username_taken");
      user = { username, ...await passwordRecord(password), sessionVersion: 0, createdAt: Date.now() };
      const created = await users.setJSON(key, user, { onlyIfNew: true });
      if (!created.modified) throw new HttpError(409, "Этот логин уже занят.", "username_taken");
    } else {
      const ownerName = process.env.BUILDER_OWNER_USERNAME;
      const ownerPassword = process.env.BUILDER_OWNER_PASSWORD;
      let isOwner = false;
      try { isOwner = ownerName && normalizeUsername(ownerName) === username; } catch {}
      if (!user && isOwner && ownerPassword && ownerPassword.length >= 8 && ownerPassword.length <= 128 && password === ownerPassword) {
        const proposed = { username, ...await passwordRecord(password), sessionVersion: 0, createdAt: Date.now() };
        await users.setJSON(key, proposed, { onlyIfNew: true });
        user = await users.get(key);
      }
      if (!(await verifyPassword(password, user))) throw new HttpError(401, "Неверный логин или пароль.", "invalid_login");
    }
    await revokeSession(req);
    const token = await createSession(user);
    return json({ user: { username } }, mode === "signup" ? 201 : 200, { "set-cookie": cookieHeader(req, token) });
  } catch (error) { return failure(error); }
};

export const config = { path: "/api/builder/auth/:mode" };
