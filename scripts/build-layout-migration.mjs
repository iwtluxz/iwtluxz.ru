import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8');
const definitions=['private.profile_default','private.profile_normalize','public.builder_capabilities'].map(name=>{
 const match=source.match(new RegExp('create or replace function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\n\\$\\$;'));if(!match)throw new Error(name);return match[0];
});
await writeFile(new URL('../supabase/migrations/20261102_profile_layout_controls.sql',import.meta.url),'-- Profile scale, nickname size and copy-hint visibility.\n-- Does not rewrite saved drafts or publications; safe to apply again.\nbegin;\n\n'+definitions.join('\n\n')+'\n\nrevoke all on function private.profile_default(text),private.profile_normalize(jsonb,text,uuid) from public,anon,authenticated;\nrevoke all on function public.builder_capabilities() from public;\ngrant execute on function public.builder_capabilities() to anon,authenticated;\ncommit;\n');
