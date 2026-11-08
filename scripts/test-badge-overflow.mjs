import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../profile-badge-overflow.js',import.meta.url),'utf8');
function fixture({width=390,height=600}={}) {
  let document;
  const documentListeners=new Map(),windowListeners=new Map(),frames=[];
  class Element {
    constructor(tag='span') {
      this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attributes=new Map();this.listeners=new Map();
      this.dataset={};this.style={};this.hidden=false;this.textContent='';this.className='';
      this.classList={add:(value)=>{if(!this.className.split(' ').includes(value))this.className+=' '+value;}};
    }
    get isConnected(){return this._connected||Boolean(this.parentElement?.isConnected);}
    get firstElementChild(){return this.children[0]||null;}
    get id(){return this.attributes.get('id')||'';}
    set id(value){this.attributes.set('id',value);}
    setAttribute(name,value){this.attributes.set(name,String(value));}
    getAttribute(name){return this.attributes.get(name)??null;}
    removeAttribute(name){this.attributes.delete(name);}
    append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes);}
    remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
    contains(target){return this===target||this.children.some(child=>child.contains(target));}
    addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
    fire(type,fields={}){const event={type,target:this,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...fields};for(const fn of this.listeners.get(type)||[])fn(event);return event;}
    focus(){document.activeElement=this;this.fire('focus');}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){const test=node=>selector==='[id]'?node.attributes.has('id'):selector==='img, svg'?['IMG','SVG'].includes(node.tagName):selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):node.tagName.toLowerCase()===selector;return this.children.flatMap(node=>[...(test(node)?[node]:[]),...node.querySelectorAll(selector)]);}
    cloneNode(deep){const clone=new Element(this.tagName);clone.className=this.className;clone.title=this.title;clone.attributes=new Map(this.attributes);clone.dataset={...this.dataset};if(deep)clone.append(...this.children.map(child=>child.cloneNode(true)));return clone;}
    getBoundingClientRect(){return this.bounds|| (this.className==='iwtxz-badge-popover'?{width:Math.min(360,width-24),height:260}:{left:width-40,right:width-16,top:height-40,bottom:height-20,width:24,height:20});}
  }
  const body=new Element('body');body._connected=true;
  document={body,documentElement:{clientWidth:width,clientHeight:height},activeElement:body,createElement:tag=>new Element(tag),addEventListener:(type,fn)=>documentListeners.set(type,fn),removeEventListener:type=>documentListeners.delete(type)};
  const window={innerWidth:width,innerHeight:height,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},setTimeout,clearTimeout,addEventListener:(type,fn)=>windowListeners.set(type,fn),removeEventListener:type=>windowListeners.delete(type)};
  vm.runInNewContext(source,{window,document,Promise,WeakMap,Set,Array});
  const badge=index=>{const node=new Element();node.dataset.discordBadgeId='badge-'+index;node.title=`Badge ${index} · Discord`;node.setAttribute('aria-label',node.title);const img=new Element('img');img.setAttribute('src',`/img/badge-${index}.png`);img.id='old-image-'+index;node.append(img);return node;};
  const owner=new Element();body.append(owner);
  const render=(amount,options={})=>{const strip=new Element();const nodes=Array.from({length:amount},(_,index)=>badge(index));window.IwtxzBadgeOverflow.render(strip,nodes,{owner,...options});owner.replaceChildren(strip);return strip;};
  const popup=()=>body.querySelector('.iwtxz-badge-popover');
  return {api:window.IwtxzBadgeOverflow,body,owner,render,popup,document,documentListeners,windowListeners,flush(){for(const fn of frames.splice(0))fn();}};
}

