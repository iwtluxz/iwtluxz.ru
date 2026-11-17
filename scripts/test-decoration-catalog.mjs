import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),context={window:{},URL};
vm.runInNewContext(await readFile(new URL('profile-decorations.js',root),'utf8'),context);
const {items,categories}=context.window.IwtxzAvatarDecorations;

test('complete merged archive preserves old choices and every listed frame has a small local still preview',async()=>{
  const manifest=JSON.parse(await readFile(new URL('data/discord-avatar-decorations.json',root),'utf8'));
  assert.equal(items.length,manifest.items.length);assert.ok(items.length>=700);
  assert.deepEqual(new Set(items.map(item=>item.asset)),new Set(manifest.items.map(item=>item.asset)));
  const ids=new Set(items.map(item=>item.id));assert.equal(ids.size,items.length);
  for(const id of ['phoenix','heartbloom','shy','sakura','moon','embers','aurora','cat'])assert.ok(ids.has(id));
  const groups=new Set(categories.map(item=>item.id));
  for(const group of categories)assert.doesNotMatch(group.label+' '+group.description,/\?{2,}/,'Collection labels must retain their original Unicode text');
  for(const item of items){
    assert.doesNotMatch(item.label,/\?{2,}/,'Decoration labels must not be encoding placeholders');
    assert.match(item.id,/^(?:[a-z0-9-]{1,24}|discord-a_[a-f0-9]{32})$/);assert.ok(groups.has(item.category));
    assert.match(item.source,/^https:\/\/cdn\.discordapp\.com\/avatar-decoration-presets\/a_[a-f0-9]{32}\.png\?size=240&passthrough=true$/);
    if(item.id.startsWith('discord-'))assert.equal(item.image,item.source);
    else{const png=await readFile(new URL(item.image.slice(1),root));assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));assert.ok((await stat(new URL(item.image.slice(1),root))).size<8_000_000);}
    const preview=await readFile(new URL(item.thumbnail.slice(1),root));assert.equal(preview.toString('ascii',0,4),'RIFF');assert.equal(preview.toString('ascii',8,12),'WEBP');assert.ok(preview.length<128_000);
    for(let offset=12;offset+8<=preview.length;){const type=preview.toString('ascii',offset,offset+4),length=preview.readUInt32LE(offset+4);assert.notEqual(type,'ANIM','Picker previews must stay still: '+item.id);offset+=8+length+(length%2);}
  }
});

test('adding a missing original decoration accepts only the exact Discord asset path',()=>{
  const {parseDiscordSource,validChoice}=context.window.IwtxzAvatarDecorations;
  const asset='a_'+('9'.repeat(32)),id='discord-'+asset;
  assert.equal(parseDiscordSource('https://cdn.discordapp.com/avatar-decoration-presets/'+asset+'.png?size=240&passthrough=true'),id);
  assert.equal(parseDiscordSource('https://cdn.discordapp.com/avatar-decoration-presets/'+asset+'.webp'),id);
  assert.equal(parseDiscordSource(id),id);assert.equal(validChoice(id),true);
  for(const value of ['https://cdn.discordapp.com.attacker.test/avatar-decoration-presets/'+asset+'.png','https://user:pass@cdn.discordapp.com/avatar-decoration-presets/'+asset+'.png','http://cdn.discordapp.com/avatar-decoration-presets/'+asset+'.png','https://cdn.discordapp.com:8443/avatar-decoration-presets/'+asset+'.png','https://cdn.discordapp.com/attachments/'+asset+'.png','javascript:alert(1)','../sakura',{},null])assert.equal(parseDiscordSource(value),'');
  assert.equal(validChoice('discord-a_../path'),false);
});

test('new and unknown original frames render safely, fall back once and remain visible with reduced motion',async()=>{
  const source=await readFile(new URL('profile-features.js',root),'utf8');
  function fixture(reduced=false){let art;const window={parent:null,matchMedia:()=>({matches:reduced}),IwtxzAvatarDecorations:context.window.IwtxzAvatarDecorations};window.parent=window;
    const document={readyState:'complete',querySelector:()=>({}),createElement:()=>({tagName:'IMG',dataset:{},listeners:{},setAttribute(){},getAttribute(key){return this[key];},removeAttribute(key){delete this[key];},addEventListener(key,value){this.listeners[key]=value;}})};
    vm.runInNewContext(source,{window,document,URL,URLSearchParams,location:{search:''},setInterval(){},clearInterval(){}});
    const frame={querySelector:()=>art,append:value=>{art=value;}};return{api:window.IwtxzProfileFeatures,avatar:{tagName:'IMG',hidden:false,closest:()=>frame},art:()=>art};
  }
  const item=items.find(item=>item.id.startsWith('discord-')),normal=fixture();normal.api.applyAvatarDecoration(normal.avatar,item.id);let art=normal.art();assert.equal(art.src,item.source);assert.equal(art.hidden,false);
  art.listeners.error();assert.equal(art.src,item.thumbnail);assert.equal(art.hidden,false);normal.api.applyAvatarDecoration(normal.avatar,item.id);assert.equal(art.src,item.thumbnail);
  art.listeners.error();assert.equal(art.hidden,true);normal.api.applyAvatarDecoration(normal.avatar,item.id);assert.equal(art.src,item.thumbnail);assert.equal(art.hidden,true);
  normal.api.applyAvatarDecoration(normal.avatar,'sakura');assert.equal(art.src,'/img/avatar-decorations/sakura.png');assert.equal(art.hidden,false);
  const still=fixture(true);still.api.applyAvatarDecoration(still.avatar,item.id);assert.equal(still.art().src,item.thumbnail);assert.equal(still.art().hidden,false);
  const unknown='discord-a_'+('9'.repeat(32));assert.equal(normal.api.decorationUrl(unknown),'https://cdn.discordapp.com/avatar-decoration-presets/a_'+('9'.repeat(32))+'.png?size=240&passthrough=true');
  assert.equal(normal.api.decorationUrl('discord-a_'+('9'.repeat(31))+'x'),'');
});
