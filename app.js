'use strict';
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const $=s=>document.querySelector(s);
const pagesEl=$('#pages');
let deck=null; // {id,name,blob,rects:[[{x,y,w,h}]]}
let rects=[];  // rects[pageIndex] = [{x,y,w,h}] (0-1 の比率)

/* ---------- IndexedDB (PDF/画像の本体も保存するためlocalStorageではなくこちらを使用) ---------- */
const dbp=new Promise((res,rej)=>{
  const r=indexedDB.open('tango-db',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('decks',{keyPath:'id'});
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
});
const tx=async(mode,fn)=>{const db=await dbp;return new Promise((res,rej)=>{
  const t=db.transaction('decks',mode),q=fn(t.objectStore('decks'));
  t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error);});};

function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1800);}

/* ---------- 読み込み ---------- */
async function openBlob(blob,name,savedRects,id){
  pagesEl.innerHTML='';$('#empty').classList.add('hide');
  const els=[];
  if(blob.type==='application/pdf'||/\.pdf$/i.test(name)){
    const pdf=await pdfjsLib.getDocument({data:await blob.arrayBuffer()}).promise;
    for(let i=1;i<=pdf.numPages;i++){
      const p=await pdf.getPage(i),base=p.getViewport({scale:1});
      const scale=Math.min(2.5,1800/base.width),vp=p.getViewport({scale});
      const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
      await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
      els.push(c);
    }
  }else{
    const img=new Image();img.src=URL.createObjectURL(blob);await img.decode();els.push(img);
  }
  deck={id:id||null,name,blob};
  rects=els.map((_,i)=>(savedRects&&savedRects[i])||[]);
  els.forEach((el,i)=>{
    const pg=document.createElement('div');pg.className='page';
    const layer=document.createElement('div');layer.className='layer';
    layer.addEventListener('pointerdown',e=>{if(e.target===layer)select(null);});
    pg.append(el,layer);pagesEl.append(pg);
    rects[i].forEach(r=>makeRect(layer,i,r));
  });
}

/* ---------- 赤い角丸四角形 ---------- */
let selected=null;
function select(el){selected&&selected.classList.remove('sel');selected=el;el&&el.classList.add('sel');}
function place(el,r){el.style.left=r.x*100+'%';el.style.top=r.y*100+'%';el.style.width=r.w*100+'%';el.style.height=r.h*100+'%';}
function makeRect(layer,pi,r){
  const el=document.createElement('div');el.className='rect';place(el,r);
  el.innerHTML='<span class="x" title="削除">×</span><span class="h" title="サイズ変更"></span>';
  layer.append(el);
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const drag=(e,kind)=>{
    e.preventDefault();e.stopPropagation();select(el);
    const box=layer.getBoundingClientRect(),sx=e.clientX,sy=e.clientY,o={...r};
    el.setPointerCapture(e.pointerId);
    const mv=ev=>{
      const dx=(ev.clientX-sx)/box.width,dy=(ev.clientY-sy)/box.height;
      if(kind==='move'){r.x=clamp(o.x+dx,0,1-r.w);r.y=clamp(o.y+dy,0,1-r.h);}
      else{r.w=clamp(o.w+dx,.02,1-r.x);r.h=clamp(o.h+dy,.015,1-r.y);}
      place(el,r);
    };
    const up=()=>{el.removeEventListener('pointermove',mv);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);};
    el.addEventListener('pointermove',mv);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  };
  el.addEventListener('pointerdown',e=>{
    if(!document.body.classList.contains('edit'))return;
    if(e.target.classList.contains('x'))return;
    drag(e,e.target.classList.contains('h')?'resize':'move');
  });
  el.querySelector('.x').addEventListener('pointerdown',e=>e.stopPropagation());
  el.querySelector('.x').addEventListener('click',()=>{
    rects[pi]=rects[pi].filter(q=>q!==r);el.remove();selected=null;
  });
  el.addEventListener('click',()=>{
    if(document.body.classList.contains('use'))el.classList.toggle('off');
  });
  return el;
}
$('#add').onclick=()=>{
  const pgs=[...document.querySelectorAll('.page')];
  if(!pgs.length)return toast('先にファイルを開いてください');
  const mid=innerHeight/2;let best=0,bd=1e9;
  pgs.forEach((p,i)=>{const b=p.getBoundingClientRect();const d=mid<b.top?b.top-mid:mid>b.bottom?mid-b.bottom:0;if(d<bd){bd=d;best=i;}});
  const b=pgs[best].getBoundingClientRect();
  const cy=Math.min(.9,Math.max(.05,(mid-b.top)/b.height));
  const r={x:.35,y:cy-.02,w:.3,h:.04};
  rects[best].push(r);select(makeRect(pgs[best].querySelector('.layer'),best,r));
};

