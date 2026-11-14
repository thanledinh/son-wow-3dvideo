// Turn a Sketchfab glTF download into a slim GLB for the phu-gam page (lift, worker, spray gun).
//
//   node tools/export_glb.mjs SRC_DIR OUT.glb path/to/three/examples/jsm/exporters/GLTFExporter.js [--clip up] [--max 512]
//
//   --clip NAME  keep only the animation whose name ends in NAME, renamed to NAME (default: drop all)
//   --max PX     largest texture side (default 512)
//   --flat       drop normal maps (for props seen small, where they cost more than they show)
//
// Blender's glTF round trip re-aims bones that meshes hang from (the lift's arms landed in the wrong place),
// so the conversion runs through three.js itself in headless Chrome: GLTFLoader reads the original and
// GLTFExporter writes it back with JPEG colour maps, without tangents or extra UV sets. Skinned characters
// come through as they are. Needs the site served on http://localhost:5291 (python -m http.server 5291),
// since the page's import map provides three; the exporter (same three version, r186) is not vendored, so it
// is passed in and staged next to the model.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const [srcDir, dst, exporterPath] = args;
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const CLIP = opt("--clip", "");
const MAX = Number(opt("--max", 512));
const FLAT = args.includes("--flat");

const ROOT = resolve(import.meta.dirname, "..");
const STAGE = join(ROOT, "assets", "phu-gam", "_glb_src");
cpSync(srcDir, STAGE, { recursive: true });
cpSync(exporterPath, join(STAGE, "GLTFExporter.js"));

// three.js no longer reads KHR_materials_pbrSpecularGlossiness (Ready Player Me avatars still use it), and such
// materials load untextured white: turn them into plain metal/rough ones (diffuse as base colour, not metallic).
const gltfPath = join(STAGE, "scene.gltf");
const gltf = JSON.parse(readFileSync(gltfPath, "utf8"));
const SG = "KHR_materials_pbrSpecularGlossiness";
for (const m of gltf.materials || []) {
  const sg = m.extensions?.[SG];
  if (!sg) continue;
  m.pbrMetallicRoughness = {
    ...(sg.diffuseTexture && { baseColorTexture: sg.diffuseTexture }),
    ...(sg.diffuseFactor && { baseColorFactor: sg.diffuseFactor }),
    metallicFactor: 0,
    roughnessFactor: 1 - (sg.glossinessFactor ?? 1) * 0.5,
  };
  delete m.extensions[SG];
}
for (const key of ["extensionsUsed", "extensionsRequired"]) {
  if (gltf[key]) gltf[key] = gltf[key].filter((e) => e !== SG);
}
writeFileSync(gltfPath, JSON.stringify(gltf));

const prof = mkdtempSync(join(tmpdir(), "glb-chrome-"));
const PORT = 9334;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--no-first-run", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let pages;
  for (let k = 0; k < 50 && !pages; k++) {
    try { pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable");
  // A page on the site's origin with the same import map as phu-gam.html.
  await send("Page.navigate", { url: "http://localhost:5291/phu-gam.html" });
  await sleep(3000);
  const res = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const { GLTFExporter } = await import("/assets/phu-gam/_glb_src/GLTFExporter.js");
      const g = await new GLTFLoader().loadAsync("/assets/phu-gam/_glb_src/scene.gltf");
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const t of [o.material.map, o.material.metalnessMap, o.material.roughnessMap]) if (t) t.userData.mimeType = "image/jpeg";
        for (const name of ["tangent", "uv1", "uv2"]) o.geometry.deleteAttribute(name);
        if (${FLAT}) o.material.normalMap = null;
      });
      const clip = ${JSON.stringify(CLIP)};
      const clips = clip ? g.animations.filter((a) => a.name.endsWith(clip)).map((a) => { a.name = clip; return a; }) : [];
      const buf = await new GLTFExporter().parseAsync(g.scene, { binary: true, animations: clips, maxTextureSize: ${MAX} });
      let s = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    })()`,
  });
  if (res.result.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 500));
  const out = Buffer.from(res.result.result.value, "base64");
  mkdirSync(resolve(dst, ".."), { recursive: true });
  writeFileSync(dst, out);
  console.log("wrote", dst, out.length, "bytes");
} finally {
  chrome.kill();
  await sleep(1000);
  rmSync(prof, { recursive: true, force: true });
  rmSync(STAGE, { recursive: true, force: true });
}
