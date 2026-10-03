"""Isolated browser fixture with real files, deterministic picker, recorded OS calls."""
import argparse,json,shutil,sys
from pathlib import Path
B=Path(__file__).resolve().parents[1];sys.path.insert(0,str(B/'app'));sys.path.insert(0,str(B))
from local import LocalFiles,LocalServer
from build_portable import build_html

args=argparse.ArgumentParser();args.add_argument('--fixture',required=True);options=args.parse_args();root=Path(options.fixture).resolve();root.mkdir(parents=True,exist_ok=True)
sources=sorted(p for p in (B/'documents').iterdir() if p.name[:2].isdigit())
for p in sources:shutil.copy2(p,root/p.name)
doc={'format':'pipeline-studio','schemaVersion':6,'id':'native-fixture','title':'Материалы','revision':0,'materials':[],'pages':[{'id':'p','title':'Лист','nodes':[{'id':'block','title':'Материалы','type':'block','x':100,'y':100,'w':240,'h':100,'materials':[]}],'edges':[],'buses':[],'groups':[],'drawings':[],'layoutOptions':{'autoSpace':False}}]}
document=root/'Native test.html';document.write_text(build_html(doc),encoding='utf-8');opened=[];cursor=0
def picker(document=False,save=False,name=''):
    global cursor
    if document:return root/'Native test.html'
    p=root/sources[cursor].name if cursor<len(sources) else root/'Moved picture.png';cursor+=1;return p
class Fixture(LocalFiles):
    def command(self,route,data):
        if route=='test-events':return {'opened':opened,'picked':cursor}
        if route=='test-move':
            p=root/sources[-1].name;p.rename(root/'Moved picture.png');return {'moved':True}
        return super().command(route,data)
files=Fixture(root,root/'private-state.json',picker=picker,opener=lambda p,folder=False:opened.append({'path':str(p),'folder':folder}))
server=LocalServer(('127.0.0.1',0),files)
print(json.dumps({'url':server.origin,'document':str(document),'files':[str(root/p.name) for p in sources]}),flush=True)
try:server.serve_forever()
finally:server.server_close()
