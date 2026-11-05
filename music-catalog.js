(() => {
  'use strict';
  function create({onSelect}) {
    const root=document.querySelector('#musicCatalog'),api=window.IwtxzMusicServices;
    if(!root||!api)return null;
    const tracks=window.IwtxzMusicCatalogData?.tracks||[];
    const tabs=root.querySelector('[data-catalog-services]'),list=root.querySelector('[data-catalog-tracks]');
    const search=root.querySelector('[data-catalog-search]'),preview=root.querySelector('[data-catalog-preview]');
    const feedback=root.querySelector('[data-catalog-status]');
    const serviceSearch=document.createElement('a');serviceSearch.className='catalog-open-search';serviceSearch.target='_blank';serviceSearch.rel='noopener noreferrer';serviceSearch.hidden=true;
    root.querySelector('.catalog-tools').append(serviceSearch);
    let service='yandex',mood='all',selected='',listening='',remote=null,searchTimer,searchController,searchVersion=0,importing=false;
    const imported=new Set();
    function cancelSearch(){clearTimeout(searchTimer);searchController?.abort();++searchVersion;remote=null;}
    function scheduleSearch(){
      cancelSearch();const query=search.value.trim();render();
      if(query.length<2)return;
      const direct=api.source(query);
      if(direct){
        service=direct.service;
        const known=tracks.find(track=>api.source(track.url)?.url===direct.url);
        remote=[known||{id:'linked-'+direct.id,service,title:'Трек из '+direct.name,artist:direct.name,url:direct.url,cover:'',metadataMissing:true}];
        render();feedback.textContent=direct.service==='youtube'?'Ссылка распознана. Можно послушать и скачать аудиофайл.':'Ссылка распознана. Для скачивания найди этот трек на YouTube по исполнителю и названию.';return;
      }
      const version=searchVersion;
      searchTimer=setTimeout(async()=>{
        const controller=new AbortController();searchController=controller;const timeout=setTimeout(()=>controller.abort(),35000);feedback.textContent='Ищем треки…';
        try{
          const base=new URL(window.IWTXZ_BACKEND_CONFIG?.musicApiUrl);
          if(base.protocol!=='https:'||base.username||base.password)throw new Error('Поиск пока не подключён.');
          const url=new URL('/v1/catalog/search',base);url.search=new URLSearchParams({service,q:query});
          const response=await fetch(url,{signal:controller.signal,credentials:'omit'});const data=await response.json();
          if(version!==searchVersion)return;
          if(!response.ok)throw new Error(data.error||'Не удалось выполнить поиск.');
          remote=(Array.isArray(data.tracks)?data.tracks:[]).filter(track=>api.source(track.url)?.service===service);
          feedback.textContent=remote.length?'Результаты поиска':'По этому запросу ничего не найдено.';render();
        }catch(error){if(version===searchVersion)feedback.textContent=error.name==='AbortError'?'Поиск занял слишком много времени. Попробуй ещё раз.':error.message;}
        finally{clearTimeout(timeout);}
      },400);
    }
    function image(url,className='') {const node=document.createElement('img');node.src=url;node.alt='';node.loading='lazy';node.className=className;return node;}
    function stopPreview(){preview.replaceChildren();preview.hidden=true;listening='';}
    function render() {
      root.dataset.musicService=service;
      const brand=api.services[service];
      root.querySelector('[data-catalog-name]').textContent=brand.name;
      root.querySelector('[data-catalog-tagline]').textContent=brand.tagline;
      root.querySelector('[data-catalog-logo]').src=brand.icon;
      for(const tab of tabs.children){const active=tab.dataset.service===service;tab.setAttribute('aria-pressed',String(active));}
      const needle=search.value.trim().toLocaleLowerCase('ru');
      serviceSearch.hidden=needle.length<2;
      serviceSearch.textContent=`Открыть поиск в ${brand.name} ↗`;
      serviceSearch.href=service==='youtube'?'https://www.youtube.com/results?search_query='+encodeURIComponent(search.value.trim()):service==='spotify'?'https://open.spotify.com/search/'+encodeURIComponent(search.value.trim()):'https://music.yandex.ru/search?text='+encodeURIComponent(search.value.trim());
      const items=remote!==null?remote:tracks.filter(track=>track.service===service&&(mood==='all'||track.mood===mood)&&`${track.title} ${track.artist}`.toLocaleLowerCase('ru').includes(needle));
      list.replaceChildren();
      for(const track of items){
        const row=document.createElement('li');row.className='catalog-track';row.classList.toggle('selected',selected===track.url);
        const art=image(track.cover,'catalog-cover');art.addEventListener('error',()=>art.classList.add('unavailable'),{once:true});
        const info=document.createElement('div');info.className='catalog-track-info';
        const title=document.createElement('strong');title.textContent=track.title;
        const artist=document.createElement('span');artist.textContent=track.artist;info.append(title,artist);
        const listen=document.createElement('button');listen.type='button';listen.className='catalog-listen';
        listen.textContent=listening===track.id?'■':'▶';listen.setAttribute('aria-label',`${listening===track.id?'Закрыть':'Послушать'} ${track.title}`);
        listen.addEventListener('click',()=>{
          if(listening===track.id){stopPreview();render();return;}
          stopPreview();listening=track.id;preview.hidden=false;
          const close=document.createElement('button');close.type='button';close.className='catalog-preview-close';close.textContent='Закрыть прослушивание ×';
          close.addEventListener('click',()=>{stopPreview();render();});
          preview.append(close,api.frame(api.source(track.url),track.title));render();
        });
        const choose=document.createElement('button');choose.type='button';choose.className='catalog-choose';
        choose.textContent=imported.has(track.url)?'Скачан ✓':track.service==='youtube'?'Скачать и выбрать':'Найти аудио';choose.disabled=importing;choose.setAttribute('aria-label',`Выбрать ${track.artist} — ${track.title}`);
        choose.addEventListener('click',async()=>{
          if(importing)return;
          stopPreview();
          if(track.service!=='youtube'){
            if(track.metadataMissing){
              service='youtube';search.value='';cancelSearch();render();search.focus();
              feedback.textContent='Введи исполнителя и название в поиск YouTube. По этой ссылке название пока неизвестно; аудиофайл не выбран.';
              return;
            }
            service='youtube';search.value=`${track.artist} ${track.title}`.slice(0,100);scheduleSearch();
            feedback.textContent='Для своего плеера выбери аудио на YouTube. Проверь исполнителя и версию: Яндекс Музыка и Spotify не отдают полный аудиофайл по публичной ссылке.';
            return;
          }
          const version=searchVersion;importing=true;render();feedback.textContent='Скачиваем аудио на сервер…';
          try{
            const downloaded=await onSelect(track,{onProgress:text=>{if(version===searchVersion)feedback.textContent=text;}});
            if(version!==searchVersion)return;
            if(!downloaded?.url)throw new Error('Не удалось получить аудиофайл. Попробуй другой трек или загрузи свой файл.');
            selected=track.url;imported.add(track.url);
            feedback.textContent=`${track.artist} — ${track.title}. Аудиофайл скачан. Примени изменения к странице.`;
          }catch(error){if(version===searchVersion&&error.name!=='AbortError')feedback.textContent=error.message;}
          finally{importing=false;render();}
        });
        row.append(art,info,listen,choose);list.append(row);
      }
      root.querySelector('[data-catalog-empty]').hidden=items.length>0;
      root.querySelector('[data-catalog-count]').textContent=`${items.length} треков · ${remote!==null?'поиск':'подборка iwtxz'}`;
    }
    for(const [id,brand] of Object.entries(api.services)) {
      const button=document.createElement('button');button.type='button';button.dataset.service=id;
      button.append(image(brand.icon),document.createTextNode(brand.name));
      button.addEventListener('click',()=>{service=id;stopPreview();feedback.textContent='';scheduleSearch();});tabs.append(button);
    }
    for(const button of root.querySelectorAll('[data-catalog-mood]'))button.addEventListener('click',()=>{
      mood=button.dataset.catalogMood;
      for(const item of root.querySelectorAll('[data-catalog-mood]'))item.setAttribute('aria-pressed',String(item===button));render();
    });
    search.addEventListener('input',scheduleSearch);render();
    return {search(query,nextService='youtube'){service=api.services[nextService]?nextService:'youtube';search.value=String(query||'').slice(0,1000);stopPreview();scheduleSearch();search.focus();},open(url){selected=api.source(url)?.url||url||'';service=api.source(url)?.service||service;render();},close:stopPreview,
      reset(){cancelSearch();stopPreview();selected='';service='yandex';mood='all';search.value='';feedback.textContent='';imported.clear();for(const item of root.querySelectorAll('[data-catalog-mood]'))item.setAttribute('aria-pressed',String(item.dataset.catalogMood==='all'));render();}};
  }
  window.IwtxzMusicCatalog=Object.freeze({create});
})();
