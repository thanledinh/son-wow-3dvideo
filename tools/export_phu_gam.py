"""Export GB_Innova_gam.blend for the three.js phu-gam page.

blender -b --factory-startup --disable-autoexec GB_Innova_gam.blend --python tools/export_phu_gam.py -- assets/phu-gam

Writes OUT_DIR/innova-gam.glb (Draco + WebP) and OUT_DIR/scene.json
(camera path, coat progress, spray glow, lights, coat material values), all in three.js axes (x, z, -y).
"""
import bpy, sys, os, json, math
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out, exist_ok=True)
sc = bpy.context.scene
info = {}


def v3(v):  # Blender Z-up -> three Y-up
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


def sock(s):
    if s.is_linked:
        l = s.links[0]
        return {"from": l.from_node.name, "out": l.from_socket.name}
    dv = getattr(s, "default_value", None)
    if dv is None:
        return None
    try:
        return [round(x, 4) for x in dv]
    except TypeError:
        return round(dv, 4) if isinstance(dv, float) else dv


def dump_mat(name):
    m = bpy.data.materials.get(name)
    if not m:
        return None
    nodes = {}
    for n in m.node_tree.nodes:
        d = {"type": n.bl_idname}
        for k in ("operation", "interpolation_type", "data_type", "blend_type", "noise_dimensions", "noise_type", "clamp"):
            if hasattr(n, k):
                d[k] = getattr(n, k)
        if n.bl_idname == "ShaderNodeValue":
            d["value"] = n.outputs[0].default_value
        d["in"] = {f"{i}:{s.name}": sock(s) for i, s in enumerate(n.inputs) if s.enabled and (s.is_linked or getattr(s, "default_value", None) is not None)}
        nodes[n.name] = d
    return nodes


info["materials"] = {k: dump_mat(k) for k in ("GB_Underbody_Scan", "GB_Undercoat_Black", "Garage_LED_Hex", "Garage_Wall_Blue",
                                               "Garage_Wall_Grey", "Garage_Tile_Black", "Lift_Blue_Paint")}

# ---- camera path, coat progress and spray glow, one sample per frame
cam = bpy.data.objects["Cam_Anim"]
glow = bpy.data.objects["Spray_Glow"]
scan_mat = bpy.data.materials["GB_Underbody_Scan"]
frames = []
for f in range(sc.frame_start, sc.frame_end + 1):
    sc.frame_set(f)
    mw = cam.matrix_world
    pos = mw.translation
    fwd = (mw.to_3x3() @ Vector((0, 0, -1))).normalized()
    up = (mw.to_3x3() @ Vector((0, 1, 0))).normalized()
    frames.append({
        "p": v3(pos), "f": v3(fwd), "u": v3(up), "lens": round(cam.data.lens, 3),
        "coat": round(scan_mat.node_tree.nodes["Coat_Progress"].outputs[0].default_value, 4),
        "glow": v3(glow.matrix_world.translation), "glowE": round(glow.data.energy, 3),
    })
info["fps"] = sc.render.fps
info["sensor"] = cam.data.sensor_width
info["frames"] = frames
sc.frame_set(1)

info["lights"] = []
for o in bpy.data.objects:
    if o.type == "LIGHT" and not o.hide_render:
        L = o.data
        d = {"name": o.name, "type": L.type, "pos": v3(o.matrix_world.translation),
             "dir": v3((o.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()),
             "energy": L.energy, "color": list(L.color)}
        if L.type == "AREA":
            d.update(shape=L.shape, size=L.size, size_y=L.size_y)
        info["lights"].append(d)
w = sc.world
if w and w.use_nodes:
    bg = next((n for n in w.node_tree.nodes if n.bl_idname == "ShaderNodeBackground"), None)
    if bg:
        info["world"] = {"color": sock(bg.inputs[0]), "strength": sock(bg.inputs[1])}
info["view"] = {"transform": sc.view_settings.view_transform, "look": sc.view_settings.look,
                "exposure": sc.view_settings.exposure, "gamma": sc.view_settings.gamma}

# ---- clean the scene: drop everything hidden in renders, cameras and lights
for o in list(bpy.data.objects):
    if o.hide_render or o.type in ("CAMERA", "LIGHT"):
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):  # empties left with no children
    if o.type == "EMPTY" and not o.children and o.name not in ("Cam_Target",):
        pass
if "Cam_Target" in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects["Cam_Target"], do_unlink=True)

# text and curves become meshes so the exporter keeps them
bpy.ops.object.select_all(action="DESELECT")
conv = [o for o in bpy.data.objects if o.type in ("FONT", "CURVE")]
for o in conv:
    o.select_set(True)
if conv:
    bpy.context.view_layer.objects.active = conv[0]
    bpy.ops.object.convert(target="MESH")
bpy.ops.object.select_all(action="DESELECT")

# ---- the coat materials are node networks the exporter can't carry: hand it plain stand-ins,
# three.js rebuilds the effect (it finds them by name).
def plain(name, color, rough, metal, image=None):
    m = bpy.data.materials[name]
    nt = m.node_tree
    nt.nodes.clear()
    outn = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if image:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(b.outputs["BSDF"], outn.inputs["Surface"])


scan_img = bpy.data.images["CIUC_RC01_ZB02_baseColor.png"]
scan_img.scale(4096, 4096)
plain("GB_Underbody_Scan", (1, 1, 1), 0.5, 0.0, scan_img)
plain("GB_Undercoat_Black", (0.02, 0.02, 0.022), 0.55, 0.0)

for im in bpy.data.images:
    if im.size[0] > 2048 and im is not scan_img:
        im.scale(2048, 2048)

# ---- decimate the heavy car meshes (the underbody scan stays full)
total_before = total_after = 0
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    total_before += tris
    if o.name.startswith("Object_") and tris > 20000:
        mod = o.modifiers.new("web_decimate", "DECIMATE")
        mod.ratio = 0.5
        mod.use_collapse_triangulate = True
        tris = int(tris * 0.5)
    total_after += tris
info["tris"] = {"before": total_before, "after_est": total_after}

with open(os.path.join(out, "scene.json"), "w", encoding="utf-8") as fp:
    json.dump(info, fp, separators=(",", ":"))

bpy.ops.export_scene.gltf(
    filepath=os.path.join(out, "innova-gam.glb"),
    export_format="GLB",
    use_visible=False,
    export_apply=True,
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_image_format="WEBP",
    export_image_quality=82,
)
print("TRIS", info["tris"])
print("DONE", os.path.getsize(os.path.join(out, "innova-gam.glb")) / 1e6, "MB")
