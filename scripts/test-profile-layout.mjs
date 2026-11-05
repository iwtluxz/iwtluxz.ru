import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../profile-layout.js',import.meta.url),'utf8');
function nodeFixture(box={left:100,top:100,width:200,height:50}){
  const values=new Map(),classes=new Set(),attributes=new Map();
  const node={style:{getPropertyValue:key=>values.get(key)||'',setProperty:(key,value)=>values.set(key,value)},getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),dataset:{},classList:{add(...names){names.forEach(name=>classes.add(name));},toggle(name,on){on?classes.add(name):classes.delete(name);},remove(...names){names.forEach(name=>classes.delete(name));}},parentElement:null,focus(){},setPointerCapture(){},releasePointerCapture(){},closest(){return node;},remove(){node.removed=true;},getBoundingClientRect(){const offsets=String(values.get('translate')||'').match(/-?[\d.]+/g)||[];const x=Number(offsets[0])||0,y=Number(offsets[1])||0;return {...box,left:box.left+x,top:box.top+y,right:box.left+x+box.width,bottom:box.top+y+box.height};}};
  return {node,values,box,classes};
}
function fixture(preview=true,nameNode=null){
  const listeners=new Map(),messages=[],classes=new Set(),frames=new Map(),timers=new Map(),created=[];let sequence=0,resizeCallback,motionCallback;
  const body={classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains:name=>classes.has(name),remove(...names){names.forEach(name=>classes.delete(name));}},append(...nodes){created.push(...nodes);}};
  const window={parent:preview?{postMessage:(data,origin)=>messages.push({...data,origin})}:null};if(!preview)window.parent=window;
  const addEventListener=(name,fn)=>{listeners.set(name,[...(listeners.get(name)||[]),fn]);};
  const document={title:'Original | iwtxz',body,hidden:false,addEventListener,querySelector:selector=>selector.includes('#profileName')?nameNode:null,querySelectorAll:()=>[],createElement:()=>nodeFixture().node};
  const motion={matches:false,addEventListener:(name,callback)=>{motionCallback=callback;}};
  const context=vm.createContext({window,document,location:{search:preview?'?preview=1':'',origin:'https://iwtxz.su'},innerWidth:800,innerHeight:600,getComputedStyle:()=>({zoom:'1'}),URLSearchParams,AbortController,MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{constructor(callback){resizeCallback=callback;}observe(){}disconnect(){}},matchMedia:()=>motion,addEventListener,requestAnimationFrame:callback=>{frames.set(++sequence,callback);return sequence;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:callback=>{timers.set(++sequence,callback);return sequence;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source,context);
  return {api:window.IwtxzProfileLayout,window,document,created,classes,messages,resize(width,height){context.innerWidth=width;context.innerHeight=height;resizeCallback?.();},flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());},tick(){const [id,callback]=timers.entries().next().value||[];if(callback){timers.delete(id);callback();}},setReduced(value){motion.matches=value;motionCallback?.();},emit:(name,event)=>(listeners.get(name)||[]).forEach(fn=>fn(event))};
}

test('layout stores six known blocks, preserves centered zero coordinates and bounds offsets',()=>{
  const {api}=fixture();
  assert.equal(JSON.stringify(api.normalizePositions({avatar:{x:100,y:-200},name:{x:1.23456,y:Infinity},script:{x:2,y:3},player:[],description:{x:0,y:0},typewriter:{x:1,y:1}})),JSON.stringify({avatar:{x:40,y:-40},name:{x:1.235,y:0},description:{x:0,y:0}}));
  for(const value of [null,[],false,'anything'])assert.equal(JSON.stringify(api.normalizePositions(value)),'{}');
});

test('typewriter animates only the browser tab, restores its title when disabled and sends preview titles',()=>{
  const page=fixture(),layout=page.api.create();
  layout.apply({title:'My page',typewriterEnabled:true,typewriterText:'AB\nCD',typewriterSpeed:30});
  assert.equal(page.document.title,'My page | iwtxz');page.tick();assert.equal(page.document.title,'A | iwtxz');
  assert.equal(page.created.length,0);assert.equal(page.messages.at(-1).type,'iwtxz-title-preview');
  page.setReduced(true);assert.equal(page.document.title,'AB | iwtxz');
  layout.apply({title:'My page',typewriterEnabled:false});assert.equal(page.document.title,'My page | iwtxz');
  layout.dispose();
});

