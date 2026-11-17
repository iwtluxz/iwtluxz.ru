import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
let migration=(await readFile(new URL('supabase/migrations/20261117_profile_views_and_appearance.sql',root),'utf8')).replaceAll('\r\n','\n');
migration=migration.replace('-- Profile views, description color and Discord badge limit. Existing profiles are not rewritten.', '-- Expanded Discord decoration catalog, description gradients and movable profile views.\n-- Existing settings, published pages and view totals are preserved.');
migration=migration.replace("'descriptionColor','','showProfileViews',false,'discordBadgeLimit',6);", "'descriptionColor','','showProfileViews',false,'discordBadgeLimit',6,\n    'descriptionGradient',false,'descriptionGradientAnimated',false,'descriptionGradientStart','#ffffff',\n    'descriptionGradientEnd','#8b5cf6','descriptionGradientAngle',90,'descriptionGradientSpeed',6,\n    'profileViewsStyle','text','profileViewsSize',12,'profileViewsColor','#b6b4bd');");
migration=migration.replace("private.profile_text(input, 'avatarDecoration', 'none', 24)","private.profile_text(input, 'avatarDecoration', 'none', 48)");
migration=migration.replace(/(if value not in \('none','discord','phoenix'[^\n]+\)) then/,(_,condition)=>condition+" and value !~ '^discord-a_[a-f0-9]{32}$' then");
migration=migration.replace("'player','typewriter')","'player','typewriter','views')");
const additions=`  foreach value in array array['descriptionGradient','descriptionGradientAnimated'] loop
    result := result || jsonb_build_object(value,private.profile_boolean(input,value,false));
  end loop;
  for item in select * from (values ('descriptionGradientStart','#ffffff'),('descriptionGradientEnd','#8b5cf6'),('profileViewsColor','#b6b4bd')) as colors(key,fallback) loop
    value := private.profile_text(input,item.key,item.fallback,7);
    if value !~ '^#[a-fA-F0-9]{6}$' then raise exception using errcode='22023',message='Некорректный цвет.'; end if;
    result := result || jsonb_build_object(item.key,lower(value));
  end loop;
  value := private.profile_text(input,'profileViewsStyle','text',12);
  if value not in ('text','eye') then raise exception using errcode='22023',message='Неизвестный вид счётчика просмотров.'; end if;
  result := result || jsonb_build_object('profileViewsStyle',value,
    'profileViewsSize',private.profile_number(input,'profileViewsSize',12,10,24),
    'descriptionGradientAngle',private.profile_number(input,'descriptionGradientAngle',90,0,360),
    'descriptionGradientSpeed',private.profile_number(input,'descriptionGradientSpeed',6,2,30));
`;
migration=migration.replace("  value := private.profile_text(input,'backgroundEffect','none',16);",()=>additions+"  value := private.profile_text(input,'backgroundEffect','none',16);");
migration=migration.replace("'profileViewSettings',true)","'profileViewSettings',true,'profileCatalogLayout',true)");
migration=migration.replace("message='???????????? ???? ????????.'","message='Некорректный цвет описания.'");
for(const marker of ["'profileCatalogLayout',true","^discord-a_[a-f0-9]{32}$","'typewriter','views'","'descriptionGradientSpeed',6,2,30)"])if(!migration.includes(marker))throw Error('Missing migration edit '+marker);
await writeFile(new URL('supabase/migrations/20261117_profile_catalog_and_layout.sql',root),migration);
let setup=(await readFile(new URL('supabase/setup.sql',root),'utf8')).replaceAll('\r\n','\n');
for(const name of ['private.profile_default','private.profile_normalize','public.builder_capabilities']){
 const expression=new RegExp('create or replace function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\n\\$\\$;');
 const definition=migration.match(expression)?.[0];if(!definition||!expression.test(setup))throw Error(name);
 setup=setup.replace(expression,()=>definition);
}
const viewDdl=migration.slice(migration.indexOf('create table if not exists private.profile_view_totals'),migration.indexOf("notify pgrst, 'reload schema';"));
if(!setup.includes('create table if not exists private.profile_view_totals'))setup+='\n-- Optional per-profile view counter.\n'+viewDdl;
await writeFile(new URL('supabase/setup.sql',root),setup);
console.log('Catalog, gradient and movable views migration generated.');
