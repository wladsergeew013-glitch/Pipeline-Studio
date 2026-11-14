"""Review regressions through real HTTP handlers and isolated synthetic files."""
import base64, concurrent.futures, copy, importlib.util, io, json, os, subprocess, sys, tempfile, threading, unittest, zipfile, zlib
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
        structural=xml.replace(b'style="shape=table"',b'style="swimlane;childLayout=tableLayout"')
        table=import_drawio(structural)['pages'][0]['nodes'][0]['table']
        self.assertEqual([c['text'] for c in table['cells'][0]],['Left','Right'])

    def test_09_material_updates_require_the_actual_base_version(self):
        original=self.upload(b'OLD');stale=self.project()
        replacement=self.upload(b'NEW',original['id'])
        stale['revision']=self.project()['revision']
        stale['materials'][0]['title']='stale rename';stale['materials'][0]['version']+=1
        for route,body in [('/api/project',stale),('/api/materials',stale['materials'])]:
            self.assertEqual(self.editor.call(route,'PUT',body)[0],409)
            current=self.project()['materials'][0];self.assertEqual(current['asset'],replacement['asset'])
        fresh=self.project();fresh['materials'][0]['title']='Current rename'
        response=self.editor.call('/api/project','PUT',fresh);self.assertEqual(response[0],200,response)
        current=self.project()['materials'][0];self.assertEqual(current['version'],3);self.assertEqual(current['baseVersion'],3)

    def test_10_failed_state_commit_changes_neither_registry_nor_project(self):
        self.upload();before=self.project();changed=copy.deepcopy(before);changed['title']='NEW';changed['materials'][0]['title']='NEW SOURCE'
        original=self.s.os.replace
        def fail(source,target):
            if Path(target)==self.s.DATA/'state.json':raise OSError('controlled commit failure')
            return original(source,target)
        with patch.object(self.s.os,'replace',side_effect=fail):
            self.assertEqual(self.editor.call('/api/project','PUT',changed)[0],500)
        self.assertEqual(self.project(),before);self.assertFalse((self.s.DATA/'state.json.tmp').exists())

    def test_11_backup_captures_one_generation_during_a_save(self):
        self.upload();before=self.project();started=threading.Event();release=threading.Event();original=zipfile.ZipFile.writestr
        def paused(z,name,*args,**kwargs):
            result=original(z,name,*args,**kwargs)
            if name=='project.json':started.set();self.assertTrue(release.wait(10))
            return result
        changed=copy.deepcopy(before);changed['title']='NEXT';changed['materials'][0]['title']='NEXT SOURCE'
        with patch.object(zipfile.ZipFile,'writestr',paused),concurrent.futures.ThreadPoolExecutor() as pool:
            backup=pool.submit(self.editor.call,'/api/backup');self.assertTrue(started.wait(5))
            save=pool.submit(self.editor.call,'/api/project','PUT',changed);release.set()
            code,data,_=backup.result(10);self.assertEqual(code,200);self.assertEqual(save.result(10)[0],200)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertEqual(json.loads(z.read('project.json'))['title'],before['title'])
            self.assertEqual(json.loads(z.read('materials.json'))[0]['title'],before['materials'][0]['title'])
        with tempfile.TemporaryDirectory() as restored:
            with zipfile.ZipFile(io.BytesIO(data)) as z:z.extractall(restored)
            with patch.dict(os.environ,{'STUDIO_DATA':restored}):
                spec=importlib.util.spec_from_file_location('restored_review_server',B/'app/server.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            module.initialize()
            self.assertTrue((Path(restored)/'state.json').is_file())
            self.assertEqual(module.load(Path(restored)/'project.json')['title'],before['title'])
            self.assertEqual(module.load(Path(restored)/'materials.json')[0]['asset'],before['materials'][0]['asset'])
        self.assertEqual(self.project()['title'],'NEXT')

    def test_12_mime_validation_and_parameterized_svg_sandbox(self):
        uploaded=self.upload(b'<svg/>')
        for value in ['image/svg+xml\r\nX-Injected: yes','image/svg+xml\n','bad',17,None,True,{},'image/svg+xml; bad']:
            for route in ['/api/materials','/api/project']:
                p=self.project();p['materials'][0]['mime']=value
                body=p if route=='/api/project' else p['materials']
                self.assertEqual(self.editor.call(route,'PUT',body)[0],400)
        p=self.project();p['materials'][0]['mime']='Image/SVG+XML; charset="UTF-8"'
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
        for method in ['GET','HEAD']:
            code,_,headers=self.editor.call('/media/'+uploaded['asset'],method)
            self.assertEqual(code,200);self.assertIn('sandbox',headers['Content-Security-Policy'])
        for name in ['',None]:
            p=self.project();p['materials'][0]['filename']=name
            self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
            for method in ['GET','HEAD']:
                code,_,headers=self.editor.call('/media/'+uploaded['asset'],method)
                self.assertEqual(code,200);self.assertIn('sandbox',headers['Content-Security-Policy'])
        # Unsafe historical state is also stopped before send_response/headers.
        self.s.write(self.s.DATA/'materials.json',[{**uploaded,'mime':'image/svg+xml\r\nX-Injected: yes'}])
        code,_,headers=self.editor.call('/media/'+uploaded['asset']);self.assertEqual(code,400);self.assertNotIn('X-Injected',headers)

    def test_13_presentation_values_cannot_reach_html_as_markup(self):
        for where in ['cell','bus','drawing','version','wordWrap','node']:
            for value in ['13"><img src=x onerror=alert(1)>',False,{},float('inf')]:
                p=self.project();pg=p['pages'][0]
                if where=='cell':pg['nodes'][0]['table']={'cells':[[{'fontSize':value}]]}
                elif where=='wordWrap':pg['nodes'][0]['table']={'cells':[[{'text':'OK'}]],'wordWrap':value}
                elif where=='version':p['materials']=[{'id':'v','version':value}]
                elif where=='node':pg['nodes'][0]['fontSize']=value
                else:pg['buses' if where=='bus' else 'drawings']=[{'id':'bad','width':value}]
                self.assertEqual(self.editor.call('/api/project','PUT',p)[0],400,(where,value))

    def test_14_publication_includes_node_html_and_recursive_preview_dependencies(self):
        a=self.upload(b'A');b=self.upload(b'B');c=self.upload(b'C');secret=self.upload(b'SECRET')
        p=self.project();p['pages'][0]['nodes'][0]['html']='<a data-open-material="'+a['id']+'">Source</a>'
        byid={m['id']:m for m in p['materials']};byid[a['id']]['previewMaterial']=b['id'];byid[b['id']]['previewMaterial']=c['id'];byid[c['id']]['previewMaterial']=a['id']
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
        pub=self.editor.call('/api/publish','POST')[1]['id'];reader=Client(self.base);reader.call('/api/login','POST',{'password':'review-reader'})
        published=reader.call('/api/published/'+pub)[1];ids={m['id'] for m in published['materials']}
        self.assertTrue({a['id'],b['id'],c['id']}<=ids);self.assertNotIn(secret['id'],ids)
        for m in [a,b,c]:self.assertEqual(reader.call('/media/'+m['asset']+'?view='+pub)[0],200)
        self.assertEqual(reader.call('/media/'+secret['asset']+'?view='+pub)[0],404)

    def test_15_session_reports_repository_version(self):
        self.assertEqual(self.editor.call('/api/session')[1]['version'],(B/'VERSION').read_text().strip())

    def test_16_import_encoding_dtd_and_aggregate_resource_boundaries(self):
        import importer
        xml='<mxfile><diagram><mxGraphModel><root><mxCell id="a" value="Привет &amp; мир" vertex="1"><mxGeometry width="100" height="50"/></mxCell></root></mxGraphModel></diagram></mxfile>'
        for encoding in ['utf-8','utf-16','utf-16-be']:
            declaration='<?xml version="1.0" encoding="'+('utf-8' if encoding=='utf-8' else 'utf-16')+'"?>'
            raw=(declaration+xml).encode(encoding)
            self.assertEqual(import_drawio(raw)['pages'][0]['nodes'][0]['title'],'Привет & мир')
            evil=(declaration+'<!DOCTYPE mxfile [<!ENTITY x "EXPANDED">]>'+xml.replace('Привет &amp; мир','&x;')).encode(encoding)
            self.assertEqual(self.editor.call('/api/import','POST',evil)[0],400)
        def compressed(raw):
            c=zlib.compressobj(wbits=-15);return base64.b64encode(c.compress(raw)+c.flush()).decode()
        evil_page=b'<!DOCTYPE mxGraphModel [<!ENTITY x "EXPANDED">]><mxGraphModel><root><mxCell id="a" vertex="1" value="&x;"/></root></mxGraphModel>'
        self.assertEqual(self.editor.call('/api/import','POST',('<mxfile><diagram>'+compressed(evil_page)+'</diagram></mxfile>').encode())[0],400)
        page=('<mxGraphModel><root><mxCell id="a" value="'+'x'*4000+'"/></root></mxGraphModel>').encode()
        container=('<mxfile>'+''.join('<diagram>'+compressed(page)+'</diagram>' for _ in range(3))+'</mxfile>').encode()
        with patch.object(importer,'MAX_XML',10000):
            self.assertLess(len(container),10000)
            with self.assertRaises(ValueError):import_drawio(container)
        for raw in [b'<mxfile><diagram>broken</diagram></mxfile>',b'<mxfile><diagram><broken></diagram></mxfile>',('<mxfile>'+'<diagram/>'*129+'</mxfile>').encode()]:
            self.assertEqual(self.editor.call('/api/import','POST',raw)[0],400)
        nested=('<a>'*130+'</a>'*130).encode()
        with self.assertRaises(ValueError):import_drawio(nested)
        duplicates=('<mxGraphModel><root>'+'<mxCell id="t" vertex="1" style="shape=table"/>'*100+'<mxCell id="c" parent="t" vertex="1" value="cell"/>'*100+'</root></mxGraphModel>').encode()
        self.assertEqual(self.editor.call('/api/import','POST',duplicates)[0],400)
        # Flat XML can still contain a deep semantic graph.
        parents='<mxGraphModel><root>'+''.join('<mxCell id="n'+str(i)+'" parent="n'+str(i-1)+'" vertex="1"/>' for i in range(130))+'</root></mxGraphModel>'
        with self.assertRaises(ValueError):import_drawio(parents.encode())
        with patch.object(importer,'MAX_IMPORT_SECONDS',-1):
            with self.assertRaisesRegex(ValueError,'время импорта'):import_drawio(xml.encode())
        parse=importer.ImportBudget.parse
        def expire_after_parse(budget,raw):
            root=parse(budget,raw);budget.deadline=-1;return root
        with patch.object(importer.ImportBudget,'parse',expire_after_parse):
            with self.assertRaisesRegex(ValueError,'время импорта'):import_drawio(xml.encode())

    def test_17_swimlane_children_and_both_arrow_ends_remain_semantic(self):
        cells='<mxCell id="lane" value="Lane" style="swimlane" vertex="1"><mxGeometry x="10" y="20" width="400" height="300"/></mxCell>'
        for ident,x in [('a',10),('b',200)]:
            cells+='<mxCell id="'+ident+'" value="'+ident+'" vertex="1" parent="lane"><mxGeometry x="'+str(x)+'" y="70" width="100" height="50"/></mxCell>'
        for i,(start,end) in enumerate([('none','none'),('classic','none'),('none','classic'),('classic','classic')]):
            cells+='<mxCell id="e'+str(i)+'" edge="1" source="a" target="b" style="startArrow='+start+';endArrow='+end+'"><mxGeometry/></mxCell>'
        imported=import_drawio(('<mxGraphModel><root>'+cells+'</root></mxGraphModel>').encode());p=imported['pages'][0]
        self.assertEqual({n['id'] for n in p['nodes']},{'lane','a','b'});self.assertFalse(any(n.get('table') for n in p['nodes']))
        self.assertEqual([(e['arrowStart'],e['arrow']) for e in p['edges']],[(False,False),(True,False),(False,True),(True,True)])
        self.assertTrue(all(e['source']=='a' and e['target']=='b' for e in p['edges']))
        self.assertEqual(imported['importReport'][0]['simplifications'][0]['id'],'lane')
        malformed=import_drawio(('<mxGraphModel><root>'+cells.replace('style="swimlane"','style="shape=table"')+'</root></mxGraphModel>').encode())
        self.assertEqual({n['id'] for n in malformed['pages'][0]['nodes']},{'lane','a','b'})
        self.assertTrue(malformed['importReport'][0]['simplifications'])

if __name__=='__main__':unittest.main(verbosity=2)
