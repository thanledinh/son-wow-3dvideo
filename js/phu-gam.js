import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { buildCorner, setWrap } from "./phu-gam-corner.js";
import { createWorker } from "./phu-gam-worker.js";
import { buildShop } from "./phu-gam-props.js";

// Bump when the model or scene data change: assets/ is cached for 7 days by nginx.
const VERSION = "6";
const MODEL_URL = `assets/phu-gam/innova-gam.glb?v=${VERSION}`;
const LIFT_URL = `assets/phu-gam/lift.glb?v=${VERSION}`;
const UNDER_URL = `assets/phu-gam/underbody.glb?v=${VERSION}`;
const UNDER_TRIM = [1.95, -2.05]; // the underbody model is kept between these z (nose, tail)
const WORKER_URL = `assets/phu-gam/worker.glb?v=${VERSION}`;
const SCENE_URL = `assets/phu-gam/scene.json?v=${VERSION}`;

// Scroll progress (0..1) -> frame (1..240) of GB's Blender animation, for its coat sweep and spray glow
// (frames 104-212 spray front to back). The camera no longer follows his orbit: see STORY_CAM.
const TIMELINE = [
  [0, 1],
  [0.06, 1],
  [0.32, 80],
  [0.42, 104],
  [0.88, 212],
  [1, 240],
];
// Scroll camera, keyed on scroll progress: head-on at the raised car, straight in towards its nose, down to
// floor level in front of it, then backing in under the car a couple of metres ahead of the sprayer, who
// works his way back facing it; once he is done it swings out to a low rear three-quarter view. Positions and
// targets run on a smooth curve through the keys.
const STORY_CAM = [
  { p: 0.06, pos: [0, 1.3, 7.0], look: [0, 1.75, 0], lens: 35 },
  { p: 0.3, pos: [0, 0.8, 4.6], look: [0, 1.55, 0.8], lens: 30 },
  { p: 0.4, pos: [0, 0.5, 3.8], look: [0, 1.45, 1.4], lens: 24 },
  { p: 0.45, pos: [0.05, 0.45, 3.6], look: [0.15, 1.5, 1.2], lens: 24 },
  // (up at the finished tail end of the floor, where the gloss shot leaves off)
  { p: 0.88, pos: [0.05, 0.45, -2.0], look: [0.15, 1.55, -0.4], lens: 22 },
  // the turn round happens under the car, so the eye sweeps over the freshly coated floor (not the ceiling),
  // then out past the rear bumper to the right while the sprayer leaves to the left
  { p: 0.91, pos: [0.1, 0.4, -1.2], look: [0.1, 1.5, 0.2], lens: 24 },
  { p: 0.94, pos: [1.6, 0.7, -3.8], look: [0, 1.2, -0.8], lens: 24 },
  { p: 1, pos: [3.2, 0.9, -4.4], look: [0, 1.45, 0], lens: 26 },
];
// The sprayer (scroll windows): walks in from the right of the nose, in sight of the camera, works backwards with
// GB's spray front standing just behind it and facing the front, then steps out to the left once the floor is done.
const SPRAYER = { enter: [0.36, 0.42], spray: [0.42, 0.88], exit: [0.88, 0.93], x: 0.25, behind: 0.4, from: [2.4, 2.4], outX: -1.8, reach: 1.66 };
// Blender light watts -> three.js intensities (area: W / (area·π), point: W / 4π), times a gain per light.
// Gains are set by eye against GB's renders: without the file's shadows and bounce the big ceiling lights
// wash the garage out, while the floor light under the car is what draws the highlights on the coat.
const LIGHT_GAIN = { Ceiling_Fill: 0.42, Top_Softbox: 0.4, Fill_Cool: 0.42, Key_Under: 1 /* steady under-car fill: off, the black coat had nothing to catch and went dark; what the user minded was the glow that came on with the spray (Spray_Glow) */, Spray_Glow: 0 /* the user: no light coming on where they spray */ };
const ENV_INTENSITY = 0.9;
const FLOOR_BOUNCE = 0.8;
const UNDER_FILL = { z: [-1.7, 0, 1.7], y: 0.5, cd: 2.6 };
// Opening, played once on load (seconds): the garage is dark, the car's lamps come on, the ceiling LEDs strike
// row by row from the far wall towards the camera, then the lift raises the car, watched head-on, into the
// story's first shot. Scrolling during it fast-forwards it.
const INTRO = { lamps: 0.6, leds: [1.9, 4.3], arms: [4.5, 5.5], lift: [5.7, 9.1], ui: 8.7, end: 9.5 };
// The opening camera: low in front of the car for the lamps, up at the ceiling while the LED rows strike,
// then round to dead centre in front of the car as the arms swing in; it rises with the car into the story's
// first shot. Each key holds the shot it arrives at.
const INTRO_CAM = [
  { t: 0, p: new THREE.Vector3(2.05, 0.5, 5.7), look: new THREE.Vector3(0, 1.05, 0.4) },
  { t: 1.4, p: new THREE.Vector3(1.98, 0.52, 5.55), look: new THREE.Vector3(0, 1.05, 0.4) },
  { t: 2.6, p: new THREE.Vector3(1.7, 0.75, 5.5), look: new THREE.Vector3(0, 3.4, -2.5) },
  { t: 4.1, p: new THREE.Vector3(1.6, 0.78, 5.35), look: new THREE.Vector3(0, 3.3, -2.5) },
  { t: 5.4, p: new THREE.Vector3(0, 1.0, 6.6), look: new THREE.Vector3(0, 0.95, 0) },
];
const INTRO_LENS = 26;
// The car starts on its wheels: its lowest point sits 1.345 m up in GB's file (on the raised lift).
const CAR_DROP = 1.345;
// Headlamp centres with the car raised (from the chrome reflectors' bounds); the beams aim down the garage.
const HEADLAMPS = [new THREE.Vector3(0.6, 2.2, 2.3), new THREE.Vector3(-0.6, 2.2, 2.3)];
const HEADLAMP_CD = 160;
// The Innova's lamp parts in 3dshowroom's model: chrome reflectors (shared with the grille trim, so they are lit
// only inside the headlamp boxes), the strip under the headlamps and the red tail lamp elements.
const LAMP_MATS = { reflector: "Attitude_Black_pbr_shader61", strip: "Attitude_Black_pbr_shader73", tail: "Attitude_Black_pbr_shader65" };
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Wheels come off while the camera circles the car (scroll windows per wheel), sit on the floor beside the lift
// through the spraying, and go back on as the camera pulls away. Centres are with the car raised, from the tyre
// meshes' bounds; tyres and rims are picked by material in 3dshowroom's model. The model has no brakes, so a
// disc, hub and caliper are built on each corner.
const WHEELS = {
  LF: new THREE.Vector3(0.77, 1.688, 1.449),
  RF: new THREE.Vector3(-0.78, 1.688, 1.449),
  LB: new THREE.Vector3(0.77, 1.688, -1.408),
  RB: new THREE.Vector3(-0.78, 1.688, -1.408),
};
const WHEEL_RADIUS = 0.341;
const WHEEL_MATS = ["Attitude_Black_pbr_shader59", "Attitude_Black_pbr_shader70", "Attitude_Black_pbr_shader71", "Attitude_Black_pbr_shader72"];
const WHEELS_OFF = { LF: [0.08, 0.17], RF: [0.1, 0.19], LB: [0.15, 0.24], RB: [0.17, 0.26] };
// (the wheels stay off through the end of the story and the explore view: window past the end = never put back)
const WHEELS_ON = [2, 3];
// Brakes are bagged once the wheels are off and unbagged before the wheels go back (scroll windows).
const WRAP_ON = [0.27, 0.33];
const WRAP_OFF = [0.85, 0.88];
// Where a wheel is set down: out past the lift posts, standing on its tread.
// (in by the posts: further out they filled the frame as the spray camera came round the car)
const WHEEL_PARK_X = 2.0;
const WHEEL_FLAT = 0.12; // a tyre's half width: the hub's height when it lies on the floor
// The underbody scan is an Impala's: widened to the Innova's sills, and floor liners close what still shows of
// the body shell between its edge and the sills (x from inner to outer, z between the wheel wells, rest height y).
const SCAN_WIDEN = 1.15;
const FLOOR_LINER = { inner: 0.5, outer: 0.88, y: 1.78 };
// Underside of the Innova's sills with the car raised; nothing of the scan may hang below it near the sides.
const SILL_BOTTOM = 1.6;
// Behind the rear axle the Impala's floor sits above the Innova's boot floor, so from below only that black
// carpet showed: a stamped rear floor pan goes just under it (back edge, front edge, height).
const REAR_PAN = { from: -2.08, to: -1.4, y: 1.83 };
// Wheel-well tubs (the model has no inner liners): a shell just above each tyre, coated by the same sweep.
const ARCH = { radius: 0.4, inner: 0.57, outer: 0.93, from: -0.35, to: Math.PI + 0.35 };

// Free orbit after the story: around the middle of the underbody, starting from the story's last shot.
const ORBIT_TARGET = new THREE.Vector3(0, 1.45, 0);
const ORBIT_LENS = 26;
const MAX_DPR = 1.5;
const EASE = REDUCED_MOTION ? 1 : 0.12;

const canvas = document.getElementById("gam");
const story = document.getElementById("story");
const explore = document.getElementById("xem-gam");
const slider = document.getElementById("coat");
const loader = document.getElementById("loader");
const loaderFill = document.getElementById("loaderFill");
const loaderPct = document.getElementById("loaderPct");
const progressFill = document.getElementById("progressFill");
const stage = story.querySelector(".stage");
const scrollHint = document.getElementById("scrollHint");

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- Coat shader ----------
// Rebuilds GB's "GB_Underbody_Scan" node network: a front runs along the car (object Y plus fBM noise at scale 6
// times 0.25); behind it the scan turns from grey steel (scan desaturated to 28%, value 0.9, metallic 0.35,
// roughness 0.6, bumped) into the black coat (0.004–0.018 from the scan's luminance, roughness 0.5–0.38,
// clear coat 0.55 at 0.14). The edge is 6 cm soft, like the node's Map Range 0..0.06.
const NOISE_GLSL = /* glsl */ `
vec3 gbHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float gbGrad(vec3 i, vec3 f, vec3 o) { return dot(gbHash(i + o), f - o); }
float gbNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gbGrad(i, f, vec3(0, 0, 0)), gbGrad(i, f, vec3(1, 0, 0)), u.x),
        mix(gbGrad(i, f, vec3(0, 1, 0)), gbGrad(i, f, vec3(1, 1, 0)), u.x), u.y),
    mix(mix(gbGrad(i, f, vec3(0, 0, 1)), gbGrad(i, f, vec3(1, 0, 1)), u.x),
        mix(gbGrad(i, f, vec3(0, 1, 1)), gbGrad(i, f, vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
// Blender-style fBM (detail 4, roughness 0.5), remapped to 0..1 like the Noise node's Factor output.
float gbFbm(vec3 p) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 5; i++) {
    sum += gbNoise(p) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2.0;
  }
  return clamp(0.5 + sum / norm, 0.0, 1.0);
}
`;

