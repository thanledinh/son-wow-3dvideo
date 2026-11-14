"""Remove the Cyrillic print ("ШАРАЖ МОНТАЖ") from the back of the worker's jacket before export_glb.mjs.

python tools/clean_worker_texture.py path/to/car_mechanic/textures/Wolf3D_Outfit_Top_diffuse.jpeg

Each row of the lettered patch is refilled with a blend of the cloth just left and right of it, so the
shading of the fabric carries across. Overwrites the file in place (run it on the unzipped copy).
"""
import sys
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert("RGB")
px = im.load()
# the lettering's box on the 1024 px atlas, a little wider than the letters
X0, X1, Y0, Y1 = 536, 760, 702, 812
for y in range(Y0, Y1):
    left = [sum(px[X0 - k, y][c] for k in range(1, 6)) / 5 for c in range(3)]
    right = [sum(px[X1 + k, y][c] for k in range(1, 6)) / 5 for c in range(3)]
    for x in range(X0, X1):
        t = (x - X0) / (X1 - X0)
        px[x, y] = tuple(int(left[c] * (1 - t) + right[c] * t) for c in range(3))
im.save(path, quality=92)
print("cleaned", path)
