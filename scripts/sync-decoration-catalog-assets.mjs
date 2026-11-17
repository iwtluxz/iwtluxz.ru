// Cache small still catalogue previews. Original animations are fetched only for legacy local frames.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),context={window:{}};
vm.runInNewContext(await readFile(new URL('profile-decorations.js',root),'utf8'),context);
const items=context.window.IwtxzAvatarDecorations.items;
await mkdir(new URL('img/avatar-decorations/',root),{recursive:true});
const pending=[...items],errors=[];let downloaded=0;
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
async function bytesFrom(url,max){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  if(Number(response.headers.get('content-length'))>max)throw new Error('Decoration exceeds size limit');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max)throw new Error('Decoration exceeds size limit');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
async function worker(){for(let item;(item=pending.shift());){
  try{
    if(!/^(?:[a-z0-9-]{1,24}|discord-a_[a-f0-9]{32})$/.test(item.id)||!/^https:\/\/cdn\.discordapp\.com\/avatar-decoration-presets\/a_[a-f0-9]{32}\.png\?size=240&passthrough=true$/.test(item.source))throw new Error('Untrusted decoration source');
    const preview=new URL(item.thumbnail.slice(1),root);
    if(!await stat(preview).then(info=>info.size>0).catch(()=>false)){
      const data=await bytesFrom(`https://cdn.discordapp.com/avatar-decoration-presets/${item.asset}.webp?size=128&passthrough=true`,128_000);
      if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP')throw new Error('Invalid preview WebP');
      for(let offset=12;offset+8<=data.length;){const type=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4);if(type==='ANIM'||type==='ANMF')throw new Error('Animated catalogue preview');offset+=8+length+(length%2);}
      await writeFile(preview,data);downloaded++;
    }
    if(!item.id.startsWith('discord-')){
      const file=new URL(item.image.slice(1),root);
      if(!await stat(file).then(info=>info.size>0).catch(()=>false)){
        const data=await bytesFrom(item.source,8_000_000);if(!data.subarray(0,8).equals(signature))throw new Error('Invalid decoration PNG');await writeFile(file,data);
      }
    }
  }catch(error){errors.push(item.id+': '+error.message);}
  if(pending.length%100===0)console.log('Previews remaining:',pending.length);
}}
await Promise.all(Array.from({length:8},worker));
console.log('Decorations:',items.length,'new previews:',downloaded,'errors:',errors.length);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
