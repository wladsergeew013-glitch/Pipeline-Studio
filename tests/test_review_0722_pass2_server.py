"""Pass-two acceptance through real HTTP, filesystem, importer CLI and IPv6 CLI."""
import copy,io,json,os,queue,re,socket,subprocess,sys,tempfile,threading,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.request import ProxyHandler,build_opener
import test_review_server as fixtures
from importer import import_drawio

B=Path(__file__).resolve().parents[1]

class PassTwoServerTests(unittest.TestCase):
    setUpClass=classmethod(fixtures.ReviewServerTests.setUpClass.__func__)
    tearDownClass=classmethod(fixtures.ReviewServerTests.tearDownClass.__func__)
    setUp=fixtures.ReviewServerTests.setUp
    upload=fixtures.ReviewServerTests.upload
    project=fixtures.ReviewServerTests.project

    def test_21_relative_vertex_geometry_through_http_cli_and_original(self):
        for relative,offset,nested,expected in [('1',False,False,(400,350)),('1',True,False,(390,370)),('0',False,False,(100.75,200.5)),('0',True,False,(100.75,200.5)),('1',True,True,(520,510))]:
            with self.subTest(relative=relative,offset=offset,nested=nested):
                outer='<mxCell id="outer" vertex="1" style="group"><mxGeometry x="30" y="40" width="800" height="600"/></mxCell>' if nested else ''
                parent='parent="outer"' if nested else ''
                group=('<mxCell id="g" vertex="1" style="group" '+parent+'><mxGeometry '+('relative="1" x=".25" y=".5"' if nested else 'x="100" y="200"')+' width="400" height="300"/></mxCell>')
                point='<mxPoint x="-10" y="20" as="offset"/>' if offset else ''
                xml=('<mxGraphModel><root>'+outer+group+'<mxCell id="child" value="Child" vertex="1" parent="g"><mxGeometry relative="'+relative+'" x=".75" y=".5" width="60" height="30">'+point+'</mxGeometry></mxCell></root></mxGraphModel>').encode()
                source=Path(self.tmp.name)/'relative.drawio';result=Path(self.tmp.name)/'relative.json';source.write_bytes(xml)
                code,imported,_=self.editor.call('/api/import','POST',xml);self.assertEqual(code,200)
                subprocess.run([sys.executable,str(B/'app/importer.py'),str(source),str(result)],check=True,capture_output=True)
                for project in [import_drawio(xml),imported,json.loads(result.read_text('utf8'))]:
                    node=next(n for n in project['pages'][0]['nodes'] if n['id']=='child')
                    self.assertEqual((node['x'],node['y']),expected)
                    self.assertEqual((node['original']['x'],node['original']['y']),expected)

    def test_23_failed_upload_commit_removes_only_its_uncommitted_blob(self):
        for replace in [False,True]:
            with self.subTest(replace=replace):
                original=self.upload(b'PREVIOUS ORIGINAL');before=self.project();state=(self.s.DATA/'state.json').read_bytes();assets=set(self.s.ASSETS.iterdir());replace_file=self.s.os.replace
                def fail(source,target):
                    if Path(target)==self.s.DATA/'state.json':raise OSError('controlled upload state commit failure')
                    return replace_file(source,target)
                headers={'X-File-Name':'failed.txt'}
                if replace:headers['X-Replace-Material']=original['id']
                with patch.object(self.s.os,'replace',side_effect=fail):
                    code,_,_=self.editor.call('/api/upload','POST',b'NEW UPLOAD MUST BE ROLLED BACK',headers)
                self.assertEqual(code,500);self.assertEqual(set(self.s.ASSETS.iterdir()),assets)
                self.assertEqual((self.s.DATA/'state.json').read_bytes(),state);self.assertEqual(self.project(),before)
                self.assertEqual((self.s.ASSETS/original['asset']).read_bytes(),b'PREVIOUS ORIGINAL')
                code,backup,_=self.editor.call('/api/backup');self.assertEqual(code,200)
                with zipfile.ZipFile(io.BytesIO(backup)) as archive:
                    self.assertEqual({p.rsplit('/',1)[-1] for p in archive.namelist() if p.startswith('assets/')},{p.name for p in assets})
                retry=self.upload(b'SUCCESSFUL RETRY',original['id'] if replace else None)
                self.assertEqual((self.s.ASSETS/retry['asset']).read_bytes(),b'SUCCESSFUL RETRY')
                if replace:self.assertEqual(retry['history'][-1]['asset'],original['asset'])

    def test_23_failed_upload_validation_cleans_up_new_blob(self):
        for headers in [{'X-Replace-Material':'missing'},{'X-Project-Revision':'-1'}]:
            with self.subTest(headers=headers):
                assets=set(self.s.ASSETS.iterdir());state=(self.s.DATA/'state.json').read_bytes()
                code,_,_=self.editor.call('/api/upload','POST',b'REJECTED UPLOAD',{'X-File-Name':'rejected.txt',**headers})
                self.assertEqual(code,409 if 'X-Project-Revision' in headers else 400)
                self.assertEqual(set(self.s.ASSETS.iterdir()),assets);self.assertEqual((self.s.DATA/'state.json').read_bytes(),state)

    def test_23_error_after_commit_preserves_the_committed_file_and_history(self):
        original=self.upload(b'OLD VERSION');commit=self.s.commit_materials
        def committed_then_error(materials):
            commit(materials);raise OSError('failure after a successful atomic replace')
        with patch.object(self.s,'commit_materials',side_effect=committed_then_error):
            code,_,_=self.editor.call('/api/upload','POST',b'COMMITTED VERSION',{'X-File-Name':'new.txt','X-Replace-Material':original['id']})
        self.assertEqual(code,500);current=next(m for m in self.project()['materials'] if m['id']==original['id'])
        self.assertEqual((self.s.ASSETS/current['asset']).read_bytes(),b'COMMITTED VERSION')
        self.assertEqual((self.s.ASSETS/original['asset']).read_bytes(),b'OLD VERSION')
        self.assertEqual(current['history'][-1]['asset'],original['asset'])

