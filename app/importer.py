"""Import draw.io XML without executing embedded HTML or external references.
Preserves original IDs, labels, cell colors and connection endpoints.
"""
from __future__ import annotations
import base64, html, json, re, uuid, zlib
from collections import defaultdict
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

class LabelText(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]
    def handle_data(self,s): self.parts.append(s)
    def handle_starttag(self,t,a):
        if t in ('br','div','p','li'): self.parts.append('\n')
    def handle_endtag(self,t):
        if t in ('div','p','li'): self.parts.append('\n')

def text(s):
    p=LabelText()
    try: p.feed(s or '')
    except Exception: return html.unescape(re.sub('<[^>]*>','',s or ''))
    return re.sub(r'\n\s*\n+','\n', ''.join(p.parts)).replace('\xa0',' ').strip()

def style(s):
    return dict(v.split('=',1) if '=' in v else (v,'1') for v in (s or '').split(';') if v)

def num(v,default=0):
    try: return float(v)
    except (ValueError,TypeError): return default

def color(s,default):
    if not s or s in ('default','inherit'): return default
    if s=='none': return 'transparent'
    if s.startswith('light-dark('): return s[11:].split(',')[0].strip()
    return s if re.fullmatch(r'#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9,. %]+\)',s) else default

def import_drawio(raw: bytes, title='Сравнительная оценка вывода чертежей'):
    if len(raw)>20*1024*1024: raise ValueError('XML превышает 20 МБ')
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('DTD не поддерживается')
    root=ET.fromstring(raw)
    diagrams=list(root.findall('diagram')) if root.tag=='mxfile' else [root]
    registry={}; report=[]; pages=[]
    def material(link,label):
        if not link: return None
        mid='m-'+uuid.uuid5(uuid.NAMESPACE_URL,link).hex[:16]
        if mid not in registry:
            kind='page' if link.startswith('data:page/id,') else 'link'
            registry[mid]={'id':mid,'title':text(label)[:85] or link,'kind':kind,'url':link,'version':1,'status':'Не проверено'}
        return mid
    for di,d in enumerate(diagrams):
        model=d.find('mxGraphModel') if d.tag=='diagram' else d
        if model is None:
            # draw.io compresses individual pages using raw DEFLATE + URI encoding.
            from urllib.parse import unquote
            dec=zlib.decompressobj(-15)
            decoded=dec.decompress(base64.b64decode((d.text or '').strip()),20*1024*1024+1)
            if len(decoded)>20*1024*1024 or dec.unconsumed_tail: raise ValueError('Слишком большая сжатая страница')
            expanded=unquote(decoded.decode()).encode()
            if b'<!DOCTYPE' in expanded.upper() or b'<!ENTITY' in expanded.upper(): raise ValueError('DTD не поддерживается')
            model=ET.fromstring(expanded)
        rr=model.find('root'); records={}; order=[]; children=defaultdict(list)
        if rr is None: raise ValueError('В XML нет mxGraphModel/root')
        for el in rr:
            c=el if el.tag=='mxCell' else el.find('mxCell')
            if c is None: continue
            a=dict(c.attrib)
            if el is not c: a.update({k:v for k,v in el.attrib.items() if k in ('id','link','label')})
            ident=a.get('id',str(uuid.uuid4())); a['id']=ident
            a['label']=a.get('label',a.get('value','')); a['s']=style(a.get('style'))
            geo=c.find('mxGeometry'); a['g']=dict(geo.attrib) if geo is not None else {}
            a['points']=[]
            if geo is not None:
                for p in geo.findall('./Array/mxPoint'): a['points'].append({'x':num(p.get('x')),'y':num(p.get('y'))})
                for key in ('sourcePoint','targetPoint'):
                    pt=geo.find(f"mxPoint[@as='{key}']")
                    if pt is not None:a[key]={'x':num(pt.get('x')),'y':num(pt.get('y'))}
            records[ident]=a; order.append(ident);children[a.get('parent')].append(ident)
        positions={}
        def pos(ident,seen=None):
            if ident in positions:return positions[ident]
            seen=set() if seen is None else seen
            if ident in seen:raise ValueError('Циклическая вложенность блоков')
            seen.add(ident); a=records[ident];g=a['g']; p=a.get('parent')
            px,py=pos(p,seen) if p in records else (0,0)
            positions[ident]=(px+num(g.get('x')),py+num(g.get('y')))
            return positions[ident]
        def composite(a):return a['s'].get('shape')=='table' or 'swimlane' in a['s']
        def owner(ident):
            if ident not in records:return None
            a=records[ident]; best=ident; seen=set()
            while a.get('parent') in records:
                a=records[a['parent']]
                if a['id'] in seen:raise ValueError('Цикл родителей')
                seen.add(a['id'])
                if composite(a):best=a['id']
            return best
        nodes=[]; byid={}; owners={}
        for ident in order:
            a=records[ident];s=a['s']
            if a.get('vertex')!='1' or 'edgeLabel' in s:continue
            if 'group' in s or (not a['label'] and children[ident] and not composite(a)):continue
            own=owner(ident);owners[ident]=own
            if own!=ident:continue
            x,y=pos(ident);g=a['g'];w=max(60,num(g.get('width'),180));h=max(28,num(g.get('height'),70))
            kind='table' if composite(a) else 'decision' if 'rhombus' in s else 'ellipse' if 'ellipse' in s else 'note' if s.get('shape')=='document' else 'text' if 'text' in s else 'block'
            mids=[]
            m=material(a.get('link'),a['label'])
            if m:mids.append(m)
            n={'id':ident,'title':text(a['label']),'html':a['label'],'type':kind,'x':x,'y':y,'w':w,'h':h,
               'fill':color(s.get('fillColor'),'#ffffff'),'stroke':color(s.get('strokeColor'),'#9aa8bf'),
               'fontSize':num(s.get('fontSize'),13),'materials':mids,'icons':[], 'sourceId':ident,'ports':[],
               'original':{'x':x,'y':y,'w':w,'h':h,'style':a.get('style','')}}
            if composite(a):
                rows=[]; colWidths=[]
                rowids=children[ident]
                is_table=s.get('shape')=='table'
                for rid in sorted(rowids,key=lambda rid:num(records[rid]['g'].get('y'))):
                    ra=records[rid]; cellids=children[rid] if is_table else [rid]
                    if not cellids: continue
                    cells=[]
                    for cid in sorted(cellids,key=lambda cid:num(records[cid]['g'].get('x'))):
                        ca=records[cid];mid=material(ca.get('link'),ca['label'])
                        if mid and mid not in mids:mids.append(mid)
                        cells.append({'text':text(ca['label']),'html':ca['label'],'rowspan':1,'colspan':1,
                            'fill':color(ca['s'].get('fillColor'),'#ffffff'),'material':mid,'sourceId':cid})
                    if not colWidths:colWidths=[num(records[cid]['g'].get('width'),140) for cid in cellids]
                    rm=material(ra.get('link'),ra['label'])
                    if rm and rm not in mids:mids.append(rm)
                    rows.append(cells)
                n['table']={'cells':rows or [[{'text':'','rowspan':1,'colspan':1}]],'widths':colWidths or [180]}
                n['h']=max(h,35+len(rows)*36)
            nodes.append(n);byid[ident]=n
        def nodeowner(ident):
            own=owner(ident)
            return own if own in byid else ident if ident in byid else None
        def endpoint(rawid, xattr, yattr, defaultside, edge):
            own=nodeowner(rawid)
            if own is None:return None,None
            n=byid[own]; a=records[rawid];ox,oy=pos(rawid);s=edge['s'];g=a['g']
            xx=num(s.get(xattr),1 if defaultside=='right' else 0);yy=num(s.get(yattr),.5)
            x=(ox+xx*num(g.get('width'),n['w'])-n['x'])/n['w'];y=(oy+yy*num(g.get('height'),n['h'])-n['y'])/n['h']
            x=max(0,min(1,x));y=max(0,min(1,y))
            # Only legal perimeter ports; retain imported row offsets.
            sides=[(abs(x),'left'),(abs(1-x),'right'),(abs(y),'top'),(abs(1-y),'bottom')]
            side=min(sides)[1]
            if side=='left':x=0
            if side=='right':x=1
            if side=='top':y=0
            if side=='bottom':y=1
            pid=f'{side}-{x:.4f}-{y:.4f}'
            if not any(p['id']==pid for p in n['ports']):n['ports'].append({'id':pid,'x':x,'y':y,'side':side})
            return own,pid
        edges=[]; drawings=[]; skipped=[]
        for ident in order:
            a=records[ident]
            if a.get('edge')!='1':continue
            src,sp=endpoint(a.get('source'),'exitX','exitY','right',a)
            dst,tp=endpoint(a.get('target'),'entryX','entryY','left',a)
            if not src or not dst:
                if 'sourcePoint' in a and 'targetPoint' in a:
                    drawings.append({'id':ident,'type':'line','points':[a['sourcePoint'],*a['points'],a['targetPoint']], 'color':color(a['s'].get('strokeColor'),'#6c8ebf'),'width':num(a['s'].get('strokeWidth'),2),'anchor':None})
                else: skipped.append(ident)
                continue
            label=text(a['label']) or ' / '.join(text(records[c]['label']) for c in children[ident] if records[c]['label'])
            edges.append({'id':ident,'source':src,'target':dst,'sourcePort':sp,'targetPort':tp,'label':label,'arrow':a['s'].get('endArrow')!='none','dashed':a['s'].get('dashed')=='1','sourceOriginal':a.get('source'),'targetOriginal':a.get('target')})
        # Grouping is presentation metadata. It never rewrites semantic edges.
        candidates=[n for n in nodes if re.match(r'^(АР|ВК|ОВ|КР|ТХВ)(\s|$)',n['title']) and len(n['title'])<12]
        defs=[('АР',['АР'],'#d49b23'),('ВК / ОВ',['ВК','ОВ'],'#149e9a'),('КР',['КР'],'#8561d8'),('ТХВ',['ТХВ'],'#e58b40')]
        adj=defaultdict(list)
        for e in edges:adj[e['source']].append(e['target'])
        memberships=defaultdict(list);groups=[]
        for gi,(name,prefixes,col) in enumerate(defs):
            seeds=[n['id'] for n in candidates if n['title'].split()[0] in prefixes]
            if not seeds:continue
            seen=set(seeds);queue=list(seeds)
            while queue:
                for nn in adj[queue.pop()]:
                    if nn not in seen and not any(c['id']==nn and nn not in seeds for c in candidates):seen.add(nn);queue.append(nn)
            gid=f'group-{di}-{gi}';groups.append({'id':gid,'title':name,'color':col,'members':[],'order':gi})
            for nn in seen:memberships[nn].append(gid)
        for n in nodes:
            gids=memberships[n['id']]
            if len(gids)==1:
                n['group']=gids[0];next(g for g in groups if g['id']==gids[0])['members'].append(n['id'])
            else:n['group']=None
        page={'id':d.get('id',f'page-{di}'),'title':d.get('name',f'Страница {di+1}'),'nodes':nodes,'edges':edges,'groups':groups,'drawings':drawings}
        pages.append(page)
        report.append({'page':page['title'],'source_cells':len(records),'nodes':len(nodes),'edges':len(edges),'tables':sum(n['type']=='table' for n in nodes),'drawings':len(drawings),'unresolved_edges':skipped,
            'note':'Табличные ячейки включены в состав таблиц; подписи ребер включены в связи. Стили фигур нормализованы; исходный XML сохранен отдельно.'})
    return {'format':'pipeline-studio','schema':1,'id':uuid.uuid4().hex,'title':title,'revision':0,'pages':pages,'materials':list(registry.values()),'importReport':report}

if __name__=='__main__':
    import sys
    from pathlib import Path
    out=import_drawio(Path(sys.argv[1]).read_bytes())
    Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(out['importReport'],ensure_ascii=False,indent=2));print('materials',len(out['materials']))
