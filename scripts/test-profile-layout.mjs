import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../profile-layout.js',import.meta.url),'utf8');
function fixture(preview=true){
  const listeners=new Map(),messages=[],classes=new Set();
  const body={classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains:name=>classes.has(name),remove:name=>classes.delete(name)}};
  const window={parent:preview?{postMessage:(data,origin)=>messages.push({data,origin})}:null};if(!preview)window.parent=window;
  const addEventListener=(name,fn)=>{listeners.set(name,[...(listeners.get(name)||[]),fn]);};
  const document={body,hidden:false,addEventListener,querySelector:()=>null,querySelectorAll:()=>[]};
  vm.runInNewContext(source,{window,document,location:{search:preview?'?preview=1':'',origin:'https://iwtxz.su'},URLSearchParams,AbortController,MutationObserver:class{observe(){}disconnect(){}},matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout,clearTimeout});
  return {api:window.IwtxzProfileLayout,window,classes,messages,emit:(name,event)=>(listeners.get(name)||[]).forEach(fn=>fn(event))};
}
test('layout positions allow only seven known blocks and bounded finite offsets',()=>{
  const {api}=fixture();
  assert.equal(JSON.stringify(api.normalizePositions({avatar:{x:100,y:-200},name:{x:1.23456,y:Infinity},script:{x:2,y:3},player:[],description:{x:0,y:0}})),JSON.stringify({avatar:{x:40,y:-40},name:{x:1.235,y:0}}));
  for(const value of [null,[],false,'anything'])assert.equal(JSON.stringify(api.normalizePositions(value)),'{}');
});
test('typewriter phrases preserve text and emoji while limiting stored input',()=>{
  const {api}=fixture();
  assert.equal(JSON.stringify(api.typewriterPhrases('  hello 🎃 \r\n\n <script>x</script>  ')),JSON.stringify(['hello 🎃','<script>x</script>']));
  assert.equal(api.typewriterPhrases('x'.repeat(600))[0].length,300);
  assert.equal(api.typewriterPhrases(Array(20).fill('hi').join('\n')).length,12);
  assert.equal(api.typewriterPhrases(null).length,0);
});
test('drag editor accepts commands only from the same-origin preview parent',()=>{
  const page=fixture();const layout=page.api.create();
  const command={type:'iwtxz-layout-edit',enabled:true};
  page.emit('message',{source:{},origin:'https://iwtxz.su',data:command});assert.equal(page.classes.has('iwtxz-layout-editing'),false);
  page.emit('message',{source:page.window.parent,origin:'https://other.test',data:command});assert.equal(page.classes.has('iwtxz-layout-editing'),false);
  page.emit('message',{source:page.window.parent,origin:'https://iwtxz.su',data:command});assert.equal(page.classes.has('iwtxz-layout-editing'),true);
  layout.reset();assert.equal(page.messages.length,1);assert.equal(page.messages[0].origin,'https://iwtxz.su');assert.equal(page.messages[0].data.type,'iwtxz-layout-change');
  layout.dispose();assert.equal(page.classes.has('iwtxz-layout-editing'),false);
});
test('public profile cannot enable block dragging or publish layout messages',()=>{
  const page=fixture(false);const layout=page.api.create();layout.setEditing(true);layout.reset();
  assert.equal(page.classes.has('iwtxz-layout-editing'),false);assert.equal(page.messages.length,0);layout.dispose();
});
