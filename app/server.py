"""Local/LAN Pipeline Studio server. Python 3.10+, no third-party dependencies.
The default bind is 127.0.0.1. A LAN bind requires STUDIO_PASSWORD.
For a real deployment put an authenticated HTTPS reverse proxy in front.
"""
from __future__ import annotations
import argparse, base64, copy, hashlib, hmac, io, json, math, mimetypes, os, re, secrets, shutil, subprocess, tempfile, threading, time, uuid, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from importer import import_drawio

BASE=Path(__file__).resolve().parent
DATA=Path(os.environ.get('STUDIO_DATA', str(BASE/'data'))).resolve()
DATA.mkdir(parents=True,exist_ok=True)
ASSETS=DATA/'assets'; ASSETS.mkdir(exist_ok=True)
PUB=DATA/'publications';PUB.mkdir(exist_ok=True)
LOCK=threading.RLock(); SESSIONS={}
PASSWORD=os.environ.get('STUDIO_PASSWORD',''); READER=os.environ.get('STUDIO_READER_PASSWORD','')
MAX_UPLOAD=512*1024*1024
VERSION=(BASE.parent/'VERSION').read_text('utf8').strip()
STATE_KEYS={'project.json':'project','materials.json':'materials','project.previous.json':'previous'}

def load(path,default=None):
    if path.parent==DATA and path.name in STATE_KEYS and (DATA/'state.json').exists():
        state=json.loads((DATA/'state.json').read_text('utf8'))
        return state.get(STATE_KEYS[path.name],default)
    return json.loads(path.read_text('utf8')) if path.exists() else default

