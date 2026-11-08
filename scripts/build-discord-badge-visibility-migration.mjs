import {readFile,writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
let source=await readFile(new URL('supabase/setup.sql',root),'utf8');
const definition=name=>new RegExp('create or replace function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\n\\$\\$;');
source=source.replace(definition('private.profile_default'),block=>block.includes("'discordHiddenBadges'")?block:block.replace('  return result;',()=>"  result := result || jsonb_build_object('discordHiddenBadges','[]'::jsonb);\n  return result;"));
source=source.replace(definition('private.profile_normalize'),block=>block.includes("'discordHiddenBadges'")?block:block.replace('  return result || jsonb_build_object(',()=>"  result := result || jsonb_build_object('discordHiddenBadges',private.profile_discord_badges(coalesce(input->'discordHiddenBadges',defaults->'discordHiddenBadges','[]'::jsonb)));\n  return result || jsonb_build_object("));
source=source.replace(definition('public.builder_capabilities'),block=>block.includes("'discordBadgeVisibility'")?block:block.replace("'discordBadges',true",()=>"'discordBadges',true,'discordBadgeVisibility',true"));
await writeFile(new URL('supabase/setup.sql',root),source);
const names=['private.profile_default','private.profile_normalize','public.builder_capabilities'];
const definitions=names.map(name=>{const found=source.match(definition(name));if(!found)throw new Error(name);return found[0];});
await writeFile(new URL('supabase/migrations/20261108_discord_badge_visibility.sql',root),
  '-- Per-badge visibility for badges received from Discord. Existing profiles are not rewritten.\n'+
  '-- Apply after 20261108_discord_badge_catalog.sql. Safe to apply again.\nbegin;\n\n'+
  "do $$ begin\n  if to_regprocedure('private.profile_discord_badges(jsonb)') is null then\n    raise exception 'Apply 20261108_discord_badge_catalog.sql before this migration.';\n  end if;\nend $$;\n\n"+
  definitions.join('\n\n')+
  '\n\nrevoke all on function private.profile_default(text),private.profile_normalize(jsonb,text,uuid) from public,anon,authenticated;\nrevoke all on function public.builder_capabilities() from public;\ngrant execute on function public.builder_capabilities() to anon,authenticated;\nnotify pgrst, \'reload schema\';\ncommit;\n');
console.log('Discord badge visibility SQL generated. Existing profiles remain unchanged.');
