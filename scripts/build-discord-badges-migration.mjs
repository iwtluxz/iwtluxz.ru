import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../',import.meta.url),context={window:{}};
vm.runInNewContext(await readFile(new URL('discord-badges.js',root),'utf8'),context);
const ids=context.window.IwtxzDiscordBadges.items.map(item=>item.id);
if(ids.some(id=>!/^[a-z0-9-]+$/.test(id))||new Set(ids).size!==ids.length)throw new Error('Invalid Discord badge catalog');
const helper=`create or replace function private.profile_discord_badges(input jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare item jsonb; result jsonb := '[]'::jsonb;
begin
  if input is null or jsonb_typeof(input) <> 'array' then
    raise exception using errcode='22023',message='Значки Discord должны быть списком.';
  end if;
  if jsonb_array_length(input) > 32 then
    raise exception using errcode='22023',message='Можно выбрать до 32 значков Discord.';
  end if;
  for item in select * from jsonb_array_elements(input) loop
    if jsonb_typeof(item) <> 'string' or (item #>> '{}') not in (${ids.map(id=>`'${id}'`).join(',')}) then
      raise exception using errcode='22023',message='Неизвестный значок Discord.';
    end if;
    if not result @> jsonb_build_array(item) then result := result || jsonb_build_array(item); end if;
  end loop;
  return result;
end;
$$;`;
let source=await readFile(new URL('supabase/setup.sql',root),'utf8');
const definition=name=>new RegExp('create or replace function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\n\\$\\$;');
if(source.includes('function private.profile_discord_badges('))source=source.replace(/create or replace function private\.profile_discord_badges\([\s\S]*?(?=create or replace function private\.profile_normalize\()/,()=>helper+'\n\n');
else source=source.replace('create or replace function private.profile_normalize(',()=>helper+'\n\ncreate or replace function private.profile_normalize(');
source=source.replace(definition('private.profile_default'),block=>block.includes("'discordBadges'")?block:block.replace('  return result;',`  result := result || jsonb_build_object('discordBadges', case
    when username='iwtlu' then '["nitro","house-bravery","server-booster","active-developer"]'::jsonb
    when username in ('shakzy','strelokk') then '["nitro","house-bravery"]'::jsonb
    else '[]'::jsonb end);
  return result;`));
source=source.replace(definition('private.profile_normalize'),block=>block.includes("'discordBadges'")?block:block.replace('  return result || jsonb_build_object(',`  result := result || jsonb_build_object('discordBadges',private.profile_discord_badges(coalesce(input->'discordBadges',defaults->'discordBadges','[]'::jsonb)));
  return result || jsonb_build_object(`));
source=source.replace(definition('public.builder_capabilities'),block=>block.includes("'discordBadges'")?block:block.replace("'editorV2',true","'editorV2',true,'discordBadges',true"));
if(!source.includes('revoke all on function private.profile_discord_badges(jsonb)'))source=source.replace("notify pgrst, 'reload schema';","revoke all on function private.profile_discord_badges(jsonb) from public,anon,authenticated;\n\nnotify pgrst, 'reload schema';");
await writeFile(new URL('supabase/setup.sql',root),source);
const names=['private.profile_discord_badges','private.profile_default','private.profile_normalize','public.builder_capabilities'];
const definitions=names.map(name=>{const found=source.match(definition(name));if(!found)throw new Error(name);return found[0];});
await writeFile(new URL('supabase/migrations/20261108_discord_badge_catalog.sql',root),
  '-- Original Discord badge selections. Existing profiles and publications are not rewritten.\n-- Safe to apply again; preserves the current editor and auth migration.\nbegin;\n\n'+definitions.join('\n\n')+'\n\nrevoke all on function private.profile_discord_badges(jsonb),private.profile_default(text),private.profile_normalize(jsonb,text,uuid) from public,anon,authenticated;\nrevoke all on function public.builder_capabilities() from public;\ngrant execute on function public.builder_capabilities() to anon,authenticated;\nnotify pgrst, \'reload schema\';\ncommit;\n');
console.log(`Discord badge SQL generated for ${ids.length} original icons.`);