/* ---------- 拡大・縮小 ---------- */
let zoom=1;
function applyZoom(){
  const base=Math.min(900,innerWidth-24);
  const root=document.documentElement.style;
  root.setProperty('--pw',base*zoom+'px');
  root.setProperty('--r',Math.max(4,8*zoom)+'px');
  $('#zv').textContent=Math.round(zoom*100)+'%';
}
function setZoom(z){
  const m=$('main'),cx=(m.scrollLeft+m.clientWidth/2)/m.scrollWidth,cy=(scrollY+innerHeight/2)/document.documentElement.scrollHeight;
  zoom=Math.min(4,Math.max(.5,Math.round(z*100)/100));applyZoom();
  m.scrollLeft=cx*m.scrollWidth-m.clientWidth/2;
  scrollTo(0,cy*document.documentElement.scrollHeight-innerHeight/2);
}
$('#zi').onclick=()=>setZoom(zoom*1.25);
$('#zo').onclick=()=>setZoom(zoom/1.25);
$('#zv').onclick=()=>setZoom(1);
addEventListener('resize',applyZoom);
addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();setZoom(zoom*(e.deltaY<0?1.1:1/1.1));}},{passive:false});
applyZoom();

/* ---------- モード ---------- */
function setMode(m){
  document.body.className=m;
  $('#m-edit').classList.toggle('on',m==='edit');$('#m-use').classList.toggle('on',m==='use');
  select(null);
  if(m==='use')document.querySelectorAll('.rect').forEach(r=>r.classList.remove('off'));
}
$('#m-edit').onclick=()=>setMode('edit');
$('#m-use').onclick=()=>setMode('use');
$('#hideAll').onclick=()=>document.querySelectorAll('.rect').forEach(r=>r.classList.remove('off'));
$('#showAll').onclick=()=>document.querySelectorAll('.rect').forEach(r=>r.classList.add('off'));

/* ---------- ファイル / 保存 ---------- */
$('#file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{await openBlob(f,f.name.replace(/\.[^.]+$/,''));setMode('edit');}
  catch(err){console.error(err);toast('読み込めませんでした');}
  e.target.value='';
};
$('#save').onclick=async()=>{
  if(!deck)return toast('保存する内容がありません');
  if(!deck.id){
    const n=prompt('単語帳の名前',deck.name);if(n===null)return;
    deck.name=n.trim()||deck.name;deck.id='d'+Date.now();
  }
  try{
    await tx('readwrite',s=>s.put({id:deck.id,name:deck.name,blob:deck.blob,rects,updated:Date.now()}));
    toast('保存しました');
  }catch(err){console.error(err);toast('保存に失敗しました');}
};
async function renderList(){
  const all=(await tx('readonly',s=>s.getAll()))||[];
  const ul=$('#list');ul.innerHTML='';
  if(!all.length)ul.innerHTML='<li>まだ保存されていません</li>';
  all.sort((a,b)=>b.updated-a.updated).forEach(d=>{
    const li=document.createElement('li');
    const n=document.createElement('span');n.textContent=d.name;
    const o=document.createElement('button');o.textContent='開く';
    o.onclick=async()=>{$('#dlg').close();await openBlob(d.blob,d.name,d.rects,d.id);setMode('use');};
    const x=document.createElement('button');x.textContent='削除';
    x.onclick=async()=>{if(confirm(`「${d.name}」を削除しますか？`)){await tx('readwrite',s=>s.delete(d.id));renderList();}};
    li.append(n,o,x);ul.append(li);
  });
}
$('#lib').onclick=async()=>{await renderList();$('#dlg').showModal();};
$('#close').onclick=()=>$('#dlg').close();
