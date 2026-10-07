"""Build a self-contained disposable editor laboratory; source is never written."""
from pathlib import Path
import argparse, json, re, sys
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE))
from build_portable import build_html, safe

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--document',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=BASE/'qa/Layout-Lab.html')
    args=parser.parse_args()
    text=args.document.read_text('utf8')
    if args.document.suffix.lower()=='.html':
        match=re.search(r'<script id="pipeline-document" type="application/json">([\s\S]*?)</script>',text)
        if not match:raise ValueError('Pipeline document JSON was not found')
        text=match.group(1)
    doc=json.loads(text)
    scripts=[(BASE/'tests/layout_audit.js').read_text('utf8'),(BASE/'tests/symmetry_scenarios.js').read_text('utf8'),(BASE/'tools/layout_lab.js').read_text('utf8')]
    extra='<script>window.LAB_DOCUMENT='+safe(doc)+';</script>'+''.join('<script>'+s.replace('</script',r'<\/script')+'</script>' for s in scripts)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    html=build_html()
    end=html.rindex('</body>')
    args.output.write_text(html[:end]+extra+html[end:],encoding='utf8',newline='\n')
    print(args.output)
if __name__=='__main__':main()
