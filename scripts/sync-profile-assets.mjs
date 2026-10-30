import { readFile, writeFile, mkdir } from "node:fs/promises";
import vm from "node:vm";
const context = { window: {} };
vm.runInNewContext(await readFile(new URL("../profile-features.js", import.meta.url), "utf8"), context);
const { socials, decorations } = context.window.IwtxzProfileFeatures;
const root = new URL("../", import.meta.url);
await mkdir(new URL("img/socials/", root), { recursive: true });
await mkdir(new URL("img/avatar-decorations/", root), { recursive: true });
const credits = ["# Original profile artwork", "", "Social logos: Simple Icons (CC0), recolored white. Brand names and trademarks belong to their owners.", "Avatar decorations: unmodified public Discord CDN artwork; this changes site presentation, not Discord account entitlements.", "", "| Asset | Source |", "| --- | --- |"];
for (const network of socials) {
  if (!network.slug) {
    await writeFile(new URL(`img/socials/${network.id}.svg`, root), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/></svg>');
    continue;
  }
  let svg, source;
  for (const candidate of [`https://cdn.simpleicons.org/${network.slug}/ffffff`, `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${network.slug}.svg`, `https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/${network.slug}.svg`]) {
    source = candidate;
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
      if (response.ok) { svg = await response.text(); break; }
    } catch {}
  }
  if (!svg?.includes("<svg") || /<script|<foreignObject/i.test(svg)) throw new Error(`Invalid original logo: ${network.id}`);
  await writeFile(new URL(`img/socials/${network.id}.svg`, root), svg.replace(/<svg\b[^>]*>/, tag => /\bfill=/.test(tag) ? tag.replace(/\bfill="[^"]*"/, 'fill="#fff"') : tag.replace("<svg ", '<svg fill="#fff" ')));
  credits.push(`| ${network.id}.svg | ${source} |`);
  console.log(`Logo: ${network.label}`);
}
await Promise.all(decorations.map(async item => {
  const source = `https://cdn.discordapp.com/avatar-decoration-presets/${item.asset}.png?size=240&passthrough=true`;
  const response = await fetch(source, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Discord artwork unavailable: ${item.id}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Invalid decoration: ${item.id}`);
  await writeFile(new URL(`img/avatar-decorations/${item.id}.png`, root), bytes);
  credits.push(`| ${item.id}.png | ${source} |`);
  console.log(`Decoration: ${item.label} (${Math.round(bytes.length / 1024)} KB)`);
}));
await writeFile(new URL("img/PROFILE-ASSETS.md", root), credits.join("\n") + "\n");
