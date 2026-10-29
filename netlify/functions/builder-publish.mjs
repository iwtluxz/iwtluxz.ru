import { HttpError, failure, json, normalizeSite, requireSession, safeMutation, store } from "./lib/builder-common.mjs";

export default async (req) => {
  try {
    safeMutation(req);
    const { username } = await requireSession(req);
    const saved = await store("builder-sites").get(`users/${username}/sites/${username}`);
    if (!saved) throw new HttpError(409, "Сначала сохраните настройки страницы.", "save_required");
    const site = { ...normalizeSite(saved, username), publishedAt: Date.now() };
    await store("builder-published").setJSON(`profiles/${username}`, site);
    return json({ ok: true, slug: username, url: `/u/${username}`, publishedAt: site.publishedAt });
  } catch (error) { return failure(error); }
};

export const config = { path: "/api/builder/publish" };
