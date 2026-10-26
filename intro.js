
(()=>{
const viewport=document.getElementById('viewport');
const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');
const focusLayer=document.getElementById('coverFocus');
const focusCard=document.getElementById('focusCard');
const focusImg=document.getElementById('focusImg');
const uiFadeEls=[...document.querySelectorAll('.ui-fade')];
let w=0,h=0,dpr=1,current=0,target=0,drag=null,hit=[],hoveredKey=null,sceneScale=1,sceneScaleTarget=1,detailMode=false,detailAnimating=false;
const hoverMap=new Map();
const imagePaths=window.TRACKS.map(t=>t.cover);
const total=imagePaths.length;
const trackTitles=window.TRACKS.map(t=>t.title);
const hoverLabel=document.getElementById('hoverLabel');
let mouseX=0, mouseY=0;
let labelX=0, labelY=0, labelTargetX=0, labelTargetY=0, labelVisible=false;
let labelVX=0, labelVY=0;
// 노래 제목은 별 커서 오른쪽, 세로 가운데 (시안: 별 중심 → 글자 시작 42.75px)
const introUnit = () => Math.min(innerWidth, innerHeight * 2000 / 1293) / 2000;
let LABEL_OFFSET_X = 42.75;
const LABEL_OFFSET_Y = 0;
// 차분하게 따라오도록: 반동 약 2%, 이전보다 2.5배쯤 느리게
const LABEL_STIFFNESS = 0.022;
const LABEL_DAMPING = 0.8;
const images=[];
const imageColors=[];

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function mix(a,b,t){return a+(b-a)*t;}

function estimateImageColor(img){
  try{
    const c=document.createElement('canvas'); c.width=18; c.height=22;
    const x=c.getContext('2d',{willReadFrequently:true});
    x.drawImage(img,0,0,c.width,c.height);
    const d=x.getImageData(0,0,c.width,c.height).data;
    let r=0,g=0,b=0,n=0;
    for(let i=0;i<d.length;i+=4){
      const a=d[i+3]/255; if(a<0.1) continue;
      const lum=(d[i]+d[i+1]+d[i+2])/3;
      const sat=Math.max(d[i],d[i+1],d[i+2]) - Math.min(d[i],d[i+1],d[i+2]);
      const w=(0.4 + sat/255*0.9) * (0.75 + lum/255*0.4) * a;
      r += d[i]*w; g += d[i+1]*w; b += d[i+2]*w; n += w;
    }
    if(n<0.001) return {r:210,g:215,b:225};
    return {r:Math.round(r/n), g:Math.round(g/n), b:Math.round(b/n)};
  }catch(e){
    return {r:210,g:215,b:225};
  }
}

imagePaths.forEach((src,i)=>{
  const img=new Image();
  img.onload=()=>{ imageColors[i]=estimateImageColor(img); };
  img.src=src;
  images[i]=img;
  imageColors[i]={r:210,g:215,b:225};
});

function resize(){w=viewport.clientWidth;h=viewport.clientHeight;dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}window.addEventListener('resize',resize);resize();
function wrap(n,m){return (n%m+m)%m;}
function pointInPoly(x,y,pts){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))inside=!inside;}return inside;}
function drawPolyPath(pts){ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath();}
function drawPolygon(pts,fill,stroke=null,lineWidth=1){drawPolyPath(pts); ctx.fillStyle=fill; ctx.fill(); if(stroke){ctx.lineWidth=lineWidth; ctx.strokeStyle=stroke; ctx.stroke();}}
function drawLine(a,b,color,width){ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.stroke();}

