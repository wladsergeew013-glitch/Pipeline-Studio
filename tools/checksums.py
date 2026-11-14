"""Verify release checksums; run --write only after building final artifacts."""
from pathlib import Path
import argparse, hashlib, re, sys

ROOT=Path(__file__).resolve().parents[1]

def entries(root):
    manifest=root/'SHA256SUMS.txt'
    rows=[];seen=set()
    for line in manifest.read_text('utf8').splitlines():
        match=re.fullmatch(r'([0-9a-f]{64})  (.+)',line)
        if not match:raise ValueError('Malformed checksum entry')
        digest,name=match.groups();target=(root/name).resolve()
        if name in seen or not target.is_relative_to(root.resolve()):raise ValueError('Invalid checksum path: '+name)
        seen.add(name);rows.append((digest,name))
    if not rows:raise ValueError('Empty checksum manifest')
    return rows

def main():
    from release_metadata import check
    check(ROOT)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');args=parser.parse_args()
    rows=entries(ROOT)
    if args.write:
        names={name for _,name in rows}
        for pattern in ('tests/*.py','tests/*.js','tools/*.py','tools/*.js','docs/*.md'):
            names.update(p.relative_to(ROOT).as_posix() for p in ROOT.glob(pattern) if p.is_file())
        content=''.join(hashlib.sha256((ROOT/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in sorted(names))
        (ROOT/'SHA256SUMS.txt').write_text(content,encoding='utf8',newline='\n')
        print('Wrote',len(names),'release checksums');return
    failures=[]
    for expected,name in rows:
        target=ROOT/name
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest()!=expected:failures.append(name)
    if failures:
        print('Checksum mismatch:\n'+'\n'.join(failures),file=sys.stderr);raise SystemExit(1)
    print('Verified',len(rows),'release checksums')

if __name__=='__main__':main()
