"""Release metadata must describe the current delivered source, never its predecessor."""
import json,shutil,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tools.release_metadata import check
class ReleaseMetadataTests(unittest.TestCase):
    def test_current_identity(self):self.assertEqual(check(ROOT),(ROOT/'VERSION').read_text().strip())
    def test_stale_release_and_generated_html_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)
            release=json.loads((ROOT/'RELEASE.json').read_text('utf8'))
            for name in ['VERSION','RELEASE.json','app/static/app.js','desktop/package.json','desktop/package-lock.json','Pipeline-Studio.html','documents/Demo.html',release['report']]:
                file=target/name;file.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,file)
            release['version']='0.0.0';(target/'RELEASE.json').write_text(json.dumps(release),encoding='utf8')
            with self.assertRaisesRegex(AssertionError,'RELEASE.json'):check(target)
            shutil.copy2(ROOT/'RELEASE.json',target/'RELEASE.json')
            (target/'Pipeline-Studio.html').write_text("const RELEASE='0.0.0'",encoding='utf8')
            with self.assertRaisesRegex(AssertionError,'Pipeline-Studio.html'):check(target)
if __name__=='__main__':unittest.main(verbosity=2)