function frame(t,hoverLevel=0){
  const focal=1400, worldStep=100, depth=t*worldStep, scale=focal/(focal+depth);
  if(scale<=0||scale>4.5) return null;
  const baseline=Math.min(w/1614,h/928);
  const pivotX=w*0.56, pivotY=h*0.50;
  const rawCenterX=w*0.485+t*185*baseline*scale+hoverLevel*165*baseline;
  const rawCenterY=h*0.46-t*155*baseline*scale+hoverLevel*73*baseline;
  const centerX=pivotX+(rawCenterX-pivotX)*sceneScale;
  const centerY=pivotY+(rawCenterY-pivotY)*sceneScale;
  const width=350*baseline*scale*sceneScale, height=420*baseline*scale*sceneScale, skew=83*baseline*scale*sceneScale;
  const pts=[
    {x:centerX-width/2,y:centerY-height/2-skew/2},
    {x:centerX+width/2,y:centerY-height/2+skew/2},
    {x:centerX+width/2,y:centerY+height/2+skew/2},
    {x:centerX-width/2,y:centerY+height/2-skew/2}
  ];
  const thickness=Math.max(2.2, 5.0*baseline*scale*sceneScale);
  const bx=thickness*0.94, by=-thickness*0.54;
  const back=pts.map(p=>({x:p.x+bx,y:p.y+by}));
  return {scale,depth,width,height,hoverLevel,pts,back,thickness};
}

function getCoverCrop(img,targetRatio){
  const iw=img.naturalWidth||img.width||1, ih=img.naturalHeight||img.height||1, ir=iw/ih;
  let sx=0, sy=0, sw=iw, sh=ih;
  if(ir>targetRatio){ sw=ih*targetRatio; sx=(iw-sw)/2; }
  else { sh=iw/targetRatio; sy=(ih-sh)/2; }
  return {sx,sy,sw,sh};
}

function drawImageInParallelogram(img,p,alpha,color,backSilhouettes){
  if(!img||!img.complete||!(img.naturalWidth>0)) return false;
  const pts=p.pts, p0=pts[0], p1=pts[1], p3=pts[3], crop=getCoverCrop(img,350/420);
  ctx.save();
  drawPolyPath(pts);
  ctx.clip();
  ctx.globalAlpha=alpha;
  ctx.transform(p1.x-p0.x,p1.y-p0.y,p3.x-p0.x,p3.y-p0.y,p0.x,p0.y);
  ctx.drawImage(img,crop.sx,crop.sy,crop.sw,crop.sh,0,0,1,1);
  // full, crisp front face with subtle glass skin
  ctx.fillStyle='rgba(255,255,255,0.022)'; ctx.fillRect(0,0,1,1);
  const g1=ctx.createLinearGradient(0,0,0,1);
  g1.addColorStop(0,'rgba(255,255,255,0.055)');
  g1.addColorStop(0.50,'rgba(255,255,255,0.010)');
  g1.addColorStop(1,'rgba(0,0,0,0.020)');
  ctx.fillStyle=g1; ctx.fillRect(0,0,1,1);
  if(color){
    ctx.fillStyle=`rgba(${color.r},${color.g},${color.b},0.065)`;
    ctx.fillRect(0,0,1,1);
  }
  // specular sweep
  ctx.save(); ctx.translate(0.16,-0.10); ctx.rotate(-0.16);
  const g2=ctx.createLinearGradient(0,0,0.25,1.05);
  g2.addColorStop(0,'rgba(255,255,255,0.00)');
  g2.addColorStop(0.28,'rgba(255,255,255,0.12)');
  g2.addColorStop(0.42,'rgba(255,255,255,0.03)');
  g2.addColorStop(1,'rgba(255,255,255,0.00)');
  ctx.fillStyle=g2; ctx.fillRect(0,0,0.22,1.2);
  ctx.restore();
  ctx.restore();

  // transmitted silhouettes of the panels behind, visible through the glass panel
  if(backSilhouettes && backSilhouettes.length){
    ctx.save();
    drawPolyPath(pts);
    ctx.clip();
    ctx.filter='blur(7px)';
    for(const s of backSilhouettes){
      const sp = s.p.pts;
      const sr=s.color?.r ?? 30, sg=s.color?.g ?? 30, sb=s.color?.b ?? 30;
      drawPolygon(sp, `rgba(${sr},${sg},${sb},0.050)`);
    }
    ctx.filter='none';
    for(const s of backSilhouettes){
      const sp=s.p.pts;
      drawPolygon(sp, 'rgba(25,25,25,0.040)');
    }
    // fine milky veil so the silhouettes feel embedded in the glass rather than printed on top
    const veil=ctx.createLinearGradient(p0.x,p0.y,p3.x,p3.y);
    veil.addColorStop(0,'rgba(255,255,255,0.035)');
    veil.addColorStop(0.55,'rgba(255,255,255,0.010)');
    veil.addColorStop(1,'rgba(255,255,255,0.028)');
    drawPolyPath(pts); ctx.fillStyle=veil; ctx.fill();
    ctx.restore();
  }
  return true;
}

