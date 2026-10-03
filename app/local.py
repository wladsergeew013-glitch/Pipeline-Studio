"""Optional Windows file access for standalone Studio. Loopback only, no uploads.

The UI remains the portable HTML. Selected sources are opened/read at their actual
paths; only chosen files and document folders are remembered, not file contents.
"""
from __future__ import annotations
import argparse, ctypes, hashlib, hmac, json, mimetypes, os, secrets, subprocess, threading, webbrowser
from ctypes import wintypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, quote

BASE=Path(__file__).resolve().parents[1]
EXTENSIONS=set('.pdf .doc .docx .odt .rtf .ppt .pptx .odp .xls .xlsx .ods .csv .txt .png .jpg .jpeg .gif .webp .svg .mp4 .webm .mov .mkv .mp3 .wav .ogg .html .htm .json .zip'.split())

def pick_file(document=False,save=False,name=''):
    if os.name!='nt':raise ValueError('Системный выбор файла доступен в Windows')
    class OPENFILENAME(ctypes.Structure):
        _fields_=[('lStructSize',wintypes.DWORD),('hwndOwner',wintypes.HWND),('hInstance',wintypes.HINSTANCE),('lpstrFilter',wintypes.LPCWSTR),('lpstrCustomFilter',wintypes.LPWSTR),('nMaxCustFilter',wintypes.DWORD),('nFilterIndex',wintypes.DWORD),('lpstrFile',wintypes.LPWSTR),('nMaxFile',wintypes.DWORD),('lpstrFileTitle',wintypes.LPWSTR),('nMaxFileTitle',wintypes.DWORD),('lpstrInitialDir',wintypes.LPCWSTR),('lpstrTitle',wintypes.LPCWSTR),('Flags',wintypes.DWORD),('nFileOffset',wintypes.WORD),('nFileExtension',wintypes.WORD),('lpstrDefExt',wintypes.LPCWSTR),('lCustData',ctypes.c_ssize_t),('lpfnHook',ctypes.c_void_p),('lpTemplateName',wintypes.LPCWSTR),('pvReserved',ctypes.c_void_p),('dwReserved',wintypes.DWORD),('FlagsEx',wintypes.DWORD)]
    buf=ctypes.create_unicode_buffer(32768);buf.value=name
    ctypes.windll.user32.GetForegroundWindow.restype=wintypes.HWND
    spec=OPENFILENAME();spec.lStructSize=ctypes.sizeof(spec);spec.hwndOwner=ctypes.windll.user32.GetForegroundWindow();spec.lpstrFile=ctypes.cast(buf,wintypes.LPWSTR);spec.nMaxFile=len(buf);spec.nFilterIndex=1
    spec.lpstrTitle='Сохранить документ Pipeline Studio' if save else 'Открыть документ Pipeline Studio' if document else 'Выбрать исходный файл'
    spec.lpstrFilter='Документ Pipeline Studio\0*.html;*.htm\0\0' if save else 'Документ Pipeline Studio\0*.html;*.htm;*.json\0\0' if document else 'Материалы\0'+';'.join('*'+e for e in sorted(EXTENSIONS))+'\0Все файлы\0*.*\0\0'
    spec.Flags=0x00080000|0x00000008|0x00000800|(0x00000002 if save else 0x00001000);spec.lpstrDefExt='html' if save else None
    api=ctypes.windll.comdlg32.GetSaveFileNameW if save else ctypes.windll.comdlg32.GetOpenFileNameW
    api.argtypes=[ctypes.POINTER(OPENFILENAME)];api.restype=wintypes.BOOL
    if not api(ctypes.byref(spec)):
        code=ctypes.windll.comdlg32.CommDlgExtendedError()
        if code:raise ValueError('Ошибка выбора файла Windows: '+str(code))
        return None
    return Path(buf.value)

