import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const catalogSource=await readFile(new URL('../discord-badges.js',import.meta.url),'utf8');
const pickerSource=await readFile(new URL('../builder-discord-badges.js',import.meta.url),'utf8');
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

test('the full original badge catalog is selectable without a Discord ID or sync data',()=>{
  const f=fixture();
  assert.equal(f.api.mode,'manual');
  assert.equal(f.rows().length,100);
  assert.deepEqual(plain(f.api.readSelected()),[]);
  for(const id of ['nitro-current','nitro-opal','streaming-newcomer','orbs','house-bravery']){
    assert.ok(f.input(id),id);assert.equal(f.input(id).checked,false);
  }
  assert.doesNotMatch(f.root.querySelector('.hint').textContent,/получен|синхронизац|только/);
});

test('any selected Nitro, streaming and Orbs badges persist across searches and categories',()=>{
  const f=fixture();
  const selection=['nitro-opal','streaming-newcomer','orbs'];
  for(const id of selection)f.change(id,true);
  assert.deepEqual(plain(f.api.readSelected()),selection);
  f.search('nitro');assert.equal(f.input('orbs').closest('label').hidden,true);
  assert.deepEqual(plain(f.api.readSelected()),selection);
  f.search('');
  f.root.querySelectorAll('button').find(button=>button.dataset.badgeGroup==='streaming').click();
  assert.equal(f.input('nitro-opal').closest('label').hidden,true);
  assert.equal(f.rows().filter(row=>!row.hidden).length,10);
  assert.deepEqual(plain(f.api.readSelected()),selection);
  f.root.querySelectorAll('button').find(button=>button.dataset.badgeGroup==='all').click();
  assert.equal(f.rows().filter(row=>!row.hidden).length,100);
  f.change('streaming-newcomer',false);
  assert.deepEqual(plain(f.api.readSelected()),['nitro-opal','orbs']);
});

test('saved custom selections restore without adding HypeSquad or rebuilding the focused row',()=>{
  const f=fixture();
  const saved=['nitro-opal','server-booster-24','account-age-primordial','game-time-unshakeable','game-variety-universalist'];
  f.api.applySelected(saved);
  assert.deepEqual(plain(f.api.readSelected()),saved);
  assert.equal(f.input('house-bravery').checked,false);
  const first=f.input('nitro-opal');first.focus();
  f.api.applySelected([...saved]);
  assert.equal(f.input('nitro-opal'),first);assert.equal(f.document.activeElement,first);
  f.api.applySelected(['nitro-current','nitro-current','unknown','__proto__']);
  assert.deepEqual(plain(f.api.readSelected()),['nitro-current']);
  f.action('Снять выбранные');assert.deepEqual(plain(f.api.readSelected()),[]);
  assert.equal(f.rows().length,100);
});

test('selection enforces 32 badges and reset clears choices without removing the catalog',()=>{
  const f=fixture();
  const ids=f.rows().slice(0,33).map(row=>row.dataset.badgeId);
  for(const id of ids)f.change(id,true);
  assert.equal(f.api.readSelected().length,32);
  assert.equal(f.input(ids[32]).checked,false);
  assert.match(f.root.querySelector('.discord-badge-picker-footer').querySelectorAll('.hint')[1].textContent,/32/);
  f.change(ids[0],false);f.change(ids[32],true);assert.equal(f.input(ids[32]).checked,true);
  f.search('not-found-123');assert.equal(f.root.querySelector('.discord-badge-empty').hidden,false);
  f.api.reset();assert.deepEqual(plain(f.api.readSelected()),[]);assert.equal(f.rows().filter(row=>!row.hidden).length,100);
});
