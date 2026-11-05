(() => {
  'use strict';
  const effects=new Set(['none','snow','rain','matrix','glitch','parallax']);
  const cursors=new Set(['default','dot','ring','crosshair']);
  const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
  function safeImage(value){if(typeof value!=='string'||!value.trim()||value.length>2048)return '';try{const url=new URL(value,document.baseURI);return !url.username&&!url.password&&(url.protocol==='https:'||(url.origin===location.origin&&url.protocol==='http:'&&/^\/img\//.test(url.pathname)))?url.href:'';}catch{return '';}}
  function create(){
    let site={},canvas,ctx,cursor,particles=[],w=0,h=0,last=0,raf=0,pointerRaf=0,sceneKey='',x=0,y=0,tiltNode=null,legacyBackground=null,previewSuspended=false;
    const modest=Boolean(navigator.connection?.saveData)||(navigator.hardwareConcurrency||8)<=4||(navigator.deviceMemory||8)<=4;
    const frameDelay=1000/(modest?18:30);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover: hover) and (pointer: fine)');
    const listeners=new AbortController();
    const initialIcon=document.querySelector('link[rel="icon"]')?.getAttribute('href')||'/img/tree.png';
    function resize(){
      if(!canvas)return;w=innerWidth;h=innerHeight;const scale=Math.min(devicePixelRatio||1,modest?1:1.25,Math.sqrt(1_600_000/Math.max(1,w*h)));
      canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);ctx.setTransform(scale,0,0,scale,0,0);
      particles=Array.from({length:Math.min(modest?40:80,Math.round((site.effectIntensity||50)*Math.min(w,1100)/750))},()=>({x:Math.random()*w,y:Math.random()*h,s:Math.random()*2+.5,v:Math.random()*2+.5}));
      ctx.clearRect(0,0,w,h);
    }
    function animate(time){
      raf=0;if(document.hidden||previewSuspended||reduced.matches||!canvas)return;
      if(time-last>=frameDelay){
        const step=Math.min(2,(time-last)/33||1);last=time;
        ctx.clearRect(0,0,w,h);
        const effect=site.backgroundEffect;
        for(const p of particles){
          p.y+=(effect==='rain'?12:effect==='matrix'?8:p.v)*step;
          if(p.y>h+20){p.y=-20;p.x=Math.random()*w;}
          if(effect==='snow'){p.x+=Math.sin(time/1500+p.y/80)*.35;ctx.fillStyle=`rgba(255,255,255,${.3+p.s/5})`;ctx.beginPath();ctx.arc(p.x,p.y,p.s,0,Math.PI*2);ctx.fill();}
          else if(effect==='rain'){ctx.strokeStyle='#ccd9e65c';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-3,p.y+14+p.s*4);ctx.stroke();}
          else if(effect==='matrix'){ctx.font='14px monospace';ctx.fillStyle='#9dfab668';const row=Math.floor(p.y/20);for(let j=0;j<5;j++){ctx.globalAlpha=1-j/6;ctx.fillText(String.fromCharCode(0x30A0+((row+j+Math.floor(p.x))%80)),Math.round(p.x/18)*18,p.y-j*17);}ctx.globalAlpha=1;}
        }
        if(effect==='glitch'&&Math.floor(time/150)%13===0){for(let i=0;i<4;i++){ctx.fillStyle=i%2?'#cde8ff19':'#fff1';ctx.fillRect(0,Math.random()*h,w,Math.random()*4+1);}}
      }
      raf=requestAnimationFrame(animate);
    }
    function run(){if(raf)cancelAnimationFrame(raf);raf=0;if(canvas&&!document.hidden&&!previewSuspended&&!reduced.matches)raf=requestAnimationFrame(animate);}
    function resetPointer(){
      tiltNode?.style.removeProperty('transform');
      document.documentElement.style.setProperty('--scene-x','0px');document.documentElement.style.setProperty('--scene-y','0px');
      if(cursor)cursor.hidden=true;
    }
    function pointer(event){
      x=event.clientX;y=event.clientY;
      if(pointerRaf||!fine.matches||previewSuspended||(!cursor&&site.backgroundEffect!=='parallax'&&!site.profileTilt))return;
      pointerRaf=requestAnimationFrame(()=>{
        pointerRaf=0;
        if(document.body.classList.contains('iwtxz-layout-editing')){resetPointer();return;}
        if(cursor){cursor.hidden=false;cursor.style.transform=`translate3d(${x}px,${y}px,0)`;}
        if(reduced.matches)return;
        if(site.backgroundEffect==='parallax'){
          document.documentElement.style.setProperty('--scene-x',`${(x/innerWidth-.5)*-22}px`);
          document.documentElement.style.setProperty('--scene-y',`${(y/innerHeight-.5)*-16}px`);
        }
        if(site.profileTilt&&tiltNode&&document.body.classList.contains('is-entered')){const box=tiltNode.getBoundingClientRect();const rx=Math.max(-1,Math.min(1,(y-(box.top+box.height/2))/(box.height/2)));const ry=Math.max(-1,Math.min(1,(x-(box.left+box.width/2))/(box.width/2)));tiltNode.style.transform=`perspective(900px) rotateX(${-rx*5}deg) rotateY(${ry*6}deg)`;}
      });
    }
    addEventListener('pointermove',pointer,{passive:true,signal:listeners.signal});
    document.addEventListener('pointerleave',resetPointer,{signal:listeners.signal});
    addEventListener('blur',resetPointer,{signal:listeners.signal});
    addEventListener('resize',resize,{passive:true,signal:listeners.signal});
    document.addEventListener('visibilitychange',()=>{run();if(document.hidden)resetPointer();},{signal:listeners.signal});
    reduced.addEventListener('change',()=>{resetPointer();run();},{signal:listeners.signal});
    fine.addEventListener('change',()=>{resetPointer();syncCursor();},{signal:listeners.signal});
    addEventListener('iwtxz-preview-visibility',event=>{previewSuspended=event.detail===false;run();if(previewSuspended)resetPointer();},{signal:listeners.signal});
    function syncCursor(){
      const custom=safeImage(site.customCursor);const style=cursors.has(site.cursorStyle)?site.cursorStyle:'default';
      const enabled=fine.matches&&(custom||style!=='default');
      document.body.classList.toggle('iwtxz-custom-cursor',Boolean(enabled));
      if(!enabled){cursor?.remove();cursor=null;return;}
      if(!cursor){cursor=document.createElement('div');cursor.className='iwtxz-cursor';cursor.hidden=true;cursor.setAttribute('aria-hidden','true');document.body.append(cursor);}
      cursor.dataset.style=custom?'image':style;
      cursor.dataset.hotspot=site.cursorHotspot==='top-left'?'top-left':'center';
      cursor.style.setProperty('--cursor-size',`${clamp(site.cursorSize,12,96,24)}px`);
      cursor.style.setProperty('--cursor-opacity',String(clamp(site.cursorOpacity,20,100,100)/100));
      cursor.style.setProperty('--cursor-color',/^#[0-9a-f]{6}$/i.test(site.cursorColor||'')?site.cursorColor:'#ffffff');
      const old=cursor.querySelector('img');
      if(custom){let img=old;if(!img){img=document.createElement('img');img.alt='';cursor.append(img);}if(img.src!==custom)img.src=custom;}
      else old?.remove();
    }
    function dispose(){listeners.abort();cancelAnimationFrame(raf);cancelAnimationFrame(pointerRaf);resetPointer();canvas?.remove();cursor?.remove();legacyBackground?.remove();document.body.classList.remove('iwtxz-custom-cursor');}
    addEventListener('pagehide',event=>{if(event.persisted){cancelAnimationFrame(raf);raf=0;resetPointer();}else dispose();},{signal:listeners.signal});
    addEventListener('pageshow',run,{signal:listeners.signal});
    return {apply(settings){
      site={...settings,backgroundEffect:effects.has(settings.backgroundEffect)?settings.backgroundEffect:'none'};
      tiltNode=document.querySelector('#profile, .profile-card, main.profile, main.panel, .profile-container, .card');
      if(!site.profileTilt||reduced.matches)tiltNode?.style.removeProperty('transform');
      document.body.dataset.backgroundEffect=site.backgroundEffect;
      const legacyImage=site.backgroundEffect==='parallax'&&site.backgroundType!=='video'&&!document.querySelector('#backgroundImage')?safeImage(site.background):'';
      if(legacyImage){if(!legacyBackground){legacyBackground=document.createElement('div');legacyBackground.className='iwtxz-parallax-background';document.body.prepend(legacyBackground);}const dim=Math.max(0,Math.min(85,Number(site.backgroundDim)||0))/100;legacyBackground.style.backgroundImage=`linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),url(${JSON.stringify(legacyImage)})`;}
      else{legacyBackground?.remove();legacyBackground=null;}
      const key=site.backgroundEffect+':'+site.effectIntensity;
      if(key!==sceneKey){
        sceneKey=key;cancelAnimationFrame(raf);raf=0;canvas?.remove();canvas=null;resetPointer();
        if(['snow','rain','matrix','glitch'].includes(site.backgroundEffect)){
          canvas=document.createElement('canvas');canvas.className='iwtxz-scene';canvas.setAttribute('aria-hidden','true');document.body.prepend(canvas);ctx=canvas.getContext('2d');if(ctx){resize();run();}else{canvas.remove();canvas=null;}
        }
      }
      syncCursor();
      const favicon=safeImage(site.favicon)||new URL(initialIcon,document.baseURI).href;
      let icon=document.querySelector('link[rel="icon"]');if(!icon){icon=document.createElement('link');icon.rel='icon';document.head.append(icon);}if(icon.href!==favicon){icon.removeAttribute('type');icon.href=favicon;}
    },dispose};
  }
  window.IwtxzProfileScene=Object.freeze({create,safeImage});
})();
