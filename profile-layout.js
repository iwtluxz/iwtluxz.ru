(() => {
  'use strict';
  try { window.IwtxzHalloween?.create?.({cabinet:false})?.dispose?.(); } catch {}
  const retiredTheme=Object.freeze({apply(){},dispose(){}});
  window.IwtxzHalloween=Object.freeze({create:()=>retiredTheme});
  document.querySelectorAll?.('.halloween-scene,.halloween-controls,link[href*="halloween.css"]').forEach(node=>node.remove());
  document.body.classList.remove('iwtxz-halloween','halloween-paused','halloween-reduced-motion');
  if(document.body.dataset)delete document.body.dataset.halloweenSurface;
  try { window.localStorage?.setItem('iwtxz:halloween:enabled','0'); } catch {}
  window.iwtxzTabTitleManaged=true;
  const keys=Object.freeze(['avatar','name','description','socials','discord','player']);
  const labels={avatar:'Аватар',name:'Ник',description:'Описание',socials:'Соцсети',discord:'Discord',player:'Плеер'};
  const selectors={avatar:'.profile-avatar-frame, main.panel .avatar',name:'.iwtxz-name-row, #profileName, main.panel .name',description:'.profile-description, main.panel .tagline',socials:'.profile-socials, main.panel .socials',discord:'.discord-profile, main.panel .discord-card',player:'.music-player, .track-card'};
  const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
  const cleanPoint=(x,y)=>({x:Math.round(clamp(x,-40,40,0)*1000)/1000,y:Math.round(clamp(y,-40,40,0)*1000)/1000});
  function normalizePositions(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const result={};
    for(const key of keys){
      const point=value[key];if(!point||typeof point!=='object'||Array.isArray(point))continue;
      // Zero is meaningful in v2: it anchors the block at the actual viewport center.
      result[key]=cleanPoint(point.x,point.y);
    }
    return result;
  }
  function typewriterPhrases(value){return typeof value==='string'?value.slice(0,300).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).slice(0,12):[];}
  function normalizeGrid(value={}){
    return {visible:value.visible===true,snap:value.snap!==false,centerLines:value.centerLines!==false,step:Math.round(clamp(value.step,8,80,24)),opacity:clamp(value.opacity,0,100,15),color:/^#[0-9a-f]{6}$/i.test(value.color||'')?value.color:'#ffffff'};
  }
  function create(){
    const signal=new AbortController(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const preview=window.parent!==window&&new URLSearchParams(location.search).get('preview')==='1';
    const nodes=new Map(),originals=new Map(),initialTitle=document.title||'iwtxz';
    let site={},positions={},modelVersion=1,editing=false,selected='',drag=null,raf=0,timer=0,grid=normalizeGrid(),gridNode=null,guidesNode=null;
    let phrases=[],phrase=0,character=0,deleting=false,paused=false,typeKey='',baseTitle=initialTitle,disposed=false;
    const post=data=>{if(preview)window.parent.postMessage(data,location.origin);};
    function styleSnapshot(node){return {translate:node.style.getPropertyValue('translate'),tabindex:node.getAttribute('tabindex')};}
    function effectiveZoom(node){let zoom=1;for(let element=node;element;element=element.parentElement){const value=getComputedStyle(element).zoom,factor=value?.endsWith('%')?parseFloat(value)/100:parseFloat(value);if(Number.isFinite(factor)&&factor>0)zoom*=factor;}return zoom;}
    function centerPoint(node){const box=node.getBoundingClientRect();return cleanPoint(((box.left+box.width/2)/innerWidth-.5)*80,((box.top+box.height/2)/innerHeight-.5)*80);}
    function renderPoint(key){
      const node=nodes.get(key);if(!node)return;
      node.style.setProperty('translate',originals.get(node)?.translate||'none');
      const point=positions[key];if(!point)return;
      const box=node.getBoundingClientRect();if(!box.width&&!box.height)return;
      const zoom=effectiveZoom(node),margin=8;let x,y;
      if(modelVersion>=2){
        x=(.5+point.x/80)*innerWidth-(box.left+box.width/2);
        y=(.5+point.y/80)*innerHeight-(box.top+box.height/2);
      }else{x=innerWidth*point.x/40;y=innerHeight*point.y/40;}
      const minX=margin-box.left,maxX=innerWidth-margin-box.left-Math.min(box.width,innerWidth-margin*2);
      const minY=margin-box.top,maxY=innerHeight-margin-box.top-Math.min(box.height,innerHeight-margin*2);
      x=Math.min(Math.max(x,minX),Math.max(minX,maxX));y=Math.min(Math.max(y,minY),Math.max(minY,maxY));
      node.style.setProperty('translate',`${x/zoom}px ${y/zoom}px`);
    }
    function renderGrid(){
      if(!preview)return;
      if(grid.visible&&!gridNode){
        gridNode=document.createElement('div');gridNode.className='iwtxz-layout-grid';gridNode.setAttribute('aria-hidden','true');
        guidesNode=document.createElement('div');guidesNode.className='iwtxz-layout-guides';guidesNode.setAttribute('aria-hidden','true');document.body.append(gridNode,guidesNode);
      }
      if(!gridNode)return;
      gridNode.hidden=!grid.visible;guidesNode.hidden=!grid.visible||!grid.centerLines;
      gridNode.style.setProperty('--layout-grid-step',`${grid.step}px`);gridNode.style.color=grid.color;gridNode.style.opacity=String(grid.opacity/100);
      gridNode.style.backgroundPosition=`${innerWidth/2}px ${innerHeight/2}px`;
      guidesNode.style.color=grid.color;guidesNode.style.opacity=String(Math.min(1,grid.opacity/100+.35));
    }
    function renderPositions(){raf=0;for(const key of nodes.keys())renderPoint(key);renderGrid();}
    function scheduleRender(){if(!disposed&&!raf)raf=requestAnimationFrame(renderPositions);}
    const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(scheduleRender):null;
    function refreshNodes(){
      for(const [key,selector] of Object.entries(selectors)){
        const node=document.querySelector(selector);if(!node)continue;
        nodes.set(key,node);if(!originals.has(node)){originals.set(node,styleSnapshot(node));resizeObserver?.observe(node);}
        node.dataset.layoutBlock=key;node.classList.add('iwtxz-layout-block');
      }
      decorateEditing();scheduleRender();
    }
    function setSelected(key){
      selected=nodes.has(key)?key:'';
      for(const [id,node] of nodes)node.classList.toggle('is-layout-selected',editing&&selected===id);
      post({type:'iwtxz-layout-selected',key:selected,label:labels[selected]||''});
    }
    function decorateEditing(){
      document.body.classList.toggle('iwtxz-layout-editing',editing);
      for(const [key,node] of nodes){
        node.classList.toggle('iwtxz-layout-draggable',editing);node.classList.toggle('is-layout-selected',editing&&key===selected);
        if(editing){node.setAttribute('tabindex','0');node.dataset.layoutLabel=labels[key];}
        else{const initial=originals.get(node);if(initial?.tabindex===null)node.removeAttribute('tabindex');else if(initial?.tabindex!==undefined)node.setAttribute('tabindex',initial.tabindex);delete node.dataset.layoutLabel;}
      }
    }
    function publish(){post({type:'iwtxz-layout-change',positions:normalizePositions(positions),layoutVersion:modelVersion});}
    function convertLegacy(){
      if(modelVersion>=2)return;
      renderPositions();const converted={};for(const key of Object.keys(positions)){const node=nodes.get(key);if(node)converted[key]=centerPoint(node);}
      positions=converted;modelVersion=2;publish();
    }
    function stopDrag(save=true){if(!drag)return;const active=drag;drag=null;active.node.classList.remove('is-layout-dragging');try{active.node.releasePointerCapture(active.pointerId);}catch{}if(save)publish();}
    function setEditing(value){editing=preview&&Boolean(value);if(editing)convertLegacy();else{stopDrag();setSelected('');}decorateEditing();renderGrid();}
    function blockFrom(event){const target=event.target?.closest?.('[data-layout-block]');return target&&nodes.get(target.dataset.layoutBlock)===target?target:null;}
    function snappedPoint(x,y){
      if(grid.snap){x=innerWidth/2+Math.round((x-innerWidth/2)/grid.step)*grid.step;y=innerHeight/2+Math.round((y-innerHeight/2)/grid.step)*grid.step;
        if(grid.centerLines){if(Math.abs(x-innerWidth/2)<=8)x=innerWidth/2;if(Math.abs(y-innerHeight/2)<=8)y=innerHeight/2;}}
      return cleanPoint((x/innerWidth-.5)*80,(y/innerHeight-.5)*80);
    }
    document.addEventListener('pointerdown',event=>{
      if(!editing||event.button!==0)return;const node=blockFrom(event);if(!node)return;
      event.preventDefault();event.stopPropagation();convertLegacy();setSelected(node.dataset.layoutBlock);
      const box=node.getBoundingClientRect();drag={key:node.dataset.layoutBlock,node,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:box.left+box.width/2,y:box.top+box.height/2};
      node.classList.add('is-layout-dragging');node.focus({preventScroll:true});try{node.setPointerCapture(event.pointerId);}catch{}
    },{capture:true,signal:signal.signal});
    document.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();positions[drag.key]=snappedPoint(drag.x+event.clientX-drag.startX,drag.y+event.clientY-drag.startY);scheduleRender();},{passive:false,signal:signal.signal});
    document.addEventListener('pointerup',event=>{if(drag&&event.pointerId===drag.pointerId)stopDrag();},{signal:signal.signal});
    document.addEventListener('pointercancel',()=>stopDrag(),{signal:signal.signal});
    document.addEventListener('click',event=>{if(editing&&blockFrom(event)){event.preventDefault();event.stopPropagation();}},{capture:true,signal:signal.signal});
    document.addEventListener('focusin',event=>{if(editing){const node=blockFrom(event);if(node)setSelected(node.dataset.layoutBlock);}},{signal:signal.signal});
    document.addEventListener('keydown',event=>{
      if(!editing)return;if(event.key==='Escape'){setEditing(false);post({type:'iwtxz-layout-edit-ended'});return;}
      const node=blockFrom(event),direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!node||!direction)return;
      event.preventDefault();event.stopPropagation();convertLegacy();setSelected(node.dataset.layoutBlock);
      const point=centerPoint(node),step=event.shiftKey?(grid.snap?grid.step:10):1;
      positions[node.dataset.layoutBlock]=cleanPoint(point.x+direction[0]*step/innerWidth*80,point.y+direction[1]*step/innerHeight*80);renderPoint(node.dataset.layoutBlock);publish();
    },{capture:true,signal:signal.signal});
    function setGrid(value){grid=normalizeGrid({...grid,...value});renderGrid();}
    function align(axis){
      if(!editing||!nodes.has(selected)||!['horizontal','vertical','both'].includes(axis))return;
      convertLegacy();const point=centerPoint(nodes.get(selected));if(axis==='horizontal'||axis==='both')point.x=0;if(axis==='vertical'||axis==='both')point.y=0;
      positions[selected]=point;renderPoint(selected);publish();
    }
    addEventListener('message',event=>{
      if(!preview||event.source!==window.parent||event.origin!==location.origin)return;
      if(event.data?.type==='iwtxz-layout-edit')setEditing(event.data.enabled===true);
      if(event.data?.type==='iwtxz-layout-grid')setGrid(event.data.grid||event.data);
      if(event.data?.type==='iwtxz-layout-align')align(event.data.axis);
    },{signal:signal.signal});
    function setTitle(prefix){
      const title=`${prefix} | iwtxz`;if(document.title!==title)document.title=title;
      if(window.parent!==window)window.parent.postMessage({type:preview?'iwtxz-title-preview':'iwtxz-public-profile-title',title},location.origin);
    }
    function stopTyping(){clearTimeout(timer);timer=0;}
    function canType(){return !disposed&&!document.hidden&&!paused&&site.typewriterEnabled===true&&phrases.length&&!reduced.matches;}
    function tick(){
      timer=0;if(!canType())return;const letters=Array.from(phrases[phrase]);character=Math.max(0,Math.min(letters.length,character+(deleting?-1:1)));setTitle(letters.slice(0,character).join(''));
      let delay=deleting?Math.max(20,clamp(site.typewriterSpeed,20,200,70)*.48):clamp(site.typewriterSpeed,20,200,70);
      if(!deleting&&character===letters.length){deleting=true;delay=1700;}else if(deleting&&character===0){deleting=false;phrase=(phrase+1)%phrases.length;delay=400;}
      timer=setTimeout(tick,delay);
    }
    function runTyping(){if(!canType()){stopTyping();if(site.typewriterEnabled&&phrases.length&&reduced.matches)setTitle(phrases[0]);return;}if(!timer)timer=setTimeout(tick,clamp(site.typewriterSpeed,20,200,70));}
    function applyTypewriter(){
      const prefix=String(site.title||site.nickname||initialTitle.replace(/\s*\|\s*iwtxz$/i,'')||'iwtxz').slice(0,80),list=typewriterPhrases(site.typewriterText);if(!list.length)list.push(prefix);
      const key=JSON.stringify([site.typewriterEnabled===true,list,site.typewriterSpeed,prefix]);if(key===typeKey)return;
      typeKey=key;baseTitle=prefix;phrases=list;phrase=0;character=0;deleting=false;stopTyping();setTitle(prefix);runTyping();
    }
    addEventListener('resize',scheduleRender,{passive:true,signal:signal.signal});document.addEventListener('transitionend',scheduleRender,{capture:true,signal:signal.signal});document.addEventListener('animationend',scheduleRender,{capture:true,signal:signal.signal});document.addEventListener('load',scheduleRender,{capture:true,signal:signal.signal});
    document.fonts?.addEventListener?.('loadingdone',scheduleRender,{signal:signal.signal});document.fonts?.ready.then(scheduleRender);
    document.addEventListener('visibilitychange',runTyping,{signal:signal.signal});addEventListener('iwtxz-preview-visibility',event=>{paused=event.detail===false;runTyping();},{signal:signal.signal});reduced.addEventListener('change',runTyping,{signal:signal.signal});
    const observer=new MutationObserver(scheduleRender);observer.observe(document.body,{attributes:true,attributeFilter:['class']});
    function dispose(){
      if(disposed)return;disposed=true;stopTyping();signal.abort();observer.disconnect();resizeObserver?.disconnect();cancelAnimationFrame(raf);stopDrag(false);document.body.classList.remove('iwtxz-layout-editing');
      for(const node of nodes.values()){const initial=originals.get(node);node.style.setProperty('translate',initial?.translate||'');node.classList.remove('iwtxz-layout-block','iwtxz-layout-draggable','is-layout-dragging','is-layout-selected');delete node.dataset.layoutBlock;delete node.dataset.layoutLabel;if(initial?.tabindex===null)node.removeAttribute('tabindex');else if(initial?.tabindex!==undefined)node.setAttribute('tabindex',initial.tabindex);}
      gridNode?.remove();guidesNode?.remove();document.title=`${baseTitle} | iwtxz`;
    }
    addEventListener('pagehide',event=>{if(event.persisted)stopTyping();else dispose();},{signal:signal.signal});addEventListener('pageshow',()=>{runTyping();scheduleRender();},{signal:signal.signal});
    return {apply(settings){
      if(disposed)return;
      const next=settings||{};if(drag&&next.owner!==site.owner)stopDrag(false);
      site=next;
      // A delayed editor echo must not replace coordinates during an active drag.
      if(!drag){positions=normalizePositions(site.objectPositions);modelVersion=Number(site.layoutVersion)>=2?2:1;}
      for(const element of document.querySelectorAll('.profile-description, main.panel .tagline, main.panel .tagline-text'))element.style.setProperty('font-size',`${clamp(site.descriptionSize,10,32,16)}px`);
      applyTypewriter();refreshNodes();
    },setEditing,setGrid,align,reset(){positions={};modelVersion=2;renderPositions();publish();},dispose};
  }
  window.IwtxzProfileLayout=Object.freeze({create,normalizePositions,normalizeGrid,typewriterPhrases,keys});
})();
