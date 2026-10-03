"""Copy the current portable editor into the desktop bundle and draw its icon."""
from pathlib import Path
import shutil,json
from PIL import Image,ImageDraw
B=Path(__file__).resolve().parents[1];D=B/'desktop'
(D/'ui').mkdir(exist_ok=True);shutil.copy2(B/'Pipeline-Studio.html',D/'ui/Pipeline-Studio.html')
im=Image.new('RGBA',(256,256),(0,0,0,0));d=ImageDraw.Draw(im)
d.rounded_rectangle((8,8,248,248),radius=56,fill='#5754e8')
for box in ((48,60,103,110),(151,60,208,110),(101,155,156,206)):d.rounded_rectangle(box,radius=10,fill='white')
d.line((103,85,128,85,128,180,101,180),fill='white',width=12);d.line((128,85,151,85),fill='white',width=12)
im.save(D/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
version=(B/'VERSION').read_text('utf-8').strip();package=json.loads((D/'package.json').read_text('utf-8'));assert package['version']==version
print('Prepared desktop UI and icon for '+version)
