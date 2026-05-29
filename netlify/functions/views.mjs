import { getStore } from "@netlify/blobs";

const store = getStore("profile-view-counts");
const allowedProfiles = new Set(["iwtlu", "strelokk", "shakzy", "icetearz", "eris"]);
const allowedModes = new Set(["get", "hit"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function normalizeCount(entry) {
  if (typeof entry === "number" && Number.isFinite(entry)) {
    return entry;
  }

  if (entry && typeof entry === "object" && typeof entry.value === "number") {
    return entry.value;
  }

  return 0;
}

async function readCount(key) {
  const entry = await store.get(key, {
    consistency: "strong",
    type: "json"
  });

  return normalizeCount(entry);
}

async function writeCount(key, value) {
  await store.setJSON(key, { value });
  return value;
}

export default async (_req, context) => {
  const { profile, mode } = context.params ?? {};

  if (!allowedProfiles.has(profile) || !allowedModes.has(mode)) {
    return json({ error: "not found" }, 404);
  }

  const key = `views/${profile}`;

  try {
    if (mode === "get") {
      return json({ value: await readCount(key) });
    }

    const currentValue = await readCount(key);
    const nextValue = currentValue + 1;

    await writeCount(key, nextValue);

    return json({ value: nextValue });
  } catch {
    return json({ error: "counter unavailable" }, 503);
  }
};

export const config = {
  path: "/api/views/:profile/:mode"
};
