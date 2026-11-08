import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../profile-customization.js', import.meta.url), 'utf8');
class Element {
  constructor(tagName = 'span') {
    this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = new Map();
    this.style = {setProperty() {}}; this.dataset = {}; this.hidden = false;
    this.classList = {add() {},remove() {},toggle() {},contains() {return false;}};
  }
  setAttribute(key, value) {this.attributes.set(key, value);}
  removeAttribute(key) {this.attributes.delete(key);}
  hasAttribute(key) {return this.attributes.has(key);}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children;}
}
function fixture({badges = [], activity = null, fresh = true} = {}) {
  const nodes = {discordBadges:new Element(),discordActivity:new Element()};
  const document = {documentElement:new Element(),body:new Element(),createElement:tag => new Element(tag)};
  const catalog = {
    items:[
      {id:'nitro',label:'Discord Nitro',image:'/img/discord-badges/nitro.png'},
      {id:'house-bravery',label:'HypeSquad Bravery',image:'/img/discord-badges/house-bravery.png'},
      {id:'nitro-new-tier',label:'New Nitro tier',image:'/img/discord-badges/nitro.png'},
      {id:'streaming-achievement',label:'Streaming achievement',image:'/img/discord-badges/partner.png'}
    ]
  };
  const guildId = '123456789012345678';
  const snapshot = {id:'484816707798564894',guildId,member:true,updatedAt:Date.now()-(fresh?0:90000000),badges,activity};
  const window = {IWTXZ_BACKEND_CONFIG:{discordGuildId:guildId},IwtxzDiscordBadges:catalog};window.parent=window;
  vm.runInNewContext(source,{window,document,location:new URL('https://example.test/'),URL,AbortSignal,fetch:async()=>Response.json(snapshot),setInterval:()=>1,clearInterval(){}});
  const customizer=window.IwtxzProfileCustomization.createCustomizer(nodes);
  const settings={discord:'alice',discordSync:true,discordUserId:snapshot.id};
  return {nodes,customizer,settings};
}
const rendered = nodes => nodes.discordBadges.children.flatMap(strip => strip.children).map(badge=>({title:badge.title,image:badge.children[0].src}));
const settle = () => new Promise(resolve=>setImmediate(resolve));

test('expanded manual Discord artwork renders from the catalog and merges actual badges without duplicates',async()=>{
  const {nodes,customizer,settings}=fixture({badges:[{id:'house-bravery',label:'Real badge'},{id:'__proto__'},{id:'nitro-new-tier'}]});
  try{
    customizer.apply({...settings,discordBadges:['house-bravery','nitro-new-tier','streaming-achievement','streaming-achievement','javascript:bad']});
    await settle();
    const badges=rendered(nodes);
    assert.equal(badges.length,3);
    assert.match(badges[0].title,/Real badge · Discord$/);
    assert.match(badges[1].title,/New Nitro tier · Discord$/);
    assert.match(badges[2].title,/Streaming achievement · указан в оформлении карточки$/);
    assert.deepEqual(badges.map(item=>item.image),['/img/discord-badges/house-bravery.png','/img/discord-badges/nitro.png','/img/discord-badges/partner.png']);
  }finally{customizer.dispose();}
});

test('manual artwork survives disabled or unavailable sync while badge visibility hides the whole strip',async()=>{
  const {nodes,customizer,settings}=fixture({fresh:false,badges:[{id:'house-bravery'}]});
  try{
    customizer.apply({...settings,discordBadges:['nitro-new-tier']});await settle();
    assert.equal(rendered(nodes).length,1);
    assert.match(rendered(nodes)[0].title,/оформлении/);
    customizer.apply({...settings,discordSync:false,discordBadges:['nitro-new-tier']});
    assert.equal(rendered(nodes).length,1);
    customizer.apply({...settings,discordShowBadges:false,discordBadges:['nitro-new-tier']});
    assert.equal(nodes.discordBadges.hidden,true);assert.equal(nodes.discordBadges.children.length,0);
  }finally{customizer.dispose();}
});

test('explicit empty choices can clear legacy presets without changing old pages which lack the new setting',()=>{
  const {nodes,customizer,settings}=fixture();
  try{
    customizer.apply({...settings,discordSync:false,owner:'iwtlu'});
    assert.equal(rendered(nodes).length,4);
    customizer.apply({...settings,discordSync:false,owner:'iwtlu',discordBadges:[]});
    assert.equal(rendered(nodes).length,0);
  }finally{customizer.dispose();}
});

test('a current stream is activity text and does not fabricate an earned streaming or Nitro achievement',async()=>{
  const {nodes,customizer,settings}=fixture({activity:{type:1,name:'Twitch',details:'Live now'}});
  try{
    customizer.apply({...settings,discordBadges:[]});await settle();
    assert.equal(nodes.discordActivity.textContent,'В эфире · Twitch · Live now');
    assert.equal(rendered(nodes).length,0);
    customizer.apply({...settings,discordShowActivity:false,discordBadges:[]});
    assert.equal(nodes.discordActivity.hidden,true);
  }finally{customizer.dispose();}
});
