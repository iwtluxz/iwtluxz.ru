import { readFile, writeFile } from "node:fs/promises";
const source = await readFile(new URL("../supabase/setup.sql", import.meta.url), "utf8");
const names = ["private.profile_default", "private.profile_normalize", "public.builder_capabilities"];
const definitions = names.map(name => {
  const escaped = name.replaceAll(".", "\\.");
  const match = source.match(new RegExp(`create or replace function ${escaped}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!match) throw new Error(`SQL function not found: ${name}`);
  return match[0];
});
const migration = `-- Run in Supabase SQL Editor as postgres after 20261030_profile_customization.sql.
-- Adds nickname animations, original Discord avatar decorations and more social links.
-- Replaces validation/default functions only; existing profiles, publications and files are retained.
-- Safe to run again. Existing RLS policies and ownership checks remain in force.
begin;

${definitions.join("\n\n")}

revoke all on function private.profile_default(text), private.profile_normalize(jsonb,text,uuid) from public, anon, authenticated;
revoke all on function public.builder_capabilities() from public;
grant execute on function public.builder_capabilities() to anon, authenticated;
commit;
`;
await writeFile(new URL("../supabase/migrations/20261030_profile_effects_and_socials.sql", import.meta.url), migration);
console.log("Profile feature migration prepared; existing data is not rewritten.");
