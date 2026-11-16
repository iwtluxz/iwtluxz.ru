import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context=vm.createContext({window:{},URL});
for(const file of ['music-services.js','music-catalog-data.js'])vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context);
const {source}=context.window.IwtxzMusicServices;
test('music service links canonicalize tracking links and reject deceptive hosts and unsupported entities',()=>{
  for(const [input,service] of [
    ['https://music.yandex.ru/album/9553251/track/61304855?utm_source=share','yandex'],
    ['https://open.spotify.com/intl-ru/track/5FkJHVudUByVjanCqFXRql?si=example','spotify'],
    ['https://youtu.be/sVx1mJDeUjY?si=example','youtube'],
    ['https://www.youtube.com/watch?v=sVx1mJDeUjY&t=20','youtube'],
    ['https://soundcloud.com/artist/song?utm_source=share','soundcloud']
  ]){
    const result=source(input);assert.equal(result.service,service);assert.equal(source(result.url).embed,result.embed);
    assert.equal(new URL(result.embed).protocol,'https:');
  }
  for(const input of ['http://open.spotify.com/track/5FkJHVudUByVjanCqFXRql','https://music.yandex.ru.evil.example/album/1/track/2','https://user:password@music.yandex.ru/album/1/track/2','https://open.spotify.com/artist/5FkJHVudUByVjanCqFXRql','https://www.youtube.com/watch?v=<script>','https://example.com/song.mp3','javascript:alert(1)','https://youtu.be/sVx1mJDeUjY/extra','https://soundcloud.com.evil.example/artist/song','https://soundcloud.com/artist/sets/playlist','https://soundcloud.com/artist'])assert.equal(source(input),null,input);
});
test('every editorial selection has a real service track, artwork and searchable attribution',()=>{
  const tracks=context.window.IwtxzMusicCatalogData.tracks;
  assert.equal(new Set(tracks.map(track=>track.url)).size,tracks.length);
  for(const service of ['yandex','youtube','spotify'])assert.ok(tracks.filter(track=>track.service===service).length>=6);
  for(const track of tracks){assert.equal(source(track.url)?.service,track.service);assert.ok(track.artist&&track.title);assert.match(track.cover,/^\/img\/music\/catalog\/[a-z0-9-]+\.(jpg|png|webp)$/);assert.equal(new URL(track.artworkSource).protocol,'https:');assert.ok(['dark','dream','indie'].includes(track.mood));}
});

test('SoundCloud shows a loading state then popular tracks instead of a false empty message',async()=>{
  class Element {
    constructor(){this.children=[];this.dataset={};this.listeners={};this.classList={toggle(){},add(){}};this.value='';this.textContent='';}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(){}
    click(){this.listeners.click?.();}
  }
  const selectors=['services','tracks','search','preview','status','name','tagline','logo','empty','count'];
  const nodes=Object.fromEntries(selectors.map(name=>[name,new Element()]));
  const tools=new Element();
  const root={dataset:{},querySelector(selector){return selector==='.catalog-tools'?tools:nodes[selector.match(/^\[data-catalog-(.+)\]$/)?.[1]];},querySelectorAll(){return [];}};
  const document={querySelector:()=>root,createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
  const window={IwtxzMusicServices:context.window.IwtxzMusicServices,IwtxzMusicCatalogData:{tracks:[]},IWTXZ_BACKEND_CONFIG:{musicApiUrl:'https://music.example'}};
  let requestUrl;
  const fetch=async url=>{requestUrl=url;return {ok:true,json:async()=>({tracks:[{id:'one',service:'soundcloud',title:'Song',artist:'Artist',url:'https://soundcloud.com/artist/song',cover:''}]})};};
  const sandbox=vm.createContext({window,document,URL,URLSearchParams,AbortController,fetch,setTimeout,clearTimeout});
  vm.runInContext(await readFile(new URL('../music-catalog.js',import.meta.url),'utf8'),sandbox);
  window.IwtxzMusicCatalog.create({onSelect(){},onEmbed(){}});
  nodes.services.children.find(button=>button.dataset.service==='soundcloud').click();
  assert.equal(nodes.empty.textContent,'Ищем треки…');
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(requestUrl.searchParams.get('q'),'popular');
  assert.equal(nodes.status.textContent,'Популярное в SoundCloud');
  assert.equal(nodes.tracks.children.length,1);
  assert.equal(nodes.empty.hidden,true);
});
