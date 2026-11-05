import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),context={window:{}};
vm.runInNewContext(await readFile(new URL('profile-decorations.js',root),'utf8'),context);
const {items,categories}=context.window.IwtxzAvatarDecorations;

test('decoration catalog preserves old choices and every listed frame has a local PNG and small static preview',async()=>{
  assert.ok(items.length>=37);
  const ids=new Set(items.map(item=>item.id));assert.equal(ids.size,items.length);
  for(const id of ['phoenix','heartbloom','shy','sakura','moon','embers','aurora','cat'])assert.ok(ids.has(id));
  const groups=new Set(categories.map(item=>item.id));
  for(const item of items){
    assert.match(item.id,/^[a-z0-9-]{1,24}$/);assert.ok(groups.has(item.category));
    assert.match(item.source,/^https:\/\/cdn\.discordapp\.com\/avatar-decoration-presets\/a_[a-f0-9]{32}\.png\?size=240&passthrough=true$/);
    const png=await readFile(new URL(item.image.slice(1),root));assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    const preview=await readFile(new URL(item.thumbnail.slice(1),root));assert.equal(preview.toString('ascii',0,4),'RIFF');assert.equal(preview.toString('ascii',8,12),'WEBP');assert.ok(preview.length<25_000);
    for(let offset=12;offset+8<=preview.length;){const type=preview.toString('ascii',offset,offset+4),length=preview.readUInt32LE(offset+4);assert.notEqual(type,'ANIM','Picker previews must stay still: '+item.id);offset+=8+length+(length%2);}
    assert.ok((await stat(new URL(item.image.slice(1),root))).size<8_000_000);
  }
});
