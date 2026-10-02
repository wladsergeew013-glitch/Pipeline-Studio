"""Model and HTTP checks; add --browser for the Chromium UI suite."""
from pathlib import Path
import subprocess,sys
B=Path(__file__).resolve().parents[1]
(B/'qa').mkdir(exist_ok=True)
subprocess.run([sys.executable,'build_portable.py'],cwd=B,check=True)
for name in ('test_v02.js','test_v05.js','test_v07.js','test_v072.js','test_v073.js','test_v074.js'):
    subprocess.run(['node',str(B/'tests'/name)],cwd=B,check=True)
subprocess.run([sys.executable,str(B/'tests/test_server.py')],cwd=B,check=True)
if '--browser' in sys.argv:
    subprocess.run(['node',str(B/'tests/browser_v072.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_v073.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_v074.js')],cwd=B,check=True)
print('All requested checks passed.')
