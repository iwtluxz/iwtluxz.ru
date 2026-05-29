import { getStore } from "@netlify/blobs";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const users = getStore("builder-users");
const sessions = getStore("builder-sessions");
const sessionCookie = "iwtxz_builder_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const autoCreateUsers = new Set(["shakzy", "strelok"]);
const sharedProfilePassword = process.env.BUILDER_SHARED_PROFILE_PASSWORD ?? "Mamapapa12.";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, decodeURIComponent(value.join("=") || "")];
    }).filter(([key]) => key)
  );
}

function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

function cookieHeader(token, maxAge = sessionMaxAgeSeconds) {
  const secure = process.env.NETLIFY_DEV ? "" : "; Secure";
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("hex") };
}

async function verifyPassword(password, user) {
  const attempt = await scrypt(password, user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return stored.length === attempt.length && timingSafeEqual(stored, attempt);
}

async function getSession(req) {
  const token = parseCookies(req.headers.get("cookie") ?? "")[sessionCookie];
  if (!token) {
    return null;
  }

  const session = await sessions.get(`sessions/${token}`, { consistency: "strong", type: "json" });
  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  return session;
}

async function createSession(username) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
  await sessions.setJSON(`sessions/${token}`, { username, expiresAt, createdAt: Date.now() });
  return token;
}

async function createUser(key, username, password) {
  const { salt, hash } = await hashPassword(password);
  await users.setJSON(key, {
    username,
    salt,
    passwordHash: hash,
    createdAt: Date.now()
  });
}

export default async (req, context) => {
  const mode = context.params?.mode;

  try {
    if (mode === "me") {
      const session = await getSession(req);
      return json({ user: session ? { username: session.username } : null });
    }

    if (mode === "logout") {
      return json({ ok: true }, 200, {
        "set-cookie": cookieHeader("", 0)
      });
    }

    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername(body.username);
    const password = String(body.password ?? "");

    if (!username || password.length < 6) {
      return json({ error: "username and 6+ char password required" }, 400);
    }

    const key = `users/${username}`;
    const existingUser = await users.get(key, { consistency: "strong", type: "json" });

    if (mode === "signup") {
      if (existingUser) {
        return json({ error: "user already exists" }, 409);
      }

      await createUser(key, username, password);

      const token = await createSession(username);
      return json({ user: { username } }, 201, {
        "set-cookie": cookieHeader(token)
      });
    }

    if (mode === "login") {
      let user = existingUser;

      if (!user && autoCreateUsers.has(username) && password === sharedProfilePassword) {
        await createUser(key, username, password);
        user = await users.get(key, { consistency: "strong", type: "json" });
      }

      if (!user || !(await verifyPassword(password, user))) {
        return json({ error: "invalid login" }, 401);
      }

      const token = await createSession(username);
      return json({ user: { username } }, 200, {
        "set-cookie": cookieHeader(token)
      });
    }

    return json({ error: "not found" }, 404);
  } catch {
    return json({ error: "auth unavailable" }, 503);
  }
};

export const config = {
  path: "/api/builder/auth/:mode"
};