class LocalFiles:
    def __init__(self,root,state,opener=None,picker=None):
        self.root=Path(root).resolve();self.state=Path(state);self.lock=threading.RLock();self.dialog_lock=threading.Lock()
        self.opener=opener or self.open_original;self.picker=picker or pick_file
        self.grants=set();self.folders={str(self.root)};self.signing_key=secrets.token_hex(32)
        if self.state.exists():
            data=json.loads(self.state.read_text('utf-8'));self.grants.update(data.get('files',[]));self.folders.update(data.get('folders',[]));self.signing_key=data.get('signingKey') or self.signing_key
    def open_key(self,p):return hmac.new(self.signing_key.encode(),str(Path(p).resolve()).encode(),hashlib.sha256).hexdigest()
    def remember(self,p,document=False):
        p=Path(p).resolve()
        if p.suffix.lower() not in EXTENSIONS:raise ValueError('Этот тип файла не поддерживает открытие из Studio')
        with self.lock:
            self.grants.add(str(p))
            if document:self.folders.add(str(p.parent))
            self.state.parent.mkdir(parents=True,exist_ok=True)
            temp=self.state.with_suffix('.tmp');temp.write_text(json.dumps({'files':sorted(self.grants),'folders':sorted(self.folders),'signingKey':self.signing_key},ensure_ascii=False),encoding='utf-8');os.replace(temp,self.state)
        return p
    def resolve(self,data):
        raw=data.get('nativePath') or ''
        if raw:
            if not Path(raw).is_absolute():raise ValueError('Нужен полный путь к исходному файлу')
            p=Path(raw).resolve()
        else:
            rel=data.get('path','')
            if not rel or Path(rel).is_absolute() or '..' in Path(rel.replace('\\','/')).parts:raise ValueError('Некорректный относительный путь')
            folder=self.root
            doc=data.get('documentPath')
            if doc:
                parent=Path(doc).resolve().parent
                if str(parent) in self.folders:folder=parent
            p=(folder/rel).resolve()
        with self.lock:
            permitted=str(p) in self.grants or any(p.is_relative_to(Path(folder).resolve()) for folder in self.folders)
        if not permitted:raise PermissionError('Выберите этот файл кнопкой «Заменить», чтобы предоставить доступ')
        if p.suffix.lower() not in EXTENSIONS:raise ValueError('Открытие этого типа файла не поддерживается')
        return p
    def metadata(self,p,document=False):
        p=Path(p).resolve();out={'nativePath':str(p),'filename':p.name,'path':p.relative_to(self.root).as_posix() if p.is_relative_to(self.root) else p.name}
        try:
            st=p.stat()
            if not p.is_file():return {**out,'state':'missing','detail':'По этому пути нет файла'}
            with p.open('rb') as readable:readable.read(1)
            out.update(state='ok',size=st.st_size,lastModified=int(st.st_mtime*1000),mime=mimetypes.guess_type(p.name)[0] or 'application/octet-stream',key=hashlib.sha256(str(p).encode()).hexdigest(),detail='Исходный файл найден на диске')
            if document:out['digest']=hashlib.sha256(p.read_bytes()).hexdigest()
        except FileNotFoundError:out.update(state='missing',detail='Исходный файл перемещён или удалён')
        except PermissionError:out.update(state='denied',detail='Нет доступа к исходному файлу')
        return out
    @staticmethod
    def open_original(p,folder=False):
        if os.name!='nt':raise ValueError('Открытие в системной программе доступно в Windows')
        if folder:subprocess.Popen(['explorer.exe','/select,',str(p)])
        else:os.startfile(str(p))
    def command(self,route,data):
        if route in ('pick','pick-document','pick-save'):
            with self.dialog_lock:p=self.picker(document=route!='pick',save=route=='pick-save',name=data.get('name','') if route=='pick-save' else '')
            if p is None:return {'cancelled':True}
            p=self.remember(p,document=route!='pick')
            if route=='pick-save' and p.suffix.lower() not in ('.html','.htm'):raise ValueError('Сохраните документ как HTML')
            info=self.metadata(p,document=route!='pick');info['openKey']=self.open_key(p)
            doc=data.get('documentPath')
            if doc and p.is_relative_to(Path(doc).resolve().parent):info['path']=p.relative_to(Path(doc).resolve().parent).as_posix()
            return info
        p=self.resolve(data)
        if route=='stat':return self.metadata(p)
        if route in ('open','folder'):
            if not p.is_file():raise FileNotFoundError('Исходный файл перемещён или удалён: '+str(p))
            self.opener(p,folder=route=='folder');return {'opened':True,'nativePath':str(p)}
        if route=='save':
            if str(p) not in self.grants or p.suffix.lower() not in ('.html','.htm'):raise PermissionError('Сначала выберите HTML для сохранения')
            text=data.get('text','')
            if not isinstance(text,str) or 'id="pipeline-document"' not in text:raise ValueError('Нужен HTML документа Studio')
            with self.lock:
                if p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()!=data.get('digest'):raise FileExistsError('Исходный HTML изменён другим процессом. Используйте «Сохранить как».')
                temp=p.with_name(p.name+'.studio-'+secrets.token_hex(5)+'.tmp')
                try:temp.write_text(text,encoding='utf-8',newline='\n');os.replace(temp,p)
                finally:temp.unlink(missing_ok=True)
            return self.metadata(p,document=True)
        raise ValueError('Неизвестная команда')

