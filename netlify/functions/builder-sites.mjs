import { HttpError, failure, json, normalizeSite, ownDraft, readJson, requireSession, safeMutation, store, withPublication } from "./lib/builder-common.mjs";

export default async (req, context = {}) => {
  try {
    const { username } = await requireSession(req);
    const mode = context.params?.mode;
    const key = `users/${username}/sites/${username}`;
    if (mode === "list" || mode === "get") {
      if (req.method !== "GET") throw new HttpError(405, "Используйте GET.", "method_not_allowed");
      const requested = new URL(req.url).searchParams.get("id");
      if (mode === "get" && requested && requested !== username) throw new HttpError(404, "Страница не найдена.", "not_found");
      const site = await withPublication(await ownDraft(username));
      return json(mode === "list" ? { sites: [site] } : { site });
    }
    safeMutation(req);
    if (mode === "save") {
      const body = await readJson(req);
      const input = body.site ?? body;
      if ((input.owner && input.owner !== username) || (input.id && input.id !== username)) throw new HttpError(403, "Можно изменять только свою страницу.", "forbidden");
      const site = normalizeSite(input, username);
      await store("builder-sites").setJSON(key, site);
      return json({ site: await withPublication(site) });
    }
    if (mode === "delete") {
      const body = await readJson(req);
      if ((body.owner && body.owner !== username) || (body.id && body.id !== username)) throw new HttpError(403, "Можно удалить только свою страницу.", "forbidden");
      await store("builder-sites").delete(key);
      await store("builder-published").delete(`profiles/${username}`);
      return json({ ok: true });
    }
    throw new HttpError(404, "Страница не найдена.", "not_found");
  } catch (error) { return failure(error); }
};

export const config = { path: "/api/builder/sites/:mode" };
