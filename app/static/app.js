/* Pipeline Studio 0.7.2 — browser editor and publication viewer.
   No external scripts, fonts, analytics or cloud viewers are loaded.
   Persistence is either the local Python server, or IndexedDB in portable mode. */
'use strict';
const C=Core,$=(q,r=document)=>r.querySelector(q),$$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATE={project:null,pageIndex:0,selected:new Set(),selectedEdge:null,selectedDrawing:null,collapsed:{},folded:new Set(),compact:true,readOnly:false,server:false,role:'editor',tool:'select',view:{x:20,y:20,z:.8},display:null,history:[],redo:[],saving:false,dirty:false,editVersion:0,search:'',drawColor:'#606bea',drawWidth:3,pub:null,drag:null};
const S=STATE;
const volatileStore=new Map();
let DB=null,saveTimer=null,toastTimer=null,lastFocus=null,liveAssets=new Map(),sessionViewers=[],currentModal=null;
const symbols={select:'↖',pan:'✥',block:'▭',decision:'◇',text:'T',table:'▦',image:'▧',emoji:'☺',pen:'✎',line:'╱',arrow:'↗',rect:'□',ellipse:'○',undo:'↶',redo:'↷',link:'↗',video:'▶',pdf:'▤',document:'▤',page:'⇢',audio:'♫',close:'×',more:'···',fit:'⛶'};
const sign=t=>symbols[t]||'▤';
const portLabels={left:'Слева',right:'Справа',top:'Сверху',bottom:'Снизу'};
const guid=()=>C.uid('x').replace(/[^a-f0-9]/g,'').padEnd(32,'0').slice(0,32);
function page(){return S.project.pages[S.pageIndex];}
function selected(){return page()?.nodes.find(n=>S.selected.has(n.id));}
function legacyCollapsed(){const id=page().id;if(!S.collapsed[id])S.collapsed[id]=new Set(page().groups.map(g=>g.id));return S.collapsed[id];}
function toast(message,ms=4200){const el=$('#toast');el.textContent=message;el.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',ms);}
async function request(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options});if(!r.ok){let err;try{err=await r.json();}catch{err={error:'Ошибка сервера '+r.status};}throw Error(err.error||'Ошибка '+r.status);}return r.json();}
function apiPut(path,data){return request(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function idbOpen(){return new Promise((resolve,reject)=>{const q=indexedDB.open('pipeline-studio-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('store');q.onsuccess=()=>{DB=q.result;resolve(DB);};q.onerror=()=>reject(q.error);});}
function dbGet(key){if(!DB)return Promise.resolve(volatileStore.get(key));return new Promise((resolve,reject)=>{const q=DB.transaction('store').objectStore('store').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
function dbPut(key,val){if(!DB){volatileStore.set(key,val);return Promise.resolve();}return new Promise((resolve,reject)=>{const t=DB.transaction('store','readwrite');t.objectStore('store').put(val,key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});}
const dataURL=blob=>new Promise((res,rej)=>{const f=new FileReader();f.onload=()=>res(f.result);f.onerror=()=>rej(f.error);f.readAsDataURL(blob);});
function dataBlob(url){const [meta,s]=url.split(',');const str=atob(s),buf=new Uint8Array(str.length);for(let i=0;i<str.length;i++)buf[i]=str.charCodeAt(i);return new Blob([buf],{type:meta.match(/^data:([^;]+)/)?.[1]||'application/octet-stream'});}
function legacyCheckpoint(){if(S.readOnly)return;S.history.push(C.clone(S.project));if(S.history.length>50)S.history.shift();S.redo=[];}
function change(fn){if(S.readOnly)return;checkpoint();fn();changed();render();}
function legacyChanged(){S.dirty=true;S.editVersion++;clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(e=>toast(e.message,7000)),750);updateStatus();}
function legacyUpdateStatus(){const el=$('#save-status');if(el)el.textContent=S.readOnly?(S.pub?'Опубликованная версия · только просмотр':'Предпросмотр · изменения отключены'):S.saving?'Сохраняю…':S.dirty?'Есть несохранённые изменения':(S.server?'Сохранено на сервере':S.volatile?'Временная сессия: выгрузите JSON':'Сохранено в этом браузере')+' · ред. '+(S.project?.revision||0);}
async function legacySave(){
 if(S.readOnly||!S.dirty)return;
 if(S.saving){await new Promise(r=>setTimeout(r,150));return save();}
 S.saving=true;updateStatus();const version=S.editVersion;
 try{if(S.server){const p=C.clone(S.project);const ans=await apiPut('/api/project',p);S.project.revision=ans.revision;}else{S.project.revision=(S.project.revision||0)+1;await dbPut('project',C.clone(S.project));}if(version===S.editVersion)S.dirty=false;}
 finally{S.saving=false;updateStatus();}
 if(S.dirty){clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(e=>toast(e.message,8000)),700);}
}
async function legacyUndo(){if(S.readOnly||!S.history.length)return;S.redo.push(C.clone(S.project));{const revision=S.project.revision;S.project=S.history.pop();S.project.revision=revision;}S.selected.clear();changed();render();}
async function legacyRedo(){if(S.readOnly||!S.redo.length)return;S.history.push(C.clone(S.project));{const revision=S.project.revision;S.project=S.redo.pop();S.project.revision=revision;}S.selected.clear();changed();render();}
function emojiURL(g){
 const known=EMOJI[g]||EMOJI[g+'\uFE0F']||EMOJI[g.replace(/\uFE0F/g,'')];if(known)return known;
 if(!/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(g))return null;
 try{const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d');ctx.font='96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText(g,64,70);return EMOJI[g]=canvas.toDataURL('image/png');}catch{return null;}
}
function richText(text){
 const parts=globalThis.Intl?.Segmenter?[...new Intl.Segmenter('ru',{granularity:'grapheme'}).segment(String(text||''))].map(x=>x.segment):[...String(text||'')];
 return parts.map(g=>emojiURL(g)?`<img class="emoji" alt="${esc(g)}" src="${emojiURL(g)}">`:esc(g)).join('');
}
function cleanHTML(raw){
 const doc=new DOMParser().parseFromString(String(raw||''),'text/html');
 const allowed=new Set(['B','STRONG','I','EM','U','S','BR','P','DIV','SPAN','FONT','UL','OL','LI','A']);
 function clean(n){if(n.nodeType===3)return richText(n.nodeValue);if(n.nodeType!==1)return '';if(n.tagName==='IMG'&&n.classList.contains('emoji'))return richText(n.getAttribute('alt')||'');if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','IMG'].includes(n.tagName))return '';const inner=[...n.childNodes].map(clean).join('');if(!allowed.has(n.tagName))return inner;let tag=n.tagName.toLowerCase();if(tag==='font')tag='span';let attrs='';if(tag==='a'){const id=n.getAttribute('data-open-material');if(id&&/^[a-zA-Z0-9_.:-]{1,200}$/.test(id)){attrs=` data-open-material="${esc(id)}" href="#material" class="inline-material"`;return `<a${attrs}>${inner}</a>`;}const u=n.getAttribute('href')||'';if(/^https?:\/\//i.test(u))attrs=` href="${esc(u)}" target="_blank" rel="noopener noreferrer"`;else tag='span';}const st=[];for(const k of ['color','background-color','font-weight','font-style','text-decoration','text-align']){const v=n.style?.getPropertyValue(k);if(v&&/^[#a-zA-Z0-9(),.%\s-]+$/.test(v)&&!v.includes('url'))st.push(k+':'+v);}if(st.length)attrs+=` style="${esc(st.join(';'))}"`;return `<${tag}${attrs}>${inner}${tag==='br'?'':`</${tag}>`}`;}
 return [...doc.body.childNodes].map(clean).join('');
}
const label=n=>n.html?cleanHTML(n.html):richText(n.title);
function mat(id){return S.project.materials.find(m=>m.id===id);}
function legacyAssetURL(m,preview=false){
 if(!m)return '';
 const aid=preview&&m.previewAsset?m.previewAsset:m.asset;if(aid){if(S.server)return '/media/'+aid+(S.pub?'?view='+encodeURIComponent(S.pub):'');return liveAssets.get(aid)||'';}
 return /^https?:\/\//i.test(m.url||'')?m.url:'';
}
async function hydrateAssets(){
 for(const m of S.project.materials){for(const key of ['asset','previewAsset']){const aid=m[key];if(!aid||S.server)continue;const data=S.project.portableAssets?.[aid];if(data){const blob=dataBlob(data);await dbPut('asset:'+aid,blob);liveAssets.set(aid,URL.createObjectURL(blob));}else{const blob=await dbGet('asset:'+aid);if(blob)liveAssets.set(aid,URL.createObjectURL(blob));}}}
 delete S.project.portableAssets;
}
function button(action,title,text=title,cls=''){return `<button type="button" data-action="${action}" title="${esc(title)}" class="${cls}">${text}</button>`;}
function legacyRenderShell(){
 $('#app').innerHTML=`<header class="topbar"><div class="brand"><span class="logo">⌁</span><div><strong>Pipeline Studio <span class="version-tag">0.2</span></strong><small>ИНТЕРАКТИВНЫЕ ПРОЦЕССЫ</small></div></div><div class="project-head"><strong id="project-title"></strong><div id="save-status" class="save-status"></div></div><div class="spacer"></div><div id="top-actions" class="row"></div></header><main class="workspace"><aside class="leftbar" id="left"></aside><section class="center"><div id="subbar" class="subbar"></div><div class="canvas-wrap"><div id="stage"><div id="world"><div id="frames"></div><svg id="edges"></svg><svg id="ink"></svg><div id="nodes"></div></div></div><div id="tools" class="toolrail"></div><div class="canvas-hint">Колесо — масштаб · пробел / средняя кнопка — панорама · Shift — выделение</div><div class="zoom-tools">${button('zoom-out','Уменьшить','−')}<span class="zoom-label" id="zoom-label"></span>${button('zoom-in','Увеличить','+')}${button('fit','Вписать видимую схему','⛶')}</div></div></section><aside id="inspector" class="rightbar"></aside></main>`;
 $('#app').addEventListener('click',onAppClick);$('#modal-root').addEventListener('click',e=>{const x=e.target.closest('[data-open-material]');if(x)openMaterial(x.dataset.openMaterial);});$('#app').addEventListener('change',onChange);$('#stage').addEventListener('pointerdown',onPointerDown);$('#stage').addEventListener('wheel',onWheel,{passive:false});$('#stage').addEventListener('dblclick',onDoubleClick);$('#stage').addEventListener('contextmenu',contextMenu);$('#stage').addEventListener('dragover',e=>e.preventDefault());$('#stage').addEventListener('drop',onDrop);
 document.addEventListener('keydown',onKey);document.addEventListener('keyup',e=>{if(e.code==='Space')S.space=false;});
 window.addEventListener('resize',()=>renderScene());window.addEventListener('beforeunload',e=>{if(S.dirty){e.preventDefault();e.returnValue='';}});
}
function legacyRender(){if(!S.project)return;$('#project-title').textContent=S.project.title;$('#app').classList.toggle('read-only',S.readOnly);renderTop();renderLeft();renderSubbar();renderTools();renderScene();renderInspector();updateStatus();}
function legacyRenderTop(){
 $('#top-actions').innerHTML=(S.locked?'<span class="reader-label">Опубликовано · просмотр</span>':button('preview',S.readOnly?'Вернуться к редактированию':'Режим просмотра',S.readOnly?'В редактор':'Режим просмотра'))+button('registry','Реестр материалов',`Материалы <span class="badge">${S.project.materials.length}</span>`)+(S.readOnly?'':button('publish','Опубликовать текущую версию','Опубликовать','primary'))+button('menu','Проект и экспорт','···','icon');
}
function legacyRenderSubbar(){const p=page();$('#subbar').innerHTML=`<span>${esc(p.title)}</span><small>${p.nodes.length} блоков · ${p.edges.length} связей</small><div class="spacer"></div><label class="row muted" style="font-size:11px"><input id="compact" type="checkbox" ${S.compact?'checked':''}> Уплотнять ветки</label>${button('expand-all','Раскрыть все группы','Раскрыть всё')}${button('collapse-all','Свернуть все группы','Свернуть всё')}`;}
function legacyRenderLeft(){
 const p=page(),h=C.hierarchy(p),q=S.search.toLowerCase();const results=q?p.nodes.filter(n=>(n.title+' '+(n.table?.cells.flat().filter(Boolean).map(c=>c.text).join(' ')||'')).toLowerCase().includes(q)):[];
 const nodeItem=(n,depth=0)=>`<span class="outline-node" style="padding-left:${8+depth*12}px" data-focus="${esc(n.id)}">${richText(n.title||'Без названия')}</span>`;
 const branch=(g,depth)=>`<div class="nav-row" style="padding-left:${depth*12}px"><button class="nav-item" data-toggle-group="${esc(g.id)}" aria-expanded="${!collapsed().has(g.id)}"><span>${collapsed().has(g.id)?'›':'⌄'}</span><span class="dot" style="background:${esc(g.color||'#7376e6')}"></span><strong>${esc(g.title)}</strong><span class="count">${h.members(g.id).length}</span></button>${S.readOnly?'':`<button class="nav-gear" data-edit-group="${esc(g.id)}" title="Настроить подпроцесс">···</button>`}</div>${collapsed().has(g.id)?'':(g.members||[]).map(id=>p.nodes.find(n=>n.id===id)).filter(Boolean).map(n=>nodeItem(n,depth+1)).join('')+h.children.get(g.id).map(c=>branch(c,depth+1)).join('')}`;
 $('#left').innerHTML=`<div class="caps row spread">Проект ${!S.readOnly?button('new-page','Добавить страницу','+','icon ghost'):''}</div><div class="pages">${S.project.pages.map((p,i)=>`<button class="page-item ${i===S.pageIndex?'active':''}" data-page="${i}">▱ &nbsp; ${esc(p.title)}</button>`).join('')}</div><div class="divider"></div><div class="caps row spread">Навигация ${S.readOnly?'':button('groups','Управление вложенными подпроцессами','⚙','icon ghost')}</div><input id="search" placeholder="Найти блок или текст…" value="${esc(S.search)}" style="margin:12px 0"><div id="outline">${q?`<small>Найдено: ${results.length}</small>`+results.map(n=>nodeItem(n)).join(''):h.roots.map(g=>branch(g,0)).join('')+`<small style="display:block;margin:14px 0 6px">Вне подпроцессов</small>`+p.nodes.filter(n=>!h.owner.has(n.id)&&!n.anchorId).map(n=>nodeItem(n)).join('')}</div><div class="left-footer">${button('help','Как пользоваться','? &nbsp; Как пользоваться','ghost')}<p>${S.server?'● Серверное хранилище':'● Локальный режим браузера'}<br>Без внешних библиотек и CDN</p></div>`;
 $('#search').addEventListener('input',e=>{S.search=e.target.value;const start=e.target.selectionStart;renderLeft();$('#search').focus();$('#search').setSelectionRange(start,start);renderScene();});
}
function legacyRenderTools(){
 const tools=[['select','Выделение (V)'],['pan','Панорама (H)'],['block','Добавить блок (B)'],['decision','Добавить условие'],['text','Добавить текст (T)'],['table','Добавить таблицу'],['image','Изображение'],['emoji','Эмодзи'],['pen','Карандаш (P)'],['line','Линия'],['arrow','Стрелка'],['rect','Прямоугольник'],['ellipse','Эллипс']];
 $('#tools').innerHTML=tools.filter(([t])=>!S.readOnly||['select','pan'].includes(t)).map(([t,title])=>`<button data-tool="${t}" title="${title}" class="${S.tool===t?'active':''}">${sign(t)}</button>`).join('')+(S.readOnly?'':`<div class="sep"></div>${button('undo','Отменить (Ctrl+Z)','↶')}${button('redo','Повторить (Ctrl+Y)','↷')}`);
}
function legacyTableHTML(n){const table=n.table;if(!table)return '';const cols=table.cells[0]?.length||1;const widths=table.widths||Array(cols).fill(1);const sum=widths.reduce((a,b)=>a+b,0)||cols;return `<table><colgroup>${Array.from({length:cols},(_,i)=>`<col style="width:${100*(widths[i]||1)/sum}%">`).join('')}</colgroup><tbody>${table.cells.map(row=>'<tr>'+row.map(c=>!c?'':`<td rowspan="${c.rowspan||1}" colspan="${c.colspan||1}" style="background:${esc(c.fill||'#ffffff')};text-align:${esc(c.align||'left')};font-weight:${c.bold?'700':'inherit'}">${c.html?cleanHTML(c.html):richText(c.text)}${c.material?` <span data-open-material="${esc(c.material)}" title="Открыть связанный материал" style="cursor:pointer;color:#555ce9">↗</span>`:''}</td>`).join('')+'</tr>').join('')}</tbody></table>`;}
function legacyNodeHTML(n,print=false){
 const summary=n.type==='summary';const icon=n.type==='image'?assetURL(mat(n.imageMaterial)):null;const picked=S.selected.has(n.id);const badges=(n.materials||[]).filter(id=>mat(id));const counts={};for(const id of badges){const k=mat(id).kind;counts[k]=(counts[k]||0)+1;}
 const body=summary?`<div class="node-label">${richText(n.title)}</div><div class="summary-sub">${n.count} блоков · нажмите, чтобы раскрыть</div>`:n.type==='table'?`<div class="table-title">${label(n)}</div>${S.folded.has(n.id)?`<div class="summary-sub" style="padding:8px 12px">${n.table.cells.length} строк · таблица свёрнута</div>`:tableHTML(n)}`:n.type==='image'?`<img class="photo" alt="${esc(n.title)}" src="${esc(icon||'')}">`:`<div class="node-label" style="text-align:${esc(n.align||'center')};font-weight:${n.bold?'700':'400'};font-style:${n.italic?'italic':'normal'}">${label(n)}</div>`;
 const handles=print||S.readOnly||summary?'':C.ports(n).map(p=>`<span class="port ${p.id.includes('-')?'special':''}" data-port="${esc(p.id)}" data-owner="${esc(n.id)}" title="Фиксированный порт: ${esc(portLabels[p.side]||p.side)}" style="left:${p.x*100}%;top:${p.y*100}%"></span>`).join('')+`<span class="resize" data-resize="${esc(n.id)}" ${n.autoSize?'hidden':''}></span>`;
 const attached=(n.icons||[]).map(ic=>`<img class="attached-icon" alt="Иконка" src="${esc(ic.src||assetURL(mat(ic.material)))}" style="left:${ic.x??-18}px;top:${ic.y??-18}px;width:${ic.w||36}px;height:${ic.h||36}px">`).join('');
 const mh=!print&&badges.length?`<div class="material-badges">${Object.entries(counts).map(([k,c])=>`<button data-node-material="${esc(n.id)}" data-kind="${esc(k)}" title="${esc(k==='video'?'Смотреть видео':k==='image'?'Изображения':k==='link'?'Ссылки':'Материалы')}">${sign(k)} ${c}</button>`).join('')}</div>`:'';
 return `<div class="node ${esc(n.type)} ${picked&&!print?'selected':''} ${badges.length?'has-materials':''} ${S.search&&n.title.toLowerCase().includes(S.search.toLowerCase())?'search-hit':''}" data-node="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;background:${esc(n.fill||'#fff')};border-color:${esc(n.stroke||'#9aa8bf')};font-size:${n.fontSize||13}px"><div class="node-body">${body}</div>${attached}${mh}${handles}</div>`;
}
function legacyRenderScene(){
 if(!page())return;S.display=C.display(page(),collapsed(),S.compact,S.folded);
 const d=S.display;$('#frames').innerHTML=d.frames.map(f=>`<div class="group-frame" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;border-color:${esc(f.color)}55"><button class="group-label" data-toggle-group="${esc(f.id)}" style="color:${esc(f.color)}" title="Свернуть / раскрыть подпроцесс">${collapsed().has(f.id)?"›":"⌄"} ${esc(f.title)}</button></div>`).join('');
 $('#nodes').innerHTML=d.nodes.map(n=>nodeHTML(n)).join('');renderEdges();renderInk();transform();
}
function legacyRenderEdges(){
 const ns=new Map(S.display.nodes.map(n=>[n.id,n]));
 $('#edges').innerHTML=`<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0L8 4L0 8Z" fill="#96a3ba"/></marker></defs>`+S.display.edges.map(e=>{
  const p=C.edgePath(e,ns);if(!p)return '';const selected=S.selectedEdge===e.id;
  return `<path class="edge ${selected?'selected':''}" d="${p.d}" ${e.arrow?'marker-end="url(#arrowhead)"':''} ${e.dashed?'stroke-dasharray="6 4"':''}/><path class="edge-hit" data-edge="${esc(e.id)}" d="${p.d}"/><text class="edge-label" x="${p.x}" y="${p.y-7}" text-anchor="middle">${esc(e.label||'')}${e.count>1?' ×'+e.count:''}</text>${selected&&!S.readOnly&&!e.proxy?p.controls.map((w,i)=>`<circle class="route-handle" data-route-edge="${esc(e.id)}" data-route-index="${i}" cx="${w.x}" cy="${w.y}" r="${6/Math.max(.3,S.view.z)}"><title>Точка ${i+1}: перетащить; Shift + двойной щелчок — удалить</title></circle>`).join(''):''}`;
 }).join('');
}
function inkData(stroke){let pts=stroke.points;if(stroke.anchor){const host=S.display.nodes.find(n=>n.id===stroke.anchor);if(!host)return null;pts=pts.map(p=>({x:p.x+host.x,y:p.y+host.y}));}if(!pts?.length)return null;const a=pts[0],b=pts.at(-1);if(stroke.type==='rect')return {tag:'rect',attrs:`x="${Math.min(a.x,b.x)}" y="${Math.min(a.y,b.y)}" width="${Math.abs(b.x-a.x)}" height="${Math.abs(b.y-a.y)}"`};if(stroke.type==='ellipse')return {tag:'ellipse',attrs:`cx="${(a.x+b.x)/2}" cy="${(a.y+b.y)/2}" rx="${Math.abs(b.x-a.x)/2}" ry="${Math.abs(b.y-a.y)/2}"`};return {tag:'path',attrs:`d="${pts.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' ')}"`};}
function strokeHTML(s,print=false){const d=inkData(s);return d?`<${d.tag} ${d.attrs} fill="none" stroke="${esc(s.color)}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round" ${s.type==='arrow'?'marker-end="url(#ink-arrow)"':''} data-drawing="${esc(s.id)}" style="pointer-events:stroke;cursor:pointer;${!print&&s.id===S.selectedDrawing?'filter:drop-shadow(0 0 3px #555ce9)':''}"/>`:'';}
function renderInk(){
 const list=page().drawings||[];$('#ink').innerHTML=`<defs><marker id="ink-arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>`+list.filter(s=>!s.legacy||(!S.compact&&collapsed().size===0)).map(s=>strokeHTML(s)).join('')+'<path id="draft-stroke" fill="none" stroke="#555ce9" stroke-width="3" stroke-linecap="round"/>';
}
function transform(){const v=S.view;$('#world').style.transform=`translate(${v.x}px,${v.y}px) scale(${v.z})`;$('#zoom-label').textContent=Math.round(v.z*100)+'%';
 const grid=$('#stage');if(S.editModes?.grid){const unit=Math.max(2,Number(S.editModes.gridSize)||20)*v.z,step=unit*Math.max(1,Math.ceil(8/unit));grid.style.backgroundSize=`${step}px ${step}px`;grid.style.backgroundPosition=`${v.x}px ${v.y}px`;}else{grid.style.backgroundSize='22px 22px';grid.style.backgroundPosition='0 0';}
}
function legacySceneBounds(p,d){
 const rects=[...d.nodes,...d.frames];const edgeNodes=new Map(d.nodes.map(n=>[n.id,n]));for(const e of d.edges){const path=C.edgePath(e,edgeNodes);for(const pt of path?.points||[])rects.push({x:pt.x-4,y:pt.y-4,w:8,h:8});}for(const n of d.nodes)for(const ic of n.icons||[])rects.push({x:n.x+(ic.x||0),y:n.y+(ic.y||0),w:ic.w||36,h:ic.h||36});
 for(const stroke of p.drawings||[]){if(stroke.legacy&&(S.compact||(S.collapsed[p.id]?.size||0)>0))continue;const host=stroke.anchor?d.nodes.find(n=>n.id===stroke.anchor):null;if(stroke.anchor&&!host)continue;for(const pt of stroke.points||[])rects.push({x:pt.x+(host?.x||0)-4,y:pt.y+(host?.y||0)-4,w:8,h:8});}
 return C.bounds(rects);
}
function fit(ids){const nodes=ids?S.display.nodes.filter(n=>ids.includes(n.id)):S.display.nodes;if(!nodes.length)return;const b=ids?C.bounds(nodes):sceneBounds(page(),S.display),st=$('#stage').getBoundingClientRect();const z=Math.max(.025,Math.min(1.3,(st.width-140)/(b.w+40),(st.height-100)/(b.h+40)));S.view={z,x:(st.width-b.w*z)/2-b.x*z+25,y:(st.height-b.h*z)/2-b.y*z};transform();}
function legacyFocusNode(id){const n=page().nodes.find(n=>n.id===id);if(!n)return;const h=C.hierarchy(page()),owner=h.owner.get(n.anchorId||id);for(const gid of h.ancestors(owner))collapsed().delete(gid);S.selected=new Set([id]);S.selectedEdge=null;S.selectedDrawing=null;render();const d=S.display.nodes.find(n=>n.id===id);if(d){const st=$('#stage').getBoundingClientRect(),z=Math.min(1.2,Math.max(.45,(st.width-100)/d.w));S.view={z,x:st.width/2-(d.x+d.w/2)*z,y:st.height/2-(d.y+d.h/2)*z};transform();}}
function legacyToggleGroup(id){
 const old=S.display.frames.find(f=>f.id===id),before=old?{x:old.x,y:old.y}:null;
 if(!S.readOnly)checkpoint();if(collapsed().has(id))collapsed().delete(id);else collapsed().add(id);
 S.selected.clear();S.selectedEdge=null;S.selectedDrawing=null;render();
 const after=S.display.frames.find(f=>f.id===id);if(before&&after){S.view.x+=(before.x-after.x)*S.view.z;S.view.y+=(before.y-after.y)*S.view.z;transform();}
}
function field(label,id,value,type='text'){return `<label class="field">${label}<input id="${id}" type="${type}" value="${esc(value)}"></label>`;}
function legacyRenderInspector(){
 const p=page(),n=selected();
 if(S.selectedDrawing){const s=p.drawings.find(s=>s.id===S.selectedDrawing);if(s){$('#inspector').innerHTML=`<div class="caps">Рисунок</div><h2 style="margin-top:12px">${esc(s.type)}</h2><p class="muted">${s.anchor?'Привязан к блоку':'Свободный объект на холсте'}</p>${S.readOnly?'':`<div class="grid2">${field('Цвет','stroke-color',s.color,'color')}${field('Толщина','stroke-width',s.width,'number')}</div>${button('delete','Удалить рисунок','Удалить','danger full')}`}`;return;}}
 if(S.selectedEdge){const e=p.edges.find(e=>e.id===S.selectedEdge);if(e){const src=p.nodes.find(n=>n.id===e.source),dst=p.nodes.find(n=>n.id===e.target);$('#inspector').innerHTML=`<div class="caps">Фиксированная связь</div><h3 style="margin:15px 0">${esc(src.title)} → ${esc(dst.title)}</h3><p class="muted">Стороны подключения сохраняются при перемещении. Здесь можно изменить их вручную.</p>${S.readOnly?`<p>${esc(e.label)}</p>`:`<div class="stack">${field('Подпись','edge-label',e.label)}<label class="field">Выход<select id="edge-source-port">${C.ports(src).map(p=>`<option value="${esc(p.id)}" ${p.id===e.sourcePort?'selected':''}>${esc(portLabels[p.side]||p.side)} · ${Math.round((p.side==='left'||p.side==='right'?p.y:p.x)*100)}%</option>`).join('')}</select></label><label class="field">Вход<select id="edge-target-port">${C.ports(dst).map(p=>`<option value="${esc(p.id)}" ${p.id===e.targetPort?'selected':''}>${esc(portLabels[p.side]||p.side)} · ${Math.round((p.side==='left'||p.side==='right'?p.y:p.x)*100)}%</option>`).join('')}</select></label><label><input id="edge-arrow" type="checkbox" ${e.arrow?'checked':''}> Стрелка</label><label><input id="edge-dashed" type="checkbox" ${e.dashed?'checked':''}> Пунктир</label>${routeInspector(e)}${button('delete','Удалить связь','Удалить связь','danger')}</div>`}`;return;}}
 if(S.selected.size>1){$('#inspector').innerHTML=`<div class="caps">Множественное выделение</div><h2 style="margin-top:15px">${S.selected.size} блоков</h2><p class="table-editor-hint muted">Shift + щелчок добавляет блок к выделению. Shift + движение по пустому холсту выделяет рамкой.</p>${S.readOnly?'':`<div class="stack">${button('group','Объединить выбранные блоки в подпроцесс','Создать подпроцесс','primary')}${arrangeButtons()}${button('duplicate','Дублировать выделение','Дублировать')}${button('delete','Удалить выделенные блоки','Удалить','danger')}</div>`}`;return;}
 if(!n){$('#inspector').innerHTML=`<div class="empty-inspector"><div class="empty-icon">◇</div><h3>Ваш процесс, наглядно</h3><p class="muted">Выберите блок, чтобы ${S.readOnly?'открыть связанные материалы.':'изменить оформление, прикрепить материалы или настроить таблицу.'}</p><div class="stat-grid"><div class="stat"><strong>${p.nodes.length}</strong><small>блоков на странице</small></div><div class="stat"><strong>${p.edges.length}</strong><small>фиксированных связей</small></div></div></div><div class="caps">Возможности</div><div class="tip">✓ Видео поверх схемы<br>✓ Центральный реестр материалов<br>✓ Объединение ячеек<br>✓ Цветные эмодзи в PDF<br>✓ Привязанные изображения<br>✓ Рисование на холсте</div><div class="divider"></div>${S.readOnly?'':button('import','Импорт схемы или проекта','Импорт draw.io / JSON','full')}<p class="tip">${S.server?'Загруженные файлы хранятся под устойчивыми ID на этом сервере.':'Файлы и схема сохраняются в этом браузере. Для передачи используйте экспорт с файлами.'}</p>`;return;}
 const mats=(n.materials||[]).map(mat).filter(Boolean);const base=`<div class="row spread"><span class="caps">${esc(n.type==='table'?'Таблица':n.type==='image'?'Изображение':'Блок процесса')}</span>${S.readOnly?'':button('duplicate','Дублировать','⧉','icon ghost')}</div>`;
 const ms=`<div class="divider"></div><div class="row spread"><h3>Материалы <span class="badge">${mats.length}</span></h3>${S.readOnly?'':button('attach','Прикрепить материал','+','icon')}</div><div class="stack">${mats.map(m=>`<div class="material-row"><span>${sign(m.kind)}</span><div class="info"><strong>${esc(m.title)}</strong><small>${esc(m.kind)} · версия ${m.version||1}</small></div><button class="icon" data-open-material="${esc(m.id)}" title="Открыть">↗</button>${S.readOnly?'':`<button class="icon ghost" data-detach="${esc(m.id)}" title="Отвязать от блока">×</button>`}</div>`).join('')||'<small>Материалов пока нет</small>'}</div>`;
 if(S.readOnly){$('#inspector').innerHTML=base+`<h2 style="margin-top:20px;font-size:17px">${richText(n.title)}</h2>`+(n.type==='table'?button('table-view','Открыть таблицу','Открыть таблицу','full'):'')+ms;return;}
 $('#inspector').innerHTML=base+`<div class="stack" style="margin-top:14px"><label class="field">Название / текст<textarea id="node-title" rows="4">${esc(n.title)}</textarea></label><div class="row">${button('emoji-text','Вставить эмодзи в текст','☺ Эмодзи')}${button('edit-text','Расширенный редактор текста','Текст')}</div><div class="grid2">${field('Заливка','node-fill',n.fill==='transparent'?'#ffffff':n.fill,'color')}${field('Обводка','node-stroke',n.stroke==='transparent'?'#ffffff':n.stroke,'color')}</div><div class="grid2">${field('Ширина','node-width',n.w,'number')}${field('Высота','node-height',n.h,'number')}</div><div class="grid2">${field('Размер текста','node-font',n.fontSize||13,'number')}<label class="field">Выравнивание<select id="node-align">${['left','center','right'].map((v,i)=>`<option value="${v}" ${n.align===v||!n.align&&v==='center'?'selected':''}>${['Слева','По центру','Справа'][i]}</option>`).join('')}</select></label></div><div class="row">${button('bold','Полужирный','<b>B</b>',n.bold?'active':'')}${button('italic','Курсив','<i>I</i>',n.italic?'active':'')}${button('auto-height','Подобрать высоту по содержимому','Автовысота')}</div>${n.type==='table'?`<div class="row">${button('table-edit','Редактор таблицы: объединение и разъединение','Редактор таблицы','primary')}${button('table-fold','Свернуть / раскрыть таблицу',S.folded.has(n.id)?'⌄':'−')}</div>`:''}<div class="row">${button('icon-upload','Загрузить иконку, связанную с блоком','▧ Иконка')}${button('icon-emoji','Прикрепить эмодзи как иконку','☺')}</div>${(n.icons||[]).length?`<div class="notice">Иконок: ${n.icons.length}. Настройте смещение и размер ниже.<div class="grid2">${field('X иконки','icon-x',n.icons.at(-1).x??-18,'number')}${field('Y иконки','icon-y',n.icons.at(-1).y??-18,'number')}${field('Размер','icon-size',n.icons.at(-1).w||36,'number')}${button('remove-icon','Удалить последнюю иконку','Удалить')}</div></div>`:''}${n.type==='image'?`<label class="field">Привязка изображения к блоку<select id="image-anchor"><option value="">Свободное изображение</option>${p.nodes.filter(x=>x.id!==n.id&&!x.anchorId&&x.type!=='image').map(x=>`<option value="${esc(x.id)}" ${n.anchorId===x.id?'selected':''}>${esc(x.title.slice(0,60))}</option>`).join('')}</select></label>`:''}<label class="field">Подпроцесс<select id="node-group"><option value="">Вне подпроцессов</option>${C.hierarchy(p).flat.map(({group:g,path})=>`<option value="${esc(g.id)}" ${g.members.includes(n.id)?'selected':''}>${esc(path)}</option>`).join('')}</select></label></div>`+ms+`<div class="divider"></div><div class="row">${button('group','Создать подпроцесс из выделения','Подпроцесс')}${button('group-edit','Настроить родительский подпроцесс','⚙')}${button('delete','Удалить блок','Удалить','danger')}</div><div class="node-id" style="margin-top:18px">ID: ${esc(n.id)}</div>`;
}
function worldPoint(e){const r=$('#stage').getBoundingClientRect();return {x:(e.clientX-r.left-S.view.x)/S.view.z,y:(e.clientY-r.top-S.view.y)/S.view.z};}
function nodeCenter(){const r=$('#stage').getBoundingClientRect();return {x:(r.width/2-S.view.x)/S.view.z,y:(r.height/2-S.view.y)/S.view.z};}
function legacyMakeNode(type,x,y){
 const title={block:'Новый этап',decision:'Условие',text:'Текст',table:'Новая таблица',ellipse:'Событие',image:'Изображение'}[type]||'Новый этап';
 const n={id:C.uid('node'),type,title,html:'',x,y,w:type==='table'?510:200,h:type==='table'?170:type==='text'?70:90,fill:type==='text'?'transparent':'#ffffff',stroke:type==='text'?'transparent':'#a5b2c9',fontSize:14,materials:[],icons:[],ports:C.ports({}),group:null};
 if(type==='table')n.table={cells:Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>({text:r===0?['Этап','Результат','Комментарий'][c]:'',rowspan:1,colspan:1,fill:r===0?'#eff2ff':'#ffffff'}))),widths:[170,170,170]};
 return n;
}
function legacyAddNode(type,point=nodeCenter()){change(()=>{const n=makeNode(type,point.x,point.y);page().nodes.push(n);S.selected=new Set([n.id]);if(S.compact){S.compact=false;collapsed().clear();}S.tool='select';});fit([...S.selected]);}
function v4SetTool(t){if(S.readOnly&&!['select','pan'].includes(t))return;if(t==='image'){pickFiles('image/*',false).then(fs=>fs.length&&insertImages(fs));return;}if(t==='emoji'){emojiPicker(g=>{const p=nodeCenter();change(()=>{const n=makeNode('text',p.x,p.y);n.title=g;n.w=100;n.h=100;n.fontSize=54;page().nodes.push(n);S.selected=new Set([n.id]);S.compact=false;collapsed().clear();});fit([...S.selected]);});return;}S.tool=t;renderTools();$('#stage').style.cursor=t==='pan'?'grab':['pen','line','arrow','rect','ellipse'].includes(t)?'crosshair':'default';}
async function legacyOnAppClick(e){
 try{
  const tool=e.target.closest('[data-tool]');if(tool)return setTool(tool.dataset.tool);
  const pp=e.target.closest('[data-page]');if(pp){S.pageIndex=Number(pp.dataset.page);S.selected.clear();S.selectedEdge=null;S.selectedDrawing=null;S.search='';render();fit();return;}
  const ge=e.target.closest('[data-edit-group]');if(ge)return groupEditor(ge.dataset.editGroup);const tg=e.target.closest('[data-toggle-group]');if(tg)return toggleGroup(tg.dataset.toggleGroup);
  const focus=e.target.closest('[data-focus]');if(focus)return focusNode(focus.dataset.focus);
  const om=e.target.closest('[data-open-material]');if(om)return openMaterial(om.dataset.openMaterial);
  const detach=e.target.closest('[data-detach]');if(detach){change(()=>selected().materials=selected().materials.filter(id=>id!==detach.dataset.detach));return;}
  const badge=e.target.closest('[data-node-material]');if(badge){e.stopPropagation();const n=S.display.nodes.find(n=>n.id===badge.dataset.nodeMaterial);if(n)showNodeMaterials(n,badge.dataset.kind);return;}
  const a=e.target.closest('[data-action]');if(a)return await action(a.dataset.action);
  if(S.justDragged){S.justDragged=false;return;}
  const nd=e.target.closest('[data-node]');if(nd){const n=S.display.nodes.find(n=>n.id===nd.dataset.node);if(n?.type==='summary')toggleGroup(n.groupId);}
 }catch(err){toast(err.message,7000);}
}
async function legacyAction(a){
 const n=selected();
 if(S.readOnly&&['group-edit','groups','route-add','route-clear'].includes(a))return;
 if(a==='fit')return fit();if(a==='zoom-in'||a==='zoom-out'){const r=$('#stage').getBoundingClientRect();zoom(a==='zoom-in'?1.2:1/1.2,r.width/2,r.height/2);return;}
 if(a==='undo')return undo();if(a==='redo')return redo();
 if(a==='preview'){if(S.locked)return;if(!S.readOnly)await save();S.readOnly=!S.readOnly;S.tool='select';render();return;}
 if(a==='expand-all'){collapsed().clear();render();fit();return;}if(a==='collapse-all'){page().groups.forEach(g=>collapsed().add(g.id));render();fit();return;}
 if(a==='groups')return groupsDialog();if(a==='group-edit')return groupEditor(C.hierarchy(page()).owner.get(n?.id));if(a.startsWith('arrange-'))return arrangeSelection(a.slice(8));if(a==='route-add')return addRoutePoint();if(a==='route-clear')return resetRoute();if(a==='menu')return projectMenu();if(a==='help')return help();if(a==='registry')return registry();if(a==='publish')return publish();if(a==='import')return importFile();
 if(a==='new-page'){inputDialog('Новая страница','Название', 'Новый процесс',title=>change(()=>{S.project.pages.push({id:C.uid('page'),title,nodes:[],edges:[],groups:[],drawings:[]});S.pageIndex=S.project.pages.length-1;S.selected.clear();}));return;}
 if(a==='rename-project'){inputDialog('Название проекта','Название',S.project.title,title=>change(()=>S.project.title=title));return;}
 if(a==='rename-page'){inputDialog('Название страницы','Название',page().title,title=>change(()=>page().title=title));return;}
 if(a==='layout'){closeModal();change(()=>{S.project.pages[S.pageIndex]=C.autoLayout(page());collapsed().clear();S.compact=false;});fit();return;}
 if(a==='layout-group'&&n){const g=page().groups.find(g=>g.members.includes(n.id));change(()=>S.project.pages[S.pageIndex]=C.autoLayout(page(),g?.id));render();fit();return;}
 if(a==='original-positions'){change(()=>{page().nodes.forEach(n=>{if(n.original){n.x=n.original.x;n.y=n.original.y;n.offsetX=0;n.offsetY=0;}});S.compact=false;collapsed().clear();});closeModal();fit();return;}
 if(a==='save'){await save();toast('Сохранено');return;}
 if(a==='export-json')return exportJSON();if(a==='portable-view')return exportHTML(true);if(a==='portable-edit')return exportHTML(false);
 if(a==='server-backup'){await save();downloadURL('/api/backup','pipeline-backup.zip');return;}
 if(a==='print')return printDialog();if(a==='report')return importReport();
 if(a==='delete'){if(S.readOnly)return;if(S.selectedDrawing){change(()=>{page().drawings=page().drawings.filter(s=>s.id!==S.selectedDrawing);S.selectedDrawing=null;});return;}if(S.selectedEdge){change(()=>{page().edges=page().edges.filter(e=>e.id!==S.selectedEdge);S.selectedEdge=null;});return;}if(!S.selected.size)return;confirmDialog('Удалить выделение?',`Блоков: ${S.selected.size}. Связанные линии также будут удалены. Самих материалов это не удалит.`,()=>change(()=>{const ids=new Set(S.selected);for(const v of page().nodes)if(ids.has(v.anchorId))ids.add(v.id);page().nodes=page().nodes.filter(v=>!ids.has(v.id));page().edges=page().edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target));page().groups.forEach(g=>g.members=g.members.filter(id=>!ids.has(id)));page().drawings=page().drawings.filter(s=>!ids.has(s.anchor));S.selected.clear();}));return;}
 if(a==='duplicate'&&S.selected.size){change(()=>{const copies=page().nodes.filter(n=>S.selected.has(n.id)).map(C.clone),ids=new Map(copies.map(n=>[n.id,C.uid('node')]));for(const cp of copies){const old=cp.id;cp.id=ids.get(old);cp.offsetX=(cp.offsetX||0)+38;cp.offsetY=(cp.offsetY||0)+38;if(ids.has(cp.anchorId))cp.anchorId=ids.get(cp.anchorId);else{cp.anchorId=null;}page().nodes.push(cp);page().groups.forEach(g=>{if(g.members.includes(old))g.members.push(cp.id);});}for(const e of [...page().edges])if(ids.has(e.source)&&ids.has(e.target))page().edges.push({...C.clone(e),id:C.uid('edge'),source:ids.get(e.source),target:ids.get(e.target)});S.selected=new Set(copies.map(n=>n.id));});return;}
 if(a==='group'&&S.selected.size){
  const ids=page().nodes.filter(n=>S.selected.has(n.id)&&!n.anchorId).map(n=>n.id);if(!ids.length)return toast('Выберите текстовый блок или самостоятельный этап');
  const h=C.hierarchy(page()),owners=new Set(ids.map(id=>h.owner.get(id)||null)),parentId=owners.size===1?[...owners][0]:null;
  inputDialog('Новый подпроцесс','Название'+(parentId?' · внутри '+h.byId.get(parentId).title:''),'Подпроцесс',title=>change(()=>{
   const gid=C.uid('group');page().groups.forEach(g=>g.members=g.members.filter(id=>!ids.includes(id)));page().groups.push({id:gid,title,members:ids,parentId,color:parentId?h.byId.get(parentId).color:'#7376e6',order:page().groups.length});
   ids.forEach(id=>page().nodes.find(n=>n.id===id).group=gid);for(const id of h.ancestors(parentId))collapsed().delete(id);S.selected.clear();collapsed().add(gid);S.compact=true;
  }));return;
 }
 if(a==='ungroup'&&n){change(()=>{page().groups.forEach(g=>g.members=g.members.filter(id=>id!==n.id));n.group=null;});return;}
 if(a==='attach'&&n)return attachDialog(n.id);
 if(a==='table-edit'&&n?.table)return tableEditor(n);if(a==='table-view'&&n?.table){modal(n.title,`<div class="node table" style="position:static;width:100%;height:auto;user-select:text">${tableHTML(n)}</div>`,'');return;}
 if(a==='table-fold'&&n){if(S.folded.has(n.id))S.folded.delete(n.id);else S.folded.add(n.id);render();return;}
 if(a==='bold'&&n){change(()=>{n.bold=!n.bold;});return;}if(a==='italic'&&n){change(()=>{n.italic=!n.italic;});return;}
 if(a==='auto-height'&&n){autoHeight(n);return;}
 if(a==='edit-text'&&n){editText(n);return;}
 if(a==='emoji-text'&&n){emojiPicker(g=>change(()=>{n.title+=g;n.html='';}));return;}
 if(a==='icon-emoji'&&n){emojiPicker(g=>change(()=>n.icons.push({id:C.uid('icon'),src:emojiURL(g),x:-18,y:-18,w:36,h:36})));return;}
 if(a==='remove-icon'&&n){change(()=>n.icons.pop());return;}
 if(a==='icon-upload'&&n){const fs=await pickFiles('image/*',false);if(!fs.length)return;const m=await uploadFile(fs[0]);change(()=>n.icons.push({id:C.uid('icon'),material:m.id,x:-18,y:-18,w:40,h:40}));return;}
 if(a==='draw-settings'){drawingSettings();return;}
}
function autoHeight(n){const el=$(`[data-node="${CSS.escape(n.id)}"]`);if(!el)return;const height=n.table?(el.querySelector('table')?.scrollHeight||40)+el.querySelector('.table-title').offsetHeight+((n.materials||[]).length?30:4):(el.querySelector('.node-label')?.scrollHeight||30)+28+((n.materials||[]).length?28:0);change(()=>n.h=Math.max(40,height));}
function legacyOnChange(e){
 if(e.target.id==='compact'){S.compact=e.target.checked;render();fit();return;}if(S.readOnly)return;
 const n=selected(),id=e.target.id,v=e.target.value;
 if(id.startsWith('node-')&&n){change(()=>{if(id==='node-title'){n.title=v;n.html='';}if(id==='node-fill')n.fill=v;if(id==='node-stroke')n.stroke=v;if(id==='node-width')n.w=Math.max(40,Math.min(4000,Number(v)||200));if(id==='node-height')n.h=Math.max(25,Math.min(10000,Number(v)||80));if(id==='node-font')n.fontSize=Math.max(8,Math.min(160,Number(v)||14));if(id==='node-align')n.align=v;if(id==='node-group'){page().groups.forEach(g=>g.members=g.members.filter(id=>id!==n.id));if(v){const g=page().groups.find(g=>g.id===v);g.members.push(n.id);for(const gid of C.hierarchy(page()).ancestors(v))collapsed().delete(gid);}n.group=v||null;}});return;}
 if(id.startsWith('icon-')&&n?.icons.length){change(()=>{const ic=n.icons.at(-1);if(id==='icon-x')ic.x=Number(v)||0;if(id==='icon-y')ic.y=Number(v)||0;if(id==='icon-size')ic.w=ic.h=Math.max(12,Math.min(600,Number(v)||36));});return;}
 if(id==='image-anchor'&&n){const target=S.display.nodes.find(nn=>nn.id===v),self=S.display.nodes.find(nn=>nn.id===n.id);change(()=>{n.anchorId=v||null;if(target){n.anchorX=self.x-target.x;n.anchorY=self.y-target.y;}else if(self){n.x=self.x;n.y=self.y;}n.offsetX=n.offsetY=0;});return;}
 if(id.startsWith('edge-')&&S.selectedEdge){const edge=page().edges.find(x=>x.id===S.selectedEdge);if(edge)change(()=>{if(id==='edge-label')edge.label=v;if(id==='edge-source-port')edge.sourcePort=v;if(id==='edge-target-port')edge.targetPort=v;if(id==='edge-arrow')edge.arrow=e.target.checked;if(id==='edge-dashed')edge.dashed=e.target.checked;});return;}
 if(id.startsWith('stroke-')&&S.selectedDrawing){const d=page().drawings.find(s=>s.id===S.selectedDrawing);if(d)change(()=>{if(id==='stroke-color')d.color=v;if(id==='stroke-width')d.width=Math.max(1,Math.min(30,Number(v)||3));});}
}
function zoom(factor,cx,cy){const old=S.view.z,z=Math.max(.025,Math.min(4,old*factor));S.view.x=cx-(cx-S.view.x)*z/old;S.view.y=cy-(cy-S.view.y)*z/old;S.view.z=z;transform();}
function onWheel(e){if(e.target.closest('textarea,input'))return;e.preventDefault();const r=$('#stage').getBoundingClientRect();if(e.shiftKey&&!e.ctrlKey){S.view.x-=e.deltaY;transform();return;}zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);}
function legacyOnPointerDown(e){
 if(e.target.closest('button,a'))return;const target=e.target,wp=worldPoint(e);S.justDragged=false;
 if(e.button===1||S.space||S.tool==='pan'){
  e.preventDefault();const initial={...S.view};startDrag(e,ev=>{S.view.x=initial.x+ev.clientX-e.clientX;S.view.y=initial.y+ev.clientY-e.clientY;transform();});return;
 }
 if(e.button!==0)return;
 const routeHandle=target.closest('[data-route-index]');
 if(routeHandle&&!S.readOnly){e.preventDefault();const edge=page().edges.find(x=>x.id===routeHandle.dataset.routeEdge),i=Number(routeHandle.dataset.routeIndex);if(!edge?.waypoints?.[i])return;const source=S.display.nodes.find(x=>x.id===edge.source);const origin=C.endpoint(source,edge.sourcePort,'right');let moved=false;
  startDrag(e,ev=>{if(!moved){checkpoint();moved=true;}const pt=worldPoint(ev);edge.waypoints[i]={dx:pt.x-origin.x,dy:pt.y-origin.y};const shown=S.display.edges.find(x=>x.id===edge.id);if(shown)shown.waypoints=edge.waypoints;renderEdges();},()=>{if(moved){changed();renderInspector();}});return;
 }
 const handle=target.closest('[data-port]');
 if(handle&&!S.readOnly){e.preventDefault();const owner=handle.dataset.owner,pid=handle.dataset.port;const d=S.display.nodes.find(n=>n.id===owner);const p=C.endpoint(d,pid,'right');startDrag(e,ev=>{const q=worldPoint(ev);$('#draft-stroke').setAttribute('d',`M${p.x},${p.y}L${q.x},${q.y}`);},ev=>{const t=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('[data-port]');$('#draft-stroke').setAttribute('d','');if(t&&(t.dataset.owner!==owner||t.dataset.port!==pid))change(()=>page().edges.push({id:C.uid('edge'),source:owner,target:t.dataset.owner,sourcePort:pid,targetPort:t.dataset.port,label:'',arrow:true,dashed:false}));});return;}
 if(['pen','line','arrow','rect','ellipse'].includes(S.tool)&&!S.readOnly){
  e.preventDefault();const st={id:C.uid('stroke'),type:S.tool,points:[wp],color:S.drawColor,width:S.drawWidth,anchor:null};const anchor=S.anchorDrawing&&selected()?S.display.nodes.find(n=>n.id===selected().id):null;
  startDrag(e,ev=>{const q=worldPoint(ev);if(st.type==='pen'){const prev=st.points.at(-1);if(Math.hypot(q.x-prev.x,q.y-prev.y)>1.5/S.view.z)st.points.push(q);}else st.points=[wp,q];$('#ink').querySelector('.draft-ink')?.remove();$('#ink').insertAdjacentHTML('beforeend',strokeHTML(st).replace('data-drawing=', 'class="draft-ink" data-drawing='));},()=>{if(st.points.length<2){renderInk();return;}if(anchor){st.anchor=anchor.id;st.points=st.points.map(p=>({x:p.x-anchor.x,y:p.y-anchor.y}));}change(()=>{page().drawings.push(st);S.selectedDrawing=st.id;S.selected.clear();});});return;
 }
 if(['block','decision','text','table'].includes(S.tool)&&!S.readOnly){addNode(S.tool,wp);return;}
 const resize=target.closest('[data-resize]');if(resize&&!S.readOnly){const n=page().nodes.find(n=>n.id===resize.dataset.resize);const orig={w:n.w,h:n.h};checkpoint();startDrag(e,ev=>{const p=worldPoint(ev);n.w=Math.max(40,orig.w+p.x-wp.x);n.h=Math.max(25,orig.h+p.y-wp.y);const el=$(`[data-node="${CSS.escape(n.id)}"]`);el.style.width=n.w+'px';el.style.height=n.h+'px';const dn=S.display.nodes.find(x=>x.id===n.id);dn.w=n.w;dn.h=n.h;renderEdges();},()=>{changed();render();});return;}
 const nd=target.closest('[data-node]');
 if(nd){const id=nd.dataset.node,n=S.display.nodes.find(n=>n.id===id);if(n?.type==='summary')return;
  S.selectedDrawing=null;S.selectedEdge=null;
  if(e.shiftKey){if(S.selected.has(id))S.selected.delete(id);else S.selected.add(id);}else if(!S.selected.has(id))S.selected=new Set([id]);
  $$('.node').forEach(el=>el.classList.toggle('selected',S.selected.has(el.dataset.node)));renderInspector();
  if(S.readOnly||e.shiftKey)return;
  e.preventDefault();const before=new Map(page().nodes.filter(n=>S.selected.has(n.id)).map(n=>[n.id,{x:n.offsetX||0,y:n.offsetY||0,anchorX:n.anchorX||0,anchorY:n.anchorY||0}]));const visual=C.clone(S.display.nodes);let moved=false;
  startDrag(e,ev=>{const p=worldPoint(ev),dx=p.x-wp.x,dy=p.y-wp.y;if(!moved&&Math.hypot(dx,dy)*S.view.z<3)return;if(!moved){checkpoint();moved=true;}
   for(const vn of S.display.nodes){const original=visual.find(x=>x.id===vn.id);const actual=page().nodes.find(n=>n.id===vn.id);const follows=S.selected.has(vn.id)||actual?.anchorId&&S.selected.has(actual.anchorId);if(follows){vn.x=original.x+dx;vn.y=original.y+dy;const el=$(`[data-node="${CSS.escape(vn.id)}"]`);if(el){el.style.left=vn.x+'px';el.style.top=vn.y+'px';}}}
   S.dragDelta={dx,dy};renderEdges();renderInk();
  },()=>{if(moved){const {dx,dy}=S.dragDelta;for(const [id,o] of before){const actual=page().nodes.find(n=>n.id===id);if(actual.anchorId){if(!S.selected.has(actual.anchorId)){actual.anchorX=o.anchorX+dx;actual.anchorY=o.anchorY+dy;}}else{actual.offsetX=o.x+dx;actual.offsetY=o.y+dy;}}changed();render();}});return;
 }
 const ed=target.closest('[data-edge]');if(ed){S.selectedEdge=ed.dataset.edge;S.selected.clear();S.selectedDrawing=null;renderInspector();renderEdges();return;}
 const drawing=target.closest('[data-drawing]');if(drawing){S.selectedDrawing=drawing.dataset.drawing;S.selected.clear();S.selectedEdge=null;renderInspector();renderInk();return;}
 if(e.shiftKey&&!S.readOnly){const start=wp;const rect=document.createElement('div');rect.className='selection-box';$('#world').append(rect);startDrag(e,ev=>{const p=worldPoint(ev);Object.assign(rect.style,{left:Math.min(p.x,start.x)+'px',top:Math.min(p.y,start.y)+'px',width:Math.abs(p.x-start.x)+'px',height:Math.abs(p.y-start.y)+'px'});},ev=>{const p=worldPoint(ev),x0=Math.min(p.x,start.x),x1=Math.max(p.x,start.x),y0=Math.min(p.y,start.y),y1=Math.max(p.y,start.y);rect.remove();S.selected=new Set(S.display.nodes.filter(n=>n.type!=='summary'&&n.x>=x0&&n.x+n.w<=x1&&n.y>=y0&&n.y+n.h<=y1).map(n=>n.id));render();});return;}
 S.selected.clear();S.selectedEdge=null;S.selectedDrawing=null;renderInspector();$$('.selected').forEach(n=>n.classList.remove('selected'));
 const v={...S.view};startDrag(e,ev=>{S.view.x=v.x+ev.clientX-e.clientX;S.view.y=v.y+ev.clientY-e.clientY;transform();});
}
function startDrag(initial,move,end){let raf=null,last=null;const mm=e=>{last=e;if(Math.abs(e.clientX-initial.clientX)+Math.abs(e.clientY-initial.clientY)>3)S.justDragged=true;if(!raf)raf=requestAnimationFrame(()=>{raf=null;move(last);});};const up=e=>{document.removeEventListener('pointermove',mm);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);if(raf){cancelAnimationFrame(raf);raf=null;if(last)move(last);}end?.(e);};document.addEventListener('pointermove',mm);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);}
function legacyOnDoubleClick(e){
 if(S.readOnly)return;const handle=e.target.closest('[data-route-index]');if(handle){if(e.shiftKey){const edge=page().edges.find(x=>x.id===handle.dataset.routeEdge);change(()=>edge.waypoints.splice(Number(handle.dataset.routeIndex),1));}return;}
 const edge=e.target.closest('[data-edge]');if(edge){S.selectedEdge=edge.dataset.edge;addRoutePoint(worldPoint(e));return;}
 const nd=e.target.closest('[data-node]');if(!nd)return;const n=page().nodes.find(n=>n.id===nd.dataset.node);if(n)n.type==='table'?tableEditor(n):editText(n);
}
function legacyOnKey(e){
 const editable=e.target.closest('input,textarea,select,[contenteditable=true]');if(e.key==='Escape'){if(currentModal){closeModal();return;}S.tool='select';S.selected.clear();S.selectedEdge=null;render();return;}if(currentModal||editable)return;
 if(e.code==='Space'){e.preventDefault();S.space=true;return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save().catch(err=>toast(err.message));return;}
 if(S.readOnly)return;
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&S.selected.size){e.preventDefault();nudge(e.key,e.shiftKey?10:1);return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();action('duplicate');return;}
 if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();action('delete');return;}
 const tools={v:'select',h:'pan',b:'block',t:'text',p:'pen'};if(tools[e.key.toLowerCase()])setTool(tools[e.key.toLowerCase()]);
}
async function onDrop(e){e.preventDefault();if(S.readOnly)return;const fs=[...e.dataTransfer.files];if(!fs.length)return;try{const pt=worldPoint(e);if(fs.every(f=>f.type.startsWith('image/')))await insertImages(fs,pt);else{const n=selected();for(const file of fs){const m=await uploadFile(file);if(n)change(()=>{if(!n.materials.includes(m.id))n.materials.push(m.id);});}render();toast(n?'Файлы прикреплены к выбранному блоку':'Файлы добавлены в реестр материалов');}}catch(err){toast(err.message,8000);}}
function modal(title,content,footer='',small=false){
 lastFocus=document.activeElement;$('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal ${small?'small':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="modal-head"><h2>${esc(title)}</h2><div class="spacer"></div><button data-close class="icon ghost" aria-label="Закрыть">×</button></header><div class="modal-content">${content}</div>${footer?`<footer class="modal-foot">${footer}</footer>`:''}</section></div>`;currentModal={title};$('[data-close]').onclick=closeModal;$('.modal-overlay').addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))closeModal();});const focus=$('input,textarea,button,select',$('.modal'));focus?.focus();$('.modal').addEventListener('keydown',e=>{if(e.key==='Tab'){const elements=$$('button,input,textarea,select,a[href],[contenteditable=true]',$('.modal')).filter(x=>!x.disabled);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}});return $('.modal-content');
}
function closeModal(){const video=$('video');if(video)video.pause();$('#modal-root').innerHTML='';currentModal=null;if(lastFocus?.isConnected)lastFocus.focus();}
function inputDialog(title,fieldLabel,value,done){modal(title,`<label class="field">${esc(fieldLabel)}<input id="dialog-input" value="${esc(value)}"></label>`,`<button id="dialog-save" class="primary">Сохранить</button>`,true);$('#dialog-save').onclick=()=>{const val=$('#dialog-input').value.trim();if(!val)return toast('Введите название');closeModal();done(val);};$('#dialog-input').onkeydown=e=>{if(e.key==='Enter')$('#dialog-save').click();};$('#dialog-input').select();}
function confirmDialog(title,content,done){modal(title,`<p>${esc(content)}</p>`,`<button id="cancel-confirm">Отмена</button><button id="yes-confirm" class="primary">Подтвердить</button>`,true);$('#cancel-confirm').onclick=closeModal;$('#yes-confirm').onclick=()=>{closeModal();done();};}
function emojiPicker(done){modal('Цветные эмодзи',`<p class="muted">144 встроенных изображения. Они сохраняют цвет при PDF-печати и не требуют подключения к интернету.</p><div class="emoji-picker">${Object.entries(EMOJI).map(([g,url])=>`<button data-emoji="${esc(g)}" title="${esc(g)}"><img alt="${esc(g)}" src="${url}"></button>`).join('')}</div>`,'',true);$$('[data-emoji]').forEach(b=>b.onclick=()=>{const g=b.dataset.emoji;closeModal();done(g);});}
function editText(n){
 modal('Текст блока',`<label class="field">Текст<textarea id="text-edit" style="min-height:190px">${esc(n.title)}</textarea></label><div class="row" style="margin-top:10px"><button id="text-emoji">☺ Вставить эмодзи</button><small>Переносы строк сохраняются</small></div><div class="notice">При изменении текста исходное HTML-оформление этого блока заменяется текстом. Размер, цвет, иконки и ссылки сохраняются.</div>`,`<button id="text-save" class="primary">Применить</button>`,true);
 $('#text-emoji').onclick=()=>{const value=$('#text-edit').value,at=$('#text-edit').selectionStart;emojiPicker(g=>{editText({...n,title:value.slice(0,at)+g+value.slice(at)});});};
 $('#text-save').onclick=()=>{const title=$('#text-edit').value;closeModal();change(()=>{const real=page().nodes.find(x=>x.id===n.id);real.title=title;real.html='';});};
}
function legacyTableEditor(node){
 let t=C.clone(node.table),a={r:0,c:0},b={r:0,c:0},history=[],future=[];const remember=()=>{history.push(C.clone(t));if(history.length>60)history.shift();future=[];};
 const footer='<small style="margin-right:auto">Изменения попадут в блок только после «Применить».</small><button id="table-cancel">Отмена</button><button id="table-save" class="primary">Применить</button>';
 modal('Таблица — '+node.title,`<div class="table-editor-toolbar"><button id="merge-cells">Объединить</button><button id="split-cell">Разъединить</button><span class="spacer"></span><button id="table-undo" title="Отмена изменения таблицы">↶</button><button id="table-redo" title="Повтор">↷</button><button id="row-before" title="Перед выбранной строкой">Строка ↑</button><button id="add-row" title="После выбранной строки">Строка ↓</button><button id="col-before" title="Перед выбранным столбцом">Столбец ←</button><button id="add-col" title="После выбранного столбца">Столбец →</button><button id="remove-row">− Строка</button><button id="remove-col">− Столбец</button><input id="cell-color" type="color" value="#ffffff" title="Заливка диапазона"><button id="cell-bold"><b>B</b></button><select id="cell-align" title="Выравнивание диапазона" style="width:105px"><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></select><button id="cell-emoji">☺</button><label class="row muted">Столбец, px <input id="col-width" type="number" min="40" max="1200" style="width:75px" value="170"></label></div><p class="muted">Пишите сразу в ячейке. Диапазон: щелчок по первой → Shift + щелчок по последней. Можно вставлять прямоугольный диапазон из Excel (Ctrl+V).</p><div class="cell-link-editor" id="cell-link-editor" hidden></div><div class="table-editor-wrap" id="table-grid"></div>`,footer);
 currentModal.kind='table';
 function sync(){for(const el of $$('[data-cell]')){const [r,c]=el.dataset.cell.split(',').map(Number);const cell=t.cells[r]?.[c];if(cell&&el.innerText!==cell.text){cell.text=el.innerText;cell.html='';}}}
 function selection(){const q=C.normalizedRange(a,b);$$('[data-cell]').forEach(el=>{const [r,c]=el.dataset.cell.split(',').map(Number);el.classList.toggle('cell-selected',r>=q.r0&&r<=q.r1&&c>=q.c0&&c<=q.c1);});$('#col-width').value=t.widths?.[a.c]||170;}
 function draw(){
  const cols=t.cells[0].length;$('#table-grid').innerHTML=`<table lang="ru" class="table-editor wrap-${t.wordWrap||'words'}" style="width:${Math.max(700,(t.widths||[]).reduce((a,b)=>a+b,0))}px"><colgroup>${Array.from({length:cols},(_,i)=>`<col style="width:${t.widths?.[i]||170}px">`).join('')}</colgroup><tbody>${t.cells.map((row,r)=>'<tr>'+row.map((cell,c)=>!cell?'':`<td contenteditable="true" spellcheck="false" data-cell="${r},${c}" rowspan="${cell.rowspan||1}" colspan="${cell.colspan||1}" style="background-color:${esc(cell.fill||'#ffffff')};font-weight:${cell.bold?'700':'400'};text-align:${esc(cell.align||'left')}">${esc(cell.text)}</td>`).join('')+'</tr>').join('')}</tbody></table>`;selection();
  $$('[data-cell]').forEach(el=>{
   el.onpointerdown=e=>{const [r,c]=el.dataset.cell.split(',').map(Number);if(e.shiftKey){e.preventDefault();b={r,c};}else{a=b={r,c};}selection();};
   el.onfocus=()=>{el.dataset.before=el.innerText;};
   el.onblur=()=>{const [r,c]=el.dataset.cell.split(',').map(Number);if(t.cells[r][c].text!==el.innerText){remember();t.cells[r][c].text=el.innerText.replace(/\u00ad/g,'');t.cells[r][c].html=cleanHTML(el.innerHTML);}};
   el.onpaste=e=>{
    e.preventDefault();const raw=e.clipboardData.getData('text/plain');const [r0,c0]=el.dataset.cell.split(',').map(Number);if(!raw.includes('\t')){document.execCommand('insertText',false,raw);return;}
    sync();const values=raw.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(l=>l.split('\t'));remember();let newt=C.clone(t);
    try{const colCount=Math.max(newt.cells[0].length,c0+Math.max(...values.map(r=>r.length)));while(newt.cells.length<r0+values.length)newt.cells.push(Array.from({length:newt.cells[0].length},()=>({text:'',rowspan:1,colspan:1})));for(const row of newt.cells)while(row.length<colCount)row.push({text:'',rowspan:1,colspan:1});while(newt.widths.length<colCount)newt.widths.push(170);values.forEach((row,r)=>row.forEach((text,c)=>{const cell=newt.cells[r+r0][c+c0];if(!cell||(cell.rowspan||1)>1||(cell.colspan||1)>1)throw Error('Вставка пересекает объединенные ячейки. Сначала разъедините их.');cell.text=text;cell.html='';}));C.validateTable(newt);t=newt;draw();}catch(err){toast(err.message);}
   };
  });
 }
 const operate=fn=>{try{sync();remember();fn();C.validateTable(t);draw();}catch(err){if(history.length)t=history.pop();toast(err.message,6000);draw();}};
 $('#row-before').onclick=()=>operate(()=>{t=C.tableAxis(t,'row',a.r);a=b={r:a.r+1,c:a.c};});$('#col-before').onclick=()=>operate(()=>{t=C.tableAxis(t,'col',a.c);a=b={r:a.r,c:a.c+1};});
 $('#merge-cells').onclick=()=>operate(()=>t=C.mergeTable(t,a,b));$('#split-cell').onclick=()=>operate(()=>t=C.splitTable(t,a.r,a.c));
 $('#table-undo').onclick=()=>{sync();if(history.length){future.push(C.clone(t));t=history.pop();draw();}};$('#table-redo').onclick=()=>{if(future.length){history.push(C.clone(t));t=future.pop();draw();}};
 $('#add-row').onclick=()=>operate(()=>{t=C.tableAxis(t,'row',a.r+1);});
 $('#add-col').onclick=()=>operate(()=>{t=C.tableAxis(t,'col',a.c+1);});
 $('#remove-row').onclick=()=>operate(()=>{t=C.tableAxis(t,'row',a.r,true);a=b={r:Math.min(a.r,t.cells.length-1),c:Math.min(a.c,t.cells[0].length-1)};});
 $('#remove-col').onclick=()=>operate(()=>{t=C.tableAxis(t,'col',a.c,true);a=b={r:Math.min(a.r,t.cells.length-1),c:Math.min(a.c,t.cells[0].length-1)};});
 function mapSelection(fn){const q=C.normalizedRange(a,b);for(let r=q.r0;r<=q.r1;r++)for(let c=q.c0;c<=q.c1;c++)if(t.cells[r]?.[c])fn(t.cells[r][c]);}
 $('#cell-color').onchange=e=>operate(()=>mapSelection(c=>c.fill=e.target.value));$('#cell-bold').onclick=()=>operate(()=>mapSelection(c=>c.bold=!c.bold));
 $('#cell-align').onchange=e=>operate(()=>mapSelection(c=>c.align=e.target.value));
 $('#col-width').onchange=e=>operate(()=>t.widths[a.c]=Math.max(40,Math.min(1200,Number(e.target.value)||170)));
 $('#cell-emoji').onclick=()=>{const box=document.createElement('div');box.className='emoji-picker notice';box.innerHTML=Object.entries(EMOJI).slice(0,70).map(([g,u])=>`<button title="${esc(g)}" data-insert-cell-emoji="${esc(g)}"><img width="24" src="${u}" alt="${esc(g)}"></button>`).join('');$('#table-grid').before(box);$$('[data-insert-cell-emoji]',box).forEach(btn=>btn.onclick=()=>{operate(()=>{t.cells[a.r][a.c].text+=btn.dataset.insertCellEmoji;t.cells[a.r][a.c].html='';});box.remove();});};
 $('#table-cancel').onclick=closeModal;$('#table-save').onclick=()=>{try{sync();C.validateTable(t);const measured=$('.table-editor').offsetHeight;const real=page().nodes.find(n=>n.id===node.id);closeModal();change(()=>{real.table=t;real.w=Math.max(180,t.widths.reduce((a,b)=>a+b,0));real.h=Math.max(80,measured+42+(real.materials.length?28:0));});const visual=$(`[data-node="${CSS.escape(real.id)}"]`);if(visual?.querySelector('table')){real.h=visual.querySelector('table').offsetHeight+visual.querySelector('.table-title').offsetHeight+6+(real.materials.length?28:0);changed();render();}}catch(err){toast(err.message);}};draw();
}
function pickFiles(accept='',multiple=true){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.style.display='none';document.body.append(input);input.onchange=()=>{resolve([...input.files]);input.remove();};input.oncancel=()=>{resolve([]);input.remove();};input.click();});}
async function legacyUploadFile(file,replaceId){
 if(file.size>512*1024*1024)throw Error('Файл больше 512 МБ');toast('Загрузка: '+file.name,10000);let m;
 if(S.server){m=await request('/api/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),...(replaceId?{'X-Replace-Material':replaceId}:{})},body:file});}
 else{const aid=guid();await dbPut('asset:'+aid,file);liveAssets.set(aid,URL.createObjectURL(file));const kind=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':file.type.startsWith('image/')?'image':file.type==='application/pdf'||/\.pdf$/i.test(file.name)?'pdf':'document';const prev=replaceId?mat(replaceId):null;m={id:replaceId||C.uid('material'),title:prev?.title||file.name,kind,asset:aid,filename:file.name,mime:file.type||'application/octet-stream',size:file.size,version:(prev?.version||0)+1,status:'Загружен'};}
 checkpoint();const i=S.project.materials.findIndex(x=>x.id===m.id);if(i>=0)S.project.materials[i]=m;else S.project.materials.push(m);changed();renderTop();renderInspector();toast('Загружено: '+m.title);return m;
}
async function v4InsertImages(files,point=nodeCenter()){
 for(let i=0;i<files.length;i++){const m=await uploadFile(files[i]);const image=new Image();image.src=assetURL(m);try{await image.decode();}catch{}const w=Math.min(250,image.naturalWidth||200),h=w*(image.naturalHeight||200)/(image.naturalWidth||200);change(()=>{const n=makeNode('image',point.x+i*40,point.y+i*40);n.title=m.title;n.w=w;n.h=h;n.imageMaterial=m.id;n.materials=[];n.fill='transparent';n.stroke='transparent';page().nodes.push(n);S.selected=new Set([n.id]);S.compact=false;collapsed().clear();});}fit([...S.selected]);}
function usage(id){const out=[];S.project.pages.forEach((p,i)=>p.nodes.forEach(n=>{if((n.materials||[]).includes(id)||n.imageMaterial===id||n.icons?.some(ic=>ic.material===id)||n.table?.cells.flat().some(c=>C.cellMaterialIds(c).includes(id)))out.push({pageIndex:i,page:p.title,id:n.id,title:n.title});}));return out;}
function legacyRegistry(attachNodeId=null){
 const materials=S.project.materials;modal(attachNodeId?'Прикрепить материал':'Реестр материалов',`<div class="registry-tools row"><input id="registry-search" placeholder="Поиск по названию или адресу…"><div class="spacer"></div>${S.readOnly?'':'<button id="material-relink">Перепривязка адресов</button><button id="material-new-link">+ Ссылка</button><button id="material-upload" class="primary">Загрузить файлы</button>'}</div><div class="notice">Блоки ссылаются на ID материала. «Заменить файл» или изменение адреса в реестре обновляет источник сразу для всех его привязок. Внешние адреса не проверяются автоматически.</div><div style="overflow:auto"><table class="registry"><thead><tr><th>Материал</th><th>Тип / версия</th><th>Привязки</th><th>Действия</th></tr></thead><tbody id="registry-body"></tbody></table></div>`);
 function rows(query=''){const filtered=materials.filter(m=>(m.title+' '+(m.url||'')).toLowerCase().includes(query.toLowerCase()));$('#registry-body').innerHTML=filtered.map(m=>`<tr><td class="title-col">${sign(m.kind)} &nbsp; ${esc(m.title)}<small style="display:block;font-weight:400">${m.asset?(assetURL(m)?'В хранилище приложения':'Файл недоступен в этом браузере'):esc(m.url||'Без адреса')}</small></td><td><span class="badge">${esc(m.kind)}</span><br><small>версия ${m.version||1}</small></td><td><button data-usage="${esc(m.id)}">${usage(m.id).length} блоков</button></td><td><div class="row wrap"><button data-mopen="${esc(m.id)}">Открыть</button>${S.readOnly?'':`<button data-medit="${esc(m.id)}">Изменить</button><button data-mreplace="${esc(m.id)}">Заменить файл</button>`}${attachNodeId?`<button class="primary" data-mattach="${esc(m.id)}">Прикрепить</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="4">Материалы не найдены</td></tr>';
  $$('[data-mopen]').forEach(b=>b.onclick=()=>openMaterial(b.dataset.mopen));$$('[data-medit]').forEach(b=>b.onclick=()=>editMaterial(b.dataset.medit,attachNodeId));$$('[data-mreplace]').forEach(b=>b.onclick=async()=>{try{const fs=await pickFiles('',false);if(fs.length){await uploadFile(fs[0],b.dataset.mreplace);registry(attachNodeId);renderScene();}}catch(err){toast(err.message);}});$$('[data-mattach]').forEach(b=>b.onclick=()=>{const id=b.dataset.mattach;closeModal();change(()=>{const n=page().nodes.find(n=>n.id===attachNodeId);if(n&&!n.materials.includes(id))n.materials.push(id);});toast('Материал прикреплён');});$$('[data-usage]').forEach(b=>b.onclick=()=>showUsage(b.dataset.usage));
 }
 $('#registry-search').oninput=e=>rows(e.target.value);if(!S.readOnly){$('#material-relink').onclick=bulkRelink;$('#material-new-link').onclick=()=>editMaterial(null,attachNodeId);$('#material-upload').onclick=async()=>{try{const fs=await pickFiles();const ids=[];for(const f of fs)ids.push((await uploadFile(f)).id);if(attachNodeId&&ids.length){change(()=>{const n=page().nodes.find(n=>n.id===attachNodeId);n.materials=[...new Set([...n.materials,...ids])];});}registry(attachNodeId);}catch(err){toast(err.message);}};}rows();
}
const attachDialog=id=>registry(id);
function legacyEditMaterial(id,attachNodeId){
 const m=id?mat(id):{title:'',kind:'link',url:'',startAt:0};modal(id?'Изменить материал':'Новый материал-ссылка',`<div class="stack">${field('Название','mat-title',m.title)}<label class="field">Тип<select id="mat-kind">${[['link','Сайт / ссылка'],['video','Видео (прямая ссылка на файл)'],['pdf','PDF'],['document','Документ / презентация'],['image','Изображение'],['audio','Аудио'],['page','Страница внутри проекта']].map(([k,v])=>`<option value="${k}" ${m.kind===k?'selected':''}>${v}</option>`).join('')}</select></label>${field('Адрес HTTP / HTTPS или data:page/id,…','mat-url',m.url||'')}${field('Начать видео с секунды','mat-time',m.startAt||0,'number')}<label class="row"><input id="mat-embed" type="checkbox" ${m.embed?'checked':''}> Разрешить встраивание сайта в окно</label><p class="muted">${m.asset?'У материала уже есть загруженный файл. Чтобы переключиться на внешний адрес, заполните поле адреса. Старая копия останется в хранилище.':'Сайты могут запрещать встраивание. Для YouTube и подобных сервисов используйте разрешённую ссылку встраивания и тип «Сайт», либо открывайте их в новой вкладке.'}</p></div>`,`<button id="mat-save" class="primary">Сохранить</button>`,true);
 $('#mat-save').onclick=()=>{const title=$('#mat-title').value.trim(),url=$('#mat-url').value.trim(),kind=$('#mat-kind').value,startAt=Math.max(0,Number($('#mat-time').value)||0),embed=$('#mat-embed').checked;if(!title)return toast('Введите название');if(url&&!/^(https?:\/\/|data:page\/id,)/i.test(url))return toast('Разрешены только HTTP / HTTPS и внутренние страницы');if(!url&&!m.asset)return toast('Введите адрес или загрузите файл');closeModal();change(()=>{if(id){Object.assign(m,{title,kind,url,startAt,embed,version:(m.version||1)+1});if(url){delete m.asset;delete m.previewAsset;}}else{const mid=C.uid('material');S.project.materials.push({id:mid,title,kind,url,startAt,embed,version:1,status:'Не проверено'});if(attachNodeId){const n=page().nodes.find(n=>n.id===attachNodeId);if(n)n.materials.push(mid);}}});registry(attachNodeId);};
}
function showUsage(id){const us=usage(id);modal('Где используется материал',`<div class="stack">${us.map(u=>`<button class="full" style="justify-content:flex-start;white-space:normal;text-align:left" data-go-page="${u.pageIndex}" data-go-node="${esc(u.id)}"><span>${esc(u.title)}</span><small>${esc(u.page)}</small></button>`).join('')||'<p>Нет привязок в текущем черновике. Материал может использоваться в ранее опубликованных версиях.</p>'}</div>`,'',true);$$('[data-go-node]').forEach(b=>b.onclick=()=>{closeModal();S.pageIndex=Number(b.dataset.goPage);render();focusNode(b.dataset.goNode);});}
function legacyShowNodeMaterials(n,kind){const ms=(n.materials||[]).map(mat).filter(m=>m&&(!kind||m.kind===kind));if(ms.length===1)return openMaterial(ms[0].id);modal(n.title,`<div class="stack">${ms.map(m=>`<button data-view-material="${esc(m.id)}" style="justify-content:flex-start">${sign(m.kind)} ${esc(m.title)}</button>`).join('')}</div>`,'',true);$$('[data-view-material]').forEach(b=>b.onclick=()=>openMaterial(b.dataset.viewMaterial));}
async function legacyOpenMaterial(id){
 if(S.server){try{if(!S.readOnly)await save();const latest=S.pub?(await request('/api/published/'+encodeURIComponent(S.pub))).materials:await request('/api/materials');S.project.materials=latest;}catch(err){toast(err.message,8000);return;}}
 const m=mat(id);if(!m)return toast('Материал не найден');
 if(m.kind==='page'||m.url?.startsWith('data:page/id,')){const pid=m.url.split(',')[1],index=S.project.pages.findIndex(p=>p.id===pid);if(index<0)return toast('Связанная страница отсутствует');closeModal();S.pageIndex=index;S.selected.clear();render();fit();return;}
 const url=assetURL(m),preview=m.previewAsset?assetURL(m,true):m.previewMaterial?assetURL(mat(m.previewMaterial)):null;
 if(!url&&!preview)return modal(m.title,'<div class="notice warn">Файл недоступен. Откройте реестр и замените файл, либо импортируйте проект вместе с материалами.</div>','',true);
 let content='';const meta=`<p class="muted">${esc(m.filename||m.kind)} · версия ${m.version||1}${m.size?' · '+(m.size/1024/1024).toFixed(1)+' МБ':''}</p>`;
 if(m.kind==='video')content=`<video controls preload="metadata" playsinline src="${esc(url)}"></video><p class="muted" id="media-error"></p>`;
 else if(m.kind==='audio')content=`<audio controls src="${esc(url)}"></audio>`;
 else if(m.kind==='image')content=`<img class="viewer-img" alt="${esc(m.title)}" src="${esc(url)}">`;
 else if(m.kind==='pdf'||preview)content=`<iframe title="${esc(m.title)}" src="${esc(preview||url)}"></iframe>`;
 else if(m.kind==='link'&&m.embed)content=`<iframe title="${esc(m.title)}" sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer" src="${esc(url)}"></iframe><p class="muted">Пустое окно может означать, что сайт запрещает встраивание. Используйте «Открыть отдельно».</p>`;
 else if(m.kind==='document')content=`<div class="notice"><h3>Документ / презентация</h3><p>Исходный файл сохранён. Для просмотра внутри окна нужно статическое PDF-превью.</p>${S.readOnly?'':'<div class="row"><button id="create-preview">Создать PDF-превью</button><button id="manual-preview">Прикрепить готовое PDF</button></div>'}<p class="muted">Автоматическая конвертация работает в серверном режиме при установленном LibreOffice. Анимации и встроенные видео презентаций в статическом PDF не воспроизводятся.</p></div>`;
 else content=`<div class="notice"><p>Внешний ресурс:</p><p style="overflow-wrap:anywhere">${esc(m.url)}</p><p class="muted">Ссылка открывается отдельно. В редакторе материала можно разрешить просмотр внутри окна, когда сайт это поддерживает.</p></div>`;
 modal(m.title,meta+content,`<a class="badge" href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="padding:9px 13px;text-decoration:none">Открыть отдельно</a>${m.asset?`<a href="${esc(url+(S.server?(url.includes('?')?'&':'?')+'download=1':''))}" download="${esc(m.filename||m.title)}">Получить исходный файл</a>`:''}`);
 const video=$('video');if(video){video.onloadedmetadata=()=>{if(m.startAt&&m.startAt<video.duration)video.currentTime=m.startAt;};video.onerror=()=>{$('#media-error').textContent='Браузер не смог воспроизвести этот файл. Проверьте кодек (рекомендуется MP4 H.264/AAC или WebM) либо откройте исходный файл.';};}
 if($('#create-preview'))$('#create-preview').onclick=async()=>{if(!S.server)return toast('Автоконвертация доступна после запуска start.cmd / start.sh. Здесь можно прикрепить готовый PDF.');try{$('#create-preview').disabled=true;$('#create-preview').textContent='Конвертирую…';const updated=await request('/api/preview/'+encodeURIComponent(m.id),{method:'POST'});Object.assign(m,updated);changed();openMaterial(m.id);}catch(err){toast(err.message,9000);openMaterial(m.id);}};
 if($('#manual-preview'))$('#manual-preview').onclick=async()=>{try{const files=await pickFiles('.pdf',false);if(files.length){const previewMat=await uploadFile(files[0]);change(()=>{m.previewAsset=previewMat.asset;m.version=(m.version||1)+1;});openMaterial(m.id);}}catch(err){toast(err.message);}};
}
function drawingSettings(){modal('Параметры рисования',`<div class="stack"><div class="grid2">${field('Цвет','draw-color',S.drawColor,'color')}${field('Толщина линии','draw-width',S.drawWidth,'number')}</div><label class="row"><input id="draw-anchor" type="checkbox" ${S.anchorDrawing?'checked':''}> Привязывать рисунок к выбранному блоку</label><p class="muted">Привязанный рисунок перемещается и скрывается вместе с блоком. Для свободного рисунка снимите флажок.</p></div>`,`<button id="draw-settings-save" class="primary">Применить</button>`,true);$('#draw-settings-save').onclick=()=>{S.drawColor=$('#draw-color').value;S.drawWidth=Math.max(1,Math.min(30,Number($('#draw-width').value)||3));S.anchorDrawing=$('#draw-anchor').checked;closeModal();setTool('pen');};}
function legacyProjectMenu(){
 const edit=!S.readOnly;modal('Проект и экспорт',`<div class="grid2">${edit?`${button('save','Сохранить','Сохранить')}${button('rename-project','Название проекта','Название проекта')}${button('rename-page','Название страницы','Название страницы')}${button('import','Импорт XML draw.io / JSON','Импорт draw.io / JSON')}${button('layout','Автоматически расставить блоки всей страницы','Автораскладка страницы')}${button('original-positions','Вернуть импортированные координаты','Исходные координаты')}${button('groups','Вложенность, порядок и названия подпроцессов','Подпроцессы')}${button('draw-settings','Цвет, толщина и привязка рисунка','Настройки рисования')}${button('portable-edit','Автономный редактор с материалами','Автономный HTML-редактор')}`:''}${button('portable-view','Автономная копия для чтения','HTML для пользователей')}${button('export-json','Экспорт проекта и файлов в JSON','JSON с материалами')}${button('print','Подготовить PDF / печать','PDF / печать')}${button('report','Отчёт импорта','Отчёт импорта')}${S.server&&edit?button('server-backup','Резервная копия данных, файлов и публикаций','Резервная копия ZIP'):''}</div><div class="notice">HTML — переносимый снимок, а не автоматически обновляемая публикация. Для актуальных материалов используйте ссылку на серверную публикацию. Видеофайлы увеличивают размер экспорта.</div>`,'',true);$$('[data-action]',$('.modal')).forEach(b=>b.onclick=()=>action(b.dataset.action).catch(err=>toast(err.message,8000)));}
function download(blob,name){const u=URL.createObjectURL(blob);downloadURL(u,name);setTimeout(()=>URL.revokeObjectURL(u),60000);}
function downloadURL(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';document.body.append(a);a.click();a.remove();}
async function legacyPortableProject(){
 const p=C.clone(S.project);p.portableAssets={};const materialBytes=p.materials.reduce((s,m)=>s+(m.size||0),0);if(materialBytes>150*1024*1024)throw Error('Для HTML/JSON размер материалов ограничен 150 МБ. Используйте серверную публикацию или резервную копию ZIP.');
 for(const m of p.materials)for(const key of ['asset','previewAsset']){const id=m[key];if(!id||p.portableAssets[id])continue;let blob;if(S.server){const response=await fetch(assetURL(m,key==='previewAsset'));if(!response.ok)throw Error('Не удалось включить файл '+m.title);blob=await response.blob();}else blob=await dbGet('asset:'+id);if(blob)p.portableAssets[id]=await dataURL(blob);else throw Error('В экспорте отсутствует файл: '+m.title);}
 return p;
}
async function legacyExportJSON(){toast('Подготавливаю проект с материалами…',30000);const p=await portableProject();download(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),'pipeline-project.json');toast('JSON содержит схему и загруженные материалы');}
async function legacySourceText(name,element){if(S.server)return (await fetch('/'+name)).text();const node=document.getElementById(element);if(!node)throw Error('Исходник для автономного экспорта не найден');return node.textContent;}
async function legacyExportHTML(readOnly){
 toast('Подготавливаю автономную копию…',30000);const p=await portableProject();const [css,core,app]=await Promise.all([sourceText('style.css','style-source'),sourceText('core.js','core-source'),sourceText('app.js','app-source')]);
 const safe=o=>JSON.stringify(o).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');const scriptEnd='</scr'+'ipt>';
 const html='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(p.title)+' — Pipeline Studio</title><style id="style-source">'+css+'</style></head><body><div id="app"></div><div id="modal-root"></div><div id="toast" role="status"></div><script>window.SEED='+safe(p)+';window.PORTABLE_READONLY='+readOnly+';window.EMOJI='+safe(EMOJI)+';'+scriptEnd+'<script id="core-source">'+core.replace(/<\/script/gi,'<\\/script')+scriptEnd+'<script id="app-source">'+app.replace(/<\/script/gi,'<\\/script')+scriptEnd+'</body></html>';
 download(new Blob([html],{type:'text/html;charset=utf-8'}),readOnly?'Pipeline-Viewer.html':'Pipeline-Studio.html');toast(readOnly?'Автономный просмотрщик создан':'Автономный редактор создан');
}
async function importFile(){
 closeModal();const fs=await pickFiles('.json,.xml,.drawio',false);if(!fs.length)return;const f=fs[0];let p;
 try{const txt=await f.text();if(txt.trim().startsWith('{'))p=JSON.parse(txt);else{if(!S.server)throw Error('Импорт нового XML draw.io доступен в серверном режиме (start.cmd). Автономный редактор открывает JSON; исходная схема уже встроена.');p=await request('/api/import',{method:'POST',headers:{'Content-Type':'application/xml'},body:txt});}
  p=normalize(p);if(p.format!=='pipeline-studio'||!p.pages?.length)throw Error('Неверный формат проекта');for(const pg of p.pages){if(!Array.isArray(pg.nodes)||!Array.isArray(pg.edges))throw Error('Повреждённая страница');for(const n of pg.nodes)if(n.table)C.validateTable(n.table);}
  confirmDialog('Открыть импортированный проект?',`Текущий черновик будет заменён. Файл: ${f.name}. Перед подтверждением текущую схему можно сохранить через экспорт.`,async()=>{
   try{
    const old=C.clone(S.project),revision=S.project.revision;
    if(S.server&&p.portableAssets){for(const m of p.materials||[]){const originalId=m.id;for(const key of ['asset','previewAsset']){const aid=m[key];if(!aid||!p.portableAssets[aid])continue;const blob=dataBlob(p.portableAssets[aid]);const file=new File([blob],key==='previewAsset'?'preview.pdf':m.filename||'file',{type:blob.type});const uploaded=await request('/api/upload',{method:'POST',headers:{'X-File-Name':encodeURIComponent(file.name)},body:file});m[key]=uploaded.asset;}m.id=originalId;}}
    S.history.push(old);S.redo=[];S.project=p;S.project.revision=revision;const existing=new Map(old.materials.map(m=>[m.id,m]));for(const m of p.materials||[])existing.set(m.id,m);S.project.materials=[...existing.values()];S.pageIndex=0;S.selected.clear();S.collapsed={};await hydrateAssets();changed();render();fit();await save();toast('Проект импортирован');
   }catch(err){toast(err.message,9000);}
  });
 }catch(err){toast(err.message,9000);}
}
async function publish(){
 if(!S.server){modal('Публикация',`<p>Сейчас открыт автономный редактор. Создайте HTML для просмотра или запустите сервер, чтобы получить общую ссылку.</p><button id="publish-offline" class="primary">Создать HTML для пользователей</button>`,'',true);$('#publish-offline').onclick=()=>exportHTML(true).catch(err=>toast(err.message));return;}
 await save();const pub=await request('/api/publish',{method:'POST'});const url=location.origin+pub.path;modal('Версия опубликована',`<p>Публикация хранит снимок схемы. Реестр материалов остаётся общим: обновлённый источник доступен по тому же ID.</p><input id="publication-url" readonly value="${esc(url)}"><div class="notice">Адрес 127.0.0.1 работает только на этом компьютере. Для коллег запустите сервер в локальной сети с паролем и используйте сетевое имя компьютера. На Google Диске хранится архив проекта, а не запущенный сервер.</div>`,`<button id="copy-publication">Копировать</button><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="badge" style="padding:9px">Открыть публикацию</a>`,true);$('#copy-publication').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('Ссылка скопирована');}catch{$('#publication-url').select();toast('Нажмите Ctrl+C для копирования');}};
}
function importReport(){const reports=S.project.importReport||[];modal('Отчёт импорта',`<table class="registry"><thead><tr><th>Страница</th><th>Элементы XML</th><th>Блоки</th><th>Связи</th><th>Таблицы</th></tr></thead><tbody>${reports.map(r=>`<tr><td>${esc(r.page)}</td><td>${r.source_cells}</td><td>${r.nodes}</td><td>${r.edges}</td><td>${r.tables}</td></tr>`).join('')}</tbody></table><div class="notice">Тексты и данные таблиц перенесены из исходника. Ячейки и строки входят в состав таблиц, а подписи связей — в связи; поэтому число блоков меньше числа XML-элементов. Внешние адреса не проверялись. Декоративные стили draw.io нормализованы. Исходные разделительные линии видны в свободном режиме при раскрытых группах.</div><p class="muted">Неразрешённые связи: ${reports.reduce((s,r)=>s+(r.unresolved_edges?.length||0),0)}. Исходный XML хранится отдельно в originals.</p>`);}
function printDialog(){modal('PDF / печать',`<div class="stack"><button id="print-visible" class="primary">Видимая схема целиком · A3</button><button id="print-detail" ${selected()?'':'disabled'}>Выбранный блок / таблица · подробно</button><button id="print-pages">Все страницы: текущая видимость групп</button><div class="notice">В диалоге браузера выберите «Сохранить как PDF». Цветные эмодзи представлены PNG-изображениями. Большую раскрытую схему лучше печатать отдельными подпроцессами, иначе текст при вписывании будет очень мелким. Видео остаётся интерактивным только в HTML / приложении.</div></div>`,'',true);$('#print-visible').onclick=()=>{closeModal();preparePrint('visible');window.print();};$('#print-detail').onclick=()=>{closeModal();preparePrint('detail');window.print();};$('#print-pages').onclick=()=>{closeModal();preparePrint('pages');window.print();};}
function legacyPreparePrint(mode='visible'){
 $$('.print-area').forEach(el=>el.remove());const area=document.createElement('div');area.className='print-area';document.body.append(area);
 if(mode==='detail'&&selected()){
  const n=selected();area.innerHTML=`<section class="print-sheet"><h1>${esc(S.project.title)}</h1><h2>${esc(page().title)}</h2><h3>${richText(n.title)}</h3>${n.table?`<div class="node table" style="position:relative;width:100%;height:auto;border:0;line-height:1.4;user-select:text">${tableHTML(n)}</div>`:`<div style="white-space:pre-wrap;font-size:17px;max-width:100%">${label(n)}</div>`}<div class="print-legend">Pipeline Studio · Материалы: ${(n.materials||[]).map(mat).filter(Boolean).map(m=>esc(m.title)).join(' · ')}</div></section>`;return area;
 }
 const pages=mode==='pages'?S.project.pages:[page()];
 pages.forEach((p,i)=>{const d=C.display(p,S.collapsed[p.id]||new Set(p.groups.map(g=>g.id)),S.compact,S.folded),b=sceneBounds(p,d),w=1450,h=910,z=Math.min(w/(b.w+50),h/(b.h+50),1.4),ns=new Map(d.nodes.map(n=>[n.id,n]));const svg=`<svg style="position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible"><defs><marker id="print-arrow-${i}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#96a3ba"/></marker></defs>${d.edges.map(e=>{const ep=C.edgePath(e,ns);return ep?`<path d="${ep.d}" fill="none" stroke="#96a3ba" stroke-width="1.8" ${e.arrow?`marker-end="url(#print-arrow-${i})"`:''}/><text x="${ep.x}" y="${ep.y-7}" text-anchor="middle" font-size="11">${esc(e.label)}</text>`:'';}).join('')}</svg>`;
  const previous=S.display;S.display=d;const ink=`<svg style="position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible"><defs><marker id="print-ink-arrow-${i}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>`+(p.drawings||[]).filter(st=>!st.legacy||(!S.compact&&(S.collapsed[p.id]?.size||0)===0)).map(s=>strokeHTML(s,true).replaceAll('url(#ink-arrow)',`url(#print-ink-arrow-${i})`)).join('')+'</svg>';S.display=previous;const section=document.createElement('section');section.className='print-sheet';section.innerHTML=`<h1>${esc(S.project.title)}</h1><h2>${esc(p.title)}</h2><div class="diagram-print" style="width:${w}px;height:${Math.min(h,(b.h+50)*z)}px"><div style="position:absolute;transform-origin:0 0;transform:scale(${z}) translate(${25-b.x}px,${25-b.y}px)">${d.frames.map(f=>`<div class="group-frame" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;border-color:${esc(f.color)};background:transparent"><span class="group-label" style="color:${esc(f.color)};background:white">${richText(f.title)}</span></div>`).join('')}${svg}${d.nodes.map(n=>nodeHTML(n,true)).join('')}${ink}</div></div><div class="print-legend">Pipeline Studio · Масштаб схемы ${Math.round(z*100)}% · ${d.nodes.length} видимых блоков · Цветные эмодзи — изображения</div>`;area.append(section);
 });return area;
}
function legacyHelp(){modal('Как пользоваться',`<div class="grid2"><div><h3>Схема</h3><p>Нажмите на название подпроцесса слева или его карточку, чтобы свернуть / раскрыть ветку. «Уплотнять ветки» убирает пустые горизонтальные полосы.</p><p>Блок добавляется инструментом ▭ и щелчком по холсту. Двойной щелчок — текст или таблица. Перетаскивайте блоки; размер меняется за нижний правый угол.</p><p>Связь: перетащите синюю точку одного блока к синей точке другого. При перемещении блоков порты остаются теми же. Линию можно выбрать и изменить её подпись или стороны справа.</p><p>Shift + щелчки — несколько блоков. Shift + рамка на пустом холсте — прямоугольное выделение. Из выделения можно сделать новый подпроцесс.</p></div><div><h3>Материалы и оформление</h3><p>В правой панели нажмите «+» рядом с материалами. Загрузите файл или выберите запись из реестра. Видео и PDF открываются поверх схемы. «Заменить файл» в реестре сохраняет ID и все привязки.</p><p>Таблица: пишите прямо в ячейках, выделяйте диапазон через Shift, объединяйте и разъединяйте. Для иконки выберите эмодзи или загрузите изображение. Самостоятельное изображение можно привязать к текстовому блоку.</p><p>Карандаш, линия, стрелка, прямоугольник и эллипс — инструменты на холсте. Цвет, толщина и привязка рисунка — в меню «··· → Настройки рисования».</p></div></div><div class="notice"><strong>Клавиши:</strong> Ctrl+S — сохранить; Ctrl+Z / Ctrl+Y — отменить / повторить; Ctrl+D — дубликат; Delete — удалить; V — выделение; H или пробел — панорама; B — блок; T — текст; P — карандаш. Колесо меняет масштаб вокруг указателя.</div><h3>Новое в 0.2</h3><p>Подпроцессы: кнопка ⚙ слева или ··· у ветки. Можно менять родителя, порядок и название; расформирование контейнера сохраняет его блоки. Из выделения внутри группы создаётся вложенный подпроцесс.</p><p>Стрелки: двойной щелчок по линии добавляет точку маршрута. Перетащите круглый маркер, чтобы обойти блок; Shift + двойной щелчок по маркеру удаляет точку. Порты остаются фиксированными. Автоматического обхода всех препятствий пока нет.</p><p>Shift-выделение нескольких блоков открывает выравнивание и распределение. Стрелки клавиатуры сдвигают на 1 px, Shift + стрелки — на 10 px. Правый щелчок по блоку открывает команды.</p><p>В таблице строки и столбцы вставляются рядом с выбранной ячейкой; объединения пересчитываются при вставке и удалении. Содержимое объединённой ячейки сохраняется, пока остаётся хотя бы часть её диапазона.</p><h3>Хранение и публикации</h3><p>Автономный HTML сохраняет проект и файлы в IndexedDB этого браузера. Очистка данных браузера удаляет такую копию. Регулярно выгружайте JSON с материалами. Сервер хранит данные в app/data; резервная копия ZIP включает публикации и файлы. Публикация не меняет черновик и доступна только для чтения; пароль читателя не даёт доступ к редакторскому API.</p><p class="muted">Версия 0.2.0 · Цветные изображения эмодзи получены растеризацией Noto Color Emoji (Google / Noto contributors); файл шрифта не поставляется. Это пилотная версия, не аттестованная корпоративная система.</p>`);}
function legacyNormalize(p){
 if(!p||p.format!=='pipeline-studio'||!Array.isArray(p.pages)||!p.pages.length)throw Error('Неверный формат проекта');
 for(const pg of p.pages){for(const n of pg.nodes||[]){for(const k of ['x','y','w','h']){if(!Number.isFinite(n[k])||Math.abs(n[k])>1e7)throw Error('Некорректный размер или координаты блока');}n.fontSize=Math.max(8,Math.min(160,Number(n.fontSize)||13));n.type=['block','decision','text','table','note','ellipse','image'].includes(n.type)?n.type:'block';for(const ic of n.icons||[])for(const k of ['x','y','w','h'])ic[k]=Number.isFinite(ic[k])?ic[k]:36;for(const row of n.table?.cells||[])for(const cell of row)if(cell){cell.rowspan=Number(cell.rowspan)||1;cell.colspan=Number(cell.colspan)||1;if(!Number.isInteger(cell.rowspan)||!Number.isInteger(cell.colspan))throw Error('Неверное объединение ячеек');}}
 for(const st of pg.drawings||[])for(const pt of st.points||[])if(!Number.isFinite(pt.x)||!Number.isFinite(pt.y))throw Error('Некорректный рисунок');}
 p.materials=p.materials||[];p.format='pipeline-studio';p.schemaVersion=2;p.pages.forEach(pg=>{pg.groups=pg.groups||[];pg.drawings=(pg.drawings||[]).map(s=>({...s,legacy:s.legacy??!!s.id.match(/^(NMVc|Nyj)/)}));pg.nodes.forEach(n=>{n.materials=n.materials||[];n.icons=n.icons||[];n.ports=C.ports(n);if(n.table){const cols=Math.max(...n.table.cells.map(r=>r.length));n.table.cells.forEach(row=>{while(row.length<cols)row.push({text:'',rowspan:1,colspan:1});});n.table.widths=n.table.widths||[];while(n.table.widths.length<cols)n.table.widths.push(150);}});C.hierarchy(pg);for(const e of pg.edges||[]){if(e.waypoints&&(!Array.isArray(e.waypoints)||e.waypoints.length>64||e.waypoints.some(w=>!Number.isFinite(w.dx)||!Number.isFinite(w.dy)||Math.abs(w.dx)>1e7||Math.abs(w.dy)>1e7)))throw Error('Некорректные точки маршрута связи');}});return p;
}
async function login(){
 $('#app').innerHTML=`<form class="login" id="login-form"><div class="logo">⌁</div><h1 style="margin-top:20px">Pipeline Studio</h1><p class="muted">Введите пароль редактора или читателя сервера.</p><label class="field">Пароль<input type="password" id="login-password" autocomplete="current-password" required></label><button class="primary full" style="margin-top:15px" type="submit">Войти</button><p class="muted" id="login-error"></p></form>`;
 $('#login-form').onsubmit=async e=>{e.preventDefault();try{const session=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#login-password').value})});S.role=session.role;await loadServer();}catch(err){$('#login-error').textContent=err.message;}};
}
async function legacyLoadServer(){
 if(S.pub){S.project=normalize(await request('/api/published/'+encodeURIComponent(S.pub)));S.readOnly=true;}
 else if(S.role==='reader'){
  const list=await request('/api/publications');$('#app').innerHTML=`<div class="login"><h1>Опубликованные процессы</h1>${list.map(p=>`<a style="display:block;padding:14px 0" href="/?view=${p.id}">${esc(p.title)}</a>`).join('')||'<p>Публикаций пока нет.</p>'}</div>`;return;
 }else S.project=normalize(await request('/api/project'));
 renderShell();render();fit();
}
async function legacyInit(){
 try{
  try{await idbOpen();}catch{S.volatile=true;console.warn('IndexedDB unavailable; use file export to preserve this session.');}
 S.pub=new URLSearchParams(location.search).get('view');S.locked=!!S.pub||!!window.PORTABLE_READONLY;
  if(window.SEED){S.readOnly=!!window.PORTABLE_READONLY;const stored=!S.readOnly?await dbGet('project'):null;S.project=normalize(C.clone(stored?.id===window.SEED.id?stored:window.SEED));await hydrateAssets();renderShell();render();fit();if(!S.readOnly){S.dirty=true;await save();}}
  else{S.server=true;const session=await request('/api/session');S.role=session.role;if(!session.role)await login();else await loadServer();}
 }catch(err){$('#app').innerHTML=`<div class="login"><h1>Не удалось открыть проект</h1><p>${esc(err.message)}</p><p>Для серверной версии запустите start.cmd / start.sh. Автономный HTML открывается без сервера в современном браузере.</p><button onclick="location.reload()">Повторить</button></div>`;console.error(err);}
}
/** Nested subprocess editing is structural; collapse/zoom is only personal presentation. */
function groupsDialog(){
 if(S.readOnly)return;closeModal();const h=C.hierarchy(page());
 modal('Подпроцессы',`<p class="muted">Вложенность не изменяет связи между этапами. Расформирование удаляет только контейнер, но не его содержимое.</p><div class="group-manager">${h.flat.map(({group:g,depth})=>`<div class="group-manager-row" style="padding-left:${depth*22+12}px"><span class="dot" style="background:${esc(g.color||'#7376e6')}"></span><strong>${esc(g.title)}</strong><small>${h.members(g.id).length} блоков · уровень ${depth+1}</small><button data-config-group="${esc(g.id)}">Настроить</button></div>`).join('')||'<p>Выделите блоки и нажмите «Создать подпроцесс».</p>'}</div>`, '<button id="group-new-empty">+ Пустой подпроцесс</button>',true);
 $$('[data-config-group]').forEach(b=>b.onclick=()=>groupEditor(b.dataset.configGroup));
 $('#group-new-empty').onclick=()=>inputDialog('Создать подпроцесс','Название','Подпроцесс',title=>{change(()=>page().groups.push({id:C.uid('group'),title,members:[],parentId:null,order:page().groups.length,color:'#7376e6'}));groupsDialog();});
}
function groupEditor(id){
 if(S.readOnly)return;const h=C.hierarchy(page()),g=h.byId.get(id);if(!g)return groupsDialog();
 const parents=h.flat.filter(({group:x})=>!h.ancestors(x.id).includes(id));
 modal('Подпроцесс: '+g.title,`<div class="stack">${field('Название','group-title',g.title)}<label class="field">Внутри подпроцесса<select id="group-parent"><option value="">Верхний уровень</option>${parents.map(({group:x,path})=>`<option value="${esc(x.id)}" ${g.parentId===x.id?'selected':''}>${esc(path)}</option>`).join('')}</select></label><div class="grid2">${field('Порядок среди соседей','group-order',g.order||0,'number')}${field('Цвет','group-color',g.color||'#7376e6','color')}</div><div class="notice">${g.members.length} прямых блоков; ${h.members(id).length} всего, включая вложенные. Общие этапы лучше оставлять у общего родителя, а не дублировать.</div></div>`,`<button id="group-dissolve" class="danger">Расформировать</button><span class="spacer"></span><button id="group-save" class="primary">Применить</button>`,true);
 $('#group-save').onclick=()=>{try{const title=$('#group-title').value.trim();if(!title)return toast('Введите название');const parentId=$('#group-parent').value,order=Number($('#group-order').value)||0,color=$('#group-color').value;const updated=C.reparentGroup(page(),id,parentId);Object.assign(updated.groups.find(x=>x.id===id),{title,order,color});change(()=>S.project.pages[S.pageIndex]=updated);closeModal();}catch(err){toast(err.message);}};
 $('#group-dissolve').onclick=()=>confirmDialog('Расформировать подпроцесс?',`«${g.title}»: блоки и вложенные группы перейдут к его родителю. Линии и материалы останутся.`,()=>{change(()=>{S.project.pages[S.pageIndex]=C.dissolveGroup(page(),id);collapsed().delete(id);});groupsDialog();});
}
function legacyArrangeButtons(){return `<div class="arrange-panel"><small>Выровнять блоки</small><div class="grid3">${[['left','По левому краю','⇤'],['center','Центры по горизонтали','↔'],['right','По правому краю','⇥'],['top','По верхнему краю','⤒'],['middle','Центры по вертикали','↕'],['bottom','По нижнему краю','⤓']].map(([id,title,symbol])=>button('arrange-'+id,title,symbol)).join('')}</div><div class="row">${button('arrange-horizontal','Равные горизонтальные промежутки','⇹')}${button('arrange-vertical','Равные вертикальные промежутки','⇵')}<small>Распределить</small></div><small>Уплотнённый вид будет зафиксирован для точного размещения.</small></div>`;}
function arrangeSelection(mode){
 if(S.readOnly)return;const p=S.compact?C.materializeLayout(page(),S.display):page(),result=C.arrange(p,[...S.selected],mode);change(()=>{S.project.pages[S.pageIndex]=result;S.compact=false;});
}
function legacyNudge(key,step){
 if(S.readOnly)return;const dx=key==='ArrowLeft'?-step:key==='ArrowRight'?step:0,dy=key==='ArrowUp'?-step:key==='ArrowDown'?step:0;
 change(()=>{if(S.compact){S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);S.compact=false;}for(const n of page().nodes)if(S.selected.has(n.id)){if(n.anchorId){if(!S.selected.has(n.anchorId)){n.anchorX=(n.anchorX||0)+dx;n.anchorY=(n.anchorY||0)+dy;}}else{n.offsetX=(n.offsetX||0)+dx;n.offsetY=(n.offsetY||0)+dy;}}});
}
function legacyRouteInspector(edge){
 const shown=S.display.edges.find(e=>e.id===edge.id);if(shown?.proxy)return '<div class="notice">Это сводная связь свёрнутых групп. Раскройте подпроцессы, чтобы редактировать исходные линии.</div>';
 return `<div class="divider"></div><h3>Маршрут</h3><small>Точек: ${(edge.waypoints||[]).length}. Двойной щелчок по линии добавляет точку. Круглые маркеры можно перетаскивать.</small><div class="row">${button('route-add','Добавить точку обхода','+ Точка')}${button('route-clear','Убрать все ручные точки','Сброс')}</div><small>Shift + двойной щелчок по точке — удалить. Точки хранятся относительно выхода; в свёрнутом виде временно используется сводная линия.</small>`;
}
function addRoutePoint(point){
 if(S.readOnly)return;const edge=page().edges.find(e=>e.id===S.selectedEdge),shown=S.display.edges.find(e=>e.id===S.selectedEdge);if(!edge||!shown)return;
 if(shown.proxy)return toast('Сначала раскройте подпроцессы этой связи');
 if((edge.waypoints||[]).length>=64)return toast('Не более 64 точек на связь');
 const ns=new Map(S.display.nodes.map(n=>[n.id,n])),route=C.edgePath(shown,ns),origin=C.endpoint(ns.get(edge.source),edge.sourcePort,'right');const pt=point||{x:route.x,y:route.y-50};
 let insert=(edge.waypoints||[]).length;
 if(point&&route.controls.length){let best=Infinity,position=0;for(let j=1;j<route.points.length;j++){const a=route.points[j-1],b=route.points[j],vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy,f=den?Math.max(0,Math.min(1,((pt.x-a.x)*vx+(pt.y-a.y)*vy)/den)):0,d=(pt.x-a.x-vx*f)**2+(pt.y-a.y-vy*f)**2;if(d<best){best=d;insert=position;}if(position<route.controls.length&&Math.hypot(b.x-route.controls[position].x,b.y-route.controls[position].y)<.001)position++;}}
 change(()=>{edge.waypoints=edge.waypoints||[];edge.waypoints.splice(insert,0,{dx:pt.x-origin.x,dy:pt.y-origin.y});});
}
function resetRoute(){if(S.readOnly)return;const edge=page().edges.find(e=>e.id===S.selectedEdge);if(edge)change(()=>{edge.waypoints=[];delete edge.manualRoute;delete edge.manualRouteMode;});}
function legacyContextMenu(e){
 if(S.readOnly||currentModal)return;e.preventDefault();document.getElementById('canvas-context')?.remove();
 const nd=e.target.closest('[data-node]'),ed=e.target.closest('[data-edge]');let choices=[];
 if(nd){const n=page().nodes.find(n=>n.id===nd.dataset.node);if(!n)return;if(!S.selected.has(n.id))S.selected=new Set([n.id]);S.selectedEdge=null;S.selectedDrawing=null;renderInspector();choices=[[n.table?'table-edit':'edit-text',n.table?'Редактировать таблицу':'Редактировать текст'],['attach','Прикрепить материалы'],['duplicate','Дублировать'],['group','Создать подпроцесс'],['delete','Удалить']];}
 else if(ed){S.selectedEdge=ed.dataset.edge;S.selected.clear();renderInspector();renderEdges();choices=[['route-add','Добавить точку маршрута'],['route-clear','Сбросить маршрут'],['delete','Удалить связь']];}
 else {choices=[['context-block','Добавить блок здесь'],['context-table','Добавить таблицу здесь'],['groups','Управление подпроцессами'],['fit','Вписать схему']];}
 const point=worldPoint(e),menu=document.createElement('div');menu.id='canvas-context';menu.className='canvas-context';menu.setAttribute('role','menu');menu.style.left=Math.min(e.clientX,innerWidth-245)+'px';menu.style.top=Math.min(e.clientY,innerHeight-250)+'px';menu.innerHTML=choices.map(([id,title])=>`<button role="menuitem" data-context="${id}">${title}</button>`).join('');document.body.append(menu);
 function close(){menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);}
 const outside=ev=>{if(!menu.contains(ev.target))close();},escape=ev=>{if(ev.key==='Escape')close();};document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
 $$('[data-context]',menu).forEach(b=>b.onclick=async()=>{const cmd=b.dataset.context;close();try{if(cmd.startsWith('context-'))addNode(cmd.slice(8),point);else await action(cmd);}catch(err){toast(err.message);}});menu.querySelector('button')?.focus();
}
function legacyBulkRelink(){
 if(S.readOnly)return;modal('Массовая перепривязка адресов',`<div class="stack">${field('Старое начало адреса','relink-old','')}${field('Новое начало адреса','relink-new','')}<p class="muted">Только внешние HTTP/HTTPS-источники. Загруженные файлы, ID материалов и привязки блоков не изменяются. Проверка доступности новых адресов не выполняется.</p><button id="relink-preview">Показать изменения</button><div id="relink-preview-list"></div></div>`,`<button id="relink-apply" class="primary" disabled>Применить</button>`,true);
 let changes=[];const reset=()=>{changes=[];$('#relink-apply').disabled=true;$('#relink-preview-list').textContent='';};$('#relink-old').oninput=reset;$('#relink-new').oninput=reset;
 $('#relink-preview').onclick=()=>{const from=$('#relink-old').value.trim(),to=$('#relink-new').value.trim();try{for(const u of [from,to]){const parsed=new URL(u);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();}}catch{return toast('Введите начало HTTP / HTTPS-адреса без учётных данных');}changes=S.project.materials.filter(m=>!m.asset&&m.url?.startsWith(from)).map(m=>({id:m.id,title:m.title,before:m.url,after:to+m.url.slice(from.length)}));if(changes.some(c=>{try{return !['http:','https:'].includes(new URL(c.after).protocol);}catch{return true;}}))return toast('Некорректный итоговый адрес');$('#relink-preview-list').innerHTML=`<strong>Материалов: ${changes.length}</strong>`+changes.map(c=>`<div class="relink-item"><b>${esc(c.title)}</b><del>${esc(c.before)}</del><span>${esc(c.after)}</span></div>`).join('');$('#relink-apply').disabled=!changes.length;};
 $('#relink-apply').onclick=()=>{if(changes.some(c=>mat(c.id)?.url!==c.before))return toast('Источник изменился: повторите предпросмотр');change(()=>{for(const c of changes){const m=mat(c.id);m.url=c.after;m.version=(m.version||1)+1;m.status='Адрес изменён, не проверен';}});registry();toast('Обновлены адреса: '+changes.length);};
}


/* 0.3: The editor is an application. A document and its referenced files are separate.
   All filesystem access is explicitly granted by the user; imported HTML is parsed, never run. */
const RELEASE='0.7.2';
let DOC={key:null,name:'',handle:null,root:null,files:new Map(),sessionFiles:new Map(),urls:new Map(),direct:false,exportedAt:0};
let recentDocuments=[];
Object.assign(S,{home:false,leftHidden:false,rightHidden:false,selectedEdges:new Set(),selectedBus:null,pendingPort:null,iconEdit:false,selectedIcon:0});
const safeJSON=o=>JSON.stringify(o).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const prettyName=s=>String(s||'Новый процесс').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,150);
const typeName={video:'Видео',pdf:'PDF',link:'Сайт',document:'Документ',image:'Изображение',audio:'Аудио',page:'Переход на страницу'};
function caught(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{if(e?.name!=='AbortError')toast(e.message||String(e),8500);});}
function documentSnapshot(){const p=C.clone(S.project);p.viewState={compact:S.compact,collapsed:Object.fromEntries(Object.entries(S.collapsed).map(([k,v])=>[k,[...v]])),page:S.pageIndex};return p;}
function setDirtyFile(){S.fileDirty=true;}
function changed(){S.dirty=true;S.fileDirty=true;S.editVersion++;clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(e=>toast(e.message,8000)),700);updateStatus();}
function updateStatus(){const el=$('#save-status');if(!el)return;
 const label=S.readOnly?'Просмотр документа':S.saving?'Сохраняю черновик…':S.dirty?'Сохраняется в браузере…':S.server?'Черновик на сервере':S.volatile?'Временная сессия: сохраняйте HTML':'Черновик в браузере';
 el.textContent=label+(!S.readOnly?(S.fileDirty?' · файл ещё не обновлён':' · файл сохранён'):'');el.title=DOC.name||'Документ ещё не сохранён отдельным файлом';
}
async function rememberDocument(){
 if(!DOC.key||S.readOnly)return;
 const rec={key:DOC.key,title:S.project.title,name:DOC.name||'Документ не сохранён',modified:Date.now(),exportedAt:DOC.exportedAt||0,server:!!S.server};
 recentDocuments=[rec,...recentDocuments.filter(r=>r.key!==rec.key)].slice(0,30);await dbPut('recent-v3',recentDocuments);
 if(DOC.handle)try{await dbPut('handle:'+DOC.key,DOC.handle);}catch{}
 if(DOC.root)try{await dbPut('root:'+DOC.key,DOC.root);}catch{}
}
async function save(){
 if(!S.project||S.readOnly||!S.dirty)return;
 if(S.saving){await new Promise(r=>setTimeout(r,80));return save();}
 const version=S.editVersion,p=documentSnapshot(),key=DOC.key,server=S.server;
 S.saving=true;updateStatus();
 try{if(server){const ans=await apiPut('/api/project',p);if(DOC.key===key)S.project.revision=ans.revision;}
  else{p.revision=(p.revision||0)+1;await dbPut('document:'+key,p);if(DOC.key===key)S.project.revision=p.revision;}
  if(DOC.key===key){if(version===S.editVersion)S.dirty=false;await rememberDocument();}
 }finally{S.saving=false;updateStatus();}
}
function normalize(p){const was=p?.schemaVersion||1;const out=legacyNormalize(p);out.schemaVersion=was;C.normalizeV6(out);for(const pg of out.pages){for(const n of pg.nodes)if(n.table)C.validateTable(n.table);}return out;}
function collapsed(){if(!S.project)return new Set();const p=page();if(!S.collapsed[p.id])S.collapsed[p.id]=new Set(p.collapseMode==='groups'?p.groups.map(g=>g.id):p.nodes.filter(n=>n.collapsible).map(n=>n.id));return S.collapsed[p.id];}
async function activateDocument(project,{name='',handle=null,key=null,server=false,readOnly=false,direct=false}={}){
 if(S.dirty&&!S.readOnly)await save();
 closeFilePopover();closeModal();clearTimeout(saveTimer);for(const u of DOC.urls.values())URL.revokeObjectURL(u);
 DOC={key:key||C.uid('doc'),name,handle,root:null,files:new Map(),sessionFiles:new Map(),urls:new Map(),direct,exportedAt:0};
 if(key){DOC.handle=handle||await dbGet('handle:'+key)||null;DOC.root=await dbGet('root:'+key)||null;}
 S.project=normalize(C.clone(project));S.server=server;S.readOnly=readOnly;S.locked=readOnly;S.home=false;S.view={x:60,y:60,z:1};S.pageIndex=Math.max(0,Math.min(S.project.pages.length-1,S.project.viewState?.page||0));
 S.history=[];S.redo=[];S.selected=new Set();S.selectedEdges=new Set();S.selectedEdge=S.selectedBus=S.selectedDrawing=null;S.pendingPort=null;S.addingBus=null;S.materialChecks=new Map();S.popover=null;S.guides=[];S.iconEdit=false;S.placement=null;S.addingBusPair=null;S.search='';S.folded=new Set();S.collapsed={};S.tool='select';
 for(const [k,v] of Object.entries(S.project.viewState?.collapsed||{}))S.collapsed[k]=new Set(v);
 S.compact=S.project.viewState?.compact!==false;S.dirty=false;S.fileDirty=!readOnly&&(!name||(project.schemaVersion||1)<3);
 await hydrateAssets();renderShell();render();fit();
 if(!readOnly){S.dirty=true;await save();}
 return S.project;
}
async function home(){
 if(S.dirty&&!S.readOnly)await save();clearTimeout(saveTimer);closeFilePopover();closeModal();S.home=true;S.pendingPort=null;
 recentDocuments=await dbGet('recent-v3')||[];const legacy=await dbGet('project');
 $('#app').classList.remove('read-only');$('#app').innerHTML=`<header class="home-header"><div class="brand"><span class="logo">⌁</span><strong>Pipeline Studio <span class="version-tag">${RELEASE}</span></strong></div><span class="muted">Среда создания интерактивных процессов</span></header><main class="home-main"><section class="home-intro"><div class="caps">ВАШИ ПРОЦЕССЫ. ВАШИ ФАЙЛЫ.</div><h1>С чего начнём?</h1><p>Studio — отдельно. Документы и материалы — в ваших папках.<br>Откройте пайплайн для редактирования или создайте новый.</p><div class="home-actions"><button id="home-new" class="primary"><span>＋</span><strong>Новый документ</strong><small>Чистый холст</small></button><button id="home-open"><span>▱</span><strong>Открыть HTML / JSON</strong><small>Документы предыдущих версий</small></button><button id="home-folder"><span>▧</span><strong>Открыть папку проекта</strong><small>Документ вместе с материалами</small></button></div></section><section class="recent-section"><div class="row spread"><h2>Недавние документы</h2><small>Черновики этого браузера · не поиск по всему диску</small></div><div class="recent-list">${recentDocuments.map(r=>`<div class="recent-item"><span class="document-mark">▱</span><div class="recent-info"><strong>${esc(r.title)}</strong><small>${esc(r.name)} · ${new Date(r.modified).toLocaleString('ru-RU')}</small></div><button data-recent="${esc(r.key)}">Открыть черновик</button><button data-recent-file="${esc(r.key)}" title="Прочитать сохранённый HTML, а не браузерный черновик">Файл…</button><button class="icon ghost" data-forget="${esc(r.key)}" title="Убрать из недавних, не удаляя файл">×</button></div>`).join('')||'<div class="recent-empty">Здесь появятся документы, которые вы откроете в Studio.<br>HTML-программа больше не содержит вашу рабочую схему.</div>'}</div>${legacy?'<button id="recover-legacy" style="margin-top:16px">Восстановить найденный черновик 0.2</button>':''}${S.serverAvailable?'<button id="home-server" style="margin:16px 0">Открыть серверный черновик</button>':''}</section><section class="home-notes"><div><strong>Редактирование</strong><p>Открыть документ → изменить → сохранить HTML. Автокопия в браузере не заменяет файл на диске.</p></div><div><strong>Просмотр</strong><p>Коллеги открывают HTML документа. Видео и PDF загружаются из папок по ссылкам, а не упаковываются в HTML.</p></div></section></main>`;
 $('#home-new').onclick=()=>inputDialog('Новый документ','Название','Новый процесс',caught(async title=>{const p={format:'pipeline-studio',schemaVersion:3,id:C.uid('project'),title,revision:0,materials:[],pages:[{id:C.uid('page'),title:'Основной процесс',nodes:[],edges:[],groups:[],drawings:[],buses:[]}],settings:{autoBus:true}};await activateDocument(p);S.fileDirty=true;updateStatus();}));
 $('#home-open').onclick=()=>openDocumentPicker().catch(e=>toast(e.message));$('#home-folder').onclick=()=>openProjectFolder().catch(e=>toast(e.message));
 $$('[data-recent]').forEach(b=>b.onclick=caught(async()=>{const r=recentDocuments.find(x=>x.key===b.dataset.recent);if(r.server)return openServerDocument();const p=await dbGet('document:'+r.key);if(!p)throw Error('Черновик отсутствует. Используйте «Открыть HTML».');await activateDocument(p,{name:r.name,key:r.key});S.fileDirty=true;updateStatus();}));
 $$('[data-recent-file]').forEach(b=>b.onclick=()=>openRecentFile(b.dataset.recentFile).catch(e=>toast(e.message)));
 $$('[data-forget]').forEach(b=>b.onclick=caught(async()=>{recentDocuments=recentDocuments.filter(r=>r.key!==b.dataset.forget);await dbPut('recent-v3',recentDocuments);home();}));
 if($('#recover-legacy'))$('#recover-legacy').onclick=caught(()=>activateDocument(legacy,{name:'Восстановленный черновик 0.2'}));
 if($('#home-server'))$('#home-server').onclick=caught(openServerDocument);
 $('#app').ondragover=e=>e.preventDefault();$('#app').ondrop=e=>{if(!S.home)return;e.preventDefault();const f=e.dataTransfer.files[0];if(f)openDocumentFile(f).catch(err=>toast(err.message));};
}
function parseDocumentText(text){
 const input=String(text).replace(/^\uFEFF/,'').trim();if(input.startsWith('{'))return normalize(JSON.parse(input));
 const doc=new DOMParser().parseFromString(input,'text/html');const node=doc.querySelector('script#pipeline-document[type="application/json"]');if(node)return normalize(JSON.parse(node.textContent));
 // Read only the literal JSON value from legacy exports. No eval / script execution.
 for(const script of doc.querySelectorAll('script')){
  const match=script.textContent.match(/(?:^|;)\s*window\.SEED\s*=\s*/);if(!match)continue;
  const raw=script.textContent.slice(match.index+match[0].length);let inString=false,escape=false,depth=0,start=-1;
  for(let i=0;i<raw.length;i++){const ch=raw[i];if(inString){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')inString=false;continue;}
   if(ch==='"'){inString=true;continue;}if(ch==='{'){if(start<0)start=i;depth++;}else if(ch==='}'){depth--;if(depth===0&&start>=0)return normalize(JSON.parse(raw.slice(start,i+1)));}
   if(start<0&&!/\s/.test(ch)&&ch!=='{')break;
  }
 }
 throw Error('Это не документ Pipeline Studio. Нужен HTML / JSON с данными схемы, а не сама программа Studio.');
}
async function openDocumentFile(file,handle=null,opts={}){const p=parseDocumentText(await file.text());await activateDocument(p,{name:file.name,handle,...opts});if(!handle)toast('Открыт документ. Папку материалов можно подключить кнопкой «Папка».',6500);return p;}
async function openDocumentPicker(){
 if(S.dirty&&!S.readOnly)await save();
 if(window.showOpenFilePicker&&window.isSecureContext){try{const [h]=await showOpenFilePicker({types:[{description:'Документ Pipeline Studio',accept:{'text/html':['.html','.htm'],'application/json':['.json']}}],multiple:false});return await openDocumentFile(await h.getFile(),h);}catch(e){if(e.name==='AbortError')return;if(!['SecurityError','NotAllowedError'].includes(e.name))throw e;}}
 const fs=await pickFiles('.html,.htm,.json',false);if(fs.length)return openDocumentFile(fs[0]);
}
async function openRecentFile(key){const h=await dbGet('handle:'+key);if(!h){toast('Браузер не сохранил доступ к исходному файлу. Выберите его снова.',6000);return openDocumentPicker();}try{if(await h.queryPermission({mode:'read'})!=='granted'&&await h.requestPermission({mode:'read'})!=='granted')return;return openDocumentFile(await h.getFile(),h,{key});}catch(e){if(e.name==='NotFoundError')throw Error('Файл перемещён. Откройте его из новой папки — браузерный черновик сохранён.');throw e;}}
async function selectFolder(){
 if(window.showDirectoryPicker&&window.isSecureContext){try{const h=await showDirectoryPicker({mode:'read'});return {root:h,files:null,name:h.name};}catch(e){if(e.name==='AbortError')return null;if(!['SecurityError','NotAllowedError'].includes(e.name))throw e;}}
 return new Promise(resolve=>{const i=document.createElement('input');i.type='file';i.webkitdirectory=true;i.multiple=true;i.hidden=true;document.body.append(i);i.onchange=()=>{const fs=[...i.files],files=new Map();for(const f of fs){const parts=(f.webkitRelativePath||f.name).split('/');parts.shift();files.set(parts.join('/'),f);}const name=fs[0]?.webkitRelativePath.split('/')[0]||'Папка';i.remove();resolve({root:null,files,name});};i.oncancel=()=>{i.remove();resolve(null);};i.click();});
}
async function folderEntries(handle,prefix='',out=[]){for await(const [name,h] of handle.entries()){if(out.length>10000)throw Error('В папке больше 10 000 файлов. Выберите папку конкретного проекта.');const path=prefix+name;if(h.kind==='directory')await folderEntries(h,path+'/',out);else out.push({path,handle:h});}return out;}
async function openProjectFolder(){
 const chosen=await selectFolder();if(!chosen)return;
 const files=chosen.files?[...chosen.files.keys()].map(path=>({path})):await folderEntries(chosen.root);
 const docs=files.filter(f=>/\.(html?|json)$/i.test(f.path));
 modal('Документы в папке «'+chosen.name+'»',`<p class="muted">Выберите HTML / JSON пайплайна. Программа Studio не является документом.</p><div class="stack document-picker">${docs.map((f,i)=>`<button data-folder-document="${i}">${esc(f.path)}</button>`).join('')||'<p>Документы HTML / JSON не найдены.</p>'}</div>`,'',true);
 $$('[data-folder-document]').forEach(b=>b.onclick=caught(async()=>{const f=docs[+b.dataset.folderDocument],file=chosen.files?chosen.files.get(f.path):await f.handle.getFile();
  await openDocumentFile(file,f.handle||null);const parent=f.path.includes('/')?f.path.slice(0,f.path.lastIndexOf('/')):'';
  if(chosen.root){let h=chosen.root;for(const part of parent.split('/').filter(Boolean))h=await h.getDirectoryHandle(part);DOC.root=h;}
  else{DOC.files=new Map([...chosen.files].filter(([p])=>!parent||p.startsWith(parent+'/')).map(([p,v])=>[parent?p.slice(parent.length+1):p,v]));}
  DOC.folderName=parent||chosen.name;await rememberDocument();await primeImages();render();fit();
 }));
}
async function bindFolder(){const choice=await selectFolder();if(!choice)return;DOC.root=choice.root;DOC.files=choice.files||new Map();DOC.folderName=choice.name;DOC.sessionFiles.clear();for(const u of DOC.urls.values())URL.revokeObjectURL(u);DOC.urls.clear();await rememberDocument();await primeImages();render();toast('Папка подключена: '+choice.name+'. Файлы не копируются в HTML.',6500);}
function validRelative(s){if(typeof s!=='string')return false;const text=s.replace(/\\/g,'/');if(!text||/^\/|^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)||/[\x00-\x1f]/.test(text))return false;return !text.split('/').some(p=>p==='..'||/^%2e/i.test(p));}
function httpURL(s){try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function materialPath(m,preview=false){return (preview?m.previewPath:m.path)||'';}
function assetURL(m,preview=false){
 if(!m)return '';const key=m.id+(preview?':preview':'');if(DOC.urls.has(key))return DOC.urls.get(key);
 const path=materialPath(m,preview);if(path&&validRelative(path)){
  const f=DOC.sessionFiles.get(key)||DOC.files.get(path);if(f){const u=URL.createObjectURL(f);DOC.urls.set(key,u);return u;}
  const encoded=path.replace(/\\/g,'/').split('/').map(encodeURIComponent).join('/');
  if(S.project?.materialBaseURL&&httpURL(S.project.materialBaseURL))return new URL(encoded,S.project.materialBaseURL.replace(/\/?$/,'/')).href;
  // A preview may have no resolvable base (e.g. about:blank). Missing media
  // must never abort document startup; folder selection can resolve it later.
  if(DOC.direct){try{const u=new URL(encoded,location.href);return ['http:','https:','file:'].includes(u.protocol)?u.href:'';}catch{return '';}}
  return '';
 }
 if(preview&&m.previewURL)return httpURL(m.previewURL)||'';
 return legacyAssetURL(m,preview);
}
async function resolveMaterial(m,preview=false){
 if(!m)return '';const path=materialPath(m,preview),key=m.id+(preview?':preview':'');
 if(DOC.sessionFiles.has(key))return assetURL(m,preview);
 if(path&&DOC.root&&validRelative(path)){
  try{if(await DOC.root.queryPermission({mode:'read'})!=='granted'&&await DOC.root.requestPermission({mode:'read'})!=='granted')throw Error('Доступ к папке не предоставлен');
   const parts=path.replace(/\\/g,'/').split('/').filter(p=>p&&p!=='.');let h=DOC.root;for(const part of parts.slice(0,-1))h=await h.getDirectoryHandle(part);const fh=await h.getFileHandle(parts.at(-1)),file=await fh.getFile();
   if(DOC.urls.has(key))URL.revokeObjectURL(DOC.urls.get(key));const u=URL.createObjectURL(file);DOC.urls.set(key,u);return u;
  }catch(e){if(e.name==='NotFoundError')throw Error('Файл не найден: '+path+'. Исправьте путь в реестре или подключите правильную папку.');throw e;}
 }
 return assetURL(m,preview);
}
async function primeImages(){for(const m of S.project.materials.filter(m=>m.kind==='image'))try{await resolveMaterial(m);}catch{}}
function inferKind(file){const ext=(file.name||'').split('.').at(-1).toLowerCase();return file.type?.startsWith('video/')||['mp4','webm','ogv','mov','mkv'].includes(ext)?'video':file.type?.startsWith('audio/')||['mp3','wav','ogg'].includes(ext)?'audio':file.type?.startsWith('image/')||['png','jpg','jpeg','webp','gif','svg'].includes(ext)?'image':ext==='pdf'?'pdf':'document';}
async function uploadFile(file,replaceId,explicitPath=null){
 if(S.readOnly)throw Error('Документ открыт для просмотра');
 if(S.server)return legacyUploadFile(file,replaceId);
 let path=explicitPath||(file.webkitRelativePath||'').split('/').slice(1).join('/');
 if(!path){const matches=[...DOC.files].filter(([,f])=>f.name===file.name&&f.size===file.size&&f.lastModified===file.lastModified);if(matches.length===1)path=matches[0][0];}
 if(!path)path=file.name;
 const prev=replaceId?mat(replaceId):null,m={id:replaceId||C.uid('material'),title:prev?.title||file.name,kind:inferKind(file),path,filename:file.name,mime:file.type||'application/octet-stream',size:file.size,version:(prev?.version||0)+1,status:'Внешний файл'};
 checkpoint();const idx=S.project.materials.findIndex(x=>x.id===m.id);if(idx>=0)S.project.materials[idx]=m;else S.project.materials.push(m);
 DOC.sessionFiles.set(m.id,file);if(DOC.urls.has(m.id))URL.revokeObjectURL(DOC.urls.get(m.id));DOC.urls.set(m.id,URL.createObjectURL(file));changed();renderTop();renderInspector();
 toast('Ссылка на файл: '+path+'. Файл не копируется; проверьте путь в реестре.',6500);return m;
}
async function sourceText(name,element){const node=document.getElementById(element);if(node)return node.textContent;const response=await fetch('/'+name);if(!response.ok)throw Error('Не удалось прочитать код '+name);return response.text();}
async function portableProject(embed=false){
 const p=documentSnapshot();delete p.portableAssets;
 if(!embed){const embedded=p.materials.filter(m=>m.asset&&!m.path||m.previewAsset&&!m.previewPath&&!m.previewURL);if(embedded.length)throw Error('Есть '+embedded.length+' файлов в старом встроенном хранилище. Сначала «Вынести встроенные файлы в папку» или выберите резервный JSON с вложениями.');for(const m of p.materials){if(m.path)delete m.asset;if(m.previewPath||m.previewURL)delete m.previewAsset;}return p;}
 // Legacy backup is explicitly opt-in and has a memory guard, not an HTML format limit.
 const bytes=p.materials.filter(m=>m.asset&&!m.path).reduce((s,m)=>s+(m.size||0),0);if(bytes>150*1024*1024)throw Error('Резервный JSON с вложениями требует слишком много памяти. Вынесите файлы в папку; HTML со ссылками этого ограничения не имеет.');
 p.portableAssets={};for(const m of p.materials)for(const key of ['asset','previewAsset']){const id=m[key];if(!id||p.portableAssets[id])continue;let blob;if(S.server){const r=await fetch(legacyAssetURL(m,key==='previewAsset'));if(!r.ok)throw Error('Недоступен '+m.title);blob=await r.blob();}else blob=await dbGet('asset:'+id);if(!blob)throw Error('Отсутствует вложение: '+m.title);p.portableAssets[id]=await dataURL(blob);}
 return p;
}
async function buildDocumentHTML(project){
 const [css,core,app]=await Promise.all([sourceText('style.css','style-source'),sourceText('core.js','core-source'),sourceText('app.js','app-source')]);const end='</scr'+'ipt>';
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(project.title)+' — Pipeline</title><style id="style-source">'+css+'</style></head><body><div id="app"></div><div id="modal-root"></div><div id="toast" role="status"></div><script id="pipeline-document" type="application/json">'+safeJSON(project)+end+'<script>window.STUDIO_DOCUMENT=true;window.PORTABLE_READONLY=true;window.EMOJI='+safeJSON(EMOJI)+';'+end+'<script id="core-source">'+core.replace(/<\/script/gi,'<\\/script')+end+'<script id="app-source">'+app.replace(/<\/script/gi,'<\\/script')+end+'</body></html>';
}
async function saveDocument(asNew=false){
 if(!S.project)return;let handle=asNew||!DOC.handle?.name?.toLowerCase().endsWith('.html')?null:DOC.handle;const name=prettyName(S.project.title)+'.html';
 // Pick first, before asynchronous packaging can consume transient user activation.
 if(!handle&&window.showSaveFilePicker&&window.isSecureContext){try{handle=await showSaveFilePicker({suggestedName:name,types:[{description:'Документ Pipeline',accept:{'text/html':['.html']}}]});}catch(e){if(e.name==='AbortError')return;if(!['SecurityError','NotAllowedError'].includes(e.name))throw e;}}
 const p=await portableProject(false),text=await buildDocumentHTML(p),blob=new Blob([text],{type:'text/html;charset=utf-8'});
 if(handle){if(await handle.queryPermission({mode:'readwrite'})!=='granted'&&await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Сохранение не разрешено. Используйте «Скачать HTML».');const writer=await handle.createWritable();try{await writer.write(blob);await writer.close();}catch(e){try{await writer.abort();}catch{}throw e;}DOC.handle=handle;DOC.name=handle.name;
 }else{download(blob,name);DOC.name=name;}
 DOC.exportedAt=Date.now();S.fileDirty=false;await save();await rememberDocument();updateStatus();toast(handle?'HTML документа записан. Материалы остаются отдельными файлами.':'HTML подготовлен к скачиванию. Положите его рядом с папками материалов.',6500);
}
async function exportHTML(){closeModal();const p=await portableProject(false);const text=await buildDocumentHTML(p);download(new Blob([text],{type:'text/html;charset=utf-8'}),prettyName(p.title)+'.html');toast('HTML документа создан. Внешние материалы в него не встроены.');}
async function exportJSON(embed=false){const p=await portableProject(embed);download(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),prettyName(p.title)+(embed?'-backup':'')+'.json');toast(embed?'JSON-резервная копия подготовлена':'Данные документа сохранены отдельно');}
async function externalizeAssets(){
 if(!window.showDirectoryPicker||!window.isSecureContext)throw Error('Для записи папки нужен браузер с File System Access. Иначе перепривяжите материалы к существующим файлам вручную.');
 const root=await showDirectoryPicker({mode:'readwrite'}),dir=await root.getDirectoryHandle('materials',{create:true}),changes=[];
 for(const m of S.project.materials)for(const key of ['asset','previewAsset']){const aid=m[key];if(!aid||m[key==='asset'?'path':'previewPath'])continue;
  let blob;if(S.server){const r=await fetch(legacyAssetURL(m,key==='previewAsset'));if(!r.ok)throw Error('Не найдено вложение '+m.title);blob=await r.blob();}else blob=await dbGet('asset:'+aid);if(!blob)throw Error('Не найдено вложение '+m.title);
  const name=prettyName(C.uid('file')+'-'+(key==='asset'?m.filename||'file':'preview.pdf'));const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(blob);await w.close();changes.push({m,key,path:'materials/'+name});
 }
 change(()=>{for(const {m,key,path} of changes)m[key==='asset'?'path':'previewPath']=path;});DOC.root=root;DOC.folderName=root.name;await rememberDocument();toast('Файлы вынесены в materials/. Теперь сохраните HTML в выбранную папку.');
}
function v3RenderShell(){
 $('#app').innerHTML=`<header class="topbar"><button class="brand brand-home" data-action="home" title="Документы Studio"><span class="logo">⌁</span><span><strong>Pipeline Studio <span class="version-tag">0.3</span></strong><small>ДОКУМЕНТЫ И ПРОЦЕССЫ</small></span></button><div class="project-head"><strong id="project-title"></strong><div id="save-status" class="save-status"></div></div><div class="spacer"></div><div id="top-actions" class="row"></div></header><main class="workspace"><aside class="leftbar" id="left"></aside><section class="center"><div id="subbar" class="subbar"></div><div class="canvas-wrap"><div id="stage"><div id="world"><div id="frames"></div><svg id="edges"></svg><svg id="ink"></svg><div id="nodes"></div></div></div><div id="tools" class="toolrail"></div><div class="canvas-hint">Порты: два щелчка · Shift + перемещение: орто · Ctrl+Z: отмена</div><div class="zoom-tools">${button('zoom-out','Уменьшить','−')}<span class="zoom-label" id="zoom-label"></span>${button('zoom-in','Увеличить','+')}${button('fit','Вписать видимую схему','⛶')}</div><div id="connect-status" class="connect-status" hidden></div></div></section><aside id="inspector" class="rightbar"></aside></main>`;
 const app=$('#app');app.removeEventListener('click',onAppClick);app.addEventListener('click',onAppClick);app.removeEventListener('change',onChange);app.addEventListener('change',onChange);
 app.ondragover=null;app.ondrop=null;
 $('#stage').addEventListener('pointerdown',onPointerDown);$('#stage').addEventListener('wheel',onWheel,{passive:false});$('#stage').addEventListener('dblclick',onDoubleClick);$('#stage').addEventListener('contextmenu',contextMenu);$('#stage').addEventListener('dragover',e=>e.preventDefault());$('#stage').addEventListener('drop',onDrop);
 if(!S.eventsBound){S.eventsBound=true;document.addEventListener('keydown',onKey);document.addEventListener('keyup',e=>{if(e.code==='Space')S.space=false;});
  $('#modal-root').addEventListener('click',e=>{const x=e.target.closest('[data-open-material]');if(x)openMaterial(x.dataset.openMaterial).catch(err=>toast(err.message));});
  window.addEventListener('resize',()=>{if(!S.home&&$('#stage')){renderScene();}});window.addEventListener('beforeunload',e=>{if(!S.readOnly&&(S.dirty||S.fileDirty)){e.preventDefault();e.returnValue='';}});
 }
}
function render(){if(S.home||!S.project||!$('#stage'))return;legacyRender();applyPanelState();}
function applyPanelState(){const w=$('.workspace');if(!w)return;w.classList.toggle('hide-left',S.leftHidden);w.classList.toggle('hide-right',S.rightHidden);}
function v3RenderTop(){
 $('#top-actions').innerHTML=(S.locked?'<span class="reader-label">Просмотр документа</span>':button('preview',S.readOnly?'Вернуться в редактор':'Предпросмотр',S.readOnly?'В редактор':'Просмотр'))+button('registry','Открыть реестр материалов','Материалы <span class="badge">'+S.project.materials.length+'</span>')+button('bind-folder','Указать корневую папку документа и материалов','Папка')+(S.readOnly?'':button('save-document','Сохранить HTML документа (Ctrl+S)','Сохранить HTML','primary'))+button('menu','Документ: открыть, сохранить и выдать','···','icon');
}
function v3RenderSubbar(){const p=page();$('#subbar').innerHTML=`${button('toggle-left',S.leftHidden?'Показать навигацию':'Скрыть навигацию',S.leftHidden?'▸ Навигация':'◂','panel-switch')}<span class="page-caption">${esc(p.title)}</span><small class="page-count">${p.nodes.length} блоков · ${p.edges.length} связей</small><div class="spacer"></div><label class="row compact-label"><input id="compact" type="checkbox" ${S.compact?'checked':''}> Уплотнять</label>${button('expand-all','Раскрыть цепочки всех блоков','Раскрыть')}${button('collapse-all','Свернуть цепочки блоков с включённой опцией','Свернуть')}${S.readOnly?'':button('align-menu','Выравнивание и распределение выделения','Выровнять')}${button('toggle-right',S.rightHidden?'Показать свойства':'Скрыть свойства',S.rightHidden?'Свойства ◂':'▸','panel-switch')}`;}
function v3RenderLeft(){
 const p=page(),q=S.search.toLowerCase(),hidden=S.display?.hidden||new Set();
 const matching=n=>(n.title+' '+(n.table?.cells.flat().filter(Boolean).map(c=>c.text).join(' ')||'')).toLowerCase().includes(q);
 const items=q?p.nodes.filter(matching):p.nodes.filter(n=>n.collapsible||!p.edges.some(e=>e.target===n.id&&e.arrow!==false));
 const nodeItem=n=>`<div class="flow-nav ${hidden.has(n.id)?'nav-hidden':''}">${n.collapsible?`<button class="icon ghost" data-collapse-node="${esc(n.id)}" title="${collapsed().has(n.id)?'Раскрыть':'Свернуть'} цепочку" aria-expanded="${!collapsed().has(n.id)}">${collapsed().has(n.id)?'⊞':'⊟'}</button>`:'<span class="nav-dot"></span>'}<button class="flow-nav-title" data-focus="${esc(n.id)}" title="${esc(n.title)}">${richText(n.title)}</button></div>`;
 $('#left').innerHTML=`<div class="caps row spread">Страницы ${S.readOnly?'':button('new-page','Добавить страницу','+','icon ghost')}</div><div class="pages">${S.project.pages.map((p,i)=>`<button class="page-item ${i===S.pageIndex?'active':''}" data-page="${i}">▱ &nbsp;${esc(p.title)}</button>`).join('')}</div><div class="divider"></div><div class="caps">Цепочки</div><input id="search" placeholder="Найти блок или текст…" value="${esc(S.search)}"><div class="nav-description">⊞ / ⊟ сворачивает следующие блоки по связям.<br>Опция включается в свойствах любого блока.</div><div id="outline">${items.map(nodeItem).join('')||'<small>Добавьте блок и включите «Сворачивать цепочку».</small>'}</div><details class="all-nodes"><summary>Все блоки (${p.nodes.length})</summary>${p.nodes.map(nodeItem).join('')}</details><div class="left-footer">${button('help','Как работать с документами и материалами','? Справка','ghost')}<p>${S.server?'Серверный черновик':'Черновик в этом браузере'}<br>${esc(DOC.name||'Файл ещё не сохранён')}</p></div>`;
 $('#search').oninput=e=>{S.search=e.target.value;const pos=e.target.selectionStart;renderLeft();$('#search').focus();$('#search').setSelectionRange(pos,pos);renderScene();};
}
function v3RenderTools(){legacyRenderTools();$$('button',$('#tools')).forEach(b=>b.setAttribute('aria-label',b.title||b.textContent));if(!S.readOnly)$('#tools').insertAdjacentHTML('beforeend','<div class="sep"></div>'+button('draw-settings','Цвет и толщина рисования','⚙'));}
function v5TableHTML(n){const t=n.table;if(!t)return '';const met=C.tableMetrics(n),cols=t.cells[0].length,sum=t.widths.reduce((a,b)=>a+b,0);
 return `<table lang="ru" class="flow-table wrap-${t.wordWrap||'words'}"><colgroup>${t.widths.map(w=>`<col style="width:${w/sum*100}%">`).join('')}</colgroup><tbody>${t.cells.map((row,r)=>`<tr data-table-row="${r}" style="height:${met.heights[r]}px">${row.map((c,ci)=>!c?'':`<td rowspan="${c.rowspan||1}" colspan="${c.colspan||1}" style="padding:0;background:${esc(c.fill||'#fff')};text-align:${esc(c.align||'left')};font-weight:${c.bold?'700':'400'}"><div class="cell-content" style="height:${Math.max(1,met.heights.slice(r,r+(c.rowspan||1)).reduce((a,b)=>a+b,0)-1)}px">${c.html?cleanHTML(c.html):richText(c.text)}${c.material?` <button class="cell-material" data-open-material="${esc(c.material)}" title="Открыть материал ячейки">↗</button>`:''}</div></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function v4NodeHTML(n,print=false){
 const summary=n.type==='summary',badges=[...new Set(n.materials||[])].filter(id=>mat(id)),counts={};for(const id of badges){const k=mat(id).kind;counts[k]=(counts[k]||0)+1;}
 const body=summary?`<div class="node-label">${richText(n.title)}</div><div class="summary-sub">${n.count} блоков</div>`:n.type==='table'?`<div class="table-title">${label(n)}</div>${S.folded.has(n.id)?'<div class="summary-sub" style="padding:8px">Таблица свёрнута</div>':tableHTML(n)}`:n.type==='image'?`<img class="photo" alt="${esc(n.title)}" src="${esc(assetURL(mat(n.imageMaterial)))}">`:`<div class="node-label" style="text-align:${esc(n.align||'center')};font-weight:${n.bold?'700':'400'};font-style:${n.italic?'italic':'normal'}">${label(n)}</div>`;
 const cps=print||S.readOnly||summary?[]:C.visiblePorts(n,page().edges);
 const handles=cps.map(p=>`<span role="button" tabindex="0" class="port ${p.rowId?'row-port':''} ${S.pendingPort?.node===n.id&&S.pendingPort.port===p.id?'pending':''}" data-port="${esc(p.id)}" data-owner="${esc(n.id)}" title="${esc(portDescription(n,p))}: щёлкните, затем щёлкните порт назначения" style="left:${p.x*n.w-(isDiamond?0:1)}px;top:${p.y*n.h-(isDiamond?0:1)}px">+</span>`).join('')+(!print&&!S.readOnly&&!summary&&!n.locked?`<span class="resize" data-resize="${esc(n.id)}" ${n.autoSize?'hidden':''}></span>`:'');
 const attached=(n.icons||[]).map((ic,i)=>`<img class="attached-icon ${S.iconEdit&&S.selected.has(n.id)?'icon-movable':''}" draggable="false" data-icon-index="${i}" data-icon-node="${esc(n.id)}" alt="Иконка" title="${S.iconEdit?'Перетащите иконку':'Выберите блок → Двигать иконки'}" src="${esc(ic.src||assetURL(mat(ic.material)))}" style="left:${ic.x??-18}px;top:${ic.y??-18}px;width:${ic.w||36}px;height:${ic.h||36}px">`).join('');
 const mh=!print&&badges.length?`<div class="material-badges">${Object.entries(counts).map(([k,c])=>`<button data-node-material="${esc(n.id)}" data-kind="${esc(k)}" title="${esc(typeName[k]||k)}">${sign(k)} ${c}</button>`).join('')}</div>`:'';
 const toggle=!print&&n.collapsible?`<button class="collapse-node ${collapsed().has(n.id)?'is-collapsed':''}" data-collapse-node="${esc(n.id)}" title="${collapsed().has(n.id)?'Раскрыть':'Свернуть'} цепочку${n.hiddenCount?' · скрыто '+n.hiddenCount+' блоков':''}${n.sharedVisibleCount?' · '+n.sharedVisibleCount+' общих блоков видны из другой ветки':''}" aria-expanded="${!collapsed().has(n.id)}">${uiIcon(collapsed().has(n.id)?'expand':'collapse')}${n.hiddenCount?`<span>${n.hiddenCount}</span>`:''}</button>`:'';
 return `<div class="node ${esc(n.type)} ${S.selected.has(n.id)&&!print?'selected':''} ${badges.length?'has-materials':''} ${n.locked?'position-locked':''}" data-node="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;background:${esc(n.fill||'#fff')};border-color:${esc(n.stroke||'#9aa8bf')};font-size:${n.fontSize||13}px"><div class="node-body">${body}</div>${attached}${mh}${handles}${toggle}${n.locked&&!print?'<span class="node-lock" title="Положение зафиксировано">▣</span>':''}</div>`;
}
function portDescription(n,p){if(p.rowId){const r=n.table?.rowIds.indexOf(p.rowId);return `${portLabels[p.side]} · строка ${(r??0)+1}`;}return (portLabels[p.side]||p.side)+' · блок';}
function renderScene(){if(S.home||!S.project||!$('#nodes'))return;S.display=C.display(page(),collapsed(),S.compact,S.folded);$('#frames').innerHTML='';$('#nodes').innerHTML=S.display.nodes.map(n=>nodeHTML(n)).join('');renderEdges();renderInk();transform();updateConnectStatus();highlightCommonPorts();renderGuides();}
function v4RenderEdges(){
 if(!S.display||!$('#edges'))return;const bundle=C.bundleRoutes(S.display);S.bundle=bundle;
 const defs='<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0L8 4L0 8Z" fill="#96a3ba"/></marker></defs>';
 const trunk=bundle.buses.map(b=>`<path class="edge bus-trunk ${S.selectedBus===b.id?'selected':''}" d="${b.lead.d}" ${b.arrow?'marker-end="url(#arrowhead)"':''} ${b.dashed?'stroke-dasharray="6 4"':''}/><path class="edge bus-trunk ${S.selectedBus===b.id?'selected':''}" d="${b.trunk.d}" ${b.dashed?'stroke-dasharray="6 4"':''}/><path class="edge-hit" data-bus="${esc(b.id)}" d="${b.lead.d} ${b.trunk.d}"/>${b.entries.map(x=>`<circle cx="${x.join.x}" cy="${x.join.y}" r="2.8" fill="#96a3ba" pointer-events="none"/>`).join('')}${S.selectedBus===b.id&&!S.readOnly?`<circle class="bus-handle" data-bus-handle="${esc(b.id)}" cx="${b.handle.x}" cy="${b.handle.y}" r="${6/S.view.z}"><title>Переместить гребёнку — пересечение общей линии</title></circle>`:''}`).join('');
 $('#edges').innerHTML=defs+trunk+S.display.edges.map(e=>{const p=bundle.routes.get(e.id);if(!p)return '';const picked=S.selectedEdge===e.id||S.selectedEdges.has(e.id)||e.bus&&S.selectedBus===e.bus;
  return `<path class="edge ${picked?'selected':''}" d="${p.d}" ${e.arrow&&!p.busIncoming?'marker-end="url(#arrowhead)"':''} ${e.dashed?'stroke-dasharray="6 4"':''}/><path class="edge-hit" data-edge="${esc(e.id)}" d="${p.d}"/><text class="edge-label" x="${p.x}" y="${p.y-7}" text-anchor="middle">${esc(e.label||'')}${e.count>1?' ×'+e.count:''}</text>${picked&&!S.readOnly&&!e.proxy&&!p.bus?(p.controls||[]).map((w,i)=>`<circle class="route-handle" data-route-edge="${esc(e.id)}" data-route-index="${i}" cx="${w.x}" cy="${w.y}" r="${6/Math.max(.3,S.view.z)}"/>`).join(''):''}`;
 }).join('');
 // Keep junction grips above branch hit paths at the shared intersection.
 for(const grip of $$('#edges .bus-handle'))$('#edges').appendChild(grip);
}
function focusNode(id){
 const n=page().nodes.find(n=>n.id===id);if(!n)return;
 for(const root of page().nodes.filter(x=>x.collapsible&&collapsed().has(x.id)))if(C.descendants(page(),root.id).has(id))collapsed().delete(root.id);
 S.selected=new Set([id]);S.selectedEdges.clear();S.selectedEdge=S.selectedDrawing=S.selectedBus=null;render();const d=S.display.nodes.find(n=>n.id===id);if(d){const st=$('#stage').getBoundingClientRect(),z=Math.max(.12,Math.min(1.2,(st.width-140)/d.w,(st.height-100)/d.h));S.view={z,x:st.width/2-(d.x+d.w/2)*z,y:st.height/2-(d.y+d.h/2)*z};transform();}
}
function toggleNode(id){
 const n=page().nodes.find(n=>n.id===id);if(!n?.collapsible)return;const before=S.display.nodes.find(n=>n.id===id);const pt=before?{x:before.x,y:before.y}:null;
 if(!S.readOnly)checkpoint();if(collapsed().has(id))collapsed().delete(id);else collapsed().add(id);S.selectedEdge=S.selectedBus=null;S.selectedEdges.clear();render();const after=S.display.nodes.find(n=>n.id===id);if(pt&&after){S.view.x+=(pt.x-after.x)*S.view.z;S.view.y+=(pt.y-after.y)*S.view.z;transform();}if(!S.readOnly)changed();
}
function toggleGroup(id){const g=page().groups.find(x=>x.id===id);if(!g)return;const ns=page().nodes.filter(n=>g.members.includes(n.id)&&n.collapsible);for(const n of ns)toggleNode(n.id);}
function v3RenderInspector(){
 if(S.selectedBus){const b=page().buses.find(x=>x.id===S.selectedBus);if(b){const count=page().edges.filter(e=>e.bus===b.id).length;$('#inspector').innerHTML=`<div class="caps">Гребенчатая связь</div><h2>Общая линия</h2><p>${count} соединений · ${b.mode==='in'?'общий вход':'общий выход'}</p><p class="muted">Линия хранится один раз. При перемещении блоков её ответвления перестраиваются.</p>${S.readOnly?'':`<div class="stack">${field('Отступ от общего порта, px','bus-offset',b.offset||70,'number')}${button('dissolve-bus','Разделить на независимые связи','Разделить связи')}<small>Выберите общую линию на схеме и перетащите квадратный маркер.</small></div>`}`;return;}}
 if(S.selectedEdges.size>1){$('#inspector').innerHTML=`<div class="caps">Выбрано связей: ${S.selectedEdges.size}</div><h2>Объединить линии</h2><div class="stack">${button('combine-out','Общий выход → несколько входов','Гребёнка: общий выход','primary')}${button('combine-in','Несколько выходов → общий вход','Гребёнка: общий вход')}<small>У объединяемых связей должен быть один общий порт. Shift + щелчок добавляет связь к выделению.</small></div>`;return;}
 legacyRenderInspector();const n=selected();if(!n&&!S.selectedEdge&&!S.selectedDrawing){const tip=$('.rightbar>.tip:last-child');if(tip)tip.innerHTML='Документ и его материалы — отдельно. Сохраняйте HTML документа, а видео и PDF держите в папках. Кнопка «Папка» даёт браузеру доступ к материалам.';const imp=$('#inspector [data-action=import]');if(imp)imp.textContent='Открыть документ HTML / JSON';}
 if(S.selectedEdge){const e=page().edges.find(x=>x.id===S.selectedEdge);if(e){for(const [which,nid] of [['source',e.source],['target',e.target]]){const node=page().nodes.find(n=>n.id===nid),sel=$('#edge-'+which+'-port');if(sel&&node.table)for(const o of sel.options){const p=C.port(node,o.value);if(p.rowId){const r=node.table.rowIds.indexOf(p.rowId);o.textContent=(portLabels[p.side]||p.side)+' · строка '+(r+1)+' · '+(node.table.cells[r]?.filter(Boolean).map(c=>c.text).join(' · ')||'').slice(0,50);}}}}if(e&&!S.readOnly)$('#inspector').insertAdjacentHTML('beforeend',`<div class="divider"></div><h3>Общая линия</h3><div class="stack">${button('combine-out','Объединить все связи с этим выходом','Гребёнка по выходу')}${button('combine-in','Объединить все связи с этим входом','Гребёнка по входу')}${e.bus?button('select-bus','Настроить общую линию','Настроить гребёнку'):''}<label class="row"><input type="checkbox" id="edge-flow" ${e.flow!==false?'checked':''}> Учитывать в цепочке</label></div>`);return;}
 if(!n||S.readOnly||S.selected.size>1){if(S.selected.size>1&&!S.readOnly)$('#inspector').insertAdjacentHTML('beforeend','<div class="row">'+button('lock','Зафиксировать выбранные блоки','Зафиксировать')+button('unlock','Снять фиксацию','Разблокировать')+'</div>');return;}
 const panel=document.createElement('div');panel.className='node-behavior';panel.innerHTML=`<h3>Поведение блока</h3><label class="check-row"><input id="node-collapsible" type="checkbox" ${n.collapsible?'checked':''}> Сворачивать цепочку после блока</label>${n.collapsible?`<div class="row">${button('toggle-node','Сворачивание по связям',collapsed().has(n.id)?'⊞ Раскрыть':'⊟ Свернуть')}<small>${C.descendants(page(),n.id).size} следующих блоков</small></div>`:''}<label class="check-row"><input id="node-collapse-boundary" type="checkbox" ${n.collapseBoundary?'checked':''}> Граница: не скрывать с предыдущей цепочкой</label><label class="check-row"><input id="node-locked" type="checkbox" ${n.locked?'checked':''}> Зафиксировать положение и размер</label><small>Принадлежность цепочке определяется связями, а не рамкой подпроцесса. Общий этап остаётся видимым из открытой ветки.</small>`;
 $('#inspector').insertBefore(panel,$('#inspector').children[1]||null);
 if(n.icons?.length)$('#inspector').insertAdjacentHTML('beforeend',`<div class="divider"></div><h3>Иконки внутри блока</h3>${button('move-icons','Включить перемещение иконок мышью',S.iconEdit?'Завершить перемещение':'Двигать иконки',S.iconEdit?'active':'')}<label class="field">Выбранная иконка<select id="icon-select">${n.icons.map((x,i)=>`<option value="${i}" ${S.selectedIcon===i?'selected':''}>Иконка ${i+1}</option>`).join('')}</select></label><small>После включения перетащите саму иконку. Текстовый блок останется на месте.</small>`);
 const cfg=n.portConfig||(n.table?{body:['left'],rows:['right']}:{body:['left','right','top','bottom']});
 $('#inspector').insertAdjacentHTML('beforeend',`<details class="port-settings"><summary>Порты подключения</summary><h3>Порты блока${n.table?' / заголовка таблицы':''}</h3><div class="grid2">${['left','right','top','bottom'].map(side=>`<label class="check-row"><input id="port-body-${side}" type="checkbox" ${(cfg.body||[]).includes(side)?'checked':''}>${portLabels[side]}</label>`).join('')}</div>${n.table?`<h3>Порты строк</h3><div class="grid2">${['left','right'].map(side=>`<label class="check-row"><input id="port-rows-${side}" type="checkbox" ${(cfg.rows||[]).includes(side)?'checked':''}>${portLabels[side]}</label>`).join('')}</div><small>Слева можно оставить только порт таблицы, справа — порты строк. Уже созданные связи не удаляются при скрытии порта.</small>`:''}</details>`);
 if(n.locked||n.autoSize)for(const id of ['node-width','node-height'])if($('#'+id))$('#'+id).disabled=true;
 const grp=$('#node-group');if(grp){grp.parentElement.insertAdjacentHTML('beforeend','<small>Необязательная организационная метка; на сворачивание цепочки не влияет.</small>');}
 if(n.icons?.length){const ic=n.icons[Math.min(S.selectedIcon,n.icons.length-1)];$('#icon-x').value=ic.x??-18;$('#icon-y').value=ic.y??-18;$('#icon-size').value=ic.w||36;}
}
function checkpoint(){if(S.readOnly)return;S.history.push(documentSnapshot());if(S.history.length>80)S.history.shift();S.redo=[];}
function restoreHistory(p){
 const rev=S.project.revision,selection=[...S.selected],edge=S.selectedEdge,bus=S.selectedBus,iconEdit=S.iconEdit;
 S.project=p;S.project.revision=rev;S.compact=p.viewState?.compact??S.compact;
 if(p.viewState?.collapsed)S.collapsed=Object.fromEntries(Object.entries(p.viewState.collapsed).map(([k,v])=>[k,new Set(v)]));
 S.selected=new Set(selection.filter(id=>page().nodes.some(n=>n.id===id)));
 S.selectedEdges=new Set([...S.selectedEdges].filter(id=>page().edges.some(e=>e.id===id)));
 S.selectedEdge=page().edges.some(e=>e.id===edge)?edge:null;S.selectedBus=page().buses?.some(b=>b.id===bus)?bus:null;S.selectedDrawing=null;
 const host=selected();S.iconEdit=!!(iconEdit&&host?.icons?.length);S.selectedIcon=host?.icons?.length?Math.min(S.selectedIcon,host.icons.length-1):0;
 S.pendingPort=null;changed();render();
}
async function undo(){if(S.readOnly||!S.history.length)return;S.redo.push(documentSnapshot());restoreHistory(S.history.pop());}
async function redo(){if(S.readOnly||!S.redo.length)return;S.history.push(documentSnapshot());restoreHistory(S.redo.pop());}
function makeNode(type,x,y){const n=legacyMakeNode(type,x,y);n.collapsible=false;n.locked=false;n.relativeLock=true;if(n.table){C.initTable(n);n.h=C.tableMetrics(n).total;}return n;}
function v4AddNode(type,point=nodeCenter()){change(()=>{S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);S.compact=false;const n=makeNode(type,point.x,point.y);page().nodes.push(n);S.selected=new Set([n.id]);S.selectedEdge=S.selectedBus=null;S.selectedEdges.clear();S.tool='select';});}
async function onAppClick(e){
 if(S.home)return;
 if(e.target.closest('[data-material-action]'))return;
 try{const toggle=e.target.closest('[data-collapse-node]');if(toggle){e.stopPropagation();return toggleNode(toggle.dataset.collapseNode);}
  if(e.target.closest('[data-port],[data-icon-index],[data-bus-handle]'))return;
  return await legacyOnAppClick(e);
 }catch(err){toast(err.message,8500);}
}
async function v3Action(a){
 if(a==='home')return home();if(a==='open-document'||a==='import')return openDocumentPicker();if(a==='bind-folder')return bindFolder();
 if(a==='toggle-left'||a==='toggle-right'){S[a==='toggle-left'?'leftHidden':'rightHidden']=!S[a==='toggle-left'?'leftHidden':'rightHidden'];applyPanelState();renderSubbar();return;}
 if(a==='save-document'||a==='save')return saveDocument();if(a==='save-as')return saveDocument(true);if(a==='download-html'||a==='portable-view'||a==='portable-edit')return exportHTML();
 if(a==='export-json')return exportJSON(false);if(a==='backup-json')return exportJSON(true);if(a==='externalize')return externalizeAssets();
 if(a==='menu')return projectMenu();if(a==='help')return help();if(a==='publish'&&!S.server)return exportHTML();
 if(a==='expand-all'||a==='collapse-all'){
  if(page().collapseMode==='groups'){if(a==='expand-all')collapsed().clear();else page().groups.forEach(g=>collapsed().add(g.id));}
  else for(const n of page().nodes)if(n.collapsible){if(a==='expand-all')collapsed().delete(n.id);else collapsed().add(n.id);}
  render();fit();if(!S.readOnly)changed();return;
 }
 if(a==='toggle-node'&&selected())return toggleNode(selected().id);
 if(a==='align-menu'){modal('Выровнять выделение',`<p class="muted">Выделите два или несколько блоков через Shift. Зафиксированные блоки не перемещаются.</p>${arrangeButtons()}`,'',true);$$('[data-action]',$('.modal')).forEach(b=>b.onclick=caught(async()=>{closeModal();await action(b.dataset.action);}));return;}
 if(S.readOnly&&['lock','unlock','move-icons','combine-out','combine-in','dissolve-bus'].includes(a))return;
 if(a==='lock'||a==='unlock'){change(()=>{for(const n of page().nodes)if(S.selected.has(n.id))n.locked=a==='lock';});return;}
 if(a==='move-icons'){S.iconEdit=!S.iconEdit;render();return;}
 if(a==='remove-icon'&&selected()){const n=selected();change(()=>n.icons.splice(Math.min(S.selectedIcon,n.icons.length-1),1));return;}
 if(a==='combine-out'||a==='combine-in')return combineSelected(a==='combine-in'?'in':'out');
 if(a==='select-bus'){S.selectedBus=page().edges.find(e=>e.id===S.selectedEdge)?.bus||null;S.selectedEdge=null;renderEdges();renderInspector();highlightCommonPorts();return;}
 if(a==='dissolve-bus'){const id=S.selectedBus;change(()=>{page().edges.forEach(e=>{if(e.bus===id)delete e.bus;});page().buses=page().buses.filter(b=>b.id!==id);S.selectedBus=null;});return;}
 if(a==='delete'&&S.selectedEdges.size>1){const ids=new Set(S.selectedEdges);change(()=>{page().edges=page().edges.filter(e=>!ids.has(e.id));S.selectedEdges.clear();S.selectedEdge=null;});return;}
 if(a==='delete'&&S.selected.size){const unlocked=[...S.selected].filter(id=>!page().nodes.find(n=>n.id===id)?.locked);if(!unlocked.length)return toast('Сначала снимите фиксацию блока.');S.selected=new Set(unlocked);}
 if(a==='group'){if(!S.selected.size)return;const ids=[...S.selected];inputDialog('Организационный подпроцесс','Название','Подпроцесс',title=>change(()=>{const id=C.uid('group');page().groups.forEach(g=>g.members=g.members.filter(x=>!ids.includes(x)));page().groups.push({id,title,members:ids,color:'#7376e6',parentId:null});page().nodes.forEach(n=>{if(ids.includes(n.id))n.group=id;});}));return;}
 return legacyAction(a);
}
function v3OnChange(e){
 const id=e.target.id,n=selected(),v=e.target.value;if(id==='compact'){S.compact=e.target.checked;render();fit();if(!S.readOnly)changed();return;}if(S.readOnly)return;
 if(n&&['node-collapsible','node-collapse-boundary','node-locked'].includes(id)){const checked=e.target.checked;change(()=>{if(id==='node-collapsible'){n.collapsible=checked;if(!checked)collapsed().delete(n.id);}else if(id==='node-collapse-boundary')n.collapseBoundary=checked;else n.locked=checked;});return;}
 if(n&&id.startsWith('port-')){const [,kind,side]=id.split('-'),checked=e.target.checked;change(()=>{n.portConfig=n.portConfig||{body:['left','right','top','bottom'],rows:[]};const list=new Set(n.portConfig[kind]||[]);if(checked)list.add(side);else list.delete(side);n.portConfig[kind]=[...list];});return;}
 if(id==='bus-offset'&&S.selectedBus){const b=page().buses.find(x=>x.id===S.selectedBus);if(b)change(()=>b.offset=Math.max(24,Math.min(10000,Number(v)||70)));return;}
 if(id==='edge-flow'&&S.selectedEdge){const edge=page().edges.find(x=>x.id===S.selectedEdge);if(edge)change(()=>edge.flow=e.target.checked);return;}
 if(id==='icon-select'){S.selectedIcon=Number(v)||0;renderInspector();return;}
 if(n?.icons?.length&&['icon-x','icon-y','icon-size','icon-width','icon-height'].includes(id)){if(n.locked)return toast('Сначала снимите фиксацию блока');const ic=n.icons[Math.min(S.selectedIcon,n.icons.length-1)];change(()=>{if(id==='icon-x')ic.x=Number(v)||0;if(id==='icon-y')ic.y=Number(v)||0;if(id==='icon-size')ic.w=ic.h=Math.max(8,Math.min(600,Number(v)||36));});return;}
 if(n?.locked&&['node-width','node-height'].includes(id))return;
 if(n?.table&&id==='node-height'){const metric=C.tableMetrics(n),height=Math.max(74,Number(v)||metric.total),body=metric.heights.reduce((a,b)=>a+b,0);change(()=>{n.table.heights=metric.heights.map(h=>Math.max(24,h*Math.max(24,height-metric.header-(n.materials.length?30:2))/Math.max(1,body)));n.h=C.tableMetrics(n).total;});return;}
 if(n?.table&&id==='node-width'){const width=Math.max(80,Number(v)||n.w);change(()=>{const f=width/n.w;n.table.widths=n.table.widths.map(w=>Math.max(32,w*f));n.w=n.table.widths.reduce((a,b)=>a+b,0);n.h=C.tableMetrics(n).total;});return;}
 return legacyOnChange(e);
}
function v3UpdateConnectStatus(){const el=$('#connect-status');if(!el)return;el.hidden=!S.pendingPort;if(S.pendingPort){const n=page().nodes.find(n=>n.id===S.pendingPort.node);el.textContent='Выход: '+(n?.title||'')+' → щёлкните второй порт. Esc — отмена';}}
function v3ChoosePort(node,port){
 if(!S.pendingPort){S.pendingPort={node,port};renderScene();return;}
 const first=S.pendingPort;if(first.node===node&&first.port===port){S.pendingPort=null;renderScene();return;}
 S.pendingPort=null;connectPorts(first.node,first.port,node,port);
}
function samePort(n,a,b){const p=C.port(n,a),q=C.port(n,b);return p.side===q.side&&Math.abs(p.x-q.x)+Math.abs(p.y-q.y)<.01;}
function connectPorts(source,sourcePort,target,targetPort){
 if(page().edges.some(e=>e.source===source&&e.target===target&&e.sourcePort===sourcePort&&e.targetPort===targetPort)){toast('Эти порты уже соединены');renderScene();return;}
 change(()=>{const e={id:C.uid('edge'),source,sourcePort,target,targetPort,arrow:true,dashed:false,label:''};page().edges.push(e);
  if(S.project.settings?.autoBus!==false){const n=page().nodes.find(n=>n.id===source),siblings=page().edges.filter(x=>x.source===source&&samePort(n,x.sourcePort,sourcePort));if(siblings.length>1){const existing=page().buses.find(b=>b.mode==='out'&&b.hub===source&&samePort(n,b.port,sourcePort));if(existing)siblings.forEach(x=>x.bus=existing.id);else S.project.pages[S.pageIndex]=C.combineEdges(page(),siblings.map(x=>x.id),'out');}}
  S.selectedEdge=e.id;S.selectedEdges=new Set([e.id]);S.selectedBus=null;S.selected.clear();
 });toast('Порты соединены. Блок входит в цепочку по этой связи.');
}
function v4CombineSelected(mode){
 const key=mode==='in'?'target':'source',pk=mode==='in'?'targetPort':'sourcePort';let ids=[...S.selectedEdges];
 if(ids.length<2){const e=page().edges.find(e=>e.id===S.selectedEdge);if(!e)return toast('Выберите связь или несколько связей через Shift');const hub=page().nodes.find(n=>n.id===e[key]);ids=page().edges.filter(x=>x[key]===e[key]&&samePort(hub,x[pk],e[pk])).map(x=>x.id);}
 const p=C.combineEdges(page(),ids,mode);change(()=>{S.project.pages[S.pageIndex]=p;S.selectedBus=p.edges.find(e=>ids.includes(e.id)).bus;S.selectedEdge=null;S.selectedEdges.clear();});
}
function v4OnPointerDown(e){
 if(S.home)return;closePopover();S.justDragged=false;const target=e.target,wp=worldPoint(e);
 if(target.closest('button,a,[data-open-material],[data-node-material],.material-badges,.collapse-node'))return;
 if(e.button===1||S.space||S.tool==='pan')return legacyOnPointerDown(e);if(e.button!==0)return;
 const busHandle=target.closest('[data-bus-handle]');if(busHandle&&!S.readOnly){const bus=page().buses.find(b=>b.id===busHandle.dataset.busHandle),route=S.bundle.buses.find(b=>b.id===bus.id);let moved=false;startDrag(e,ev=>{if(!moved){checkpoint();moved=true;}const p=worldPoint(ev);const sign=['left','top'].includes(route.anchor.side)?-1:1;bus.offset=Math.max(24,sign*(route.vertical?p.x-route.anchor.x:p.y-route.anchor.y));renderEdges();},()=>{if(moved){changed();renderInspector();}});return;}
 const icon=target.closest('[data-icon-index]');if(icon&&S.iconEdit&&!S.readOnly){const n=page().nodes.find(n=>n.id===icon.dataset.iconNode);if(n.locked)return;S.selectedIcon=Number(icon.dataset.iconIndex);const ic=n.icons[S.selectedIcon],origin={x:ic.x??-18,y:ic.y??-18};let moved=false;e.preventDefault();startDrag(e,ev=>{const p=worldPoint(ev);if(!moved){checkpoint();moved=true;}let dx=p.x-wp.x,dy=p.y-wp.y;if(ev.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}ic.x=origin.x+dx;ic.y=origin.y+dy;icon.style.left=ic.x+'px';icon.style.top=ic.y+'px';},()=>{if(moved){changed();render();}});return;}
 const port=target.closest('[data-port]');if(port&&!S.readOnly){e.preventDefault();const id=port.dataset.owner,pid=port.dataset.port,n=S.display.nodes.find(n=>n.id===id),origin=C.endpoint(n,pid,'right');let moved=false;
  startDrag(e,ev=>{if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)>5)moved=true;if(moved){const p=worldPoint(ev);$('#draft-stroke')?.setAttribute('d',`M${origin.x},${origin.y}L${p.x},${p.y}`);}},ev=>{const second=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('[data-port]');$('#draft-stroke')?.setAttribute('d','');if(moved){S.pendingPort=null;if(second&&(second.dataset.owner!==id||second.dataset.port!==pid))connectPorts(id,pid,second.dataset.owner,second.dataset.port);}else choosePort(id,pid);});return;
 }
 if(target.closest('[data-route-index]')||!['select','pan'].includes(S.tool))return legacyOnPointerDown(e);
 const bus=target.closest('[data-bus]');if(bus){
  const id=bus.dataset.bus,members=page().edges.filter(e=>e.bus===id).map(e=>e.id);
  if(e.shiftKey||e.ctrlKey||e.metaKey){addSelectedBusEdges();const all=members.every(id=>S.selectedEdges.has(id));for(const id of members)if(all)S.selectedEdges.delete(id);else S.selectedEdges.add(id);S.selectedBus=null;}
  else{S.selectedBus=id;S.selectedEdges.clear();}
  S.selected.clear();S.selectedEdge=S.selectedDrawing=null;renderEdges();renderInspector();highlightCommonPorts();return;
 }

 const edge=target.closest('[data-edge]');if(edge){const id=edge.dataset.edge;if(e.shiftKey||e.ctrlKey||e.metaKey){addSelectedBusEdges();if(S.selectedEdges.has(id))S.selectedEdges.delete(id);else{if(S.selectedEdge)S.selectedEdges.add(S.selectedEdge);S.selectedEdges.add(id);}}else S.selectedEdges=new Set([id]);S.selectedEdge=S.selectedEdges.size===1?[...S.selectedEdges][0]:null;S.selectedSegment=null;S.selectedBus=S.selectedDrawing=null;S.selected.clear();renderEdges();renderInspector();highlightCommonPorts();return;}
 const resize=target.closest('[data-resize]');if(resize&&!S.readOnly){const n=page().nodes.find(n=>n.id===resize.dataset.resize);if(n.locked)return;const w=n.w,h=n.h,t=n.table?C.clone(n.table):null;let moved=false;startDrag(e,ev=>{if(!moved){checkpoint();moved=true;}const p=worldPoint(ev);n.w=Math.max(60,w+p.x-wp.x);n.h=Math.max(30,h+p.y-wp.y);if(t){n.table.widths=t.widths.map(v=>Math.max(32,v*n.w/w));n.w=n.table.widths.reduce((a,b)=>a+b,0);const heights=C.tableMetrics({...n,w,table:t}).heights;n.table.heights=heights.map(v=>Math.max(24,v*n.h/h));n.h=C.tableMetrics(n).total;}renderScene();},()=>{if(moved){changed();render();}});return;}
 const nd=target.closest('[data-node]');if(nd){
  const id=nd.dataset.node,n=page().nodes.find(n=>n.id===id);if(!n)return;
  const was=S.selected.has(id);if(e.shiftKey){S.selected.add(id);}else if(!was)S.selected=new Set([id]);S.selectedEdge=S.selectedDrawing=S.selectedBus=null;S.selectedEdges.clear();$$('.node').forEach(el=>el.classList.toggle('selected',S.selected.has(el.dataset.node)));renderInspector();
  if(S.readOnly||n.locked){if(n.locked&&!S.readOnly)toast('Положение блока зафиксировано');return;}
  e.preventDefault();let moved=false,before,viewBefore,ids,axis=null;const selection=new Set(S.selected);
  startDrag(e,ev=>{const pt=worldPoint(ev);let dx=pt.x-wp.x,dy=pt.y-wp.y;
   if(!moved&&Math.hypot(dx,dy)*S.view.z<4)return;
   if(!moved){checkpoint();moved=true;viewBefore=C.clone(S.display.nodes);const hidden=S.display.hiddenOwner||new Map();S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);S.compact=false;
    ids=C.movementSet(page(),selection,{descendants:S.editModes.moveChain,shared:S.editModes.shared,hiddenOwner:hidden});S.dragMoving=ids;S.dragOrigin=viewBefore;
    before=new Map(page().nodes.filter(n=>ids.has(n.id)).map(n=>[n.id,{x:n.x+(n.offsetX||0),y:n.y+(n.offsetY||0),ax:n.anchorX||0,ay:n.anchorY||0}]));
   }
   if(ev.shiftKey||S.editModes.ortho){axis=axis||(Math.abs(dx)>=Math.abs(dy)?'x':'y');if(axis==='x')dy=0;else dx=0;}else axis=null;
   const snap=C.snapMove(viewBefore,ids,id,dx,dy,S.view.z,ev.altKey?{}:S.editModes,axis);dx=snap.dx;dy=snap.dy;S.guides=snap.guides;
   for(const [nid,o] of before){const x=page().nodes.find(n=>n.id===nid);if(x.anchorId){if(!ids.has(x.anchorId)){x.anchorX=o.ax+dx;x.anchorY=o.ay+dy;}}else{x.x=o.x+dx;x.y=o.y+dy;x.offsetX=x.offsetY=0;}}
   for(const dn of S.display.nodes){const orig=viewBefore.find(x=>x.id===dn.id);const x=page().nodes.find(x=>x.id===dn.id);if(ids.has(dn.id)||x?.anchorId&&ids.has(x.anchorId)){dn.x=orig.x+dx;dn.y=orig.y+dy;const el=$(`[data-node="${CSS.escape(dn.id)}"]`);if(el){el.style.left=dn.x+'px';el.style.top=dn.y+'px';}}}
   renderEdges();renderInk();renderGuides();highlightMoving();
  },()=>{S.guides=[];S.dragMoving=null;S.dragOrigin=null;if(moved){changed();render();}else if(e.shiftKey&&was){S.selected.delete(id);render();}});return;
 }
 S.selectedEdges.clear();S.selectedBus=null;return legacyOnPointerDown(e);
}
function v4OnDoubleClick(e){if(e.target.closest('[data-port],[data-icon-index],button,[data-open-material],.material-badges'))return;const bus=e.target.closest('[data-bus]');if(bus)return;return legacyOnDoubleClick(e);}
function v3OnKey(e){
 const mod=e.ctrlKey||e.metaKey,key=e.code||'',editing=e.target.closest?.('input,textarea,select,[contenteditable=true]');
 if(S.home){if(mod&&key==='KeyO'){e.preventDefault();openDocumentPicker().catch(err=>toast(err.message));}return;}
 const isZ=key==='KeyZ'||e.key.toLowerCase()==='z',isY=key==='KeyY'||e.key.toLowerCase()==='y';
 if(currentModal?.kind==='table'&&mod&&(isZ||isY)){e.preventDefault();e.stopPropagation();(isY||e.shiftKey?currentModal.redo:currentModal.undo)?.();return;}
 if(e.key==='Escape'){if(currentModal){closeModal();return;}S.pendingPort=null;S.iconEdit=false;S.selectedBus=null;S.selectedEdges.clear();S.tool='select';S.selected.clear();S.selectedEdge=null;render();return;}
 if(mod&&key==='KeyS'){e.preventDefault();if(currentModal){toast('Сначала примените или отмените изменения в открытом окне.');return;}if(editing)editing.dispatchEvent(new Event('change',{bubbles:true}));saveDocument(e.shiftKey).catch(err=>toast(err.message,9000));return;}
 if(currentModal||editing)return;
 if(e.target?.matches?.('[data-port]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choosePort(e.target.dataset.owner,e.target.dataset.port);return;}
 if(e.code==='Space'){e.preventDefault();S.space=true;return;}
 if(mod&&key==='KeyS'){e.preventDefault();saveDocument(e.shiftKey).catch(err=>toast(err.message,9000));return;}
 if(mod&&key==='KeyO'){e.preventDefault();openDocumentPicker().catch(err=>toast(err.message));return;}
 if(S.readOnly)return;
 if(mod&&(isZ||isY)){e.preventDefault();isY||e.shiftKey?redo():undo();return;}
 if(mod&&key==='KeyD'){e.preventDefault();action('duplicate');return;}
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&S.selected.size){e.preventDefault();nudge(e.key,e.shiftKey?10:1);return;}
 if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();action('delete');return;}
 const tools={KeyV:'select',KeyH:'pan',KeyB:'block',KeyT:'text',KeyP:'pen'};if(!mod&&tools[key])setTool(tools[key]);
}
function v4Nudge(key,step){
 if(S.readOnly||!S.selected.size)return;
 const ids=C.movementSet(page(),S.selected,{descendants:S.editModes.moveChain,shared:S.editModes.shared,hiddenOwner:S.display?.hiddenOwner});
 if(!ids.size)return toast('Положение выделенных блоков зафиксировано');
 const dx=key==='ArrowLeft'?-step:key==='ArrowRight'?step:0,dy=key==='ArrowUp'?-step:key==='ArrowDown'?step:0;
 change(()=>{S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);S.compact=false;
  for(const n of page().nodes)if(ids.has(n.id)){if(n.anchorId){if(!ids.has(n.anchorId)){n.anchorX=(n.anchorX||0)+dx;n.anchorY=(n.anchorY||0)+dy;}}else{n.x+=dx;n.y+=dy;}}
 });
}
function contextMenu(e){
 if(S.readOnly||currentModal)return;e.preventDefault();$('#canvas-context')?.remove();const nd=e.target.closest('[data-node]'),ed=e.target.closest('[data-edge]');let choices;
 if(nd){const n=page().nodes.find(n=>n.id===nd.dataset.node);if(!n)return;if(!S.selected.has(n.id))S.selected=new Set([n.id]);S.selectedEdge=S.selectedBus=null;S.selectedEdges.clear();renderInspector();choices=[[n.table?'table-edit':'edit-text',n.table?'Редактировать таблицу':'Редактировать текст'],['attach','Прикрепить материалы'],['enable-collapse',n.collapsible?'Отключить сворачивание цепочки':'Включить сворачивание цепочки'],[n.locked?'unlock':'lock',n.locked?'Снять фиксацию':'Зафиксировать положение'],['duplicate','Дублировать'],['align-menu','Режимы привязки…'],['delete','Удалить']];}
 else if(ed){S.selectedEdge=ed.dataset.edge;S.selected.clear();renderInspector();choices=[['combine-auto','Объединить связи в гребёнку'],['route-add','Добавить точку маршрута'],['route-clear','Сбросить маршрут'],['delete','Удалить связь']];}
 else choices=[['context-block','Добавить блок здесь'],['context-table','Добавить таблицу здесь'],['fit','Вписать схему']];
 const pt=worldPoint(e),menu=document.createElement('div');menu.id='canvas-context';menu.className='canvas-context';menu.style.left=Math.max(8,Math.min(e.clientX,innerWidth-270))+'px';menu.style.top=Math.max(8,Math.min(e.clientY,innerHeight-330))+'px';menu.innerHTML=choices.map(([id,t])=>`<button data-context="${id}">${t}</button>`).join('');document.body.append(menu);
 const close=ev=>{if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('pointerdown',close,true);}};document.addEventListener('pointerdown',close,true);
 $$('[data-context]',menu).forEach(b=>b.onclick=caught(async()=>{const cmd=b.dataset.context;menu.remove();document.removeEventListener('pointerdown',close,true);if(cmd.startsWith('context-'))addNode(cmd.slice(8),pt);else if(cmd==='enable-collapse'){const n=selected();change(()=>{n.collapsible=!n.collapsible;if(!n.collapsible)collapsed().delete(n.id);});}else await action(cmd);}));
}
function registry(attachNodeId=null){
 modal(attachNodeId?'Прикрепить материал':'Материалы документа',`<div class="registry-tools"><input id="registry-search" placeholder="Название или путь к файлу…"><div class="row wrap"><button id="material-check">Проверить файлы</button>${S.readOnly?'':'<button id="material-relink">Перепривязка</button><button id="material-new-link">+ Адрес / путь</button><button id="material-folder-pick" class="primary">Из папки</button><button id="material-upload">+ Файлы</button>'}</div></div><div class="notice">Файлы остаются в ваших папках. В документе — ID материала и его адрес. Папка: <strong>${esc(DOC.folderName||DOC.root?.name||(DOC.direct?'рядом с открытым HTML':'не подключена'))}</strong>. «Из папки» выбирает точный относительный путь. «+ Файлы» без папки задаёт имя файла; для подпапок исправьте путь.</div><div class="registry-wrap"><table class="registry"><colgroup><col style="width:43%"><col style="width:13%"><col style="width:12%"><col style="width:32%"></colgroup><thead><tr><th>Материал / расположение</th><th>Тип</th><th>Привязки</th><th>Действия</th></tr></thead><tbody id="registry-body"></tbody></table></div>`);
 $('#material-check').onclick=()=>materialCheckDialog();
 function rows(query=''){const list=S.project.materials.filter(m=>(m.title+' '+(m.path||m.url||'')).toLowerCase().includes(query.toLowerCase()));
  $('#registry-body').innerHTML=list.map(m=>`<tr><td><strong class="registry-material-title">${fileIcon(m)} ${esc(m.title)}</strong><small class="material-path">${esc(m.kind==='cell'?locationText(m):m.path||m.url||(m.asset?'Встроено в старое хранилище':'Адрес не задан'))}</small></td><td>${esc(typeName[m.kind]||m.kind)}<small class="block-small">ред. ${m.version||1}</small></td><td><button data-usage="${esc(m.id)}">${usage(m.id).length}</button></td><td><div class="row wrap"><button data-mopen="${esc(m.id)}" title="Просмотреть">${uiIcon('preview')}</button><button data-material-id="${esc(m.id)}" data-material-action="external" title="Открыть отдельно">${uiIcon('external')}</button><button data-material-id="${esc(m.id)}" data-material-action="location" title="Местоположение">${uiIcon('folder')}</button>${S.readOnly?'':`<button data-medit="${esc(m.id)}">Изменить</button>${!['cell','page'].includes(m.kind)?`<button data-mreplace="${esc(m.id)}" title="Выбрать другой файл, сохранив ID материала">Заменить</button>`:''}`}${attachNodeId?`<button class="primary" data-mattach="${esc(m.id)}">Прикрепить</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="4">Материалы не найдены</td></tr>';
  $$('[data-mopen]').forEach(b=>b.onclick=caught(()=>openMaterial(b.dataset.mopen)));$$('[data-medit]').forEach(b=>b.onclick=()=>editMaterial(b.dataset.medit,attachNodeId));$$('[data-usage]').forEach(b=>b.onclick=()=>showUsage(b.dataset.usage));
  $$('[data-mreplace]').forEach(b=>b.onclick=caught(async()=>{if(DOC.root||DOC.files.size)return folderMaterialPicker(attachNodeId,b.dataset.mreplace);const fs=await pickFiles('',false);if(fs.length){await uploadFile(fs[0],b.dataset.mreplace);registry(attachNodeId);renderScene();}}));
  $$('[data-mattach]').forEach(b=>b.onclick=()=>{const n=page().nodes.find(n=>n.id===attachNodeId);closeModal();change(()=>{if(n&&!n.materials.includes(b.dataset.mattach))n.materials.push(b.dataset.mattach);});});
 }
 $('#registry-search').oninput=e=>rows(e.target.value);
 if(!S.readOnly){$('#material-relink').onclick=bulkRelink;if($('#material-folder-pick'))$('#material-folder-pick').onclick=caught(()=>folderMaterialPicker(attachNodeId));$('#material-new-link').onclick=()=>editMaterial(null,attachNodeId);$('#material-upload').onclick=caught(async()=>{const fs=await pickFiles();const ids=[];for(const f of fs)ids.push((await uploadFile(f)).id);if(attachNodeId&&ids.length)change(()=>{const n=page().nodes.find(n=>n.id===attachNodeId);n.materials=[...new Set([...n.materials,...ids])];});registry(attachNodeId);renderScene();});}rows();
}
function editMaterial(id,attachNodeId){
 if(id&&findMaterial(id)?.kind==='cell'){const m=findMaterial(id);return inputDialog('Название ссылки на ячейку','Название',m.title,value=>{change(()=>{m.title=value;m.version=(m.version||1)+1;});registry(attachNodeId);});}
 const m=id?mat(id):{title:'',kind:'link',url:''};const source=m.path?'local':m.kind==='page'?'page':m.url?'url':'local';
 modal(id?'Расположение материала':'Новый материал',`<div class="stack">${field('Название','mat-title',m.title)}<div class="grid2"><label class="field">Тип<select id="mat-kind">${Object.entries(typeName).filter(([k])=>k!=='cell').map(([k,v])=>`<option value="${k}" ${m.kind===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field">Источник<select id="mat-source"><option value="local" ${source==='local'?'selected':''}>Файл в папке</option><option value="url" ${source==='url'?'selected':''}>HTTP / HTTPS</option><option value="page" ${source==='page'?'selected':''}>Страница документа</option></select></label></div>${field('Путь от папки документа / адрес','mat-url',m.path||m.url||'')}<small>Пример: materials/video.mp4. Программа не переносит файл по этому пути автоматически.</small><label class="field">Для внутреннего перехода<select id="mat-page">${S.project.pages.map(p=>`<option value="${esc(p.id)}" ${m.url==='data:page/id,'+p.id?'selected':''}>${esc(p.title)}</option>`).join('')}</select></label><div class="grid2">${field('Начать видео с секунды','mat-time',m.startAt||0,'number')}${field('PDF-превью: путь / HTTP-адрес','mat-preview',m.previewPath||m.previewURL||'')}</div><label class="check-row"><input type="checkbox" id="mat-embed" ${m.embed?'checked':''}> Встраивать сайт в окно, когда сайт это разрешает</label><div class="notice">Изменение записи сохраняет её ID и все привязки. Для Word / презентации можно указать отдельное PDF-превью; сами исходники останутся отдельными файлами.</div></div>`,`<button id="mat-save" class="primary">Применить</button>`,true);
 $('#mat-save').onclick=()=>{
  const title=$('#mat-title').value.trim(),kind=$('#mat-kind').value,src=$('#mat-source').value,value=$('#mat-url').value.trim().replace(/\\/g,'/'),preview=$('#mat-preview').value.trim().replace(/\\/g,'/'),startAt=Math.max(0,Number($('#mat-time').value)||0),embed=$('#mat-embed').checked,pid=$('#mat-page').value;
  if(!title)return toast('Введите название');if(src==='local'&&!validRelative(value))return toast('Укажите относительный путь без ../ и без буквы диска. Например materials/video.mp4');if(src==='url'&&!httpURL(value))return toast('Нужен HTTP / HTTPS-адрес без логина и пароля');if(preview&&!httpURL(preview)&&!validRelative(preview))return toast('Некорректный адрес PDF-превью');
  const mid=id||C.uid('material');closeModal();change(()=>{const target=id?m:{id:mid,version:0};const wasPath=target.path,wasURL=target.url;Object.assign(target,{title,kind:src==='page'?'page':kind,startAt,embed,version:(target.version||0)+1});delete target.path;delete target.url;
   if(src==='local')target.path=value;else target.url=src==='page'?'data:page/id,'+pid:httpURL(value);
   if(value||src==='page'){delete target.asset;delete target.previewAsset;}
   delete target.previewPath;delete target.previewURL;if(preview){if(httpURL(preview))target.previewURL=httpURL(preview);else target.previewPath=preview;}
   if(wasPath!==target.path||wasURL!==target.url){DOC.sessionFiles.delete(mid);if(DOC.urls.has(mid))URL.revokeObjectURL(DOC.urls.get(mid));DOC.urls.delete(mid);}if(DOC.urls.has(mid+':preview'))URL.revokeObjectURL(DOC.urls.get(mid+':preview'));DOC.urls.delete(mid+':preview');
   if(!id)S.project.materials.push(target);if(attachNodeId){const n=page().nodes.find(n=>n.id===attachNodeId);if(n&&!n.materials.includes(mid))n.materials.push(mid);}
  });registry(attachNodeId);
 };
}
function v5ShowNodeMaterials(n,kind){
 const ms=[...new Set(n.materials||[])].map(mat).filter(m=>m&&(!kind||m.kind===kind));
 modal('Материалы — '+n.title,`<div class="stack material-list">${ms.map(m=>`<button data-view-material="${esc(m.id)}"><span class="material-type-icon">${sign(m.kind)}</span><span><strong>${esc(m.title)}</strong><small>${esc(typeName[m.kind]||m.kind)}${m.kind==='page'?' · откроется подтверждение перехода':''}</small></span><span class="spacer"></span><span>›</span></button>`).join('')||'<p>Материалов этого типа нет.</p>'}</div>`,'',true);
 $$('[data-view-material]').forEach(b=>b.onclick=caught(()=>openMaterial(b.dataset.viewMaterial)));
}
async function v5OpenMaterial(id){
 if(S.server){if(!S.readOnly)await save();const latest=S.pub?(await request('/api/published/'+encodeURIComponent(S.pub))).materials:await request('/api/materials');S.project.materials=latest;}
 const m=mat(id);if(!m)return toast('Материал не найден');
 if(m.kind==='page'||m.url?.startsWith('data:page/id,')){
  const pid=(m.url||'').split(',')[1],index=S.project.pages.findIndex(p=>p.id===pid),same=index===S.pageIndex;
  modal('Переход на страницу',`<p class="material-long-title">${esc(m.title)}</p><div class="notice">Это внутренняя ссылка, а не файл. ${index<0?'Связанная страница отсутствует.':same?'Вы уже на этой странице. Камера не перемещалась.':'Страница: '+esc(S.project.pages[index].title)}</div>`,index>=0&&!same?'<button id="go-material-page" class="primary">Перейти на страницу</button>':'',true);
  if($('#go-material-page'))$('#go-material-page').onclick=()=>{closeModal();S.pageIndex=index;S.selected.clear();render();fit();};return;
 }
 let url='',preview='',error='';try{url=await resolveMaterial(m);if(m.previewPath||m.previewURL||m.previewAsset)preview=await resolveMaterial(m,true);if(m.previewMaterial)preview=await resolveMaterial(mat(m.previewMaterial));}catch(e){error=e.message;}
 const info=`<p class="material-long-title">${fileIcon(m)} <strong>${esc(m.filename||m.title)}</strong></p><p class="material-path muted">${esc(m.path||m.url||'')} · ${esc(typeName[m.kind]||m.kind)}</p>`;
 let content=info;
 if(error||!url&&!preview)content+=`<div class="notice warn">${esc(error||'Браузер ещё не имеет доступа к папке материалов. Укажите корневую папку, в которой лежит HTML документа.')}<div class="row wrap"><button id="viewer-bind-folder">Подключить папку</button>${S.readOnly?'':'<button id="viewer-edit-path">Исправить путь</button>'}</div></div>`;
 else if(m.kind==='video')content+=`<video controls preload="metadata" playsinline src="${esc(url)}"></video><p id="media-error" class="muted"></p>`;
 else if(m.kind==='audio')content+=`<audio controls src="${esc(url)}"></audio>`;
 else if(m.kind==='image')content+=`<img class="viewer-img" alt="${esc(m.title)}" src="${esc(url)}">`;
 else if(m.kind==='pdf'||preview)content+=`<iframe title="${esc(m.title)}" src="${esc(preview||url)}"></iframe><p class="muted">PDF отображается средствами браузера. Пустое окно: проверьте доступ к папке или откройте отдельно.</p>`;
 else if(m.kind==='link'&&m.embed)content+=`<iframe title="${esc(m.title)}" sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer" src="${esc(url)}"></iframe><p class="muted">Сайт может запрещать встраивание. Тогда используйте «Открыть отдельно».</p>`;
 else if(m.kind==='document')content+='<div class="notice"><h3>Исходный документ</h3><p>Word и презентация остаются в своей папке. Для просмотра здесь укажите в реестре путь к PDF-превью. Без превью исходник можно открыть отдельно.</p></div>';
 else content+='<div class="notice">Внешняя ссылка. Откройте её отдельной кнопкой ниже. Камера схемы остаётся на месте.</div>';
 const footer=`${url?`<a class="button-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть отдельно</a>`:''}<span class="spacer"></span><button id="back-registry">К материалам</button>`;
 modal(m.title,content,footer);
 $('#back-registry').onclick=()=>registry();if($('#viewer-bind-folder'))$('#viewer-bind-folder').onclick=caught(async()=>{await bindFolder();await openMaterial(id);});if($('#viewer-edit-path'))$('#viewer-edit-path').onclick=()=>editMaterial(id);
 const video=$('video',$('.modal'));if(video){video.onloadedmetadata=()=>{if(m.startAt)video.currentTime=Math.min(m.startAt,Number.isFinite(video.duration)?Math.max(0,video.duration-.1):m.startAt);};video.onerror=()=>{$('#media-error').textContent='Браузер не смог воспроизвести файл. Проверьте путь, доступ и кодек; подключите папку через кнопку «Папка».';};}
}
function bulkRelink(){
 modal('Перепривязка путей и адресов',`<div class="stack">${field('Старое начало пути / адреса','relink-old','')}${field('Новое начало пути / адреса','relink-new','')}<p class="muted">Меняются только исходные адреса материалов, не ID и не сами файлы. Поддерживаются относительные пути и HTTP / HTTPS.</p><button id="relink-preview">Показать изменения</button><div id="relink-preview-list"></div></div>`,`<button id="relink-apply" class="primary" disabled>Применить</button>`,true);
 let changes=[];const reset=()=>{changes=[];$('#relink-apply').disabled=true;$('#relink-preview-list').textContent='';};$('#relink-old').oninput=reset;$('#relink-new').oninput=reset;
 $('#relink-preview').onclick=()=>{const from=$('#relink-old').value.trim().replace(/\\/g,'/'),to=$('#relink-new').value.trim().replace(/\\/g,'/');if(!from||!to)return toast('Задайте оба начала адреса');
  changes=S.project.materials.filter(m=>m.kind!=='page'&&(m.path||m.url||'').startsWith(from)).map(m=>({id:m.id,title:m.title,before:m.path||m.url,after:to+(m.path||m.url).slice(from.length)}));
  if(changes.some(c=>!validRelative(c.after)&&!httpURL(c.after)))return toast('Получился некорректный путь или адрес');
  $('#relink-preview-list').innerHTML=`<strong>Материалов: ${changes.length}</strong>`+changes.map(c=>`<div class="relink-item"><b>${esc(c.title)}</b><del>${esc(c.before)}</del><span>${esc(c.after)}</span></div>`).join('');$('#relink-apply').disabled=!changes.length;
 };
 $('#relink-apply').onclick=()=>{change(()=>{for(const c of changes){const m=mat(c.id);delete m.path;delete m.url;if(httpURL(c.after))m.url=httpURL(c.after);else m.path=c.after;m.version=(m.version||1)+1;DOC.sessionFiles.delete(m.id);if(DOC.urls.has(m.id))URL.revokeObjectURL(DOC.urls.get(m.id));DOC.urls.delete(m.id);}});registry();toast('Перепривязано материалов: '+changes.length);};
}
function tableEditor(node){
 if(S.readOnly)return;let t=C.clone(node.table),a={r:0,c:0},b={r:0,c:0},history=[],future=[],editingCell=null,inlineRange=null;
 const rememberRange=()=>{const sel=window.getSelection();if(!sel?.rangeCount)return;const r=sel.getRangeAt(0),host=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;if(host.closest?.('#table-grid [data-cell]'))inlineRange=r.cloneRange();};
 document.addEventListener('selectionchange',rememberRange);const observer=new MutationObserver(()=>{if(!$('#table-grid')){document.removeEventListener('selectionchange',rememberRange);observer.disconnect();}});observer.observe($('#modal-root'),{childList:true});
 const remember=()=>{history.push(C.clone(t));if(history.length>80)history.shift();future=[];};
 const footer='<span id="cell-selection-caption" class="muted"></span><span class="spacer"></span><button id="table-cancel">Отмена</button><button id="table-save" class="primary">Применить</button>';
 modal('Таблица — '+node.title,`<div class="table-ribbon" role="toolbar" aria-label="Редактирование таблицы">
 <button id="table-undo" class="ribbon-icon" title="Отменить · Ctrl+Z">↶</button><button id="table-redo" class="ribbon-icon" title="Повторить · Ctrl+Y">↷</button><i></i>
 <button id="cell-bold" class="ribbon-icon" title="Полужирный"><b>B</b></button><input id="cell-color" type="color" value="#ffffff" title="Заливка ячеек" aria-label="Заливка ячеек">
 <select id="cell-align" title="Выравнивание текста" aria-label="Выравнивание текста"><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></select><button id="cell-emoji" class="ribbon-icon" title="Эмодзи">☺</button><i></i>
 <button id="cell-links-toggle" title="Вставить ссылку в текст или прикрепить к ячейке">${uiIcon('chain')} Ссылка</button>
 <details class="ribbon-menu"><summary>Структура ${uiIcon('chevronDown')}</summary><div class="ribbon-popup"><small>Ячейки</small><button id="cell-link-target" title="Добавить адрес выбранной ячейки в реестр материалов">Создать ссылку на ячейку</button><button id="merge-cells">Объединить выделение</button><button id="split-cell">Разъединить ячейку</button><small>Строки</small><button id="row-before">Добавить выше</button><button id="add-row">Добавить ниже</button><button id="remove-row">Удалить строку</button><small>Столбцы</small><button id="col-before">Добавить слева</button><button id="add-col">Добавить справа</button><button id="remove-col">Удалить столбец</button></div></details>
 <details class="ribbon-menu"><summary>Размеры ${uiIcon('chevronDown')}</summary><div class="ribbon-popup"><label class="field">Столбец на схеме, px<input id="col-width" type="number" min="32" max="4000"></label><label class="field">Строка на схеме, px<input id="row-height" type="number" min="0" max="6000" title="0 — по тексту"></label><button id="auto-row-height">Высота по тексту</button></div></details>
 <details class="ribbon-menu"><summary>${uiIcon('settings')} Таблица</summary><div class="ribbon-popup table-options">${behaviorOption('editor-auto-size','Авторазмер',t.autoSize,'Подбирать высоту строк по содержимому')}<label class="field">Перенос слов<select id="editor-word-wrap"><option value="words" ${t.wordWrap!=='hyphenate'?'selected':''}>Только целые слова</option><option value="hyphenate" ${t.wordWrap==='hyphenate'?'selected':''}>Русские переносы</option></select></label></div></details>
 <span class="spacer"></span><span class="ribbon-help" title="Двойной щелчок — редактировать. Shift + щелчок — диапазон. Размеры относятся к схеме; здесь весь текст виден.">?</span></div>
 <div id="cell-link-editor" class="table-link-popover" hidden></div><div class="table-editor-wrap" id="table-grid"></div>`,footer);
 currentModal.kind='table';const dialog=$('.modal');dialog.classList.add('table-dialog');dialog.style.setProperty('--table-dialog-width',Math.min(1440,Math.max(640,t.widths.length*260+120))+'px');
 const fullscreen=document.createElement('button');fullscreen.id='table-fullscreen';fullscreen.className='icon ghost';fullscreen.title='На весь экран';fullscreen.setAttribute('aria-label','На весь экран');fullscreen.innerHTML=uiIcon('fullscreen');$('.modal-head [data-close]').before(fullscreen);
 const setFullscreen=enabled=>{dialog.closest('.modal-overlay').classList.toggle('table-fullscreen',enabled);fullscreen.innerHTML=uiIcon(enabled?'fullscreenExit':'fullscreen');fullscreen.title=enabled?'Вернуть размер окна':'На весь экран';fullscreen.setAttribute('aria-label',fullscreen.title);sync();draw();};
 fullscreen.onclick=()=>setFullscreen(!dialog.closest('.modal-overlay').classList.contains('table-fullscreen'));
 currentModal.dismissOverlay=()=>{if(!$('#cell-link-editor').hidden){$('#cell-link-editor').hidden=true;return true;}const menus=$$('.ribbon-menu[open]');if(menus.length){menus.forEach(m=>m.open=false);return true;}if(dialog.closest('.modal-overlay').classList.contains('table-fullscreen')){setFullscreen(false);return true;}return false;};
 for(const menu of $$('.ribbon-menu'))menu.addEventListener('toggle',()=>{if(menu.open){for(const other of $$('.ribbon-menu'))if(other!==menu)other.open=false;$('#cell-link-editor').hidden=true;}});
 let linkMode=null,linkSource='registry';

 function clamp(){a.r=Math.max(0,Math.min(a.r,t.cells.length-1));a.c=Math.max(0,Math.min(a.c,t.cells[0].length-1));b.r=Math.max(0,Math.min(b.r,t.cells.length-1));b.c=Math.max(0,Math.min(b.c,t.cells[0].length-1));}
 function sync(){for(const el of $$('[data-cell]')){const [r,c]=el.dataset.cell.split(',').map(Number),cell=t.cells[r]?.[c];if(cell){cell.text=el.innerText.replace(/\u00ad/g,'');cell.html=cleanHTML(el.innerHTML);}}}
 function selection(){clamp();const q=C.normalizedRange(a,b);$$('[data-cell]').forEach(el=>{const [r,c]=el.dataset.cell.split(',').map(Number);el.parentElement.classList.toggle('cell-selected',r>=q.r0&&r<=q.r1&&c>=q.c0&&c<=q.c1);});$('#col-width').value=Math.round(t.widths[a.c]);$('#row-height').value=Math.round(t.heights[a.r]||0);$('#cell-selection-caption').textContent=`Строки ${q.r0+1}–${q.r1+1} · столбцы ${q.c0+1}–${q.c1+1}`;$('#table-undo').disabled=!history.length;$('#table-redo').disabled=!future.length;if($('#editor-auto-size'))$('#editor-auto-size').checked=!!t.autoSize;if($('#editor-word-wrap'))$('#editor-word-wrap').value=t.wordWrap||'words';currentModal.pendingMaterials=t._pendingMaterials||[];}
 function mapSelection(fn){const q=C.normalizedRange(a,b);for(let r=q.r0;r<=q.r1;r++)for(let c=q.c0;c<=q.c1;c++)if(t.cells[r]?.[c])fn(t.cells[r][c]);}
 function operate(fn){sync();const before=C.clone(t);remember();try{fn();C.validateTable(t);clamp();draw();}catch(e){t=before;history.pop();toast(e.message,6500);draw();}}
 function localUndo(){sync();editingCell=null;if(history.length){future.push(C.clone(t));t=history.pop();draw();}}
 function localRedo(){editingCell=null;if(future.length){history.push(C.clone(t));t=future.pop();draw();}}
 currentModal.undo=localUndo;currentModal.redo=localRedo;
 function draw(){
  clamp();const layout=editorLayout(),met=layout.met,sum=layout.sum,workingWidths=layout.widths;
  $('#table-grid').innerHTML=`<table lang="ru" class="table-editor wrap-${t.wordWrap||'words'}" style="width:${sum+40}px;min-width:0;font-size:${node.fontSize||13}px"><colgroup><col style="width:40px">${workingWidths.map(w=>`<col style="width:${w}px">`).join('')}</colgroup><thead><tr><th class="axis-corner"></th>${t.widths.map((w,c)=>`<th><button class="column-index" data-column-index="${c}">${c+1}<small>${Math.round(w)} px</small></button><span class="col-grip" data-col-grip="${c}" title="Изменить ширину столбца"></span></th>`).join('')}</tr></thead><tbody>${t.cells.map((row,r)=>`<tr style="height:${met.heights[r]}px"><th class="row-header"><button class="row-index" data-row-index="${r}">${r+1}</button><span class="row-grip" data-row-grip="${r}" title="Изменить высоту строки"></span></th>${row.map((c,col)=>!c?'':`<td rowspan="${c.rowspan||1}" colspan="${c.colspan||1}" style="padding:0;background-color:${esc(c.fill||'#fff')};font-weight:${c.bold?'700':'400'};text-align:${esc(c.align||'left')}"><div contenteditable="true" role="textbox" spellcheck="false" data-cell="${r},${col}" style="height:${Math.max(1,met.heights.slice(r,r+(c.rowspan||1)).reduce((a,b)=>a+b,0)-1-editorLinksHeight(c))}px" class="editable-cell">${c.html?cleanHTML(c.html):esc(c.text)}</div>${editorLinksHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  sizeEditorSurface(met);selection();
  $$('[data-cell]').forEach(el=>{
   el.onpointerdown=e=>{const [r,c]=el.dataset.cell.split(',').map(Number);if(e.shiftKey){e.preventDefault();b={r,c};}else{a={r,c};b={r,c};}selection();};
   el.onfocus=()=>editingCell=null;
   el.onbeforeinput=()=>{if(editingCell!==el.dataset.cell){remember();editingCell=el.dataset.cell;}};
   el.oninput=()=>{const [r,c]=el.dataset.cell.split(',').map(Number);t.cells[r][c].text=el.innerText.replace(/\u00ad/g,'');t.cells[r][c].html=cleanHTML(el.innerHTML);$('#table-undo').disabled=!history.length;refreshMetrics();};
   el.onblur=()=>{sync();editingCell=null;};
   el.onpaste=e=>{const raw=e.clipboardData.getData('text/plain');if(!raw.includes('\t'))return;e.preventDefault();const [r0,c0]=el.dataset.cell.split(',').map(Number),values=raw.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(l=>l.split('\t'));operate(()=>{
    while(t.cells.length<r0+values.length)t=C.tableAxis(t,'row',t.cells.length);
    while(t.cells[0].length<c0+Math.max(...values.map(r=>r.length)))t=C.tableAxis(t,'col',t.cells[0].length);
    values.forEach((row,r)=>row.forEach((text,c)=>{const cell=t.cells[r0+r][c0+c];if(!cell||(cell.rowspan||1)>1||(cell.colspan||1)>1)throw Error('Вставка пересекает объединение. Сначала разъедините ячейки.');cell.text=text;cell.html='';}));
   });};
  });
  $$('[data-column-index]').forEach(el=>el.onclick=()=>{a={r:0,c:+el.dataset.columnIndex};b={r:t.cells.length-1,c:a.c};selection();});
  $$('[data-row-index]').forEach(el=>el.onclick=()=>{a={r:+el.dataset.rowIndex,c:0};b={r:a.r,c:t.cells[0].length-1};selection();});
  $$('[data-col-grip]').forEach(el=>el.onpointerdown=e=>{e.preventDefault();sync();remember();const c=+el.dataset.colGrip,width=t.widths[c],x=e.clientX;startDrag(e,ev=>{t.widths[c]=Math.max(32,Math.min(4000,width+ev.clientX-x));draw();},()=>{selection();});});
  $$('[data-row-grip]').forEach(el=>el.onpointerdown=e=>{e.preventDefault();sync();remember();const r=+el.dataset.rowGrip,height=met.heights[r],y=e.clientY;startDrag(e,ev=>{t.autoSize=false;t.heights[r]=Math.max(24,Math.min(6000,height+ev.clientY-y));draw();},()=>{selection();});});
 }
 $('#cell-link-target').onclick=()=>{const target={pageId:page().id,nodeId:node.id,rowId:t.rowIds[a.r],colId:t.colIds[a.c]},title=node.title+' · '+(a.r+1)+':'+(a.c+1);operate(()=>{if(![...S.project.materials,...(t._pendingMaterials||[])].some(m=>m.kind==='cell'&&JSON.stringify(m.target)===JSON.stringify(target)))t._pendingMaterials=[...(t._pendingMaterials||[]),{id:C.uid('m'),title,kind:'cell',target,version:1}];});for(const menu of $$('.ribbon-menu'))menu.open=false;toast('Ссылка на ячейку появится в реестре после «Применить».');};
 $('#merge-cells').onclick=()=>operate(()=>t=C.mergeTable(t,a,b));$('#split-cell').onclick=()=>operate(()=>t=C.splitTable(t,a.r,a.c));
 $('#table-undo').onclick=localUndo;$('#table-redo').onclick=localRedo;
 $('#row-before').onclick=()=>operate(()=>{t=C.tableAxis(t,'row',a.r);a.r++;b.r++;});$('#add-row').onclick=()=>operate(()=>t=C.tableAxis(t,'row',b.r+1));
 $('#col-before').onclick=()=>operate(()=>{t=C.tableAxis(t,'col',a.c);a.c++;b.c++;});$('#add-col').onclick=()=>operate(()=>t=C.tableAxis(t,'col',b.c+1));
 $('#remove-row').onclick=()=>operate(()=>t=C.tableAxis(t,'row',a.r,true));$('#remove-col').onclick=()=>operate(()=>t=C.tableAxis(t,'col',a.c,true));
 $('#col-width').onchange=e=>{const v=Math.max(32,Math.min(4000,Number(e.target.value)||170));operate(()=>{const q=C.normalizedRange(a,b);for(let c=q.c0;c<=q.c1;c++)t.widths[c]=v;});};
 $('#row-height').onchange=e=>{const v=Math.max(0,Math.min(6000,Number(e.target.value)||0));operate(()=>{const q=C.normalizedRange(a,b);t.autoSize=false;for(let r=q.r0;r<=q.r1;r++)t.heights[r]=v?Math.max(24,v):0;});};
 $('#auto-row-height').onclick=()=>operate(()=>{const q=C.normalizedRange(a,b);for(let r=q.r0;r<=q.r1;r++)t.heights[r]=0;});
 $('#cell-color').onchange=e=>{const v=e.target.value;operate(()=>mapSelection(c=>c.fill=v));};$('#cell-align').onchange=e=>{const v=e.target.value;operate(()=>mapSelection(c=>c.align=v));};$('#cell-bold').onclick=()=>operate(()=>mapSelection(c=>c.bold=!c.bold));
 $('#cell-emoji').onclick=()=>{if($('#table-emoji-tray')){$('#table-emoji-tray').remove();return;}const tray=document.createElement('div');tray.id='table-emoji-tray';tray.className='emoji-picker notice';tray.innerHTML=Object.entries(EMOJI).map(([g,u])=>`<button data-table-emoji="${esc(g)}" title="${esc(g)}"><img alt="${esc(g)}" src="${u}"></button>`).join('');$('#table-grid').before(tray);$$('[data-table-emoji]',tray).forEach(btn=>btn.onclick=()=>{const g=btn.dataset.tableEmoji;operate(()=>{if(t.cells[a.r][a.c]){t.cells[a.r][a.c].text+=g;t.cells[a.r][a.c].html='';}});tray.remove();});};

 function editorLinksHTML(cell){const ids=legacyCellIds(cell);return ids.length?`<div class="editor-cell-materials">${ids.map(id=>cellSourceChip(cell,id,(t._pendingMaterials||[]).find(m=>m.id===id)||findMaterial(id))).join('')}</div>`:'';}
 function editorLinksHeight(cell){return legacyCellIds(cell).length?34:0;}
 function sizeEditorSurface(met){const full=dialog.closest('.modal-overlay').classList.contains('table-fullscreen'),grid=$('#table-grid');grid.style.height=full?'':Math.min(Math.max(92,met.heights.reduce((a,b)=>a+b,0)+34),innerHeight-205)+'px';}
 function editorLayout(){
  const min=fitTableWords({...node,w:t.widths.reduce((a,b)=>a+b,0),table:{...t,wordWrap:'words'}}).table.widths;
  const available=Math.max(240,$('#table-grid').clientWidth-44),base=min.map(w=>Math.max(140,w)),total=base.reduce((a,b)=>a+b,0),widths=base.map(w=>w*Math.max(1,available/total)),sum=widths.reduce((a,b)=>a+b,0);
  const met=C.tableMetrics({...node,w:sum,materials:[],table:{...t,widths,autoSize:true,wordWrap:'words'}});return {widths,sum,met};
 }
 function refreshMetrics(){const {met,widths,sum}=editorLayout();sizeEditorSurface(met);const table=$('#table-grid table');table.style.width=(sum+40)+'px';$$('#table-grid colgroup col').slice(1).forEach((col,i)=>col.style.width=widths[i]+'px');
  $$('#table-grid tbody>tr').forEach((el,r)=>el.style.height=met.heights[r]+'px');
  $$('[data-cell]').forEach(el=>{const [r,c]=el.dataset.cell.split(',').map(Number),cell=t.cells[r]?.[c];if(cell)el.style.height=Math.max(1,met.heights.slice(r,r+(cell.rowspan||1)).reduce((a,b)=>a+b,0)-1-editorLinksHeight(cell))+'px';});
 }

 function renderCellLinks(){
  const panel=$('#cell-link-editor'),cell=t.cells[a.r]?.[a.c];if(!cell)return;
  const all=[...S.project.materials,...(t._pendingMaterials||[])],ids=legacyCellIds(cell),sourcesExpanded=panel.querySelector('.attached-sources')?.open;
  const existing=ids.length?`<details class="attached-sources" ${sourcesExpanded?'open':''}><summary>Источники ячейки · ${ids.length}</summary>${ids.map(id=>{const m=all.find(x=>x.id===id),op=cell.sourceOptions?.[id]||{};return `<div class="source-setting">${fileIcon(m)}<span title="${esc(m?.title||'')}">${esc(sourceFileName(m))}</span><button data-remove-cell-link="${esc(id)}" title="Убрать источник" class="ribbon-icon">×</button><select data-source-display="${esc(id)}" aria-label="Вид источника"><option value="icon" ${!op.display||op.display==='icon'?'selected':''}>Только значок</option><option value="auto" ${op.display==='auto'?'selected':''}>Название файла</option><option value="custom" ${op.display==='custom'?'selected':''}>Своё название</option></select>${op.display==='custom'?`<input data-source-label="${esc(id)}" value="${esc(op.label||'')}" placeholder="Название" aria-label="Своё название источника">`:''}</div>`;}).join('')}</details>`:'';
  panel.innerHTML=`<div class="link-popover-head"><strong>${linkMode?'Источник':'Добавить ссылку'}</strong><button id="cell-links-close" class="ribbon-icon" aria-label="Закрыть">×</button></div>`+
   (linkMode?`<div class="link-mode-tabs"><button id="cell-link-inline" class="${linkMode==='inline'?'active':''}">В текст</button><button id="cell-link-attach" class="${linkMode==='attach'?'active':''}">К ячейке</button></div><div class="link-source-tabs"><button data-link-source="registry" class="${linkSource==='registry'?'active':''}">Из реестра</button><button data-link-source="address" class="${linkSource==='address'?'active':''}">По адресу</button></div>${linkSource==='registry'?`<select id="cell-link-select" aria-label="Источник"><option value="">Выберите источник</option>${all.map(m=>`<option value="${esc(m.id)}">${esc(sourceFileName(m))}</option>`).join('')}</select>`:`<input id="cell-link-url" placeholder="https://… или materials/file.pdf" aria-label="Адрес источника"><input id="cell-link-name" placeholder="Название источника (необязательно)" aria-label="Название источника">`}${linkMode==='inline'?'<input id="cell-link-label" placeholder="Текст ссылки (по выделению или названию)" aria-label="Текст ссылки">':`<label class="field">Отображение<select id="cell-link-display"><option value="icon">Только значок</option><option value="auto">Название файла</option><option value="custom">Своё название</option></select></label><input id="cell-link-label" placeholder="Своё название" aria-label="Название прикрепления" hidden>`}<button id="cell-link-submit" class="primary">${linkMode==='inline'?'Вставить в текст':'Прикрепить к ячейке'}</button>`:
   `<button id="cell-link-inline" class="link-intent">${uiIcon('text')}<span>Вставить в текст<small>На месте курсора или выделения</small></span></button><button id="cell-link-attach" class="link-intent">${uiIcon('registry')}<span>Прикрепить к ячейке<small>Значок источника под текстом</small></span></button>`)+existing;
  const anchor=$('#cell-links-toggle').getBoundingClientRect();panel.style.left=Math.max(10,Math.min(innerWidth-350,anchor.left))+'px';const top=Math.min(anchor.bottom+6,innerHeight-240);panel.style.top=top+'px';panel.style.maxHeight=(innerHeight-top-12)+'px';
  $('#cell-links-close').onclick=()=>panel.hidden=true;
  $('#cell-link-inline').onclick=()=>{linkMode='inline';renderCellLinks()};$('#cell-link-attach').onclick=()=>{linkMode='attach';renderCellLinks()};
  for(const bt of $$('[data-link-source]',panel))bt.onclick=()=>{linkSource=bt.dataset.linkSource;renderCellLinks()};
  if($('#cell-link-display'))$('#cell-link-display').onchange=e=>$('#cell-link-label').hidden=e.target.value!=='custom';
  const submit=$('#cell-link-submit');if(submit)submit.onclick=()=>{
   let material;if(linkSource==='registry'){material=all.find(m=>m.id===$('#cell-link-select').value);if(!material)return toast('Выберите источник');}
   else{const address=$('#cell-link-url').value.trim();if(!httpURL(address)&&!validRelative(address))return toast('Укажите HTTP(S)-адрес или относительный путь к файлу');const title=$('#cell-link-name').value.trim()||sourceFileName({path:address});material={id:C.uid('m'),title,kind:inferMaterialKind(address),...(httpURL(address)?{url:httpURL(address)}:{path:address}),version:1};}
   const caption=$('#cell-link-label').value.trim(),display=$('#cell-link-display')?.value||'icon';
   sync();remember();if(!all.some(m=>m.id===material.id))t._pendingMaterials=[...(t._pendingMaterials||[]),material];
   if(linkMode==='inline')insertInlineData(material.id,caption||sourceFileName(material),!!caption);
   else mapSelection(c=>{c.materials=[...new Set([...(c.materials||[]),c.material,material.id].filter(Boolean))];delete c.material;c.sourceOptions={...c.sourceOptions,[material.id]:{display,label:caption}};});
   panel.hidden=true;draw();
  };
  for(const btn of $$('[data-remove-cell-link]',panel))btn.onclick=()=>{const id=btn.dataset.removeCellLink;operate(()=>mapSelection(c=>{c.materials=legacyCellIds(c).filter(x=>x!==id);delete c.material;if(c.sourceOptions)delete c.sourceOptions[id];}));renderCellLinks();};
  for(const control of $$('[data-source-display],[data-source-label]',panel))control.onchange=()=>{const id=control.dataset.sourceDisplay||control.dataset.sourceLabel;operate(()=>{cell.sourceOptions={...cell.sourceOptions,[id]:{...cell.sourceOptions?.[id],[control.dataset.sourceDisplay?'display':'label']:control.value}};});renderCellLinks();};
 }

 function insertInlineData(id,title,preferTitle=false){const cell=t.cells[a.r]?.[a.c];if(!cell)return;const el=$(`[data-cell="${a.r},${a.c}"]`);if(!el)return;const range=inlineRange&&el.contains(inlineRange.commonAncestorContainer)?inlineRange.cloneRange():document.createRange();if(!inlineRange||!el.contains(range.commonAncestorContainer)){range.selectNodeContents(el);range.collapse(false);}const selected=range.toString(),link=document.createElement('a');link.setAttribute('data-open-material',id);link.href='#material';link.className='inline-material';link.textContent=preferTitle?title:selected||title;range.deleteContents();range.insertNode(link);range.setStartAfter(link);range.collapse(true);inlineRange=range.cloneRange();cell.text=el.innerText;cell.html=cleanHTML(el.innerHTML);}
 function insertInline(id,title){sync();remember();insertInlineData(id,title);draw();}
 $('#editor-word-wrap').onchange=e=>{const value=e.target.value;operate(()=>t.wordWrap=value);};
 $('#editor-auto-size').onchange=e=>{const value=e.target.checked;operate(()=>C.setTableAutoSize({...node,w:t.widths.reduce((a,b)=>a+b,0),table:t},value));};
 $('#cell-links-toggle').onpointerdown=e=>{e.preventDefault();rememberRange();};$('#cell-links-toggle').onclick=()=>{for(const m of $$('.ribbon-menu'))m.open=false;const p=$('#cell-link-editor');p.hidden=!p.hidden;if(!p.hidden){linkMode=null;renderCellLinks();}};
 $('#table-cancel').onclick=closeModal;
 $('#table-save').onclick=()=>{sync();C.validateTable(t);const real=page().nodes.find(n=>n.id===node.id);if(!real)return toast('Блок отсутствует');
  const rows=new Set(t.rowIds),deletedPorts=new Set((real.ports||[]).filter(p=>p.rowId&&!rows.has(p.rowId)).map(p=>p.id));const removed=page().edges.filter(e=>e.source===node.id&&deletedPorts.has(e.sourcePort)||e.target===node.id&&deletedPorts.has(e.targetPort));
  if(removed.length&&!window.confirm(`Удалённые строки имели ${removed.length} связей. Применить таблицу и удалить эти связи? Другие связи сохранятся.`))return;
  closeModal();change(()=>{for(const m of t._pendingMaterials||[])if(!S.project.materials.some(x=>x.id===m.id))S.project.materials.push(m);delete t._pendingMaterials;real.table=t;real.w=t.widths.reduce((a,b)=>a+b,0);real.ports=real.ports.filter(p=>!deletedPorts.has(p.id));C.initTable(real);real.h=C.tableMetrics(real).total;const ids=new Set(removed.map(e=>e.id));page().edges=page().edges.filter(e=>!ids.has(e.id));});
 };draw();
 const resizeEditor=new ResizeObserver(()=>{if(!$('#table-grid'))return;requestAnimationFrame(()=>{if($('#table-grid')){sync();refreshMetrics();}});});resizeEditor.observe(dialog);const oldDisconnect=observer.disconnect.bind(observer);observer.disconnect=()=>{resizeEditor.disconnect();oldDisconnect();};
}
function projectMenu(){
 modal('Документ',`<div class="menu-sections"><h3>Открыть и сохранить</h3><div class="grid2">${button('home','К стартовому экрану и недавним документам','Документы Studio')}${button('open-document','Открыть HTML или JSON','Открыть документ')}${S.readOnly?'':button('save-document','Обновить выбранный файл HTML','Сохранить HTML')}${S.readOnly?'':button('save-as','Сохранить под новым именем','Сохранить как…')}${button('download-html','Создать HTML со ссылками на файлы','Скачать HTML документа')}${button('export-json','Только данные, без кода программы','Сохранить данные JSON')}</div><h3>Материалы</h3><div class="grid2">${button('bind-folder','Выбрать папку с документом и материалами','Подключить папку')}${button('registry','Единый реестр ссылок','Реестр материалов')}${S.readOnly?'':button('externalize','Перенести вложения старого формата из браузерного хранилища в папку materials','Вынести встроенные файлы')}${button('backup-json','Резервный JSON со старыми вложениями (по желанию)','Резервный JSON')}</div>${S.readOnly?'':`<h3>Редактирование</h3><div class="grid2">${button('rename-project','Переименовать документ','Название документа')}${button('rename-page','Переименовать страницу','Название страницы')}${button('layout','Автоматически расставить блоки','Автораскладка')}${button('draw-settings','Цвет, толщина и привязка рисунка','Рисование')}${button('groups','Необязательные организационные группы','Подпроцессы / метки')}${button('print','Печать с цветными эмодзи','PDF / печать')}</div>`}<div class="notice">Studio не содержит рабочие схемы. HTML документа содержит данные и просмотрщик, но не видео / PDF. Для переноса выдавайте папку проекта целиком или используйте доступные коллегам HTTP-адреса.</div></div>`,'',true);
 $$('[data-action]',$('.modal')).forEach(b=>b.onclick=()=>{const cmd=b.dataset.action;if(!['save-document','save-as','externalize'].includes(cmd))closeModal();action(cmd).catch(err=>toast(err.message,8500));});
}
function help(){modal('Как работать в Studio '+RELEASE,`<div class="help-grid"><section><h3>Программа и документы</h3><p>Pipeline-Studio.html — пустая среда с домашним экраном. Откройте свой HTML / JSON, работайте и нажмите «Сохранить HTML». HTML документа при прямом открытии работает как просмотрщик. Чтобы его редактировать, откройте его через Studio.</p><p>Недавние документы — браузерные черновики. Кнопка «Файл…» читает оригинал, когда браузер сохранил доступ. При отсутствии разрешения выберите файл снова. Автосохранение не переписывает HTML на диске.</p><h3>Материалы в папках</h3><p>Путь materials/video.mp4 отсчитывается от папки HTML документа. Выбирайте папку проекта, чтобы Studio получила доступ к файлам. Одноимённые файлы не переименовываются и не копируются автоматически. Видео не кодируется в HTML; лимита 150 МБ на внешние материалы нет.</p><p>PDF и видео отображает браузер. Word / презентации требуют отдельного PDF-превью для просмотра в окне. Публичные облачные конвертеры не используются.</p></section><section><h3>Цепочки</h3><p>В свойствах любого блока включите «Сворачивать цепочку». Кнопка ⊞ / ⊟ на нём скрывает следующие блоки по связям. Общий этап не скрывается, пока к нему есть путь от другой открытой ветки. Примечание по умолчанию считается сопроводительным элементом подключённого шага и не создаёт отдельный вход. При необходимости включите «Это самостоятельный шаг процесса». В свойствах связи можно отключить «Учитывать в цепочке».</p><p>«Граница» сохраняет блок видимым при сворачивании предшественника. Подпроцессы теперь служат необязательными метками, а не обязательными областями для сворачивания.</p><h3>Соединения и гребёнки</h3><p>Щёлкните плюс первого порта, затем плюс второго; протягивание тоже работает. Для таблицы включайте порты заголовка и строк независимо. Гребёнка объединяет выбранные через Shift связи, в том числе без общего порта; логические пары сохраняются. Общую линию можно двигать за маркер на пересечении. «Добавить ветвь» позволяет последовательно выбирать новые порты; Esc завершает добавление.</p></section><section><h3>Точная правка</h3><p>Shift + перетаскивание — строго по одной оси. Shift + щелчок — выделение нескольких объектов. Режимы привязки находятся внизу справа: края, центры, порты и сетка. Alt временно отключает привязки. Кнопка цепочки включает перенос потомков. Фиксация запрещает случайное перемещение / изменение размера блока; текст остаётся редактируемым.</p><p>Выберите блок и тяните саму картинку внутри него. «Редактировать картинки» показывает рамку изменения размера. Эмодзи остаются частью текста. Их размер и смещение можно задавать числами.</p><h3>Клавиши</h3><p>Ctrl+Z — отмена, Ctrl+Y / Ctrl+Shift+Z — повтор, в том числе с русской раскладкой. Ctrl+S — сохранить документ; Ctrl+Shift+S — сохранить как. Стрелки — 1 px, Shift + стрелки — 10 px. Esc — отменить соединение / закрыть окно.</p><p>Двойной щелчок по ячейке редактирует текст прямо на схеме; Ctrl+Enter применяет правку, Esc отменяет. У выбранной таблицы тяните границы строк и столбцов; кнопки над ней добавляют строку, столбец или открывают продвинутый редактор. В его заголовке есть кнопка полного экрана. В таблице задаются ширины столбцов и высоты строк. Значение высоты 0 подбирает её по содержимому. При ручной малой высоте текст может быть обрезан. Объединённая ячейка занимает сумму размеров её строк / столбцов.</p></section></div>`);}
async function openServerDocument(){S.server=true;const session=await request('/api/session');S.role=session.role;if(!session.role)return login();return loadServer();}
async function loadServer(){
 if(S.pub){const p=await request('/api/published/'+encodeURIComponent(S.pub));await activateDocument(p,{server:true,readOnly:true,name:'Опубликованная версия',direct:true});return;}
 if(S.role==='reader'){const list=await request('/api/publications');$('#app').innerHTML='<div class="login"><h1>Опубликованные процессы</h1>'+list.map(p=>`<a style="display:block;padding:14px" href="/?view=${encodeURIComponent(p.id)}">${esc(p.title)}</a>`).join('')+'</div>';return;}
 const p=await request('/api/project');await activateDocument(p,{name:'Серверный черновик',key:'server-draft',server:true});
}
async function init(){
 try{try{await idbOpen();}catch{S.volatile=true;}
  S.editModes={...S.editModes,...await dbGet('editing-modes-v5')};S.serverAvailable=!!window.STUDIO_SERVER;S.pub=S.serverAvailable?new URLSearchParams(location.search).get('view'):null;
  const data=$('script#pipeline-document[type="application/json"]');
  if(data){await activateDocument(JSON.parse(data.textContent),{name:decodeURIComponent(location.pathname.split('/').at(-1)),readOnly:true,direct:true});return;}
  if(window.STUDIO_DOCUMENT&&window.SEED){await activateDocument(window.SEED,{readOnly:true,direct:true});return;}
  if(S.pub){S.server=true;const s=await request('/api/session');S.role=s.role;if(!s.role)return login();return loadServer();}
  await home();
 }catch(e){$('#app').innerHTML=`<div class="login"><h1>Не удалось открыть документ</h1><p>${esc(e.message)}</p><button id="boot-home">Вернуться в Studio</button></div>`;$('#boot-home').onclick=()=>home().catch(console.error);console.error(e);}
}
/* Print and framing use the same shared-bus geometry as the interactive scene. */
function sceneBounds(p,d){
 const rects=[...d.nodes],routes=C.bundleRoutes(d);for(const ep of [...routes.routes.values(),...routes.buses.flatMap(b=>[b.lead,b.trunk])])for(const pt of ep.points||[])rects.push({x:pt.x-4,y:pt.y-4,w:8,h:8});
 for(const n of d.nodes)for(const ic of n.icons||[])rects.push({x:n.x+(ic.x??0),y:n.y+(ic.y??0),w:ic.w||36,h:ic.h||36});
 for(const stroke of p.drawings||[]){if(stroke.legacy&&(S.compact||(S.collapsed[p.id]?.size||0)>0))continue;const host=stroke.anchor?d.nodes.find(n=>n.id===stroke.anchor):null;if(stroke.anchor&&!host)continue;for(const pt of stroke.points||[])rects.push({x:pt.x+(host?.x||0)-4,y:pt.y+(host?.y||0)-4,w:8,h:8});}return C.bounds(rects);
}
function preparePrint(mode='visible'){
 if(mode==='detail'&&selected())return legacyPreparePrint(mode);
 $$('.print-area').forEach(el=>el.remove());const area=document.createElement('div');area.className='print-area';document.body.append(area);
 const pages=mode==='pages'?S.project.pages:[page()];pages.forEach((p,i)=>{
  const folds=S.collapsed[p.id]||new Set(p.nodes.filter(n=>n.collapsible).map(n=>n.id)),d=C.display(p,folds,S.compact,S.folded),b=sceneBounds(p,d),w=1450,h=900,z=Math.min(w/(b.w+50),h/(b.h+50),1.4),bundle=C.bundleRoutes(d),marker='print-arrow-'+i;
  const draw=(ep,arrow=false,dashed=false)=>`<path d="${ep.d}" fill="none" stroke="#96a3ba" stroke-width="1.8" ${dashed?'stroke-dasharray="6 4"':''} ${arrow?`marker-end="url(#${marker})"`:''}/>`;
  const svg=`<svg style="position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible"><defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#96a3ba"/></marker></defs>${bundle.buses.map(bus=>draw(bus.lead,bus.arrow,bus.dashed)+draw(bus.trunk,false,bus.dashed)+(bus.segments||[]).map(s=>draw(s,s.arrow,bus.dashed)).join('')).join('')}${d.edges.map(e=>{const ep=bundle.routes.get(e.id);return ep?(ep.paint===false?'':draw(ep,e.arrow&&!ep.busIncoming,e.dashed))+edgeLabelHTML(e,ep):'';}).join('')}</svg>`;
  const previous=S.display;S.display=d;const ink=`<svg style="position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible"><defs><marker id="print-ink-${i}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>`+(p.drawings||[]).filter(st=>!st.legacy||(!S.compact&&folds.size===0)).map(st=>strokeHTML(st,true).replaceAll('url(#ink-arrow)',`url(#print-ink-${i})`)).join('')+'</svg>';S.display=previous;
  const section=document.createElement('section');section.className='print-sheet';section.innerHTML=`<h1>${esc(S.project.title)}</h1><h2>${esc(p.title)}</h2><div class="diagram-print" style="width:${w}px;height:${Math.min(h,(b.h+50)*z)}px"><div style="position:absolute;transform-origin:0 0;transform:scale(${z}) translate(${25-b.x}px,${25-b.y}px)">${svg}${d.nodes.map(n=>nodeHTML(n,true)).join('')}${ink}</div></div><div class="print-legend">Pipeline Studio ${RELEASE} · ${d.nodes.length} видимых блоков · Материалы остаются интерактивными в HTML</div>`;area.append(section);
 });return area;
}
async function folderMaterialPicker(attachNodeId=null,replaceId=null){
 if(S.readOnly)return;if(!DOC.root&&!DOC.files.size){await bindFolder();if(!DOC.root&&!DOC.files.size)return;}
 if(DOC.root&&await DOC.root.queryPermission({mode:'read'})!=='granted'&&await DOC.root.requestPermission({mode:'read'})!=='granted')throw Error('Доступ к папке не предоставлен');
 const list=DOC.root?await folderEntries(DOC.root):[...DOC.files].map(([path,file])=>({path,file}));const chosen=new Set();
 modal(replaceId?'Перепривязать к файлу в папке':'Добавить материалы из папки',`<div class="stack"><input id="folder-file-search" placeholder="Название файла или подпапки…"><small>Файлов: ${list.length}. Здесь выбирается точный путь от корневой папки документа. Файлы не копируются.</small><div id="folder-file-list" class="folder-files"></div></div>`,`<small id="folder-selection-count">Выбрано: 0</small><span class="spacer"></span><button id="folder-files-add" class="primary" disabled>${replaceId?'Перепривязать':'Добавить'}</button>`);
 function draw(q=''){const filtered=list.map((x,i)=>({...x,index:i})).filter(x=>x.path.toLowerCase().includes(q.toLowerCase()));$('#folder-file-list').innerHTML=filtered.slice(0,800).map(x=>`<label class="folder-file"><input type="${replaceId?'radio':'checkbox'}" name="folder-file" data-folder-file="${x.index}" ${chosen.has(x.index)?'checked':''}><span>${esc(x.path)}</span></label>`).join('')+(filtered.length>800?'<p class="muted">Показаны первые 800. Уточните поиск.</p>':'');$$('[data-folder-file]').forEach(input=>input.onchange=()=>{if(replaceId)chosen.clear();if(input.checked)chosen.add(+input.dataset.folderFile);else chosen.delete(+input.dataset.folderFile);$('#folder-selection-count').textContent='Выбрано: '+chosen.size;$('#folder-files-add').disabled=!chosen.size;});}
 $('#folder-file-search').oninput=e=>draw(e.target.value);$('#folder-files-add').onclick=caught(async()=>{const indices=[...chosen];if(!indices.length)return;const ids=[];for(const i of indices){const item=list[i],file=item.file||await item.handle.getFile(),existing=!replaceId&&S.project.materials.find(m=>m.path===item.path);ids.push(existing?existing.id:(await uploadFile(file,replaceId,item.path)).id);}if(attachNodeId)change(()=>{const n=page().nodes.find(n=>n.id===attachNodeId);if(n)n.materials=[...new Set([...n.materials,...ids])];});registry(attachNodeId);renderScene();});draw();
}
function arrangeButtons(){return `<div class="arrange-panel"><small>Выравнивание выделенных блоков</small><div class="grid2">${[['left','По левому краю','⇤'],['right','По правому краю','⇥'],['center','Центры по X','↔'],['middle','Центры по Y','↕'],['top','По верхнему краю','⤒'],['bottom','По нижнему краю','⤓']].map(([id,title,icon])=>button('arrange-'+id,title,icon+' '+title)).join('')}</div><small>Равные промежутки между блоками</small><div class="grid2">${button('arrange-horizontal','Равные горизонтальные промежутки','По горизонтали')}${button('arrange-vertical','Равные вертикальные промежутки','По вертикали')}</div><small>Уплотнённый вид фиксируется для ручного размещения. Заблокированные блоки не перемещаются.</small></div>`;}
function v4RouteInspector(edge){if(edge.bus)return '<div class="notice">Связь входит в гребёнку. Настройте общую линию ниже; для независимого маршрута сначала разделите гребёнку.</div>';return legacyRouteInspector(edge);}

/* V4 workspace — icon commands, live snapping, branch transfer, material audit. */
const UI_ICONS={
 home:'<path d="M3 11 12 3l9 8v10h-6v-7H9v7H3z"/>',
 save:'<path d="M5 3h12l4 4v14H3V3z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
 folder:'<path d="M3 6V4h6l3 3h9v13H3z"/><path d="M3 10h18"/>',
 registry:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h8M8 17h5"/>',
 preview:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 edit:'<path d="m4 16-1 5 5-1L20 8l-4-4Z M14 6l4 4"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 pages:'<rect x="7" y="3" width="14" height="15" rx="2"/><path d="M3 7v14h14"/>',
 search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
 magnet:'<path d="M5 3v10a7 7 0 0 0 14 0V3h-5v10a2 2 0 0 1-4 0V3Z M5 7h5m4 0h5"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/>',
 expand:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 12h10M12 7v10"/>',
 collapse:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 12h10"/>',
 chevronRight:'<path d="m9 5 7 7-7 7"/>',chevronLeft:'<path d="m15 5-7 7 7 7"/>',
 zoomIn:'<path d="M5 12h14M12 5v14"/>',zoomOut:'<path d="M5 12h14"/>',
 fit:'<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
 chain:'<rect x="2" y="8" width="6" height="8" rx="1"/><rect x="16" y="8" width="6" height="8" rx="1"/><path d="M8 12h8m-4-3 3 3-3 3"/>',
 undo:'<path d="M4 10h11a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5"/>',redo:'<path d="M20 10H9a6 6 0 0 0 0 12m11-12-5-5m5 5-5 5"/>',
 select:'<path d="m5 3 15 9-8 1-3 8Z"/>',pan:'<path d="M12 2v20M2 12h20m-13-7 3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>',
 block:'<rect x="3" y="6" width="18" height="12" rx="2"/>',decision:'<path d="m12 2 10 10-10 10L2 12Z"/>',text:'<path d="M4 4h16M12 4v17m-5 0h10"/>',
 table:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 18 6-6 4 4 4-7 4 6"/>',
 emoji:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1 3 4 3 4-3 4-3M8 8v2m8-2v2"/>',pen:'<path d="m3 21 2-7L17 2l5 5L10 19Z M15 4l5 5M5 14l5 5"/>',
 line:'<path d="m4 20 16-16"/>',arrow:'<path d="m4 20 16-16M10 4h10v10"/>',rect:'<rect x="4" y="4" width="16" height="16" rx="1"/>',ellipse:'<ellipse cx="12" cy="12" rx="9" ry="8"/>',
 check:'<path d="m4 12 5 5L20 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',bus:'<path d="M3 12h7M10 3v18M10 3h11M10 12h11M10 21h11"/><circle cx="10" cy="12" r="2"/>',
};
function uiIcon(name){return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICONS[name]||UI_ICONS.settings}</svg>`;}
function command(a,icon,title,text='',cls=''){return `<button type="button" data-action="${a}" class="ui-command ${cls}" title="${esc(title)}" aria-label="${esc(title)}">${uiIcon(icon)}${text?`<span class="command-caption">${text}</span>`:''}</button>`;}
Object.assign(S,{editModes:{edges:true,centers:true,ports:false,connections:true,grid:false,gridSize:20,ortho:false,moveChain:false,shared:false},popover:null,guides:[],addingBus:null,materialChecks:new Map()});
function renderShell(){
 $('#app').innerHTML=`<header class="topbar"><button class="brand brand-home" data-action="home" title="Документы Studio" aria-label="Документы Studio"><span class="logo">${uiIcon('chain')}</span><span><strong>Pipeline Studio <span class="version-tag">${RELEASE}</span></strong></span></button><div class="project-head"><strong id="project-title"></strong><div class="project-meta"><button id="page-trigger" class="page-trigger" data-action="pages" title="Страницы документа"></button><span id="save-status" class="save-status"></span></div></div><div id="top-actions" class="row"></div></header><main class="workspace"><section class="center"><div class="canvas-wrap"><div id="stage"><div id="world"><div id="frames"></div><svg id="edges"></svg><svg id="ink"></svg><div id="nodes"></div><svg id="guides"></svg></div></div><div id="tools" class="toolrail"></div><div id="dock" class="zoom-tools" role="toolbar" aria-label="Вид и режимы редактирования"></div><div id="mode-popover" hidden></div><div id="connect-status" class="connect-status" hidden></div></div></section><aside class="right-panel"><header class="inspector-head"><span>Свойства</span></header><div id="inspector" class="rightbar"></div></aside><button id="inspector-toggle" data-action="toggle-right" class="inspector-toggle" title="Скрыть свойства" aria-label="Скрыть свойства"></button></main>`;
 const app=$('#app');app.removeEventListener('click',onAppClick);app.addEventListener('click',onAppClick);app.removeEventListener('change',onChange);app.addEventListener('change',onChange);app.ondragover=null;app.ondrop=null;
 const stage=$('#stage');stage.addEventListener('pointerdown',onPointerDown);stage.addEventListener('wheel',onWheel,{passive:false});stage.addEventListener('dblclick',onDoubleClick);stage.addEventListener('contextmenu',contextMenu);stage.addEventListener('dragover',e=>e.preventDefault());stage.addEventListener('drop',onDrop);
 if(!S.eventsBound){S.eventsBound=true;document.addEventListener('keydown',onKey);document.addEventListener('keyup',e=>{if(e.code==='Space')S.space=false;});
  $('#modal-root').addEventListener('click',e=>{const x=e.target.closest('[data-open-material]');if(x)openMaterial(x.dataset.openMaterial).catch(err=>toast(err.message));});
  window.addEventListener('resize',()=>{if(!S.home&&$('#stage'))renderScene();});window.addEventListener('beforeunload',e=>{if(!S.readOnly&&(S.dirty||S.fileDirty)){e.preventDefault();e.returnValue='';}});
  document.addEventListener('pointerdown',e=>{if(S.popover&&!e.target.closest('#mode-popover,[data-action="align-menu"],[data-action="layout-modes"]'))closePopover();},true);
 }
}
function applyPanelState(){const w=$('.workspace');if(!w)return;w.classList.toggle('hide-right',S.rightHidden);const b=$('#inspector-toggle');b.innerHTML=uiIcon(S.rightHidden?'chevronLeft':'chevronRight');b.title=S.rightHidden?'Показать свойства':'Скрыть свойства';b.setAttribute('aria-label',b.title);b.setAttribute('aria-expanded',String(!S.rightHidden));}
function renderTop(){
 $('#top-actions').innerHTML=(S.locked?'<span class="reader-label">Просмотр</span>':command('preview',S.readOnly?'edit':'preview',S.readOnly?'Вернуться в редактор':'Предпросмотр',S.readOnly?'Редактор':'Просмотр'))+command('registry','registry','Материалы документа',`Материалы <span class="counter">${S.project.materials.length}</span>`)+command('bind-folder','folder','Подключить папку материалов')+'<span class="command-separator"></span>'+(S.readOnly?'':command('save-document','save','Сохранить HTML документа · Ctrl+S','Сохранить','save-command'))+command('menu','more','Документ и экспорт');
 $('#page-trigger').innerHTML=uiIcon('pages')+`<span>${esc(page().title)}</span><span class="page-fraction">${S.pageIndex+1}/${S.project.pages.length}</span>`;
}
function renderLeft(){/* Sidebar intentionally removed; pages/search open on demand. */}
function renderSubbar(){renderDock();}
function renderTools(){v3RenderTools();$$('[data-tool]',$('#tools')).forEach(b=>{b.innerHTML=uiIcon(b.dataset.tool);});$$('[data-action]',$('#tools')).forEach(b=>{b.innerHTML=uiIcon(b.dataset.action==='draw-settings'?'settings':b.dataset.action);});}
function renderDock(){const d=$('#dock');if(!d)return;d.innerHTML=command('pages','pages','Страницы документа')+command('search-dialog','search','Поиск по схеме · Ctrl+F')+'<span class="command-separator"></span>'+(S.readOnly?'':command('align-menu','magnet','Режимы привязки при перетаскивании','',S.popover==='snap'?'is-active':'' )+command('toggle-chain-move','chain','Перемещать блок вместе с последующими','',S.editModes.moveChain?'is-active':''))+command('layout-modes','settings','Раздвижение и уплотнение цепочек','',S.popover==='layout'?'is-active':'')+command('expand-all','expand','Раскрыть все цепочки')+command('collapse-all','collapse','Свернуть все цепочки')+'<span class="command-separator"></span>'+command('zoom-out','zoomOut','Уменьшить')+`<span class="zoom-label" id="zoom-label">${Math.round(S.view.z*100)}%</span>`+command('zoom-in','zoomIn','Увеличить')+command('fit','fit','Вписать видимую схему');if(S.popover)renderPopover();}
function closePopover(){S.popover=null;const el=$('#mode-popover');if(el){el.hidden=true;el.innerHTML='';}$$('#dock .is-active').forEach(el=>{if(el.dataset.action!=='toggle-chain-move')el.classList.remove('is-active');});}
function openPopover(name){S.popover=S.popover===name?null:name;renderDock();if(!S.popover)closePopover();}
function renderPopover(){const el=$('#mode-popover');if(!el)return;const snap=S.popover==='snap';el.hidden=false;el.className='mode-popover';const check=(id,title,checked,desc)=>`<label class="mode-option"><input type="checkbox" id="${id}" ${checked?'checked':''}><span><strong>${title}</strong>${desc?`<small>${desc}</small>`:''}</span></label>`;
 el.innerHTML=`<h3>${uiIcon(snap?'magnet':'settings')}${snap?'Привязки и перемещение':'Размещение цепочек'}</h3>`+(snap?check('mode-edges','К краям блоков',S.editModes.edges,'Направляющие при сближении границ')+check('mode-centers','К центрам блоков',S.editModes.centers,'Общая ось по горизонтали или вертикали')+check('mode-connections','Выпрямлять связанные линии',S.editModes.connections,'Привязка по подключённым портам важнее габаритов блока')+check('mode-ports','К уровням портов',S.editModes.ports,'Совмещать точки соединения')+check('mode-grid','К сетке',S.editModes.grid,'Шаг задаётся ниже')+`<label class="mode-grid-size">Шаг сетки, px <input type="number" id="mode-gridSize" min="2" max="500" value="${S.editModes.gridSize}"></label>`+check('mode-ortho','Постоянный орто-режим',S.editModes.ortho,'Или удерживайте Shift')+check('mode-moveChain','Переносить последующие блоки',S.editModes.moveChain,'Включая скрытые этапы; фиксация сохраняется')+check('mode-shared','Также переносить общие этапы',S.editModes.shared,'Выключено: этапы другой открытой ветки остаются')+`<small class="popover-note">Alt временно отключает привязки. Это режимы перетаскивания, не команды перестроения.</small>`:check('layout-symmetry','Симметрия гребёнок',page().layoutOptions?.busSymmetry===true,'Равные интервалы свёрнутых блоков, ПД по центру. Ручной перенос главной ветви отключает режим.')+`<label class="mode-grid-size">Интервал, px <input id="layout-symmetry-gap" type="number" min="24" max="600" value="${page().layoutOptions?.symmetryGap||64}"></label>`+check('layout-space','Раздвигать цепочки',page().layoutOptions?.autoSpace!==false,'Раскрытая ветка освобождает место для своих блоков')+check('layout-compact','Убирать свободные промежутки',S.compact,'Координаты полного документа не перезаписываются')+`<p class="popover-note">Для свободного размещения отключите симметрию и раздвижение. Зафиксированные блоки не перемещаются автоматически.</p>`);
}
function renderGuides(){const el=$('#guides');if(!el)return;const ns=S.display?.nodes||[];el.innerHTML=(S.guides||[]).map(g=>{const a=ns.find(n=>n.id===g.from),b=ns.find(n=>n.id===g.to);if(!a||!b)return'';const pad=20/S.view.z;return g.axis==='x'?`<line class="snap-guide ${g.kind==='connection'?'connection-guide':''}" x1="${g.value}" x2="${g.value}" y1="${Math.min(a.y,b.y)-pad}" y2="${Math.max(a.y+a.h,b.y+b.h)+pad}"/>`:`<line class="snap-guide ${g.kind==='connection'?'connection-guide':''}" y1="${g.value}" y2="${g.value}" x1="${Math.min(a.x,b.x)-pad}" x2="${Math.max(a.x+a.w,b.x+b.w)+pad}"/>`;}).join('');}
function highlightMoving(){for(const el of $$('#nodes .node'))el.classList.toggle('chain-moving',S.dragMoving?.has(el.dataset.node)&&!S.selected.has(el.dataset.node));}
function v4HighlightCommonPorts(){
 $$('#nodes .port').forEach(el=>{el.classList.remove('common-port','branch-port');el.removeAttribute('data-port-role');});if(S.readOnly||!S.display)return;
 let candidates=[];const b=page().buses?.find(x=>x.id===(S.addingBus||S.selectedBus));if(b)candidates=[b];else if(S.selectedEdges.size)candidates=C.busCandidates(page(),[...S.selectedEdges]).filter(c=>c.count>=2);
 for(const c of candidates){const n=page().nodes.find(n=>n.id===c.hub);if(!n)continue;for(const el of $$('#nodes .port'))if(el.dataset.owner===c.hub&&C.samePort(n,el.dataset.port,c.port,c.mode==='in'?'left':'right')){el.classList.add('common-port');el.dataset.portRole='common';el.title=(c.mode==='in'?'Общий вход':'Общий выход')+' · '+n.title+' · '+portDescription(n,C.port(n,c.port));}}
 if(b)for(const e of page().edges.filter(e=>e.bus===b.id)){const nid=b.mode==='in'?e.source:e.target,pid=b.mode==='in'?e.sourcePort:e.targetPort,n=page().nodes.find(n=>n.id===nid);for(const el of $$('#nodes .port'))if(el.dataset.owner===nid&&C.samePort(n,el.dataset.port,pid,b.mode==='in'?'right':'left')){el.classList.add('branch-port');el.title=(b.mode==='in'?'Выход ветви':'Вход ветви')+' · '+n.title;}}
}
function busPanel(b){const n=page().nodes.find(n=>n.id===b.hub),edges=page().edges.filter(e=>e.bus===b.id),incoming=b.mode==='in';return `<div class="caps">Гребенчатая связь</div><h2 class="inspector-title">${uiIcon('bus')} Общая линия</h2><div class="common-point-info">${uiIcon(incoming?'collapse':'expand')}<span><small>${incoming?'Общий вход · несколько источников':'Общий выход · несколько назначений'}</small><strong>${esc(n?.title||'Блок не найден')}</strong><small>${esc(portDescription(n,C.port(n,b.port,incoming?'left':'right')))}</small></span></div><p class="muted">Общий порт подсвечен оранжевым. Круглый маркер находится на пересечении подводящей линии и гребёнки.</p><div class="stack">${S.readOnly?'':command('bus-add-branch','chain','Добавить ещё одно ответвление','Добавить ветвь','soft-command')+command('bus-add-existing','bus','Выбрать существующие связи с этим общим портом','Включить существующие')+field('Отступ общей линии, px','bus-offset',b.offset||70,'number')}<div class="branch-list">${edges.map(e=>{const nn=page().nodes.find(n=>n.id===(incoming?e.source:e.target));return `<div><span>${incoming?'→':'←'} ${esc(nn?.title||'')}</span>${S.readOnly?'':`<button class="ui-command" data-unbus="${esc(e.id)}" title="Убрать из гребёнки, сохранив связь">${uiIcon('close')}</button>`}</div>`;}).join('')}</div>${S.readOnly?'':button('dissolve-bus','Разделить на независимые связи','Разделить гребёнку','ghost full')}</div>`;}
function v4RenderInspector(){
 if(S.selectedBus){const b=page().buses?.find(x=>x.id===S.selectedBus);if(b){$('#inspector').innerHTML=busPanel(b);$$('[data-unbus]').forEach(bt=>bt.onclick=()=>change(()=>{const e=page().edges.find(e=>e.id===bt.dataset.unbus);delete e.bus;page().buses=page().buses.filter(b=>page().edges.filter(e=>e.bus===b.id).length>1);if(!page().buses.some(b=>b.id===S.selectedBus)){S.selectedBus=null;for(const x of page().edges)if(x.bus&&!page().buses.some(b=>b.id===x.bus))delete x.bus;}}));highlightCommonPorts();return;}}
 if(S.selectedEdges.size>1){const candidates=C.busCandidates(page(),[...S.selectedEdges]);$('#inspector').innerHTML=`<div class="caps">${S.selectedEdges.size} связи</div><h2 class="inspector-title">Общая точка</h2>${candidates.map(c=>`<div class="common-point-info"><span><small>${c.mode==='in'?'Общий вход':'Общий выход'}</small><strong>${esc(c.title)}</strong></span></div>${command('combine-'+c.mode,'bus','Объединить выбранные связи','Создать гребёнку','soft-command')}`).join('')||'<p class="notice">Выбранные связи не имеют общего порта. Выберите линии с одним источником или одним назначением.</p>'}<p class="muted">Shift + щелчок — добавить связь к выделению. Общий порт отмечен оранжевым.</p>`;highlightCommonPorts();return;}
 if(!S.selected.size&&!S.selectedEdge&&!S.selectedDrawing){$('#inspector').innerHTML=`<div class="empty-inspector"><div class="empty-icon">${uiIcon('select')}</div><h3>Выберите элемент</h3><p class="muted">Параметры блока, таблицы или связи появятся здесь.</p></div><div class="inspector-summary"><strong>${esc(page().title)}</strong><small>${S.display?.nodes.length||0} из ${page().nodes.length} блоков показано · ${page().edges.length} связей</small></div><div class="inspector-hints"><p>${uiIcon('magnet')} Привязки настраиваются внизу справа.</p><p>${uiIcon('chain')} Режим цепочки переносит последующие блоки.</p><p>${uiIcon('expand')} Кнопка на блоке сворачивает его продолжение.</p></div>${S.display?.layoutConflicts?.length?'<div class="notice warn">Есть пересекающиеся зафиксированные блоки. Снимите фиксацию для автоматического раздвижения.</div>':''}`;return;}
 v3RenderInspector();const n=selected();
 if(n?.type==='note'&&!S.readOnly)$('#inspector').insertAdjacentHTML('beforeend',`<div class="node-behavior"><label class="check-row"><input type="checkbox" id="node-flow-entry" ${n.flowNode?'checked':''}> Это самостоятельный шаг процесса</label><small>Выключено: примечание сворачивается вместе с подключённым шагом независимо от направления стрелки. Направление самой стрелки не изменяется.</small></div>`);
 if(S.selectedEdge&&!S.readOnly){const es=[S.selectedEdge];const candidates=C.busCandidates(page(),es);const container=$('#inspector');for(const mode of ['out','in']){const bt=container.querySelector(`[data-action="combine-${mode}"]`),c=candidates.find(c=>c.mode===mode);if(bt){bt.disabled=!c||c.count<2;bt.textContent=c?`${mode==='in'?'Общий вход':'Общий выход'}: ${c.title.slice(0,35)} (${c.count})`:'Нет общей точки';}}
 }
 highlightCommonPorts();
}
function arrangeButtons(){return `<div class="notice">Выравнивание действует при перемещении блоков.${command('align-menu','magnet','Настроить привязки','Режимы привязки')}</div>`;}
function pagesDialog(){modal('Страницы документа',`<div class="stack pages-dialog">${S.project.pages.map((p,i)=>`<button class="page-choice ${i===S.pageIndex?'is-current':''}" data-switch-page="${i}">${uiIcon('pages')}<span><strong>${esc(p.title)}</strong><small>${p.nodes.length} блоков · ${p.edges.length} связей</small></span>${i===S.pageIndex?uiIcon('check'):''}</button>`).join('')}</div>`,S.readOnly?'':`<button id="pages-add">${uiIcon('zoomIn')} Новая страница</button>`,true);
 $$('[data-switch-page]').forEach(b=>b.onclick=()=>{closeModal();S.pageIndex=Number(b.dataset.switchPage);S.selected.clear();S.selectedEdges.clear();S.selectedEdge=S.selectedBus=S.selectedDrawing=null;S.addingBus=S.pendingPort=null;S.search='';render();fit();});if($('#pages-add'))$('#pages-add').onclick=()=>{closeModal();v3Action('new-page');};}
function searchDialog(){modal('Найти в документе',`<input id="quick-search" placeholder="Блок, текст таблицы…" value="${esc(S.search)}"><div id="search-results" class="stack material-list" style="margin-top:14px"></div>`,'',true);
 const draw=q=>{const all=S.project.pages.flatMap((p,i)=>p.nodes.filter(n=>(n.title+' '+(n.table?.cells.flat().filter(Boolean).map(c=>c.text).join(' ')||'')).toLowerCase().includes(q.toLowerCase())).map(n=>({p,i,n})));$('#search-results').innerHTML=all.slice(0,70).map(({p,i,n})=>`<button data-result-page="${i}" data-result-node="${esc(n.id)}"><span>${richText(n.title.slice(0,150))}<small>${esc(p.title)}</small></span></button>`).join('')||'<p class="muted">Ничего не найдено.</p>';$$('[data-result-node]').forEach(b=>b.onclick=()=>{S.pageIndex=Number(b.dataset.resultPage);S.search=q;closeModal();render();focusNode(b.dataset.resultNode);});};$('#quick-search').oninput=e=>draw(e.target.value);draw(S.search);$('#quick-search').focus();}
async function v4Action(a){
 if(a==='align-menu'){openPopover('snap');return;}if(a==='layout-modes'){openPopover('layout');return;}
 if(a==='pages'){closePopover();return pagesDialog();}if(a==='search-dialog'){closePopover();return searchDialog();}
 if(a==='toggle-right'){S.rightHidden=!S.rightHidden;applyPanelState();return;}if(a==='toggle-left')return;
 if(a==='toggle-chain-move'){S.editModes.moveChain=!S.editModes.moveChain;await dbPut('editing-modes-v5',S.editModes);renderDock();toast(S.editModes.moveChain?'Перенос цепочки включён: последующие блоки будут двигаться вместе с выбранным.':'Перенос только выбранных блоков.');return;}
 if(a==='expand-all'||a==='collapse-all'){closePopover();if(!S.readOnly)checkpoint();for(const n of page().nodes)if(n.collapsible){if(a==='expand-all')collapsed().delete(n.id);else collapsed().add(n.id);}S.selectedEdge=S.selectedBus=null;S.selectedEdges.clear();render();if(!S.readOnly)changed();return;}
 if(a==='bus-add-branch'){if(S.readOnly)return;const b=page().buses.find(b=>b.id===S.selectedBus);if(!b)return;S.addingBus=b.id;S.pendingPort={node:b.hub,port:b.port};renderScene();return;}
 if(a==='bus-add-existing'){if(S.readOnly)return;return busExistingDialog();}
 if(a==='check-materials')return materialCheckDialog();
 if(a==='home'||a==='preview'||a==='menu')closePopover();
 return v3Action(a);
}
function v4OnChange(e){const id=e.target.id;
 if(id.startsWith('mode-')){const key=id.slice(5);if(Object.hasOwn(S.editModes,key)){S.editModes[key]=key==='gridSize'?Math.max(2,Math.min(500,Number(e.target.value)||20)):e.target.checked;dbPut('editing-modes-v5',S.editModes).catch(()=>{});renderDock();transform();}return;}
 if(id==='layout-space'||id==='layout-compact'){const apply=()=>{if(id==='layout-space'){page().layoutOptions={...page().layoutOptions,autoSpace:e.target.checked};}else S.compact=e.target.checked;};if(S.readOnly){apply();render();}else change(apply);return;}
 if(id==='node-flow-entry'&&selected()&&!S.readOnly){const n=selected();change(()=>n.flowNode=e.target.checked);return;}
 return v3OnChange(e);
}
function v4ChoosePort(node,port){
 if(!S.addingBus)return v3ChoosePort(node,port);
 const b=page().buses.find(x=>x.id===S.addingBus);if(!b||S.readOnly){S.addingBus=null;S.pendingPort=null;return;}
 if(node===b.hub){toast('Выберите порт другого блока; общий порт уже задан.');return;}
 const incoming=b.mode==='in',source=incoming?node:b.hub,target=incoming?b.hub:node,sourcePort=incoming?port:b.port,targetPort=incoming?b.port:port;
 const existing=page().edges.find(e=>e.source===source&&e.target===target&&C.samePort(page().nodes.find(n=>n.id===source),e.sourcePort,sourcePort)&&C.samePort(page().nodes.find(n=>n.id===target),e.targetPort,targetPort));
 change(()=>{if(existing)existing.bus=b.id;else page().edges.push({id:C.uid('edge'),source,sourcePort,target,targetPort,arrow:true,label:'',dashed:false,bus:b.id});S.selectedBus=b.id;S.selectedEdge=null;S.selectedEdges.clear();S.selected.clear();});
 S.pendingPort={node:b.hub,port:b.port};highlightCommonPorts();updateConnectStatus();toast('Ветвь добавлена. Выберите следующий порт или нажмите Esc.');
}
function v4UpdateConnectStatus(){const el=$('#connect-status');if(!el)return;el.hidden=!S.pendingPort;if(!S.pendingPort)return;const n=page().nodes.find(n=>n.id===S.pendingPort.node),b=page().buses?.find(b=>b.id===S.addingBus);el.textContent=b?(b.mode==='in'?'Общий вход: ':'Общий выход: ')+(n?.title||'')+' · выберите порт новой ветви. Можно добавить несколько. Esc — закончить.':'Начало связи: '+(n?.title||'')+' → выберите порт назначения. Esc — отмена.';}
function v4BusExistingDialog(){const b=page().buses.find(b=>b.id===S.selectedBus);if(!b)return;const incoming=b.mode==='in',key=incoming?'target':'source',pk=incoming?'targetPort':'sourcePort',hub=page().nodes.find(n=>n.id===b.hub);const list=page().edges.filter(e=>e.bus!==b.id&&e[key]===b.hub&&C.samePort(hub,e[pk],b.port,incoming?'left':'right'));
 modal('Добавить связи в гребёнку',`<p class="muted">${incoming?'Общий вход':'Общий выход'}: ${esc(hub.title)}. Направления связей сохраняются.</p><div class="stack">${list.map(e=>`<label class="check-row"><input type="checkbox" data-join-edge="${esc(e.id)}" checked><span>${esc(page().nodes.find(n=>n.id===(incoming?e.source:e.target))?.title||'')} ${e.bus?'· перенести из другой гребёнки':''}</span></label>`).join('')||'<p>Других связей с этим общим портом нет. Используйте «Добавить ветвь».</p>'}</div>`,`<button id="join-existing" class="primary" ${list.length?'':'disabled'}>Добавить выбранные</button>`,true);
 $('#join-existing').onclick=()=>{const ids=$$('[data-join-edge]:checked').map(x=>x.dataset.joinEdge);const p=C.joinBus(page(),b.id,ids);closeModal();change(()=>S.project.pages[S.pageIndex]=p);};}
function v4OnKey(e){if(e.key==='Escape'){S.addingBus=null;S.pendingPort=null;S.guides=[];if(S.popover){closePopover();return;}}if((e.ctrlKey||e.metaKey)&&e.code==='KeyF'&&!S.home&&!e.target.closest?.('input,textarea,[contenteditable=true]')&&!currentModal){e.preventDefault();return searchDialog();}return v3OnKey(e);}
/* Material audit deliberately bypasses preview/object-URL caches. An unknown network
 * result (CORS/auth/timeout) must never be labelled as a missing file. No proxy upload. */
async function checkHTTP(url,{timeout=7000,signal}={}){
 const u=httpURL(url);if(!u)return {state:'invalid',detail:'Некорректный HTTP(S)-адрес'};
 const ctrl=new AbortController(),abort=()=>ctrl.abort(),timer=setTimeout(()=>ctrl.abort(),timeout);signal?.addEventListener('abort',abort,{once:true});
 try{const r=await fetch(u,{method:'HEAD',mode:'cors',credentials:new URL(u).origin===location.origin?'same-origin':'omit',redirect:'manual',referrerPolicy:'no-referrer',cache:'no-store',signal:ctrl.signal});
  if(r.type==='opaque'||r.type==='opaqueredirect'||!r.status)return {state:'unknown',detail:'Скрытый ответ или перенаправление: браузер не раскрывает результат'};
  if(r.status===401||r.status===403)return {state:'denied',detail:'Сервер требует авторизацию / доступ: HTTP '+r.status};
  if(r.status===404||r.status===410)return {state:'missing',detail:'Сервер сообщил отсутствие: HTTP '+r.status};
  if(r.status>=300&&r.status<400)return {state:'unknown',detail:'Перенаправление HTTP '+r.status+' — проверьте конечный адрес'};
  if(r.status===405||r.status===501)return {state:'unknown',detail:'Сервер не поддерживает проверку HEAD'};
  if(r.ok)return {state:'ok',detail:'Ресурс доступен: HTTP '+r.status+' (содержимое не скачивалось)'};
  return {state:'unknown',detail:'Ответ сервера HTTP '+r.status};
 }catch(e){return {state:signal?.aborted?'cancelled':'unknown',detail:signal?.aborted?'Проверка остановлена':e.name==='AbortError'?'Истекло время ожидания':'Нельзя подтвердить из браузера: CORS, сеть или политика доступа'};}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function checkMaterial(m,preview=false,{network=true,signal}={}){
 const result={id:m.id,preview,title:m.title,source:preview?(m.previewPath||m.previewURL||m.previewAsset||m.previewMaterial||''):(m.path||m.url||m.asset||''),checkedAt:new Date().toISOString()};
 const finish=(state,detail)=>({...result,state,detail});if(signal?.aborted)return finish('cancelled','Проверка остановлена');
 if(!preview&&m.kind==='cell'){const hit=C.cellTarget(S.project,m.target);return finish(hit?'ok':'missing',hit?'Ячейка найдена в таблице':'Целевая ячейка удалена или отсутствует');}
 if(!preview&&(m.kind==='page'||m.url?.startsWith('data:page/id,'))){const id=(m.url||'').split(',')[1];return finish(S.project.pages.some(p=>p.id===id)?'ok':'missing',S.project.pages.some(p=>p.id===id)?'Страница есть в документе':'Страница не найдена в документе');}
 if(preview&&m.previewMaterial){const other=mat(m.previewMaterial);return finish(other?'unknown':'missing',other?'Превью ссылается на запись реестра: проверьте её результат отдельно':'Запись материала предпросмотра не найдена');}
 const path=materialPath(m,preview),key=m.id+(preview?':preview':'');
 if(path){if(!validRelative(path))return finish('invalid','Некорректный относительный путь');
  if(DOC.root){try{if(await DOC.root.queryPermission({mode:'read'})!=='granted')return finish('denied','Нет разрешения на чтение выбранной папки');const parts=path.replace(/\\/g,'/').split('/').filter(p=>p&&p!=='.');let dir=DOC.root;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:false});const handle=await dir.getFileHandle(parts.at(-1),{create:false});const file=await handle.getFile();return finish('ok','Файл найден в папке · '+file.size+' байт');}catch(e){return finish(e.name==='NotFoundError'?'missing':e.name==='NotAllowedError'?'denied':'unknown',e.name==='NotFoundError'?'По этому пути файла нет':e.name==='NotAllowedError'?'Нет доступа к папке или файлу':String(e.message||e));}}
  if(DOC.files.size){const file=DOC.files.get(path);if(!file)return finish('missing','Нет в выбранном списке папки; для актуальной проверки выберите папку повторно');try{await file.slice(0,1).arrayBuffer();return finish('snapshot','Доступен в выбранном снимке папки; положение на диске проверяется повторным выбором папки');}catch{return finish('unknown','Выбранный файл уже не читается; подключите папку заново');}}
  if(S.project.materialBaseURL&&network)return {...result,...await checkHTTP(new URL(path.split('/').map(encodeURIComponent).join('/'),S.project.materialBaseURL.replace(/\/?$/,'/')).href,{signal})};
  if(DOC.sessionFiles.has(key))return finish('session','Файл выбран в этой сессии, но его расположение по записанному пути не подтверждено');
  return finish('folder','Подключите папку документа для проверки относительного пути');
 }
 const asset=preview?m.previewAsset:m.asset;if(asset){if(S.server)return {...result,...await checkHTTP(new URL(legacyAssetURL(m,preview),location.href).href,{signal})};const blob=await dbGet('asset:'+asset);return finish(blob?'ok':'missing',blob?'Встроенное вложение найдено в хранилище':'Встроенное вложение отсутствует');}
 const url=preview?m.previewURL:m.url;if(url){if(!network)return finish('skipped','Сетевые адреса не проверялись');return {...result,...await checkHTTP(url,{signal})};}
 return finish('missing','Для материала не задан файл или адрес');
}
async function checkAllMaterials({network=true,signal,onProgress=()=>{}}={}){
 const materials=C.clone(S.project.materials),tasks=materials.flatMap(m=>[{m,preview:false},...(m.previewPath||m.previewURL||m.previewAsset||m.previewMaterial?[{m,preview:true}]:[])]);let cursor=0,done=0;const results=Array(tasks.length);const docKey=DOC.key;
 async function worker(){while(cursor<tasks.length&&!signal?.aborted){const i=cursor++,t=tasks[i];let row;try{row=await checkMaterial(t.m,t.preview,{network,signal});}catch(e){row={id:t.m.id,title:t.m.title,preview:t.preview,state:'unknown',detail:e.message,checkedAt:new Date().toISOString()};}results[i]=row;if(DOC.key===docKey)S.materialChecks.set(t.m.id+(t.preview?':preview':''),row);done++;onProgress(row,done,tasks.length);}}
 await Promise.all(Array.from({length:Math.min(4,tasks.length)},worker));return results.filter(Boolean);
}
const auditNames={ok:'На месте',snapshot:'Снимок папки',session:'Только в сессии',missing:'Не найден',denied:'Нет доступа',unknown:'Не подтверждено',folder:'Нужна папка',skipped:'Не проверялся',cancelled:'Остановлено',invalid:'Ошибка пути'};
function materialCheckDialog(){
 modal('Проверка материалов',`<p class="muted">Проверяется наличие файлов по записанным путям, а не старые открытые копии. Содержимое документов и видео не загружается целиком.</p><div class="audit-controls"><label class="check-row"><input id="audit-network" type="checkbox" checked> Проверять HTTP(S)-адреса запросом HEAD</label><button id="audit-run" class="primary">${uiIcon('check')} Проверить</button><button id="audit-stop" hidden>Остановить</button></div><p id="audit-progress" role="status" class="muted">Папка: ${esc(DOC.folderName||DOC.root?.name||'не выбрана')}. Результаты относятся к моменту проверки.</p><div class="audit-results" id="audit-results"></div><p class="popover-note">Запрет CORS, перенаправление или тайм-аут — это «Не подтверждено», а не «Не найден». При выборе папки без файлового API доступен только снимок списка файлов.</p>`,`<button id="audit-export" disabled>${uiIcon('save')} Сохранить отчёт JSON</button>`);
 let ctrl=null,rows=[];const draw=()=>{$('#audit-results').innerHTML=rows.map((r,i)=>`<div class="audit-row"><span class="audit-state state-${esc(r.state)}">${esc(auditNames[r.state]||r.state)}</span><div><strong>${esc(r.title)}${r.preview?' · PDF-превью':''}</strong><code>${esc(r.source||'')}</code><small>${esc(r.detail)}</small></div>${!S.readOnly?`<button class="ui-command" data-audit-edit="${i}" title="Изменить путь">${uiIcon('edit')}</button>`:''}</div>`).join('');$$('[data-audit-edit]').forEach(bt=>bt.onclick=()=>{ctrl?.abort();editMaterial(rows[Number(bt.dataset.auditEdit)].id);});};
 $('#audit-run').onclick=async()=>{
  const network=$('#audit-network').checked;ctrl=new AbortController();rows=[];$('#audit-run').disabled=true;$('#audit-export').disabled=true;$('#audit-stop').hidden=false;$('#audit-network').disabled=true;
  // Ask once under explicit user action. Checks themselves never request permission repeatedly.
  if(DOC.root)try{if(await DOC.root.queryPermission({mode:'read'})!=='granted')await DOC.root.requestPermission({mode:'read'});}catch{}
  const modalAtStart=currentModal;
  const complete=await checkAllMaterials({network,signal:ctrl.signal,onProgress:(row,done,total)=>{if(currentModal!==modalAtStart){ctrl.abort();return;}rows.push(row);draw();$('#audit-progress').textContent=`Проверено ${done} из ${total}`;}});
  if(currentModal!==modalAtStart)return;rows=complete;draw();const bad=rows.filter(r=>r.state==='missing'||r.state==='invalid').length,ok=rows.filter(r=>r.state==='ok').length;$('#audit-progress').textContent=`${ctrl.signal.aborted?'Остановлено. ':''}Проверено: ${rows.length}. Подтверждено: ${ok}. Не найдено / неверный путь: ${bad}. Остальные результаты требуют внимания.`;$('#audit-run').disabled=false;$('#audit-export').disabled=!rows.length;$('#audit-network').disabled=false;$('#audit-stop').hidden=true;
 };$('#audit-stop').onclick=()=>ctrl?.abort();$('#audit-export').onclick=()=>download(new Blob([JSON.stringify({document:S.project.title,checkedAt:new Date().toISOString(),results:rows},null,2)],{type:'application/json'}),'materials-check.json');
}

/* V5: all bus creation routes edit the same entity; selection is never a graph mutation. */
Object.assign(UI_ICONS,{lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',wire:'<path d="M2 17h4a4 4 0 0 0 4-4V9a4 4 0 0 1 4-4h8"/>',trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',duplicate:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',chevronDown:'<path d="m6 9 6 6 6-6"/>'});
Object.assign(S,{inspectorSections:{},placement:null,addingBusPair:null});
const typeLabels={block:'Этап',decision:'Условие',note:'Примечание',text:'Текст',table:'Таблица',image:'Изображение',ellipse:'Событие'};
function iconSource(ic){return ic.src||assetURL(mat(ic.material))||'';}
function nodeHTML(n,print=false){
 const badgeIds=[...new Set(n.materials||[])].filter(id=>mat(id)),counts={};for(const id of badgeIds){const k=mat(id).kind;counts[k]=(counts[k]||0)+1;}
 const isTable=!!n.table,isDiamond=n.type==='decision',picked=S.selected.has(n.id)&&!print;
 const body=isTable?`<div class="table-title">${label(n)}</div>${S.folded.has(n.id)?'<div class="summary-sub" style="padding:8px">Таблица свёрнута</div>':tableHTML(n)}`:n.type==='image'?`<img class="photo" draggable="false" alt="${esc(n.title)}" src="${esc(assetURL(mat(n.imageMaterial)))}">`:`<div class="node-label" style="text-align:${esc(n.align||'center')};font-weight:${n.bold?'700':'400'};font-style:${n.italic?'italic':'normal'}">${label(n)}</div>`;
 const handles=print||S.readOnly||n._ghost?'':C.visiblePorts(n,page().edges).map(p=>`<span role="button" tabindex="0" class="port ${p.occupied?'occupied':'free'} ${p.rowId?'row-port':''} ${S.pendingPort?.node===n.id&&C.samePort(n,S.pendingPort.port,p.id)?'pending':''}" data-port="${esc(p.id)}" data-owner="${esc(n.id)}" aria-label="${esc(portDescription(n,p))}" title="${esc(portDescription(n,p))} · ${p.occupied?'занят':'свободен'}" style="left:${p.x*n.w-(isDiamond?0:1)}px;top:${p.y*n.h-(isDiamond?0:1)}px">+</span>`).join('')+(!n.locked?`<span class="resize" data-resize="${esc(n.id)}" ${n.autoSize?'hidden':''}></span>`:'');
 const attached=(n.icons||[]).map((ic,i)=>`<span class="icon-object ${picked&&!S.readOnly?'icon-editable':''} ${picked&&S.selectedIcon===i&&S.iconEdit?'icon-picked':''}" data-icon-index="${i}" data-icon-node="${esc(n.id)}" style="left:${ic.x??Math.max(0,n.w-(ic.w||36)-8)}px;top:${ic.y??Math.max(0,n.h-(ic.h||36)-8)}px;width:${ic.w||36}px;height:${ic.h||ic.w||36}px"><img draggable="false" class="attached-icon" src="${esc(iconSource(ic))}" alt="${esc(ic.glyph||'Иконка')}" title="Перетащите иконку; размер — за нижний правый угол">${picked&&S.iconEdit&&!S.readOnly?'<span class="icon-size-grip" data-icon-resize="true"></span>':''}</span>`).join('');
 const badges=!print&&badgeIds.length?`<div class="material-badges ${isTable?'table-material-footer':''}" style="height:${measureSources(n)}px">${sourceSummary(n,badgeIds)}</div>`:'';
 const toggle=!print&&!n._ghost&&n.collapsible?`<button class="collapse-node ${collapsed().has(n.id)?'is-collapsed':''}" data-collapse-node="${esc(n.id)}" title="${collapsed().has(n.id)?'Раскрыть цепочку. При переносе блока скрытая ветвь перемещается вместе с ним':'Свернуть цепочку'}" aria-expanded="${!collapsed().has(n.id)}">${uiIcon(collapsed().has(n.id)?'expand':'collapse')}${n.hiddenCount?`<span>${n.hiddenCount}</span>`:''}</button>`:'';
 const outline=isDiamond?`<svg class="diamond-shape" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,1 99,50 50,99 1,50" fill="${esc(n.fill||'#fff')}" stroke="${esc(n.stroke||'#9aa8bf')}" stroke-width="1.3" vector-effect="non-scaling-stroke"/></svg>`:'';
 const h=n.h;return `<div class="node ${esc(n.type)} ${picked?'selected':''} ${badgeIds.length?'has-materials':''} ${n.locked?'position-locked':''} ${n._ghost?'placement-node':''} ${n.anchorId?'anchored-image':''}" data-node="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${h}px;background:${isDiamond?'transparent':esc(n.fill||'#fff')};border-color:${isDiamond?'transparent':esc(n.stroke||'#9aa8bf')};font-size:${n.fontSize||13}px">${print?'':quickTableTools(n)}${outline}<div class="node-body" ${badgeIds.length&&!isTable&&!isDiamond?`style="padding-bottom:${measureSources(n)}px"`:''}>${body}</div>${attached}${badges}${handles}${toggle}${n.locked&&!print&&!S.readOnly?`<span class="node-lock" title="Положение и размер зафиксированы">${uiIcon('lock')}</span>`:''}</div>`;
}
function segmentGrips(e,p){
 if(S.readOnly||e.proxy||p.bus||e.style==='straight')return '';
 const z=Math.max(.05,S.view.z);return C.routeSegments(p).map(seg=>{
  const selected=S.selectedSegment?.edge===e.id&&S.selectedSegment.index===seg.index,attrs=`data-segment-edge="${esc(e.id)}" data-segment-index="${seg.index}"`;
  return `<path class="segment-hit ${selected?'segment-picked':''}" ${attrs} d="M${seg.a.x},${seg.a.y} L${seg.b.x},${seg.b.y}" style="stroke-width:${selected?4/z:12/z}px"><title>${seg.terminal?'Конечный участок закреплён за портом':'Выбрать участок · Delete — удалить изгиб · тянуть — переместить'}</title></path>`+(!seg.terminal&&seg.length*z>16?`<rect class="segment-grip ${selected?'is-selected':''}" ${attrs} x="${(seg.a.x+seg.b.x)/2-4/z}" y="${(seg.a.y+seg.b.y)/2-4/z}" width="${8/z}" height="${8/z}" rx="${2/z}" style="cursor:${seg.vertical?'ew':'ns'}-resize"/>`:'');
 }).join('');
}
function renderEdges(){
 if(!S.display||!$('#edges'))return;const bundle=C.bundleRoutes(S.display);S.bundle=bundle;
 const defs='<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0L8 4L0 8Z" fill="#96a3ba"/></marker></defs>';
 const draw=(p,selected=false,arrow=false,dashed=false,style='orthogonal')=>`<path class="edge ${selected?'selected':''} ${style==='wire'?'wire-edge':''}" d="${p.d}" ${arrow?'marker-end="url(#arrowhead)"':''} ${dashed?'stroke-dasharray="6 4"':''}/>`;
 let paint='',hits='',grips='';
 for(const b of bundle.buses){const obj=page().buses.find(x=>x.id===b.id),pick=S.selectedBus===b.id||S.display.edges.filter(e=>e.bus===b.id).every(e=>S.selectedEdges.has(e.id));
  paint+=draw(b.lead,pick,b.arrow,b.dashed,obj?.style)+draw(b.trunk,pick,false,b.dashed,obj?.style)+(b.segments||[]).map(p=>draw(p,pick,p.arrow,b.dashed,obj?.style)).join('');
  paint+=b.entries.map(x=>`<circle cx="${x.join.x}" cy="${x.join.y}" r="2.5" fill="${pick?'#555ce9':'#96a3ba'}" pointer-events="none"/>`).join('');
  hits+=`<path class="edge-hit" data-bus="${esc(b.id)}" d="${b.lead.d} ${b.trunk.d}"/>`;
  if(pick&&!S.readOnly)grips+=`<circle class="bus-handle" data-bus-handle="${esc(b.id)}" cx="${b.handle.x}" cy="${b.handle.y}" r="${6/S.view.z}"><title>Переместить общую линию</title></circle>`;
 }
 for(const e of S.display.edges){const p=bundle.routes.get(e.id);if(!p)continue;const picked=S.selectedEdge===e.id||S.selectedEdges.has(e.id),busPicked=e.bus&&S.selectedBus===e.bus;
  if(p.paint!==false)paint+=draw(p,picked||busPicked,e.arrow&&!p.busIncoming,e.dashed,e.style);
  else if(picked)paint+=draw(p,true,false,e.dashed,e.style);
  hits+=`<path class="edge-hit" data-edge="${esc(e.id)}" d="${p.hitD||p.d}"/>`;
  paint+=edgeLabelHTML(e,p);
  if(picked&&!S.readOnly&&!e.proxy&&!p.bus){grips+=segmentGrips(e,p)+(p.controls||[]).map((w,i)=>`<circle class="route-handle" data-route-edge="${esc(e.id)}" data-route-index="${i}" cx="${w.x}" cy="${w.y}" r="${6/Math.max(.3,S.view.z)}"/>`).join('');}
 }
 $('#edges').innerHTML=defs+paint+hits+grips;
}
function section(id,title,content,open=false,icon='settings'){
 const key=(selected()?.type||(S.selectedBus?'bus':'edge'))+':'+id,expanded=S.inspectorSections[key]??open;
 return `<details class="property-section" data-section="${esc(key)}" ${expanded?'open':''}><summary>${uiIcon(icon)}<span>${esc(title)}</span>${uiIcon('chevronDown')}</summary><div class="property-content">${content}</div></details>`;
}
function watchSections(){for(const el of $$('[data-section]',$('#inspector')))el.ontoggle=()=>S.inspectorSections[el.dataset.section]=el.open;}
function iconControls(n){const i=Math.max(0,Math.min(S.selectedIcon,(n.icons||[]).length-1)),ic=n.icons?.[i];
 return `<div class="icon-gallery">${(n.icons||[]).map((x,j)=>`<button data-pick-icon="${j}" class="${j===i?'active':''}" title="Картинка ${j+1}"><img src="${esc(iconSource(x))}" alt="Картинка ${j+1}" draggable="false"></button>`).join('')}</div><div class="property-actions">${command('icon-upload','image','Прикрепить картинку к блоку','Добавить картинку')}</div>${ic?`<div class="property-actions">${command('move-icons','pan','Перемещать и менять размер прикреплённой картинки',S.iconEdit?'Завершить':'Редактировать картинки',S.iconEdit?'active':'')}${command('remove-icon','trash','Удалить выбранную картинку','','danger')}</div><div class="grid2">${field('X','icon-x',Math.round(ic.x??0),'number')}${field('Y','icon-y',Math.round(ic.y??0),'number')}${field('Ширина','icon-width',ic.w||36,'number')}${field('Высота','icon-height',ic.h||ic.w||36,'number')}</div><small>Выберите блок и тяните саму картинку. Она перемещается относительно блока; текст и эмодзи не меняются.</small>`:'<small>Прикрепите картинку и перемещайте её внутри блока. Эмодзи добавляются в текст, в разделе «Содержимое».</small>'}`;
}
function v5MaterialControls(n){const ms=[...new Set(n.materials||[])].map(mat).filter(Boolean);return `${S.readOnly?'':command('attach','registry','Прикрепить материалы к блоку','Прикрепить','property-wide')}<div class="property-materials">${ms.map(m=>`<div class="property-material"><span class="material-symbol">${sign(m.kind)}</span><div><strong>${esc(m.title)}</strong><small>${esc(typeName[m.kind]||m.kind)}</small></div><button class="ui-command" data-open-material="${esc(m.id)}" title="Открыть">${uiIcon('preview')}</button>${S.readOnly?'':`<button class="ui-command" data-detach="${esc(m.id)}" title="Отвязать">${uiIcon('close')}</button>`}</div>`).join('')||'<small>Нет прикреплённых материалов</small>'}</div>`;}
function busPanelV5(b){const es=page().edges.filter(e=>e.bus===b.id),sources=new Set(es.map(e=>e.source)),targets=new Set(es.map(e=>e.target)),common=b.hub?page().nodes.find(n=>n.id===b.hub):null;
 const title=n=>page().nodes.find(x=>x.id===n)?.title||n;
 return `<header class="property-header"><span class="property-emblem">${uiIcon('bus')}</span><div><small>ГРЕБЕНЧАТАЯ СВЯЗЬ</small><strong>${esc(b.title||'Гребёнка')}</strong></div></header><div class="property-subtitle">${es.length} связей · ${sources.size} источн. · ${targets.size} приёмн.</div>`+
 section('bus-members','Подключения',`<div class="notice compact-note">${common?`Общий ${b.mode==='in'?'вход':'выход'}: <b>${esc(common.title)}</b>`:'Общий порт не требуется. Исходные пары связей сохранены.'}</div>${S.readOnly?'':`<div class="property-actions">${command('bus-add-branch','zoomIn','Добавить соединение к гребёнке','Добавить')}${command('bus-add-existing','chain','Включить уже созданные связи','Из существующих')}</div>`}<div class="branch-list">${es.map(e=>`<div><span title="${esc(title(e.source)+' → '+title(e.target))}">${esc(title(e.source))}<b> → </b>${esc(title(e.target))}</span>${S.readOnly?'':`<button class="ui-command" data-unbus="${esc(e.id)}" title="Оставить отдельной связью">${uiIcon('close')}</button>`}</div>`).join('')}</div>`,true,'chain')+
 (S.readOnly?'':section('bus-geometry','Вид и положение',`${b.mode==='free'?`<label class="field">Общая линия<select id="bus-orientation"><option value="vertical" ${b.orientation!=='horizontal'?'selected':''}>Вертикальная</option><option value="horizontal" ${b.orientation==='horizontal'?'selected':''}>Горизонтальная</option></select></label>${field('Координата общей линии','bus-axis',b.axis??Math.round(S.bundle?.buses.find(x=>x.id===b.id)?.axis||0),'number')}`:field('Отступ от общего порта','bus-offset',b.offset||70,'number')}${b.mode!=='free'?`<label class="check-row"><input id="bus-auto-align" type="checkbox" ${b.autoAlign?'checked':''}>Автовыравнивание ветвей</label>${field('Интервал между ветвями, px','bus-align-gap',b.alignGap||64,'number')}<small>Ветви центрируются относительно общего порта.</small>`:''}<label class="field">Отображение<select id="bus-style"><option value="orthogonal">Ортогональное</option><option value="wire" ${b.style==='wire'?'selected':''}>Провод · плавные углы</option></select></label><small>Общую линию можно двигать за круглый маркер на холсте.</small>`,true,'wire')+`<div class="property-footer">${command('dissolve-bus','close','Разделить гребёнку, сохранив связи','Разделить гребёнку')}</div>`);
}
function renderInspector(){
 const panel=$('#inspector');if(!panel||!S.project)return;const scroll=panel.scrollTop;
 if(S.selectedBus){const b=page().buses.find(x=>x.id===S.selectedBus);if(b){panel.innerHTML=busPanelV5(b);for(const bt of $$('[data-unbus]',panel))bt.onclick=()=>change(()=>{delete page().edges.find(e=>e.id===bt.dataset.unbus).bus;C.cleanBuses(page());if(!page().buses.some(x=>x.id===S.selectedBus))S.selectedBus=null;});watchSections();highlightCommonPorts();return;}}
 if(S.selectedEdges.size>1){panel.innerHTML=`<header class="property-header"><span class="property-emblem">${uiIcon('bus')}</span><div><small>ВЫДЕЛЕНИЕ СВЯЗЕЙ</small><strong>${S.selectedEdges.size} соединений</strong></div></header><p class="property-subtitle">Объединение не меняет направления и логические пары.</p>${command('combine-auto','bus','Объединить выбранные связи','Создать гребёнку','property-wide soft-command')}<div class="notice compact-note">Один общий порт не обязателен. Выделяйте связи через Shift + щелчок.</div>`;highlightCommonPorts();return;}
 if(S.selectedEdge){const e=page().edges.find(x=>x.id===S.selectedEdge);if(e){const src=page().nodes.find(n=>n.id===e.source),dst=page().nodes.find(n=>n.id===e.target);
  const portSelect=(id,n,p,fallback)=>`<label class="field">${id==='source'?'Из блока':'В блок'}: ${esc(n.title.slice(0,55))}<select id="edge-${id}-port">${C.ports(n).map(x=>`<option value="${esc(x.id)}" ${x.id===p?'selected':''}>${esc(portDescription(n,x))}</option>`).join('')}</select></label>`;
  panel.innerHTML=`<header class="property-header"><span class="property-emblem">${uiIcon('arrow')}</span><div><small>СВЯЗЬ</small><strong>${esc(e.label||'Соединение блоков')}</strong></div></header>`+section('edge-label','Подпись',field('Текст на линии','edge-label',e.label||'')+behaviorOption('edge-label-centered','По центру сегмента',e.labelCentered!==false,'Подпись располагается вдоль прямого участка связи')+labelSegmentControl(e),true,'text')+(S.readOnly?'':section('edge-view','Оформление',`<label class="field">Вид связи<select id="edge-style"><option value="orthogonal">Ортогональная</option><option value="wire" ${e.style==='wire'?'selected':''}>Провод · плавные углы</option><option value="straight" ${e.style==='straight'?'selected':''}>Прямая</option></select></label><div class="property-toggles"><label class="check-row"><input id="edge-arrow" type="checkbox" ${e.arrow?'checked':''}>Стрелка</label><label class="check-row"><input id="edge-dashed" type="checkbox" ${e.dashed?'checked':''}>Пунктир</label></div>${routeInspector(e)}${!e.bus?command('align-connection','magnet','Переместить конечный блок для прямой линии между подключёнными портами','Выровнять по портам','property-wide'):''}`,true,'wire')+section('edge-ports','Точки подключения',portSelect('source',src,e.sourcePort,'right')+portSelect('target',dst,e.targetPort,'left')+`<label class="check-row"><input id="edge-flow" type="checkbox" ${e.flow!==false?'checked':''}>Учитывать в цепочке</label>`,false,'chain')+section('edge-bus','Гребёнка',e.bus?command('select-bus','bus','Настроить общую линию','Открыть гребёнку','property-wide'):`${command('combine-auto','bus','Объединить выделенные связи','Объединить связи','property-wide')}<small>Выберите ещё одну линию через Shift. Общий порт не обязателен.</small>`,false,'bus')+`<div class="property-footer">${command('delete','trash','Удалить связь','Удалить','danger')}</div>`);watchSections();highlightCommonPorts();return;}}
 const n=selected();if(!n||S.selected.size>1||S.selectedDrawing){v4RenderInspector();return;}
 const editable=!S.readOnly,icons=(n.icons||[]).length;
 let content=`<header class="property-header"><span class="property-emblem">${uiIcon(n.type)}</span><div><small>${esc(typeLabels[n.type]||'Элемент').toUpperCase()}</small><strong>${esc(n.title.split('\n')[0].slice(0,65))}</strong></div>${editable?command('duplicate','duplicate','Дублировать блок'):''}</header>`;
 content+=section('text','Содержимое',editable?`<textarea id="node-title" rows="3" aria-label="Текст блока">${esc(n.title)}</textarea><div class="property-actions">${command('edit-text','text','Расширенный редактор','Текст')}${command('emoji-text','emoji','Добавить эмодзи в текст','Эмодзи')}</div>${n.table?command('table-edit','table','Размеры строк, ячейки и объединения','Редактировать таблицу','property-wide soft-command')+`<label class="check-row"><input type="checkbox" id="table-auto-size" ${n.table.autoSize?'checked':''}>Авторазмер по содержимому</label><small>Высота обновляется по тексту. Целые слова задают минимальную ширину столбца; для узких столбцов включите русские переносы.</small><label class="field">Перенос слов<select id="table-word-wrap"><option value="words" ${n.table.wordWrap!=='hyphenate'?'selected':''}>Только целые слова</option><option value="hyphenate" ${n.table.wordWrap==='hyphenate'?'selected':''}>Русские переносы с дефисом</option></select></label>`:''}`:`<p>${label(n)}</p>`,true,'text');
 if(editable){
  content+=section('appearance','Оформление',`${!n.table&&n.type!=='image'?`<label class="field">Форма<select id="node-type">${['block','decision','note','text','ellipse'].map(t=>`<option value="${t}" ${n.type===t?'selected':''}>${typeLabels[t]}</option>`).join('')}</select></label>`:''}<div class="grid2">${field('Заливка','node-fill',n.fill==='transparent'?'#ffffff':n.fill||'#ffffff','color')}${field('Контур','node-stroke',n.stroke==='transparent'?'#ffffff':n.stroke||'#9aa8bf','color')}</div><div class="grid2">${field('Ширина','node-width',Math.round(S.display?.nodes.find(x=>x.id===n.id)?.w||n.w),'number')}${field('Высота','node-height',Math.round(S.display?.nodes.find(x=>x.id===n.id)?.h||n.h),'number')}</div><div class="grid2">${field('Шрифт','node-font',n.fontSize||13,'number')}<label class="field">Выравнивание<select id="node-align">${['left','center','right'].map((x,i)=>`<option value="${x}" ${(n.align||'center')===x?'selected':''}>${['Слева','По центру','Справа'][i]}</option>`).join('')}</select></label></div><div class="property-actions">${button('bold','Полужирный','<b>B</b>',n.bold?'active':'')}${button('italic','Курсив','<i>I</i>',n.italic?'active':'')}${command('auto-height','fit','Подобрать высоту','По тексту')}</div>`,false,'settings');
  content+=section('behavior','Поведение',`${!n.table&&n.type!=='image'?behaviorOption('node-auto-size','Авторазмер',n.autoSize,'Подбирает размер по тексту; ромб сохраняет пропорции'):''}${behaviorOption('node-relative-lock','Относительное положение',n.relativeLock,'Перемещает все последующие блоки вместе с родителем')}${behaviorOption('node-collapsible','Сворачивать цепочку',n.collapsible,'Позволяет скрывать и раскрывать последующие блоки')}${behaviorOption('node-locked','Зафиксировать блок',n.locked,'Запрещает перемещение и изменение размера; текст можно редактировать')}${behaviorOption('node-collapse-boundary','Граница сворачивания',n.collapseBoundary,'Этот блок остаётся видимым при сворачивании предшествующей цепочки')}${n.type==='note'?behaviorOption('node-flow-entry','Самостоятельный шаг',n.flowNode,'Примечание становится отдельным шагом процесса'):''}`,true,'lock');
  const cfg=n.portConfig||(n.table?{body:['left'],rows:['right']}:{body:['left','right','top','bottom']});
  content+=section('ports','Порты',`<div class="port-legend"><span class="free-dot"></span>Свободен<span class="used-dot"></span>Подключён</div><div class="port-options">${['left','right','top','bottom'].map(side=>`<label class="check-row"><input id="port-body-${side}" type="checkbox" ${(cfg.body||[]).includes(side)?'checked':''}>${portLabels[side]}</label>`).join('')}</div>${n.table?`<label class="field">Порт корпуса<select id="table-body-position"><option value="center">По центру таблицы</option><option value="header" ${n.tableBodyPosition==='header'?'selected':''}>В заголовке</option></select></label><small class="port-caption">Выходы строк</small><div class="port-options">${['left','right'].map(side=>`<label class="check-row"><input id="port-rows-${side}" type="checkbox" ${(cfg.rows||[]).includes(side)?'checked':''}>${portLabels[side]}</label>`).join('')}</div>`:''}`,false,'chain');
  content+=section('icons','Иконки',iconControls(n),S.iconEdit||icons>0,'image');
 }
 content+=section('materials','Материалы',materialControls(n),!!n.materials?.length,'registry');
 if(editable){let extra=`<label class="field">Организационная группа<select id="node-group"><option value="">Без группы</option>${C.hierarchy(page()).flat.map(({group:g,path})=>`<option value="${esc(g.id)}" ${g.members.includes(n.id)?'selected':''}>${esc(path)}</option>`).join('')}</select></label>`;
  if(n.type==='image')extra+=`<label class="field">Привязать изображение<select id="image-anchor"><option value="">Свободное изображение</option>${page().nodes.filter(x=>x.id!==n.id&&!x.anchorId&&x.type!=='image').map(x=>`<option value="${esc(x.id)}" ${n.anchorId===x.id?'selected':''}>${esc(x.title.slice(0,50))}</option>`).join('')}</select></label>`;
  content+=section('advanced','Дополнительно',extra+`<small class="node-id">${esc(n.id)}</small>`,false,'settings')+`<footer class="property-footer">${command('delete','trash','Удалить блок','Удалить блок','danger')}</footer>`;
 }
 panel.innerHTML=content;watchSections();for(const b of $$('[data-pick-icon]',panel))b.onclick=()=>{S.selectedIcon=+b.dataset.pickIcon;S.iconEdit=true;renderInspector();renderScene();};
 if(n.locked||n.autoSize)for(const id of ['node-width','node-height'])if($('#'+id))$('#'+id).disabled=true;
 panel.scrollTop=scroll;highlightCommonPorts();
}
function highlightCommonPorts(){
 for(const el of $$('#nodes .port')){el.classList.remove('common-port','branch-port');el.removeAttribute('data-port-role');}
 if(S.readOnly||!S.display)return;const b=page().buses?.find(x=>x.id===(S.addingBus||S.selectedBus));
 if(!b)return v4HighlightCommonPorts();
 const es=page().edges.filter(e=>e.bus===b.id);
 for(const e of es)for(const [id,pid,role] of [[e.source,e.sourcePort,'source'],[e.target,e.targetPort,'target']]){const n=page().nodes.find(n=>n.id===id);for(const el of $$('#nodes .port'))if(el.dataset.owner===id&&C.samePort(n,el.dataset.port,pid,role==='source'?'right':'left')){const isCommon=b.hub===id&&C.samePort(n,b.port,pid);el.classList.add(isCommon?'common-port':'branch-port');el.dataset.portRole=isCommon?'common':role;el.title=(isCommon?'Общий порт':role==='source'?'Источник':'Приёмник')+' · '+n.title;}}
}
function combineSelected(mode='auto'){
 let ids=[...S.selectedEdges];if(ids.length<2&&S.selectedEdge){const e=page().edges.find(e=>e.id===S.selectedEdge);const candidates=C.busCandidates(page(),[e.id]);const c=candidates.find(c=>c.mode===mode)||candidates.find(c=>c.count>1);
  if(c){const k=c.mode==='in'?'target':'source',pkey=k+'Port',n=page().nodes.find(n=>n.id===c.hub);ids=page().edges.filter(x=>x[k]===c.hub&&C.samePort(n,x[pkey],c.port,c.mode==='in'?'left':'right')).map(x=>x.id);}
 }
 if(ids.length<2)return toast('Выделите минимум две связи через Shift + щелчок. Общий порт не требуется.');
 const p=C.combineEdges(page(),ids,mode);change(()=>{S.project.pages[S.pageIndex]=p;S.selectedBus=p.edges.find(e=>ids.includes(e.id)).bus;S.selectedEdge=null;S.selectedEdges.clear();S.selected.clear();});
}
function busExistingDialog(){const b=page().buses.find(b=>b.id===S.selectedBus);if(!b)return;const list=page().edges.filter(e=>e.bus!==b.id),title=id=>page().nodes.find(n=>n.id===id)?.title||id;
 modal('Связи общей гребёнки',`<p class="muted">Выберите уже созданные соединения. Наличие общего порта необязательно; направления сохранятся.</p><div class="stack">${list.map(e=>`<label class="check-row"><input type="checkbox" data-join-edge="${esc(e.id)}"><span>${esc(title(e.source))} → ${esc(title(e.target))}${e.bus?' · другая гребёнка':''}</span></label>`).join('')||'<p>Других связей нет.</p>'}</div>`,`<button id="join-existing" class="primary" ${list.length?'':'disabled'}>Включить выбранные</button>`,true);
 $('#join-existing').onclick=()=>{const ids=$$('[data-join-edge]:checked').map(x=>x.dataset.joinEdge);if(!ids.length)return toast('Выберите связи');const p=C.joinBus(page(),b.id,ids);closeModal();change(()=>S.project.pages[S.pageIndex]=p);};
}
function choosePort(node,port){
 if(!S.addingBusPair)return v4ChoosePort(node,port);
 if(!S.pendingPort){S.pendingPort={node,port};renderScene();return;}
 const first=S.pendingPort;if(first.node===node&&C.samePort(page().nodes.find(n=>n.id===node),first.port,port)){S.pendingPort=null;renderScene();return;}
 const busId=S.addingBusPair;S.pendingPort=null;
 const existing=page().edges.find(e=>e.source===first.node&&e.target===node&&C.samePort(page().nodes.find(n=>n.id===node),e.targetPort,port,'left')&&C.samePort(page().nodes.find(n=>n.id===first.node),e.sourcePort,first.port));
 change(()=>{const e=existing||{id:C.uid('edge'),source:first.node,sourcePort:first.port,target:node,targetPort:port,arrow:true,label:'',dashed:false};if(!existing)page().edges.push(e);S.project.pages[S.pageIndex]=C.joinBus(page(),busId,[e.id]);S.selectedBus=busId;S.selectedEdge=null;S.selectedEdges.clear();S.selected.clear();});
 toast('Соединение добавлено. Выберите следующую пару портов или нажмите Esc.');
}
function updateConnectStatus(){if(S.addingBusPair){const el=$('#connect-status');if(!el)return;el.hidden=false;el.textContent=S.pendingPort?'Гребёнка: выбран источник → щёлкните порт приёмника. Esc — завершить.':'Гребёнка: щёлкните порт источника, затем порт приёмника. Esc — завершить.';return;}v4UpdateConnectStatus();}
function routeInspector(e){return e.bus?'<small>Магистраль перемещается за круглый маркер. Отдельную ветвь сначала выведите из гребёнки.</small>':`<small>Щёлкните участок линии, затем Delete — убрать изгиб. Квадратный маркер перемещает участок.</small><div class="property-actions">${command('route-clear','undo','Сбросить весь ручной маршрут','Автоматический маршрут')}</div>`;}
function stopPlacement(){if(S.placement?.url)URL.revokeObjectURL(S.placement.url);S.placement=null;$('#placement-preview')?.remove();if($('#stage'))$('#stage').style.cursor='default';}
function showPlacement(e){if(!S.placement||!$('#world'))return;const p=worldPoint(e),n={...S.placement.node,x:p.x,y:p.y,_ghost:true};S.placement.point=p;let el=$('#placement-preview');if(!el){el=document.createElement('div');el.id='placement-preview';$('#world').append(el);}el.innerHTML=nodeHTML(n,false);if(S.placement.url){const img=el.querySelector('img.photo');if(img)img.src=S.placement.url;}}
function startPlacement(node,file=null){stopPlacement();S.tool=node.type;S.pendingPort=null;S.addingBus=S.addingBusPair=null;S.placement={node,file,url:file?URL.createObjectURL(file):null};renderTools();$('#stage').style.cursor='crosshair';$('#stage').onpointermove=showPlacement;$('#stage').onpointerleave=()=>{if($('#placement-preview'))$('#placement-preview').innerHTML='';};}
async function setTool(t){
 if(S.readOnly&&!['select','pan'].includes(t))return;
 stopPlacement();if(['block','decision','text','table','note'].includes(t)){const n=makeNode(t,0,0);if(t==='decision'){n.w=160;n.h=110;}startPlacement(n);return;}
 if(t==='image'){const fs=await pickFiles('image/*',false);if(!fs.length)return;const img=new Image(),url=URL.createObjectURL(fs[0]);img.src=url;try{await img.decode();}catch{}URL.revokeObjectURL(url);const n=makeNode('image',0,0);n.w=Math.min(250,img.naturalWidth||200);n.h=n.w*(img.naturalHeight||200)/(img.naturalWidth||200);startPlacement(n,fs[0]);return;}
 if(t==='emoji'){emojiPicker(g=>{const n=makeNode('text',0,0);n.title=g;n.w=100;n.h=100;n.fontSize=54;startPlacement(n);});return;}
 return v4SetTool(t);
}
function addNode(type,point){if(!point)return setTool(type);if(S.readOnly)return;
 change(()=>{const n=makeNode(type,point.x,point.y);page().nodes.push(n);S.selected=new Set([n.id]);S.selectedEdge=S.selectedBus=null;S.selectedEdges.clear();S.tool='select';});
}
async function placePending(point){const place=S.placement;if(!place||S.readOnly)return;stopPlacement();let material;if(place.file)material=await uploadFile(place.file);change(()=>{const n={...place.node,id:C.uid('node'),x:point.x,y:point.y};if(material){n.title=material.title;n.imageMaterial=material.id;n.fill=n.stroke='transparent';}page().nodes.push(n);S.selected=new Set([n.id]);S.selectedEdge=S.selectedBus=null;S.selectedEdges.clear();S.tool='select';});}
async function insertImages(files,point){if(!point){if(files.length)startPlacement(makeNode('image',0,0),files[0]);return;}for(let i=0;i<files.length;i++){const m=await uploadFile(files[i]);change(()=>{const n=makeNode('image',point.x+i*24,point.y+i*24);n.title=m.title;n.imageMaterial=m.id;n.w=200;n.h=160;n.fill=n.stroke='transparent';page().nodes.push(n);S.selected=new Set([n.id]);});}}
function movementMessage(plan){return 'В цепочке есть зафиксированный блок: '+plan.locked.map(id=>page().nodes.find(n=>n.id===id)?.title).join(', ')+'. Снимите фиксацию перед переносом цепочки.';}
function applyMovement(pg,base,ids,dx,dy){
 if(pg.layoutOptions?.busSymmetry && (S.display?.symmetryGroups||[]).some(g=>ids.has(g.parent)||g.heads.some(id=>ids.has(id)))){pg.layoutOptions.busSymmetry=false;pg.layoutOptions.autoSpace=false;S.compact=false;}
 const map=new Map(base.nodes.map(n=>[n.id,n]));for(const n of pg.nodes)if(ids.has(n.id)){const o=map.get(n.id);if(n.anchorId){if(!ids.has(n.anchorId)){n.anchorX=(o.anchorX||0)+dx;n.anchorY=(o.anchorY||0)+dy;}}else{n.x=o.x+(o.offsetX||0)+dx;n.y=o.y+(o.offsetY||0)+dy;n.offsetX=n.offsetY=0;}}C.moveRouteObjects(pg,ids,dx,dy,base);}
function onPointerDown(e){
 if(S.home)return;const target=e.target,wp=worldPoint(e);if(e.button===2)return;if(handleQuickPointer(e))return;
 if(S.placement&&e.button===0&&!S.space){e.preventDefault();placePending(wp).catch(err=>toast(err.message));return;}
 if(e.button===1||S.space||S.tool==='pan')return v4OnPointerDown(e);
 const grip=target.closest('[data-resize]');if(grip&&!S.readOnly&&e.button===0){
  const n=page().nodes.find(n=>n.id===grip.dataset.resize);if(!n||n.locked||n.autoSize)return;
  e.preventDefault();const d=S.display.nodes.find(x=>x.id===n.id),el=grip.closest('[data-node]'),w=d.w,h=d.h,table=n.table?C.clone(d.table):null,met=table?C.tableMetrics(d):null;
  const portCache=new Map(S.display.nodes.map(n=>[n.id,C.ports(n)])),ports=portCache.get(d.id),portEls=[...el.querySelectorAll('[data-port]')];let moved=false;
  startDrag(e,ev=>{const pt=worldPoint(ev),dx=pt.x-wp.x,dy=pt.y-wp.y;if(!moved&&Math.hypot(dx,dy)*S.view.z<3)return;
   if(!moved){checkpoint();moved=true;S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);el.classList.add('resizing');for(const x of S.display.nodes)x._resizePorts=portCache.get(x.id);}
   const real=page().nodes.find(x=>x.id===n.id);real.w=d.w=Math.max(60,w+dx);real.h=d.h=Math.max(30,h+dy);
   el.style.width=d.w+'px';el.style.height=d.h+'px';
   if(table){const body=el.querySelector('.node-body');body.style.width=w+'px';body.style.height=h+'px';body.style.transformOrigin='0 0';body.style.transform=`scale(${d.w/w},${d.h/h})`;d._resizePorts=ports;}
   for(const p of ports){const port=portEls.find(x=>x.dataset.port===p.id);if(port){port.style.left=p.x*d.w+'px';port.style.top=p.y*d.h+'px';}}
   renderEdges();
  },()=>{for(const x of S.display.nodes)delete x._resizePorts;if(moved){const real=page().nodes.find(x=>x.id===n.id);if(table){real.table.widths=table.widths.map(v=>Math.max(32,v*real.w/w));real.w=real.table.widths.reduce((a,b)=>a+b,0);if(!table.autoSize)real.table.heights=met.heights.map(v=>Math.max(24,v*real.h/h));real.h=C.tableMetrics(real).total;}changed();render();}});return;
 }
 const segment=target.closest('[data-segment-edge]');if(segment&&!S.readOnly){
  e.preventDefault();const edge=page().edges.find(x=>x.id===segment.dataset.segmentEdge),shown=S.display.edges.find(x=>x.id===edge.id),ns=new Map(S.display.nodes.map(n=>[n.id,n])),original=C.clone(shown),i=+segment.dataset.segmentIndex,seg=C.routeSegments(C.edgePath(original,ns))[i];
  S.selected.clear();S.selectedEdge=edge.id;S.selectedEdges=new Set([edge.id]);S.selectedBus=null;S.selectedSegment={edge:edge.id,index:i};renderEdges();renderInspector();if(seg.terminal)return;
  let moved=false;startDrag(e,ev=>{const pt=worldPoint(ev),delta=seg.vertical?pt.x-wp.x:pt.y-wp.y;if(!moved&&Math.abs(delta)*S.view.z<3)return;const out=C.moveVisibleSegment(original,ns,i,delta);if(out===original)return;if(!moved){checkpoint();moved=true;}for(const obj of [edge,shown])copyRoute(obj,out);renderEdges();},()=>{if(moved){changed();renderInspector();}});return;
 }
 if(!target.closest('[data-route-index]'))S.selectedSegment=null;
 const busGrip=target.closest('[data-bus-handle]');if(busGrip&&!S.readOnly){const b=page().buses.find(b=>b.id===busGrip.dataset.busHandle);if(b?.mode==='free'){e.preventDefault();const route=S.bundle.buses.find(x=>x.id===b.id),axis=route.axis;let moved=false;startDrag(e,ev=>{const pt=worldPoint(ev),delta=route.vertical?pt.x-wp.x:pt.y-wp.y;if(!moved&&Math.abs(delta)*S.view.z<3)return;if(!moved){checkpoint();moved=true;}b.axis=axis+delta;renderEdges();},()=>{if(moved){changed();renderInspector();}});return;}}
 const obj=target.closest('.icon-object');if(obj&&e.button===0&&!S.readOnly&&(S.selected.has(obj.dataset.iconNode)||S.iconEdit)){e.preventDefault();e.stopPropagation();const n=page().nodes.find(n=>n.id===obj.dataset.iconNode);S.selected=new Set([n.id]);S.selectedIcon=+obj.dataset.iconIndex;S.iconEdit=true;const ic=n.icons[S.selectedIcon];if(!ic)return;S.selectedEdge=S.selectedBus=S.selectedDrawing=null;S.selectedEdges.clear();const origin={x:ic.x??0,y:ic.y??0,w:ic.w||36,h:ic.h||ic.w||36},resize=!!target.closest('[data-icon-resize]');let moved=false;
  startDrag(e,ev=>{const p=worldPoint(ev);let dx=p.x-wp.x,dy=p.y-wp.y;if(!moved&&Math.hypot(dx,dy)*S.view.z<3)return;if(!moved){checkpoint();moved=true;}if(resize){ic.w=Math.max(8,origin.w+dx);ic.h=ev.shiftKey?ic.w*origin.h/origin.w:Math.max(8,origin.h+dy);obj.style.width=ic.w+'px';obj.style.height=ic.h+'px';}else{if(ev.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}ic.x=origin.x+dx;ic.y=origin.y+dy;obj.style.left=ic.x+'px';obj.style.top=ic.y+'px';}},()=>{if(moved)changed();renderInspector();renderScene();});return;
 }
 if(target.closest('button,a,[data-port],[data-resize],[data-route-index],[data-bus-handle],.material-badges,[data-open-material],[data-node-material]')||S.tool!=='select'||e.button!==0)return v4OnPointerDown(e);
 const nd=target.closest('[data-node]');if(!nd)return v4OnPointerDown(e);
 closePopover();S.justDragged=false;const id=nd.dataset.node,n=page().nodes.find(n=>n.id===id);if(!n)return;const was=S.selected.has(id);S.iconEdit=false;
 if(e.shiftKey)S.selected.add(id);else if(!was)S.selected=new Set([id]);S.selectedEdges.clear();S.selectedEdge=S.selectedBus=S.selectedDrawing=null;
 for(const el of $$('#nodes .node'))el.classList.toggle('selected',S.selected.has(el.dataset.node));renderInspector();
 if(S.readOnly||n.locked)return;const plan=C.dragPlan(page(),S.selected,collapsed(),S.editModes);if(plan.locked.length){toast(movementMessage(plan));return;}
 e.preventDefault();let moved=false,base,visual,axis=null;
 startDrag(e,ev=>{const pt=worldPoint(ev);let dx=pt.x-wp.x,dy=pt.y-wp.y;if(!moved&&Math.hypot(dx,dy)*S.view.z<4)return;
  if(!moved){checkpoint();moved=true;visual=C.clone(S.display.nodes);S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);base=C.clone(page());S.compact=false;S.dragMoving=plan.ids;S.dragOrigin=visual;}
  if(ev.shiftKey||S.editModes.ortho){axis=axis||(Math.abs(dx)>=Math.abs(dy)?'x':'y');if(axis==='x')dy=0;else dx=0;}else axis=null;
  const snap=C.snapConnectedMove(visual,S.display.edges,plan.ids,id,dx,dy,S.view.z,ev.altKey?{}:S.editModes,axis);dx=snap.dx;dy=snap.dy;S.guides=snap.guides;applyMovement(page(),base,plan.ids,dx,dy);previewStraightRoutes(base,snap.straightEdges||[]);
  for(const d of S.display.nodes){const orig=visual.find(x=>x.id===d.id);if(plan.ids.has(d.id)){d.x=orig.x+dx;d.y=orig.y+dy;const el=$(`#nodes [data-node="${CSS.escape(d.id)}"]`);if(el){el.style.left=d.x+'px';el.style.top=d.y+'px';}}}
  renderEdges();renderInk();renderGuides();highlightMoving();
 },()=>{S.guides=[];S.dragMoving=null;S.dragOrigin=null;if(moved){changed();render();}else if(e.shiftKey&&was){S.selected.delete(id);renderScene();renderInspector();}});
}
function nudge(key,step){if(S.readOnly||!S.selected.size)return;const plan=C.dragPlan(page(),S.selected,collapsed(),S.editModes);if(plan.locked.length)return toast(movementMessage(plan));const dx=key==='ArrowLeft'?-step:key==='ArrowRight'?step:0,dy=key==='ArrowUp'?-step:key==='ArrowDown'?step:0;
 change(()=>{S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);S.compact=false;const base=C.clone(page());applyMovement(page(),base,plan.ids,dx,dy);});
}
function onDoubleClick(e){const cell=e.target.closest('[data-table-cell]');if(cell&&!e.target.closest('button,a')){e.preventDefault();beginQuickEdit(cell,e);return;}const icon=e.target.closest('.icon-object');if(icon){S.selected=new Set([icon.dataset.iconNode]);S.selectedIcon=+icon.dataset.iconIndex;S.iconEdit=true;render();return;}
 const segment=e.target.closest('[data-segment-edge]');if(segment){if(!S.readOnly)deleteSegment(segment.dataset.segmentEdge,+segment.dataset.segmentIndex);return;}return v4OnDoubleClick(e);
}
function onKey(e){
 if(quickEdit&&e.target.closest?.('.quick-editing')){if(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();finishQuickEdit(e.key!=='Escape');render();}return;}
 if(e.key==='Escape'&&currentModal?.kind==='table'&&currentModal.dismissOverlay?.()){e.preventDefault();return;}
 if(!S.readOnly&&!currentModal&&!e.target.closest?.('input,textarea,select,[contenteditable=true]')&&S.selectedSegment&&S.selectedEdge===S.selectedSegment.edge&&['Delete','Backspace'].includes(e.key)){e.preventDefault();deleteSegment(S.selectedSegment.edge,S.selectedSegment.index);return;}
 if(e.key==='Escape'){stopPlacement();S.addingBusPair=null;S.selectedSegment=null;}

 if(S.iconEdit&&S.selected.size===1&&!e.target.closest?.('input,textarea,select,[contenteditable=true]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!S.readOnly){const ic=selected()?.icons?.[S.selectedIcon];if(ic){e.preventDefault();const d=e.shiftKey?10:1;change(()=>{ic.x=(ic.x||0)+(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0);ic.y=(ic.y||0)+(e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0);});return;}}
 return v4OnKey(e);
}
async function action(a){if(quickEdit)finishQuickEdit();const n=selected();
 if(a==='align-connection')return alignConnection();
 if(a==='home'||a==='preview')stopPlacement();
 if(S.readOnly&&['combine-auto','move-icons','remove-icon','icon-emoji','icon-upload','bus-add-branch'].includes(a))return;
 if(a==='combine-auto'||a==='combine-out'||a==='combine-in')return combineSelected(a.slice(8));
 if(a==='move-icons'&&n){if(!n.icons?.length)return toast('Сначала прикрепите картинку к блоку');S.iconEdit=!S.iconEdit;S.selectedIcon=Math.max(0,Math.min(S.selectedIcon,n.icons.length-1));renderInspector();renderScene();return;}
 if(a==='remove-icon'&&n){change(()=>{n.icons.splice(Math.min(S.selectedIcon,n.icons.length-1),1);S.selectedIcon=0;});return;}
 if(a==='icon-emoji')return v4Action('emoji-text');
 if(a==='icon-upload'&&n){const fs=await pickFiles('image/*',false);if(!fs.length)return;const m=await uploadFile(fs[0]);change(()=>{n.icons.push({id:C.uid('icon'),material:m.id,x:Math.max(0,n.w-48),y:Math.max(0,n.h-48),w:40,h:40});S.selectedIcon=n.icons.length-1;S.iconEdit=true;});return;}
 if(a==='bus-add-branch'){const b=page().buses.find(x=>x.id===S.selectedBus);if(b?.mode==='free'){S.addingBusPair=b.id;S.addingBus=null;S.pendingPort=null;renderScene();return;}S.addingBusPair=null;}
 return v4Action(a);
}
function onChange(e){const id=e.target.id,n=selected(),v=e.target.value;
 if(!S.readOnly&&S.selectedEdge&&['edge-label-centered','edge-label-segment'].includes(id)){const edge=page().edges.find(x=>x.id===S.selectedEdge);if(edge)change(()=>{if(id==='edge-label-centered')edge.labelCentered=e.target.checked;else if(v==='auto')delete edge.labelSegment;else edge.labelSegment=+v;});return;}
 if(id==='layout-symmetry'||id==='layout-symmetry-gap'){
  const value=id==='layout-symmetry'?e.target.checked:Math.max(24,Math.min(600,Number(v)||64));
  const apply=()=>{if(id==='layout-symmetry'&&!value){S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);page().layoutOptions.autoSpace=false;S.compact=false;}if(id==='layout-symmetry'&&value)page().layoutOptions.autoSpace=true;page().layoutOptions={...page().layoutOptions,[id==='layout-symmetry'?'busSymmetry':'symmetryGap']:value};};
  if(S.readOnly){apply();render();}else change(apply);return;
 }
 if(!S.readOnly&&n&&['node-auto-size','node-relative-lock'].includes(id)){const checked=e.target.checked;change(()=>{if(id==='node-relative-lock'){S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);page().nodes.find(x=>x.id===n.id).relativeLock=checked;}else{const shown=S.display.nodes.find(x=>x.id===n.id);if(!checked&&shown){n.w=shown.w;n.h=shown.h;}if(checked){n.autoBaseW=n.w;n.autoBaseH=n.h;}n.autoSize=checked;}});return;}
 if(!S.readOnly&&['bus-auto-align','bus-align-gap'].includes(id)&&S.selectedBus){const b=page().buses.find(x=>x.id===S.selectedBus);if(b)change(()=>{if(id==='bus-auto-align'){if(!e.target.checked)S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);page().buses.find(x=>x.id===b.id).autoAlign=e.target.checked;}else b.alignGap=Math.max(16,Math.min(600,Number(v)||64));});return;}
 if(id==='table-word-wrap'&&n?.table&&!S.readOnly){change(()=>n.table.wordWrap=v==='hyphenate'?'hyphenate':'words');return;}
 if(id==='table-auto-size'&&n?.table&&!S.readOnly){const v=e.target.checked;change(()=>C.setTableAutoSize(n,v));return;}

 if(!S.readOnly){
  if(['edge-source-port','edge-target-port'].includes(id)&&S.selectedEdge){
   const edge=page().edges.find(x=>x.id===S.selectedEdge);if(!edge)return;
   const bus=page().buses?.find(b=>b.id===edge.bus),oldRoute=bus&&S.bundle?.buses.find(b=>b.id===bus.id);
   change(()=>{edge[id==='edge-source-port'?'sourcePort':'targetPort']=v;
    if(bus){const beforeMode=bus.mode;const pg=C.joinBus(page(),bus.id,[]);const updated=pg.buses.find(b=>b.id===bus.id);
     if(updated?.mode==='free'&&beforeMode!=='free'&&oldRoute){updated.orientation=oldRoute.vertical?'vertical':'horizontal';updated.axis=oldRoute.axis;}
     S.project.pages[S.pageIndex]=pg;}
   });return;
  }

  if(id==='node-type'&&n&&!n.table){change(()=>n.type=v);return;}
  if(id==='table-body-position'&&n?.table){change(()=>n.tableBodyPosition=v);return;}
  if(['bus-orientation','bus-axis','bus-style'].includes(id)&&S.selectedBus){const b=page().buses.find(b=>b.id===S.selectedBus);if(b)change(()=>{if(id==='bus-orientation'){b.orientation=v;delete b.axis;}if(id==='bus-axis')b.axis=Number(v)||0;if(id==='bus-style')b.style=v;});return;}
  if(id==='edge-style'&&S.selectedEdge){const e=page().edges.find(x=>x.id===S.selectedEdge);if(e)change(()=>e.style=v);return;}
  if(n?.icons?.length&&['icon-x','icon-y','icon-size','icon-width','icon-height'].includes(id)){const ic=n.icons[Math.min(S.selectedIcon,n.icons.length-1)];change(()=>{if(id==='icon-x')ic.x=Number(v)||0;else if(id==='icon-y')ic.y=Number(v)||0;else if(id==='icon-width')ic.w=Math.max(8,Math.min(2000,Number(v)||36));else if(id==='icon-height')ic.h=Math.max(8,Math.min(2000,Number(v)||36));else ic.w=ic.h=Math.max(8,Math.min(2000,Number(v)||36));});return;}
 }
 return v4OnChange(e);
}


/* 0.6 direct material chips. Preview opens the content itself, never an action chooser.
 * 'Location' is an in-app directory/path panel, not an OS Explorer integration.
 */
function findMaterial(id){return S.project?.materials?.find(m=>m.id===id)||null;}
function fileType(m){
 const path=(m?.filename||m?.path||m?.url||'').split(/[?#]/)[0],ext=path.split('.').pop().toLowerCase();
 if(m?.kind==='cell')return 'cell';if(m?.kind==='page')return 'page';
 if(['doc','docx','odt','rtf'].includes(ext))return 'doc';if(['ppt','pptx','odp'].includes(ext))return 'slides';if(['xls','xlsx','ods','csv'].includes(ext))return 'sheet';
 if(['zip','7z','rar','tar','gz'].includes(ext))return 'archive';if(ext==='pdf')return 'pdf';
 if(['mp4','webm','mov','m4v','ogg'].includes(ext))return 'video';if(['mp3','wav','flac','m4a'].includes(ext))return 'audio';if(['png','jpg','jpeg','svg','webp','gif'].includes(ext))return 'image';
 return ({document:'doc',link:'link',video:'video',pdf:'pdf',audio:'audio',image:'image'})[m?.kind]||'file';
}
function inferMaterialKind(path){const t=fileType({path});if(t==='file'&&httpURL(path))return 'link';return {doc:'document',slides:'document',sheet:'document',archive:'document',file:'document'}[t]||t;}
const FILE_LABELS={pdf:'PDF',doc:'DOC',slides:'PPT',sheet:'XLS',video:'ВИДЕО',audio:'АУДИО',image:'IMG',archive:'ZIP',link:'WEB',cell:'ЯЧЕЙКА',page:'СТР.',file:'ФАЙЛ'};
function fileIcon(m){const t=fileType(m),mark=({pdf:'<path d="M7 15h10M7 18h7"/>',doc:'<path d="M7 13h10M7 16h10M7 19h7"/>',slides:'<path d="M7 13h10v6H7zM12 13v6"/>',sheet:'<path d="M7 12h10v8H7zM7 16h10M12 12v8"/>',video:'<path d="m9 12 7 4-7 4z"/>',audio:'<path d="M10 19v-6l6-1v6M7 19h3m3-1h3"/>',image:'<path d="m6 19 4-5 3 3 2-2 3 4"/><circle cx="9" cy="11" r="1"/>',archive:'<path d="M11 10h2m-2 3h2m-2 3h2m-2 3h2"/>',cell:'<path d="M5 5h14v14H5zM5 10h14M10 5v14M5 14h14"/>',page:'<path d="M7 12h10M7 16h10"/>',link:'<path d="m9 15 6-6m-5 0H7a4 4 0 0 0 0 8h3m4-10h3a4 4 0 0 1 0 8h-3"/>'})[t]||'<path d="M7 14h10M7 18h6"/>';
 const paper=['cell','link'].includes(t)?'':'<path d="M5 2h9l5 5v15H5zM14 2v6h5"/>';
 return `<span class="file-type-icon file-${t}" title="${FILE_LABELS[t]}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${paper}${mark}</svg></span>`;
}
function materialChip(id,compact=false,override=null){const m=override||findMaterial(id),title=m?.title||'Материал не найден',t=fileType(m);
 return `<span class="file-chip ${compact?'compact-chip':''} file-${t}" data-material-chip="${esc(id)}"><button class="file-chip-main" data-material-action="preview" data-material-id="${esc(id)}" title="Просмотреть: ${esc(title)}">${fileIcon(m)}<span class="file-chip-name">${esc(title)}</span></button><span class="file-chip-actions"><button data-material-action="external" data-material-id="${esc(id)}" title="${t==='cell'||t==='page'?'Перейти':'Открыть отдельно'}" aria-label="Открыть отдельно">${uiIcon('external')}</button><button data-material-action="location" data-material-id="${esc(id)}" title="Местоположение / адрес" aria-label="Местоположение">${uiIcon('folder')}</button></span></span>`;
}
function cellLinksMarkup(cell){const ids=legacyCellIds(cell);return ids.length?`<div class="cell-links">${ids.map(id=>cellSourceChip(cell,id)).join('')}</div>`:'';}
function cellContentMarkup(cell){return `<div class="cell-text">${cell.html?cleanHTML(cell.html):richText(cell.text)}</div>${cellLinksMarkup(cell)}`;}
function tableHTML(n){const t=n.table;if(!t)return '';const met=C.tableMetrics(n),sum=t.widths.reduce((a,b)=>a+b,0);
 return `<table lang="ru" class="flow-table wrap-${t.wordWrap||'words'}"><colgroup>${t.widths.map(w=>`<col style="width:${w/sum*100}%">`).join('')}</colgroup><tbody>${t.cells.map((row,r)=>`<tr data-table-row="${r}" style="height:${met.heights[r]}px">${row.map((c,col)=>!c?'':`<td data-table-cell="${r},${col}" data-row-id="${esc(t.rowIds?.[r]||'')}" data-col-id="${esc(t.colIds?.[col]||'')}" rowspan="${c.rowspan||1}" colspan="${c.colspan||1}" style="padding:0;background:${esc(c.fill||'#fff')};text-align:${esc(c.align||'left')};font-weight:${c.bold?'700':'400'}"><div class="cell-content" style="height:${Math.max(1,met.heights.slice(r,r+(c.rowspan||1)).reduce((a,b)=>a+b,0)-1)}px">${wrappedCellMarkup(c,t.wordWrap||'words')}</div></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
let measureElement=null;const cellSizeCache=new Map();
function measureCell(n,cell,width){
 const ids=C.cellMaterialIds(cell),metas=ids.map(id=>{const m=findMaterial(id)||(n.table?._pendingMaterials||[]).find(m=>m.id===id);return [id,m?.title,fileType(m)];});
 const key=JSON.stringify([Math.round(width*100)/100,n.fontSize||13,cell.text,cell.html,!!cell.bold,cell.align,n.table?.wordWrap||'words',metas]);if(cellSizeCache.has(key))return cellSizeCache.get(key);
 if(!measureElement){measureElement=document.createElement('div');measureElement.className='cell-content cell-size-probe';measureElement.setAttribute('aria-hidden','true');document.body.append(measureElement);}
 measureElement.style.cssText=`position:fixed;left:-100000px;top:0;width:${Math.max(16,width)}px;height:auto!important;min-height:0;max-height:none;visibility:hidden;pointer-events:none;font:${n.fontSize||13}px/1.35 'Segoe UI',Arial,sans-serif;font-weight:${cell.bold?'700':'400'};padding:8px 9px;box-sizing:border-box;overflow-wrap:normal;word-break:normal;white-space:pre-wrap;hyphens:manual;contain:layout style`;
 measureElement.innerHTML=wrappedCellMarkup(cell,n.table?.wordWrap||'words');const h=measureElement.getBoundingClientRect().height;
 if(cellSizeCache.size>2400)cellSizeCache.clear();cellSizeCache.set(key,h);return h;
}
C.measureCell=measureCell;
function materialControls(n){const ids=[...new Set(n.materials||[])];return `${S.readOnly?'':command('attach','registry','Прикрепить материалы к блоку','Прикрепить','property-wide')}<div class="property-materials">${ids.map(id=>`<div class="property-file-row">${materialChip(id)}${S.readOnly?'':`<button class="ui-command" data-detach="${esc(id)}" title="Отвязать от блока">${uiIcon('close')}</button>`}</div>`).join('')||'<small>Нет прикреплённых материалов</small>'}</div>`;}
function showNodeMaterials(n,kind){const ms=[...new Set(n.materials||[])].map(findMaterial).filter(m=>m&&(!kind||m.kind===kind));
 modal('Источники — '+n.title,`<div class="stack source-list">${ms.map(m=>materialChip(m.id)).join('')||'<p>Источники отсутствуют.</p>'}</div>`,'',true);}
function jumpToCell(target){const hit=C.cellTarget(S.project,target);if(!hit)return toast('Ячейка удалена или отсутствует в этом документе');
 closeModal();S.pageIndex=S.project.pages.indexOf(hit.page);S.folded.delete(hit.node.id);focusNode(hit.node.id);
 const el=$(`#nodes [data-node="${CSS.escape(hit.node.id)}"] [data-table-cell="${hit.row},${hit.col}"]`);if(el){
  const rect=el.getBoundingClientRect(),stage=$('#stage').getBoundingClientRect(),v=S.view;
  const x=(rect.left-stage.left-v.x)/v.z,y=(rect.top-stage.top-v.y)/v.z,w=rect.width/v.z,h=rect.height/v.z;
  const z=Math.max(.12,Math.min(1.2,(stage.width-100)/w,(stage.height-100)/h));
  S.view={z,x:stage.width/2-(x+w/2)*z,y:stage.height/2-(y+h/2)*z};transform();
  el.classList.add('cell-target-flash');setTimeout(()=>el.classList.remove('cell-target-flash'),4000);
 }return hit;
}
async function refreshMaterialRegistry(){
 if(!S.server)return;if(!S.readOnly)await save();
 S.project.materials=S.pub?(await request('/api/published/'+encodeURIComponent(S.pub))).materials:await request('/api/materials');
}
async function openMaterial(id){await refreshMaterialRegistry();const m=findMaterial(id);if(!m)return toast('Материал не найден');
 if(m.kind==='cell')return jumpToCell(m.target);
 if(m.kind==='page'||m.url?.startsWith('data:page/id,')){const pid=m.url?.split(',')[1],index=S.project.pages.findIndex(p=>p.id===pid);if(index<0)return toast('Связанная страница отсутствует');if(index===S.pageIndex)return toast('Вы уже на этой странице');closeModal();S.pageIndex=index;S.selected.clear();render();fit();return;}
 if(m.kind==='link'&&!m.embed||m.kind==='document'&&!m.previewPath&&!m.previewURL&&!m.previewMaterial&&!m.previewAsset)return materialExternal(id);
 return v5OpenMaterial(id);
}
function locationText(m){if(m.kind==='cell'){const hit=C.cellTarget(S.project,m.target);return hit?`${hit.page.title} / ${hit.node.title} / ячейка ${hit.row+1}:${hit.col+1}`:'Целевая ячейка не найдена';}return m.path||m.url||m.filename||'Внутреннее хранилище';}
function closeFilePopover(){document.getElementById('file-location-popover')?.remove();}
async function materialLocation(id,anchor){await refreshMaterialRegistry();const m=currentModal?.pendingMaterials?.find(m=>m.id===id)||findMaterial(id);if(!m)return;closeFilePopover();const el=document.createElement('div');el.id='file-location-popover';el.className='file-location-popover';
 const path=locationText(m),relative=m.path&&validRelative(m.path),parent=relative?m.path.split('/').slice(0,-1).join('/'):null;
 el.innerHTML=`<div class="row spread"><strong>${fileIcon(m)} Местоположение</strong><button class="icon" data-location-close title="Закрыть">${uiIcon('close')}</button></div><code>${esc(path)}</code><div class="row wrap"><button data-location-copy>${uiIcon('copy')} Копировать адрес</button><button data-location-open>${uiIcon('external')} Открыть</button>${relative?'<button data-location-list>Файлы этой папки</button>':''}</div><div class="location-files"></div><small>${relative?'Папка показана внутри Studio. Это не окно системного Проводника.':'Адрес материала; его можно скопировать или открыть отдельной кнопкой ссылки.'}</small>`;
 document.body.append(el);const b=anchor?.getBoundingClientRect(),w=Math.min(410,innerWidth-24);el.style.width=w+'px';el.style.left=Math.max(12,Math.min(innerWidth-w-12,(b?.left||innerWidth-w-24)))+'px';el.style.top=Math.max(12,Math.min(innerHeight-280,(b?.bottom||150)+8))+'px';
 $('[data-location-close]',el).onclick=closeFilePopover;
 $('[data-location-open]',el).onclick=()=>materialExternal(id).catch(e=>toast(e.message));
 $('[data-location-copy]',el).onclick=async()=>{try{await navigator.clipboard.writeText(path);toast('Адрес скопирован');}catch{const ta=document.createElement('textarea');ta.value=path;el.append(ta);ta.select();toast('Браузер не дал доступ к буферу. Адрес выделен — нажмите Ctrl+C.');}};
 const list=$('[data-location-list]',el);if(list)list.onclick=async()=>{const area=$('.location-files',el);area.textContent='Чтение папки…';try{let items=[];
  if(DOC.root){let h=DOC.root;for(const part of parent.split('/').filter(Boolean))h=await h.getDirectoryHandle(part);for await(const [name,entry] of h.entries()){items.push({name,kind:entry.kind});if(items.length>=200)break;}}
  else if(DOC.files?.size){const seen=new Set();for(const p of DOC.files.keys()){if(parent&&!p.startsWith(parent+'/'))continue;const tail=parent?p.slice(parent.length+1):p,name=tail.split('/')[0];if(!seen.has(name)){seen.add(name);items.push({name,kind:tail.includes('/')?'directory':'file'});}if(items.length>=200)break;}}
  else throw Error('Папка проекта не выбрана. Используйте команду папки в верхней панели документа.');
  area.innerHTML=`<div class="location-caption">${esc(parent||'Корень проекта')}</div>`+items.map(x=>`<div class="location-entry ${m.path.endsWith('/'+x.name)||m.path===x.name?'current-file':''}">${x.kind==='directory'?uiIcon('folder'):fileIcon({path:x.name})}<span>${esc(x.name)}</span></div>`).join('');
 }catch(e){area.textContent=e.message;}};
}
async function materialExternal(id){const m=currentModal?.pendingMaterials?.find(m=>m.id===id)||findMaterial(id);if(!m)return;if(['cell','page'].includes(m.kind))return openMaterial(id);
 const win=window.open('about:blank','_blank');if(win)win.opener=null;
 try{const url=await resolveMaterial(m);if(!url)throw Error('Укажите папку проекта для доступа к файлу');if(!/^(https?:|blob:|file:)/i.test(url))throw Error('Недопустимый адрес файла');if(win)win.location.href=url;else toast('Браузер заблокировал новую вкладку. Разрешите всплывающие окна для Studio.');}catch(e){win?.close();toast(e.message,8000);}
}
document.addEventListener('click',e=>{const a=e.target.closest?.('[data-material-action]');if(!a)return;e.preventDefault();e.stopPropagation();const id=a.dataset.materialId,job=a.dataset.materialAction;Promise.resolve(job==='preview'?openMaterial(id):job==='external'?materialExternal(id):materialLocation(id,a)).catch(e=>toast(e.message,8000));},true);
document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('#file-location-popover,[data-material-action="location"]'))closeFilePopover();},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFilePopover();},true);
Object.assign(typeName,{cell:'Ячейка таблицы'});
Object.assign(UI_ICONS,{external:'<path d="M14 3h7v7M10 14 21 3"/><path d="M10 3H3v18h18v-7"/>',copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>'});
// Registry file-type symbols and direct actions without another action-selection modal.
const renderRegistryTypes=()=>{for(const el of $$('.registry tbody tr')){const view=$('[data-view]',el)||$('[data-open-material]',el);if(!view)continue;const m=findMaterial(view.dataset.view||view.dataset.openMaterial);if(m){const td=el.querySelector('td');if(td&&!$('.file-type-icon',td))td.insertAdjacentHTML('afterbegin',fileIcon(m)+' ');}}};


/* 0.7 editor helpers */
function inlineIds(cell){return C.inlineMaterialIds(cell);}
function legacyCellIds(cell){const inline=new Set(inlineIds(cell));return C.cellMaterialIds(cell).filter(id=>!inline.has(id));}
const markupCache=new Map();
function wrappedCellMarkup(cell,mode){const key=JSON.stringify([cell,mode,C.cellMaterialIds(cell).map(id=>findMaterial(id))]);if(markupCache.has(key))return markupCache.get(key);
 let html=cellContentMarkup(cell);if(mode==='hyphenate'){const dom=new DOMParser().parseFromString(html,'text/html'),walker=dom.createTreeWalker(dom.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(!n.parentElement.closest('.cell-links'))n.nodeValue=C.hyphenateRussian(n.nodeValue);}html=dom.body.innerHTML;}
 if(markupCache.size>4000)markupCache.clear();markupCache.set(key,html);return html;
}
function addSelectedBusEdges(){if(S.selectedEdge)S.selectedEdges.add(S.selectedEdge);if(S.selectedBus)for(const e of page().edges)if(e.bus===S.selectedBus)S.selectedEdges.add(e.id);}

function sourceSummary(n,ids){const counts=new Map();for(const id of ids){const m=findMaterial(id),key=fileType(m);const old=counts.get(key);counts.set(key,{m,count:(old?.count||0)+1});}return `<button class="source-summary" data-node-material="${esc(n.id)}" title="Открыть список источников"><span>Источники:</span>${[...counts].map(([key,{m,count}])=>`<span class="source-count">${fileIcon(m)} ${count} ${key==='pdf'?'PDF':key==='doc'?'Word':key==='link'?(count%10===1&&count%100!==11?'ссылка':count%10>=2&&count%10<=4&&!(count%100>=12&&count%100<=14)?'ссылки':'ссылок'):FILE_LABELS[key]}</span>`).join('<span class="source-comma">,</span>')}</button>`;}
function deleteSegment(id,index){const edge=page().edges.find(e=>e.id===id),shown=S.display.edges.find(e=>e.id===id);if(!edge||!shown||S.readOnly)return;try{const out=C.removeVisibleSegment(shown,new Map(S.display.nodes.map(n=>[n.id,n])),index);S.selectedSegment=null;change(()=>{delete edge.manualRoute;delete edge.manualRouteMode;delete edge.waypoints;if(out.manualRoute){edge.manualRoute=out.manualRoute;if(out.manualRouteMode)edge.manualRouteMode=out.manualRouteMode;}});}catch(e){toast(e.message);}}
function segmentDeleteControls(e){const shown=S.display?.edges.find(x=>x.id===e.id),route=shown&&C.edgePath(shown,new Map(S.display.nodes.map(n=>[n.id,n])));return route?`<div class="segment-delete-list">${route.points.slice(1,-2).map((_,i)=>`<button data-delete-segment="${i+1}" data-delete-edge="${esc(e.id)}" title="Удалить сегмент ${i+1}">${uiIcon('trash')} Сегмент ${i+1}</button>`).join('')}</div>`:'';}
let nodeProbe,sourceProbe,minWidthProbe;const nodeSizeCache=new Map(),sourceSizeCache=new Map(),wordWidthCache=new Map();
function rememberSize(cache,key,value){if(cache.size>4000)cache.clear();cache.set(key,value);return value;}
function measureNode(n){
 const key=JSON.stringify([n.title,n.html,n.fontSize,n.bold,n.italic,n.type,n.autoBaseW||n.w,n.autoBaseH||n.h,n.materials?.map(findMaterial)]);if(nodeSizeCache.has(key))return nodeSizeCache.get(key);
 if(!nodeProbe){nodeProbe=document.createElement('div');nodeProbe.className='node-size-probe';nodeProbe.setAttribute('aria-hidden','true');document.body.append(nodeProbe);}
 const font=n.fontSize||13,diamond=n.type==='decision',bw=n.autoBaseW||n.w,bh=n.autoBaseH||n.h||80;
 nodeProbe.style.cssText=`position:fixed;left:-100000px;top:0;visibility:hidden;width:max-content;max-width:none;font:${font}px/1.32 'Segoe UI',Arial,sans-serif;font-weight:${n.bold?'700':'400'};font-style:${n.italic?'italic':'normal'};white-space:pre-wrap;overflow-wrap:normal;`;
 nodeProbe.innerHTML=label(n);let w,h;
 if(diamond){
  // Find the smallest uniform scale that fits the centred safe area of a rhombus.
  const fits=scale=>{nodeProbe.style.width=Math.max(20,bw*scale*.55)+'px';nodeProbe.style.overflowWrap='anywhere';return nodeProbe.getBoundingClientRect().height+12<=bh*scale*.42;};
  let low=1,high=1;while(!fits(high)&&high<64)high*=1.5;
  if(high>1)for(let i=0;i<10;i++){const mid=(low+high)/2;if(fits(mid))high=mid;else low=mid;}
  w=bw*high;h=bh*high;
 }else{const natural=nodeProbe.getBoundingClientRect().width;w=Math.ceil(Math.max(bw,Math.min(720,natural+28)));nodeProbe.style.width=Math.max(20,w-28)+'px';nodeProbe.style.overflowWrap='anywhere';h=Math.ceil(Math.max(bh,nodeProbe.getBoundingClientRect().height+28+(n.materials?.length?measureSources({...n,w}):0)));}
 return rememberSize(nodeSizeCache,key,{w,h});
}
function measureSources(n){const ids=[...new Set(n.materials||[])].filter(findMaterial);if(!ids.length)return 0;const key=JSON.stringify([n.w,ids.map(id=>[id,fileType(findMaterial(id))])]);if(sourceSizeCache.has(key))return sourceSizeCache.get(key);
 if(!sourceProbe){sourceProbe=document.createElement('div');sourceProbe.setAttribute('aria-hidden','true');document.body.append(sourceProbe);}sourceProbe.style.cssText=`position:fixed;left:-100000px;top:0;visibility:hidden;width:${Math.max(30,n.w-14)}px;font:11px/1.3 'Segoe UI',Arial,sans-serif`;sourceProbe.innerHTML=sourceSummary(n,ids);return rememberSize(sourceSizeCache,key,Math.max(40,Math.ceil(sourceProbe.getBoundingClientRect().height)+12));
}
function fitTableWords(n){
 if(!n.table||n.table.wordWrap==='hyphenate')return n;
 const widths=[...n.table.widths],sum=widths.reduce((a,b)=>a+b,0),scale=(n.w||sum)/sum;for(let i=0;i<widths.length;i++)widths[i]*=scale;
 for(const row of n.table.cells)row.forEach((cell,col)=>{if(!cell)return;const key=JSON.stringify([cell.text,cell.html,cell.bold,n.fontSize]);let min=wordWidthCache.get(key);
  if(min===undefined){if(!minWidthProbe){minWidthProbe=document.createElement('div');minWidthProbe.setAttribute('aria-hidden','true');document.body.append(minWidthProbe);}minWidthProbe.style.cssText=`position:fixed;left:-100000px;top:0;visibility:hidden;width:min-content;max-width:none;font:${n.fontSize||13}px/1.35 'Segoe UI',Arial,sans-serif;font-weight:${cell.bold?'700':'400'};white-space:pre-wrap;overflow-wrap:normal;word-break:normal;hyphens:none;`;minWidthProbe.innerHTML=cell.html?cleanHTML(cell.html):richText(cell.text);min=Math.ceil(minWidthProbe.getBoundingClientRect().width)+24;rememberSize(wordWidthCache,key,min);}
  const span=cell.colspan||1,have=widths.slice(col,col+span).reduce((a,b)=>a+b,0);if(min>have)for(let i=col;i<col+span;i++)widths[i]+=(min-have)/span;
 });return {...n,w:widths.reduce((a,b)=>a+b,0),table:{...n.table,widths}};
}
C.fitTableWords=fitTableWords;

C.measureSources=measureSources;
C.measureNode=measureNode;
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-delete-segment]');if(b){e.preventDefault();deleteSegment(b.dataset.deleteEdge,+b.dataset.deleteSegment);}const link=e.target.closest?.('a[data-open-material]');if(link){e.preventDefault();if(link.closest('[contenteditable]'))e.stopImmediatePropagation();}},true);
document.addEventListener('contextmenu',e=>{if(e.target.closest?.('#app,#modal-root'))e.preventDefault();},true);


Object.assign(UI_ICONS,{fullscreen:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',fullscreenExit:'<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>'});
function behaviorOption(id,title,checked,help){return `<label class="behavior-option" title="${esc(help)}"><span>${esc(title)}<span class="behavior-help" aria-hidden="true">ⓘ</span></span><input id="${id}" type="checkbox" role="switch" ${checked?'checked':''} aria-label="${esc(title)}" aria-description="${esc(help)}"></label>`;}
function edgeLabelHTML(edge,route){const p=C.labelPlacement(edge,route);return `<text class="edge-label" x="${p.x}" y="${p.y}" text-anchor="middle" ${p.angle?`transform="rotate(${p.angle} ${p.x} ${p.y})"`:''}>${esc(edge.label||'')}${edge.count>1?' ×'+edge.count:''}</text>`;}
function labelSegmentControl(e){const route=S.bundle?.routes.get(e.id);return route?`<label class="field label-segment-field">Участок<select id="edge-label-segment" ${e.labelCentered===false?'disabled':''}><option value="auto">Автоматически</option>${C.routeSegments(route).map(s=>`<option value="${s.index}" ${e.labelSegment===s.index?'selected':''}>${s.index+1} · ${s.vertical?'вертикальный':'горизонтальный'}</option>`).join('')}</select></label>`:'';}
function copyRoute(to,from){for(const key of ['manualRoute','manualRouteMode','waypoints'])if(from[key]!==undefined)to[key]=C.clone(from[key]);else delete to[key];}
function previewStraightRoutes(base,ids){const now=new Set(ids),previous=S.snappedRoutes||new Set();for(const id of new Set([...now,...previous])){const original=base.edges.find(e=>e.id===id);if(!original)continue;for(const edge of [page().edges.find(e=>e.id===id),S.display.edges.find(e=>e.id===id)].filter(Boolean))copyRoute(edge,now.has(id)?{}:original);}S.snappedRoutes=now;}
function alignConnection(){
 if(S.readOnly||!S.selectedEdge)return;const edge=page().edges.find(e=>e.id===S.selectedEdge),ns=new Map(S.display.nodes.map(n=>[n.id,n]));if(!edge||edge.bus)return;
 const a=C.endpoint(ns.get(edge.source),edge.sourcePort,'right'),b=C.endpoint(ns.get(edge.target),edge.targetPort,'left'),axis=C.connectionAxis(a,b);if(!axis)return toast('Для прямой связи выберите встречные порты: слева/справа или сверху/снизу.');
 const plan=C.dragPlan(page(),new Set([edge.target]),collapsed(),S.editModes);if(plan.locked.length)return toast(movementMessage(plan));if(plan.ids.has(edge.source))return toast('Снимите относительное закрепление у конечного блока: цепочка возвращается к источнику.');
 change(()=>{S.project.pages[S.pageIndex]=C.materializeLayout(page(),S.display);const base=C.clone(page());page().layoutOptions={...page().layoutOptions,busSymmetry:false,autoSpace:false};S.compact=false;applyMovement(page(),base,plan.ids,axis==='x'?a.x-b.x:0,axis==='y'?a.y-b.y:0);copyRoute(page().edges.find(e=>e.id===edge.id),{});});
}
function sourceFileName(m){if(m?.filename)return m.filename;const address=m?.path||m?.url||'';if(address&&!address.startsWith('data:'))try{const tail=address.split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).at(-1);if(tail&&(/\.[a-z0-9]{2,6}$/i.test(tail)||m?.path))return decodeURIComponent(tail);}catch{}return m?.title||'Источник';}
function cellSourceChip(cell,id,override=null){const m=override||findMaterial(id),option=cell.sourceOptions?.[id]||{},title=option.display==='custom'?option.label||sourceFileName(m):sourceFileName(m),named=option.display==='auto'||option.display==='custom';return `<span class="cell-source" data-cell-source="${esc(id)}" title="${esc(title)}">${fileIcon(m)}${named?`<span class="cell-source-name">${esc(title)}</span>`:''}<button class="cell-source-location" data-material-action="location" data-material-id="${esc(id)}" title="Расположение источника" aria-label="Расположение источника">${uiIcon('folder')}</button></span>`;}


/* Quick table editing stays on the canvas; the dialog handles advanced changes. */
let quickEdit=null;
function quickTableTools(n){
 if(S.readOnly||!n.table||S.folded.has(n.id))return '';
 const met=C.tableMetrics(n),sum=n.table.widths.reduce((a,b)=>a+b,0),grips=[];let x=0,y=met.header;
 if(!n.locked){n.table.widths.forEach((w,i)=>{x+=w/sum*n.w;grips.push(`<span class="quick-col-grip" data-quick-col="${i}" data-quick-node="${esc(n.id)}" style="left:${x-3}px;top:${met.header}px;height:${met.dataBottom-met.header}px" title="Ширина столбца ${i+1}"></span>`);});met.heights.forEach((h,i)=>{y+=h;grips.push(`<span class="quick-row-grip" data-quick-row="${i}" data-quick-node="${esc(n.id)}" style="top:${y-3}px" title="Высота строки ${i+1}"></span>`);});}
 return `<div class="quick-table-tools" data-quick-node="${esc(n.id)}"><button data-quick-action="row" title="Добавить строку ниже выбранной">＋ Строка</button><button data-quick-action="col" title="Добавить столбец справа">＋ Столбец</button><button data-quick-action="advanced" title="Продвинутый редактор">${uiIcon('table')} Редактор</button></div>`+grips.join('');
}
function finishQuickEdit(save=true){
 const edit=quickEdit;if(!edit)return;quickEdit=null;edit.el.removeAttribute('contenteditable');edit.el.classList.remove('quick-editing');
 if(!save){edit.el.innerHTML=edit.html;return;}
 const text=edit.el.innerText.replace(/\u00ad/g,''),html=cleanHTML(edit.el.innerHTML);if(html===edit.html&&text===edit.text)return;
 const n=page().nodes.find(n=>n.id===edit.node),cell=n?.table?.cells[edit.r]?.[edit.c];if(cell)change(()=>{cell.text=text;cell.html=html;n.h=C.tableMetrics(n).total;});
}
function beginQuickEdit(td,event){
 if(S.readOnly)return;finishQuickEdit();const node=td.closest('[data-node]').dataset.node,[r,c]=td.dataset.tableCell.split(',').map(Number),el=td.querySelector('.cell-text');if(!el)return;
 S.quickCell={node,r,c};el.contentEditable='true';el.spellcheck=false;el.classList.add('quick-editing');quickEdit={node,r,c,el,html:el.innerHTML,text:el.innerText.replace(/\u00ad/g,'')};el.focus();
 if(event){const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);if(range&&el.contains(range.commonAncestorContainer)){const sel=getSelection();sel.removeAllRanges();sel.addRange(range);}}
 el.onblur=()=>{if(quickEdit?.el===el)finishQuickEdit()};
}
function handleQuickPointer(e){
 const button=e.target.closest('[data-quick-action]');if(button&&!S.readOnly){e.preventDefault();e.stopPropagation();const id=button.closest('[data-quick-node]').dataset.quickNode,job=button.dataset.quickAction;finishQuickEdit();const n=page().nodes.find(n=>n.id===id);if(!n)return true;
  if(job==='advanced'){tableEditor(n);return true;}const sel=S.quickCell?.node===id?S.quickCell:{r:n.table.cells.length-1,c:n.table.widths.length-1};change(()=>{n.table=C.tableAxis(n.table,job==='row'?'row':'col',(job==='row'?sel.r:sel.c)+1);C.initTable(n);n.w=n.table.widths.reduce((a,b)=>a+b,0);n.h=C.tableMetrics(n).total;});return true;
 }
 const grip=e.target.closest('[data-quick-col],[data-quick-row]');if(grip&&!S.readOnly){e.preventDefault();e.stopPropagation();finishQuickEdit();const id=grip.dataset.quickNode,n=page().nodes.find(n=>n.id===id);if(!n||n.locked)return true;
  const d=S.display.nodes.find(n=>n.id===id),table=C.clone(d.table),met=C.tableMetrics(d),col=grip.dataset.quickCol!==undefined,index=+(col?grip.dataset.quickCol:grip.dataset.quickRow),origin=worldPoint(e);let moved=false;
  startDrag(e,ev=>{const p=worldPoint(ev),delta=col?p.x-origin.x:p.y-origin.y;if(!moved&&Math.abs(delta)*S.view.z<3)return;if(!moved){checkpoint();moved=true;}
   n.table=C.clone(table);if(col){n.table.widths[index]=Math.max(32,table.widths[index]+delta);n.w=n.table.widths.reduce((a,b)=>a+b,0);}else{n.table.autoSize=false;n.table.heights=[...met.heights];n.table.heights[index]=Math.max(24,met.heights[index]+delta);}
   const fitted=C.fitTableWords(n);Object.assign(d,fitted);d.h=n.h=C.tableMetrics(d).total;const el=$(`#nodes [data-node="${CSS.escape(id)}"]`);if(el)el.outerHTML=nodeHTML(d);renderEdges();
  },()=>{if(moved){changed();render();}});return true;
 }
 if(e.target.closest('.quick-editing')){e.stopPropagation();return true;}
 const td=e.target.closest('[data-table-cell]');if(td){const [r,c]=td.dataset.tableCell.split(',').map(Number);S.quickCell={node:td.closest('[data-node]').dataset.node,r,c};}
 return false;
}

window.Studio={deleteSegment,measureNode,materialChip,fileIcon,fileType,materialLocation,materialExternal,jumpToCell,measureCell,setTool,renderInspector,renderEdges,uiIcon,pagesDialog,searchDialog,checkHTTP,checkMaterial,checkAllMaterials,materialCheckDialog,renderGuides,highlightCommonPorts,state:S,Core:C,init,home,render,fit,focusNode,action,save,saveDocument,makeNode,addNode,tableEditor,registry,preparePrint,exportHTML,exportJSON,portableProject,openMaterial,showNodeMaterials,change,uploadFile,assetURL,normalize,cleanHTML,groupsDialog,groupEditor,arrangeSelection,addRoutePoint,resetRoute,nudge,parseDocumentText,openDocumentFile,activateDocument,buildDocumentHTML,bindFolder,resolveMaterial,toggleNode,connectPorts,choosePort,undo,redo,combineSelected,tableHTML,sceneBounds,get document(){return DOC;}};
init();
