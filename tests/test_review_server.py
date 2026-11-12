"""Review regressions through real HTTP handlers and isolated synthetic files."""
import concurrent.futures, importlib.util, json, os, subprocess, sys, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch
from test_server import Client
from importer import import_drawio

B=Path(__file__).resolve().parents[1]

class ReviewServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        with patch.dict(os.environ,{'STUDIO_DATA':cls.tmp.name,'STUDIO_PASSWORD':'review-editor','STUDIO_READER_PASSWORD':'review-reader'}):
            spec=importlib.util.spec_from_file_location('review_server',B/'app/server.py');cls.s=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.s)
        class QuietHandler(cls.s.Handler):
            def log_message(self,*args):pass
        cls.http=cls.s.ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join();cls.tmp.cleanup()
    def setUp(self):
        self.seed=json.loads((B/'app/data/seed.json').read_text('utf8'))
        with self.s.LOCK:
            self.s.write(self.s.DATA/'project.json',self.seed);self.s.write(self.s.DATA/'materials.json',[]);self.s.SESSIONS.clear()
        self.editor=Client(self.base);self.assertEqual(self.editor.call('/api/login','POST',{'password':'review-editor'})[0],200)
    def upload(self,data=b'original',replace=None):
        headers={'X-File-Name':'original.docx'}
        if replace:headers['X-Replace-Material']=replace
        code,m,_=self.editor.call('/api/upload','POST',data,headers);self.assertEqual(code,200,m);return m
    def project(self):return self.editor.call('/api/project')[1]
    def test_01_both_registry_writes_reject_unsafe_ids_atomically(self):
        bad=['/outside/file',r'C:\Author\secret.docx',r'\\host\share\secret.docx','../secret','a'*32+'/../secret','a'*32+':stream','%2e%2e%2fsecret','a'*32+'\n',17,False,[],{}]
        for route in ['/api/project','/api/materials']:
            for field in ['asset','previewAsset']:
                for value in bad:
                    with self.subTest(route=route,field=field,value=value):
                        mat={'id':'bad',field:value,'version':1};before=self.project()
                        body={**before,'materials':[mat]} if route=='/api/project' else [mat]
                        self.assertEqual(self.editor.call(route,'PUT',body)[0],400)
                        self.assertEqual(self.project(),before)
    def test_02_valid_and_missing_attachment_ids_and_internal_links_still_save(self):
        original=self.upload();manual=self.upload(b'%PDF-manual')
        mats=[original,manual,{'id':'preview','asset':None,'previewAsset':manual['asset'],'version':1},{'id':'offline','asset':'f'*32,'previewAsset':'e'*32+'-preview'},{'id':'internal','kind':'node','target':{'pageId':self.seed['pages'][0]['id']}}]
        p=self.project();p['materials']=mats;self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
        self.assertEqual(self.editor.call('/api/materials','PUT',mats)[0],200)
        self.assertEqual(self.editor.call('/media/'+original['asset'])[1],b'original')
        p=self.project();p.pop('materials');self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
        self.assertEqual(len(self.project()['materials']),len(mats))
    def test_03_logout_revokes_replayed_editor_and_reader_tokens_only(self):
        for password in ['review-editor','review-reader']:
            with self.subTest(role=password):
                client=Client(self.base);other=Client(self.base)
                login=client.call('/api/login','POST',{'password':password});cookie=login[2]['Set-Cookie'].split(';')[0]
                other_cookie=other.call('/api/login','POST',{'password':'review-editor'})[2]['Set-Cookie'].split(';')[0]
                self.assertEqual(client.call('/api/logout','POST',headers={'Cookie':'studio=unknown; '+cookie})[0],200)
                replay=Client(self.base);self.assertEqual(replay.call('/api/project',headers={'Cookie':cookie})[0],401)
                self.assertEqual(replay.call('/api/project',headers={'Cookie':other_cookie})[0],200)
                self.assertEqual(client.call('/api/login','POST',{'password':'review-editor'})[0],200)
                self.assertEqual(client.call('/api/project')[0],200)
        self.assertEqual(Client(self.base).call('/api/logout','POST')[0],200)
    def test_04_unsafe_preexisting_registry_cannot_reach_converter(self):
        outside=Path(self.tmp.name)/'outside.docx';outside.write_bytes(b'outside')
        for asset in [str(outside),'../outside.docx']:
            with self.subTest(asset=asset),self.s.LOCK:self.s.write(self.s.DATA/'materials.json',[{'id':'legacy','asset':asset,'filename':'legacy.docx'}])
            with patch.object(self.s.subprocess,'run') as converter:
                self.assertEqual(self.editor.call('/api/preview/legacy','POST')[0],400);converter.assert_not_called()
        self.assertFalse(Path(str(outside)+'-preview').exists());self.assertEqual(outside.read_bytes(),b'outside')
    def test_05_resolved_asset_containment_rejects_external_symlinks(self):
        external=Path(self.tmp.name)/'outside-assets';external.mkdir(exist_ok=True);(external/'source.docx').write_bytes(b'private')
        link=self.s.ASSETS/('c'*32)
        # Directory junctions on Windows exercise the same resolved containment
        # without requiring the optional Windows symlink privilege.
        if os.name=='nt':
            import subprocess
            subprocess.run(['cmd','/c','mklink','/J',str(link),str(external)],check=True,capture_output=True)
        else:link.symlink_to(external,target_is_directory=True)
        try:
            with self.assertRaises(ValueError):self.s.asset_path(link.name)
            self.s.write(self.s.DATA/'materials.json',[{'id':'junction','asset':link.name,'filename':'legacy.docx'}])
            self.assertEqual(self.editor.call('/api/preview/junction','POST')[0],400)
            self.assertEqual(self.editor.call('/media/'+link.name)[0],404)
        finally:
            if os.name=='nt':link.rmdir()
            else:link.unlink()
    def convert(self,release=None,started=None,seen=None):
        def run(args,**kwargs):
            source=Path(args[-1]);content=source.read_bytes()
            if seen is not None:seen.append(content)
            if started:started.set()
            if release and not release.wait(10):raise RuntimeError('conversion release timed out')
            (source.parent/'input.pdf').write_bytes(b'%PDF-'+content)
        return patch.object(self.s.shutil,'which',return_value='controlled-converter'),patch.object(self.s.subprocess,'run',side_effect=run)
    def test_06_preview_conversion_matches_the_current_original(self):
        mat=self.upload();which,convert=self.convert()
        with which,convert:code,converted,_=self.editor.call('/api/preview/'+mat['id'],'POST')
        self.assertEqual(code,200,converted);self.assertEqual(converted['asset'],mat['asset']);self.assertEqual(self.editor.call('/media/'+converted['previewAsset'])[1],b'%PDF-original')
    def test_07_replacing_original_during_conversion_rejects_stale_preview(self):
        mat=self.upload(b'A');release=threading.Event();started=threading.Event();seen=[];before=set(self.s.ASSETS.iterdir());which,convert=self.convert(release,started,seen)
        with which,convert,concurrent.futures.ThreadPoolExecutor() as pool:
            future=pool.submit(self.editor.call,'/api/preview/'+mat['id'],'POST')
            self.assertTrue(started.wait(5))
            replacement=self.upload(b'B',mat['id']);release.set();code,result,_=future.result(10)
        self.assertEqual(code,409,result);current=next(m for m in self.project()['materials'] if m['id']==mat['id']);self.assertEqual(current['asset'],replacement['asset']);self.assertNotIn('previewAsset',current)
        self.assertEqual(seen,[b'A']);self.assertFalse(any(p.name.endswith('-preview') for p in set(self.s.ASSETS.iterdir())-before))
    def test_08_importer_keeps_column_widths_with_sorted_text_cli_and_http(self):
        xml=b'<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="t" style="shape=table" vertex="1" parent="1"><mxGeometry width="400" height="90"/></mxCell><mxCell id="r" style="shape=tableRow" vertex="1" parent="t"><mxGeometry width="400" height="40"/></mxCell><mxCell id="right" value="Right" vertex="1" parent="r"><mxGeometry x="100" width="300" height="40"/></mxCell><mxCell id="left" value="Left" vertex="1" parent="r"><mxGeometry x="0" width="100" height="40"/></mxCell></root></mxGraphModel></diagram></mxfile>'
        source=Path(self.tmp.name)/'shuffled.drawio';result=Path(self.tmp.name)/'imported.json';source.write_bytes(xml)
        subprocess.run([sys.executable,str(B/'app/importer.py'),str(source),str(result)],check=True,capture_output=True)
        for p in [import_drawio(xml),self.editor.call('/api/import','POST',xml)[1],json.loads(result.read_text('utf8'))]:
            table=next(n['table'] for n in p['pages'][0]['nodes'] if n.get('table'))
            self.assertEqual([c['text'] for c in table['cells'][0]],['Left','Right']);self.assertEqual(table['widths'],[100,300])

if __name__=='__main__':unittest.main(verbosity=2)
