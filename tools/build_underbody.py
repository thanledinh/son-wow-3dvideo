# Toyota Innova Zenix / Hycross (TNGA-C, FWD, MacPherson front, torsion-beam rear) underbody, built headless:
#   blender -b --factory-startup --python tools/build_underbody.py -- OUT.glb
# Blender coords: +X across, nose at -Y, tail at +Y, +Z up (= three.js y). Units metres.
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

argv = sys.argv
OUT = argv[argv.index('--') + 1] if '--' in argv else 'underbody.glb'
SPARE = True        # spare wheel hangs under the boot floor (unconfirmed for this car, see report)

for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
for me in list(bpy.data.meshes): bpy.data.meshes.remove(me)

MATS = {
    'UB_Floor':      ((0.32, 0.33, 0.34), 0.55, 0.0),
    'UB_Sealer':     ((0.62, 0.55, 0.42), 0.70, 0.0),
    'UB_Plastic':    ((0.025, 0.025, 0.028), 0.60, 0.0),
    'UB_Steel':      ((0.035, 0.035, 0.038), 0.50, 0.3),
    'UB_Exhaust':    ((0.45, 0.42, 0.38), 0.45, 0.8),
    'UB_Shield':     ((0.62, 0.63, 0.64), 0.40, 0.9),
    'UB_Rubber':     ((0.02, 0.02, 0.02), 0.85, 0.0),
    'UB_Line':       ((0.55, 0.55, 0.56), 0.35, 0.9),
    'UB_Zinc':       ((0.60, 0.62, 0.64), 0.35, 0.8),
    'UB_Alu':        ((0.55, 0.56, 0.57), 0.55, 0.85),
    'UB_ExhaustHot': ((0.36, 0.24, 0.14), 0.40, 0.8),
    'UB_Mark':       ((0.85, 0.70, 0.05), 0.60, 0.0),
    'UB_Tyre':       ((0.015, 0.015, 0.016), 0.90, 0.0),
    'UB_Wire':       ((0.012, 0.012, 0.013), 0.55, 0.0),
}
BM = {k: bmesh.new() for k in MATS}

def clamp(v, a=0.0, b=1.0): return max(a, min(b, v))
def sm(a, b, t):
    if a == b: return 1.0 if t >= a else 0.0
    u = clamp((t - a) / (b - a)); return u * u * (3 - 2 * u)
def pat(t, p): return sm(0.55, 0.95, 0.5 + 0.5 * math.cos(2 * math.pi * t / p))
def noise(k, s=0.0): return math.sin(k * 0.9 + s) + 0.6 * math.sin(k * 2.3 + s * 1.7) + 0.3 * math.sin(k * 5.1 + s * 0.3)

def frame(d):
    y = Vector(d).normalized()
    ref = Vector((0, 0, 1)) if abs(y.z) < 0.99 else Vector((1, 0, 0))
    x = y.cross(ref).normalized(); z = x.cross(y)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z))).to_4x4()

def _bevel(bm, verts, b):
    edges = list({e for v in verts for e in v.link_edges})
    bmesh.ops.bevel(bm, geom=edges, offset=b, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES')

def box(m, c, s, rx=0, ry=0, rz=0, bev=0):
    bm = BM[m]
    M = Matrix.Translation(c) @ Euler((math.radians(rx), math.radians(ry), math.radians(rz))).to_matrix().to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    if bev: _bevel(bm, r['verts'], bev)

def beam(m, p0, p1, w, h, bev=0):
    p0 = Vector(p0); p1 = Vector(p1); d = p1 - p0
    M = Matrix.Translation((p0 + p1) / 2) @ frame(d) @ Matrix.Diagonal((w, d.length, h, 1))
    r = bmesh.ops.create_cube(BM[m], size=1.0, matrix=M)
    if bev: _bevel(BM[m], r['verts'], bev)

def cyl(m, p0, p1, r0, r1=None, seg=12, bev=0):
    p0 = Vector(p0); p1 = Vector(p1); d = p1 - p0
    M = Matrix.Translation((p0 + p1) / 2) @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    r = bmesh.ops.create_cone(BM[m], cap_ends=True, cap_tris=False, segments=seg, radius1=r0,
                              radius2=r0 if r1 is None else r1, depth=d.length, matrix=M)
    if bev: _bevel(BM[m], r['verts'], bev)

def prism(m, poly, z0, z1, bev=0):
    bm = BM[m]; lo = [bm.verts.new((x, y, z0)) for x, y in poly]; hi = [bm.verts.new((x, y, z1)) for x, y in poly]
    n = len(poly); fs = [bm.faces.new(lo[::-1]), bm.faces.new(hi)]
    for i in range(n): fs.append(bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i])))
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    if bev: _bevel(bm, lo + hi, bev)

def ngon(cx, cy, r, n=8, a0=0.0): return [(cx + r * math.cos(a0 + 2 * math.pi * i / n), cy + r * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]

def catmull(pts, sub):
    P = [Vector(p) for p in pts]
    if sub <= 1 or len(P) < 3: return P
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]; out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(sub):
            t = k / sub
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1]); return out

