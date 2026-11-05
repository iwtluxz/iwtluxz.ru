// Download only verified Discord avatar-decoration assets from the checked-in catalog.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),context={window:{}};
vm.runInNewContext(await readFile(new URL('profile-decorations.js',root),'utf8'),context);
const items=context.window.IwtxzAvatarDecorations.items;
await mkdir(new URL('img/avatar-decorations/',root),{recursive:true});
let pending=[...items],downloaded=0;
async function worker(){for(let item;(item=pending.shift());){
  const file=new URL('img/avatar-decorations/'+item.id+'.png',root);
  if(await stat(file).then(info=>info.size>0).catch(()=>false))continue;
  if(!/^[a-z0-9-]{1,40}$/.test(item.id)||!/^https:\/\/cdn\.discordapp\.com\/avatar-decoration-presets\/a_[a-f0-9]{32}\.png\?size=240&passthrough=true$/.test(item.source))throw new Error('Untrusted decoration source');
  const response=await fetch(item.source,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(item.id+' '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>8_000_000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid decoration PNG '+item.id);
  await writeFile(file,bytes);downloaded++;console.log(item.id,bytes.length);
}}
await Promise.all([worker(),worker(),worker()]);
console.log('Decorations available:',items.length,'new downloads:',downloaded);
