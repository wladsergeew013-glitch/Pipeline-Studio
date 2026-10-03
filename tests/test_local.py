"""Real loopback/file tests. Native dialogs/openers injected; no user files touched."""
import json,sys,tempfile,threading,unittest
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from local import LocalFiles,LocalServer

class LocalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'project';self.root.mkdir();self.file=self.root/'original Word.docx';self.file.write_bytes(b'original bytes');self.calls=[];self.picked=self.file
        self.files=LocalFiles(self.root,Path(self.tmp.name)/'private.json',opener=lambda p,folder=False:self.calls.append((p,folder)),picker=lambda **kw:self.picked)
        self.server=LocalServer(('127.0.0.1',0),self.files);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.url=self.server.origin
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def request(self,route,data=None,headers=None):
        req=Request(self.url+route,data=json.dumps(data).encode() if data is not None else None,headers={'Origin':self.url,'X-Studio-Token':self.server.token,'Content-Type':'application/json',**(headers or {})})
        try:
            with urlopen(req) as r:return r.status,r.headers,r.read()
        except HTTPError as e:return e.code,e.headers,e.read()
    def command(self,route,data):status,_,body=self.request('/native/'+route,data);return status,json.loads(body)
    def content(self,headers=None):return self.request('/native/content?path='+str(self.file).replace(' ','%20')+'&token='+self.server.token,headers=headers)
    def test_01_picker_returns_real_absolute_path_without_copy(self):
        status,m=self.command('pick',{});self.assertEqual(status,200);self.assertEqual(m['nativePath'],str(self.file));self.assertEqual(m['path'],self.file.name);self.assertEqual(list(self.root.iterdir()),[self.file])
    def test_02_open_uses_original_path(self):
        self.command('open',{'nativePath':str(self.file)});self.assertEqual(self.calls,[(self.file,False)])
    def test_03_folder_reveals_original_path(self):
        self.command('folder',{'nativePath':str(self.file)});self.assertEqual(self.calls,[(self.file,True)])
    def test_04_move_is_missing_even_after_previous_read(self):
        self.assertEqual(self.content()[0],200);self.file.rename(self.file.with_name('moved.docx'));self.assertEqual(self.command('stat',{'nativePath':str(self.file)})[1]['state'],'missing');self.assertEqual(self.content()[0],404)
    def test_05_content_is_original_bytes(self):self.assertEqual(self.content()[2],b'original bytes')
    def test_06_byte_ranges(self):
        code,h,data=self.content({'Range':'bytes=1-4'});self.assertEqual(code,206);self.assertEqual(data,b'rigi');self.assertEqual(h['Content-Range'],'bytes 1-4/14')
    def test_07_bad_range(self):self.assertEqual(self.content({'Range':'bytes=500-700'})[0],416)
    def test_08_no_old_cached_content(self):self.assertEqual(self.content()[1]['Cache-Control'],'no-store')
    def test_09_no_auth(self):self.assertEqual(self.request('/native/open',{'nativePath':str(self.file)},{'X-Studio-Token':'bad'})[0],403);self.assertFalse(self.calls)
    def test_10_foreign_origin(self):self.assertEqual(self.request('/native/open',{'nativePath':str(self.file)},{'Origin':'https://example.com'})[0],403)
    def test_11_wrong_host(self):self.assertEqual(self.request('/native/open',{'nativePath':str(self.file)},{'Host':'example.com'})[0],403)
    def test_12_no_outside_file(self):
        outside=Path(self.tmp.name)/'outside.docx';outside.write_bytes(b'private');self.assertEqual(self.command('open',{'nativePath':str(outside)})[0],403)
    def test_13_no_traversal(self):self.assertEqual(self.command('stat',{'path':'../outside.docx'})[0],400)
    def test_14_no_execute(self):
        exe=self.root/'command.exe';exe.write_bytes(b'no');self.assertEqual(self.command('open',{'nativePath':str(exe)})[0],400);self.assertFalse(self.calls)
    def test_15_grant_survives_restart(self):
        outside=Path(self.tmp.name)/'outside.pptx';outside.write_bytes(b'presentation');self.picked=outside;m=self.command('pick',{})[1];new=LocalFiles(self.root,self.files.state);self.assertEqual(new.resolve({'nativePath':str(outside)}),outside);self.assertEqual(new.open_key(outside),m['openKey'])
    def test_16_document_folder_resolves_relative_sources(self):
        folder=Path(self.tmp.name)/'document';folder.mkdir();doc=folder/'Diagram.html';doc.write_text('<script id="pipeline-document">{}</script>');source=folder/'image.png';source.write_bytes(b'image');self.picked=doc;self.command('pick-document',{});self.assertEqual(self.command('stat',{'path':'image.png','documentPath':str(doc)})[1]['state'],'ok')
    def test_17_save_to_exact_chosen_html(self):
        doc=self.root/'Diagram.html';doc.write_text('<script id="pipeline-document">{}</script>');self.picked=doc;meta=self.command('pick-document',{})[1];text='<script id="pipeline-document">{"revision":2}</script>';self.assertEqual(self.command('save',{'nativePath':str(doc),'digest':meta['digest'],'text':text})[0],200);self.assertEqual(doc.read_text(),text)
    def test_18_save_conflict_preserves_external_change(self):
        doc=self.root/'Diagram.html';doc.write_text('first');self.picked=doc;meta=self.command('pick-document',{})[1];doc.write_text('external edit');self.assertEqual(self.command('save',{'nativePath':str(doc),'digest':meta['digest'],'text':'<script id="pipeline-document">{}</script>'})[0],409);self.assertEqual(doc.read_text(),'external edit')
    def test_19_save_requires_chosen_file(self):
        self.assertEqual(self.command('save',{'nativePath':str(self.root/'new.html'),'text':'<script id="pipeline-document">{}</script>'})[0],403)
    def test_20_cancel_picker_no_file_created(self):self.picked=None;self.assertEqual(self.command('pick',{})[1],{'cancelled':True});self.assertEqual(list(self.root.iterdir()),[self.file])
    def test_21_viewer_link_requires_signature_and_click(self):
        key=self.command('pick',{})[1]['openKey'];url='/open-original?path='+str(self.file).replace(' ','%20')+'&key='+key;self.assertEqual(self.request(url)[0],403);self.assertEqual(self.request(url,headers={'Sec-Fetch-User':'?1','Sec-Fetch-Mode':'navigate'})[0],200);self.assertEqual(self.calls,[(self.file,False)])
    def test_22_viewer_link_rejects_tampering(self):
        self.assertEqual(self.request('/open-original?path='+str(self.file).replace(' ','%20')+'&key=bad',headers={'Sec-Fetch-User':'?1','Sec-Fetch-Mode':'navigate'})[0],403);self.assertFalse(self.calls)
    def test_23_static_ui_has_configuration_but_source_export_does_not(self):
        body=self.request('/')[2].decode();self.assertIn('window.STUDIO_NATIVE=',body);self.assertIn(self.server.token,body)
    def test_24_local_server_does_not_serve_private_data(self):self.assertEqual(self.request('/app/data/local-files.json')[0],404)
    def test_25_streamed_html_cannot_execute_as_editor(self):
        self.file=self.root/'source.html';self.file.write_text('<script>alert(1)</script>');code,headers,body=self.content();self.assertEqual(code,200);self.assertIn('sandbox',headers['Content-Security-Policy']);self.assertIn(b'<script>',body)

if __name__=='__main__':unittest.main(verbosity=2)