def tube(m, pts, r, seg=8, sub=1, rf=None, caps=True, ex=1.0, ey=1.0, closed=False):
    bm = BM[m]; P = catmull(pts, sub); Q = [P[0]]
    for p in P[1:]:
        if (p - Q[-1]).length > 1e-5: Q.append(p)
    P = Q; n = len(P)
    if n < 2: return
    Ts = []
    for i in range(n):
        a = P[(i + 1) % n] if closed else P[min(i + 1, n - 1)]
        b = P[(i - 1) % n] if closed else P[max(i - 1, 0)]
        Ts.append((a - b).normalized())
    N = Ts[0].cross(Vector((0, 0, 1)))
    if N.length < 1e-3: N = Ts[0].cross(Vector((1, 0, 0)))
    N.normalize(); rings = []; faces = []
    for i in range(n):
        T = Ts[i]; N = (N - T * N.dot(T)).normalized(); B = T.cross(N)
        rr = r * (rf(i / max(1, n - 1)) if rf else 1.0)
        rings.append([bm.verts.new(P[i] + rr * (math.cos(2 * math.pi * j / seg) * ex * N + math.sin(2 * math.pi * j / seg) * ey * B)) for j in range(seg)])
    for i in range(n if closed else n - 1):
        i2 = (i + 1) % n
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append(bm.faces.new((rings[i][j], rings[i][j2], rings[i2][j2], rings[i2][j])))
    if caps and not closed:
        faces.append(bm.faces.new(rings[0][::-1])); faces.append(bm.faces.new(rings[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)

def hatprof(w, h, t, f=0.0, flip=False):
    """closed hat/U section (opening towards +b), optional flanges; flip opens towards -b."""
    a = w / 2
    p = [(-a, 0), (a, 0), (a, h)]
    if f: p += [(a + f, h), (a + f, h - t)]
    p += [(a - t, h - t), (a - t, t), (-a + t, t), (-a + t, h - t)]
    if f: p += [(-a - f, h - t), (-a - f, h)]
    p += [(-a, h)]
    if flip: p = [(u, -v) for u, v in p]
    return p

def sweep(m, pts, prof, sub=1, sc=None):
    """extrude a closed profile (a: sideways, b: up) along a path with a roll-free frame."""
    bm = BM[m]; P = catmull(pts, sub); n = len(P)
    rings = []; faces = []
    for i in range(n):
        T = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized()
        X = T.cross(Vector((0, 0, 1)))
        if X.length < 1e-3: X = Vector((1, 0, 0))
        X.normalize(); U = X.cross(T)
        sa, sb = sc(i / max(1, n - 1)) if sc else (1.0, 1.0)
        rings.append([bm.verts.new(P[i] + X * a * sa + U * b * sb) for a, b in prof])
    k = len(prof)
    for i in range(n - 1):
        for j in range(k):
            j2 = (j + 1) % k
            faces.append(bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j])))
    faces.append(bm.faces.new(rings[0][::-1])); faces.append(bm.faces.new(rings[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)

def hf(m, xr, yr, step, zfun, mask=None, flip=False):
    """downward-facing stamped sheet from a height function."""
    bm = BM[m]
    i0, i1 = round(xr[0] / step), round(xr[1] / step); j0, j1 = round(yr[0] / step), round(yr[1] / step)
    V = {}
    def vv(i, j):
        k = (i, j)
        if k not in V: V[k] = bm.verts.new((i * step, j * step, zfun(i * step, j * step)))
        return V[k]
    for i in range(i0, i1):
        for j in range(j0, j1):
            if mask and not mask((i + .5) * step, (j + .5) * step): continue
            a, b, c, d = vv(i, j), vv(i + 1, j), vv(i + 1, j + 1), vv(i, j + 1)
            bm.faces.new((a, b, c, d) if flip else (a, d, c, b))

# ----------------------------------------------------------------- floor ----
def zf(x, y):
    ax = abs(x); z = 1.69
    z += 0.17 * sm(-1.02, -1.20, y)
    z += 0.17 * sm(1.0, 1.5, y)
    z += 0.10 * sm(2.08, 2.30, y)
    z += 0.055 * (1 - sm(0.15, 0.19, ax)) * sm(-1.2, -1.1, y) * (1 - sm(1.05, 1.3, y))
    for xc in (-0.52, -0.28, 0.28, 0.52): z += 0.019 * sm(0.035, 0.02, abs(x - xc))
    for xc in (-0.40, 0.40): z -= 0.010 * sm(0.03, 0.018, abs(x - xc))
    for yc in (-0.62, 1.02, 1.62): z += 0.012 * sm(0.035, 0.02, abs(y - yc))
    z -= 0.03 * sm(0.66, 0.70, ax)
    for (xc, yc, a, b) in ((0.40, -0.80, 0.09, 0.04), (-0.40, -0.80, 0.09, 0.04), (0.14, -0.30, 0.05, 0.024), (-0.14, -0.30, 0.05, 0.024),
                           (0.76, -0.1, 0.05, 0.03), (-0.76, 0.35, 0.05, 0.03), (0.30, 1.18, 0.06, 0.03), (-0.30, 1.18, 0.06, 0.03)):
        d = ((x - xc) / a) ** 2 + ((y - yc) / b) ** 2
        z += 0.013 * sm(1.0, 0.55, d)
    for sg in (1, -1):                                           # X-shaped stiffening beads in the front seat pans
        u = (x - sg * 0.34) / 0.12; v = (y + 0.40) / 0.14
        if abs(u) < 1 and abs(v) < 1: z += 0.010 * sm(0.014, 0.007, min(abs(u - v), abs(u + v)) * 0.05) * sm(1.0, 0.85, max(abs(u), abs(v)))
    z -= 0.005 * sm(0.94, 0.97, y) * sm(1.4, 1.2, y)           # panel lap step
    r = math.hypot(x, y - 1.95); th = math.atan2(y - 1.95, x)
    dish = sm(0.36, 0.32, r)
    z -= 0.028 * dish
    z += 0.018 * dish * pat(th, 2 * math.pi / 8) * sm(0.08, 0.12, r) * (1 - sm(0.27, 0.31, r))
    z += 0.010 * pat(x, 0.16) * pat(y - 0.03, 0.16) * sm(0.38, 0.42, r) * sm(1.55, 1.62, y) * (1 - sm(2.1, 2.15, y)) * (1 - sm(0.62, 0.7, ax))
    if y < -1.2: z += 0.008 * pat(y, 0.2) * (1 - sm(0.45, 0.5, ax)) + 0.006 * pat(x, 0.24)
    return max(z, 1.662)

def floor_mask(x, y):
    ax = abs(x)
    if ax > 0.88 or y < -1.90 or y > 2.34: return False
    if ax > 0.5 and ((-1.90 < y < -1.00) or (0.96 < y < 1.86)): return False
    return True
hf('UB_Floor', (-0.88, 0.88), (-1.90, 2.34), 0.02, zf, floor_mask)

def bolt(x, y, z=None, r=0.0105, mk=False, wash=True):
    z = zf(x, y) if z is None else z
    if wash: cyl('UB_Zinc', (x, y, z + 0.002), (x, y, z - 0.0018), r * 1.55, seg=12)
    cyl('UB_Zinc', (x, y, z + 0.002), (x, y, z - 0.009), r, seg=6, bev=0.0012)
    if mk: box('UB_Mark', (x, y, z - 0.0094), (r * 1.7, 0.0035, 0.0012))

def spots(path, zfun, pitch=0.035):
    for (a, b) in zip(path[:-1], path[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / pitch))
        for k in range(n + 1):
            t = k / n; x = a[0] + (b[0] - a[0]) * t; y = a[1] + (b[1] - a[1]) * t
            z = zfun(x, y)
            cyl('UB_Floor', (x, y, z + 0.001), (x, y, z - 0.0028), 0.0045, 0.0034, seg=8)

# closure (never seen from below)
for sg in (1, -1):
    box('UB_Floor', (sg * 0.69, -0.02, 1.83), (0.38, 1.96, 0.26))
    box('UB_Floor', (sg * 0.69, -2.12, 1.91), (0.38, 0.44, 0.10))
    box('UB_Floor', (sg * 0.69, 2.10, 1.92), (0.38, 0.48, 0.08))
    box('UB_Floor', (sg * 0.865, -0.02, 1.65), (0.02, 1.92, 0.06))              # sill pinch weld
    for yj in (-0.78, 0.62):                                                    # jacking points
        box('UB_Floor', (sg * 0.84, yj - 0.055, 1.625), (0.09, 0.04, 0.035), bev=0.004)
        box('UB_Floor', (sg * 0.84, yj + 0.055, 1.625), (0.09, 0.04, 0.035), bev=0.004)
        box('UB_Floor', (sg * 0.80, yj, 1.636), (0.02, 0.15, 0.012), bev=0.003)
box('UB_Floor', (0, 0, 1.945), (1.0, 4.68, 0.05))
box('UB_Floor', (0, -2.32, 1.70), (1.7, 0.04, 0.14), bev=0.01)
box('UB_Floor', (0, 2.32, 1.92), (1.76, 0.04, 0.08), bev=0.01)

# hat-section rails and cross-members (flanged, spot-welded)
for sg in (1, -1):
    sweep('UB_Floor', [(sg * 0.52, -0.97, 1.662), (sg * 0.52, -0.12, 1.662)], hatprof(0.05, 0.03, 0.004, 0.016))
    for dy in (-0.80, -0.35): bolt(sg * 0.52, dy, 1.664, mk=True)
    spots([(sg * 0.52 - 0.034, -0.95), (sg * 0.52 - 0.034, -0.14)], lambda x, y: zf(x, y), 0.04)
    spots([(sg * 0.52 + 0.034, -0.95), (sg * 0.52 + 0.034, -0.14)], lambda x, y: zf(x, y), 0.04)
    for (y, x0, x1) in ((-0.62, 0.20, 0.56), (1.02, 0.20, 0.49)):
        sweep('UB_Floor', [(sg * x0, y, 1.662), (sg * x1, y, 1.662)], hatprof(0.05, 0.03, 0.004, 0.016))
        spots([(sg * x0, y - 0.034), (sg * x1, y - 0.034)], zf, 0.04); spots([(sg * x0, y + 0.034), (sg * x1, y + 0.034)], zf, 0.04)
    for (x, y) in ((0.40, -0.55), (0.40, -0.20)):                              # seat-rail mounts: reinforcing plates
        prism('UB_Floor', [(sg * x - 0.035, y - 0.08), (sg * x + 0.035, y - 0.08), (sg * x + 0.035, y + 0.08), (sg * x - 0.035, y + 0.08)], zf(x, y) - 0.009, zf(x, y), bev=0.003)
        for dy in (-0.045, 0.045): bolt(sg * x, y + dy, zf(x, y) - 0.009, 0.0105, mk=True)
spots([(-0.5, -0.975), (0.5, -0.975)], zf, 0.035); spots([(-0.86, 0.925), (0.86, 0.925)], zf, 0.035)
spots([(-0.49, 1.58), (0.49, 1.58)], zf, 0.035); spots([(-0.86, 2.18), (0.86, 2.18)], zf, 0.035)
for sg in (1, -1): spots([(sg * 0.74, -0.97), (sg * 0.74, 0.93)], zf, 0.04)

# --------------------------------------------------------- plastic covers ---
def panel(m, x0, x1, y0, y1, zb, zr, pitch=0.048, amp=0.011, axis='x', step=0.012, bd=0.03):
    def z(x, y):
        d = min(x - x0, x1 - x, y - y0, y1 - y)
        t = x if axis == 'x' else y
        rib = sm(0.4, 0.8, 0.5 + 0.5 * math.cos(2 * math.pi * t / pitch))
        cross = 0.35 * sm(0.7, 0.95, 0.5 + 0.5 * math.cos(2 * math.pi * (y if axis == 'x' else x) / 0.3))
        return zb - amp * min(1.0, rib + cross) * sm(0.02, 0.05, d) + (zr - zb) * (1 - sm(0.0, bd, d))
    hf(m, (x0, x1), (y0, y1), step, z, None)
for sg in (1, -1):
    lo, hi = sorted((sg * 0.19, sg * 0.60))
    panel('UB_Plastic', lo, hi, -0.05, 0.80, 1.668, 1.69, pitch=0.045, amp=0.013, axis='x')
    lo2, hi2 = sorted((sg * 0.69, sg * 0.84))
    panel('UB_Plastic', lo2, hi2, -0.96, -0.12, 1.645, 1.662, pitch=0.05, amp=0.008, axis='y', bd=0.02)
    for yc in (0.12, 0.66):                                                    # tank straps
        box('UB_Zinc', ((lo + hi) / 2, yc, 1.653), (hi - lo + 0.02, 0.04, 0.005), bev=0.0015)
        for xe in (lo - 0.005, hi + 0.005):
            box('UB_Zinc', (xe, yc, 1.672), (0.006, 0.04, 0.04))
            bolt(xe + sg * 0.0, yc + 0.0, 1.690 - 0.012, 0.009, mk=True, wash=False) if False else None
        for yb in (yc - 0.012, yc + 0.012):
            bolt(sg * 0.60 + sg * 0.02 - sg * 0.0, yb, 1.672, 0.008, mk=(yb < yc), wash=False) if False else None
        cyl('UB_Zinc', (sg * 0.20, yc, 1.665), (sg * 0.20, yc, 1.653 - 0.006), 0.010, seg=6)      # strap bolts at the tunnel end
        cyl('UB_Mark', (sg * 0.20, yc, 1.646), (sg * 0.20, yc, 1.6455), 0.0075, seg=8)
    # fuel tank shoulder visible beside the cover, with its seam flange
    box('UB_Steel', (sg * 0.64, 0.375, 1.688), (0.03, 0.85, 0.014), bev=0.004)

# front plastic: engine under-cover (louvres, hatch, fasteners), wings with radiator opening
def cov_z(x, y):
    ax = abs(x); xl = 0.85 if y < -1.9 else 0.27
    z = 1.58 + 0.07 * sm(-1.9, -1.2, y) + 0.17 * sm(-2.22, -2.34, y)
    z += 0.030 * sm(xl - 0.04, xl, ax) + 0.022 * sm(-1.24, -1.2, y)
    edge = 1 - sm(xl - 0.08, xl - 0.04, ax)
    z -= 0.007 * sm(0.4, 0.8, 0.5 + 0.5 * math.cos(2 * math.pi * x / 0.05)) * edge
    z -= 0.005 * pat(y, 0.22) * edge * sm(0.6, 0.9, 0.5 + 0.5 * math.cos(2 * math.pi * x / 0.5))
    if -1.64 < y < -1.38 and ax < 0.115: z += 0.014 * sm(0.115, 0.098, ax) * sm(-1.64, -1.62, y) * sm(-1.38, -1.40, y)   # service hatch
    return z
def cov_mask(x, y):
    ax = abs(x)
    if y < -2.34 or ax >= 0.85 or y >= -1.2: return False
    if y < -1.9:
        if ax < 0.38 and -2.22 < y < -2.02: return False                                  # lower radiator opening
        if 0.50 < ax < 0.80 and -2.30 < y < -2.0 and int(math.floor((y + 2.30) / 0.05)) % 2 == 0: return False   # side louvres
        if ax < 0.20 and y < -2.26: return False
        return True
    if ax >= 0.27: return False
    for k in range(4):                                                                     # louvre bank over the sump
        yk = -1.86 + 0.06 * k
        if yk <= y < yk + 0.02 and 0.05 < ax < 0.22: return False
    if -1.30 < y < -1.22 and ax < 0.02: return False
    return True
hf('UB_Plastic', (-0.86, 0.86), (-2.34, -1.2), 0.01, cov_z, cov_mask)
for sg in (1, -1):
    for (x, y) in ((0.24, -1.30), (0.24, -1.60), (0.24, -1.86), (0.78, -2.10), (0.78, -2.28), (0.45, -2.30), (0.15, -2.30), (0.62, -1.93), (0.12, -1.93), (0.84, -2.20)):
        bolt(sg * x, y, cov_z(x, y), 0.010, mk=((x, y) in ((0.24, -1.60), (0.62, -1.93))))
    for (x, y) in ((0.17, -1.42), (0.17, -1.60), (0.45, -1.96), (0.70, -2.31), (0.30, -2.30)):       # push clips
        z = cov_z(x, y); cyl('UB_Plastic', (sg * x, y, z + 0.002), (sg * x, y, z - 0.007), 0.013, 0.011, seg=10, bev=0.0015)
        cyl('UB_Rubber', (sg * x, y, z - 0.0066), (sg * x, y, z - 0.0075), 0.006, seg=8)
    for (x, y) in ((0.095, -1.43), (0.095, -1.59)): bolt(sg * x, y, cov_z(x, y), 0.0085, wash=False)
box('UB_Steel', (0, -2.35, 1.60), (1.5, 0.02, 0.03))
# radiator support seen through the opening
box('UB_Steel', (0, -2.10, 1.665), (1.0, 0.07, 0.05), bev=0.008)
box('UB_Plastic', (0, -2.15, 1.70), (0.72, 0.06, 0.07), bev=0.01)
for sg in (1, -1): cyl('UB_Plastic', (sg * 0.30, -2.15, 1.67), (sg * 0.30, -2.15, 1.62), 0.02, seg=10)

# ---- front suspension: stamped subframe (pan with ribs, lightening holes, mounts)
def sf_mask(x, y):
    ax = abs(x)
    if 0.285 <= ax <= 0.415 and -1.84 <= y <= -1.10: return True
    if ax <= 0.43 and -1.85 <= y <= -1.72: return True
    if ax <= 0.46 and -1.23 <= y <= -1.08: return True
    if math.hypot(ax - 0.445, y + 1.115) < 0.065 or math.hypot(ax - 0.41, y + 1.80) < 0.06: return True
    return False
SF_HOLES = [(c, -1.785, 0.020) for c in (-0.20, -0.10, 0.0, 0.10, 0.20)] + [(c, -1.155, 0.026) for c in (-0.36, -0.20, -0.07, 0.07, 0.20, 0.36)]
SF_SLOTS = [(sg * 0.35, y) for sg in (1, -1) for y in (-1.66, -1.50, -1.34)]
def sf_pan(x, y):
    if sf_mask_holes(x, y): return None
    ax = abs(x); z = 1.55
    z -= 0.022 * sm(0.30, 0.325, ax) * sm(0.40, 0.375, ax) * sm(-1.84, -1.80, y) * sm(-1.09, -1.13, y)      # pressed rails
    z -= 0.006 * pat(y, 0.12) * sm(0.30, 0.33, ax) * sm(0.40, 0.37, ax)
    return z
def sf_mask_holes(x, y):
    if not sf_mask(x, y): return True
    for (cx, cy, r) in SF_HOLES:
        if math.hypot(x - cx, y - cy) < r: return True
    for (cx, cy) in SF_SLOTS:
        if abs(x - cx) < 0.012 and abs(y - cy) < 0.05: return True
    return False
hf('UB_Steel', (-0.48, 0.48), (-1.86, -1.07), 0.006, lambda x, y: sf_pan(x, y) or 1.55, lambda x, y: not sf_mask_holes(x, y))
for (cx, cy, r) in SF_HOLES:                                       # flanged lightening holes
    tube('UB_Steel', [(cx + r * math.cos(a), cy + r * math.sin(a), 1.549) for a in [2 * math.pi * i / 16 for i in range(16)]], 0.0028, seg=5, closed=True)
for sg in (1, -1):
    for (cx, cy) in SF_SLOTS:
        if cx * sg < 0: continue
        pts = [(cx + 0.012 * math.cos(a) * 1.0, cy + (0.05 + 0.012 * math.sin(a)) * (1 if math.sin(a) >= 0 else -1) * (1 if abs(math.sin(a)) > 0.01 else 0), 1.5485) for a in []]
    for (x, y, zz) in ((0.445, -1.115, 1.55), (0.41, -1.80, 1.55)):   # four body mounts
        cyl('UB_Rubber', (sg * x, y, 1.545), (sg * x, y, 1.50 + 0.0), 0.040, 0.034, seg=14, bev=0.003)
        bolt(sg * x, y, 1.50, 0.0155, mk=True)
    box('UB_Steel', (sg * 0.35, -1.455, 1.545), (0.004, 0.02, 0.004))     # bead lines on rails
    # lower control arm: stamped L, two legs + web + ball joint + rear-pivot bush
    for (p0, p1) in (((0.40, -1.74, 1.585), (0.505, -1.47, 1.585)), ((0.40, -1.14, 1.60), (0.505, -1.47, 1.585))):
        sweep('UB_Steel', [(sg * p0[0], p0[1], p0[2]), (sg * p1[0], p1[1], p1[2])], hatprof(0.046, 0.026, 0.0035, 0.0, True))
    prism('UB_Steel', [(sg * 0.42, -1.64), (sg * 0.50, -1.49), (sg * 0.50, -1.45), (sg * 0.42, -1.26)], 1.560, 1.566)
    cyl('UB_Steel', (sg * 0.50, -1.47, 1.585), (sg * 0.60, -1.47, 1.585), 0.020, seg=12)
    cyl('UB_Rubber', (sg * 0.60, -1.47, 1.585), (sg * 0.52, -1.47, 1.585), 0.012, 0.030, seg=12)           # ball-joint dust boot
    cyl('UB_Zinc', (sg * 0.60, -1.47, 1.585), (sg * 0.62, -1.47, 1.585), 0.011, seg=6)
    for (x, y, z) in ((0.40, -1.74, 1.585), (0.40, -1.14, 1.60)):
        cyl('UB_Rubber', (sg * x, y, z - 0.034), (sg * x, y, z + 0.032), 0.031, seg=14, bev=0.003)
        cyl('UB_Steel', (sg * x, y, z - 0.036), (sg * x, y, z - 0.026), 0.040, seg=14)
    # steering rack on the subframe: housing, mounting clamps, bellows, tie rods
    tube('UB_Steel', [(sg * 0.0, -1.30, 1.70), (sg * 0.27, -1.30, 1.70)], 0.021, seg=14)
    tube('UB_Rubber', [(sg * 0.27, -1.30, 1.70), (sg * 0.46, -1.30, 1.70)], 0.028, seg=12, rf=lambda t: (1 - 0.3 * t) * (1 + 0.15 * math.sin(t * 2 * math.pi * 6)))
    tube('UB_Steel', [(sg * 0.46, -1.30, 1.70), (sg * 0.505, -1.38, 1.675), (sg * 0.60, -1.50, 1.66)], 0.008, seg=8, sub=3)
    cyl('UB_Zinc', (sg * 0.585, -1.475, 1.668), (sg * 0.62, -1.52, 1.66), 0.013, seg=8)
    box('UB_Steel', (sg * 0.18, -1.30, 1.675), (0.05, 0.05, 0.03), bev=0.006)
    for dx in (-0.015, 0.015): bolt(sg * 0.18 + dx, -1.30, 1.658, 0.007, wash=False)
    # anti-roll bar with D-bushes and drop links
    box('UB_Rubber', (sg * 0.27, -1.06, 1.662), (0.05, 0.035, 0.03), bev=0.008)
    box('UB_Steel', (sg * 0.27, -1.06, 1.647), (0.06, 0.04, 0.008), bev=0.002)
    for dx in (-0.02, 0.02): bolt(sg * 0.27 + dx, -1.06, 1.643, 0.007, mk=True, wash=False)
    tube('UB_Steel', [(sg * 0.46, -1.12, 1.63), (sg * 0.43, -1.30, 1.63)], 0.010, seg=8)
    tube('UB_Steel', [(sg * 0.43, -1.30, 1.63), (sg * 0.43, -1.30, 1.69)], 0.006, seg=8)                  # drop link
    cyl('UB_Zinc', (sg * 0.43, -1.30, 1.63), (sg * 0.43, -1.30, 1.623), 0.013, seg=8)
tube('UB_Steel', [(-0.43, -1.30, 1.63), (-0.30, -1.14, 1.64), (-0.27, -1.06, 1.652), (0.27, -1.06, 1.652), (0.30, -1.14, 1.64), (0.43, -1.30, 1.63)], 0.0105, seg=8, sub=3)
# engine and transaxle above the subframe (what shows through the louvres and beside the cover)
box('UB_Alu', (-0.08, -1.73, 1.665), (0.40, 0.34, 0.10), bev=0.014)                               # oil sump
for i in range(7): box('UB_Alu', (-0.08, -1.73 + (i - 3) * 0.045, 1.612), (0.38, 0.012, 0.016), bev=0.003)
for i in range(6): box('UB_Alu', (-0.08 + (i - 2.5) * 0.06, -1.73, 1.616), (0.012, 0.32, 0.012), bev=0.002)
cyl('UB_Zinc', (-0.02, -1.60, 1.616), (-0.02, -1.60, 1.604), 0.012, seg=6, bev=0.001)                # sump drain plug
cyl('UB_Zinc', (-0.02, -1.60, 1.618), (-0.02, -1.60, 1.6165), 0.018, seg=14)
cyl('UB_Mark', (-0.02, -1.60, 1.604), (-0.02, -1.60, 1.6035), 0.0075, seg=8)
box('UB_Alu', (-0.08, -1.99, 1.70), (0.42, 0.26, 0.14), bev=0.02)                                   # block / front cover
cyl('UB_Alu', (0.08, -1.45, 1.77), (0.30, -1.45, 1.77), 0.14, 0.125, seg=28, bev=0.004)           # bell housing
cyl('UB_Alu', (0.30, -1.45, 1.77), (0.485, -1.45, 1.76), 0.115, 0.09, seg=26)                         # CVT case
for xr in (0.15, 0.22, 0.30, 0.38, 0.45): cyl('UB_Alu', (xr - 0.012, -1.45, 1.77), (xr + 0.012, -1.45, 1.77), 0.152 - 0.45 * (xr - 0.08) * 0.1 if xr < 0.3 else 0.128 - (xr - 0.3) * 0.25, seg=28)
for i in range(5): box('UB_Alu', (0.14 + i * 0.07, -1.59, 1.700), (0.012, 0.05, 0.08), bev=0.002)   # ribs
cyl('UB_Zinc', (0.33, -1.45, 1.668), (0.33, -1.45, 1.655), 0.012, seg=6, bev=0.001)                 # CVT drain plug
cyl('UB_Mark', (0.33, -1.45, 1.655), (0.33, -1.45, 1.6545), 0.0075, seg=8)
cyl('UB_Alu', (0.08, -1.45, 1.77), (-0.04, -1.45, 1.77), 0.14, seg=28)
tube('UB_Rubber', [(-0.27, -1.449, 1.676), (-0.42, -1.449, 1.676)], 0.037, seg=14, rf=lambda t: (1 - 0.25 * t) * (1 + 0.16 * math.sin(t * 2 * math.pi * 5)))   # left inner CV boot
tube('UB_Steel', [(-0.42, -1.449, 1.676), (-0.50, -1.449, 1.676)], 0.014, seg=10)
cyl('UB_Zinc', (-0.27, -1.449, 1.676), (-0.285, -1.449, 1.676), 0.040, seg=10)
tube('UB_Rubber', [(0.44, -1.449, 1.676), (0.485, -1.449, 1.676)], 0.034, seg=14, rf=lambda t: 1 + 0.16 * math.sin(t * 2 * math.pi * 2))
cyl('UB_Steel', (-0.12, -1.449, 1.676), (-0.27, -1.449, 1.676), 0.016, seg=10)
box('UB_Alu', (-0.075, -1.50, 1.65), (0.12, 0.10, 0.07), bev=0.01)                                 # intermediate support

# -------------------------------------------------------------- sealer ------
def bead(pts, zfun, r=0.0052, step=0.018, wob=0.003, seed=0.0):
    P = []
    for (a, b) in zip(pts[:-1], pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / step))
        for k in range(n):
            t = k / n; P.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    P.append(pts[-1]); out = []; rr = []
    for k, (x, y) in enumerate(P):
        a = P[max(k - 1, 0)]; b = P[min(k + 1, len(P) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1.0
        w = wob * noise(k, seed)
        x2, y2 = x - dy / L * w, y + dx / L * w
        out.append((x2, y2, zfun(x2, y2) - 0.0008)); rr.append(max(0.45, 1 + 0.35 * math.sin(k * 0.55 + seed * 2) + 0.25 * noise(k * 1.3, seed)))
    tube('UB_Sealer', out, r, seg=6, rf=lambda t: rr[min(len(rr) - 1, int(t * (len(rr) - 1) + 0.5))])
    for (x, y) in (P[0], P[-1]):
        cyl('UB_Sealer', (x, y, zfun(x, y) + 0.001), (x, y, zfun(x, y) - 0.007), r * 1.7, r * 1.2, seg=8)
for sg in (1, -1):
    bead([(sg * 0.70, -0.98), (sg * 0.70, 0.94)], zf, seed=1)
    bead([(sg * 0.215, -1.1), (sg * 0.215, -0.1)], zf, seed=2)
    bead([(sg * 0.478, -1.0), (sg * 0.478, -1.6)], zf, seed=3)
    bead([(sg * 0.30, 1.56), (sg * 0.30, 2.2)], zf, seed=4)
    bead([(sg * 0.478, 0.95), (sg * 0.478, 1.5)], zf, seed=5)
    bead([(sg * 0.86, -0.97), (sg * 0.86, 0.93)], zf, r=0.0045, seed=9)
bead([(-0.478, -0.995), (0.478, -0.995)], zf, seed=6); bead([(-0.86, 0.945), (0.86, 0.945)], zf, seed=7)
bead([(-0.478, 1.56), (0.478, 1.56)], zf, seed=8); bead([(-0.86, 2.2), (0.86, 2.2)], zf, seed=10)
bead([(0.37 * math.cos(a), 1.95 + 0.37 * math.sin(a)) for a in [i * math.pi / 12 for i in range(24)]], zf, seed=11)
bead([(-0.5, -0.1), (-0.215, -0.1)], zf, seed=12); bead([(0.215, -0.1), (0.5, -0.1)], zf, seed=13)
bead([(-0.5, -0.62 - 0.036), (-0.2, -0.62 - 0.036)], zf, r=0.004, seed=14); bead([(0.2, -0.62 - 0.036), (0.5, -0.62 - 0.036)], zf, r=0.004, seed=15)

# ---------------------------------------------------------------- bolts -----
for sg in (1, -1):
    for y in (-0.85, -0.5, -0.15): bolt(sg * 0.235, y, mk=(y == -0.5))
    for y in (-0.8, -0.4, 0.0, 0.4, 0.8): bolt(sg * 0.78, y, 1.652)
    for x in (0.2, 0.45): bolt(sg * x, 1.62)
    for x in (0.1, 0.25, 0.4, 0.6): bolt(sg * x, 2.12)
for a in range(0, 360, 45): bolt(0.42 * math.cos(math.radians(a + 22)), 1.95 + 0.42 * math.sin(math.radians(a + 22)))
# drain plugs, round and oval rubber blanks
for (x, y) in ((0.40, -0.38), (-0.40, -0.38), (-0.26, 1.15), (0.26, 1.15), (0.0, 1.82), (0.0, 2.09), (0.78, 0.30), (-0.78, -0.50)):
    cyl('UB_Rubber', (x, y, zf(x, y) + 0.002), (x, y, zf(x, y) - 0.008), 0.017, 0.015, seg=14, bev=0.002)
    cyl('UB_Rubber', (x, y, zf(x, y) - 0.0075), (x, y, zf(x, y) - 0.0092), 0.009, seg=10)
for (x, y) in ((0.55, -0.62), (-0.55, 0.20), (-0.15, 1.78), (0.15, 1.78), (0.45, 0.90), (-0.45, 0.90)):
    z = zf(x, y)
    for i in range(10):
        a = 2 * math.pi * i / 10
    tube('UB_Rubber', [(x + 0.024 * math.cos(a), y + 0.014 * math.sin(a), z - 0.0045) for a in [2 * math.pi * i / 14 for i in range(14)]], 0.0055, seg=6, closed=True)
    cyl('UB_Rubber', (x, y, z - 0.0005), (x, y, z - 0.0052), 0.020, 0.0, seg=12) if False else None

# ----------------------------------------------- lines, harness, cables -----
ROUTE = [(0.46, -1.15), (0.46, -0.95), (0.52, -0.90), (0.63, -0.78), (0.63, 0.78), (0.55, 0.90), (0.47, 0.95), (0.47, 1.28)]
for sg in (1, -1):
    for off in (0.0, 0.026):
        pts = [(sg * (x + (off if 0.55 < x < 0.7 else 0)), y, zf(x + (off if 0.55 < x < 0.7 else 0), y) - 0.012) for (x, y) in ROUTE]
        pts[-1] = (pts[-1][0], pts[-1][1], 1.665)
        tube('UB_Line', pts, 0.0042 if (sg == -1 and off) else 0.0038, seg=6, sub=4)
    for yc in (-0.6, -0.3, 0.0, 0.3, 0.6):
        box('UB_Zinc', (sg * 0.64, yc, zf(0.64, yc) - 0.007), (0.05, 0.016, 0.005), bev=0.0015)
        bolt(sg * 0.664, yc, zf(0.664, yc) - 0.002, 0.0055, wash=False)
        cyl('UB_Plastic', (sg * 0.61, yc + 0.05, zf(0.61, yc + 0.05) + 0.001), (sg * 0.61, yc + 0.05, zf(0.61, yc + 0.05) - 0.009), 0.007, seg=8)
    cyl('UB_Zinc', (sg * 0.47, 1.26, 1.655), (sg * 0.47, 1.30, 1.66), 0.009, seg=6)
    # rear brake hose from the hard line to the backing plate, via a bracket on the arm
    tube('UB_Rubber', [(sg * 0.47, 1.28, 1.665), (sg * 0.44, 1.33, 1.60), (sg * 0.46, 1.38, 1.572), (sg * 0.52, 1.41, 1.60)], 0.0062, seg=8, sub=4)
    box('UB_Steel', (sg * 0.47, 1.28, 1.652), (0.03, 0.012, 0.03), bev=0.003)
    # ABS wire: floor -> arm -> hub plate, with clips
    tube('UB_Wire', [(sg * 0.43, 0.96, zf(0.43, 0.96) - 0.012), (sg * 0.44, 1.10, 1.676), (sg * 0.48, 1.30, 1.60), (sg * 0.52, 1.40, 1.64)], 0.0032, seg=6, sub=4)
    tube('UB_Wire', [(sg * 0.58, -0.96, zf(0.58, -0.9) - 0.012), (sg * 0.47, -1.06, 1.686), (sg * 0.47, -1.30, 1.665), (sg * 0.50, -1.43, 1.63)], 0.0032, seg=6, sub=4)
    box('UB_Plastic', (sg * 0.46, 1.10, 1.676), (0.012, 0.02, 0.01), bev=0.002)
    box('UB_Plastic', (sg * 0.45, -1.30, 1.668), (0.012, 0.02, 0.01), bev=0.002)
# wiring harness down the tunnel flank
for off in (0.0, 0.0065, 0.013):
    tube('UB_Wire', [(-0.245 - off, y, zf(-0.245, y) - 0.010 - off * 0.6) for y in (-1.12, -0.9, -0.6, -0.3, -0.12)], 0.0042, seg=6, sub=4)
for y in (-0.95, -0.65, -0.4, -0.2):
    box('UB_Plastic', (-0.252, y, zf(-0.25, y) - 0.004), (0.045, 0.014, 0.008), bev=0.002)
    cyl('UB_Plastic', (-0.285, y, zf(-0.285, y) + 0.001), (-0.285, y, zf(-0.285, y) - 0.007), 0.0075, seg=8)
# parking-brake cables from the equaliser to both rear arms
for sg in (1, -1):
    tube('UB_Wire', [(0.0, 0.99, zf(0, 0.99) - 0.020), (sg * 0.20, 1.08, zf(0.2, 1.08) - 0.016), (sg * 0.40, 1.20, 1.72), (sg * 0.47, 1.40, 1.64)], 0.0048, seg=8, sub=5)
    for (x, y) in ((0.20, 1.08), (0.33, 1.15)):
        box('UB_Zinc', (sg * x, y, zf(x, y) - 0.008), (0.02, 0.012, 0.004))
box('UB_Zinc', (0, 0.99, zf(0, 0.99) - 0.022), (0.05, 0.02, 0.012), bev=0.003)
# fuel filler pipe + hose, charcoal canister with purge hoses
tube('UB_Rubber', [(-0.52, 0.80, 1.692), (-0.60, 0.86, 1.70), (-0.76, 0.91, 1.71), (-0.80, 0.94, 1.74)], 0.019, seg=10, sub=5)
for t in (0.2, 0.7): cyl('UB_Zinc', (-0.62 - t * 0.15, 0.87 + t * 0.04, 1.70), (-0.62 - t * 0.15, 0.87 + t * 0.04, 1.704), 0.026, seg=10)
box('UB_Plastic', (-0.40, 1.15, 1.665), (0.14, 0.26, 0.10), bev=0.012)
for i in range(4): box('UB_Plastic', (-0.40, 1.04 + i * 0.06, 1.612), (0.12, 0.012, 0.008))
box('UB_Steel', (-0.40, 1.15, 1.612), (0.016, 0.28, 0.006))
tube('UB_Rubber', [(-0.33, 1.28, 1.68), (-0.25, 1.30, 1.72), (-0.12, 1.40, 1.80)], 0.007, seg=8, sub=4)
tube('UB_Rubber', [(-0.47, 1.05, 1.70), (-0.52, 0.95, 1.69)], 0.007, seg=8)

# ------------------------------------------------------------ exhaust -------
ZP = 1.655; MX = 0.41
def ring(m, y, x, z, r, w=0.008, seg=22): cyl(m, (x, y - w / 2, z), (x, y + w / 2, z), r, seg=seg)
tube('UB_ExhaustHot', [(-0.30, -1.62, 1.745), (-0.22, -1.45, 1.725), (-0.10, -1.30, 1.69), (0, -1.21, ZP)], 0.032, seg=14, sub=5)
tube('UB_ExhaustHot', [(0, -1.21 + 0.19 * i / 39, ZP) for i in range(40)], 0.034, seg=16, rf=lambda t: 1 + 0.07 * math.sin(t * 2 * math.pi * 14))
cyl('UB_ExhaustHot', (0, -1.02, ZP), (0, -0.96, ZP), 0.034, 0.060, seg=18)
cyl('UB_ExhaustHot', (0, -0.96, ZP), (0, -0.66, ZP), 0.060, seg=20, bev=0.004)
cyl('UB_ExhaustHot', (0, -0.66, ZP), (0, -0.60, ZP), 0.060, 0.030, seg=18)
for yy in (-0.94, -0.68): ring('UB_Exhaust', yy, 0, ZP, 0.0645, 0.006, 20)
tube('UB_ExhaustHot', [(0, -0.60, ZP), (0, -0.2, ZP)], 0.030, seg=14)
tube('UB_Exhaust', [(0, -0.2, ZP), (0, 0.30, ZP)], 0.030, seg=14)
# O2 sensors (upstream on the down-pipe, downstream behind the converter) with wires and connector
cyl('UB_Zinc', (-0.15, -1.38, 1.715), (-0.15, -1.38, 1.745), 0.011, seg=6); cyl('UB_Steel', (-0.15, -1.38, 1.745), (-0.15, -1.38, 1.775), 0.0075, seg=8)
cyl('UB_Zinc', (0, -0.55, ZP + 0.028), (0, -0.55, ZP + 0.045), 0.010, seg=6); cyl('UB_Steel', (0, -0.55, ZP + 0.045), (0, -0.55, ZP + 0.07), 0.0075, seg=8)
tube('UB_Wire', [(-0.15, -1.38, 1.775), (-0.20, -1.30, 1.80), (-0.245, -1.15, 1.80)], 0.003, seg=6, sub=4)
tube('UB_Wire', [(0, -0.55, ZP + 0.07), (-0.04, -0.5, 1.712), (-0.10, -0.40, 1.715), (-0.19, -0.26, 1.74), (-0.26, -0.20, 1.742)], 0.003, seg=6, sub=4)
box('UB_Plastic', (-0.26, -0.20, zf(-0.26, -0.20) - 0.010), (0.03, 0.045, 0.014), bev=0.003)
cyl('UB_Exhaust', (0, 0.30, ZP), (0, 0.36, ZP), 0.030, 0.070, seg=20)
cyl('UB_Exhaust', (0, 0.36, ZP), (0, 0.74, ZP), 0.070, seg=24, bev=0.006)
cyl('UB_Exhaust', (0, 0.74, ZP), (0, 0.80, ZP), 0.070, 0.030, seg=20)
for yy in (0.43, 0.67): ring('UB_Exhaust', yy, 0, ZP, 0.074, 0.008, 24)
ring('UB_Exhaust', 0.36, 0, ZP, 0.072, 0.004, 24); ring('UB_Exhaust', 0.74, 0, ZP, 0.072, 0.004, 24)        # welded end-cap seams
tube('UB_Exhaust', [(0, 0.80, ZP), (0, 1.25, ZP), (0.03, 1.33, 1.67), (0.18, 1.44, 1.70), (0.33, 1.55, 1.735), (MX, 1.62, 1.755)], 0.030, seg=14, sub=5)
MZ = 1.755
cyl('UB_Exhaust', (MX, 1.62, MZ), (MX, 1.70, MZ), 0.030, 0.078, seg=22)
cyl('UB_Exhaust', (MX, 1.70, MZ), (MX, 2.08, MZ), 0.078, seg=26, bev=0.005)
cyl('UB_Exhaust', (MX, 2.08, MZ), (MX, 2.16, MZ), 0.078, 0.028, seg=22)
for yy in (1.78, 1.9, 2.02): ring('UB_Exhaust', yy, MX, MZ, 0.082, 0.008, 26)
ring('UB_Exhaust', 1.70, MX, MZ, 0.080, 0.004, 26); ring('UB_Exhaust', 2.08, MX, MZ, 0.080, 0.004, 26)
for k in range(10): box('UB_Exhaust', (MX + 0.0, 1.74 + k * 0.034, MZ - 0.0785), (0.04, 0.003, 0.004))         # roll-seam
tube('UB_Exhaust', [(MX, 2.16, MZ), (MX, 2.27, MZ + 0.005), (MX, 2.31, MZ + 0.008)], 0.027, seg=14)
cyl('UB_Exhaust', (MX, 2.27, MZ + 0.005), (MX, 2.32, MZ + 0.008), 0.027, 0.036, seg=16)
for yy in (-1.21, -1.02, -0.99, -0.60, 0.30, 0.80, 1.62, 2.16):
    xx = MX if yy > 1.5 else 0.0; zz = MZ if yy > 1.5 else ZP
    cyl('UB_Exhaust', (xx, yy - 0.004, zz), (xx, yy + 0.004, zz), 0.045, seg=18)
    for a in range(4):
        aa = math.radians(45 + 90 * a)
        cyl('UB_Zinc', (xx + 0.04 * math.cos(aa), yy - 0.010, zz + 0.04 * math.sin(aa)), (xx + 0.04 * math.cos(aa), yy + 0.010, zz + 0.04 * math.sin(aa)), 0.0055, seg=6)
    if yy in (-0.6, 0.3, 0.8): cyl('UB_Mark', (xx + 0.04 * math.cos(math.radians(45)), yy + 0.0101, zz + 0.04 * math.sin(math.radians(45))), (xx + 0.04 * math.cos(math.radians(45)), yy + 0.0106, zz + 0.04 * math.sin(math.radians(45))), 0.0045, seg=6)
for (yy, xx, zz) in ((0.85, 0.0, ZP), (1.0, 0.0, ZP), (1.9, MX, MZ)):                                                # band clamps
    cyl('UB_Zinc', (xx, yy - 0.012, zz), (xx, yy + 0.012, zz), 0.0345 if zz == ZP else 0.0805, seg=20)
    box('UB_Zinc', (xx, yy, zz - (0.037 if zz == ZP else 0.084)), (0.03, 0.03, 0.012), bev=0.003)
def hanger(x, y, zp, zfl):
    cyl('UB_Rubber', (x, y, zp + 0.012), (x, y, zfl - 0.004), 0.011, 0.014, seg=10, bev=0.002)
    box('UB_Steel', (x, y, zfl - 0.003), (0.06, 0.04, 0.005), bev=0.0015)
    cyl('UB_Zinc', (x, y, zfl - 0.006), (x, y, zfl - 0.014), 0.007, seg=6)
    tube('UB_Steel', [(x, y, zfl - 0.004), (x, y, zp + 0.016), (x + 0.007, y, zp + 0.006), (x + 0.021, y, zp + 0.002)], 0.0032, seg=6, sub=4)
    cyl('UB_Zinc', (x + 0.021, y, zp - 0.001), (x + 0.021, y, zp + 0.005), 0.007, seg=6)
hanger(0, 0.93, ZP + 0.03, zf(0, 0.93)); hanger(0, 1.13, ZP + 0.03, zf(0, 1.13))
hanger(MX, 1.66, MZ + 0.075, zf(MX, 1.66)); hanger(MX, 2.10, MZ + 0.077, zf(MX, 2.10)); hanger(0.0, -0.40, ZP + 0.03, 1.745)

# ------------------------------------------------------------ heat shields --
def dimple(x, y, p=0.03):
    return 0.25 * (1 + math.cos(2 * math.pi * x / p)) * (1 + math.cos(2 * math.pi * (y + (0.5 * p if int(math.floor(x / p)) % 2 else 0)) / p))
def shield(x0, x1, y0, y1, zb, curl=0.02, perf=False):
    def z(x, y):
        d = min(x - x0, x1 - x)
        return zb - 0.0035 * dimple(x, y) * sm(0.0, 0.015, d) - curl * (1 - sm(0.0, 0.022, d))
    def mk(x, y):
        if not perf: return True
        px = (x - x0) % 0.03; py = y % 0.03
        return math.hypot(px - 0.015, py - 0.015) > 0.0085 or (x - x0) < 0.02 or (x1 - x) < 0.02
    hf('UB_Shield', (x0, x1), (y0, y1), 0.0075, z, mk)
shield(-0.12, 0.12, -1.00, -0.62, 1.730, perf=True)     # perforated cat shield
shield(-0.14, 0.14, -0.58, 0.22, 1.732)
shield(0.32, 0.49, 1.60, 2.22, 1.848)
for (x, y) in ((-0.1, -0.99), (0.1, -0.99), (-0.1, -0.62), (0.1, -0.62), (-0.12, 0.2), (0.12, 0.2), (-0.12, -0.55), (0.12, -0.55)):
    bolt(x, y, 1.728 - 0.001, 0.008, wash=True)

# ------------------------------------------------------------ rear axle -----
beam_sc = lambda t: (1.0, 1.0) if (0.18 < t < 0.82) else (0.78 + 0.22 * sm(0.0, 0.18, min(t, 1 - t)), 0.78 + 0.22 * sm(0.0, 0.18, min(t, 1 - t)))
# twist beam: tapered open U-section (opening facing down and to the rear)
sweep('UB_Steel', [(-0.435 + 0.87 * i / 12, 1.25, 1.60) for i in range(13)], hatprof(0.085, 0.060, 0.0055, 0.0, True), sc=beam_sc)
box('UB_Steel', (0, 1.222, 1.570), (0.80, 0.006, 0.030))
for sg in (1, -1):
    for dx in (0.34, 0.40): box('UB_Steel', (sg * dx, 1.25, 1.57), (0.045, 0.14, 0.012), bev=0.004)      # weld-on reinforcement
    # trailing arm: stamped U channel (open down), body-side bracket + angled bush eye
    sweep('UB_Steel', [(sg * 0.46, 0.88, 1.680), (sg * 0.46, 1.10, 1.676), (sg * 0.46, 1.25, 1.664), (sg * 0.46, 1.50, 1.664)], hatprof(0.05, 0.065, 0.005, 0.0, True), sub=3,
          sc=lambda t: (1.0, 1.0 + 0.2 * sm(0.0, 0.5, t)))
    prism('UB_Steel', [(sg * 0.435, 0.80), (sg * 0.495, 0.80), (sg * 0.495, 0.92), (sg * 0.435, 0.92)], 1.664, 1.692, bev=0.004)
    cyl('UB_Rubber', (sg * 0.395, 0.88, 1.655), (sg * 0.497, 0.88, 1.655), 0.031, seg=14, bev=0.003)
    cyl('UB_Steel', (sg * 0.395, 0.88, 1.655), (sg * 0.41, 0.88, 1.655), 0.040, seg=14)
    for dy in (-0.045, 0.045): bolt(sg * 0.46, 0.88 + dy * 1.6, 1.667 - 0.026, 0.009, mk=(dy < 0), wash=False)
    prism('UB_Steel', ngon(sg * 0.555, 1.42, 0.06, 8), 1.57, 1.585, bev=0.003)                          # hub plate (stub)
    for a in range(4):
        aa = math.radians(45 + 90 * a); bolt(sg * 0.555 + 0.032 * math.cos(aa), 1.42 + 0.032 * math.sin(aa), 1.57, 0.0085, wash=False)
    prism('UB_Steel', ngon(sg * 0.43, 1.34, 0.06, 14), 1.632, 1.646)                                    # welded spring seat
    tube('UB_Steel', [(sg * 0.43 + 0.06 * math.cos(a), 1.34 + 0.06 * math.sin(a), 1.646) for a in [2 * math.pi * i / 18 for i in range(18)]], 0.0035, seg=5, closed=True)
    cyl('UB_Rubber', (sg * 0.43, 1.34, 1.646), (sg * 0.43, 1.34, 1.654), 0.052, seg=16)                  # lower isolator
    cyl('UB_Rubber', (sg * 0.43, 1.34, 1.804), (sg * 0.43, 1.34, 1.822), 0.054, seg=16)                  # upper isolator
    N = 84
    pts = [(sg * (0.43 + 0.040 * math.cos(2 * math.pi * 5.5 * i / N)), 1.34 + 0.040 * math.sin(2 * math.pi * 5.5 * i / N), 1.654 + 0.150 * sm(0, 1, i / N)) for i in range(N + 1)]
    tube('UB_Steel', pts, 0.0058, seg=6)
    # damper: lower eye, tube, rod, dust boot, top mount
    cyl('UB_Steel', (sg * 0.465, 1.47, 1.62), (sg * 0.465, 1.47, 1.755), 0.021, seg=12, bev=0.002)
    cyl('UB_Zinc', (sg * 0.465, 1.47, 1.755), (sg * 0.465, 1.47, 1.835), 0.010, seg=8)
    cyl('UB_Rubber', (sg * 0.465, 1.47, 1.833), (sg * 0.465, 1.47, 1.858), 0.030, seg=12)
    cyl('UB_Steel', (sg * 0.43, 1.47, 1.617), (sg * 0.49, 1.47, 1.617), 0.019, seg=10)
    cyl('UB_Zinc', (sg * 0.49, 1.47, 1.617), (sg * 0.4985, 1.47, 1.617), 0.013, seg=6)
    cyl('UB_Mark', (sg * 0.4985, 1.47, 1.617), (sg * 0.4992, 1.47, 1.617), 0.0075, seg=6)
    cyl('UB_Zinc', (sg * 0.43, 1.47, 1.617), (sg * 0.41, 1.47, 1.617), 0.012, seg=6)
    tube('UB_Rubber', [(sg * 0.465, 1.47, 1.757), (sg * 0.465, 1.47, 1.80)], 0.026, seg=12, rf=lambda t: 1 + 0.14 * math.sin(t * 2 * math.pi * 3))
    z0 = zf(0.30, 1.30)
    tube('UB_Rubber', [(sg * 0.30, 1.30, z0), (sg * 0.30, 1.30, z0 - 0.075)], 0.036, seg=14, rf=lambda t: (1 - 0.35 * t) * (1 + 0.12 * math.sin(t * 2 * math.pi * 3)))
    box('UB_Steel', (sg * 0.30, 1.30, z0 - 0.002), (0.09, 0.09, 0.006), bev=0.002)
box('UB_Steel', (0, 2.22, 1.865), (1.32, 0.07, 0.07), bev=0.012)
for sg in (1, -1): box('UB_Steel', (sg * 0.40, 2.10, 1.85), (0.08, 0.22, 0.07), bev=0.008)
tube('UB_Steel', [(-0.40 + 0.04 * math.cos(a), 2.27, 1.86 + 0.04 * math.sin(a)) for a in [i * math.pi / 8 for i in range(14)]], 0.008, seg=8)
# spare wheel under the boot floor: tyre, rim, carrier plate and winch cable
if SPARE:
    SC = (0.0, 1.95); SZ = 1.742
    tube('UB_Tyre', [(SC[0] + 0.26 * math.cos(a), SC[1] + 0.26 * math.sin(a), SZ) for a in [2 * math.pi * i / 96 for i in range(96)]], 0.075, seg=16,
         ex=0.82, ey=1.0, closed=True, rf=lambda t: 1 + 0.025 * (1 if int(t * 96) % 2 else -1))
    cyl('UB_Steel', (SC[0], SC[1], SZ - 0.060), (SC[0], SC[1], SZ - 0.072), 0.200, 0.190, seg=40, bev=0.002)       # rim face
    cyl('UB_Steel', (SC[0], SC[1], SZ - 0.075), (SC[0], SC[1], SZ - 0.068), 0.070, seg=24)
    for a in range(5):
        aa = math.radians(72 * a + 18)
        tube('UB_Steel', [(SC[0] + 0.05 * math.cos(aa), SC[1] + 0.05 * math.sin(aa), SZ - 0.0735), (SC[0] + 0.15 * math.cos(aa + 0.1), SC[1] + 0.15 * math.sin(aa + 0.1), SZ - 0.072)], 0.012, seg=6)
    cyl('UB_Steel', (SC[0], SC[1], 1.83), (SC[0], SC[1], SZ - 0.075), 0.045, seg=16)
    cyl('UB_Zinc', (SC[0], SC[1], SZ - 0.0755), (SC[0], SC[1], SZ - 0.083), 0.028, seg=6, bev=0.002)
    cyl('UB_Mark', (SC[0], SC[1], SZ - 0.0832), (SC[0], SC[1], SZ - 0.0838), 0.020, seg=8)
    for a in range(3):
        aa = math.radians(120 * a + 90); tube('UB_Steel', [(SC[0] + 0.2 * math.cos(aa), SC[1] + 0.2 * math.sin(aa), 1.826), (SC[0] + 0.2 * math.cos(aa), SC[1] + 0.2 * math.sin(aa), SZ - 0.045)], 0.007, seg=6)
else:
    cyl('UB_Steel', (0, 1.95, 1.828), (0, 1.95, 1.80), 0.06, 0.05, seg=20, bev=0.004)

# ----------------------------------------------------------------- build ----
def finish(m, bm):
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a = e.calc_face_angle(None)
            if a is not None and a > math.radians(38): e.smooth = False
    me = bpy.data.meshes.new('UB_' + m[3:]); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('UB_' + m[3:], me); bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new(m); mat.use_nodes = True; b = mat.node_tree.nodes['Principled BSDF']
    c, r, mt = MATS[m]
    b.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1); b.inputs['Roughness'].default_value = r; b.inputs['Metallic'].default_value = mt
    mat.diffuse_color = (c[0], c[1], c[2], 1); me.materials.append(mat)
    return ob

objs = [finish(k, BM[k]) for k in MATS if len(BM[k].verts)]

# ------------------------------------------------- ambient occlusion -> COLOR_0
bpy.context.view_layer.update()
allv = []; alltri = []; base = 0
for ob in objs:
    me = ob.data; me.calc_loop_triangles()
    allv += [v.co.copy() for v in me.vertices]
    alltri += [tuple(base + i for i in t.vertices) for t in me.loop_triangles]
    base += len(me.vertices)
bvh = BVHTree.FromPolygons(allv, alltri)
NS = 14; DIRS = []
for i in range(NS):
    u = (i + 0.5) / NS; phi = i * 2.39996; r = math.sqrt(u)
    DIRS.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - u))))
