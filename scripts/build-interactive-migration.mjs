import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8');
const definitions=['private.profile_default','private.profile_normalize','public.builder_capabilities'].map(name=>{
  const match=source.match(new RegExp('create or replace function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\n\\$\\$;'));
  if(!match)throw new Error('Missing function '+name);return match[0];
});
await writeFile(new URL('../supabase/migrations/20261102_interactive_profiles.sql',import.meta.url),
  '-- Interactive backgrounds, cursors, favicon, tilt and avatar fit.\n-- Existing drafts/publications are retained. Safe to apply again in Supabase SQL Editor.\nbegin;\n\n'+definitions.join('\n\n')+'\n\nrevoke all on function private.profile_default(text),private.profile_normalize(jsonb,text,uuid) from public,anon,authenticated;\nrevoke all on function public.builder_capabilities() from public;\ngrant execute on function public.builder_capabilities() to anon,authenticated;\ncommit;\n');
console.log('Interactive profiles migration prepared.');
