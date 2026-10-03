"""Model and HTTP checks; add --browser for the Chromium UI suite."""
from pathlib import Path
import subprocess,sys
B=Path(__file__).resolve().parents[1]
(B/'qa').mkdir(exist_ok=True)
subprocess.run([sys.executable,'build_portable.py'],cwd=B,check=True)
for name in ('test_v02.js','test_v05.js','test_v07.js','test_v072.js','test_v073.js','test_v074.js','test_v075.js','test_v076.js','test_workflows.js','test_adaptive_views.js','test_scoped_symmetry.js'):
    subprocess.run(['node',str(B/'tests'/name)],cwd=B,check=True)
subprocess.run(['node',str(B/'tests/test_working_document.js')],cwd=B,check=True)
subprocess.run([sys.executable,str(B/'tests/test_server.py')],cwd=B,check=True)
subprocess.run([sys.executable,str(B/'tests/test_local.py')],cwd=B,check=True)
subprocess.run(['node',str(B/'tests/test_desktop_files.js')],cwd=B,check=True)
if '--browser' in sys.argv:
    subprocess.run(['node',str(B/'tests/browser_legacy_notes.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_v072.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_v073.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_v074.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_v075.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_v076.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_workflows.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_status_capsules.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_adaptive_views.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_zoom_and_drag.js')],cwd=B,check=True)
if '--materials' in sys.argv:
    subprocess.run([sys.executable,str(B/'tests/make_material_samples.py')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_materials.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_source_editor.js')],cwd=B,check=True)
    subprocess.run(['node',str(B/'tests/browser_local_materials.js')],cwd=B,check=True)
if '--desktop' in sys.argv:
    subprocess.run(['node',str(B/'tests/browser_desktop.js')],cwd=B,check=True)
print('All requested checks passed.')
