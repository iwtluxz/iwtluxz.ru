import { HttpError, failure, json, normalizeUsername, store } from "./lib/builder-common.mjs";

export default async (req, context = {}) => {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Используйте GET.", "method_not_allowed");
    const username = normalizeUsername(context.params?.username);
    const site = await store("builder-published").get(`profiles/${username}`);
    if (!site) throw new HttpError(404, "Страница ещё не опубликована.", "not_found");
    return json({ site });
  } catch (error) { return failure(error); }
};

export const config = { path: "/api/builder/profile/:username" };
