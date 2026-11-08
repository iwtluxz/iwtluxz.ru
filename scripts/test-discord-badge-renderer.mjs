import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../profile-customization.js',import.meta.url),'utf8');
const catalogSource=await readFile(new URL('../discord-badges.js',import.meta.url),'utf8');
class Element {
  constructor(tagName='span') {
    this.tagName=tagName.toUpperCase();this.children=[];this.attributes=new Map();this.dataset={};this.hidden=false;
    this.style={setProperty(){}};
    this.classList={add(){},remove(){},toggle(){},contains(){return false;}};
  }
  setAttribute(key,value){this.attributes.set(key,value);}
  removeAttribute(key){this.attributes.delete(key);}
  hasAttribute(key){return this.attributes.has(key);}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
}
function fixture({badges=[],activity=null,fresh=true,member=true,matchingGuild=true,responseStatus=200,fail=false,overflow=false}={}){
  const nodes={discordBadges:new Element(),discordActivity:new Element(),discordCard:new Element(),discordName:new Element()};
  const document={documentElement:new Element(),body:new Element(),createElement:tag=>new Element(tag)};
  const guildId='123456789012345678';
  const snapshot={id:'484816707798564894',guildId:matchingGuild?guildId:'111111111111111111',member,updatedAt:Date.now()-(fresh?0:90000000),badges,activity};
  const messages=[],overflowCalls=[];
  const window={IWTXZ_BACKEND_CONFIG:{discordGuildId:guildId}};
  window.parent={postMessage:(message,origin)=>messages.push({message,origin})};
  if(overflow)window.IwtxzBadgeOverflow={render(strip,items,options){overflowCalls.push({kind:'render',items:[...items],owner:options.owner});strip.append(...items);},dispose(owner){overflowCalls.push({kind:'dispose',owner});}};
  const context=vm.createContext({window,document,location:new URL('https://example.test/'),URL,AbortSignal,
    fetch:async()=>{if(fail)throw new Error('offline');return Response.json(snapshot,{status:responseStatus});},setInterval:()=>1,clearInterval(){}});
  vm.runInContext(catalogSource,context);vm.runInContext(source,context);
  const customizer=window.IwtxzProfileCustomization.createCustomizer(nodes);
  const settings={discord:'alice',discordSync:true,discordUserId:snapshot.id};
  return{nodes,customizer,settings,messages,overflowCalls,catalog:window.IwtxzDiscordBadges};
}
const rendered=nodes=>nodes.discordBadges.children.flatMap(strip=>strip.children).map(badge=>({id:badge.dataset.discordBadgeId,title:badge.title,image:badge.children[0].src}));
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('the selected catalog list is authoritative and synchronized HypeSquad is never added automatically',async()=>{
  const {nodes,customizer,settings,messages,catalog}=fixture({badges:[{id:'house-bravery'},{id:'staff'}]});
  try{
    const selected=['nitro-opal','streaming-newcomer','orbs','nitro-opal','__proto__','not-a-badge'];
    customizer.apply({...settings,owner:'iwtlu',discordBadges:selected});
    assert.deepEqual(rendered(nodes).map(item=>item.id),selected.slice(0,3));
    await settle();
    assert.deepEqual(rendered(nodes).map(item=>item.id),selected.slice(0,3));
    assert.deepEqual(rendered(nodes).map(item=>item.image),selected.slice(0,3).map(id=>catalog.byId[id].image));
    assert.ok(rendered(nodes).every(item=>item.title.endsWith(' · значок профиля')));
    assert.ok(rendered(nodes).every(item=>!item.title.includes('получен')));
    const availability=messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1);
    assert.equal(availability.message.state,'ready');
    assert.deepEqual(Array.from(availability.message.badges,item=>item.id),['house-bravery','staff']);
  }finally{customizer.dispose();}
});

test('chosen badges render without a Discord account or sync and survive unavailable, stale and nonmember snapshots',async()=>{
  for(const options of [{},{fresh:false},{matchingGuild:false},{member:false},{responseStatus:404},{fail:true}]){
    const {nodes,customizer,settings}=fixture({...options,badges:[{id:'house-bravery'}]});
    try{
      customizer.apply({...settings,discordBadges:['nitro-opal','streaming-newcomer']});await settle();
      assert.deepEqual(rendered(nodes).map(item=>item.id),['nitro-opal','streaming-newcomer']);
      customizer.apply({discord:'',discordSync:false,discordUserId:'',discordBadges:['nitro-opal']});
      assert.deepEqual(rendered(nodes).map(item=>item.id),['nitro-opal']);
      assert.equal(nodes.discordCard.hidden,false);
      assert.equal(nodes.discordName.textContent,'Discord');
      assert.equal(nodes.discordCard.dataset.copyHint,'false');
    }finally{customizer.dispose();}
  }
});