for ob in objs:
    me = ob.data; cols = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        n = v.normal.normalized()
        t = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized(); b = n.cross(t)
        o = v.co + n * 0.003; hit = 0.0
        for d in DIRS:
            w = t * d.x + b * d.y + n * d.z
            loc, nn, idx, dist = bvh.ray_cast(o, w, 0.16)
            if loc is not None: hit += 1.0 - dist / 0.16 * 0.5
        ao = clamp(1.0 - 0.68 * hit / NS, 0.32, 1.0)
        cols.data[v.index].color = (ao, ao, ao, 1.0)
    me.color_attributes.active_color = cols; me.color_attributes.render_color_index = list(me.color_attributes.keys()).index('Col')

# -------------------------------------------------------------- self-check --
tris = 0; lo = Vector((9, 9, 9)); hi = Vector((-9, -9, -9)); viol = {}
WH = [(-1.449, 1.688), (1.408, 1.688)]
for ob in objs:
    me = ob.data; me.calc_loop_triangles(); tris += len(me.loop_triangles)
    for v in me.vertices:
        p = v.co
        for k in range(3): lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k])
        if abs(p.x) > 0.5:
            for (yc, zc) in WH:
                if math.hypot(p.y - yc, p.z - zc) < 0.44 - 1e-4: viol[ob.name] = viol.get(ob.name, 0) + 1
print('CHECK tris', tris, 'bbox lo', tuple(round(c, 3) for c in lo), 'hi', tuple(round(c, 3) for c in hi))
print('CHECK wheel-cylinder violations', viol)
print('CHECK objects', [(o.name, len(o.data.polygons)) for o in objs])

bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
kw = dict(filepath=OUT, export_format='GLB', use_selection=True, export_draco_mesh_compression_enable=False, export_yup=True,
          export_cameras=False, export_lights=False, export_apply=True, export_image_format='NONE')
try:
    bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True, **kw)
except TypeError:
    bpy.ops.export_scene.gltf(**kw)
print('EXPORTED', OUT)
