'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const EXTENSIONS=new Set('.pdf .doc .docx .odt .rtf .ppt .pptx .odp .xls .xlsx .ods .csv .txt .png .jpg .jpeg .gif .webp .svg .mp4 .webm .mov .mkv .mp3 .wav .ogg .html .htm .xml .json .zip'.split(' '));
const MIME={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',webm:'video/webm',mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',html:'text/html',htm:'text/html',json:'application/json',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const canonical=p=>{p=path.resolve(p);try{return fs.realpathSync(p)}catch{return p}},key=p=>canonical(p).toLowerCase(),inside=(p,folder)=>{const rel=path.relative(key(folder),key(p));return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)},digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fileDigest(p){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(p))hash.update(chunk);return hash.digest('hex');}
async function verifyPDF(handle,p){
 const header=Buffer.alloc(8),{bytesRead}=await handle.read(header,0,header.length,0);
 if(path.extname(p).toLowerCase()!=='.pdf'||bytesRead!==header.length||!/^%PDF-\d\.\d$/.test(header.toString('latin1')))throw Error('Для просмотра нужен файл PDF с корректной сигнатурой');
}
class FileBridge {
 constructor({root,state,picker,opener}){this.root=canonical(root);this.state=state;this.picker=picker;this.opener=opener;this.grants=new Set();this.folders=new Set([this.root]);this.signingKey=crypto.randomBytes(32).toString('hex');this.saveQueue=Promise.resolve();if(fs.existsSync(state)){const saved=JSON.parse(fs.readFileSync(state,'utf8'));this.grants=new Set(saved.files||[]);for(const p of saved.folders||[])this.folders.add(p);if(saved.signingKey)this.signingKey=saved.signingKey;}}
 remember(p,document=false){p=canonical(p);this.supported(p);this.grants.add(key(p));if(document)this.folders.add(canonical(path.dirname(p)));fs.mkdirSync(path.dirname(this.state),{recursive:true});const temp=this.state+'.tmp';fs.writeFileSync(temp,JSON.stringify({files:[...this.grants],folders:[...this.folders],signingKey:this.signingKey}));fs.renameSync(temp,this.state);return p;}
 supported(p){if(!EXTENSIONS.has(path.extname(p).toLowerCase()))throw Error('Этот тип файла не поддерживается');}
 permitted(p){return this.grants.has(key(p))||[...this.folders].some(folder=>inside(p,folder));}
 resolve(data){let p;const rel=data.path||'',parent=data.documentPath&&canonical(path.dirname(data.documentPath)),knownParent=parent&&[...this.folders].some(folder=>key(folder)===key(parent));
  if(knownParent&&typeof rel==='string'&&rel&&!path.isAbsolute(rel)&&!path.win32.isAbsolute(rel)&&!rel.includes('\0')){const relative=canonical(path.resolve(parent,rel));if(this.permitted(relative)&&fs.existsSync(relative)){this.supported(relative);return relative;}}
  if(data.nativePath){if(!path.isAbsolute(data.nativePath))throw Error('Нужен полный путь к оригиналу');p=canonical(data.nativePath)}else{if(!rel||path.isAbsolute(rel)||rel.replaceAll('\\','/').split('/').includes('..'))throw Error('Некорректный относительный путь');p=canonical(path.join(knownParent?parent:this.root,rel));}
  if(!this.permitted(p))throw Error('Выберите оригинал кнопкой «Заменить», чтобы предоставить доступ');this.supported(p);return p;
 }
 signature(p){return crypto.createHmac('sha256',this.signingKey).update(key(p)).digest('hex');}
 openURL(p){return 'pipelinestudio://open?path='+encodeURIComponent(canonical(p))+'&key='+this.signature(p);}
 pdfURL(p){return 'studio-pdf://material/'+encodeURIComponent(path.basename(p))+'?path='+encodeURIComponent(canonical(p))+'&key='+this.signature(p);}
 async pdfSource(raw){
  const u=new URL(raw),p=this.resolve({nativePath:u.searchParams.get('path')}),given=u.searchParams.get('key')||'',expected=this.signature(p);
  if(u.protocol!=='studio-pdf:'||u.hostname!=='material'||given.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(given),Buffer.from(expected)))throw Error('Нет доступа к PDF');
  const handle=await fsp.open(p,'r');
  try{
   const stat=await handle.stat();
   if(!stat.isFile())throw Error('PDF недоступен');
   await verifyPDF(handle,p);
   return {nativePath:p,size:stat.size,handle};
  }catch(error){
   await handle.close().catch(()=>{});
   throw error;
  }
 }
 async metadata(p,document=false){p=canonical(p);const out={nativePath:p,filename:path.basename(p),path:inside(p,this.root)?path.relative(this.root,p).replaceAll('\\','/'):'',fileURL:pathToFileURL(p).href};try{const stat=await fsp.stat(p);if(!stat.isFile())return {...out,state:'missing',detail:'По этому пути нет файла'};if(document&&stat.size>40*1024*1024)throw Error('Документ превышает 40 МБ');const handle=await fsp.open(p,'r');try{await handle.read(Buffer.alloc(1),0,1,0)}finally{await handle.close()}Object.assign(out,{state:'ok',size:stat.size,lastModified:Math.floor(stat.mtimeMs),mime:MIME[path.extname(p).slice(1).toLowerCase()]||'application/octet-stream',detail:'Исходный файл найден на диске'});if(document)out.digest=await fileDigest(p);}catch(e){if(e.code==='ENOENT')Object.assign(out,{state:'missing',detail:'Исходный файл перемещён или удалён'});else if(e.code==='EACCES'||e.code==='EPERM')Object.assign(out,{state:'denied',detail:'Нет доступа к исходному файлу'});else throw e;}return out;}
 async openURI(raw){const u=new URL(raw);if(u.protocol!=='pipelinestudio:'||u.hostname!=='open')throw Error('Некорректная ссылка Studio');const p=this.resolve({nativePath:u.searchParams.get('path')}),given=u.searchParams.get('key')||'',expected=this.signature(p);if(given.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(given),Buffer.from(expected)))throw Error('Ссылка не принадлежит этой Studio. Откройте HTML в приложении и замените источник.');const action=u.searchParams.get('action')||'open';if(!['open','folder'].includes(action))throw Error('Неизвестная команда ссылки Studio');return this.command(action,{nativePath:p});}
 async command(route,data={}){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Некорректная команда');
  if(['pick','pick-document','pick-save'].includes(route)){const chosen=await this.picker(route,data);if(!chosen)return {cancelled:true};if(route==='pick-save'&&!/\.(html?|xml)$/i.test(chosen))throw Error('Сохраните документ как HTML или XML');const p=this.remember(chosen,route!=='pick'),info=await this.metadata(p,route==='pick-document');if(route==='pick-save'&&info.state==='ok')info.digest=await fileDigest(p);info.openURL=this.openURL(p);if(data.documentPath){const relative=path.relative(path.dirname(data.documentPath),p);info.path=path.isAbsolute(relative)?'':relative.replaceAll('\\','/');}return info;}
  const p=this.resolve(data);
  if(route==='stat'){const info=await this.metadata(p);if(data.pdf&&info.state==='ok'){const handle=await fsp.open(p,'r');try{await verifyPDF(handle,p)}finally{await handle.close()}info.pdf=true;info.pdfURL=this.pdfURL(p);}return info;}
  if(route==='link')return {nativePath:p,openURL:this.openURL(p)};
  if(route==='read-document'){if(!/\.(html?|xml|json)$/i.test(p))throw Error('Нужен HTML, XML или JSON Studio');const stat=await fsp.stat(p);if(stat.size>40*1024*1024)throw Error('Документ слишком большой');return {text:await fsp.readFile(p,'utf8')};}
  if(route==='open'||route==='folder'){const info=await this.metadata(p);if(info.state!=='ok')throw Error(info.detail);await this.opener(p,route==='folder');return {opened:true,nativePath:p};}
  if(route==='save'){
   const run=async()=>{
    if(!this.grants.has(key(p))||!/\.(html?|xml)$/i.test(p))throw Error('Сначала выберите HTML или XML для сохранения');
    const text=data.text,xml=/\.xml$/i.test(p);
    if(typeof text==='string'&&Buffer.byteLength(text,'utf8')>40*1024*1024)throw Error('Документ превышает 40 МБ');
    if(typeof text!=='string'||!text.includes('id="pipeline-document"')||
       xml!==text.startsWith('<?xml ')||(xml&&!text.includes('data-pipeline-studio="1"')))throw Error('Нужен документ Studio выбранного формата');
    if(fs.existsSync(p)&&await fileDigest(p)!==data.digest)throw Error('Файл изменён другим процессом. Используйте «Сохранить как».');
    const temp=p+'.studio-'+crypto.randomBytes(5).toString('hex')+'.tmp';
    try{await fsp.writeFile(temp,text,'utf8');await fsp.rename(temp,p)}finally{await fsp.unlink(temp).catch(()=>{})}
    return {...await this.metadata(p),digest:digest(Buffer.from(text,'utf8')),size:Buffer.byteLength(text,'utf8')};
   };
   const job=this.saveQueue.then(run,run);this.saveQueue=job.catch(()=>{});return job;
  }
  throw Error('Неизвестная команда');
 }
}
module.exports={FileBridge,EXTENSIONS};
