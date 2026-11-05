(() => {
  'use strict';
  const keys=Object.freeze(['avatar','name','description','socials','discord','player','typewriter']);
  const labels={avatar:'Аватар',name:'Ник',description:'Описание',socials:'Соцсети',discord:'Discord',player:'Плеер',typewriter:'Печатная строка'};
  const selectors={avatar:'.profile-avatar-frame, main.panel .avatar',name:'.iwtxz-name-row, #profileName, main.panel .name',description:'.profile-description, main.panel .tagline',socials:'.profile-socials, main.panel .socials',discord:'.discord-profile, main.panel .discord-card',player:'.music-player, .track-card'};
  const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
  function normalizePositions(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const result={};
    for(const key of keys){
      const point=value[key];
      if(!point||typeof point!=='object'||Array.isArray(point))continue;
      const x=Math.round(clamp(point.x,-40,40,0)*1000)/1000,y=Math.round(clamp(point.y,-40,40,0)*1000)/1000;
      if(x||y)result[key]={x,y};
    }
    return result;
  }
  function typewriterPhrases(value){return typeof value==='string'?value.slice(0,300).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).slice(0,12):[];}
  function create(){
    const signal=new AbortController();
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const preview=window.parent!==window&&new URLSearchParams(location.search).get('preview')==='1';
    const nodes=new Map(),originals=new Map();
    let site={},positions={},editing=false,drag=null,raf=0,timer=0,line=null,text=null,phrases=[],phrase=0,character=0,deleting=false,paused=false,typeKey='',disposed=false;
    function styleSnapshot(node){return {translate:node.style.getPropertyValue('translate'),tabindex:node.getAttribute('tabindex')};}
    function effectiveZoom(node){let zoom=1;for(let element=node;element;element=element.parentElement){const value=getComputedStyle(element).zoom;const factor=value?.endsWith('%')?parseFloat(value)/100:parseFloat(value);if(Number.isFinite(factor)&&factor>0)zoom*=factor;}return zoom;}
    function renderPoint(key){
      const node=nodes.get(key);if(!node)return;
      const initial=originals.get(node);node.style.setProperty('translate',initial?.translate||'none');
      const point=positions[key];if(!point)return;
      const rect=node.getBoundingClientRect();if(!rect.width&&!rect.height)return;
      const margin=8,zoom=effectiveZoom(node);
      // Forty stored units span one viewport, so every block can reach the entire page.
      let x=innerWidth*point.x/40,y=innerHeight*point.y/40;
      // Keep each block reachable on narrower screens without changing its saved position.
      const visibleX=Math.min(rect.width,innerWidth-margin*2),visibleY=Math.min(rect.height,innerHeight-margin*2);
      const minX=margin-rect.left,maxX=innerWidth-margin-rect.left-visibleX;
      const minY=margin-rect.top,maxY=innerHeight-margin-rect.top-visibleY;
      x=Math.min(Math.max(x,minX),Math.max(minX,maxX));y=Math.min(Math.max(y,minY),Math.max(minY,maxY));
      node.style.setProperty('translate',`${x/zoom}px ${y/zoom}px`);
    }
    function renderPositions(){raf=0;for(const key of nodes.keys())renderPoint(key);}
    function scheduleRender(){if(!raf)raf=requestAnimationFrame(renderPositions);}
    function refreshNodes(){
      for(const [key,selector] of Object.entries(selectors)){
        const node=document.querySelector(selector);if(!node)continue;
        nodes.set(key,node);if(!originals.has(node))originals.set(node,styleSnapshot(node));
      }
      if(line){nodes.set('typewriter',line);if(!originals.has(line))originals.set(line,styleSnapshot(line));}
      for(const [key,node] of nodes){node.dataset.layoutBlock=key;node.classList.add('iwtxz-layout-block');}
      decorateEditing();scheduleRender();
    }
    function decorateEditing(){
      document.body.classList.toggle('iwtxz-layout-editing',editing);
      for(const [key,node] of nodes){
        node.classList.toggle('iwtxz-layout-draggable',editing);
        if(editing){node.setAttribute('tabindex','0');node.dataset.layoutLabel=labels[key];}
        else{const initial=originals.get(node);if(initial?.tabindex===null)node.removeAttribute('tabindex');else if(initial?.tabindex!==undefined)node.setAttribute('tabindex',initial.tabindex);delete node.dataset.layoutLabel;}
      }
    }
    function publish(){if(preview)window.parent.postMessage({type:'iwtxz-layout-change',positions:normalizePositions(positions)},location.origin);}
    function stopDrag(save=true){if(!drag)return;const active=drag;drag=null;active.node.classList.remove('is-layout-dragging');try{active.node.releasePointerCapture(active.pointerId);}catch{}if(save)publish();}
    function setEditing(value){editing=preview&&Boolean(value);if(!editing)stopDrag();decorateEditing();}
    function blockFrom(event){const target=event.target?.closest?.('[data-layout-block]');return target&&nodes.get(target.dataset.layoutBlock)===target?target:null;}
    document.addEventListener('pointerdown',event=>{
      if(!editing||event.button!==0)return;const node=blockFrom(event);if(!node)return;
      event.preventDefault();event.stopPropagation();
      const key=node.dataset.layoutBlock,point=positions[key]||{x:0,y:0};
      drag={key,node,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:point.x,y:point.y};
      node.classList.add('is-layout-dragging');node.focus({preventScroll:true});
      try{node.setPointerCapture(event.pointerId);}catch{}
    },{capture:true,signal:signal.signal});
    document.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();
      positions[drag.key]={x:clamp(drag.x+(event.clientX-drag.startX)/innerWidth*40,-40,40,0),y:clamp(drag.y+(event.clientY-drag.startY)/innerHeight*40,-40,40,0)};
      scheduleRender();
    },{passive:false,signal:signal.signal});
    document.addEventListener('pointerup',event=>{if(drag&&event.pointerId===drag.pointerId)stopDrag();},{signal:signal.signal});
    document.addEventListener('pointercancel',()=>stopDrag(),{signal:signal.signal});
    document.addEventListener('click',event=>{if(editing&&blockFrom(event)){event.preventDefault();event.stopPropagation();}},{capture:true,signal:signal.signal});
    document.addEventListener('keydown',event=>{
      if(!editing)return;
      if(event.key==='Escape'){setEditing(false);if(preview)window.parent.postMessage({type:'iwtxz-layout-edit-ended'},location.origin);return;}
      const node=blockFrom(event),direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!node||!direction)return;
      event.preventDefault();event.stopPropagation();const key=node.dataset.layoutBlock,point=positions[key]||{x:0,y:0},step=event.shiftKey?10:1;
      positions[key]={x:clamp(point.x+direction[0]*step/innerWidth*40,-40,40,0),y:clamp(point.y+direction[1]*step/innerHeight*40,-40,40,0)};renderPoint(key);publish();
    },{capture:true,signal:signal.signal});
    addEventListener('message',event=>{if(preview&&event.source===window.parent&&event.origin===location.origin&&event.data?.type==='iwtxz-layout-edit')setEditing(event.data.enabled===true);},{signal:signal.signal});
    function stopTyping(){clearTimeout(timer);timer=0;}
    function canType(){return !disposed&&!document.hidden&&!paused&&site.typewriterEnabled&&phrases.length&&document.body.classList.contains('is-entered')&&!reduced.matches;}
    function tick(){
      timer=0;if(!canType())return;
      const letters=Array.from(phrases[phrase]);character+=deleting?-1:1;character=Math.max(0,Math.min(letters.length,character));text.textContent=letters.slice(0,character).join('');
      let delay=deleting?Math.max(20,clamp(site.typewriterSpeed,20,200,70)*.48):clamp(site.typewriterSpeed,20,200,70);
      if(!deleting&&character===letters.length){deleting=true;delay=1700;}
      else if(deleting&&character===0){deleting=false;phrase=(phrase+1)%phrases.length;delay=400;}
      timer=setTimeout(tick,delay);
    }
    function runTyping(){stopTyping();if(!line||!site.typewriterEnabled||!phrases.length)return;if(reduced.matches){text.textContent=phrases[0];return;}if(canType())timer=setTimeout(tick,clamp(site.typewriterSpeed,20,200,70));}
    function applyTypewriter(){
      const list=typewriterPhrases(site.typewriterText);const key=JSON.stringify([Boolean(site.typewriterEnabled),list,site.typewriterSpeed]);
      if(key===typeKey)return;typeKey=key;phrases=list;phrase=0;character=0;deleting=false;stopTyping();
      if(!site.typewriterEnabled||!phrases.length){if(line)line.hidden=true;return;}
      if(!line){line=document.createElement('p');line.className='iwtxz-typewriter-line';line.setAttribute('aria-live','off');text=document.createElement('span');const caret=document.createElement('span');caret.className='iwtxz-typewriter-caret';caret.setAttribute('aria-hidden','true');caret.textContent='▌';line.append(text,caret);document.body.append(line);}
      line.hidden=false;text.textContent='';runTyping();
    }
    addEventListener('resize',scheduleRender,{passive:true,signal:signal.signal});
    document.addEventListener('visibilitychange',runTyping,{signal:signal.signal});
    addEventListener('iwtxz-preview-visibility',event=>{paused=event.detail===false;runTyping();},{signal:signal.signal});
    reduced.addEventListener('change',runTyping,{signal:signal.signal});
    const observer=new MutationObserver(runTyping);observer.observe(document.body,{attributes:true,attributeFilter:['class']});
    function dispose(){if(disposed)return;disposed=true;stopTyping();signal.abort();observer.disconnect();cancelAnimationFrame(raf);stopDrag(false);document.body.classList.remove('iwtxz-layout-editing');for(const node of nodes.values()){const initial=originals.get(node);node.style.setProperty('translate',initial?.translate||'');node.classList.remove('iwtxz-layout-block','iwtxz-layout-draggable','is-layout-dragging');delete node.dataset.layoutBlock;delete node.dataset.layoutLabel;if(initial?.tabindex===null)node.removeAttribute('tabindex');else if(initial?.tabindex!==undefined)node.setAttribute('tabindex',initial.tabindex);}line?.remove();}
    addEventListener('pagehide',event=>{if(event.persisted)stopTyping();else dispose();},{signal:signal.signal});
    addEventListener('pageshow',runTyping,{signal:signal.signal});
    return {apply(settings){if(disposed)return;site=settings||{};positions=normalizePositions(site.objectPositions);for(const element of document.querySelectorAll('.profile-description, main.panel .tagline, main.panel .tagline-text'))element.style.setProperty('font-size',`${clamp(site.descriptionSize,10,32,16)}px`);applyTypewriter();refreshNodes();},setEditing,reset(){positions={};renderPositions();publish();},dispose};
  }
  window.IwtxzProfileLayout=Object.freeze({create,normalizePositions,typewriterPhrases,keys});
})();
