import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const catalogSource=await readFile(new URL('../discord-badges.js',import.meta.url),'utf8');
const pickerSource=await readFile(new URL('../builder-discord-badges.js',import.meta.url),'utf8');
const userId='484816707798564894';
const earned=[{id:'house-bravery'},{id:'server-booster'}];
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(){
  let document;
  const matches=(element,selector)=>selector.startsWith('#')?element.id===selector.slice(1):selector.startsWith('.')?element.className.split(/\s+/).includes(selector.slice(1)):element.tagName.toLowerCase()===selector.toLowerCase();
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.className='';this.dataset={};this.attributes={};this.listeners=new Map();this.value='';this.textContent='';this.hidden=false;this.checked=false;this.disabled=false;this.id='';
      this.classList={toggle:(name,enabled)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(enabled)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');}};
    }
    setAttribute(key,value){this.attributes[key]=String(value);}
    append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
    after(node){const siblings=this.parentNode.children;node.parentNode=this.parentNode;siblings.splice(siblings.indexOf(this)+1,0,node);}
    closest(selector){for(let node=this;node;node=node.parentNode)if(matches(node,selector))return node;return null;}
    querySelectorAll(selector){const found=[];for(const child of this.children){if(matches(child,selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    addEventListener(type,listener){const listeners=this.listeners.get(type)||[];listeners.push(listener);this.listeners.set(type,listeners);}
    dispatchEvent(event){event.target??=this;for(const listener of this.listeners.get(event.type)||[])listener(event);if(event.bubbles&&!event.stopped)this.parentNode?.dispatchEvent(event);return true;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click',{bubbles:true}));}
    focus(){document.activeElement=this;}
  }
  class Event{constructor(type,options={}){this.type=type;this.bubbles=options.bubbles===true;}stopPropagation(){this.stopped=true;}}
  const body=new Element('body'),group=new Element('div'),user=new Element('input'),toggles=new Element('div'),show=new Element('input');
  group.className='settings-group';user.id='discordUserId';toggles.className='toggle-grid';show.id='discordShowBadges';toggles.append(show);group.append(user,toggles);body.append(group);
  document={body,createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),activeElement:null};
  const window={};
  vm.runInNewContext(catalogSource,{window});vm.runInNewContext(pickerSource,{window,document,Event});
  const root=document.getElementById('discordBadgePicker');
  return{api:window.IwtxzDiscordBadgePicker,document,root,
    rows:()=>root.querySelectorAll('.discord-badge-choice'),
    input:id=>root.querySelectorAll('input').find(input=>input.dataset.discordBadge===id),
    change(id,checked){const input=this.input(id);assert.ok(input,id);input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));},
    search(value){const input=root.querySelector('.discord-badge-search').querySelector('input');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},
    action(text){const button=root.querySelectorAll('button').find(button=>button.textContent===text);assert.ok(button);button.click();}
  };
}

test('only received known Discord badges become switches; manual, unavailable and duplicate IDs never add rows',()=>{
  const f=fixture();
  assert.equal(f.rows().length,0);
  f.api.applyHidden(['nitro-current','orbs']);
  assert.equal(f.rows().length,0);
  f.api.setAvailable({userId,state:'ready',badges:[...earned,earned[0],{id:'__proto__'},{id:'not-a-badge'}]});
  assert.deepEqual(f.rows().map(row=>row.dataset.badgeId),['house-bravery','server-booster']);
  assert.ok(f.input('house-bravery').checked);
  assert.ok(f.input('server-booster').checked);
  assert.equal(f.input('nitro-current'),undefined);
  assert.equal(f.input('orbs'),undefined);
});

test('earned switches persist hidden IDs, preserve search selection and restore all badges individually or together',()=>{
  const f=fixture();f.api.setAvailable({userId,state:'ready',badges:earned});
  f.change('house-bravery',false);
  assert.deepEqual(plain(f.api.readHidden()),['house-bravery']);
  f.search('booster');assert.equal(f.input('house-bravery').closest('label').hidden,true);
  assert.deepEqual(plain(f.api.readHidden()),['house-bravery']);
  f.action('Выключить все');assert.deepEqual(plain(f.api.readHidden()),['house-bravery','server-booster']);
  f.action('Включить все');assert.deepEqual(plain(f.api.readHidden()),[]);
  f.api.applyHidden(['server-booster']);assert.equal(f.input('server-booster').checked,false);
  f.change('server-booster',true);assert.deepEqual(plain(f.api.readHidden()),[]);
});

test('availability updates clear unavailable rows without losing saved preferences or rebuilding unchanged focused switches',()=>{
  const f=fixture();f.api.applyHidden(['house-bravery']);f.api.setAvailable({userId,state:'ready',badges:earned});
  const first=f.input('house-bravery');first.focus();
  f.api.setAvailable({userId,state:'ready',badges:earned});
  assert.equal(f.input('house-bravery'),first);assert.equal(f.document.activeElement,first);assert.equal(first.checked,false);
  for(const state of ['loading','waiting','unavailable','not-member','disabled']){f.api.setAvailable({userId,state,badges:earned});assert.equal(f.rows().length,0,state);assert.deepEqual(plain(f.api.readHidden()),['house-bravery']);}
  f.api.setAvailable({userId,state:'ready',badges:earned});assert.equal(f.input('house-bravery').checked,false);
  f.api.reset();assert.equal(f.rows().length,0);assert.deepEqual(plain(f.api.readHidden()),[]);
});

test('badges for missing or malformed user IDs never create switches and ready empty data stays empty',()=>{
  const f=fixture();
  for(const badId of ['',null,'name','123','484816707798564894<script>']){f.api.setAvailable({userId:badId,state:'ready',badges:earned});assert.equal(f.rows().length,0);}
  f.api.setAvailable({userId,state:'ready',badges:[]});assert.equal(f.rows().length,0);
  assert.match(f.root.querySelector('.discord-badge-empty').textContent,/не передал доступных значков/);
});