// GLSL test for a resting world position w inside one of the four wheel wells.
function wellTestGLSL() {
  const f = (v) => v.toFixed(3);
  return `abs(w.x) > ${f(ARCH.inner - 0.01)} && min(length(vec2(w.y - ${f(WHEELS.LF.y)}, w.z - ${f(WHEELS.LF.z)})),
    length(vec2(w.y - ${f(WHEELS.LB.y)}, w.z - ${f(WHEELS.LB.z)}))) < ${f(ARCH.radius + 0.015)}`;
}

// opts.world: run the front on the car's resting world position instead of the mesh's own axes (for the wheel-well
// tubs, which are built here rather than in GB's file); the scan's local axes match the car's, so both agree.
// The tubs also get grime and rust patches, having no texture of their own.
// opts.clipWells: cut away what the Impala scan has inside the Innova's wheel wells (its own arches sit elsewhere).
// opts.bare: roughness and metalness before the coat (default: GB's grey steel).
function coatMaterial(src, opts = {}) {
  // three layers, sprayed in three passes (the shop sprays 3 coats): each one's front (-3.5 none, 3.5 all)
  // Two sprayers share each pass: uCoat is the front half's sweep (nose ↔ middle), uCoatB the rear half's
  // (middle ↔ tail), per layer.
  const uCoat = { value: new THREE.Vector3(-3.5, -3.5, -3.5) };
  const uCoatB = { value: new THREE.Vector3(-3.5, -3.5, -3.5) };
  const objPos = opts.world
    ? "(modelMatrix * vec4(transformed, 1.0)).xyz + vec3(0.0, uDrop, 0.0)"
    : "position";
  const bare = { rough: 0.6, metal: 0.35, ...opts.bare };
  const mat = new THREE.MeshPhysicalMaterial({
    map: src.map,
    bumpMap: src.map,
    // The scan's texture is a patchwork of small charts, so its relief is noisy: kept faint.
    bumpScale: 0.5,
    metalness: 0.35,
    roughness: 0.6,
    // GB's coat weight is 0.55: the shop's coated wells photograph wet-glossy.
    clearcoat: 0.55,
    clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
  });
  mat.userData.uCoat = uCoat;
  mat.userData.uCoatB = uCoatB;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCoat = uCoat;
    sh.uniforms.uCoatB = uCoatB;
    sh.uniforms.uDrop = fx.drop;
    // The front's noise is coarse (scale 6, ~17 cm) and the scan is dense, so it is worked out per vertex.
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
uniform float uDrop;
varying vec3 vGbFront;
${NOISE_GLSL}`)
      // glTF stores Blender's local (x, y, z) as (x, z, -y).
      // Each layer's front: passes 1 and 3 run nose to tail, pass 2 tail to nose; each its own ragged edge.
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vec3 gbP = ${objPos};
vec3 gbObj = vec3(gbP.x, -gbP.z, gbP.y);
float gbN1 = gbFbm(gbObj * 6.0) * 0.25;
float gbN2 = gbFbm(gbObj * 6.0 + 3.7) * 0.25;
vGbFront = vec3(gbN1 + gbObj.y, gbN2 - gbObj.y, gbN2 + gbObj.y);
// where the two sprayers' halves meet (the car's middle), ragged like the edges
vGbHalf = -gbObj.y + gbN1 * 0.5;
vGbP = gbP;
vGbW = (modelMatrix * vec4(transformed, 1.0)).xyz + vec3(0.0, uDrop, 0.0);`)
      .replace("varying vec3 vGbFront;", "varying vec3 vGbFront;\nvarying float vGbHalf;\nvarying vec3 vGbP;\nvarying vec3 vGbW;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uCoat;
uniform vec3 uCoatB;
varying vec3 vGbFront;
varying float vGbHalf;
varying vec3 vGbP;
varying vec3 vGbW;
float gbK = 0.0;
float gbC = 0.0;    // first coat down (0..1)
float gbG = 0.0;    // gloss: 0 with one coat, 1 with all three
float gbLum = 0.0;
${NOISE_GLSL}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{
  // Sprayed coat: the lumpy, crinkled skin it has in the shop's photos (~2 cm lumps) over GB's fine noise bump
  // (scale 140); each layer fades out before it would shimmer.
  vec3 q = vGbP * 45.0;
  float fadeCoarse = 1.0 - smoothstep(0.35, 0.9, length(fwidth(q)));
  float fadeFine = 1.0 - smoothstep(0.35, 0.9, length(fwidth(q * 3.3)));
  // Seen edge-on the lumps only sparkle, so they flatten out towards grazing views too.
  float facing = smoothstep(0.12, 0.45, abs(dot(normal, normalize(vViewPosition))));
  float h = (gbNoise(q) * 0.0022 * fadeCoarse + gbNoise(q * 3.3) * 0.0007 * fadeFine) * gbG * facing;
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
}`)
      .replace("#include <bumpmap_pars_fragment>",
        // the scan's relief fades out under the coat
        THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll("bumpScale *", "bumpScale * (1.0 - gbK) *"))
      .replace("#include <map_fragment>", `#include <map_fragment>
{
  ${opts.clipWells ? `vec3 w = vGbW; if (${wellTestGLSL()}) discard;
  // and its torn side flanges, which would hang out past and below the Innova's sills
  if (abs(w.x) > ${FLOOR_LINER.outer.toFixed(2)} || (abs(w.x) > 0.7 && w.y < ${SILL_BOTTOM.toFixed(2)})) discard;` : ""}
  vec3 tex = diffuseColor.rgb;
  ${opts.world && !opts.clean ? `// factory stone-chip coat: mottled grey with lighter runs of seam sealer
  tex *= 0.6 + 0.8 * gbFbm(vGbP * 9.0);
  tex += vec3(0.07) * smoothstep(0.62, 0.8, gbFbm(vGbP * 3.5 + 7.0));` : ""}
  gbLum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
  // one coat a third of the way (a thin grey veil over the steel), two darker, three the full glossy black
  // the front half's sprayer works nose to middle and back, the rear half's middle to tail and back: on a pass
  // towards the tail the rear one's sweep stops at the middle, on the pass back the front one's does
  vec3 gbA = clamp((uCoat - vGbFront) / 0.06, 0.0, 1.0);
  vec3 gbB = clamp((uCoatB - vGbFront) / 0.06, 0.0, 1.0);
  float gbFrontHalf = smoothstep(-0.04, 0.04, vGbHalf);
  gbA.y *= gbFrontHalf;
  gbB.x *= 1.0 - gbFrontHalf;
  gbB.z *= 1.0 - gbFrontHalf;
  vec3 gbLayers = max(gbA, gbB);
  gbK = (gbLayers.x + gbLayers.y + gbLayers.z) / 3.0;
  gbC = gbLayers.x;
  gbG = clamp(gbK * 1.5 - 0.5, 0.0, 1.0);
#ifdef USE_MAP
  // Before: a washed factory underbody, as in the shop's photos (dark grey sealer, no junkyard rust). The
  // scan's own light and dark is kept only as shape: its colours belong to a scrapped Impala.
  float gbD = pow(clamp(gbLum / 0.3, 0.0, 1.0), 0.6);
  vec3 steel = mix(vec3(0.011, 0.012, 0.013), vec3(0.075, 0.078, 0.082), gbD);
#else
  vec3 steel = mix(vec3(gbLum), tex, 0.55) * 0.8;
#endif
  vec3 coat = vec3(mix(0.009, 0.03, gbLum));
  // (the colour comes on faster than the gloss: one coat already covers the steel dark, the third adds the shine)
  diffuseColor.rgb = mix(steel, coat, 1.0 - pow(1.0 - gbK, 4.0));
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
// one coat is a matte primer-black, the gloss builds with the second and third
roughnessFactor = mix(${bare.rough.toFixed(2)}, mix(0.85, mix(0.34, 0.26, gbLum), gbG), gbC);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
metalnessFactor = mix(${bare.metal.toFixed(2)}, 0.0, gbK);`)
      // The coat's Specular IOR Level is 0.25 (half the usual reflectance) against the steel's 0.5.
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
material.specularColor *= mix(1.0, 0.5, gbK);
#ifdef USE_CLEARCOAT
  material.clearcoat *= gbG;
#endif`)
      // Seen from below, the glossy coat mirrors the lit floor and walls and turns grey; the shop's photos show
      // it black with sharp highlights, so the coat keeps its lamp highlights but less of the room.
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  // (0.4 while lamps under the car lit it; with those off, the room's reflection is what shows the coat's gloss)
  radiance *= mix(1.0, 0.85, gbC);
  #ifdef USE_CLEARCOAT
    clearcoatRadiance *= mix(1.0, 0.85, gbC);
  #endif
#endif
${opts.deep ? `// the wells and liners sit deep under the car, where the studio's bright floor and light bars (all over the
// baked environment) don't reach; at full strength they turned these panels pale grey sheets
#if defined( RE_IndirectSpecular )
  radiance *= 0.25;
  #ifdef USE_CLEARCOAT
    clearcoatRadiance *= 0.25;
  #endif
#endif
  iblIrradiance *= 0.3;` : ""}`);
    // and the under-car light right below them glinted off every lump of the coat: a pale speckled sheet
    if (opts.deep) {
      sh.fragmentShader = sh.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
reflectedLight.directSpecular *= 0.2;
#ifdef USE_CLEARCOAT
  clearcoatSpecularDirect *= 0.2;
#endif`);
    }
  };
  return mat;
}