test('six badges stay visible and overflow counts include every additional enabled badge',()=>{
  const f=fixture();
  try{
    for(const amount of [0,1,6]){const strip=f.render(amount);assert.equal(strip.children.length,amount);assert.equal(strip.querySelector('.iwtxz-badge-overflow-count'),null);}
    for(const amount of [7,8,14]){const strip=f.render(amount);assert.equal(strip.children.length,7);assert.equal(strip.children.slice(0,6).every(node=>node.tagName==='SPAN'),true);const counter=strip.children[6];assert.equal(counter.textContent,'+'+(amount-6));assert.equal(counter.tagName,'SPAN');assert.equal(counter.getAttribute('role'),'button');assert.equal(counter.tabIndex,0);}
  }finally{f.api.dispose();}
});

test('hover exposes the full badge collection in a bounded body portal without duplicated graphic IDs',()=>{
  const f=fixture({width:320,height:500});
  try{
    const strip=f.render(8),counter=strip.children[6];counter.fire('pointerenter',{pointerType:'mouse'});
    const popup=f.popup();assert.ok(popup);assert.equal(popup.parentElement,f.body);assert.equal(popup.hidden,false);
    assert.equal(popup.querySelectorAll('.iwtxz-badge-popover-choice').length,8);
    assert.equal(popup.querySelectorAll('img').every(img=>!img.id),true);
    assert.equal(counter.getAttribute('aria-expanded'),'true');
    assert.equal(Number.parseFloat(popup.style.left)>=12,true);assert.equal(Number.parseFloat(popup.style.top)>=12,true);
    assert.equal(popup.querySelector('.iwtxz-badge-popover-name').textContent,'Badge 0');
    const choices=popup.querySelectorAll('.iwtxz-badge-popover-choice');choices[7].fire('pointerenter');
    assert.equal(popup.querySelector('.iwtxz-badge-popover-name').textContent,'Badge 7');
    assert.equal(choices[7].getAttribute('aria-pressed'),'true');
  }finally{f.api.dispose();}
});

test('touch and keyboard own their events, outside clicks close, and Escape returns focus without reopening',async()=>{
  const f=fixture();
  try{
    const counter=f.render(7).children[6];counter.fire('pointerenter',{pointerType:'touch'});assert.equal(f.popup(),null);
    const click=counter.fire('click');assert.equal(click.stopped,true);assert.equal(click.prevented,true);assert.equal(f.popup().hidden,false);
    f.documentListeners.get('pointerdown')({target:f.body});assert.equal(f.popup().hidden,true);
    const key=counter.fire('keydown',{key:'ArrowDown'});assert.equal(key.stopped,true);assert.equal(key.prevented,true);
    const first=f.popup().querySelector('.iwtxz-badge-popover-choice');assert.equal(f.document.activeElement,first);
    const escape={key:'Escape',preventDefault(){},stopPropagation(){}};f.documentListeners.get('keydown')(escape);
    assert.equal(f.popup().hidden,true);assert.equal(f.document.activeElement,counter);assert.equal(counter.getAttribute('aria-expanded'),'false');
    await Promise.resolve();
    for(const key of ['Enter',' ']){const event=counter.fire('keydown',{key});assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(f.popup().hidden,false);counter.fire('keydown',{key:'Escape'});assert.equal(f.popup().hidden,true);}
  }finally{f.api.dispose();}
});

test('an open collection survives a renderer replacement and is disposed when overflow disappears',()=>{
  const f=fixture();
  try{
    const counter=f.render(8).children[6];counter.fire('click');const popup=f.popup();popup.querySelectorAll('.iwtxz-badge-popover-choice')[4].fire('focus');
    const replacement=f.render(8);f.flush();assert.equal(f.popup(),popup);assert.equal(popup.hidden,false);assert.equal(replacement.children[6].getAttribute('aria-expanded'),'true');assert.equal(popup.querySelector('.iwtxz-badge-popover-name').textContent,'Badge 4');
    f.render(6);assert.equal(f.popup(),null);assert.equal(f.documentListeners.has('keydown'),false);assert.equal(f.windowListeners.has('resize'),false);
    f.render(9).children[6].fire('click');assert.ok(f.popup());f.api.dispose(f.owner);assert.equal(f.popup(),null);
  }finally{f.api.dispose();}
});