function drawGlassThickness(p,color,hover){
  const a=p.pts, b=p.back;
  const r=color.r, g=color.g, bl=color.b;
  const topFace=[b[0],b[1],a[1],a[0]];
  const rightFace=[b[1],b[2],a[2],a[1]];
  const rearFace=b;

  // rear ghost face
  drawPolygon(rearFace, `rgba(${r},${g},${bl},0.22)`, null);

  // top face : denser colored glass with light bloom
  let grad=ctx.createLinearGradient(b[0].x,b[0].y,a[0].x,a[0].y);
  grad.addColorStop(0, `rgba(${r},${g},${bl},0.64)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${bl},0.42)`);
  grad.addColorStop(0.82, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0.07)');
  drawPolyPath(topFace); ctx.fillStyle=grad; ctx.fill();

  // right face : thicker, richer color body
  grad=ctx.createLinearGradient(b[1].x,b[1].y,a[1].x,a[1].y);
  grad.addColorStop(0, `rgba(${r},${g},${bl},0.58)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${bl},0.34)`);
  grad.addColorStop(0.88, 'rgba(255,255,255,0.11)');
  grad.addColorStop(1, 'rgba(255,255,255,0.05)');
  drawPolyPath(rightFace); ctx.fillStyle=grad; ctx.fill();

  // glossy light strip on top face
  ctx.save();
  drawPolyPath(topFace); ctx.clip();
  let streak=ctx.createLinearGradient(b[0].x,b[0].y,a[1].x,a[1].y);
  streak.addColorStop(0.00,'rgba(255,255,255,0.00)');
  streak.addColorStop(0.22,'rgba(255,255,255,0.18)');
  streak.addColorStop(0.33,'rgba(255,255,255,0.04)');
  streak.addColorStop(1.00,'rgba(255,255,255,0.00)');
  ctx.fillStyle=streak; ctx.fillRect(Math.min(b[0].x,a[0].x)-20,Math.min(b[0].y,a[0].y)-20,4000,4000);
  // subtle darker inner edge for volume
  drawLine(a[0],a[1],`rgba(${r},${g},${bl},0.24)`,1.35);
  ctx.restore();

  // glossy vertical bloom on right face
  ctx.save();
  drawPolyPath(rightFace); ctx.clip();
  let streak2=ctx.createLinearGradient(a[1].x,a[1].y,b[2].x,b[2].y);
  streak2.addColorStop(0.00,'rgba(255,255,255,0.20)');
  streak2.addColorStop(0.16,'rgba(255,255,255,0.06)');
  streak2.addColorStop(0.55,'rgba(255,255,255,0.00)');
  streak2.addColorStop(1.00,'rgba(255,255,255,0.08)');
  ctx.fillStyle=streak2; ctx.fillRect(Math.min(b[1].x,a[1].x)-20,Math.min(b[1].y,a[1].y)-20,4000,4000);
  // tiny sparkling hit
  const sparkle = ctx.createRadialGradient(a[1].x+3,a[1].y+2,0,a[1].x+3,a[1].y+2,26);
  sparkle.addColorStop(0,'rgba(255,255,255,0.28)');
  sparkle.addColorStop(0.35,'rgba(255,255,255,0.10)');
  sparkle.addColorStop(1,'rgba(255,255,255,0.00)');
  ctx.fillStyle=sparkle; ctx.fillRect(a[1].x-28,a[1].y-26,60,60);
  ctx.restore();

  // edge highlights / geometry lines
  drawLine(a[0], a[1], 'rgba(255,255,255,0.42)', 1.15);
  drawLine(a[1], a[2], 'rgba(255,255,255,0.24)', 1.05);
  drawLine(b[1], a[1], `rgba(${r},${g},${bl},0.56)`, 1.15);
  drawLine(b[1], b[2], 'rgba(255,255,255,0.15)', 0.95);
  drawLine(b[0], b[1], 'rgba(255,255,255,0.15)', 0.95);
  if(hover>0.06){
    drawLine(a[0],a[1],'rgba(255,255,255,0.50)',1.3);
    drawLine(a[1],a[2],'rgba(255,255,255,0.28)',1.15);
  }
}