// ---------- Renderer, scene, lights ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
// (GB's file renders with AgX; in the dark studio ACES gives the deep blacks and punchy highlights the 911 page has)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
const glow = new THREE.PointLight(0xffffff, 0, 0, 2);
const glowB = new THREE.PointLight(0xffffff, 0, 0, 2); // the rear-half sprayer's
let frames = [];
let coatMats = [];
let car = null;
let carRestY = 0;
// Opening state shared with the shaders: lamps on (0..1), LED row sequence (0..1), and how far the car sits
// below its raised height (so lamp positions can be tested where they were measured).
const fx = { lamp: { value: 0 }, led: { value: 1 }, drop: { value: 0 } };
const roomLights = [];
const bgColor = new THREE.Color();
const halos = [];
const beams = [];
const lampMats = [];

function addLights(data) {
  RectAreaLightUniformsLib.init();
  bgColor.set(STUDIO.bg);
  scene.background = bgColor.clone();
  scene.fog = new THREE.Fog(STUDIO.bg, ...STUDIO.fog);
  addLightBars();
  // Light off the pale floor onto whatever faces down (the user: with the under-car lamps off the underbody went
  // dark): even, from everywhere below, no lamp and no hot spot. Comes up with the room's lights in the opening.
  const bounce = new THREE.HemisphereLight(0x000000, 0xe6e9ee, FLOOR_BOUNCE);
  scene.add(bounce);
  roomLights.push({ light: bounce, base: bounce.intensity });
  // and a steady row of soft lights low under the car, nose to tail, always on: the black coat needs something to
  // catch, but nothing that comes on with the spray or follows it
  for (const z of UNDER_FILL.z) {
    const fill = new THREE.PointLight(0xf4f6fa, UNDER_FILL.cd, 0, 2);
    fill.position.set(0, UNDER_FILL.y, z);
    scene.add(fill);
    roomLights.push({ light: fill, base: fill.intensity });
  }
  for (const L of data.lights) {
    const color = new THREE.Color().setRGB(...L.color);
    const dir = new THREE.Vector3().fromArray(L.dir);
    const pos = new THREE.Vector3().fromArray(L.pos);
    if (L.type === "AREA") {
      const w = L.size;
      const h = L.shape === "RECTANGLE" || L.shape === "ELLIPSE" ? L.size_y : L.size;
      const light = new THREE.RectAreaLight(color, (L.energy / (w * h * Math.PI)) * (LIGHT_GAIN[L.name] ?? 0.15), w, h);
      light.position.copy(pos);
      // Blender's size_y runs along the car (-Z here) for the lights that point straight up or down.
      if (Math.abs(dir.y) > 0.99) light.up.set(0, 0, -1);
      light.lookAt(pos.clone().add(dir));
      scene.add(light);
      roomLights.push({ light, base: light.intensity });
    } else if (L.name === "Spray_Glow") {
      glow.color.copy(color);
      glow.position.copy(pos);
      glowB.color.copy(color);
      scene.add(glow, glowB);
    }
  }
}

// ---------- Studio ----------
// A dark detailing studio, as the dealer site's 911 stands in (the user: GB's bright garage looked cheap and the car
// toy-like). The garage's walls, roof, shutter and truss go; the hex LED ceiling hangs in the dark; the floor is
// dark epoxy fading into fog; light bars stand round the car, which put long reflections down its sides (they are
// in the baked environment too); the lift is graphite instead of blue and yellow.
const STUDIO = {
  // (the user's boss: no showroom is that dark) lit up: the walls are back, in a showroom's pale grey, the floor is
  // mid-grey epoxy and the room beyond is a soft grey instead of black
  bg: 0x3a3d42,
  fog: [14, 40],
  hide: new Set(["Garage_Roof", "Garage_Shutter", "Garage_Truss"]),
  walls: { Garage_Wall_Blue: 0.42, Garage_Wall_Grey: 0.5, Garage_Trim_White: 0.7 },
  floor: { tile: 0.07, line: 0.16 },
  bars: { at: [[4.1, 3.3], [-4.1, 3.3], [4.1, -3.3], [-4.1, -3.3]], bottom: 0.25, height: 2.7, width: 0.09, glow: 6 },
};
const lightBars = [];

function addLightBars() {
  const { at, bottom, height, width, glow } = STUDIO.bars;
  const tube = new THREE.BoxGeometry(width, height, width);
  const foot = new THREE.CylinderGeometry(0.16, 0.2, 0.04, 24);
  const footMat = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.6, roughness: 0.35 });
  for (const [x, z] of at) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.95).multiplyScalar(glow) });
    const bar = new THREE.Mesh(tube, mat);
    bar.position.set(x, bottom + height / 2, z);
    const base = new THREE.Mesh(foot, footMat);
    base.position.set(x, 0.02, z);
    scene.add(bar, base);
    lightBars.push(mat);
  }
}

