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
function fixture({badges = [], activity = null, fresh = true, member = true, matchingGuild = true, responseStatus = 200, fail = false} = {}) {
  const nodes = {discordBadges:new Element(),discordActivity:new Element(),discordCard:new Element()};
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
  const snapshot = {id:'484816707798564894',guildId:matchingGuild?guildId:'111111111111111111',member,updatedAt:Date.now()-(fresh?0:90000000),badges,activity};
  const messages = [];
  const window = {IWTXZ_BACKEND_CONFIG:{discordGuildId:guildId},IwtxzDiscordBadges:catalog};window.parent={postMessage:(message,origin)=>messages.push({message,origin})};
  vm.runInNewContext(source,{window,document,location:new URL('https://example.test/'),URL,AbortSignal,fetch:async()=>{if(fail)throw new Error('offline');return Response.json(snapshot,{status:responseStatus});},setInterval:()=>1,clearInterval(){}});
  const customizer=window.IwtxzProfileCustomization.createCustomizer(nodes);
  const settings={discord:'alice',discordSync:true,discordUserId:snapshot.id};
  return {nodes,customizer,settings,messages};
}
const rendered = nodes => nodes.discordBadges.children.flatMap(strip => strip.children).map(badge=>({title:badge.title,image:badge.children[0].src}));
const settle = () => new Promise(resolve=>setImmediate(resolve));

test('only known badges in the verified snapshot render and manual or legacy artwork cannot add awards',async()=>{
  const {nodes,customizer,settings,messages}=fixture({badges:[{id:'house-bravery',label:'Real badge'},{id:'house-bravery'},{id:'__proto__'},{id:'nitro-new-tier'}]});
  try{
    customizer.apply({...settings,owner:'iwtlu',discordBadges:['house-bravery','nitro-new-tier','streaming-achievement','nitro','javascript:bad']});
    await settle();
    const badges=rendered(nodes);
    assert.equal(badges.length,2);
    assert.match(badges[0].title,/Real badge · Discord$/);
    assert.match(badges[1].title,/New Nitro tier · Discord$/);
    assert.deepEqual(badges.map(item=>item.image),['/img/discord-badges/house-bravery.png','/img/discord-badges/nitro.png']);
    assert.ok(badges.every(item=>!item.title.includes('оформлении')));
    const availability=messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1);
    assert.equal(availability.origin,'https://example.test');
    assert.equal(availability.message.userId,settings.discordUserId);
    assert.equal(availability.message.state,'ready');
    assert.deepEqual(Array.from(availability.message.badges,item=>item.id),['house-bravery','nitro-new-tier']);
  }finally{customizer.dispose();}
});

test('unavailable, stale, wrong-guild, nonmember and disabled snapshots never expose selectable or visible badges',async()=>{
  for(const [options,expected] of [[{fresh:false},'waiting'],[{matchingGuild:false},'waiting'],[{member:false},'not-member'],[{responseStatus:404},'waiting'],[{fail:true},'unavailable']]){
    const {nodes,customizer,settings,messages}=fixture({...options,badges:[{id:'house-bravery'}]});
    try{
      customizer.apply({...settings,owner:'iwtlu',discordBadges:['nitro-new-tier']});await settle();
      assert.equal(rendered(nodes).length,0,expected);
      const availability=messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1).message;
      assert.equal(availability.state,expected);
      assert.equal(availability.badges.length,0);
      customizer.apply({...settings,discordSync:false,discordBadges:['nitro-new-tier']});
      assert.equal(rendered(nodes).length,0);
      assert.equal(messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1).message.state,'disabled');
    }finally{customizer.dispose();}
  }
});

test('earned badge switches hide and restore individual badges without changing available choices',async()=>{
  const {nodes,customizer,settings,messages}=fixture({badges:[{id:'house-bravery'},{id:'nitro-new-tier'}]});
  try{
    customizer.apply({...settings,discordHiddenBadges:['house-bravery','unknown','__proto__']});await settle();
    assert.equal(rendered(nodes).length,1);
    assert.match(rendered(nodes)[0].title,/New Nitro tier/);
    assert.deepEqual(Array.from(messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1).message.badges,item=>item.id),['house-bravery','nitro-new-tier']);
    customizer.apply({...settings,discordHiddenBadges:[]});
    assert.equal(rendered(nodes).length,2);
    customizer.apply({...settings,discordHiddenBadges:['house-bravery','nitro-new-tier']});
    assert.equal(rendered(nodes).length,0);
    customizer.apply({...settings,discordShowBadges:false,discordHiddenBadges:[]});
    assert.equal(nodes.discordBadges.hidden,true);
    assert.equal(rendered(nodes).length,0);
    assert.equal(messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1).message.badges.length,2);
    customizer.apply({...settings,showDiscord:false,discordShowBadges:false,discordHiddenBadges:[]});
    assert.equal(nodes.discordCard.hidden,true);
    assert.equal(messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1).message.badges.length,2);
  }finally{customizer.dispose();}
});

test('changing Discord ID clears the old account badges while the new request is pending',async()=>{
  const {nodes,customizer,settings,messages}=fixture({badges:[{id:'house-bravery'}]});
  try{
    customizer.apply(settings);await settle();assert.equal(rendered(nodes).length,1);
    const second='711225785150865428';
    customizer.apply({...settings,discordUserId:second});
    assert.equal(rendered(nodes).length,0);
    const pending=messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1).message;
    assert.equal(pending.userId,second);assert.equal(pending.state,'waiting');assert.equal(pending.badges.length,0);
    await settle();
    const failed=messages.filter(item=>item.message.type==='iwtxz-discord-badges').at(-1).message;
    assert.equal(failed.userId,second);assert.equal(failed.state,'unavailable');assert.equal(failed.badges.length,0);
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