def write(path,obj):
    if path.parent==DATA and path.name in STATE_KEYS:
        with LOCK:
            state=load(DATA/'state.json') or {key:load(DATA/name) for name,key in STATE_KEYS.items()}
            state[STATE_KEYS[path.name]]=obj
            return write(DATA/'state.json',state)
    tmp=path.with_suffix(path.suffix+'.tmp')
    try:
        with tmp.open('w',encoding='utf8') as f:
            json.dump(obj,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
    finally:
        if tmp.exists():tmp.unlink()

def commit_state(project,materials,previous=None):
    project={k:v for k,v in project.items() if k not in ('materials','deletedMaterials')}
    state={'project':project,'materials':materials,'previous':previous if previous is not None else load(DATA/'project.previous.json')}
    write(DATA/'state.json',state)

def commit_materials(materials):
    p=load(DATA/'project.json');p['revision']=p.get('revision',0)+1
    commit_state(p,materials)
    return p['revision']

def initialize():
    with LOCK:
        if (DATA/'state.json').exists():return
        seed=load(DATA/'project.json') or load(BASE/'data'/'seed.json')
        commit_state(seed,load(DATA/'materials.json',seed.get('materials',[])))

def checked_mime(value):
    # Parse before headers are started, including for old on-disk registries.
    token="[!#$%&'*+.^_|~0-9A-Za-z"+chr(96)+"-]+"
    quoted=r'"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"'
    if not isinstance(value,str) or not re.fullmatch(token+'/'+token+r'(?: *; *'+token+'=(?:'+token+'|'+quoted+r'))*',value):
        raise ValueError('Некорректный MIME-тип')
    return value,value.split(';',1)[0].lower()

def check_presentation(obj):
    def number(item,key,low,high,legacy_string=False):
        if key not in item:return
        value=item[key]
        if legacy_string and isinstance(value,str) and re.fullmatch(r'\s*\d+(?:\.\d+)?\s*',value):value=float(value)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low<=value<=high:raise ValueError('Некорректное поле '+key)
        item[key]=value
    for pg in obj.get('pages',[]):
        for n in pg.get('nodes',[]):
            number(n,'fontSize',1,1000,True)
            if n.get('table'):
                t=n['table']
                if 'wordWrap' in t and t['wordWrap'] not in ('words','hyphenate'):raise ValueError('Некорректный перенос слов')
                for row in t.get('cells',[]):
                    for cell in row:
                        if cell:number(cell,'fontSize',1,1000)
        for item in pg.get('edges',[])+pg.get('buses',[])+pg.get('drawings',[]):
            number(item,'width',0,1000);number(item,'fontSize',1,1000)

def asset_path(asset):
    if not isinstance(asset,str) or not re.fullmatch(r'[a-f0-9]{32}(?:-preview)?',asset):raise ValueError('Некорректный ID файла')
    target=(ASSETS/asset).resolve()
    if not target.is_relative_to(ASSETS.resolve()):raise ValueError('Файл вне каталога вложений')
    return target

def check_materials(mats):
    if not isinstance(mats,list):raise ValueError('Ожидается реестр материалов')
    ids=set()
    for m in mats:
        if not isinstance(m,dict) or not isinstance(m.get('id'),str) or not m['id']:raise ValueError('Некорректный ID материала')
        if m['id'] in ids:raise ValueError('Повтор ID материала')
        ids.add(m['id'])
        for key in ('version','baseVersion'):
            if key in m and (type(m[key]) is not int or not 1<=m[key]<=9007199254740991):raise ValueError('Некорректная версия материала')
        if 'mime' in m:checked_mime(m['mime'])
        for key in ('asset','previewAsset'):
            value=m.get(key)
            if value is not None and value!='':asset_path(value)
    return mats

def check_project(obj):
    if not isinstance(obj,dict) or obj.get('format')!='pipeline-studio':raise ValueError('Неизвестный формат проекта')
    if obj.get('materials') is not None:check_materials(obj['materials'])
    if not isinstance(obj.get('pages'),list) or not obj['pages']:raise ValueError('Нужна хотя бы одна страница')
    check_presentation(obj)
    ids=set()
    for p in obj['pages']:
        if p['id'] in ids:raise ValueError('Повтор ID страницы')
        ids.add(p['id']); ns={n['id'] for n in p['nodes']}
        if len(ns)!=len(p['nodes']):raise ValueError('Повтор ID блока')
        for e in p['edges']:
            if e['source'] not in ns or e['target'] not in ns:raise ValueError('Связь с отсутствующим блоком')
        groups=p.get('groups',[])
        if not isinstance(groups,list):raise ValueError('Некорректные подпроцессы')
        by_id={g['id']:g for g in groups}
        if len(by_id)!=len(groups):raise ValueError('Повтор ID подпроцесса')
        owners=set()
        for g in groups:
            seen={g['id']}; parent=g.get('parentId')
            while parent:
                if parent not in by_id:raise ValueError('Родитель подпроцесса не найден')
                if parent in seen:raise ValueError('Циклическая вложенность подпроцессов')
                seen.add(parent)
                if len(seen)>32:raise ValueError('Слишком глубокая вложенность подпроцессов')
                parent=by_id[parent].get('parentId')
            for member in g.get('members',[]):
                if member not in ns:raise ValueError('В подпроцессе указан отсутствующий блок')
                if member in owners:raise ValueError('Блок включён в несколько подпроцессов')
                owners.add(member)
        edge_ids=set()
        for edge in p['edges']:
            if edge['id'] in edge_ids:raise ValueError('Повтор ID связи')
            edge_ids.add(edge['id'])
            points=edge.get('waypoints',[])
            if not isinstance(points,list) or len(points)>64:raise ValueError('Не более 64 точек на связь')
            for point in points:
                for key in ('dx','dy'):
                    val=point.get(key) if isinstance(point,dict) else None
                    if isinstance(val,bool) or not isinstance(val,(int,float)) or not (-1e7<val<1e7):raise ValueError('Некорректная точка маршрута')
        for n in p['nodes']:
            for k in ('x','y','w','h'):
                v=n.get(k)
                if not isinstance(v,(int,float)) or not (-1e7<v<1e7):raise ValueError('Некорректные координаты')
    return obj

class MaterialLinks(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=set()
    def handle_starttag(self,tag,attrs):
        if tag=='a':
            value=dict(attrs).get('data-open-material','')
            if re.fullmatch(r'[a-zA-Z0-9_.:-]{1,200}',value):self.ids.add(value)

def used_materials(project):
    out=set()
    for p in project['pages']:
        for n in p['nodes']:
            out.update(n.get('materials',[]))
            links=MaterialLinks();links.feed(n.get('html') or '');out.update(links.ids)
            if n.get('imageMaterial'):out.add(n['imageMaterial'])
            for ic in n.get('icons',[]):
                if ic.get('material'):out.add(ic['material'])
            for row in n.get('table',{}).get('cells',[]):
                for c in row:
                    if c:
                        if c.get('material'):out.add(c['material'])
                        out.update(mid for mid in c.get('materials',[]) if isinstance(mid,str))
                        links=MaterialLinks();links.feed(c.get('html') or '');out.update(links.ids)
    registry={m['id']:m for m in load(DATA/'materials.json',[])}
    queue=list(out)
    while queue:
        mid=queue.pop();preview=registry.get(mid,{}).get('previewMaterial')
        if isinstance(preview,str) and preview not in out:out.add(preview);queue.append(preview)
    return out

class Conflict(ValueError):pass

def wire_materials(materials):
    return [{**m,'version':m.get('version',1),'baseVersion':m.get('version',1)} for m in materials]

def merge_materials(current,incoming,deleted=()):
    current={m['id']:copy.deepcopy(m) for m in current}
    removed={m['id'] for m in deleted}
    if removed.intersection(m['id'] for m in incoming or []):raise ValueError('Источник одновременно сохранён и удалён')
    for m in deleted:
        prev=current.get(m['id'])
        if prev and m['version']!=prev.get('version',1):raise Conflict('Источник обновлён в другом окне')
    for m in incoming or []:
        item={k:v for k,v in m.items() if k not in ('baseVersion','version')}
        prev=current.get(m['id'])
        if prev:
            old={k:v for k,v in prev.items() if k not in ('baseVersion','version')}
            if item==old:continue
            if m.get('baseVersion')!=prev.get('version',1):raise Conflict('Материал обновлён в другом окне. Перезагрузите проект.')
        item['version']=prev.get('version',1)+1 if prev else 1
        current[m['id']]=item
    for mid in removed:current.pop(mid,None)
    return list(current.values())

class Handler(BaseHTTPRequestHandler):
    server_version='PipelineStudio/0.7'
    def log_message(self,fmt,*args): print('%s %s'%(self.log_date_time_string(),fmt%args))
    def session_token(self):
        cookie=dict(s.strip().split('=',1) for s in self.headers.get('Cookie','').split(';') if '=' in s)
        return cookie.get('studio','')
    def role(self):
        if not PASSWORD:return 'editor'
        with LOCK:session=SESSIONS.get(self.session_token())
        return session[0] if session and session[1]>time.time() else None
    def need(self,editor=False):
        role=self.role()
        if not role:self.json({'error':'Требуется вход'},401);return False
        if editor and role!='editor':self.json({'error':'Только для редактора'},403);return False
        return True
    def json(self,obj,status=200,headers=None):
        data=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
        for k,v in (headers or {}).items():self.send_header(k,v)
        self.end_headers()
        if self.command!='HEAD':self.wfile.write(data)
    def body(self,limit=30*1024*1024):
        size=int(self.headers.get('Content-Length','0'))
        if size<0 or size>limit:raise ValueError('Превышен допустимый размер запроса')
        raw=self.rfile.read(size)
        if len(raw)!=size:raise ValueError('Загрузка прервана')
        return raw
    def origin_ok(self):
        origin=self.headers.get('Origin')
        return not origin or urlparse(origin).netloc==self.headers.get('Host')
    def host_ok(self):
        host=urlparse('//'+self.headers.get('Host','')).hostname
        return bool(PASSWORD) or host in ('127.0.0.1','localhost','::1')
    def do_GET(self):
        if not self.host_ok():return self.json({'error':'Недопустимое имя хоста для локального режима'},403)
        try:self.get()
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception as e:self.json({'error':str(e)},500)
    def do_HEAD(self):
        # Reuse authentication and file metadata; never stream content for an audit.
        if urlparse(self.path).path=='/api/backup':
            return self.json({'error':'HEAD is not supported for backup'},405)
        return self.do_GET()
    def get(self):
        url=urlparse(self.path);path=url.path;q=parse_qs(url.query)
        if path=='/api/session':return self.json({'role':self.role(),'passwordRequired':bool(PASSWORD),'version':VERSION})
        if path=='/api/project':
            if not self.need(True):return
            with LOCK:
                p=load(DATA/'project.json');p['materials']=wire_materials(load(DATA/'materials.json',[]))
            return self.json(p)
        if path=='/api/materials':
            if not self.need(True):return
            with LOCK:mats=wire_materials(load(DATA/'materials.json',[]))
            return self.json(mats)
        if path.startswith('/api/published/'):
            if not self.need():return
            key=path.rsplit('/',1)[1]
            if not re.fullmatch('[a-f0-9]{32}',key):return self.json({'error':'Не найдена публикация'},404)
            p=load(PUB/(key+'.json'))
            if not p:return self.json({'error':'Не найдена публикация'},404)
            with LOCK:
                mids=used_materials(p);p['materials']=[m for m in load(DATA/'materials.json',[]) if m['id'] in mids]
            return self.json(p)
        if path=='/api/publications':
            if not self.need():return
            pubs=[{'id':f.stem,'title':load(f).get('title'), 'time':f.stat().st_mtime} for f in PUB.glob('*.json')]
            return self.json(sorted(pubs,key=lambda p:-p['time']))
        if path=='/api/backup':
            if not self.need(True):return
            stream=io.BytesIO()
            with LOCK,zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:
                for name in STATE_KEYS:
                    value=load(DATA/name)
                    if value is not None:z.writestr(name,json.dumps(value,ensure_ascii=False))
                for f in DATA.rglob('*'):
                    if f.is_file() and f.name not in (*STATE_KEYS,'state.json') and not f.name.endswith('.tmp'):z.write(f,str(f.relative_to(DATA)))
            b=stream.getvalue();self.send_response(200);self.send_header('Content-Type','application/zip');self.send_header('Content-Disposition','attachment; filename="pipeline-backup.zip"');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        if path.startswith('/media/'):
            if not self.need():return
            aid=path.rsplit('/',1)[1]
            if not re.fullmatch('[a-f0-9]{32}(?:-preview)?',aid):return self.json({'error':'Файл не найден'},404)
            with LOCK:
                mats=load(DATA/'materials.json',[])
                if self.role()!='editor':
                    pub=q.get('view',[''])[0]
                    if not re.fullmatch('[a-f0-9]{32}',pub):return self.json({'error':'Нет доступа к материалу'},403)
                    pp=load(PUB/(pub+'.json'))
                    used=used_materials(pp) if pp else set()
                    mats=[m for m in mats if m['id'] in used]
            mat=next((m for m in mats if aid in (m.get('asset'),m.get('previewAsset'))),None)
            if not mat:return self.json({'error':'Материал не найден'},404)
            mime='application/pdf' if aid==mat.get('previewAsset') else mat.get('mime','application/octet-stream')
            try:target=asset_path(aid)
            except ValueError:return self.json({'error':'Файл не найден'},404)
            return self.file(target,mime,mat.get('filename','file'),download=('download' in q))
        if path.startswith('/api/'):return self.json({'error':'Неизвестный API'},404)
        if path=='/':path='/index.html'
        static=(BASE/'static'/path.lstrip('/')).resolve()
        if not static.is_relative_to((BASE/'static').resolve()):return self.json({'error':'Недопустимый путь'},403)
        self.file(static,mimetypes.guess_type(str(static))[0] or 'application/octet-stream')
    def file(self,path,mime,name=None,download=False):
        try:mime,base_mime=checked_mime(mime)
        except ValueError as e:return self.json({'error':str(e)},400)
        if not path.is_file():return self.json({'error':'Файл не найден'},404)
        size=path.stat().st_size;start=0;end=size-1;status=200
        range_header=self.headers.get('Range')
        if range_header:
            m=re.fullmatch(r'bytes=(\d*)-(\d*)',range_header)
            if not m or not any(m.groups()):return self.json({'error':'Неподдерживаемый Range'},416,{'Content-Range':f'bytes */{size}'})
            if m[1]:start=int(m[1]);end=min(int(m[2]) if m[2] else end,end)
            else:start=max(0,size-int(m[2]))
            if start>end or start>=size:return self.json({'error':'Range вне файла'},416,{'Content-Range':f'bytes */{size}'})
            status=206
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(max(0,end-start+1)));self.send_header('Accept-Ranges','bytes');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Cache-Control','private, no-cache')
        if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        safe_inline=base_mime.startswith(('image/','video/','audio/')) or base_mime=='application/pdf'
        if name:self.send_header('Content-Disposition',f"{'inline' if safe_inline and not download else 'attachment'}; filename*=UTF-8''{quote(name)}")
        if base_mime=='image/svg+xml':self.send_header('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'")
        self.end_headers()
        if self.command=='HEAD':return
        with path.open('rb') as f:
            f.seek(start);remaining=end-start+1
            while remaining>0:
                chunk=f.read(min(1024*256,remaining))
                if not chunk:break
                self.wfile.write(chunk);remaining-=len(chunk)
    def do_POST(self):self.mutate('POST')
    def do_PUT(self):self.mutate('PUT')
    def do_DELETE(self):self.mutate('DELETE')
    def mutate(self,method):
        try:
            if not self.host_ok():return self.json({'error':'Недопустимое имя хоста'},403)
            if not self.origin_ok():return self.json({'error':'Недопустимый источник запроса'},403)
            path=urlparse(self.path).path
            if path=='/api/login':
                body=json.loads(self.body(4096));password=str(body.get('password',''));role=None
                if PASSWORD and hmac.compare_digest(password.encode(),PASSWORD.encode()):role='editor'
                elif READER and hmac.compare_digest(password.encode(),READER.encode()):role='reader'
                if not role:time.sleep(.5);return self.json({'error':'Неверный пароль'},401)
                token=secrets.token_urlsafe(32)
                with LOCK:SESSIONS[token]=(role,time.time()+12*3600)
                return self.json({'role':role},headers={'Set-Cookie':f'studio={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+('; Secure' if os.environ.get('STUDIO_SECURE_COOKIE')=='1' else '')})
            if path=='/api/logout':
                with LOCK:SESSIONS.pop(self.session_token(),None)
                return self.json({'ok':True},headers={'Set-Cookie':'studio=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
            if not self.need(True):return
            if path=='/api/project' and method=='PUT':
                p=check_project(json.loads(self.body()))
                with LOCK:
                    old=load(DATA/'project.json')
                    if p.get('revision')!=old.get('revision'):return self.json({'error':'Проект изменён в другом окне. Сохраните копию JSON и перезагрузите страницу.'},409)
                    p['revision']=old.get('revision',0)+1
                    incoming=p.pop('materials',None)
                    deleted=p.pop('deletedMaterials',[])
                    if not isinstance(deleted,list) or any(not isinstance(m,dict) or not isinstance(m.get('id'),str) or type(m.get('version')) is not int or m['version']<1 for m in deleted):raise ValueError('Некорректный список удалённых источников')
                    mats=merge_materials(load(DATA/'materials.json',[]),incoming,deleted)
                    commit_state(p,mats,old)
                return self.json({'revision':p['revision'],'materialVersions':{m['id']:m.get('version',1) for m in mats}})
            if path=='/api/import':
                p=import_drawio(self.body(20*1024*1024));return self.json(p)
            if path=='/api/materials' and method=='PUT':
                mats=check_materials(json.loads(self.body()))
                for m in mats:
                    link=m.get('url','')
                    if link and not (link.startswith(('https://','http://','data:page/id,'))):raise ValueError('Разрешены HTTP/HTTPS-ссылки или внутренние страницы')
                with LOCK:
                    merged=merge_materials(load(DATA/'materials.json',[]),mats)
                    revision=commit_materials(merged)
                return self.json({'ok':True,'revision':revision,'materials':wire_materials(merged)})
            if path=='/api/upload':
                name=self.headers.get('X-File-Name','file')
                from urllib.parse import unquote
                name=unquote(name).replace('\\','/').split('/')[-1][:180]
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=MAX_UPLOAD:raise ValueError('Размер файла должен быть от 1 байта до 512 МБ')
                aid=uuid.uuid4().hex;target=ASSETS/aid;tmp=ASSETS/(aid+'.tmp')
                try:
                    with tmp.open('wb') as f:
                        remaining=size
                        while remaining:
                            chunk=self.rfile.read(min(1024*1024,remaining))
                            if not chunk:raise ValueError('Загрузка прервана')
                            f.write(chunk);remaining-=len(chunk)
                    os.replace(tmp,target)
                finally:
                    if tmp.exists():tmp.unlink()
                mime=mimetypes.guess_type(name)[0] or 'application/octet-stream'
                kind='video' if mime.startswith('video/') else 'audio' if mime.startswith('audio/') else 'image' if mime.startswith('image/') else 'pdf' if mime=='application/pdf' else 'document'
                mat={'id':'m-'+uuid.uuid4().hex,'title':name,'kind':kind,'asset':aid,'filename':name,'mime':mime,'size':size,'version':1,'status':'Загружен'}
                replace=self.headers.get('X-Replace-Material')
                with LOCK:
                    expected=self.headers.get('X-Project-Revision')
                    if expected is not None and expected!=str(load(DATA/'project.json')['revision']):
                        target.unlink(missing_ok=True);raise Conflict('Проект изменён в другом окне. Перезагрузите проект перед загрузкой.')
                    mats=load(DATA/'materials.json',[])
                    prev=next((m for m in mats if m['id']==replace),None)
                    if replace and not prev:raise ValueError('Материал для замены не найден')
                    if prev:
                        mat['id']=prev['id'];mat['version']=prev.get('version',1)+1;mat['title']=prev['title'];mat['history']=prev.get('history',[])+[{k:prev.get(k) for k in ('asset','filename','version')}]
                        mats=[mat if m['id']==replace else m for m in mats]
                    else:mats.append(mat)
                    revision=commit_materials(mats)
                return self.json({**wire_materials([mat])[0],'projectRevision':revision})
            if path.startswith('/api/preview/'):
                mid=path.rsplit('/',1)[1]
                with LOCK:
                    source_revision=load(DATA/'project.json')['revision']
                    expected=self.headers.get('X-Project-Revision')
                    if expected is not None and expected!=str(source_revision):raise Conflict('Проект изменён в другом окне')
                    mat=next((m for m in load(DATA/'materials.json',[]) if m['id']==mid),None)
                if not mat or not mat.get('asset'):raise ValueError('Сначала загрузите файл')
                source_asset=mat['asset'];source_version=mat.get('version',1);source=asset_path(source_asset)
                ext=Path(mat['filename']).suffix.lower()
                if ext not in ('.doc','.docx','.ppt','.pptx','.odt','.odp','.rtf'):raise ValueError('Этот формат не конвертируется')
                exe=shutil.which('libreoffice') or shutil.which('soffice')
                if not exe:
                    for pp in (r'C:\Program Files\LibreOffice\program\soffice.exe',r'C:\Program Files (x86)\LibreOffice\program\soffice.exe'):
                        if Path(pp).exists():exe=pp;break
                if not exe:return self.json({'error':'Для превью Word/PowerPoint установите LibreOffice или прикрепите PDF-превью вручную.'},422)
                with tempfile.TemporaryDirectory() as td:
                    work=Path(td);src=work/('input'+ext);shutil.copyfile(source,src)
                    profile=(work/'profile').as_uri()
                    subprocess.run([exe,'-env:UserInstallation='+profile,'--headless','--convert-to','pdf','--outdir',td,str(src)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90,check=True)
                    pdf=work/'input.pdf'
                    if not pdf.exists():raise ValueError('Конвертер не создал PDF')
                    with LOCK:
                        mats=load(DATA/'materials.json',[]);current=next((m for m in mats if m['id']==mid),None)
                        if load(DATA/'project.json')['revision']!=source_revision:raise Conflict('Проект изменён во время конвертации. Повторите создание превью.')
                        if not current or current.get('asset')!=source_asset or current.get('version',1)!=source_version:return self.json({'error':'Оригинал изменён во время конвертации. Повторите создание превью.'},409)
                        preview=uuid.uuid4().hex+'-preview';target=asset_path(preview);shutil.copyfile(pdf,target)
                        current['previewAsset']=preview;current['version']=source_version+1;mat=current
                        revision=commit_materials(mats)
                return self.json({**wire_materials([mat])[0],'projectRevision':revision})
            if path=='/api/publish':
                with LOCK:
                    p=load(DATA/'project.json');pid=uuid.uuid4().hex;p['publishedAt']=time.time();p['publicationId']=pid;write(PUB/(pid+'.json'),p)
                return self.json({'id':pid,'path':'/?view='+pid})
            return self.json({'error':'Неизвестный API'},404)
        except Conflict as e:self.json({'error':str(e)},409)
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:self.json({'error':str(e)},400)
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception as e:self.json({'error':str(e)},500)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--host',default='127.0.0.1');parser.add_argument('--port',default=8765,type=int);parser.add_argument('--open',action='store_true');a=parser.parse_args()
    if a.host not in ('127.0.0.1','localhost','::1') and not PASSWORD:parser.error('Для локальной сети задайте STUDIO_PASSWORD и при необходимости STUDIO_READER_PASSWORD')
    initialize();server=ThreadingHTTPServer((a.host,a.port),Handler)
    url=f'http://127.0.0.1:{a.port}';print(f'Pipeline Studio: {url} | Data: {DATA}',flush=True)
    if a.open:
        import webbrowser
        threading.Timer(.7,lambda:webbrowser.open(url)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