// Paints a lift material graphite: its own texture's light and shade, almost none of its colour.
function graphite(m) {
  m.metalness = 0.55;
  m.roughness = 0.38;
  m.metalnessMap = m.roughnessMap = null;
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
  float gLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(vec3(gLum), diffuseColor.rgb, 0.08) * 0.3;`);
  };
}

function prepareModel(root) {
  const dropped = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    // GB's flat filler boxes (floor pan, engine block, bay cover, firewall) predate the scan and poke through it
    // from below and out under the bumpers; the scan is the underbody now.
    if (m.name === "GB_Undercoat_Black" || STUDIO.hide.has(m.name)) {
      dropped.push(o);
      return;
    }
    // The Impala scan GB used for the underbody goes (the user: it looked fake): assets/phu-gam/underbody.glb, an
    // Innova Zenix underbody modelled from photos of the real car (tools/build_underbody.py), stands in (addUnderbody).
    if (m.name === "GB_Underbody_Scan") {
      dropped.push(o);
      return;
    }
    // 3dshowroom's export makes the black trims, tyres and cabin metallic, which gives them a grey sheen;
    // they are plastic, rubber and leather.
    const lum = m.color ? 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b : 1;
    if (m.metalness >= 0.9 && m.roughness >= 0.5 && lum < 0.35 && !m.map) m.metalness = 0;
    // The floor: dark polished epoxy, the bay's lines a shade lighter.
    if (m.name.startsWith("Garage_Tile")) {
      m.map = null;
      m.color.setScalar(m.name === "Garage_Tile_Yellow" ? STUDIO.floor.line : STUDIO.floor.tile);
      m.roughness = m.name === "Garage_Tile_Yellow" ? 0.45 : 0.28;
      m.metalness = 0;
      m.roughnessMap = m.metalnessMap = null;
      if (m.normalMap) m.normalScale.multiplyScalar(0.4);
    }
    if (STUDIO.walls[m.name]) {
      m.map = null;
      m.color.setScalar(STUDIO.walls[m.name]);
      m.roughness = 0.85;
      m.metalness = 0;
      m.roughnessMap = m.metalnessMap = null;
    }
    if (m.name === "Garage_LED_Hex") ledRows(o);
    if (m.name === LAMP_MATS.reflector) headlampReflector(m);
    if (m.name === LAMP_MATS.strip) lampMats.push({ m, color: new THREE.Color(1, 0.97, 0.92), gain: 4 });
    if (m.name === LAMP_MATS.tail) lampMats.push({ m, color: new THREE.Color(1, 0.03, 0.02), gain: 3 });
    // Real transmission renders the scene a second time every frame; tinted see-through glass is enough here.
    if (m.transmission > 0) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = Math.min(m.opacity, 0.35);
      m.depthWrite = false;
    }
  });
  for (const o of dropped) o.removeFromParent();
  car = root.getObjectByName("Innova_Zenix_2023");
  // The body paint: 3dshowroom's is a black metal (a black metal's reflection is black too, so the body read flat and
  // toy-like); here it is car paint, a near-black base under a mirror clear coat, as the 911 on the dealer site.
  const paint = new THREE.MeshPhysicalMaterial({
    // (the base's own reflection kept faint: blurred over the bright floor and light bars it greyed the body)
    name: "Innova_Paint", color: new THREE.Color().setScalar(0.004), metalness: 0, roughness: 0.4, specularIntensity: 0.15,
    clearcoat: 1, clearcoatRoughness: 0.02,
  });
  car.traverse((o) => {
    if (o.isMesh && o.material.name === "Attitude_Black_pbr_shader53") o.material = paint;
  });
  carRestY = car.position.y;
  for (const { m, color } of lampMats) {
    m.emissive.copy(color);
    m.emissiveIntensity = 0;
  }

  // Headlamps: a soft halo on each lens and a beam down the garage, carried by the car.
  const haloMap = haloTexture();
  for (const at of HEADLAMPS) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloMap, color: 0xfff3e2, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
    }));
    halo.position.copy(at);
    halo.scale.setScalar(0.34);
    car.attach(halo);
    halos.push(halo);

    const beam = new THREE.SpotLight(0xfff1dc, 0, 0, 0.42, 0.6, 2);
    beam.position.copy(at);
    beam.target.position.set(at.x * 1.6, 1.0, 10);
    car.attach(beam);
    car.attach(beam.target);
    beams.push(beam);
  }

  setupWheels(root);
}

// ---------- Lift ----------
// Sargone's "Car lift" (Sketchfab, CC BY 4.0) stands in for GB's hand-built one. Its own "up" clip folds the
// arms out from the posts (0–10 s), then raises them (10–21.4 s). The page sets the clip's time itself: the
// swing belongs to the opening, and the rise follows the car, so the pads stay under the sills all the way up.
const LIFT_CLIP = { swung: 10, top: 21.42 };
// Where the pads meet the Innova's sills with the car raised (GB's own lift pads topped out here).
const LIFT_PAD_TOP = 1.57;
const lift = { mixer: null, action: null, padTop: [] };

function setupLift(root, g) {
  root.getObjectByName("GB_Lift2P").removeFromParent();
  const model = g.scene;
  // Its posts stand along its own z; ours stand across the car, along x. Centre them on GB's.
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI / 2;
  holder.add(model);
  root.add(holder);
  holder.updateMatrixWorld(true);
  const mid = new THREE.Vector3();
  for (const name of ["rack_rack_0", "rack001_rack001_0"]) {
    mid.addScaledVector(new THREE.Box3().setFromObject(model.getObjectByName(name)).getCenter(new THREE.Vector3()), 0.5);
  }
  holder.position.set(-mid.x, 0, -mid.z);

  model.traverse((o) => o.isMesh && graphite(o.material));
  lift.mixer = new THREE.AnimationMixer(model);
  lift.action = lift.mixer.clipAction(g.animations[0]);
  lift.action.play();
  lift.action.paused = true;
  // How high the pads are through the rise, to find the clip time that holds them at a given height.
  const pads = ["lift006_lift_0", "lift007_lift_0", "lift008_lift001_0", "lift009_lift001_0"].map((n) => model.getObjectByName(n));
  const box = new THREE.Box3();
  for (let t = LIFT_CLIP.swung; t <= LIFT_CLIP.top; t += 0.1) {
    setLift(t);
    model.updateMatrixWorld(true);
    let top = -Infinity;
    for (const p of pads) top = Math.max(top, box.setFromObject(p).max.y);
    lift.padTop.push([t, top]);
  }
}

function setLift(t) {
  lift.action.time = t;
  lift.mixer.update(0);
}

function liftTimeFor(padTop) {
  const table = lift.padTop;
  if (padTop <= table[0][1]) return table[0][0];
  for (let i = 1; i < table.length; i++) {
    const [t1, y1] = table[i];
    if (padTop <= y1) {
      const [t0, y0] = table[i - 1];
      return lerp(t0, t1, (padTop - y0) / Math.max(1e-6, y1 - y0));
    }
  }
  return table[table.length - 1][0];
}

// ---------- Wheels and wheel wells ----------
const wheels = {};
const corners = [];

// ---------- The sprayer ----------
let sprayers = [];
const sprayAt = new THREE.Vector3();
const sprayTarget = new THREE.Vector3();
const SPRAY_FROM = new THREE.Vector3();
const SPRAY_TO = new THREE.Vector3();

// Where he stands while spraying: behind the spray front, but never out past the tail (at the tail end of a pass he
// stands under the bumper and sprays more steeply up, instead of stepping out of the car's shadow and the shot).
function sprayerZ(glowZ) {
  return Math.max(glowZ - SPRAYER.behind, -2.5);
}

// The crew: the front-half sprayer and the rear-half one, where each walks in from (clear of the posts), the
// z its half's passes start and end at, where it walks out to, and the spray front it follows.
const CREW = [
  // from / out: where each one waits beside the car before and after the spraying (clear of the laid wheels at
  // x ±2.0, z ±1.4, the posts, the cart and the compressor)
  // (both at the nose's corners, in the head-on opening shot)
  { x: 0.3, from: [1.95, 2.5], startZ: 2.42, endZ: 0, out: [1.95, 2.5], glow: () => pose.glow },
  // the rear man stays put (the user: one can stand on the spot and turn about to spray), off to the side of
  // his half's middle, turning round with the front as it runs past him: towards the nose, across, towards the tail
  { x: -0.75, from: [-1.95, 2.6], startZ: -1.2, endZ: -1.2, out: [-1.95, 2.6], glow: () => pose.glowB, stay: true, aimX: 0.15 },
];

// Where each one stands, which way he faces and what he sprays at story progress p (e: how far into the orbit).
function updateSprayer(p, e, dt) {
  CREW.forEach((c, i) => updateOne(sprayers[i], c, p, e, dt));
}

// Turn from angle a to b the short way round.
function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function updateOne(sprayer, c, p, e, dt) {
  const startZ = c.stay ? c.startZ : sprayerZ(c.startZ);
  const endZ = c.stay ? c.endZ : sprayerZ(c.endZ);
  // the way he faces at work: square to the car, or (planted) towards the front
  const workYaw = c.stay ? Math.atan2(c.aimX - c.x, c.glow().z - c.startZ) : 0;
  // (the user: have them standing ready at either side from the start) where he waits beside the car, facing it
  const waitYaw = Math.atan2(-c.from[0], 0);
  let yaw = 0;
  if (p < SPRAYER.enter[1]) {
    const k = smooth(span(p, SPRAYER.enter));
    SPRAY_FROM.set(c.from[0], 0, c.from[1]);
    SPRAY_TO.set(c.x, 0, startZ);
    sprayAt.lerpVectors(SPRAY_FROM, SPRAY_TO, k);
    // turns from the car to where he goes, walks in, turning to face the front as he arrives
    const walk = Math.atan2(SPRAY_TO.x - SPRAY_FROM.x, SPRAY_TO.z - SPRAY_FROM.z);
    yaw = k < 0.15 ? lerpAngle(waitYaw, walk, smooth(k / 0.15)) : lerpAngle(walk, workYaw, smooth(clamp(k * 1.4 - 0.4, 0, 1)));
    // (waiting, the gun is held low, pointed at the floor in front of him; it comes up as he walks in)
    sprayTarget.set(c.x * 0.5, lerp(0.7, SPRAYER.reach, k), c.startZ);
  } else if (p <= SPRAYER.spray[1]) {
    const g = c.glow();
    if (c.stay) {
      // planted, turning to face the front wherever it is
      sprayAt.set(c.x, 0, c.startZ);
      sprayTarget.set(c.aimX, SPRAYER.reach, g.z);
      yaw = Math.atan2(sprayTarget.x - sprayAt.x, sprayTarget.z - sprayAt.z);
    } else {
      sprayAt.set(c.x, 0, sprayerZ(g.z));
      sprayTarget.set(g.x, SPRAYER.reach, g.z);
    }
  } else {
    const k = smooth(span(p, SPRAYER.exit));
    SPRAY_FROM.set(c.x, 0, endZ);
    SPRAY_TO.set(c.out[0], 0, c.out[1]);
    sprayAt.lerpVectors(SPRAY_FROM, SPRAY_TO, k);
    // back to his place beside the car, turning to face it again as he gets there
    const walk = Math.atan2(SPRAY_TO.x - SPRAY_FROM.x, SPRAY_TO.z - SPRAY_FROM.z);
    yaw = k < 0.85 ? lerpAngle(workYaw, walk, smooth(clamp(k * 3, 0, 1))) : lerpAngle(walk, waitYaw, smooth((k - 0.85) / 0.15));
    sprayTarget.set(c.x * 0.5, lerp(SPRAYER.reach, 0.7, k), c.endZ);
  }
  // the camera never passes through him: within arm's length of it he fades away
  const off = Math.hypot(camera.position.x - sprayAt.x, camera.position.z - sprayAt.z, Math.max(0, camera.position.y - 1.75));
  const clear = smooth(clamp((off - 0.5) / 0.45, 0, 1));
  const spraying = span(p, [SPRAYER.spray[0], SPRAYER.spray[0] + 0.01]) * (1 - span(p, [SPRAYER.spray[1] - 0.01, SPRAYER.spray[1]]));
  sprayer.update({
    // (solid in the explore view too, standing at their places: half faded they were ghosts, legs without a body)
    visible: clear,
    at: sprayAt,
    yaw,
    target: sprayTarget,
    spraying: spraying * pose.sprayOn * (1 - e),
    // settled into his working stance once he has walked in, out of it as he walks off
    working: smooth(span(p, [SPRAYER.enter[1] - 0.02, SPRAYER.enter[1]])) * (1 - smooth(span(p, [SPRAYER.exit[0], SPRAYER.exit[0] + 0.02]))),
    dt: Math.max(dt, 1 / 120),
    scale: (H * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)),
  });
}

function wheelKey(v, maxR) {
  for (const [key, c] of Object.entries(WHEELS)) {
    if (Math.sign(v.x) === Math.sign(c.x) && Math.hypot(v.y - c.y, v.z - c.z) < maxR) return key;
  }
  return null;
}

// Splits a mesh's triangles into per-wheel meshes (keyOf gives a wheel or null for "stays with the car").
function splitMesh(mesh, keyOf) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = g.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const buckets = new Map();
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, t * 3).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(mesh.matrixWorld);
    const key = keyOf(a, b, c);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  if (buckets.size === 1 && buckets.has(null)) return {};
  const parts = {};
  for (const [key, tris] of buckets) {
    const ng = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize * 3;
      const arr = new attr.array.constructor(tris.length * n);
      tris.forEach((t, j) => arr.set(attr.array.subarray(t * n, (t + 1) * n), j * n));
      ng.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize, attr.normalized));
    }
    const part = new THREE.Mesh(ng, mesh.material);
    part.name = `${mesh.name}_${key || "car"}`;
    part.position.copy(mesh.position);
    part.quaternion.copy(mesh.quaternion);
    part.scale.copy(mesh.scale);
    mesh.parent.add(part);
    part.updateMatrixWorld();
    parts[key] = part;
  }
  mesh.removeFromParent();
  return parts;
}

function setupWheels(root) {
  root.updateMatrixWorld(true);
  for (const [key, c] of Object.entries(WHEELS)) {
    const group = new THREE.Group();
    group.position.copy(c);
    root.add(group);
    group.updateMatrixWorld();
    wheels[key] = { group, rest: c.clone(), sign: Math.sign(c.x) };
  }
  const centroid = new THREE.Vector3();
  const meshes = [];
  car.traverse((o) => o.isMesh && meshes.push(o));
  for (const mesh of meshes) {
    const name = mesh.material.name;
    if (name.startsWith("GB_") || name === "") continue;
    const whole = WHEEL_MATS.includes(name);
    const parts = splitMesh(mesh, (a, b, c) => {
      if (whole) return wheelKey(centroid.copy(a).add(b).add(c).divideScalar(3), 0.45);
      // Bits of other parts that sit inside a tyre, outboard of the brake (centre caps, lettering) go too.
      const k = wheelKey(a, 0.335);
      return k && k === wheelKey(b, 0.335) && k === wheelKey(c, 0.335) && Math.min(Math.abs(a.x), Math.abs(b.x), Math.abs(c.x)) > 0.7 ? k : null;
    });
    for (const [key, part] of Object.entries(parts)) {
      if (key !== "null") wheels[key].group.attach(part);
    }
  }

  // Wheel-well tubs, carried by the car and coated with the underbody. Before: the factory's dull grey
  // stone-chip coat, as in the shop's before/after photos.
  const tubMat = coatMaterial({ map: null }, { world: true, deep: true, bare: { rough: 0.85, metal: 0 } });
  // (dark plastic liner grey: lighter, under the studio lights it read as flat cardboard)
  tubMat.color.setRGB(0.045, 0.046, 0.048);
  tubMat.bumpMap = null;
  coatMats.push(tubMat);
  // Floor liners along both sills, between the wells, just above the scan's floor so the scan covers them
  // wherever it reaches. Same sealer as the bare scan; coated by the same sweep.
  const linerMat = coatMaterial({ map: null }, { world: true, deep: true, bare: { rough: 0.72, metal: 0.1 } });
  linerMat.color.setRGB(0.06, 0.062, 0.066);
  linerMat.bumpMap = null;
  coatMats.push(linerMat);
  const zFrom = WHEELS.LB.z + ARCH.radius;
  const zTo = WHEELS.LF.z - ARCH.radius;
  const addPan = (geo, x, y, z) => {
    const pan = new THREE.Mesh(geo, linerMat);
    pan.position.set(x, y, z);
    root.add(pan);
    pan.updateMatrixWorld();
    car.attach(pan);
  };
  for (const s of [1, -1]) {
    const w = FLOOR_LINER.outer - FLOOR_LINER.inner;
    addPan(new THREE.PlaneGeometry(w, zTo - zFrom, 8, 24).rotateX(Math.PI / 2), s * (FLOOR_LINER.inner + w / 2), FLOOR_LINER.y, (zFrom + zTo) / 2);
  }
  // Rear floor pan: full width behind the rear wells, between them where they are.
  const wellBack = WHEELS.LB.z - ARCH.radius;
  addPan(stampedPan(2 * ARCH.inner - 0.02, REAR_PAN.to - REAR_PAN.from), 0, REAR_PAN.y, (REAR_PAN.from + REAR_PAN.to) / 2);
  for (const s of [1, -1]) {
    const w = FLOOR_LINER.outer - ARCH.inner + 0.01;
    addPan(stampedPan(w, wellBack - REAR_PAN.from), s * (ARCH.inner - 0.01 + w / 2), REAR_PAN.y, (REAR_PAN.from + wellBack) / 2);
  }

  for (const c of Object.values(WHEELS)) {
    const s = Math.sign(c.x);
    // Hub, brake and suspension, built for a left-hand corner (+x outward) and mirrored for the right.
    const corner = buildCorner({ front: c.z > 0 });
    corner.position.set(s * (Math.abs(c.x) + 0.03), c.y, c.z);
    corner.scale.x = s;
    root.add(corner);
    corner.updateMatrixWorld(true);
    car.attach(corner);
    corners.push(corner);

    const width = ARCH.outer - ARCH.inner;
    const shell = new THREE.Mesh(tubShell(width), tubMat);
    shell.rotation.z = Math.PI / 2;
    shell.position.set(s * (ARCH.inner + width / 2), c.y, c.z);
    // The inner wall closes right down to the hub, or the body shell shows black through its middle.
    const wall = new THREE.Mesh(pressedWall(), tubMat);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(s * ARCH.inner, c.y, c.z);
    for (const m of [shell, wall]) {
      root.add(m);
      m.updateMatrixWorld();
      car.attach(m);
    }
  }
}

// A floor panel facing down with pressed ribs across it, so it reads as stamped steel rather than a flat board.
function stampedPan(width, length) {
  const geo = new THREE.PlaneGeometry(width, length, Math.ceil(width * 40), Math.ceil(length * 40)).rotateX(Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // ribs every 9 cm across the car, softened towards the panel's edges
    const edge = Math.min(1, (width / 2 - Math.abs(x)) / 0.08, (length / 2 - Math.abs(z)) / 0.08);
    const rib = Math.max(0, Math.cos((z / 0.09) * Math.PI * 2)) ** 3;
    pos.setY(i, pos.getY(i) + 0.008 * rib * Math.max(0, edge));
  }
  geo.computeVertexNormals();
  return geo;
}

// The well's inner wall: a pressed panel (a raised ring and a few swages), not a flat board.
function pressedWall() {
  const geo = new THREE.RingGeometry(0.06, ARCH.radius, 64, 12, ARCH.from, ARCH.to - ARCH.from);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y) / ARCH.radius;
    const a = Math.atan2(y, x);
    const dome = 0.03 * Math.sin(Math.PI * Math.min(1, r * 1.05)); // bulges in towards the car's middle
    const swage = 0.008 * Math.max(0, Math.cos((r - 0.62) * 28)) + 0.005 * Math.sin(6 * a) * r;
    pos.setZ(i, -(dome + swage));
  }
  geo.computeVertexNormals();
  return geo;
}

// The wheel-house shell: not a clean cylinder but pressed panels, so it rises and dips a centimetre or two
// around the arch and across it.
function tubShell(width) {
  const geo = new THREE.CylinderGeometry(ARCH.radius, ARCH.radius, width, 64, 8, true, ARCH.from, ARCH.to - ARCH.from);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(x, z);
    const t = y / width;
    const dr = 0.012 * Math.sin(5 * a + 1.3) * Math.cos(7 * t) + 0.007 * Math.sin(13 * a + 4 * t) + 0.01 * (Math.abs(t) > 0.35 ? 1 : 0);
    const k = (ARCH.radius + dr) / ARCH.radius;
    pos.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// Where each wheel is at story progress p: pulled off the studs, set down beside the lift, put back at the end.
function placeWheels(p) {
  setWrap(corners, smooth(span(p, WRAP_ON)) * (1 - smooth(span(p, WRAP_OFF))));
  for (const [key, w] of Object.entries(wheels)) {
    const off = span(p, WHEELS_OFF[key]) * (1 - span(p, WHEELS_ON));
    const pull = smooth(clamp(off / 0.35, 0, 1));
    const park = clamp((off - 0.35) / 0.65, 0, 1);
    const g = w.group.position.copy(w.rest);
    g.x += w.sign * (0.32 * pull + (WHEEL_PARK_X - Math.abs(w.rest.x) - 0.32) * (1 - (1 - park) ** 2));
    // laid flat on the floor, as a shop does (standing up they filled the frame as the camera came round)
    g.y += (WHEEL_FLAT - w.rest.y) * park ** 2 - fx.drop.value;
    w.group.rotation.z = -w.sign * (Math.PI / 2) * smooth(park);
  }
}

// The scan's surface is lumpy from the photo reconstruction. A few rounds of Taubin smoothing (a pull towards
// the neighbours' average, then a slightly stronger push back) take the lumps out without shrinking the panels.
// Vertices are welded by position first so UV seams don't tear, and the open rim of the scan stays pinned.
function taubinSmooth(geo, rounds) {
  const pos = geo.attributes.position;
  const ids = new Map();
  const weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    weld[i] = ids.get(k);
  }
  const n = ids.size;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < pos.count; i++) {
    p[weld[i] * 3] = pos.getX(i);
    p[weld[i] * 3 + 1] = pos.getY(i);
    p[weld[i] * 3 + 2] = pos.getZ(i);
  }
  const at = (k) => weld[geo.index ? geo.index.getX(k) : k];
  const tris = (geo.index ? geo.index.count : pos.count) / 3;
  const nbrs = Array.from({ length: n }, () => new Set());
  const edgeUse = new Map();
  for (let t = 0; t < tris; t++) {
    const v = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      nbrs[a].add(b);
      nbrs[b].add(a);
      const key = a < b ? a * n + b : b * n + a;
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
    }
  }
  const pinned = new Uint8Array(n);
  for (const [key, uses] of edgeUse) {
    if (uses === 1) {
      pinned[Math.floor(key / n)] = 1;
      pinned[key % n] = 1;
    }
  }
  const step = (f) => {
    const next = p.slice();
    for (let i = 0; i < n; i++) {
      if (pinned[i] || !nbrs[i].size) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of nbrs[i]) {
        x += p[j * 3];
        y += p[j * 3 + 1];
        z += p[j * 3 + 2];
      }
      const c = nbrs[i].size;
      next[i * 3] += f * (x / c - p[i * 3]);
      next[i * 3 + 1] += f * (y / c - p[i * 3 + 1]);
      next[i * 3 + 2] += f * (z / c - p[i * 3 + 2]);
    }
    p.set(next);
  };
  for (let r = 0; r < rounds; r++) {
    step(0.5);
    step(-0.53);
  }
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, p[weld[i] * 3], p[weld[i] * 3 + 1], p[weld[i] * 3 + 2]);
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

// The scan's normals are faceted per triangle; averaging them per position lets the coat's reflections run smooth.
function smoothNormals(geo) {
  const pos = geo.attributes.position;
  const keyOf = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const keys = Array.from({ length: pos.count }, (_, i) => keyOf(i));
  const sums = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const tris = geo.index ? geo.index.count / 3 : pos.count / 3;
  const at = (k) => (geo.index ? geo.index.getX(k) : k);
  for (let t = 0; t < tris; t++) {
    const ia = at(t * 3);
    const ib = at(t * 3 + 1);
    const ic = at(t * 3 + 2);
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib).sub(a);
    c.fromBufferAttribute(pos, ic).sub(a);
    b.cross(c); // area-weighted face normal
    for (const i of [ia, ib, ic]) {
      const s = sums.get(keys[i]) || sums.set(keys[i], [0, 0, 0]).get(keys[i]);
      s[0] += b.x;
      s[1] += b.y;
      s[2] += b.z;
    }
  }
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    a.fromArray(sums.get(keys[i])).normalize().toArray(normals, i * 3);
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
}

function haloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The chrome inside the headlamps glows when the lamps are on; the same material on the grille trim does not.
function headlampReflector(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLamp = fx.lamp;
    sh.uniforms.uDrop = fx.drop;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uDrop;\nvarying vec3 vLampW;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vLampW = (modelMatrix * vec4(transformed, 1.0)).xyz + vec3(0.0, uDrop, 0.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uLamp;\nvarying vec3 vLampW;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
{
  vec3 q = vec3(abs(vLampW.x), vLampW.y, vLampW.z);
  float inLamp = step(0.47, q.x) * step(q.x, 0.79) * step(2.06, q.y) * step(q.y, 2.35) * step(2.02, q.z);
  totalEmissiveRadiance += vec3(1.0, 0.96, 0.9) * (uLamp * 2.5 * inLamp);
}`);
  };
}