test('individual selection, empty lists and the global switch are respected independently of old hidden lists',async()=>{
  const {nodes,customizer,settings}=fixture({badges:[{id:'house-bravery'}]});
  try{
    customizer.apply({...settings,discordBadges:['house-bravery','nitro-opal'],discordHiddenBadges:['house-bravery','nitro-opal']});await settle();
    assert.deepEqual(rendered(nodes).map(item=>item.id),['house-bravery','nitro-opal']);
    customizer.apply({...settings,discordBadges:['nitro-opal']});
    assert.deepEqual(rendered(nodes).map(item=>item.id),['nitro-opal']);
    customizer.apply({...settings,discordBadges:[]});assert.deepEqual(rendered(nodes),[]);
    customizer.apply({...settings,owner:'iwtlu'});assert.deepEqual(rendered(nodes),[]);
    customizer.apply({...settings,discordBadges:['house-bravery','nitro-opal'],discordShowBadges:false});
    assert.equal(nodes.discordBadges.hidden,true);assert.deepEqual(rendered(nodes),[]);
    customizer.apply({...settings,discordBadges:['house-bravery','nitro-opal'],discordShowBadges:true});
    assert.deepEqual(rendered(nodes).map(item=>item.id),['house-bravery','nitro-opal']);
  }finally{customizer.dispose();}
});

test('changing the synchronized Discord account cannot replace or restore deselected badge choices',async()=>{
  const {nodes,customizer,settings}=fixture({badges:[{id:'house-bravery'}]});
  try{
    customizer.apply({...settings,discordBadges:['orbs']});await settle();
    customizer.apply({...settings,discordUserId:'711225785150865428',discordBadges:['orbs']});
    assert.deepEqual(rendered(nodes).map(item=>item.id),['orbs']);await settle();
    assert.deepEqual(rendered(nodes).map(item=>item.id),['orbs']);
    customizer.apply({...settings,discordUserId:'711225785150865428',discordBadges:[]});
    assert.deepEqual(rendered(nodes),[]);
  }finally{customizer.dispose();}
});

test('overflow receives only selected badges in order and is disposed when badges or the card are hidden',async()=>{
  const {nodes,customizer,settings,catalog,overflowCalls}=fixture({badges:[{id:'house-bravery'}],overflow:true});
  try{
    const selected=Array.from(catalog.items.slice(10,18),item=>item.id);
    customizer.apply({...settings,discordBadges:selected});await settle();
    const call=overflowCalls.filter(item=>item.kind==='render').at(-1);
    assert.deepEqual(Array.from(call.items,item=>item.dataset.discordBadgeId),selected);assert.equal(call.owner,nodes.discordBadges);
    customizer.apply({...settings,discordBadges:selected,discordShowBadges:false});assert.equal(overflowCalls.at(-1).kind,'dispose');
    customizer.apply({...settings,discordBadges:selected,showDiscord:false});
    assert.equal(nodes.discordCard.hidden,true);assert.equal(overflowCalls.at(-1).kind,'dispose');
    customizer.apply({...settings,discordBadges:[]});assert.equal(overflowCalls.at(-1).kind,'dispose');
    const many=Array.from(catalog.items,item=>item.id);
    customizer.apply({...settings,discordBadges:['unknown',...many]});assert.equal(rendered(nodes).length,32);
  }finally{customizer.dispose();}
});

test('streaming activity does not change badge choices and still follows its own visibility setting',async()=>{
  const {nodes,customizer,settings}=fixture({activity:{type:1,name:'Twitch',details:'Live now'}});
  try{
    customizer.apply({...settings,discordBadges:['streaming-newcomer']});await settle();
    assert.equal(nodes.discordActivity.textContent,'В эфире · Twitch · Live now');
    assert.deepEqual(rendered(nodes).map(item=>item.id),['streaming-newcomer']);
    customizer.apply({...settings,discordShowActivity:false,discordBadges:['streaming-newcomer']});
    assert.equal(nodes.discordActivity.hidden,true);assert.deepEqual(rendered(nodes).map(item=>item.id),['streaming-newcomer']);
  }finally{customizer.dispose();}
});
