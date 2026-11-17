# -*- coding: utf-8 -*-
"""生成占位应用图标（Step 6 会替换为正式视觉）。"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps", "app", "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)

SIZE = 512
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
# 圆角背景 + 一颗心 + 一个"常"字的抽象点
d.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=96, fill=(149, 236, 105, 255))
d.ellipse((140, 150, 250, 260), fill=(16, 53, 28, 255))
d.ellipse((262, 150, 372, 260), fill=(16, 53, 28, 255))
d.polygon([(150, 240), (362, 240), (256, 400)], fill=(16, 53, 28, 255))
d.ellipse((236, 196, 276, 236), fill=(255, 255, 255, 235))

img.save(os.path.join(OUT, "icon.png"))
img.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, "32x32.png"))
img.resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, "128x128.png"))
img.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "128x128@2x.png"))
img.save(os.path.join(OUT, "icon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons ->", OUT)