// The LED ceiling strikes row by row along the garage, from the far wall (-z) to the camera end. GB's hex grid
// is one welded mesh, so rows are cut per triangle (each triangle lights whole).
const LED_ROWS = 12;
function ledRows(mesh) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  mesh.geometry = g;
  const pos = g.attributes.position;
  mesh.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  const z = new Float32Array(pos.count / 3);
  for (let t = 0; t < z.length; t++) {
    for (let k = 0; k < 3; k++) z[t] += v.fromBufferAttribute(pos, t * 3 + k).applyMatrix4(mesh.matrixWorld).z / 3;
  }
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const c of z) {
    zMin = Math.min(zMin, c);
    zMax = Math.max(zMax, c);
  }
  const row = new Float32Array(pos.count);
  for (let t = 0; t < z.length; t++) {
    const r = Math.min(LED_ROWS - 1, Math.floor(((z[t] - zMin) / (zMax - zMin)) * LED_ROWS)) / (LED_ROWS - 1);
    row[t * 3] = row[t * 3 + 1] = row[t * 3 + 2] = r;
  }
  g.setAttribute("aRow", new THREE.BufferAttribute(row, 1));

  const m = mesh.material;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLed = fx.led;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aRow;\nvarying float vRow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRow = aRow;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uLed;\nvarying float vRow;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
{
  // Row k starts at 0.8·k/(rows-1) of the sequence; each strikes on, drops out, then holds, like real tubes.
  float s = (uLed - vRow * 0.8) / 0.12;
  float on = s <= 0.0 ? 0.0 : s < 0.22 ? 1.0 : s < 0.5 ? 0.15 : 1.0;
  totalEmissiveRadiance *= on;
}`);
  };
}

// The garage seen from the car's spot, without the car, is what the paint and glass reflect.
// (the user: find a showroom's lighting) With `hdr`, the light of a real, bright car workshop instead: Poly Haven's
// "Autoshop 01" (CC0), a photographed panorama, lights everything and is what the paint mirrors. The room that is
// seen is still the modelled one.
function bakeEnvironment(hdr) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  let env;
  if (hdr) {
    env = pmrem.fromEquirectangular(hdr);
    hdr.dispose();
  } else {
    // (the sprayer too: standing at the origin in his rest pose, his orange jacket tinted the floor and paint)
    const hidden = [car, ...sprayers.map((s) => s.root)].filter(Boolean);
    hidden.forEach((o) => (o.visible = false));
    env = pmrem.fromScene(scene, 0.02, 0.1, 40, { size: 256, position: new THREE.Vector3(0, 1.6, 0) });
    hidden.forEach((o) => (o.visible = true));
  }
  pmrem.dispose();
  scene.environment = env.texture;
  scene.environmentIntensity = ENV_INTENSITY;
}

// ---------- Camera ----------
const pose = {
  p: new THREE.Vector3(),
  u: new THREE.Vector3(),
  look: new THREE.Vector3(),
  lens: 35,
  coat: -3,
  coats: new THREE.Vector3(-3.5, -3.5, -3.5),
  coatsB: new THREE.Vector3(-3.5, -3.5, -3.5),
  glowB: new THREE.Vector3(),
  sprayOn: 1,
  glow: new THREE.Vector3(),
  glowE: 0,
};
const tmp = new THREE.Vector3();

function frameAt(p) {
  for (let k = 1; k < TIMELINE.length; k++) {
    const [s1, f1] = TIMELINE[k];
    if (p <= s1) {
      const [s0, f0] = TIMELINE[k - 1];
      return lerp(f0, f1, (p - s0) / (s1 - s0));
    }
  }
  return TIMELINE[TIMELINE.length - 1][1];
}

const camPath = new THREE.CatmullRomCurve3(STORY_CAM.map((k) => new THREE.Vector3(...k.pos)));
const lookPath = new THREE.CatmullRomCurve3(STORY_CAM.map((k) => new THREE.Vector3(...k.look)));

// Camera at scroll progress p from STORY_CAM; coat and spray glow from GB's animation at the matching frame.
function storyPose(p) {
  let k = 0;
  while (k < STORY_CAM.length - 2 && p > STORY_CAM[k + 1].p) k++;
  const A = STORY_CAM[k];
  const B = STORY_CAM[k + 1];
  const s = clamp((p - A.p) / (B.p - A.p), 0, 1);
  const u = (k + s) / (STORY_CAM.length - 1);
  camPath.getPoint(u, pose.p);
  lookPath.getPoint(u, pose.look);
  pose.u.set(0, 1, 0);
  pose.lens = lerp(A.lens, B.lens, smooth(s));

  const i = clamp(frameAt(p) - 1, 0, frames.length - 1);
  const a = Math.floor(i);
  const t = i - a;
  const F0 = frames[a];
  const F1 = frames[Math.min(frames.length - 1, a + 1)];
  pose.coat = lerp(F0.coat, F1.coat, t);
  pose.glow.fromArray(F0.glow).lerp(tmp.fromArray(F1.glow), t);
  pose.glowE = lerp(F0.glowE, F1.glowE, t);
  sprayPasses(p);
  sprayCam(p);
}

// Three coats (the user: "sơn tận 3 lớp"): over GB's spray window the sprayer makes three passes, nose to tail,
// tail to nose, nose to tail, each laying one layer, with a short pause at either end to turn round. pose.coats
// holds each layer's front for the shader; the spray glow (and so the sprayer) follows the pass under way.
// Two sprayers (the user: one man walked too fast): the front one does nose ↔ middle, the rear one middle ↔ tail,
// side by side in time, so each walks half the length a pass.
const PASSES = { span: [0.42, 0.88], from: 2.42, mid: 0, to: -2.4, hold: 0.07 };

function sprayPasses(p) {
  const s = (p - PASSES.span[0]) / (PASSES.span[1] - PASSES.span[0]);
  pose.sprayOn = 1;
  if (s <= 0 || s >= 1) {
    pose.coats.setScalar(s <= 0 ? -3.5 : 3.5);
    pose.coatsB.setScalar(s <= 0 ? -3.5 : 3.5);
    pose.glowB.set(-pose.glow.x, pose.glow.y, s <= 0 ? PASSES.mid : PASSES.to);
    return;
  }
  const pass = Math.min(2, Math.floor(s * 3));
  // off the trigger while they turn round at either end of a pass
  const u = s * 3 - pass;
  pose.sprayOn = smooth(clamp(Math.min(u, 1 - u) / PASSES.hold - 0.3, 0, 1));
  const t = smooth(clamp((s * 3 - pass - PASSES.hold) / (1 - 2 * PASSES.hold), 0, 1));
  const forward = pass !== 1; // passes 1 and 3 nose to tail
  const k = forward ? t : 1 - t;
  const zA = lerp(PASSES.from, PASSES.mid, k);
  const zB = lerp(PASSES.mid, PASSES.to, k);
  // nose-to-tail layers are coated where -z < front (uCoat = -z); the tail-to-nose one where z < front
  for (let i = 0; i < 3; i++) {
    const done = i < pass ? 3.5 : i > pass ? -3.5 : null;
    pose.coats.setComponent(i, done ?? (forward ? -zA : zA));
    pose.coatsB.setComponent(i, done ?? (forward ? -zB : zB));
  }
  pose.glow.z = zA;
  pose.glowB.set(-pose.glow.x, pose.glow.y, zB);
}

// While he sprays the camera travels round the car, low, looking up under it to watch the coat go on (the user:
// round the car, not following the sprayer; before that, not standing still, and no shaking). One and a half slow
// turns over the three passes, nose round the right side, past the tail, the left, the nose again, ending at the
// tail where the story camera takes over. An ellipse, as the car is long; inside the light bars, outside the posts.
// It eases in from and out to the STORY_CAM path.
// (rx outside the wheels parked at x 2.3, which it drove through at 3.0; the light bars stand further out)
const SPRAY_CAM = { span: [0.43, 0.48, 0.83, 0.88], turns: 1.5, rx: 3.45, rz: 4.5, y: [0.35, 0.6], lens: 20 };
const sprayEye = new THREE.Vector3();
const sprayLook = new THREE.Vector3();

// v2 (the user: the slow turn round the car was dull): one shot per coat, cut on the turn-round between passes.
//  1. the primer: tracking with the front sprayer at shoulder height, the gun and the first coat going on
//  2. the second coat: lying on the floor, looking straight up at the whole floor pan as it blackens, rolling slowly
//  3. the gloss coat: gliding just under the panels, the wet shine coming towards the lens
const SHOT_EYE = new THREE.Vector3();
const SHOT_LOOK = new THREE.Vector3();
const SHOT_UP = new THREE.Vector3();
const shotA = { eye: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), lens: 24 };
const shotB = { eye: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), lens: 24 };

function shot(i, t, out) {
  const front = pose.glow.z;
  const manZ = sprayerZ(front);
  if (i === 0) {
    out.eye.set(CREW[0].x + 0.95, 1.18, manZ + 1.05);
    out.look.set(CREW[0].x - 0.15, 1.42, front + 0.05);
    out.up.set(0, 1, 0);
    out.lens = 24;
  } else if (i === 1) {
    // (steeply up but not straight up, and no roll: straight up and rolling, the cut into it made people dizzy)
    out.eye.set(0.15, 0.3, lerp(-1.6, 0.6, t));
    out.look.copy(out.eye).add(SHOT_UP.set(0, 1, 0.75));
    out.up.set(0, 1, 0);
    out.lens = 18;
  } else {
    // just behind the rear man's front (it runs middle to tail, always under the car), on the coated side,
    // looking forward over the fresh gloss towards the front man coming down his half
    const fb = pose.glowB.z;
    out.eye.set(-0.1, 1.22, fb + 0.5);
    out.look.set(0.15, 1.6, fb + 1.9);
    out.up.set(0, 1, 0);
    out.lens = 22;
  }
  return out;
}

function sprayCam(p) {
  const [a, b, c, d] = SPRAY_CAM.span;
  const w = smooth(clamp((p - a) / (b - a), 0, 1)) * (1 - smooth(clamp((p - c) / (d - c), 0, 1)));
  if (w <= 0) return;
  // which pass, how far through it (the passes' own clock, from sprayPasses' window)
  const q = clamp((p - PASSES.span[0]) / (PASSES.span[1] - PASSES.span[0]), 0, 0.9999) * 3;
  const k = Math.floor(q);
  const t = q - k;
  shot(k, t, shotA);
  // the change: a slow eased move into the next pass's shot over the last and first 30% of a pass (at 10% it
  // whipped round and made people dizzy)
  const h = 0.3;
  const toNext = k < 2 ? smooth(clamp((t - (1 - h)) / h, 0, 1)) : 0;
  const fromPrev = k > 0 ? 1 - smooth(clamp(t / h, 0, 1)) : 0;
  if (toNext > 0) {
    shot(k + 1, 0, shotB);
    lerpShot(shotA, shotB, toNext * 0.5);
  } else if (fromPrev > 0) {
    shot(k - 1, 1, shotB);
    lerpShot(shotA, shotB, fromPrev * 0.5);
  }
  pose.p.lerp(shotA.eye, w);
  pose.look.lerp(shotA.look, w);
  pose.u.lerp(shotA.up, w).normalize();
  pose.lens = lerp(pose.lens, shotA.lens, w);
}

function lerpShot(a, b, k) {
  a.eye.lerp(b.eye, k);
  a.look.lerp(b.look, k);
  a.up.lerp(b.up, k).normalize();
  a.lens = lerp(a.lens, b.lens, k);
}

// Orbit around the car; starts exactly at the story's last shot so the hand-over is seamless.
const orbit = { az: 0, el: 0, dist: 5, az0: 0, el0: 0, ready: false };

function initOrbit() {
  const off = new THREE.Vector3(...STORY_CAM[STORY_CAM.length - 1].pos).sub(ORBIT_TARGET);
  orbit.dist = off.length();
  orbit.az = orbit.az0 = Math.atan2(off.x, off.z);
  orbit.el = orbit.el0 = Math.asin(off.y / orbit.dist);
  orbit.ready = true;
}

function orbitPosition(out) {
  const c = Math.cos(orbit.el);
  return out.set(Math.sin(orbit.az) * c, Math.sin(orbit.el), Math.cos(orbit.az) * c)
    .multiplyScalar(orbit.dist)
    .add(ORBIT_TARGET);
}

// ---------- Opening ----------
// The opening waits behind the key-and-START screen (js/phu-gam-gate.js, from daily.zappa.vn): it starts when the visitor presses START ("gam:go").
// With ?debug, a #hash link or reduced motion there is no gate, so it starts at once.
const GATED = !!document.getElementById("gate") && !REDUCED_MOTION && !location.hash && !new URLSearchParams(location.search).has("debug");
const intro = { t: REDUCED_MOTION ? INTRO.end : 0, done: REDUCED_MOTION, hold: GATED };
document.addEventListener("gam:go", () => (intro.hold = false));
const introCam = { p: new THREE.Vector3(), look: new THREE.Vector3(), weight: 0 };
const span = (t, [a, b]) => clamp((t - a) / (b - a), 0, 1);

// Puts the garage, lamps, LEDs and lift where they are at opening time t, and works out the opening camera.
function applyIntro(t) {
  // Lamps: a quick blink, like the car being unlocked, then on.
  const l = t - INTRO.lamps;
  const lamp = l < 0 ? 0 : l < 0.12 ? 1 : l < 0.32 ? 0 : clamp((l - 0.32) / 0.1, 0, 1);
  const led = span(t, INTRO.leds);
  const room = smooth(span(t, [INTRO.leds[0] + 0.2, INTRO.leds[1] + 0.3]));
  const rise = smooth(span(t, INTRO.lift));

  fx.lamp.value = lamp;
  fx.led.value = led;
  fx.drop.value = CAR_DROP * (1 - rise);
  car.position.y = carRestY - fx.drop.value;
  // The lift's arms swing in under the sills first, then rise with the car.
  const arms = smooth(span(t, INTRO.arms));
  setLift(arms < 1 ? LIFT_CLIP.swung * arms : liftTimeFor(LIFT_PAD_TOP - fx.drop.value));

  for (const { light, base } of roomLights) light.intensity = base * room;
  for (const m of lightBars) m.color.setRGB(1, 0.98, 0.95).multiplyScalar(STUDIO.bars.glow * room);
  scene.environmentIntensity = ENV_INTENSITY * lerp(0.04, 1, room);
  scene.background.copy(bgColor).multiplyScalar(lerp(0.15, 1, room));
  for (const { m, gain } of lampMats) m.emissiveIntensity = lamp * gain;
  // Once the room is lit the beams and halos settle down to what a lamp looks like under shop lights.
  for (const h of halos) h.material.opacity = lamp * lerp(1, 0.45, room);
  for (const b of beams) b.intensity = lamp * HEADLAMP_CD * lerp(1, 0.3, room);

  // Camera: between keys, eased; after the last key it rises with the car into GB's first frame.
  let k = 0;
  while (k < INTRO_CAM.length - 2 && t > INTRO_CAM[k + 1].t) k++;
  const A = INTRO_CAM[k];
  const B = INTRO_CAM[k + 1];
  const u = smooth(clamp((t - A.t) / (B.t - A.t), 0, 1));
  introCam.p.lerpVectors(A.p, B.p, u);
  introCam.look.lerpVectors(A.look, B.look, u);
  introCam.weight = 1 - smooth(span(t, [INTRO.lift[0] + 0.4, INTRO.lift[1]]));
  // the scroll progress bar shows once the car is up
  stage.style.opacity = span(t, [INTRO.ui, INTRO.ui + 0.8]).toFixed(3);
}

// Phones (the page's 760px breakpoint) get a slightly tighter lens.
const tallQuery = matchMedia("(max-width: 760px)");
let W = 1;
let H = 1;

// Blender's 36 mm sensor fits the width of a 16:9 frame. Wider screens keep its height; narrower ones keep its
// width, and phones zoom in a little. No copy sits over the scene, so the picture stays centred.
function applyLens(lens) {
  const aspect = W / H;
  const halfW = 18 / lens;
  const tanV = aspect >= 16 / 9 ? (halfW * 9) / 16 : (halfW * (tallQuery.matches ? 0.62 : 1)) / aspect;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

// ---------- Scroll, drag, slider ----------
let target = 0;
let current = 0;
let exploreMix = 0;
let lastProgress = -1;
let visible = true;
let sliderValue = 1;
let idleSince = performance.now();
let viewOverride = null;

function updateProgress(p) {
  progressFill.style.transform = `scaleX(${p.toFixed(4)})`;
  if (scrollHint) scrollHint.style.opacity = (1 - span(p, [0.004, 0.025])).toFixed(3);
}

function onScroll() {
  const s = story.getBoundingClientRect();
  target = clamp(-s.top / (s.height - innerHeight), 0, 1);
  const e = explore.getBoundingClientRect();
  exploreMix = clamp(1 - e.top / innerHeight, 0, 1);
  visible = e.bottom > 0;
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MAX_DPR) * quality);
  renderer.setSize(W, H, false);
  onScroll();
}

let drag = null;
explore.addEventListener("pointerdown", (ev) => {
  if (ev.target === slider) return;
  drag = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
  explore.setPointerCapture(ev.pointerId);
  explore.classList.add("is-dragging");
});
explore.addEventListener("pointermove", (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  orbit.az -= (ev.clientX - drag.x) * 0.006;
  orbit.el += (ev.clientY - drag.y) * 0.004;
  drag.x = ev.clientX;
  drag.y = ev.clientY;
  idleSince = performance.now();
});
const endDrag = () => {
  drag = null;
  explore.classList.remove("is-dragging");
  idleSince = performance.now();
};
explore.addEventListener("pointerup", endDrag);
explore.addEventListener("pointercancel", endDrag);
// (the before/after slider is gone from the page: sliderValue stays 1, the underbody fully coated; the code stays for putting it back)
slider?.addEventListener("input", () => {
  sliderValue = Number(slider.value);
  idleSince = performance.now();
});

// ---------- Frame loop ----------
// Steps the resolution down when the GPU can't keep up (and back up when it can).
let quality = 1;
let slowFrames = 0;
let fastFrames = 0;
let last = performance.now();
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const orbitPos = new THREE.Vector3();

function tick(now) {
  requestAnimationFrame(tick);
  frame(now);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // The opening holds the story at its start; scrolling meanwhile plays the opening out fast.
  if (!intro.done && frames.length) {
    if (!intro.hold) intro.t += dt * (target > 0.002 ? 6 : 1);
    applyIntro(Math.min(intro.t, INTRO.end));
    if (intro.t >= INTRO.end) intro.done = true;
  } else {
    const delta = target - current;
    current = Math.abs(delta) < 0.00005 ? target : current + delta * EASE;
  }
  if (Math.abs(current - lastProgress) > 0.00001) {
    updateProgress(current);
    lastProgress = current;
  }
  if (!visible || !frames.length) return;

  storyPose(current);
  placeWheels(current);
  if (!intro.done) {
    // Blend the opening camera into GB's first frame.
    const w = introCam.weight;
    pose.look.lerp(introCam.look, w);
    pose.p.lerp(introCam.p, w);
    pose.u.lerp(THREE.Object3D.DEFAULT_UP, w).normalize();
    pose.lens = lerp(pose.lens, INTRO_LENS, w);
  }
  const e = smooth(exploreMix);

  // Idle in the explore view: drift slowly round the car.
  if (exploreMix > 0.98 && !drag && now - idleSince > 2500) orbit.az -= dt * 0.12;
  // Keep the eye above the floor and out of the car.
  const minEl = Math.asin(clamp((0.3 - ORBIT_TARGET.y) / orbit.dist, -1, 1));
  orbit.el = clamp(orbit.el, Math.max(-0.75, minEl), 0.5);
  orbitPosition(orbitPos);

  camPos.copy(pose.p).lerp(orbitPos, e);
  camLook.copy(pose.look).lerp(ORBIT_TARGET, e);
  camera.position.copy(camPos);
  camera.up.copy(pose.u).lerp(THREE.Object3D.DEFAULT_UP, e).normalize();
  camera.lookAt(camLook);
  applyLens(lerp(pose.lens, ORBIT_LENS, e));
  if (viewOverride) {
    camera.position.copy(viewOverride.p);
    camera.up.set(0, 1, 0);
    camera.lookAt(viewOverride.look);
    applyLens(viewOverride.lens);
  }

  // (the explore view's before/after slider lays all three layers at once)
  const all = -3.5 + 7 * sliderValue;
  for (const m of coatMats) {
    m.userData.uCoat.value.set(lerp(pose.coats.x, all, e), lerp(pose.coats.y, all, e), lerp(pose.coats.z, all, e));
    m.userData.uCoatB.value.set(lerp(pose.coatsB.x, all, e), lerp(pose.coatsB.y, all, e), lerp(pose.coatsB.z, all, e));
  }
  glow.position.copy(pose.glow);
  glow.intensity = (pose.glowE / (4 * Math.PI)) * LIGHT_GAIN.Spray_Glow * pose.sprayOn * (1 - e);
  glowB.position.copy(pose.glowB);
  glowB.intensity = glow.intensity;
  updateSprayer(current, e, dt);

  renderer.render(scene, camera);

  // Governor: 60 slow frames (over 34 ms) step down, 240 quick ones (under 20 ms) step back up.
  const ms = dt * 1000;
  slowFrames = ms > 34 ? slowFrames + 1 : 0;
  fastFrames = ms < 20 ? fastFrames + 1 : 0;
  if (slowFrames > 60 && quality > 0.55) {
    quality = Math.max(0.55, quality - 0.15);
    slowFrames = 0;
    resize();
  } else if (fastFrames > 240 && quality < 1) {
    quality = Math.min(1, quality + 0.15);
    fastFrames = 0;
    resize();
  }
}

// ---------- Load ----------
function setLoader(pct) {
  loaderFill.style.width = pct + "%";
  loaderPct.textContent = pct + "%";
  document.dispatchEvent(new CustomEvent("gam:load", { detail: pct }));
}

async function start() {
  resize();
  addEventListener("resize", resize);
  addEventListener("scroll", onScroll, { passive: true });
  tallQuery.addEventListener("change", resize);

  const draco = new DRACOLoader().setDecoderPath("js/vendor/draco/");
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  const [data, gltf, liftGltf, workerGltf, workerGltfB, underGltf, idleGltf, walkGltf] = await Promise.all([
    fetch(SCENE_URL).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }),
    gltfLoader.loadAsync(MODEL_URL, (xhr) => {
      if (xhr.total) setLoader(Math.min(99, Math.round((xhr.loaded / xhr.total) * 100)));
    }),
    gltfLoader.loadAsync(LIFT_URL),
    gltfLoader.loadAsync(WORKER_URL),
    // (a second copy for the second sprayer: a skinned model can't be shared, and the file comes from the cache)
    gltfLoader.loadAsync(WORKER_URL),
    gltfLoader.loadAsync(UNDER_URL),
    // the sprayers' recorded motion: a standing idle and a walk (js/phu-gam-worker.js)
    gltfLoader.loadAsync(`assets/phu-gam/worker-idle.glb?v=${VERSION}`),
    gltfLoader.loadAsync(`assets/phu-gam/worker-walk.glb?v=${VERSION}`),
  ]);
  const motion = { idle: idleGltf.animations[0], walk: walkGltf.animations[0] };
  // the figure that is seen, one copy each (js/phu-gam-worker.js wearBody)
  const BODY_URL = `assets/phu-gam/worker-body.glb?v=${VERSION}`;
  // (two different men: Rocketbox's Male_Adult_11 at the front, Male_Adult_09 at the rear)
  const [bodyA, bodyB] = await Promise.all([gltfLoader.loadAsync(BODY_URL), gltfLoader.loadAsync(BODY_URL.replace("body.glb", "body-b.glb"))]);
  // the showroom's light (bakeEnvironment); without it the page falls back to the modelled room's own
  const hdr = await new HDRLoader().loadAsync(`assets/phu-gam/showroom.hdr?v=${VERSION}`).catch(() => null);
  if (hdr) hdr.mapping = THREE.EquirectangularReflectionMapping;
  frames = data.frames;
  addLights(data);
  prepareModel(gltf.scene);
  setupLift(gltf.scene, liftGltf);
  scene.add(gltf.scene);
  // The underbody: modelled at the raised car's heights, then carried by the car. Painted steel, sealer, plastic
  // covers and the black running gear take the coat (each from its own bare colour); the exhaust, its heat shields,
  // rubber, lines and zinc fasteners are masked off in the shop and stay as they are.
  const UNDER = {
    UB_Floor: { color: [0.2, 0.205, 0.21], rough: 0.5, metal: 0.25 },
    UB_Sealer: { color: [0.42, 0.36, 0.26], rough: 0.75, metal: 0 },
    UB_Plastic: { color: [0.012, 0.012, 0.013], rough: 0.6, metal: 0 },
    UB_Steel: { color: [0.02, 0.02, 0.022], rough: 0.45, metal: 0.4 },
  };
  const UNDER_METAL = {
    UB_Exhaust: [0.27, 0.26, 0.25, 0.6],
    UB_ExhaustHot: [0.25, 0.21, 0.18, 0.6],
    UB_Shield: [0.3, 0.31, 0.32, 0.6],
    UB_Alu: [0.26, 0.265, 0.27, 0.65],
    UB_Zinc: [0.24, 0.245, 0.25, 0.6],
    UB_Line: [0.22, 0.22, 0.225, 0.55],
  };
  const underMats = {};
  const under = underGltf.scene;
  // Its nose and tail ends (under-cover lip, bumper beams, tow eyes) reach out past the Innova's own bumpers and
  // showed as slabs across the grille from the front: cut off where the bumpers' undersides begin. The car only
  // moves up and down, so two fixed planes across the bay do it.
  renderer.localClippingEnabled = true;
  const underClip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), UNDER_TRIM[0]), new THREE.Plane(new THREE.Vector3(0, 0, 1), -UNDER_TRIM[1])];
  under.traverse((o) => {
    if (!o.isMesh) return;
    // (the user: the exhaust comes off for the job too) pipes, silencers and catalyst are not there
    if (o.material.name === "UB_Exhaust" || o.material.name === "UB_ExhaustHot") {
      o.visible = false;
      return;
    }
    o.material.clippingPlanes = underClip;
    // ambient occlusion baked into the model's vertex colours: the shade in its corners and under its parts
    const shaded = !!o.geometry.attributes.color;
    o.material.vertexColors = shaded;
    const spec = UNDER[o.material.name];
    if (spec) {
      if (!underMats[o.material.name]) {
        const m = coatMaterial({ map: null }, { world: true, clean: true, bare: { rough: spec.rough, metal: spec.metal } });
        m.color.setRGB(...spec.color);
        m.bumpMap = null;
        m.clippingPlanes = underClip;
        m.vertexColors = shaded;
        coatMats.push(m);
        underMats[o.material.name] = m;
      }
      o.material = underMats[o.material.name];
    } else if (UNDER_METAL[o.material.name]) {
      // bare metal sits straight over the under-car light: at the model's own values it burns out white (or gold, on the pipe)
      const [r, g, b, rough] = UNDER_METAL[o.material.name];
      o.material.color.setRGB(r, g, b);
      o.material.metalness = 0.85;
      o.material.roughness = rough;
    }
  });
  gltf.scene.add(under);
  gltf.scene.updateMatrixWorld(true);
  car.attach(under);
  // the shop round the lift; its work lights come up with the room's in the opening
  const shop = buildShop();
  scene.add(shop.group);
  lightBars.push(...shop.lights);
  // each his own way of standing (the user: not both in the one pose): the front man turned half side-on, one
  // foot forward, leaning back with his arms out; the rear man low on bent knees, feet wide, gun held in close
  sprayers = [
    // (kept within what the rig bends to without looking broken, the user: "bẹo hình bẹo dạng": shallow knees, a
    // modest stance, the gun held out in front at shoulder height rather than up by the head)
    // (air: each man's hose plugs into an air line on the nearer lift post, on the face towards his half; the
    // posts stand at x ±1.32..1.79, z ±0.25)
    createWorker(workerGltf, scene, { crouch: 0.05, stagger: 0.12, wide: 0.03, yaw: -0.4, lean: 0.04, grip: [0.4, 0.15, 0.12], head: 0.75, air: [1.55, 0.85, 0.29] }, motion, bodyA),
    createWorker(workerGltfB, scene, { crouch: 0.08, stagger: -0.05, wide: 0.06, yaw: 0, lean: 0.03, grip: [0.36, 0.2, 0.16], head: 0.6, air: [-1.55, 0.85, -0.29] }, motion, bodyB),
  ];
  initOrbit();
  bakeEnvironment(hdr);
  applyIntro(intro.t);
  storyPose(0);
  // The sprayers are hidden until they walk in, so their shaders (skin, the cut-down trousers, the sleeve panels,
  // the gun, the hose, the mist) would compile and their textures upload on that frame: a stall of several
  // seconds just as they appear. Show them for the warm-up: compile, then draw one small frame to upload.
  const warmAt = new THREE.Vector3(0, 0, 0);
  const warmTarget = new THREE.Vector3(0, 1.6, 0.4);
  for (const w of sprayers) w.update({ visible: 1, at: warmAt, yaw: 0, target: warmTarget, spraying: 0, working: 1, dt: 1 / 60, scale: 1 });
  await renderer.compileAsync(scene, camera);
  // (drawn to the canvas itself, behind the loader: into a render target it compiled the linear, untone-mapped
  // variants, and the canvas ones still stalled for 5 s when the men came into shot)
  // and once half faded: fading them (near the lens, into the explore view) turns their materials transparent,
  // which is another shader variant, and that compile stalled too
  for (const vis of [1, 0.5]) {
    for (const w of sprayers) w.update({ visible: vis, at: warmAt, yaw: 0, target: warmTarget, spraying: 0, working: 1, dt: 1 / 60, scale: 1 });
    renderer.render(scene, camera);
  }
  setLoader(100);
  loader.classList.add("is-done");
  window.__gamReady = true;
  document.dispatchEvent(new Event("gam:ready"));
  if (new URLSearchParams(location.search).has("debug")) {
    // ?debug: jump to a story progress (and explore mix) and render once, for checks while rAF is paused.
    const seek = (p, mix = 0) => {
      intro.t = INTRO.end;
      target = current = p;
      exploreMix = mix;
      visible = true;
      frame(performance.now());
    };
    // ?debug: freeze the opening at time t and render it.
    const introAt = (t) => {
      Object.assign(intro, { t, done: false, hold: true });
      target = current = 0;
      visible = true;
      frame(performance.now());
    };
    // ?debug: look from p at look with a lens (mm), over whatever the story does; view(null) hands back.
    const view = (p, look, lens = 35) => {
      viewOverride = p && { p: new THREE.Vector3(...p), look: new THREE.Vector3(...look), lens };
      frame(performance.now());
    };
    window.__gam = { THREE, scene, camera, renderer, orbit, pose, coatMats, wheels, sprayer: sprayers[0], sprayers, seek, introAt, view, intro, get quality() { return quality; } };
  }
  requestAnimationFrame(tick);
}

start().catch((err) => {
  console.error(err);
  loaderPct.textContent = "Không tải được mô hình 3D — mở trang qua web server (xem README).";
  document.dispatchEvent(new CustomEvent("gam:fail", { detail: loaderPct.textContent }));
});
