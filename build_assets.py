"""Development helper; rasterizes emoji glyphs into transparent PNG assets.
No font files are copied into the distribution. Requires Pillow + regex for regeneration.
The shipped app uses already generated PNGs, not this build helper.
"""
from pathlib import Path
from PIL import Image,ImageFont,ImageDraw
import base64,io,json,regex
base=Path(__file__).parent
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,help='Optional UTF-8 document to collect additional emoji')
parser.add_argument('--font',default='/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf')
args=parser.parse_args()
source=args.source.read_text('utf8') if args.source else ''
base_emoji='😀 😃 😊 😎 🤔 😴 🧐 🤖 👍 👎 👏 🙌 🤝 💪 ✍️ 👤 👥 🧑‍💻 🏗️ 🏛️ 🏢 🏠 🏭 🪑 💧 💨 🔥 🌍 🌱 🌲 🌞 ⚡ ⭐ 🌟 ✅ ❌ ❗ ❓ ⚠️ 🚨 📢 🔔 💡 🔍 🔎 🛠️ ⚙️ 🔧 🔨 🔩 🧱 📐 📏 ✏️ 🖊️ 🖌️ 🎨 🖼️ 📷 🎬 🎥 📹 ▶️ ⏸️ ⏹️ 🔊 🎧 🎤 🎵 📁 📂 📄 📃 📋 📑 📚 📖 📕 📊 📈 📉 🗂️ 🗃️ 🧾 📎 🔗 🖇️ 📝 💾 💿 🖥️ 💻 🖱️ ⌨️ 🖨️ 📱 🧮 🧰 📦 🗑️ 🔒 🔓 🔑 🛡️ 🏁 🚩 🎯 🧭 🗺️ 🚀 🚧 🚪 🪟 🏆 🥇 ⏱️ ⏳ ⌛ ⏰ 📅 🗓️ 🕒 ↗️ ↘️ ⬆️ ⬇️ ➡️ ⬅️ 🔄 🔁 🔀 ➕ ➖ ✖️ ➗ 💯 🟢 🟡 🔴 🔵 🟣 🟠 ⚪ ⚫'.split()
found=[s for s in regex.findall(r'\X',source) if regex.search(r'\p{Extended_Pictographic}',s)]
emojis=list(dict.fromkeys(base_emoji+found))
font=ImageFont.truetype(args.font,109)
out={}
for e in emojis:
 im=Image.new('RGBA',(160,150));dr=ImageDraw.Draw(im)
 try:
  dr.text((8,0),e,font=font,embedded_color=True)
  bb=im.getbbox()
  if not bb:continue
  im=im.crop(bb);target=Image.new('RGBA',(128,128));im.thumbnail((116,116),Image.Resampling.LANCZOS);target.alpha_composite(im,((128-im.width)//2,(128-im.height)//2))
  b=io.BytesIO();target.save(b,format='PNG',optimize=True);out[e]='data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
 except Exception:pass
(base/'app'/'static'/'emoji.js').write_text('window.EMOJI='+json.dumps(out,ensure_ascii=False)+';',encoding='utf8')
print(len(out),'emoji images generated')
