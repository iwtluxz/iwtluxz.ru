import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context={window:{}};
vm.runInNewContext(await readFile(new URL('../discord-badges.js',import.meta.url),'utf8'),context);
const catalog=context.window.IwtxzDiscordBadges;

test('Discord badge catalog includes old awards and complete current milestone families',()=>{
  assert.equal(catalog.items.length,100);
  assert.equal(new Set(catalog.items.map(item=>item.id)).size,catalog.items.length);
  assert.ok(Object.isFrozen(catalog.items));
  const count=group=>catalog.items.filter(item=>item.group===group).length;
  assert.equal(count('streaming'),10);
  assert.equal(count('account-age'),10);
  assert.equal(count('game-time'),10);
  assert.equal(count('game-variety'),10);
  assert.equal(count('gifting'),6);
  for(const id of ['nitro','nitro-current','nitro-basic','nitro-bronze','nitro-opal','nitro-legacy-fire','server-booster-24','quest','orbs','legacy-username','last-meadow','active-developer','house-bravery','verified-bot'])assert.ok(catalog.byId[id],id);
  assert.equal(catalog.byId['streaming-newcomer'].automatic,false);
  assert.equal(catalog.byId['nitro-opal'].automatic,false);
  assert.equal(catalog.byId['staff'].automatic,true);
});

test('manual badge normalization accepts only catalog IDs, deduplicates, and limits count',()=>{
  for(const input of [null,{},'nitro',32])assert.deepEqual(Array.from(catalog.normalize(input)),[]);
  assert.deepEqual(Array.from(catalog.normalize(['nitro','nitro',null,{},'__proto__','constructor','unknown','streaming-newcomer'])),['nitro','streaming-newcomer']);
  assert.equal(catalog.normalize(catalog.items.map(item=>item.id)).length,32);
  assert.equal(catalog.maximum,32);
  assert.ok(Object.isFrozen(catalog.byId));
});

test('every Discord badge has a local original PNG or passive SVG with bounded file size',async()=>{
  const groups=new Set(catalog.groups.map(group=>group.id));
  let total=0;
  for(const item of catalog.items){
    assert.match(item.id,/^[a-z0-9][a-z0-9-]*$/);
    assert.match(item.image,/^\/img\/discord-badges\/[a-z0-9-]+\.(png|svg)$/);
    assert.ok(groups.has(item.group));
    assert.equal(catalog.byId[item.id],item);
    assert.ok(item.label.length>0);
    assert.ok(item.keywords.length>0);
    const bytes=await readFile(new URL('..'+item.image,import.meta.url));
    assert.ok(bytes.length>80&&bytes.length<128*1024,item.id);
    total+=bytes.length;
    if(item.image.endsWith('.png'))assert.deepEqual(Array.from(bytes.subarray(0,8)),[137,80,78,71,13,10,26,10]);
    else{
      const svg=bytes.toString('utf8');
      assert.match(svg,/<svg[\s>]/);
      assert.doesNotMatch(svg,/<script|\s+on\w+\s*=|javascript:|<foreignObject|(?:xlink:)?href\s*=|<image/i,item.id);
    }
  }
  assert.ok(total<600*1024,'badge library remains small');
});