class LocalServer(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address,files,token=None):
        self.files=files;self.token=token or secrets.token_urlsafe(32);super().__init__(address,Handler)
        self.origin='http://127.0.0.1:'+str(self.server_port)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def headers_common(self,csp="frame-ancestors 'self'"):
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','SAMEORIGIN');self.send_header('Content-Security-Policy',csp)
    def respond(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.headers_common();self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def valid_host(self):return self.headers.get('Host')=='127.0.0.1:'+str(self.server.server_port)
    def do_POST(self):
        if not self.valid_host() or self.headers.get('Origin')!=self.server.origin or not hmac.compare_digest(self.headers.get('X-Studio-Token',''),self.server.token):return self.respond(403,{'error':'Запрос доступен только открытой локальной Studio'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.respond(415,{'error':'Нужен JSON'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=40*1024*1024:raise ValueError('Некорректный размер запроса')
            data=json.loads(self.rfile.read(size));route=urlsplit(self.path).path
            if not route.startswith('/native/'):raise ValueError('Неизвестная команда')
            result=self.server.files.command(route[8:],data);self.respond(200,result)
        except PermissionError as e:self.respond(403,{'error':str(e)})
        except FileNotFoundError as e:self.respond(404,{'error':str(e)})
        except FileExistsError as e:self.respond(409,{'error':str(e)})
        except (ValueError,TypeError,KeyError) as e:self.respond(400,{'error':str(e)})
        except OSError as e:self.respond(500,{'error':str(e)})
    def do_GET(self):
        if not self.valid_host():return self.respond(403,{'error':'Неверный адрес локальной Studio'})
        parsed=urlsplit(self.path)
        if parsed.path=='/native/health':return self.respond(200,{'studioLocal':1,'version':(BASE/'VERSION').read_text().strip()})
        if parsed.path=='/open-original':
            query=parse_qs(parsed.query);raw=query.get('path',[''])[0];key=query.get('key',[''])[0]
            if self.headers.get('Sec-Fetch-User')!='?1' or self.headers.get('Sec-Fetch-Mode')!='navigate' or not hmac.compare_digest(key,self.server.files.open_key(raw)):return self.respond(403,{'error':'Откройте источник кнопкой в вашем HTML'})
            try:
                self.server.files.command('open',{'nativePath':raw})
                body='<meta charset="utf-8"><title>Исходный файл открыт</title><p>Оригинал открыт в системной программе. Эту вкладку можно закрыть.</p>'.encode()
                self.send_response(200);self.headers_common();self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            except (OSError,ValueError) as e:self.respond(400,{'error':str(e)})
            return
        if parsed.path in ('/','/Pipeline-Studio.html'):
            config=json.dumps({'token':self.server.token,'root':str(self.server.files.root)})
            text=(BASE/'Pipeline-Studio.html').read_text('utf-8');text=text.replace('<script id="app-source">','<script>window.STUDIO_NATIVE='+config.replace('<','\\u003c')+';</script><script id="app-source">',1)
            body=text.encode();self.send_response(200);self.headers_common();self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        if parsed.path!='/native/content':return self.respond(404,{'error':'Не найдено'})
        query=parse_qs(parsed.query)
        if not hmac.compare_digest(query.get('token',[''])[0],self.server.token) or self.headers.get('Sec-Fetch-Site','same-origin') not in ('same-origin','none'):return self.respond(403,{'error':'Нет доступа'})
        try:
            raw=query.get('path',[''])[0];p=self.server.files.resolve({'nativePath':raw});length=p.stat().st_size;start=0;end=max(0,length-1);status=200
            value=self.headers.get('Range')
            if value:
                import re
                match=re.fullmatch(r'bytes=(\d*)-(\d*)',value)
                if not match:raise ValueError('Неверный диапазон')
                a,b=match.groups()
                if not a:start=max(0,length-int(b))
                else:start=int(a);end=min(length-1,int(b) if b else length-1)
                if start>=length or end<start:self.send_response(416);self.send_header('Content-Range',f'bytes */{length}');self.send_header('Content-Length','0');self.end_headers();return
                status=206
            count=0 if not length else end-start+1
            with p.open('rb') as source:
                self.send_response(status);self.headers_common("frame-ancestors 'self'; sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'" if p.suffix.lower() in ('.html','.htm','.svg') else "frame-ancestors 'self'");self.send_header('Content-Type',mimetypes.guess_type(p.name)[0] or 'application/octet-stream');self.send_header('Content-Length',str(count));self.send_header('Accept-Ranges','bytes')
                if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{length}')
                self.end_headers();source.seek(start)
                while count:
                    chunk=source.read(min(1024*1024,count))
                    if not chunk:break
                    self.wfile.write(chunk);count-=len(chunk)
        except FileNotFoundError:self.respond(404,{'error':'Исходный файл перемещён или удалён'})
        except PermissionError:self.respond(403,{'error':'Нет доступа к исходному файлу'})
        except ValueError as e:self.respond(400,{'error':str(e)})
        except (BrokenPipeError,ConnectionResetError):pass

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8766);parser.add_argument('--root',default=str(BASE));parser.add_argument('--state',default=str(BASE/'app/data/local-files.json'));parser.add_argument('--open',action='store_true');args=parser.parse_args()
    files=LocalFiles(args.root,args.state)
    try:server=LocalServer(('127.0.0.1',args.port),files)
    except OSError:
        from urllib.request import urlopen
        url='http://127.0.0.1:'+str(args.port)
        with urlopen(url+'/native/health',timeout=2) as response:assert json.load(response).get('studioLocal')==1
        if args.open:webbrowser.open(url)
        return
    if args.open:webbrowser.open(server.origin)
    try:server.serve_forever()
    finally:server.server_close()

if __name__=='__main__':main()