class ServerAddressTests(unittest.TestCase):
    def cli(self,host):
        with tempfile.TemporaryDirectory(prefix='pipeline-address-') as temp:
            env={**os.environ,'STUDIO_DATA':temp,'STUDIO_PASSWORD':'','STUDIO_READER_PASSWORD':'','PYTHONUNBUFFERED':'1','PYTHONUTF8':'1'}
            process=subprocess.Popen([sys.executable,'-X','utf8',str(B/'app/server.py'),'--host',host,'--port','0'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf8',env=env,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            lines=queue.Queue();reader=threading.Thread(target=lambda:[lines.put(line) for line in process.stdout],daemon=True);reader.start()
            try:
                first=lines.get(timeout=15);self.assertTrue(first.startswith('Pipeline Studio: '),first)
                url=first.split('Pipeline Studio: ',1)[1].split(' | ',1)[0];self.assertNotIn(':0',url)
                self.assertIn('[::1]' if host=='::1' else '127.0.0.1',url)
                with build_opener(ProxyHandler({})).open(url+'/api/session',timeout=5) as response:
                    self.assertEqual(response.status,200);self.assertEqual(json.load(response)['role'],'editor')
            finally:
                if process.poll() is None:process.terminate()
                process.wait(timeout=5);reader.join(timeout=2);process.stdout.close()

    def test_22_ipv4_cli_still_starts_on_an_ephemeral_port(self):self.cli('127.0.0.1')
    def test_22_ipv6_loopback_cli_uses_an_ipv6_socket(self):
        try:
            with socket.socket(socket.AF_INET6,socket.SOCK_STREAM) as control:control.bind(('::1',0))
        except OSError as error:self.skipTest('IPv6 unavailable: '+str(error))
        self.cli('::1')

if __name__=='__main__':unittest.main(verbosity=2)