function drawShadow(pts,amount){
  if(amount<=0.01) return;
  const dx=-10*amount, dy=10*amount, shadowPts=pts.map(p=>({x:p.x+dx,y:p.y+dy}));
  drawPolygon(shadowPts, `rgba(0,0,0,${0.065*amount})`);
}


function showHoverLabel(text,x,y){
  hoverLabel.textContent=text;
  LABEL_OFFSET_X = 42.75 * introUnit();
  labelTargetX = x + LABEL_OFFSET_X;
  labelTargetY = y + LABEL_OFFSET_Y;
  if(!labelVisible){
    labelX = labelTargetX + 14;
    labelY = labelTargetY + 10;
    labelVX = 0;
    labelVY = 0;
    hoverLabel.style.left = labelX + 'px';
    hoverLabel.style.top = labelY + 'px';
  }
  labelVisible = true;
  hoverLabel.style.display='block';
}
function hideHoverLabel(){ labelVisible=false; labelVX=0; labelVY=0; hoverLabel.style.display='none'; }
function updateHoverLabel(){
  if(!labelVisible) return;
  const dx = labelTargetX - labelX;
  const dy = labelTargetY - labelY;
  labelVX += dx * LABEL_STIFFNESS;
  labelVY += dy * LABEL_STIFFNESS;
  labelVX *= LABEL_DAMPING;
  labelVY *= LABEL_DAMPING;
  labelX += labelVX;
  labelY += labelVY;
  if(Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15 && Math.abs(labelVX) < 0.15 && Math.abs(labelVY) < 0.15){
    labelX = labelTargetX;
    labelY = labelTargetY;
    labelVX = 0;
    labelVY = 0;
  }
  hoverLabel.style.left = labelX + 'px';
  hoverLabel.style.top = labelY + 'px';
}

