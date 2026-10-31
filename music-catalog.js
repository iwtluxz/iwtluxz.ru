(() => {
  'use strict';
  function create({onSelect}) {
    const root=document.querySelector('#musicCatalog'),api=window.IwtxzMusicServices;
    if(!root||!api)return null;
    const tracks=window.IwtxzMusicCatalogData?.tracks||[];
    const tabs=root.querySelector('[data-catalog-services]'),list=root.querySelector('[data-catalog-tracks]');
    const search=root.querySelector('[data-catalog-search]'),preview=root.querySelector('[data-catalog-preview]');
    const feedback=root.querySelector('[data-catalog-status]');
    let service='yandex',mood='all',selected='',listening='';
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
      const items=tracks.filter(track=>track.service===service&&(mood==='all'||track.mood===mood)&&`${track.title} ${track.artist}`.toLocaleLowerCase('ru').includes(needle));
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
        choose.textContent=selected===track.url?'Выбран ✓':'Выбрать';choose.setAttribute('aria-label',`Выбрать ${track.artist} — ${track.title}`);
        choose.addEventListener('click',()=>{selected=track.url;stopPreview();onSelect(track);feedback.textContent=`${track.artist} — ${track.title}. Примени изменения к странице.`;render();});
        row.append(art,info,listen,choose);list.append(row);
      }
      root.querySelector('[data-catalog-empty]').hidden=items.length>0;
      root.querySelector('[data-catalog-count]').textContent=`${items.length} треков · подборка iwtxz`;
    }
    for(const [id,brand] of Object.entries(api.services)) {
      const button=document.createElement('button');button.type='button';button.dataset.service=id;
      button.append(image(brand.icon),document.createTextNode(brand.name));
      button.addEventListener('click',()=>{service=id;stopPreview();feedback.textContent='';render();});tabs.append(button);
    }
    for(const button of root.querySelectorAll('[data-catalog-mood]'))button.addEventListener('click',()=>{
      mood=button.dataset.catalogMood;
      for(const item of root.querySelectorAll('[data-catalog-mood]'))item.setAttribute('aria-pressed',String(item===button));render();
    });
    search.addEventListener('input',render);render();
    return {open(url){selected=api.source(url)?.url||url||'';service=api.source(url)?.service||service;render();},close:stopPreview,
      reset(){stopPreview();selected='';service='yandex';mood='all';search.value='';feedback.textContent='';for(const item of root.querySelectorAll('[data-catalog-mood]'))item.setAttribute('aria-pressed',String(item.dataset.catalogMood==='all'));render();}};
  }
  window.IwtxzMusicCatalog=Object.freeze({create});
})();