test('typewriter phrases preserve safe text and emoji within the stored limit',()=>{
  const {api}=fixture();assert.equal(JSON.stringify(api.typewriterPhrases('  hello 👋 \r\n\n <script>x</script>  ')),JSON.stringify(['hello 👋','<script>x</script>']));
  assert.equal(api.typewriterPhrases('x'.repeat(600))[0].length,300);assert.equal(api.typewriterPhrases(Array(20).fill('hi').join('\n')).length,12);assert.equal(api.typewriterPhrases(null).length,0);
});

test('the same v2 centered coordinates remain centered across viewport sizes',()=>{
  const block=nodeFixture(),page=fixture(false,block.node),layout=page.api.create();
  layout.apply({layoutVersion:2,objectPositions:{name:{x:0,y:0}}});page.flush();
  let rect=block.node.getBoundingClientRect();assert.equal(rect.left+rect.width/2,400);assert.equal(rect.top+rect.height/2,300);
  block.box.left=440;block.box.top=300;page.resize(1280,800);page.flush();
  rect=block.node.getBoundingClientRect();assert.equal(rect.left+rect.width/2,640);assert.equal(rect.top+rect.height/2,400);layout.dispose();
});

test('editing migrates old relative offsets without moving the visible block',()=>{
  const block=nodeFixture(),page=fixture(true,block.node),layout=page.api.create();
  layout.apply({objectPositions:{name:{x:4,y:4}}});page.flush();const before=block.node.getBoundingClientRect();
  layout.setEditing(true);const migrated=page.messages.find(message=>message.type==='iwtxz-layout-change');assert.equal(migrated.layoutVersion,2);
  layout.apply({layoutVersion:2,objectPositions:migrated.positions});page.flush();const after=block.node.getBoundingClientRect();
  assert.ok(Math.abs(after.left-before.left)<.01);assert.ok(Math.abs(after.top-before.top)<.01);layout.dispose();
});

test('grid and alignment commands accept only the trusted preview parent',()=>{
  const block=nodeFixture(),page=fixture(true,block.node),layout=page.api.create();layout.apply({layoutVersion:2});page.flush();
  const command={type:'iwtxz-layout-grid',grid:{visible:true,step:40,color:'#aabbcc',opacity:20,snap:true}};
  page.emit('message',{source:{},origin:'https://iwtxz.su',data:command});assert.equal(page.created.length,0);
  page.emit('message',{source:page.window.parent,origin:'https://other.test',data:command});assert.equal(page.created.length,0);
  page.emit('message',{source:page.window.parent,origin:'https://iwtxz.su',data:command});assert.equal(page.created.length,2);
  layout.setEditing(true);page.emit('focusin',{target:block.node});assert.equal(page.messages.at(-1).type,'iwtxz-layout-selected');
  page.emit('message',{source:page.window.parent,origin:'https://iwtxz.su',data:{type:'iwtxz-layout-align',axis:'both'}});
  const change=page.messages.findLast(message=>message.type==='iwtxz-layout-change');assert.equal(JSON.stringify(change.positions.name),'{"x":0,"y":0}');layout.dispose();
});

test('public profiles cannot enable the drag editor, display a grid or publish layout changes',()=>{
  const page=fixture(false),layout=page.api.create();layout.setEditing(true);layout.setGrid({visible:true});layout.reset();assert.equal(page.classes.has('iwtxz-layout-editing'),false);assert.equal(page.created.length,0);assert.equal(page.messages.length,0);layout.dispose();
});

test('a delayed editor echo cannot overwrite an in-progress pointer drag',()=>{
  const block=nodeFixture(),page=fixture(true,block.node),layout=page.api.create();
  const site={owner:'alice',layoutVersion:2,objectPositions:{name:{x:0,y:0}}};
  layout.apply(site);page.flush();layout.setEditing(true);layout.setGrid({snap:false});
  const event={target:block.node,pointerId:1,button:0,preventDefault(){},stopPropagation(){}};
  page.emit('pointerdown',{...event,clientX:400,clientY:300});
  page.emit('pointermove',{...event,clientX:500,clientY:350});page.flush();
  layout.apply(site);page.flush();page.emit('pointerup',event);
  const changed=page.messages.findLast(message=>message.type==='iwtxz-layout-change');
  assert.equal(changed.positions.name.x,10);assert.equal(changed.positions.name.y,6.667);layout.dispose();
});
