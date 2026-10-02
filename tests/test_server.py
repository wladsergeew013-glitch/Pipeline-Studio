"""Standard-library integration tests, including real HTTP persistence and roles."""
import base64, http.cookiejar, json, os, socket, subprocess, sys, tempfile, time, unittest, urllib.error, urllib.request
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE/'app'))
from importer import import_drawio
class Client:
    def __init__(self,base):self.base=base;self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(self,path,method='GET',body=None,headers=None):
        headers=headers or {}
        if isinstance(body,(dict,list)):body=json.dumps(body).encode();headers['Content-Type']='application/json'
        req=urllib.request.Request(self.base+path,data=body,headers=headers,method=method)
        try:r=self.opener.open(req,timeout=110)
        except urllib.error.HTTPError as e:r=e
        raw=r.read();obj=json.loads(raw) if raw and 'application/json' in r.headers.get('Content-Type','') else raw
        return r.status,obj,r.headers
class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
        env={**os.environ,'STUDIO_DATA':cls.tmp.name,'STUDIO_PASSWORD':'test-editor-only','STUDIO_READER_PASSWORD':'test-reader-only'}
        cls.log=open(Path(cls.tmp.name)/'server.log','w')
        cls.proc=subprocess.Popen([sys.executable,str(BASE/'app/server.py'),'--port',str(port)],env=env,stdout=cls.log,stderr=cls.log)
        cls.base='http://127.0.0.1:'+str(port);cls.editor=Client(cls.base);cls.reader=Client(cls.base);cls.anon=Client(cls.base)
        for _ in range(100):
            try:
                if cls.anon.call('/api/session')[0]==200:break
            except OSError:pass
            time.sleep(.1)
        assert cls.editor.call('/api/login','POST',{'password':'test-editor-only'})[0]==200
        assert cls.reader.call('/api/login','POST',{'password':'test-reader-only'})[0]==200
    @classmethod
    def tearDownClass(cls):cls.proc.terminate();cls.proc.wait(timeout=5);cls.log.close();cls.tmp.cleanup()
    def project(self):return self.editor.call('/api/project')[1]
    def upload(self,name,data=b'abcdefghij'*20,replace=None):
        h={'X-File-Name':name}
        if replace:h['X-Replace-Material']=replace
        status,m,_=self.editor.call('/api/upload','POST',data,h);self.assertEqual(status,200,m);return m
    def test_01_auth_and_reader_cannot_edit(self):
        self.assertEqual(self.anon.call('/api/project')[0],401)
        self.assertEqual(self.reader.call('/api/project')[0],403)
        self.assertEqual(self.reader.call('/api/upload','POST',b'x',{'X-File-Name':'x.txt'})[0],403)
    def test_02_source_and_safe_import(self):
        xml=b'<mxfile><diagram name="Demo"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Start" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell><mxCell id="b" value="End" vertex="1" parent="1"><mxGeometry x="200" y="0" width="120" height="60" as="geometry"/></mxCell><mxCell id="ab" source="a" target="b" edge="1" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>'
        p=import_drawio(xml)
        self.assertEqual(len(p['pages'][0]['nodes']),2)
        self.assertEqual(len(p['pages'][0]['edges']),1)
        with self.assertRaises(ValueError):import_drawio(b'<!DOCTYPE foo [<!ENTITY x "x">]><mxfile/>')
    def test_03_save_and_conflict(self):
        p=self.project();status,res,_=self.editor.call('/api/project','PUT',p);self.assertEqual(status,200,res)
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],409)
        self.assertEqual(self.project()['revision'],p['revision']+1)
    def test_04_two_files_same_name_are_distinct(self):
        a=self.upload('same.pdf');b=self.upload('same.pdf');self.assertNotEqual(a['asset'],b['asset']);self.assertNotEqual(a['id'],b['id'])
    def test_05_replace_keeps_id(self):
        a=self.upload('first.mp4');b=self.upload('second.mp4',b'NEW VIDEO',a['id']);self.assertEqual(a['id'],b['id']);self.assertNotEqual(a['asset'],b['asset']);self.assertEqual(b['version'],2)
    def test_06_range_and_suffix(self):
        a=self.upload('range.mp4',b'0123456789ABCDEFGHIJ')
        s,b,h=self.editor.call('/media/'+a['asset'],headers={'Range':'bytes=3-7'});self.assertEqual(s,206);self.assertEqual(b,b'34567');self.assertEqual(h['Content-Range'],'bytes 3-7/20')
        self.assertEqual(self.editor.call('/media/'+a['asset'],headers={'Range':'bytes=-4'})[1],b'GHIJ')
        self.assertEqual(self.editor.call('/media/'+a['asset'],headers={'Range':'bytes=90-100'})[0],416)
    def test_07_publication_snapshot_and_live_registry(self):
        a=self.upload('linked.pdf',b'%PDF-1.4\nTEST');p=self.project();p['pages'][0]['nodes'][0]['materials']=[a['id']];old=p['pages'][0]['nodes'][0]['title'];self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
        pub=self.editor.call('/api/publish','POST')[1]['id'];a2=self.upload('linked-new.pdf',b'%PDF-1.4\nNEW',a['id']);p=self.project();p['pages'][0]['nodes'][0]['title']='New draft title';self.editor.call('/api/project','PUT',p)
        s,snap,_=self.reader.call('/api/published/'+pub);self.assertEqual(s,200);self.assertEqual(snap['pages'][0]['nodes'][0]['title'],old);self.assertEqual(next(m for m in snap['materials'] if m['id']==a['id'])['asset'],a2['asset'])
        self.assertEqual(self.reader.call('/media/'+a2['asset']+'?view='+pub)[0],200)
        unlinked=self.upload('secret.txt');self.assertEqual(self.reader.call('/media/'+unlinked['asset']+'?view='+pub)[0],404)
    def test_071_cell_material_list_is_published_and_authorized(self):
        a=self.upload('cell-video.webm',b'CELL-VIDEO');b=self.upload('cell-pdf.pdf',b'%PDF-cell')
        p=self.project();t=next(n for n in p['pages'][0]['nodes'] if n.get('table'))
        c=next(c for row in t['table']['cells'] for c in row if c)
        c['materials']=[a['id'],b['id']];c.pop('material',None)
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
        pub=self.editor.call('/api/publish','POST')[1]['id']
        status,snap,_=self.reader.call('/api/published/'+pub);self.assertEqual(status,200)
        ids={m['id'] for m in snap['materials']};self.assertIn(a['id'],ids);self.assertIn(b['id'],ids)
        self.assertEqual(self.reader.call('/media/'+a['asset']+'?view='+pub)[0],200)
        secret=self.upload('not-in-cell.txt',b'PRIVATE')
        self.assertEqual(self.reader.call('/media/'+secret['asset']+'?view='+pub)[0],404)
    def test_072_inline_material_is_published_and_authorized(self):
        linked=self.upload('inline-source.pdf',b'%PDF-inline')
        secret=self.upload('unreferenced.txt',b'PRIVATE')
        p=self.project();node=next(n for n in p['pages'][0]['nodes'] if n.get('table'))
        cell=next(c for row in node['table']['cells'] for c in row if c)
        cell.pop('material',None);cell.pop('materials',None)
        cell['html']=f'Первый пункт <a data-open-material="{linked["id"]}" href="#material">Источник</a>'
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],200)
        pub=self.editor.call('/api/publish','POST')[1]['id']
        status,snap,_=self.reader.call('/api/published/'+pub);self.assertEqual(status,200)
        self.assertIn(linked['id'],{m['id'] for m in snap['materials']})
        self.assertEqual(self.reader.call('/media/'+linked['asset']+'?view='+pub)[0],200)
        self.assertEqual(self.reader.call('/media/'+secret['asset']+'?view='+pub)[0],404)
    def test_08_reject_cross_origin_write(self):
        self.assertEqual(self.editor.call('/api/publish','POST',headers={'Origin':'https://unrelated.example'})[0],403)
    def test_09_reject_broken_coordinates(self):
        p=self.project();p['pages'][0]['nodes'][0]['x']='evil';self.assertEqual(self.editor.call('/api/project','PUT',p)[0],400)
    def test_10_preview_conversion_if_libreoffice(self):
        import shutil
        if not (shutil.which('libreoffice') or shutil.which('soffice')):self.skipTest('LibreOffice not installed')
        m=self.upload('test.rtf',br'{\rtf1\ansi Pipeline Studio preview test.}')
        status,converted,_=self.editor.call('/api/preview/'+m['id'],'POST');self.assertEqual(status,200,converted)
        status,data,headers=self.editor.call('/media/'+converted['previewAsset']);self.assertEqual(status,200);self.assertTrue(data.startswith(b'%PDF'));self.assertEqual(headers['Content-Type'],'application/pdf')
    def test_11_backup_contains_source_data(self):
        import io,zipfile
        s,data,_=self.editor.call('/api/backup');self.assertEqual(s,200)
        with zipfile.ZipFile(io.BytesIO(data)) as z:self.assertIn('project.json',z.namelist());self.assertIn('materials.json',z.namelist());self.assertTrue(any(n.startswith('assets/') for n in z.namelist()))
    def test_12_nested_groups_and_routes_roundtrip(self):
        p=self.project();pg=p['pages'][0];parent=pg['groups'][0];members=parent['members'][-2:];parent['members']=parent['members'][:-2]
        pg['groups'].append({'id':'server-child','parentId':parent['id'],'members':members,'title':'Nested test'})
        pg['edges'][0]['waypoints']=[{'dx':100,'dy':-50}]
        status,res,_=self.editor.call('/api/project','PUT',p);self.assertEqual(status,200,res)
        out=self.project()['pages'][0];self.assertEqual(out['groups'][-1]['parentId'],parent['id']);self.assertEqual(out['edges'][0]['waypoints'],[{'dx':100,'dy':-50}])
    def test_13_cycle_rejected_without_overwriting_saved_state(self):
        p=self.project();revision=p['revision'];p['pages'][0]['groups'][0]['parentId']='server-child'
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],400);self.assertEqual(self.project()['revision'],revision)
    def test_14_invalid_route_coordinates_rejected(self):
        p=self.project();p['pages'][0]['edges'][0]['waypoints']=[{'dx':'invalid','dy':1}]
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],400)
    def test_15_duplicate_group_membership_rejected(self):
        p=self.project();pg=p['pages'][0];pg['groups'][1]['members'].append(pg['groups'][0]['members'][0])
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],400)
    def test_16_head_audit_no_file_body(self):
        m=self.upload('audit.webm',b'x'*1032)
        status,data,headers=self.editor.call('/media/'+m['asset'],'HEAD')
        self.assertEqual(status,200);self.assertEqual(data,b'');self.assertEqual(headers['Content-Length'],'1032')
        self.assertEqual(self.reader.call('/media/'+m['asset'],'HEAD')[0],403)
        self.assertEqual(self.editor.call('/media/'+'f'*32,'HEAD')[0],404)
    def test_17_v4_layout_and_bus_roundtrip(self):
        p=self.project();pg=p['pages'][0];p['schemaVersion']=4;pg['layoutOptions']={'autoSpace':True}
        pg['buses']=[{'id':'qa-bus','mode':'out','hub':pg['edges'][0]['source'],'port':pg['edges'][0]['sourcePort'],'offset':91}]
        pg['edges'][0]['bus']='qa-bus';pg['nodes'][0]['flowNode']=True
        status,res,_=self.editor.call('/api/project','PUT',p);self.assertEqual(status,200,res)
        out=self.project();self.assertEqual(out['schemaVersion'],4);self.assertEqual(out['pages'][0]['buses'][0]['offset'],91)
        self.assertTrue(out['pages'][0]['layoutOptions']['autoSpace']);self.assertTrue(out['pages'][0]['nodes'][0]['flowNode'])

    def test_18_internal_block_link_and_start_arrow_roundtrip(self):
        p=self.project();pg=p['pages'][0];node=pg['nodes'][0]
        target={'pageId':pg['id'],'nodeId':pg['nodes'][1]['id']}
        m={'id':'qa-internal','title':'Internal target','kind':'node','target':target,'version':1}
        p['materials'].append(m);node.setdefault('materials',[]).append(m['id']);pg['edges'][0]['arrowStart']=True
        status,res,_=self.editor.call('/api/project','PUT',p);self.assertEqual(status,200,res)
        out=self.project();saved=next(m for m in out['materials'] if m['id']=='qa-internal')
        self.assertEqual(saved['target'],target);self.assertEqual(saved['kind'],'node');self.assertTrue(out['pages'][0]['edges'][0]['arrowStart'])
        status,pub,_=self.editor.call('/api/publish','POST',{'title':'Internal-link test'});self.assertEqual(status,200,pub)
        status,published,_=self.reader.call('/api/published/'+pub['id']);self.assertEqual(status,200)
        self.assertEqual(next(m for m in published['materials'] if m['id']=='qa-internal')['target'],target)

    def test_19_source_deletion_persists_and_restore_is_possible(self):
        m=self.upload('deletion.txt',b'SOURCE-KEPT');p=self.project()
        p['materials']=[x for x in p['materials'] if x['id']!=m['id']]
        p['deletedMaterials']=[{'id':m['id'],'version':m['version']}]
        status,res,_=self.editor.call('/api/project','PUT',p);self.assertEqual(status,200,res)
        out=self.project();self.assertNotIn(m['id'],{x['id'] for x in out['materials']});self.assertNotIn('deletedMaterials',out)
        self.assertTrue((Path(self.tmp.name)/'assets'/m['asset']).exists())
        # Undo restores the same ID and retained bytes.
        out['materials'].append(m);self.assertEqual(self.editor.call('/api/project','PUT',out)[0],200)
        self.assertIn(m['id'],{x['id'] for x in self.project()['materials']})
        self.assertEqual(self.editor.call('/media/'+m['asset'])[1],b'SOURCE-KEPT')
    def test_20_stale_deletion_is_atomic_and_preserves_concurrent_replacement(self):
        m=self.upload('old-source.txt',b'OLD');p=self.project();revision=p['revision']
        p['materials']=[x for x in p['materials'] if x['id']!=m['id']]
        p['deletedMaterials']=[{'id':m['id'],'version':m['version']}]
        replacement=self.upload('new-source.txt',b'NEW',m['id'])
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],409)
        out=self.project();self.assertEqual(out['revision'],revision)
        self.assertEqual(next(x for x in out['materials'] if x['id']==m['id'])['asset'],replacement['asset'])
    def test_21_reader_cannot_delete_sources(self):
        p=self.project();m=p['materials'][0];p['materials']=p['materials'][1:]
        p['deletedMaterials']=[{'id':m['id'],'version':m.get('version',1)}]
        self.assertEqual(self.reader.call('/api/project','PUT',p)[0],403)
        self.assertIn(m['id'],{x['id'] for x in self.project()['materials']})
    def test_22_invalid_deletion_cannot_change_the_registry(self):
        p=self.project();revision=p['revision'];p['deletedMaterials']=[{'id':p['materials'][0]['id'],'version':0}]
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],400);self.assertEqual(self.project()['revision'],revision)
        p['deletedMaterials']=[{'id':p['materials'][0]['id'],'version':p['materials'][0].get('version',1)}]
        self.assertEqual(self.editor.call('/api/project','PUT',p)[0],400);self.assertEqual(self.project()['revision'],revision)

    def test_23_v075_ownership_protection_and_scoped_symmetry_roundtrip(self):
        p=self.project();pg=p['pages'][0]
        n=pg['nodes'][0];n['editLocked']=True;n['branchSymmetry']=True;n['branchGap']=72
        comment=dict(n,id='v075-comment',type='comment',editLocked=False,title='Комментарий')
        pg['nodes'].append(comment)
        pg['edges'].append({'id':'v075-relation','source':comment['id'],'target':n['id'],'sourcePort':'right','targetPort':'left','arrow':False,'arrowStart':True,'parentRole':'target','editLocked':True})
        status,result,_=self.editor.call('/api/project','PUT',p);self.assertEqual(status,200,result)
        out=self.project()['pages'][0]
        self.assertTrue(next(x for x in out['nodes'] if x['id']==n['id'])['editLocked'])
        self.assertEqual(next(x for x in out['nodes'] if x['id']==comment['id'])['type'],'comment')
        relation=next(e for e in out['edges'] if e['id']=='v075-relation')
        self.assertEqual(relation['parentRole'],'target');self.assertTrue(relation['editLocked']);self.assertTrue(relation['arrowStart'])

if __name__=='__main__':unittest.main(verbosity=2)
