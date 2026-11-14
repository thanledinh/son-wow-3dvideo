"""Dress the sprayer in Store Detailing's uniform: black with light-blue panels, the shop's logo on the chest.

python -I -X utf8 tools/uniform_worker_texture.py path/to/car_mechanic/textures assets/logo.png

Run after clean_worker_texture.py and before export_glb.mjs, on the unzipped copy (the textures are overwritten).
BELAZ's coverall keeps its folds and seams: every texel keeps its own light and shade, only the colour changes.
- top: the blue body and the red yoke go black; the pale parts (the collar piping, the sleeve panels) light blue
- trousers: blue goes black, the red side stripes become light-blue side panels
- chest: the shop's wordmark (assets/logo.png) where BELAZ's gear print was, and the "S" mark opposite it
The atlas is stored upside down (v runs up the body), so prints are flipped top to bottom before they go on.
"""
import colorsys
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

tex = Path(sys.argv[1])
logo_path = Path(sys.argv[2])

BLACK = (0.035, 0.037, 0.042)
BLUE = (0.55, 0.77, 0.9)  # the uniform's light blue
WHITE = (0.86, 0.88, 0.9)


def recolour(path, rules):
    im = Image.open(path).convert("RGB")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = (c / 255 for c in px[x, y])
            hue, sat, val = colorsys.rgb_to_hsv(r, g, b)
            target, ref = rules(hue, sat, val, x, y)
            # keep the texel's own light and shade, relative to its region's usual brightness
            shade = max(0.45, min(1.7, val / ref))
            px[x, y] = tuple(int(255 * min(1.0, c * shade)) for c in target)
    im.save(path, quality=92)
    return im


def top_rules(hue, sat, val, x, y):
    red = sat > 0.45 and (hue < 0.06 or hue > 0.9)
    if red:
        return BLACK, 0.8
    # everything pale (the yoke piping, the collar, the T-shirt in the V, the gear print) goes black like the polo;
    # the shirt's light-blue sleeve panels are drawn by the page (phu-gam-worker.js), on the sleeves' own shape
    if sat < 0.18 and val > 0.62:
        return BLACK, 0.85
    return BLACK, 0.4


def bottom_rules(hue, sat, val, x, y):
    red = sat > 0.45 and (hue < 0.06 or hue > 0.9)
    if red:
        return BLUE, 0.85
    return BLACK, 0.38


top = recolour(tex / "Wolf3D_Outfit_Top_diffuse.jpeg", top_rules)
recolour(tex / "Wolf3D_Outfit_Bottom_diffuse.jpeg", bottom_rules)

# Prints on the chest, on the 1024 atlas: the wordmark where the gear print was (the wearer's left chest), the "S"
# mark mirrored across the collar's V (his right chest).
GEAR = (320, 735)
V_TIP = 248
S_AT = (2 * V_TIP - GEAR[0], GEAR[1])

logo = Image.open(logo_path).convert("RGBA")
logo = logo.resize((150, round(150 * logo.height / logo.width)), Image.LANCZOS)
logo = ImageOps.flip(logo)
top.paste(logo, (GEAR[0] - logo.width // 2, GEAR[1] - logo.height // 2), logo)

s = Image.new("RGBA", (60, 66), (0, 0, 0, 0))
d = ImageDraw.Draw(s)
# the "S" block: two offset bars joined, white over light blue, as on the shirt
d.rectangle([4, 4, 56, 18], fill=(235, 238, 242, 255))
d.rectangle([4, 4, 18, 36], fill=(235, 238, 242, 255))
d.rectangle([4, 26, 56, 40], fill=(235, 238, 242, 255))
d.rectangle([42, 26, 56, 62], fill=(140, 196, 230, 255))
d.rectangle([4, 48, 56, 62], fill=(140, 196, 230, 255))
s = ImageOps.flip(s)
top.paste(s, (S_AT[0] - s.width // 2, S_AT[1] - s.height // 2), s)
top.save(tex / "Wolf3D_Outfit_Top_diffuse.jpeg", quality=92)

# The face: the shop's staff are young and clean-shaven, so the beard round the mouth is painted out (filled from
# the skin around it), and the skin is lightened a little; the arms' flat skin colour follows.
import numpy as np  # noqa: E402

skin_path = tex / "Wolf3D_Skin_diffuse.jpeg"
sk = np.asarray(Image.open(skin_path).convert("RGB")).astype(np.float32) / 255
h, w, _ = sk.shape
yy, xx = np.mgrid[0:h, 0:w]
lum = sk @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
red = sk[..., 0] - sk[..., 2]
# the beard's band round the mouth (the atlas is upside down: the chin is above the mouth), dark and not lip-red
from PIL import ImageFilter  # noqa: E402

# the whole beard area (chin, cheeks, moustache, sideburns), less the lips and the nostrils
region = (((xx - 512) / 320) ** 2 + ((yy - 505) / 200) ** 2 < 1) & (yy > 380) & (yy < 650)
lips = ((xx - 512) / 100) ** 2 + ((yy - 505) / 48) ** 2 < 1
nose = ((xx - 512) / 60) ** 2 + ((yy - 592) / 30) ** 2 < 1
# round the lips only the dark stubble ring goes, not the lips themselves
mask = (region & ~lips & ~nose) | (lips & (lum < 0.42) & (red < 0.28))
# filled with the cheek skin just outside it (its median), feathered in so no edge shows
ring = (((xx - 512) / 360) ** 2 + ((yy - 505) / 210) ** 2 < 1) & ~region & (lum > 0.35) & (yy < 640)
skin = np.median(sk[ring], axis=0)
soft = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32)[..., None] / 255
sk = sk * (1 - soft) + skin * soft
lum = sk @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
# the scalp's painted short hair (dark brown, along the bottom of the atlas) goes black, as the staff's
hair = (lum < 0.3) & (yy > 560)
sk = np.where(hair[..., None], sk * 0.45, sk)
# lighter, less orange skin (not the hair)
skin_like = lum > 0.3
sk = np.where(skin_like[..., None], np.clip(sk * np.array([1.08, 1.14, 1.2]) + 0.03, 0, 1), sk)
Image.fromarray((sk * 255).astype(np.uint8)).save(skin_path, quality=92)
body_path = tex / "Wolf3D_Body_diffuse.jpeg"
body = np.asarray(Image.open(body_path).convert("RGB")).astype(np.float32) / 255
body = np.clip(body * np.array([1.08, 1.14, 1.2]) + 0.03, 0, 1)
Image.fromarray((body * 255).astype(np.uint8)).save(body_path, quality=95)
print("uniform on", tex)
