(() => {
  'use strict';
  const categories=Object.freeze([
    {id:'anime',label:'Аниме и настроение',description:'Ушки, эмоции и яркие персонажи'},
    {id:'nature',label:'Природа',description:'Цветы, вода и светящиеся огоньки'},
    {id:'space',label:'Космос',description:'Орбиты, созвездия и северное сияние'},
    {id:'magic',label:'Магия',description:'Руны, порталы и легендарное пламя'},
    {id:'cyber',label:'Кибер',description:'Неон, глитч и цифровое свечение'},
    {id:'cozy',label:'Уютное',description:'Маленькие детали для твоей страницы'}
  ].map(Object.freeze));
  const rows=[
    ['phoenix','Феникс','Phoenix','magic','a_0e839cd79500e7b68e2bbbed54790c28'],
    ['heartbloom','Цветение','Heartbloom','nature','a_3e1fc3c7ee2e34e8176f4737427e8f4f'],
    ['shy','Смущение','Shy','anime','a_6b793a5f7e4e15eea6b10a4fde448511'],
    ['sakura','Сакура','Sakura Warrior','anime','a_7cf09c7e78d6eb35ae354acc1d5cc676'],
    ['moon','Лунные фазы','Faces of the Moon','space','a_50cfb73a4c52235363491855d3c3c3bc'],
    ['embers','Огоньки','Spirit Embers','magic','a_1005898c6acf56a9ac5010baf444f6fd'],
    ['aurora','Аврора','Aurora','space','a_386445551be850bb16b73a225d0d0602'],
    ['cat','Кошачьи ушки','Cat Ears','anime','a_c3cffc19e9784f7d0b005eecdf1b566e'],
    ['rainbow','Радужный Хью','Hugh the Rainbow','anime','a_0c0eeb351ae2cf48c6e1eee2cae49d40'],
    ['firecrackers','Фейерверк','Firecrackers','magic','a_0f4f1b40921ce680b60007e94427d1f2'],
    ['flame-sword','Огненный меч','Flaming Sword','magic','a_0f5d6c4dd8ae74662ee9c40722a56cbd'],
    ['steampunk-cat','Стимпанк-ушки','Steampunk Cat Ears','anime','a_1acbe609daec21fa5b866df9e5a42cb7'],
    ['potion','Волшебное зелье','Magical Potion','magic','a_1dbc603c181999b9815cb426dfec71a6'],
    ['lotus','Цветок лотоса','Lotus Flower','nature','a_2e55d644e11acb6253dfa422eff16dfd'],
    ['snowglobe','Снежный шар','Snowglobe','cozy','a_2ca5fb1ecf0dac410b38d76cb4aae7f9'],
    ['bubble-tea','Бабл-ти','Bubble Tea','cozy','a_5b1319abfc9f928479b68a73635f591d'],
    ['black-hole','Чёрная дыра','Black Hole','space','a_6d16b27d9415cafe3b289053644337c4'],
    ['ufo','НЛО','UFO','space','a_6fdbddb6229453eac3bbb212edf5cd1c'],
    ['fox-hat','Лисья шапка','Fox Hat','anime','a_7d305bca6cf371df98c059f9d2ef05e4'],
    ['lovestruck','Влюблённость','Lovestruck','anime','a_7f44d538ec830f479605f7bf8720afda'],
    ['crystal-ball','Хрустальный шар','Crystal Ball Blue','magic','a_8ee8ae54bddfcb17d7d5c5f9bce41c0d'],
    ['hex-lights','Светящиеся грани','Hex Lights','cyber','a_09bb4197c743ea31b7eb052eddd3e892'],
    ['solar-orbit','Солнечная орбита','Solar Orbit','space','a_9a6bf0ab30a6719d6eb09fa4996984ca'],
    ['honeyblossom','Медовое цветение','Honeyblossom','nature','a_27bbf0b53b1054cf61e9a4c0e8d4027f'],
    ['heartstrings','Сердечные нити','Heartstrings Blue','cozy','a_42cc3fe7133523096466102e7a222003'],
    ['chromawave','Хроматическая волна','Chromawave','cyber','a_49c479e15533fb4c02eb320c9c137433'],
    ['koi','Пруд с кои','Koi Pond','nature','a_50b440810b1bbd89f6284f36d40ad0af'],
    ['portal-blue','Синий портал','Magic Portal Blue','magic','a_98cf94e029ac79c5b377413d1a2bd82f'],
    ['cozy-cat','Уютный кот','Cozy Cat','cozy','a_77b7b6a740a9451e1ef39c0252154ef8'],
    ['lightning','Молния','Lightning','cyber','a_365eed4178528fe8293c4212e8e2d5cb'],
    ['constellations','Созвездия','Constellations','space','a_8552f9857793aed0cf816f370e2df3be'],
    ['head-clouds','В облаках','Head in the Clouds','cozy','a_670b722e56740d11d1e6fe55b8094013'],
    ['strawberry','Клубничная лоза','Strawberry Vine','nature','a_9867b1ba56601e745cfe741e6b00b835'],
    ['neon-cat','Неоновый кот','Neon Nibbles','cyber','a_126219d37fa9422dab6a075064453750'],
    ['runes','Светящиеся руны','Glowing Runes','magic','a_d650e22f6c4bab4fc0969e9d35edbcb0'],
    ['rainy-mood','Дождливое настроение','Rainy Mood','cozy','a_e8c11f139e55dac538cdaafb3caa2317'],
    ['glitch-frame','Глитч','Glitch','cyber','a_e90ebc0114e7bdc30353c8b11953ea41']
  ];
  const items=Object.freeze(rows.map(([id,label,originalLabel,category,asset])=>Object.freeze({id,label,originalLabel,category,asset,image:`/img/avatar-decorations/${id}.png`,thumbnail:`/img/avatar-decorations/${id}.webp`,source:`https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=240&passthrough=true`})));
  const known=new Set(['none','discord',...items.map(item=>item.id)]);
  function createPicker({root,input,onSelect,onRender,getAvatarSource}={}){
    if(!root||!input)return null;
    const controller=new AbortController();
    let category='all',query='',selected=known.has(input.value)?input.value:'none',avatar='';
    const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
    const shell=make('div','decoration-browser');
    const header=make('div','decoration-browser-heading');
    header.append(make('strong','','Украшения аватара'),make('span','',`${items.length} из коллекции Discord`));
    const search=make('input','decoration-search');search.type='search';search.maxLength=80;search.placeholder='Найти украшение';search.setAttribute('aria-label','Поиск украшений');
    const tabs=make('div','decoration-categories');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Коллекции украшений');
    const count=make('p','decoration-result-count');count.setAttribute('role','status');count.setAttribute('aria-live','polite');
    const scroll=make('div','decoration-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','Каталог украшений аватара');
    const selectedNote=make('p','decoration-selection-note');
    shell.append(header,search,tabs,count,scroll,selectedNote);
    root.classList.add('decoration-catalog-host');root.replaceChildren(shell);
    function tile(item){
      const button=make('button','decoration-option');button.type='button';button.dataset.decoration=item.id;button.title=item.originalLabel||item.label;
      const preview=make('span','decoration-preview');
      const face=make('img','decoration-user-avatar');face.dataset.decorationAvatar='';face.src=avatar||'img/tree.png';face.alt='';face.decoding='async';face.loading='lazy';
      preview.append(face);
      if(item.thumbnail){const art=make('img','decoration-art');art.src=item.thumbnail;art.alt='';art.loading='lazy';art.decoding='async';preview.append(art);}
      else preview.append(make('span','decoration-mode',item.id==='discord'?'DS':'—'));
      button.append(preview,make('span','decoration-label',item.label));
      if(item.originalLabel)button.setAttribute('aria-label',`${item.label} · ${item.originalLabel}`);
      button.addEventListener('click',()=>{selected=item.id;input.value=item.id;updateSelection();onSelect?.(item.id);},{signal:controller.signal});
      return button;
    }
    function updateSelection(){
      root.querySelectorAll('[data-decoration]').forEach(button=>{const active=button.dataset.decoration===selected;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
      const choice=items.find(item=>item.id===selected);selectedNote.textContent=selected==='discord'?'Из Discord · текущее украшение твоего аккаунта':choice?`Выбрано: ${choice.label} · ${choice.originalLabel}`:'Без украшения';
    }
    function render(){
      avatar=getAvatarSource?.()||avatar||'img/tree.png';
      scroll.replaceChildren();
      const matches=items.filter(item=>(category==='all'||item.category===category)&&`${item.label} ${item.originalLabel}`.toLocaleLowerCase('ru').includes(query));
      if(category==='all'&&!query){const quick=make('div','decoration-quick-options');quick.append(tile({id:'none',label:'Без украшения'}),tile({id:'discord',label:'Из Discord'}));scroll.append(quick);}
      for(const group of categories){
        const groupItems=matches.filter(item=>item.category===group.id);if(!groupItems.length)continue;
        const section=make('section','decoration-collection');const heading=make('div','decoration-collection-heading');
        heading.append(make('h4','',group.label),make('span','',`${groupItems.length}`));
        const grid=make('div','decoration-collection-grid');groupItems.forEach(item=>grid.append(tile(item)));
        section.append(heading,make('p','decoration-collection-description',group.description),grid);scroll.append(section);
      }
      if(!matches.length)scroll.append(make('p','decoration-empty','Ничего не найдено. Попробуй другое название.'));
      count.textContent=`${matches.length} ${query?'по запросу':'украшений'}`;
      tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===category)));
      updateSelection();onRender?.();
    }
    for(const group of [{id:'all',label:'Все'},...categories]){
      const button=make('button','',group.id==='all'?'Все':group.label);button.type='button';button.dataset.category=group.id;button.setAttribute('aria-pressed',String(group.id==='all'));
      button.addEventListener('click',()=>{category=group.id;render();scroll.scrollTop=0;},{signal:controller.signal});tabs.append(button);
    }
    search.addEventListener('input',()=>{query=search.value.trim().toLocaleLowerCase('ru');render();scroll.scrollTop=0;},{signal:controller.signal});
    render();
    return Object.freeze({
      update(value,source){selected=known.has(value)?value:'none';if(source&&source!==avatar){avatar=source;root.querySelectorAll('[data-decoration-avatar]').forEach(image=>{image.src=source;});}updateSelection();},
      dispose(){controller.abort();root.replaceChildren();root.classList.remove('decoration-catalog-host');}
    });
  }
  window.IwtxzAvatarDecorations=Object.freeze({items,categories,createPicker});
})();
