"""Build the empty Studio application and a separate document; no fonts/CDNs/file payloads."""
from pathlib import Path
import json, subprocess, shutil
BASE=Path(__file__).parent; STATIC=BASE/'app/static'
def safe(x): return json.dumps(x,ensure_ascii=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
def build_html(project=None):
 css=(STATIC/'style.css').read_text('utf8');core=(STATIC/'core.js').read_text('utf8');app=(STATIC/'app.js').read_text('utf8');emoji=(STATIC/'emoji.js').read_text('utf8')
 scripts='<script>'+emoji+'</script>'
 if project is not None:scripts='<script id="pipeline-document" type="application/json">'+safe(project)+'</script><script>window.STUDIO_DOCUMENT=true;window.PORTABLE_READONLY=true;</script>'+scripts
 else:scripts='<script>window.STUDIO_HOME=true;</script>'+scripts
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pipeline Studio'+(' — документ' if project else '')+'</title><style id="style-source">'+css+'</style></head><body><div id="app"></div><div id="modal-root"></div><div id="toast" role="status"></div>'+scripts+'<script id="core-source">'+core.replace('</script','<\\/script')+'</script><script id="app-source">'+app.replace('</script','<\\/script')+'</script></body></html>'
def build():
 (BASE/'Pipeline-Studio.html').write_text(build_html(),encoding='utf8',newline='\n')
 seed=json.loads((BASE/'app/data/seed.json').read_text('utf8'));p=BASE/'documents';p.mkdir(exist_ok=True)
 # Optional build-time normalization makes row-port IDs stable in the delivered document.
 if shutil.which('node'):
  code="const C=require(process.argv[1]);let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify(C.normalizeV6(JSON.parse(s)))));"
  seed=json.loads(subprocess.run(['node','-e',code,str((STATIC/'core.js').resolve())],input=json.dumps(seed),text=True,encoding='utf-8',capture_output=True,check=True).stdout)
 (p/'Demo.html').write_text(build_html(seed),encoding='utf8',newline='\n')
 (p/'Demo.json').write_text(json.dumps(seed,ensure_ascii=False,indent=2),encoding='utf8',newline='\n')
 for f in [BASE/'Pipeline-Studio.html',p/'Demo.html']:print(f.name,f.stat().st_size)
if __name__=='__main__':build()
