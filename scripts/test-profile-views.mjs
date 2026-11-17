import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../profile-features.js',import.meta.url),'utf8');
const visitor='10000000-0000-4000-8000-000000000001';
function fixture({blockedStorage=false}={}){
  const nodes=[],calls=[],requests=[],events=[],storage=new Map();
  const element=tag=>({tagName:tag.toUpperCase(),dataset:{},children:[],style:{values:new Map(),setProperty(key,value){this.values.set(key,value);}},classList:{add(){},contains(){return false;}},setAttribute(key,value){this[key]=value;},append(...children){this.children.push(...children);},addEventListener(){},textContent:''});
  const description=element('p');
  const document={readyState:'loading',addEventListener(){},querySelector:selector=>selector.includes('.profile-description')?description:null,querySelectorAll:()=>[],createElement:element,createElementNS:(_,tag)=>element(tag),body:{append:node=>nodes.push(node)}};
  const window={parent:null,localStorage:{getItem(key){if(blockedStorage)throw new Error('blocked');return storage.get(key)||null;},setItem(key,value){if(blockedStorage)throw new Error('blocked');storage.set(key,value);}},crypto:{randomUUID:()=>visitor},IwtxzBackend:{isConfigured:()=>true,recordProfileView(owner,id){calls.push({owner,id});return new Promise((resolve,reject)=>requests.push({resolve,reject}));}},dispatchEvent:event=>events.push(event.type)};
  window.parent=window;
  vm.runInNewContext(source,{window,document,URL,URLSearchParams,Map,CustomEvent:class{constructor(type){this.type=type;}},console:{warn(){}},location:{search:''}});
  return {api:window.IwtxzProfileFeatures,nodes,calls,requests,events,storage,node:()=>nodes[0],settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('eye/text, size and color preserve a single counter request and count across toggles',async()=>{
  const page=fixture(),site={owner:'alice',showProfileViews:true};
  page.api.showProfileViews(site);await page.settle();assert.equal(page.nodes.length,1);assert.deepEqual(page.calls,[{owner:'alice',id:visitor}]);
  page.requests[0].resolve(1234);await page.settle();
  const node=page.node();assert.equal(node.children[2].textContent,'1\u00a0234');
  page.api.showProfileViews({...site,profileViewsStyle:'eye',profileViewsSize:20,profileViewsColor:'#12abef'});
  assert.equal(node.dataset.viewsStyle,'eye');assert.equal(node.children[1].tagName,'SVG');assert.equal(node.style.values.get('--views-size'),'20px');assert.equal(node.style.values.get('--views-color'),'#12abef');
  page.api.showProfileViews({...site,showProfileViews:false});assert.equal(node.hidden,true);
  page.api.showProfileViews({...site,profileViewsStyle:'text'});await page.settle();assert.equal(node.hidden,false);assert.equal(node.children[2].textContent,'1\u00a0234');assert.equal(page.calls.length,1);assert.equal(page.nodes.length,1);
  assert.ok(page.events.includes('iwtxz-profile-views-ready'));
});
test('preview never records visits and rejects injected visual values',async()=>{
  const page=fixture();page.api.showProfileViews({owner:'alice',showProfileViews:true,profileViewsStyle:'<script>',profileViewsColor:'url(javascript:alert(1))',profileViewsSize:200},{preview:true});await page.settle();
  const node=page.node();assert.equal(page.calls.length,0);assert.equal(node.children[2].textContent,'—');assert.equal(node.dataset.viewsStyle,'text');assert.equal(node.style.values.get('--views-size'),'24px');assert.equal(node.style.values.get('--views-color'),'#b6b4bd');
});
test('an old async count cannot replace a different owner and blocked storage keeps one visitor',async()=>{
  const page=fixture({blockedStorage:true});page.api.showProfileViews({owner:'alice',showProfileViews:true});await page.settle();page.api.showProfileViews({owner:'bob',showProfileViews:true});await page.settle();
  page.requests[0].resolve(999);await page.settle();assert.equal(page.node().children[2].textContent,'…');page.requests[1].resolve(7);await page.settle();assert.equal(page.node().children[2].textContent,'7');
  assert.ok(page.calls.every(call=>call.id===visitor));page.api.showProfileViews({owner:'bob',showProfileViews:true});await page.settle();assert.equal(page.calls.length,2);
});
test('a server-disabled counter stays hidden; errors use an accessible neutral placeholder',async()=>{
  const page=fixture();page.api.showProfileViews({owner:'alice',showProfileViews:true});await page.settle();page.requests[0].resolve(null);await page.settle();assert.equal(page.node().hidden,true);page.api.showProfileViews({owner:'alice',showProfileViews:true});assert.equal(page.node().hidden,true);
  page.api.showProfileViews({owner:'bob',showProfileViews:true});await page.settle();page.requests[1].reject(new Error('offline'));await page.settle();assert.equal(page.node().children[2].textContent,'—');assert.equal(page.node()['aria-label'],'Просмотры недоступны');
});
