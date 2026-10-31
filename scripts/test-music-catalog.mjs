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
    ['https://www.youtube.com/watch?v=sVx1mJDeUjY&t=20','youtube']
  ]){
    const result=source(input);assert.equal(result.service,service);assert.equal(source(result.url).embed,result.embed);
    assert.equal(new URL(result.embed).protocol,'https:');
  }
  for(const input of ['http://open.spotify.com/track/5FkJHVudUByVjanCqFXRql','https://music.yandex.ru.evil.example/album/1/track/2','https://user:password@music.yandex.ru/album/1/track/2','https://open.spotify.com/artist/5FkJHVudUByVjanCqFXRql','https://www.youtube.com/watch?v=<script>','https://example.com/song.mp3','javascript:alert(1)','https://youtu.be/sVx1mJDeUjY/extra'])assert.equal(source(input),null,input);
});
test('every editorial selection has a real service track, artwork and searchable attribution',()=>{
  const tracks=context.window.IwtxzMusicCatalogData.tracks;
  assert.equal(new Set(tracks.map(track=>track.url)).size,tracks.length);
  for(const service of ['yandex','youtube','spotify'])assert.ok(tracks.filter(track=>track.service===service).length>=6);
  for(const track of tracks){assert.equal(source(track.url)?.service,track.service);assert.ok(track.artist&&track.title);assert.match(track.cover,/^\/img\/music\/catalog\/[a-z0-9-]+\.(jpg|png|webp)$/);assert.equal(new URL(track.artworkSource).protocol,'https:');assert.ok(['dark','dream','indie'].includes(track.mood));}
});