function setUIVisible(visible){
  canvas.style.opacity = visible ? '1' : '0';
  uiFadeEls.forEach(el=>el.style.opacity = visible ? '1' : '0');
}
function boundsFromPts(pts){
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  return {left:Math.min(...xs), top:Math.min(...ys), width:Math.max(...xs)-Math.min(...xs), height:Math.max(...ys)-Math.min(...ys)};
}
function selectPlane(found){
  if(!found || detailMode || detailAnimating) return;
  detailMode = true; detailAnimating = true; hideHoverLabel(); hoveredKey=null;
  resetContrast(true);
  const idx = wrap(found.k,total);
  focusImg.src = imagePaths[idx];
  const b = boundsFromPts(found.p.pts);
  const img = images[idx];
  const ratio = (img && img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1;
  const maxBox = Math.min(w,h) * 0.42;
  let targetW = maxBox, targetH = maxBox;
  if(ratio >= 1){ targetW = maxBox; targetH = maxBox / ratio; }
  else { targetH = maxBox; targetW = maxBox * ratio; }
  focusLayer.style.display='block';
  focusLayer.style.pointerEvents='auto';
  focusCard.style.transition='none';
  focusCard.style.left = b.left + 'px';
  focusCard.style.top = b.top + 'px';
  focusCard.style.width = b.width + 'px';
  focusCard.style.height = b.height + 'px';
  focusCard.style.opacity = '1';
  setUIVisible(false);
  requestAnimationFrame(()=>{
    focusCard.style.transition='left 1120ms cubic-bezier(.2,.85,.2,1), top 1120ms cubic-bezier(.2,.85,.2,1), width 1120ms cubic-bezier(.2,.85,.2,1), height 1120ms cubic-bezier(.2,.85,.2,1), opacity 420ms ease';
    focusCard.style.left = (w*0.5 - targetW*0.5) + 'px';
    focusCard.style.top = (h*0.5 - targetH*0.5) + 'px';
    focusCard.style.width = targetW + 'px';
    focusCard.style.height = targetH + 'px';
  });
  setTimeout(()=>{ detailAnimating=false; beginDJ(idx); }, 1160);
}

function primeDJAudio(){
  const audio=document.getElementById('djAudio');
  if(!audio || window.__djAudioPrimed) return;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(AudioContextClass && !window.DJ_AUDIO_CONTEXT) window.DJ_AUDIO_CONTEXT=new AudioContextClass();
  if(window.DJ_AUDIO_CONTEXT) window.DJ_AUDIO_CONTEXT.resume().catch(()=>{});
  const oldVolume=audio.volume;
  audio.volume=0;
  const started=audio.play();
  if(started) started.then(()=>{
    audio.pause();
    audio.currentTime=0;
    audio.volume=oldVolume;
    window.__djAudioPrimed=true;
  }).catch(()=>{ audio.volume=oldVolume; });
}

function exitPlaneSelection(){
  if(window.__introLocked) return;
  if(!detailMode || detailAnimating) return;
  detailAnimating = true;
  resetContrast(false);
  focusCard.style.transition='opacity 260ms ease';
  focusCard.style.opacity='0';
  setUIVisible(true);
  setTimeout(()=>{
    focusLayer.style.display='none';
    focusLayer.style.pointerEvents='none';
    focusCard.style.opacity='1';
    detailMode=false;
    detailAnimating=false;
  }, 270);
}


/* ===== 선택한 앨범 → DJ 페이지로 연결 ===== */
async function resolveMp3(T){
  try{ const r=await fetch(T.mp3,{method:'HEAD',cache:'no-store'}); if(r.ok) return T.mp3; }catch(e){}
  console.warn('['+T.title+'] 음악 파일이 없어 임시로 song1.mp3 를 사용합니다 → '+T.mp3+' 에 파일을 넣어 주세요');
  return window.FALLBACK_MP3;
}
function beginDJ(idx){
  window.__introLocked=true;
  document.getElementById('introCursor').style.display='none';
  const T=window.TRACKS[idx], V='?v=20261024v22';
  resolveMp3(T).then(mp3=>{
    window.DJ_TRACK={index:idx,title:T.title,mp3:mp3,lp:T.lp};
    document.getElementById('lp').src=T.lp+V;
    return import('./script.js'+V);                       // 카메라·MediaPipe·DJ 기능 시작
  }).catch(e=>console.error('DJ 시작 실패',e));
  setTimeout(()=>{                                         // 중앙의 커버가 LP 자리로 이동하며 원형으로 변함
    const lpEl=document.getElementById('lp'), r=lpEl.getBoundingClientRect(), intro=document.getElementById('intro'), stage=document.getElementById('stage');
    intro.style.transition='background-color 800ms ease'; intro.style.backgroundColor='#000';
    focusImg.style.objectFit='cover';
    focusCard.style.transition='left 1000ms cubic-bezier(.6,0,.2,1), top 1000ms cubic-bezier(.6,0,.2,1), width 1000ms cubic-bezier(.6,0,.2,1), height 1000ms cubic-bezier(.6,0,.2,1), border-radius 1000ms ease';
    focusCard.style.left=r.left+'px'; focusCard.style.top=r.top+'px'; focusCard.style.width=r.width+'px'; focusCard.style.height=r.height+'px'; focusCard.style.borderRadius='50%';
    setTimeout(()=>{
      stage.style.transition='opacity 450ms ease'; stage.style.opacity='1';
      intro.style.transition='opacity 450ms ease'; intro.style.opacity='0';
      setTimeout(()=>{ intro.style.display='none'; window.__introDone=true; },500);
    },1050);
  },350);
}

/* 로고·Choose Your Song·노래 제목 아래가 어두운 앨범이면 흰색으로 (밝기는 캔버스에서 직접 측정) */
const contrastProbe=document.createElement('canvas'); contrastProbe.width=24; contrastProbe.height=8;
const probeCtx=contrastProbe.getContext('2d',{willReadFrequently:true});
const contrastTargets=[
  {el:document.getElementById('introLogo'), dark:false, on:.47, off:.55},
  {el:document.getElementById('wordChoose'), dark:false, on:.47, off:.55},
  {el:document.getElementById('wordYour'), dark:false, on:.47, off:.55},
  {el:document.getElementById('wordSong'), dark:false, on:.47, off:.55},
  {el:hoverLabel, dark:false, on:.58, off:.66, label:true}   // 올리브 글자는 중간 밝기에서도 묻히므로 기준을 높게
];
let contrastFrame=0;
function backgroundLuma(r){
  const sx=Math.max(0,r.left*dpr), sy=Math.max(0,r.top*dpr), sw=Math.min(canvas.width-sx,r.width*dpr), sh=Math.min(canvas.height-sy,r.height*dpr);
  if(sw<1||sh<1) return 1;
  probeCtx.fillStyle='#f3f3f1'; probeCtx.fillRect(0,0,24,8);
  probeCtx.drawImage(canvas,sx,sy,sw,sh,0,0,24,8);
  const d=probeCtx.getImageData(0,0,24,8).data; let sum=0;
  for(let i=0;i<d.length;i+=4) sum+=(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])/255;
  return sum/(d.length/4);
}
let contrastFrozen=false;
// 앨범을 고르면(커버가 가운데로 이동) 로고·Choose Your Song을 모두 기본(검정)으로 통일하고 측정을 멈춘다
function resetContrast(freeze){
  contrastFrozen=freeze;
  for(const t of contrastTargets){ t.dark=false; t.el.classList.remove('onDark'); }
}
function updateContrast(){
  if(contrastFrozen) return;
  if(++contrastFrame%4) return;                       // 4프레임마다 측정
  for(const t of contrastTargets){
    if(t.label && !labelVisible){ t.dark=false; t.el.classList.remove('onDark'); continue; }
    const L=backgroundLuma(t.el.getBoundingClientRect());
    if(!t.dark && L<t.on) t.dark=true; else if(t.dark && L>t.off) t.dark=false;   // 경계에서 깜빡이지 않게 여유 폭
    t.el.classList.toggle('onDark',t.dark);
  }
}
function render(){
  if(window.__introDone) return;
  current += (target-current)*0.16;
  sceneScale += (sceneScaleTarget-sceneScale)*0.11;
  ctx.clearRect(0,0,w,h);
  hit=[];
  const near=Math.floor(current), all=[];
  for(let k=near-8;k<=near+12;k++){
    const t=k-current;
    const hoverTarget=(hoveredKey===k)?1:0;
    const prev=hoverMap.get(k)||0;
    const next=prev+(hoverTarget-prev)*0.18;
    hoverMap.set(k,next);
    const p=frame(t,next);
    if(!p||p.width<16) continue;
    all.push({k,t,p,hover:next});
  }
  for(const key of hoverMap.keys()){
    if(!all.some(item=>item.k===key)){
      const v=hoverMap.get(key)||0;
      if(v<0.01) hoverMap.delete(key); else hoverMap.set(key,v*0.82);
    }
  }
  all.sort((a,b)=>b.t-a.t);
  for(const item of all){
    const {k,t,p,hover}=item;
    const active=Math.abs(t)<0.46;
    const num=wrap(k,total), img=images[num], color=imageColors[num] || {r:210,g:215,b:225};
    const alpha=1.0;
    drawShadow(p.pts, hover*0.55+0.22);
    drawGlassThickness(p,color,hover);
    const backSilhouettes = all.filter(o => o.t > t && (o.t - t) < 4.7).slice(0,6).map(o => ({p:o.p, color:imageColors[wrap(o.k,total)] || {r:60,g:60,b:60}}));
    const drewImage=drawImageInParallelogram(img,p,alpha,color,backSilhouettes);
    if(!drewImage) drawPolygon(p.pts, `rgba(200,200,205,${alpha})`);
    // front face border: top and right only, to avoid left thin line
    drawLine(p.pts[0], p.pts[1], hover>0.06?'rgba(165,175,190,0.60)':active?'rgba(150,160,176,0.44)':'rgba(145,150,160,0.22)', hover>0.06?1.35:1.0);
    drawLine(p.pts[1], p.pts[2], hover>0.06?'rgba(165,175,190,0.46)':active?'rgba(150,160,176,0.30)':'rgba(145,150,160,0.17)', hover>0.06?1.15:0.9);
    hit.push(item);
  }
  document.getElementById('value').textContent=String(wrap(Math.round(current),total)+1).padStart(2,'0');
  updateHoverLabel();
  updateContrast();
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
let snapTimer; function snap(){target=Math.round(target);} function delayedSnap(){clearTimeout(snapTimer); snapTimer=setTimeout(snap,105);} function step(n){target=Math.round(target)+n;}
viewport.addEventListener('wheel',e=>{if(detailMode) return; e.preventDefault();hideHoverLabel();target+=(e.deltaY||e.deltaX)*0.0065;delayedSnap();},{passive:false});
viewport.addEventListener('pointerdown',e=>{if(detailMode){ if(!e.target.closest('#focusCard')) exitPlaneSelection(); return; } if(e.target.closest('button'))return;drag={x:e.clientX,y:e.clientY,start:target,moved:false};sceneScaleTarget=0.84;hoveredKey=null;hideHoverLabel();viewport.setPointerCapture(e.pointerId);viewport.classList.add('grabbing');});
const introCursor=document.getElementById('introCursor');
function moveIntroCursor(e){ introCursor.style.display='block'; introCursor.style.left=e.clientX+'px'; introCursor.style.top=e.clientY+'px'; }
window.addEventListener('pointermove',e=>{ if(!window.__introLocked) moveIntroCursor(e); else introCursor.style.display='none'; });
document.addEventListener('pointerleave',()=>{ introCursor.style.display='none'; });
viewport.addEventListener('pointermove',e=>{mouseX=e.clientX; mouseY=e.clientY; if(detailMode) return; if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>6)drag.moved=true;target=drag.start+(-dx+dy)*0.006;hideHoverLabel();return;}const found=[...hit].reverse().find(o=>pointInPoly(e.clientX,e.clientY,o.p.pts));hoveredKey=found?found.k:null;if(found){const idx=wrap(found.k,total);showHoverLabel(trackTitles[idx], e.clientX, e.clientY);}else{hideHoverLabel();}});
viewport.addEventListener('pointerleave',()=>{if(!drag){hoveredKey=null; hideHoverLabel();}});
viewport.addEventListener('pointerup',e=>{if(detailMode || !drag) return; if(!drag.moved){const found=[...hit].reverse().find(o=>pointInPoly(e.clientX,e.clientY,o.p.pts));if(found){primeDJAudio();target=found.k; selectPlane(found);} } drag=null;sceneScaleTarget=1;viewport.classList.remove('grabbing');snap();});
viewport.addEventListener('pointercancel',()=>{if(detailMode) return; drag=null;sceneScaleTarget=1;hoveredKey=null;hideHoverLabel();viewport.classList.remove('grabbing');snap();});
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && detailMode){ exitPlaneSelection(); return; } if(detailMode) return; if(['ArrowRight','ArrowDown'].includes(e.key)){e.preventDefault();step(1)} if(['ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();step(-1)}});
focusLayer.addEventListener('click',e=>{ if(e.target===focusLayer) exitPlaneSelection(); });
document.getElementById('choose').onclick=()=>{ if(detailMode) return; const msg=document.getElementById('toast');msg.textContent=`PLANE ${String(wrap(Math.round(target),total)+1).padStart(2,'0')} SELECTED`;msg.style.visibility='visible';setTimeout(()=>msg.style.visibility='hidden',1500);};
document.getElementById('index').onclick=()=>{ if(!detailMode) step(1) }; document.getElementById('overview').onclick=()=>{ if(!detailMode) target=0 };
})();
