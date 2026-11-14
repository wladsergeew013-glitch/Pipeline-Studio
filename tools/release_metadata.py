"""Release identity gate for checkout and extracted source archives."""
import argparse,json,re
from pathlib import Path

def check(root,generated=True):
    version=(root/'VERSION').read_text('utf8').strip()
    assert re.fullmatch(r'0\.\d+\.\d+',version),'Invalid VERSION'
    app=(root/'app/static/app.js').read_text('utf8')
    assert re.search(r"const RELEASE='([^']+)'",app)[1]==version,'UI version differs from VERSION'
    package=json.loads((root/'desktop/package.json').read_text('utf8'))
    lock=json.loads((root/'desktop/package-lock.json').read_text('utf8'))
    for label,actual in [('package',package['version']),('lock',lock['version']),('lock root',lock['packages']['']['version'])]:assert actual==version,label+' differs from VERSION'
    release=json.loads((root/'RELEASE.json').read_text('utf8'))
    assert release['version']==version,'RELEASE.json differs from VERSION'
    assert release['baseVersion']!=version and re.fullmatch('[a-f0-9]{40}',release['baseCommit']),'Invalid release base'
    report=root/release['report'];assert report.is_file() and version in report.read_text('utf8'),'Missing current validation report'
    if generated:
        for name in ['Pipeline-Studio.html','documents/Demo.html']:
            text=(root/name).read_text('utf8');assert "const RELEASE='"+version+"'" in text,name+' has stale UI code'
    return version

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--inputs-only',action='store_true');args=parser.parse_args()
    print('Verified release identity',check(args.root,not args.inputs_only))
if __name__=='__main__':main()
