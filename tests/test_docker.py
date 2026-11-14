"""Build and run the real image with synthetic runtime-state canaries only."""
import io,json,shutil,subprocess,tarfile,tempfile,time,uuid
from pathlib import Path
from urllib.request import Request,urlopen,build_opener,HTTPCookieProcessor
from http.cookiejar import CookieJar
ROOT=Path(__file__).resolve().parents[1]
def docker(*args,**kwargs):
    return subprocess.run(['docker',*args],check=True,capture_output=args[0]!='build',timeout=300,**kwargs).stdout

def main():
    key='pipeline-review-'+uuid.uuid4().hex[:12];image=key+':test';volume=key+'-data';started=False
    try:
        with tempfile.TemporaryDirectory(prefix='pipeline-docker-review-') as tmp:
            context=Path(tmp)/'context';context.mkdir()
            for name in ['Dockerfile','.dockerignore','VERSION']:shutil.copy2(ROOT/name,context/name)
            shutil.copytree(ROOT/'app',context/'app',ignore=shutil.ignore_patterns('__pycache__'))
            data=context/'app/data';data.mkdir(exist_ok=True)
            for name in ['state.json','state.json.tmp','local-files.json','project.json','materials.json','backup.json','arbitrary/future/secret.dat','assets/private.pdf','publications/private.json']:
                target=data/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('SYNTHETIC-PRIVATE-CANARY-'+key)
            docker('build','--progress=plain','--tag',image,str(context))
            archive=Path(tmp)/'image.tar';docker('image','save','-o',str(archive),image)
            with tarfile.open(archive) as outer:
                manifest=json.load(outer.extractfile('manifest.json'))[0]
                for layer in manifest['Layers']:
                    with tarfile.open(fileobj=outer.extractfile(layer)) as tar:
                        for member in tar:
                            name=member.name.lstrip('./')
                            if name.startswith('srv/pipeline/app/data/') and member.isfile():
                                assert name=='srv/pipeline/app/data/seed.json',name
            docker('run','--rm',image,'python','-c',"from pathlib import Path;p=Path('/srv/pipeline/app/data');assert sorted(str(x.relative_to(p)) for x in p.rglob('*') if x.is_file())==['seed.json'];assert Path('/srv/pipeline/VERSION').read_text().strip()")
            print('PASS Docker layers and final filesystem contain only the public seed')
            docker('volume','create',volume)
            docker('run','-d','--name',key,'-p','127.0.0.1::8765','-v',volume+':/data','-e','STUDIO_PASSWORD=docker-synthetic-editor',image);started=True
            binding=json.loads(docker('inspect',key))[0]['NetworkSettings']['Ports']['8765/tcp'][0]
            base='http://127.0.0.1:'+binding['HostPort'];client=build_opener(HTTPCookieProcessor(CookieJar()))
            def call(route,method='GET',body=None,headers=None):
                payload=json.dumps(body).encode() if isinstance(body,dict) else body
                with client.open(Request(base+route,data=payload,method=method,headers={'Content-Type':'application/json',**(headers or {})}),timeout=2) as r:
                    raw=r.read();return json.loads(raw) if r.headers.get_content_type()=='application/json' else raw
            def ready():
                for _ in range(30):
                    try:call('/api/session');return
                    except Exception:time.sleep(.1)
                raise AssertionError(docker('logs',key).decode())
            ready();call('/api/login','POST',{'password':'docker-synthetic-editor'});p=call('/api/project');assert p['format']=='pipeline-studio' and p['pages']
            material=call('/api/upload','POST',b'SYNTHETIC-UPLOAD',{'X-File-Name':'test.txt','Content-Type':'application/octet-stream'})
            assert call('/media/'+material['asset'])==b'SYNTHETIC-UPLOAD'
            docker('restart',key)
            binding=json.loads(docker('inspect',key))[0]['NetworkSettings']['Ports']['8765/tcp'][0]
            base='http://127.0.0.1:'+binding['HostPort'];ready();call('/api/login','POST',{'password':'docker-synthetic-editor'})
            assert any(m['id']==material['id'] for m in call('/api/project')['materials'])
            assert call('/media/'+material['asset'])==b'SYNTHETIC-UPLOAD'
            print('PASS Docker nonroot startup, session, seed, upload and volume persistence after restart')
    finally:
        if started:docker('rm','-f',key)
        subprocess.run(['docker','volume','rm',volume],capture_output=True)
        subprocess.run(['docker','image','rm',image],capture_output=True)
    print('TOTAL 2')
if __name__=='__main__':main()
