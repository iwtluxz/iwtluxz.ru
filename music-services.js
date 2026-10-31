(() => {
  'use strict';
  const services=Object.freeze({
    yandex:{name:'Яндекс Музыка',icon:'/img/music/yandex.png',tagline:'Твоя волна на тёмной стороне'},
    youtube:{name:'YouTube',icon:'/img/socials/youtube.svg',tagline:'Звуки, которые остаются с тобой'},
    spotify:{name:'Spotify',icon:'/img/socials/spotify.svg',tagline:'Собери настроение своей страницы'}
  });
  function source(value) {
    try {
      const url=new URL(value);
      if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
      const host=url.hostname.toLowerCase();let match,id,service,canonical,embed;
      if(['music.yandex.ru','music.yandex.com','music.yandex.by','music.yandex.kz'].includes(host)) {
        match=url.pathname.match(/^\/album\/(\d+)\/track\/(\d+)\/?$/);
        if(!match)return null;
        service='yandex';id=match[2];canonical=`https://music.yandex.ru/album/${match[1]}/track/${id}`;
        embed=`https://music.yandex.ru/iframe/#track/${id}/${match[1]}`;
      } else if(host==='open.spotify.com') {
        match=url.pathname.match(/^\/(?:intl-[a-z]{2}\/|embed\/)?track\/([A-Za-z0-9]{22})\/?$/);
        if(!match)return null;
        service='spotify';id=match[1];canonical=`https://open.spotify.com/track/${id}`;
        embed=`https://open.spotify.com/embed/track/${id}?theme=0`;
      } else if(['youtube.com','www.youtube.com','music.youtube.com','youtu.be'].includes(host)) {
        id=host==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})\/?$/)?.[1];
        if(!/^[\w-]{11}$/.test(id||''))return null;
        service='youtube';canonical=`https://www.youtube.com/watch?v=${id}`;
        embed=`https://www.youtube.com/embed/${id}?playsinline=1&rel=0`;
      } else return null;
      return {service,id,url:canonical,embed,...services[service]};
    }catch{return null;}
  }
  function frame(track,title) {
    const iframe=document.createElement('iframe');
    iframe.src=track.embed;iframe.title=`${track.name}: ${title||'Музыка'}`;
    iframe.allow='autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.referrerPolicy='strict-origin-when-cross-origin';iframe.allowFullscreen=true;
    iframe.height=track.service==='youtube'?'220':track.service==='yandex'?'180':'152';
    return iframe;
  }
  function createPlayer() {
    let root=null,current=null;
    const visible=()=>document.body.classList.contains('is-entered');
    function mount() {
      if(!root||!current||!visible())return;
      root.hidden=false;
      if(!root.querySelector('iframe'))root.querySelector('.service-player-content').append(frame(current,current.title));
    }
    new MutationObserver(mount).observe(document.body,{attributes:true,attributeFilter:['class']});
    return {apply(value,title) {
      const next=source(value);
      document.body.classList.toggle('has-service-music',Boolean(next));
      if(!next){root?.remove();root=null;current=null;return false;}
      if(current?.url===next.url){current.title=title;mount();return true;}
      current={...next,title};root?.remove();
      root=document.createElement('section');root.className='service-player';root.dataset.musicService=next.service;
      root.setAttribute('aria-label',`Музыка — ${next.name}`);root.hidden=true;
      const heading=document.createElement('div');heading.className='service-player-heading';
      const icon=document.createElement('img');icon.src=next.icon;icon.alt='';
      const label=document.createElement('span');label.textContent=next.name;
      const link=document.createElement('a');link.href=next.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть ↗';
      heading.append(icon,label,link);
      const content=document.createElement('div');content.className='service-player-content';
      root.append(heading,content);document.body.append(root);mount();return true;
    }};
  }
  window.IwtxzMusicServices=Object.freeze({services,source,frame,createPlayer});
})();
