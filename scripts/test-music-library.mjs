import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../music-library.js',import.meta.url),'utf8');
class Element {
  constructor(){this.children=[];this.listeners={};this.value='';this.classList={toggle(){}};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(type,listener){this.listeners[type]=listener;}
  setAttribute(){}
}
function setup(request){
  const nodes=new Map(['list','status','url','import'].map(key=>[`[data-library-${key}]`,new Element()]));
  const root={querySelector:selector=>nodes.get(selector)};
  const context=vm.createContext({window:{IWTXZ_BACKEND_CONFIG:{musicApiUrl:'https://music.example'},IwtxzBackend:{request}},document:{querySelector:()=>root,createElement:()=>new Element()},AbortController,DOMException,Date,setTimeout:callback=>setTimeout(callback,1),clearTimeout});
  vm.runInContext(source,context);
  return {api:context.window.IwtxzMusicLibrary.create({onSelect(){throw Error('External import must not select before caller confirms');}}),nodes};
}
const track={id:'right',source:'https://www.youtube.com/watch?v=abcdefghijk',url:'https://music.example/media/right.mp3',title:'Downloaded',duration:180};

test('music import returns actual MP3 only after its own job finishes; unrelated failures do not select or fail it',async()=>{
  let reads=0;
  const {api,nodes}=setup(async(path,options)=>{
    if(path.endsWith('/import')){assert.equal(JSON.parse(options.body).url,track.source);return {jobId:'wanted'};}
    assert.ok(path.endsWith('/library'));
    return ++reads===1?{tracks:[],jobs:[{id:'older',state:'error',error:'An unrelated failure'},{id:'wanted',state:'downloading'}]}:{tracks:[track],jobs:[]};
  });
  const result=await api.importTrack({url:track.source});
  assert.equal(result.url,track.url);assert.equal(reads,2);
  assert.equal(nodes.get('[data-library-import]').disabled,false);
  assert.match(nodes.get('[data-library-status]').textContent,/скачан/);
  api.reset();
});

test('already downloaded imports resolve by returned track ID even if provider canonicalized the URL',async()=>{
  const {api}=setup(async path=>path.endsWith('/import')?{ready:true,trackId:'right'}:{tracks:[track],jobs:[]});
  const result=await api.importTrack('https://youtu.be/abcdefghijk?si=tracking');
  assert.equal(result.url,track.url);api.reset();
});

test('failed imports reject without selecting a service widget URL and release the import button',async()=>{
  const {api,nodes}=setup(async path=>path.endsWith('/import')?{jobId:'wanted'}:{tracks:[],jobs:[{id:'wanted',state:'error',error:'Provider unavailable'}]});
  await assert.rejects(api.importTrack(track),/Provider unavailable/);
  assert.equal(nodes.get('[data-library-import]').disabled,false);api.reset();
});

test('logout invalidates an in-flight import even if the pending request eventually returns audio',async()=>{
  let release;
  const {api}=setup(path=>path.endsWith('/import')?new Promise(resolve=>{release=resolve;}):Promise.resolve({tracks:[track],jobs:[]}));
  const importing=api.importTrack(track);api.reset();release({jobId:'wanted'});
  await assert.rejects(importing,{name:'AbortError'});
});
