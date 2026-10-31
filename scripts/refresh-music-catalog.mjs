import { mkdir, writeFile } from 'node:fs/promises';

// Editorial selections, not service charts or personalized recommendations.
const yandex = [
  ['Молчат Дома Судно', 'dark'], ['Кино Спокойная ночь', 'dark'],
  ['Перемотка Музыка вечер', 'indie'], ['Дурной Вкус Пластинки', 'indie'],
  ['Буерак Спортивные очки', 'indie'], ['Molchat Doma На дне', 'dark']
];
const international = [
  ['after-dark','After Dark','Mr.Kitty','dark','sVx1mJDeUjY','5FkJHVudUByVjanCqFXRql'],
  ['space-song','Space Song','Beach House','dream','RBtlPT23PTM','7H0ya83CMmgFcOhw0UB6ow'],
  ['night-we-met','The Night We Met','Lord Huron','indie','KtlgYxa6BMU','0QZ5yyl6B6utIWkxeBDxQN'],
  ['apocalypse','Apocalypse','Cigarettes After Sex','dream','sElE_BfQ67s','3AVrVz5rK8Hrqo9YGiVGN5'],
  ['sweater-weather','Sweater Weather','The Neighbourhood','indie','GCdwKhTtNNw','2QjOHCTQ1Jl3zawyYOpxh6'],
  ['sunsetz','Sunsetz','Cigarettes After Sex','dream','5-rbSNzU_b8','69UqtTHfUKAJweQwEStRzC']
];
async function json(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Metadata HTTP ${response.status}: ${new URL(url).hostname}`);
  return response.json();
}
const tracks=[];
for(const [query,mood] of yandex) {
  const data=await json('https://api.music.yandex.net/search?type=track&page=0&text='+encodeURIComponent(query));
  const track=data.result?.tracks?.results?.find(item=>item.available&&item.albums?.[0]?.id);
  if(!track)throw new Error('No available Yandex selection: '+query);
  tracks.push({id:'yandex-'+track.id,service:'yandex',title:track.title,artist:track.artists.map(item=>item.name).join(', '),mood,
    url:`https://music.yandex.ru/album/${track.albums[0].id}/track/${track.id}`,
    cover:'https://'+track.coverUri.replace('%%','200x200'),duration:Math.round(track.durationMs/1000)});
}
for(const [id,title,artist,mood,youtube,spotify] of international) {
  for(const service of ['youtube','spotify']) {
    const url=service==='youtube'?`https://www.youtube.com/watch?v=${youtube}`:`https://open.spotify.com/track/${spotify}`;
    const data=await json((service==='youtube'?'https://www.youtube.com/oembed?format=json&url=':'https://open.spotify.com/oembed?url=')+encodeURIComponent(url));
    if(!data.title.toLowerCase().includes(title.toLowerCase()))throw new Error('Selection title mismatch: '+id+'/'+service);
    tracks.push({id:service+'-'+id,service,title,artist,mood,url,cover:data.thumbnail_url});
  }
}
if(new Set(tracks.map(track=>track.url)).size!==tracks.length)throw new Error('Duplicate catalog selections');
await mkdir(new URL('../img/music/catalog/',import.meta.url),{recursive:true});
await Promise.all(tracks.map(async track=>{
  if(!/^[a-z0-9-]+$/.test(track.id))throw new Error('Invalid catalog ID');
  const response=await fetch(track.cover,{signal:AbortSignal.timeout(20000)});
  const type=response.headers.get('content-type')||'';
  if(!response.ok||!/^image\/(jpeg|png|webp)/.test(type))throw new Error('Invalid cover: '+track.id);
  const data=Buffer.from(await response.arrayBuffer());if(data.length>2000000)throw new Error('Cover too large');
  const extension=type.includes('png')?'png':type.includes('webp')?'webp':'jpg';
  track.artworkSource=track.cover;track.cover=`/img/music/catalog/${track.id}.${extension}`;
  await writeFile(new URL('..'+track.cover,import.meta.url),data);
}));
const catalog={updatedAt:new Date().toISOString(),tracks};
await writeFile(new URL('../music-catalog-data.js',import.meta.url),'// Verified editorial selections. Refresh with node scripts/refresh-music-catalog.mjs\nwindow.IwtxzMusicCatalogData = '+JSON.stringify(catalog,null,2)+';\n');
console.log(`Music catalog refreshed: ${tracks.length} verified tracks.`);
