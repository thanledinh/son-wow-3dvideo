// The worker who sprays the underbody: a rigged character (BELAZ's "car mechanic", Sketchfab, CC BY 4.0) holding
// an underbody gun built here (buildGun), posed every frame by small two-bone IK solves rather than clips:
// both hands on the gun, the gun's nozzle on the spot being sprayed, the head looking at it, a slight crouch
// so he fits under the car, and a procedural walk driven by how far he has moved. A cone of grey mist leaves
// the nozzle while he sprays.
import * as THREE from "three";

const HEIGHT = 1.7; // the character is 1.86 m tall; shop staff are nearer 1.70
const CROUCH = 0.06; // bend at the knees so the head clears the floor pan
const STRIDE = 0.55;
// The underbody gun, built in code after the shop's photo: a grey Schutz gun with a short pale nozzle, its grip
// raked back from the head, and GB's 1 L "UBS R" can screwed on under the head, hanging back at an angle.
// Its own axes: the nozzle points down -x, "up" is -z, the can hangs down +z.
const GUN = {
  grip: new THREE.Vector3(1, 0, 0.55).normalize(), // the grip's run, back and down from the head
  can: { collar: new THREE.Vector3(-0.008, 0, 0.026), axis: new THREE.Vector3(0.35, 0, 1).normalize(), length: 0.22, radius: 0.045 },
  nozzle: 0.11,
};
const GUN_GRIP = new THREE.Vector3(0.02, 0, 0).addScaledVector(GUN.grip, 0.075);
// the left hand on the can's side, halfway down
const GUN_SUPPORT = GUN.can.collar.clone().addScaledVector(GUN.can.axis, 0.13).add(new THREE.Vector3(0, GUN.can.radius + 0.002, 0));
const GUN_NOZZLE = new THREE.Vector3(-0.03 - GUN.nozzle, 0, 0);
const GUN_HOSE = new THREE.Vector3(0.02, 0, 0).addScaledVector(GUN.grip, 0.14); // where the air hose goes in
// a short, thin jet: the gun works close to the panel, so little drifts off (the user: not that much smoke)
const MIST = { count: 160, life: 0.22, speed: 1.6, spread: 0.12, rate: 420, size: [0.01, 0.12], alpha: 0.32 };

// How each hand sits on the gun, in the gun's axes: F runs wrist to knuckles, P is where the palm faces,
// `at` is the point it holds, `along`/`palm` place that point on the hand (share of the hand's length, m off the palm).
// Right: round the grip from his right, fingers wrapping down under it, index forward on the trigger.
// Left: round the can from its left side, fingers forward round it.
const HOLD = {
  Right: { F: new THREE.Vector3(-0.55, 0, 1), P: new THREE.Vector3(0, 1, 0), at: GUN_GRIP, along: 0.5, palm: 0.03 },
  Left: { F: new THREE.Vector3(-1, 0, 0.35), P: new THREE.Vector3(0, -1, 0), at: GUN_SUPPORT, along: 0.45, palm: 0.025 },
};
// How far each finger joint folds (degrees, base to tip).
const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
const CURL = {
  Right: { Thumb: [10, 25, 20], Index: [30, 40, 25], Middle: [75, 85, 50], Ring: [75, 85, 50], Pinky: [70, 80, 45] },
  Left: { Thumb: [10, 20, 15], Index: [35, 40, 25], Middle: [40, 45, 30], Ring: [45, 50, 30], Pinky: [45, 50, 30] },
};

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();

// Turn `bone` (in world terms) so that the direction from it to `from` now points at `to`.
function aim(bone, from, to, amount = 1) {
  const origin = bone.getWorldPosition(v1);
  const d0 = v2.copy(from).sub(origin).normalize();
  const d1 = v3.copy(to).sub(origin).normalize();
  const delta = q1.setFromUnitVectors(d0, d1);
  if (amount < 1) delta.slerp(q2.identity(), 1 - amount);
  const world = bone.getWorldQuaternion(q2).premultiply(delta);
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parent.multiply(world));
  bone.updateMatrixWorld(true);
}

// Two-bone IK: put `end` (hand or foot) on `target`, bending the middle joint towards `pole`.
function reach(upper, lower, end, target, pole) {
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  const c = end.getWorldPosition(new THREE.Vector3());
  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  const toT = target.clone().sub(a);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const dir = toT.normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const bend = pole.clone().sub(a);
  bend.sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize();
  const elbow = a.clone().addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  aim(upper, b, elbow);
  aim(lower, end.getWorldPosition(new THREE.Vector3()), a.clone().addScaledVector(dir, d));
}

// Set `bone` to world rotation `q`.
function setWorldQuaternion(bone, q) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
  bone.updateMatrixWorld(true);
}

// Turn `bone` by world rotation `delta` about its own origin.
function turnWorld(bone, delta) {
  setWorldQuaternion(bone, bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta));
}

// The part of rotation `q` that spins about unit `axis` (swing-twist split).
function twistAbout(q, axis) {
  const s = axis.x * q.x + axis.y * q.y + axis.z * q.z;
  const t = new THREE.Quaternion(axis.x * s, axis.y * s, axis.z * s, q.w);
  return t.lengthSq() < 1e-12 ? t.identity() : t.normalize();
}

function mistMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 1 }, uColor: { value: new THREE.Color(0.42, 0.43, 0.45) } },
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute float aSize;
      varying float vAge;
      uniform float uScale;
      void main() {
        vAge = aAge;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.05, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAge;
      uniform vec3 uColor;
      void main() {
        if (vAge >= 1.0) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float soft = smoothstep(1.0, 0.0, r);
        // thin at the nozzle, thickest as it spreads, gone as it settles
        float body = smoothstep(0.0, 0.35, vAge) * (1.0 - vAge);
        gl_FragColor = vec4(uColor, soft * soft * body * ${MIST.alpha.toFixed(2)});
      }`,
  });
}

// GB's can: the label is the shop's own product photo (the user: change the coating to this one), unwrapped round
// the can by a tool kept outside the repo into assets/phu-gam/can-label.webp. u runs round the can with the front
// of the label at u = 0.5 and the same label again on the back (the user: the back like the front), v from the base
// (0) to the shoulder (1). One texture, shared by every can in the shop.
let label = null;
export function canLabel() {
  if (!label) {
    label = new THREE.TextureLoader().load("assets/phu-gam/can-label.webp?v=3");
    label.colorSpace = THREE.SRGBColorSpace;
    label.anisotropy = 4;
  }
  return label;
}

function buildGun() {
  const gun = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x55595e, metalness: 0.15, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.2, roughness: 0.5 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 0, roughness: 0.45 });
  const can = new THREE.MeshStandardMaterial({ map: canLabel(), metalness: 0.35, roughness: 0.3 });
  const tin = new THREE.MeshStandardMaterial({ color: 0xc4c9ce, metalness: 1, roughness: 0.3 });
  const Y = new THREE.Vector3(0, 1, 0);
  // a mesh placed at `at`, its own y axis turned along `axis`
  const add = (geo, mat, at, axis = Y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    m.quaternion.setFromUnitVectors(Y, axis.clone().normalize());
    gun.add(m);
    return m;
  };
  const X = new THREE.Vector3(1, 0, 0);
  // head, and the short pale nozzle out of its front
  add(new THREE.BoxGeometry(0.06, 0.034, 0.05), dark, new THREE.Vector3(0, 0, 0.004));
  add(new THREE.CylinderGeometry(0.011, 0.013, 0.02, 16), grey, new THREE.Vector3(-0.038, 0, 0), X);
  add(new THREE.CylinderGeometry(0.0055, 0.0065, GUN.nozzle, 12), pale, new THREE.Vector3(-0.03 - GUN.nozzle / 2, 0, 0), X);
  // the grip, raked back from the head, ribbed where the hand goes, with the trigger lever under it
  const gripMid = new THREE.Vector3(0.02, 0, 0).addScaledVector(GUN.grip, 0.07);
  add(new THREE.BoxGeometry(0.03, 0.13, 0.032), grey, gripMid, GUN.grip);
  for (let i = 0; i < 4; i++) {
    add(new THREE.BoxGeometry(0.032, 0.006, 0.034), dark, new THREE.Vector3(0.02, 0, 0).addScaledVector(GUN.grip, 0.05 + i * 0.018), GUN.grip);
  }
  const lever = new THREE.Vector3(0.028, 0, 0.034).addScaledVector(GUN.grip, 0.03);
  add(new THREE.BoxGeometry(0.009, 0.07, 0.02), pale, lever, GUN.grip);
  // the can: collar, body with its label, silver base rim
  const { collar, axis, length, radius } = GUN.can;
  add(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 20), dark, collar.clone().addScaledVector(axis, 0.012), axis);
  add(new THREE.CylinderGeometry(0.03, radius, 0.025, 28), tin, collar.clone().addScaledVector(axis, 0.035), axis.clone().negate());
  // (turned so the label's front faces gun +y, his left; the blue top of the label at the collar)
  const body = add(new THREE.CylinderGeometry(radius, radius, length - 0.04, 40), can, collar.clone().addScaledVector(axis, 0.03 + length / 2), axis);  body.rotateY(Math.PI / 2);
  add(new THREE.CylinderGeometry(radius * 0.97, radius * 0.97, 0.012, 40), tin, collar.clone().addScaledVector(axis, 0.03 + length - 0.014), axis);
  // the air hose's fitting at the back of the grip (the hose itself runs in world space to the air line: createWorker)
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.025, 12), grey, GUN_HOSE.clone().addScaledVector(GUN.grip, -0.008), GUN.grip);
  return gun;
}

// The shop's uniform on BELAZ's mechanic (the user's photos of a staff member: black polo with light-blue sleeve
// panels, black shorts with light-blue sides, short black hair, no glasses). The textures are recoloured by
// tools/uniform_worker_texture.py; what the model's shape doesn't have is done here, on the model at rest:
// - shorts: the trousers are cut off above the knee (in their bind pose), and bare legs are added below, rigid on
//   the shin and thigh bones (the model has no legs under its trousers)
// - hair: the beanie goes, showing the short hair painted on the head
// - the safety glasses go
// - the sleeves get the shirt's diagonal light-blue panel with a white edge
const UNIFORM = { hem: 0.08, shin: [0.05, 0.034], thigh: 0.062, blue: new THREE.Color(0.38, 0.62, 0.82), white: new THREE.Color(0.78, 0.8, 0.83) };

// The uniform's black, lifted to charcoal (only its dark parts, not the blue panels): true black vanished into the
// dark studio, and from behind a man was a pair of legs.
const CHARCOAL = `{
  float ubLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb += vec3(0.022, 0.023, 0.027) * (1.0 - smoothstep(0.04, 0.2, ubLum));
}`;

// A small tiling height map for bumpMap: "knit" is a polo's piqué (rows of little raised cells), "pores" is skin's
// fine uneven grain. Tiled many times over the avatar's texture sheet.
function reliefTexture(kind) {
  const N = 64;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let h;
      if (kind === "knit") {
        // cells 8 px across, every other row shifted half a cell
        const u = ((x + (Math.floor(y / 8) % 2) * 4) % 8) / 8;
        const v = (y % 8) / 8;
        h = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.85 + rnd() * 0.15;
      } else {
        h = 0.5 + (rnd() - 0.5) * 0.6 + 0.2 * Math.sin((x * Math.PI) / 4) * Math.sin((y * Math.PI) / 4);
      }
      const b = Math.round(255 * Math.min(1, Math.max(0, h)));
      img.data.set([b, b, b, 255], (y * N + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(kind === "knit" ? 70 : 60, kind === "knit" ? 70 : 60);
  t.anisotropy = 4;
  return t;
}

function dress(model, bones) {
  const parts = {};
  let skin = null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name;
    for (const k of ["Outfit_Bottom", "Outfit_Top", "Headwear", "Glasses", "Body"]) if (n.includes(k)) parts[k] = o;
  });
  if (parts.Glasses) parts.Glasses.visible = false;
  // Cloth and skin instead of smooth plastic (the user's boss: he looked like a plastic figure): the avatar's
  // materials are plain matte colour, which under the shop's hard lights shades like a moulded toy. Cloth gets a
  // knit's fine relief and the soft bright edge fabric has at grazing angles (sheen); skin gets its own soft edge,
  // a little gloss and pores.
  const knit = reliefTexture("knit");
  const pores = reliefTexture("pores");
  const remake = (mesh, spec) => {
    const old = mesh.material;
    const m = new THREE.MeshPhysicalMaterial({ map: old.map, metalness: 0, ...spec });
    m.name = old.name;
    mesh.material = m;
  };
  for (const k of ["Outfit_Top", "Outfit_Bottom"]) {
    if (parts[k]) remake(parts[k], { roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.05, 0.055, 0.065), bumpMap: knit, bumpScale: 0.18 });
  }
  model.traverse((o) => {
    if (o.isMesh && /Wolf3D_(Skin|Body)/.test(o.material.name)) {
      // (tinted down to a tanned skin: at the avatar's own pale tone the under-car lights burnt his arms out white)
      remake(o, { color: new THREE.Color(0.74, 0.6, 0.52), roughness: 0.55, sheen: 0.5, sheenRoughness: 0.4, sheenColor: new THREE.Color(0.3, 0.13, 0.08), bumpMap: pores, bumpScale: 0.08 });
    }
  });
  if (parts.Body) skin = parts.Body.material;

  // no beanie: the head has short hair painted on (blackened by uniform_worker_texture.py)
  if (parts.Headwear) parts.Headwear.visible = false;

  // the knee in the trousers' own (bind) space, and the hem a little above it
  const pants = parts.Outfit_Bottom;
  if (pants) {
    // (a skinned mesh's vertices are in the skeleton's bind space, which is the model's own space here, not the
    // mesh node's: that one is turned z-up)
    const knee = model.worldToLocal(bones.LeftLeg.getWorldPosition(new THREE.Vector3()));
    const cut = { value: knee.y + UNIFORM.hem };
    pants.material.side = THREE.DoubleSide;
    pants.material.onBeforeCompile = (sh) => {
      sh.uniforms.uCut = cut;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vBindY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBindY = position.y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vBindY;\nuniform float uCut;")
        .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vBindY < uCut) discard;")
        .replace("#include <map_fragment>", `#include <map_fragment>\n${CHARCOAL}`);
    };
    pants.material.needsUpdate = true;
  }

  // bare legs: one skinned tube per leg from inside the shorts down into the shoe, weighted to the thigh bone above
  // the knee and the shin bone below, blended across the knee so it bends round instead of breaking in two
  // (built in the trousers' own bind space and bound to their skeleton)
  if (pants) {
    const legMat = skin ? skin.clone() : new THREE.MeshStandardMaterial({ color: 0xd9a07c, roughness: 0.6 });
    legMat.side = THREE.FrontSide;
    const skel = pants.skeleton;
    const at = (bone) => new THREE.Vector3().applyMatrix4(skel.boneInverses[skel.bones.indexOf(bone)].clone().invert());
    for (const side of ["Left", "Right"]) {
      const up = bones[`${side}UpLeg`];
      const shin = bones[`${side}Leg`];
      const geo = legGeometry(at(up), at(shin), at(bones[`${side}Foot`]), skel.bones.indexOf(up), skel.bones.indexOf(shin));
      const leg = new THREE.SkinnedMesh(geo, legMat);
      leg.position.copy(pants.position);
      leg.quaternion.copy(pants.quaternion);
      leg.scale.copy(pants.scale);
      leg.frustumCulled = false;
      pants.parent.add(leg);
      leg.bind(skel, pants.bindMatrix);
    }
  }

  // sleeve panels: a diagonal band across the upper sleeve, light blue edged in white (bind pose: arms out to the
  // sides, so the sleeves are where the shirt reaches far from the body's midline)
  const shirt = parts.Outfit_Top;
  if (shirt) {
    // (the user: the clothes ran through each other and looked broken) the shirt's lower part is let out a few
    // millimetres so the shorts' waist stays under it as he bends and steps, and the sleeve's blue is a plain cuff
    // with white piping (the diagonal panel, cut across the sleeve's coarse mesh, read as a torn patch)
    shirt.geometry.computeBoundingBox();
    const box = shirt.geometry.boundingBox;
    shirt.material.onBeforeCompile = (sh) => {
      sh.uniforms.uBlue = { value: UNIFORM.blue };
      sh.uniforms.uWhite = { value: UNIFORM.white };
      sh.uniforms.uHem = { value: box.min.y };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBind;\nuniform float uHem;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position;\ntransformed += normalize(objectNormal) * 0.007 * (1.0 - smoothstep(uHem + 0.04, uHem + 0.22, position.y));");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBind;\nuniform vec3 uBlue;\nuniform vec3 uWhite;")
        .replace("#include <map_fragment>", `#include <map_fragment>
${CHARCOAL}
{
  // (the sleeve ends about 0.30 m out from the midline in the bind pose; the mesh's far end is the gloves)
  float r = abs(vBind.x);
  if (r > 0.262 && r < 0.3) diffuseColor.rgb = uBlue;
  else if (r > 0.254 && r <= 0.262) diffuseColor.rgb = uWhite;
}`);
    };
    shirt.material.needsUpdate = true;
  }
}

// A leg as one tube: rings from 30% up the thigh, through the knee, down to the ankle, radius by a leg's profile
// (thigh, slimmer knee, calf, ankle). Each ring is weighted to the thigh bone above the knee and the shin bone
// below, blended over 8 cm round it.
function legGeometry(hip, knee, ankle, iUp, iShin) {
  const SEG = 16;
  const top = knee.clone().lerp(hip, 0.32);
  const thighLen = top.distanceTo(knee);
  const shinLen = knee.distanceTo(ankle);
  // s: metres along the leg from the knee, negative up the thigh
  const rings = [];
  for (let i = 0; i <= 8; i++) rings.push(-thighLen * (1 - i / 8));
  for (let i = 1; i <= 14; i++) rings.push(shinLen * (i / 14));
  const radius = (s) => {
    if (s < 0) return THREE.MathUtils.lerp(0.048, 0.064, Math.min(1, -s / thighLen));
    const t = s / shinLen;
    return 0.044 + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (t < 0.62 ? 1 : 0.7) - 0.012 * t;
  };
  const pos = [];
  const idx = [];
  const wts = [];
  const ix = [];
  const dirUp = knee.clone().sub(top).normalize();
  const dirDn = ankle.clone().sub(knee).normalize();
  for (const s of rings) {
    const c = s < 0 ? knee.clone().addScaledVector(dirUp, s) : knee.clone().addScaledVector(dirDn, s);
    // the ring's plane: across the leg's run, the run itself blended through the knee
    const run = dirUp.clone().lerp(dirDn, THREE.MathUtils.smoothstep(s, -0.05, 0.05)).normalize();
    const side = new THREE.Vector3(1, 0, 0).addScaledVector(run, -run.x).normalize();
    const fwd = new THREE.Vector3().crossVectors(side, run).normalize();
    const r = radius(s);
    const w = THREE.MathUtils.smoothstep(s, -0.04, 0.04); // 0 thigh … 1 shin
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      // a touch flatter at the sides than front to back, as a leg is
      const p = c.clone().addScaledVector(side, Math.cos(a) * r * 0.92).addScaledVector(fwd, Math.sin(a) * r);
      pos.push(p.x, p.y, p.z);
      ix.push(iUp, iShin, 0, 0);
      wts.push(1 - w, w, 0, 0);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let k = 0; k < SEG; k++) {
      const a = j * SEG + k;
      const b = j * SEG + ((k + 1) % SEG);
      const c = a + SEG;
      const d = b + SEG;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(ix, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// How a sprayer stands at work: crouch (m), feet apart (m each way) and one ahead of the other (m), turned from
// square-on (radians), torso bent towards the spot (0..1), where the grip sits from his chest (forward, right, up,
// m) and how far his head turns to the spot.
// air: where his air hose plugs in (world: an air line on a lift post), or null for no hose.
const STYLE = { crouch: CROUCH, wide: 0, stagger: 0, yaw: 0, lean: 0, grip: [0.3, 0.2, 0.22], head: 0.7, air: null };

// A recorded clip (its tracks named after Ready Player Me's bones) fitted to this model's bones. The skeletons are
// the same, bone for bone, but for the hips: Sketchfab's export stands this one's armature z-up, so the hips' turn
// and travel are taken into that space. walk: the clip walks off down +z; that run is taken out (he is moved by the
// page) and returned as `distance`.
const Z_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
function fitClip(source, bones, walk) {
  const tracks = [];
  let distance = 0;
  const q = new THREE.Quaternion();
  for (const track of source.tracks) {
    const dot = track.name.lastIndexOf(".");
    const bone = bones[track.name.slice(0, dot)];
    const prop = track.name.slice(dot + 1);
    if (!bone) continue;
    const hips = bone === bones.Hips;
    const values = Float32Array.from(track.values);
    if (prop === "quaternion") {
      if (hips) for (let i = 0; i < values.length; i += 4) q.fromArray(values, i).premultiply(Z_UP).toArray(values, i);
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, track.times, values));
    } else if (prop === "position" && hips) {
      const n = values.length / 3;
      const [x0, , z0] = values;
      const run = walk ? values[(n - 1) * 3 + 2] - z0 : 0;
      const span = track.times[n - 1] - track.times[0] || 1;
      distance = run;
      for (let i = 0; i < n; i++) {
        const x = values[i * 3] - (walk ? 0 : x0);
        const y = values[i * 3 + 1];
        const z = values[i * 3 + 2] - z0 - (run * (track.times[i] - track.times[0])) / span;
        values.set([x, -z + bone.position.y, y + (bone.position.z - HIPS_UP)], i * 3);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, track.times, values));
    }
  }
  return { clip: new THREE.AnimationClip(source.name, -1, tracks), distance };
}
const HIPS_UP = 1.003; // the hips' standing height in the library's clips

// The man who is seen (the user: find another one, the avatar looked dismal): a photo-textured figure from
// Microsoft's Rocketbox library (MIT; assets/phu-gam/worker-body.glb, converted and dressed in the shop's uniform by
// tools kept outside the repo). Its skeleton is a 3ds Max biped, not the avatar's, so the avatar stays as the
// unseen driver: it is posed as before (recorded motion, the gun's IK) and this body copies it bone for bone, in
// world space, every frame: each bone takes its driver's turn away from the rest pose. The two rest poses are
// lined up first (the biped's arms hang lower than the avatar's T-pose), and since the limbs are not quite the
// same length the hands and feet are then solved onto the driver's.
const BIPED = {
  Hips: "Bip01_Pelvis", Spine: "Bip01_Spine", Spine1: "Bip01_Spine1", Spine2: "Bip01_Spine2", Neck: "Bip01_Neck", Head: "Bip01_Head",
};
for (const [side, s] of [["Left", "L"], ["Right", "R"]]) {
  Object.assign(BIPED, {
    [`${side}Shoulder`]: `Bip01_${s}_Clavicle`, [`${side}Arm`]: `Bip01_${s}_UpperArm`, [`${side}ForeArm`]: `Bip01_${s}_Forearm`, [`${side}Hand`]: `Bip01_${s}_Hand`,
    [`${side}UpLeg`]: `Bip01_${s}_Thigh`, [`${side}Leg`]: `Bip01_${s}_Calf`, [`${side}Foot`]: `Bip01_${s}_Foot`, [`${side}ToeBase`]: `Bip01_${s}_Toe0`,
  });
  ["Thumb", "Index", "Middle", "Ring", "Pinky"].forEach((finger, i) => {
    ["", "1", "2"].forEach((joint, j) => (BIPED[`${side}Hand${finger}${j + 1}`] = `Bip01_${s}_Finger${i}${joint}`));
  });
}
// bones whose run (to the next joint) is lined up with the driver's before the rest pose is taken
const RUNS = [["Arm", "ForeArm"], ["ForeArm", "Hand"], ["Hand", "HandMiddle1"], ["UpLeg", "Leg"], ["Leg", "Foot"]];

function wearBody(bodyGltf, root, model, bones, materials) {
  const body = bodyGltf.scene;
  root.add(body);
  model.traverse((o) => o.isMesh && (o.visible = false));
  const byName = {};
  body.traverse((o) => {
    byName[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      // cloth and skin share the sheet: matte, with the library's normal map doing the folds and pores
      o.material.roughness = 0.78;
      o.material.metalness = 0;
      // hair cards (the second man's ponytail): cut out rather than blended, since the fade near the camera
      // switches `transparent` on and off for every material
      if (o.material.transparent) {
        o.material.transparent = false;
        o.material.alphaTest = 0.45;
        o.material.side = THREE.DoubleSide;
        o.material.roughness = 0.6;
      }
      materials.push(o.material);
    }
  });
  // depth-only copies of his meshes, on the same skeleton, drawn just before them while he fades (see update)
  const shells = [];
  const hollow = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true });
  body.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const shell = new THREE.SkinnedMesh(o.geometry, Array.isArray(o.material) ? o.material.map(() => hollow) : hollow);
    shell.position.copy(o.position);
    shell.quaternion.copy(o.quaternion);
    shell.scale.copy(o.scale);
    shell.frustumCulled = false;
    shell.visible = false;
    shell.renderOrder = 10;
    o.renderOrder = 11;
    shells.push([o, shell]);
  });
  for (const [o, shell] of shells) {
    o.parent.add(shell);
    shell.bind(o.skeleton, o.bindMatrix);
  }
  const top = byName.Bip01;
  // his size: the driver's height (taller, his head met the exhaust)
  root.updateMatrixWorld(true);
  const hipsAt = bones.Hips.getWorldPosition(new THREE.Vector3());
  const tall = new THREE.Box3().setFromObject(body);
  body.scale.setScalar(HEIGHT / (tall.max.y - tall.min.y));
  root.updateMatrixWorld(true);

  const world = (o) => o.getWorldPosition(new THREE.Vector3());
  for (const side of ["Left", "Right"]) {
    for (const [a, b] of RUNS) {
      const d = bones[side + a];
      const t = byName[BIPED[side + a]];
      const run = world(bones[side + b]).sub(world(d)).normalize();
      aim(t, world(byName[BIPED[side + b]]), world(t).add(run));
    }
  }
  root.updateMatrixWorld(true);
  const depth = (o) => (o.parent ? depth(o.parent) + 1 : 0);
  const pairs = Object.entries(BIPED)
    .filter(([d, t]) => bones[d] && byName[t])
    .map(([d, t]) => ({
      d: bones[d],
      t: byName[t],
      // (driver's world turn now) × fit = this bone's world turn
      fit: bones[d].getWorldQuaternion(new THREE.Quaternion()).invert().multiply(byName[t].getWorldQuaternion(new THREE.Quaternion())),
    }))
    .sort((a, b) => depth(a.t) - depth(b.t));
  const pair = (name) => pairs.find((p) => p.d === bones[name]);
  // where the biped's centre sits from the driver's hips, and how much higher its ankle joint is
  const topOff = top.getWorldPosition(new THREE.Vector3()).sub(hipsAt);
  const ankleUp = world(byName[BIPED.LeftFoot]).y - world(bones.LeftFoot).y;
  const limbs = [];
  for (const side of ["Left", "Right"]) {
    limbs.push({ chain: ["Arm", "ForeArm", "Hand"].map((n) => pair(side + n)), lift: 0 });
    limbs.push({ chain: ["UpLeg", "Leg", "Foot"].map((n) => pair(side + n)), lift: ankleUp });
  }
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const turnOf = (pr) => pr.d.getWorldQuaternion(q).multiply(pr.fit);

  return Object.assign(pose, { shells: shells.map(([, shell]) => shell) });
  function pose() {
    top.parent.worldToLocal(bones.Hips.getWorldPosition(p).add(topOff));
    top.position.copy(p);
    top.updateMatrixWorld(true);
    for (const pr of pairs) setWorldQuaternion(pr.t, turnOf(pr));
    // hands onto the driver's wrists and feet onto its ankles, bending at the elbow / knee the way it already bends
    for (const { chain: [a, b, c], lift } of limbs) {
      c.d.getWorldPosition(p).y += lift;
      b.t.getWorldPosition(mid);
      reach(a.t, b.t, c.t, p.clone(), mid.clone());
      setWorldQuaternion(c.t, turnOf(c));
    }
  }
}

export function createWorker(workerGltf, scene, styleIn = {}, motion, bodyGltf) {
  const style = { ...STYLE, ...styleIn };
  const root = new THREE.Group();
  const model = workerGltf.scene;
  root.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(HEIGHT / (box.max.y - box.min.y));
  model.updateMatrixWorld(true);
  scene.add(root);

  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name.replace(/_\d+$/, "")] = o;
    if (o.isMesh) {
      o.frustumCulled = false; // skinned bounds don't follow the pose
      o.material.transparent = false;
    }
  });
  const rest = new Map();
  model.traverse((o) => o.isBone && rest.set(o, o.quaternion.clone()));
  dress(model, bones);
  const materials = [];
  model.traverse((o) => o.isMesh && materials.push(o.material));

  const gun = buildGun();
  root.add(gun);
  gun.traverse((o) => o.isMesh && materials.push(o.material));

  // The air hose: from the gun's fitting, hanging down past his hip to the floor behind him, along the floor and up
  // into the air line's coupler on the post. Rebuilt each frame as he moves.
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0, roughness: 0.5 });
  materials.push(hoseMat);
  // (one tube, its points moved in place each frame: building a new TubeGeometry every frame for each man left
  // garbage that the browser stopped to collect)
  const HOSE_LEN = 64;
  const HOSE_SIDES = 8;
  const HOSE_R = 0.0075;
  const hoseGeo = new THREE.BufferGeometry();
  const hosePos = new Float32Array((HOSE_LEN + 1) * HOSE_SIDES * 3);
  const hoseNor = new Float32Array((HOSE_LEN + 1) * HOSE_SIDES * 3);
  const hoseIdx = [];
  for (let i = 0; i < HOSE_LEN; i++) {
    for (let k = 0; k < HOSE_SIDES; k++) {
      const a = i * HOSE_SIDES + k;
      const b = i * HOSE_SIDES + ((k + 1) % HOSE_SIDES);
      hoseIdx.push(a, a + HOSE_SIDES, b, b, a + HOSE_SIDES, b + HOSE_SIDES);
    }
  }
  hoseGeo.setAttribute("position", new THREE.BufferAttribute(hosePos, 3));
  hoseGeo.setAttribute("normal", new THREE.BufferAttribute(hoseNor, 3));
  hoseGeo.setIndex(hoseIdx);
  const hose = new THREE.Mesh(hoseGeo, hoseMat);
  hose.frustumCulled = false;
  scene.add(hose);
  const air = style.air && new THREE.Vector3(...style.air);
  if (air) {
    const coupler = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 1, roughness: 0.3 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.5 }));
    const nipple = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 12), metal);
    nipple.position.y = -0.07;
    coupler.add(box, nipple);
    coupler.position.copy(air).add(new THREE.Vector3(0, 0.07, 0));
    scene.add(coupler);
  }
  const hoseStart = new THREE.Vector3();
  const hosePts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const hoseCurve = new THREE.CatmullRomCurve3(hosePts, false, "centripetal");
  function layHose(at, yaw) {
    if (!air) return;
    hoseStart.copy(GUN_HOSE).applyMatrix4(gun.matrixWorld);
    const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const toAir = new THREE.Vector3(air.x - at.x, 0, air.z - at.z);
    const floorA = at.clone().addScaledVector(back, 0.25).add(new THREE.Vector3(0, 0.02, 0));
    // along the floor towards the post, stopping short of it, then up to the coupler
    const floorB = new THREE.Vector3(air.x, 0.02, air.z).addScaledVector(toAir.normalize(), -0.18);
    floorB.y = 0.02;
    hosePts[0].copy(hoseStart);
    hosePts[1].copy(hoseStart).add(new THREE.Vector3(0, -0.25, 0)).addScaledVector(back, 0.05);
    hosePts[2].copy(at).addScaledVector(back, 0.18).setY(0.35);
    hosePts[3].copy(floorA);
    hosePts[4].copy(floorA).lerp(floorB, 0.5).setY(0.02);
    hosePts[5].copy(floorB);
    hosePts[6].copy(air);
    hoseCurve.updateArcLengths();
    // rings round the curve, each turned to a side vector kept from the ring before (no twist)
    let side = hoseSide.set(1, 0, 0);
    for (let i = 0; i <= HOSE_LEN; i++) {
      const t = i / HOSE_LEN;
      hoseCurve.getPointAt(t, hoseP);
      hoseCurve.getTangentAt(t, hoseT);
      side.addScaledVector(hoseT, -side.dot(hoseT));
      if (side.lengthSq() < 1e-6) side.set(0, 1, 0).addScaledVector(hoseT, -hoseT.y);
      side.normalize();
      hoseB.crossVectors(hoseT, side);
      for (let k = 0; k < HOSE_SIDES; k++) {
        const a = (k / HOSE_SIDES) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const j = (i * HOSE_SIDES + k) * 3;
        const nx = side.x * c + hoseB.x * s;
        const ny = side.y * c + hoseB.y * s;
        const nz = side.z * c + hoseB.z * s;
        hoseNor[j] = nx;
        hoseNor[j + 1] = ny;
        hoseNor[j + 2] = nz;
        hosePos[j] = hoseP.x + nx * HOSE_R;
        hosePos[j + 1] = hoseP.y + ny * HOSE_R;
        hosePos[j + 2] = hoseP.z + nz * HOSE_R;
      }
    }
    hoseGeo.attributes.position.needsUpdate = true;
    hoseGeo.attributes.normal.needsUpdate = true;
  }
  const hoseP = new THREE.Vector3();
  const hoseT = new THREE.Vector3();
  const hoseB = new THREE.Vector3();
  const hoseSide = new THREE.Vector3();

  // Mist particles live in world space.
  const pos = new Float32Array(MIST.count * 3);
  const vel = new Float32Array(MIST.count * 3);
  const age = new Float32Array(MIST.count).fill(1);
  const size = new Float32Array(MIST.count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const mistMat = mistMaterial();
  const mist = new THREE.Points(geo, mistMat);
  mist.frustumCulled = false;
  scene.add(mist);
  let spawnCarry = 0;
  let next = 0;

  let walked = 0;
  let speed = 0;
  let pace = 0;
  let workS = 0;
  const STANCE = 0.075; // m each foot goes out from where the recording has it
  const toeOut = new THREE.Quaternion();
  const hipsRest = bones.Hips.position.clone();
  const own = new THREE.Vector3();
  const PACE = 1.1; // m/s, an unhurried walk across a shop floor
  const STEP = 0.6; // how much of the recorded stride he takes
  const CARRY = [0.24, 0.16, -0.3]; // the gun on the way there: low in front of his hip (forward, right, up from the chest)
  const lerpYaw = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
  let clock = 0;
  let yawS = 0;
  const strokePhase = Math.random() * Math.PI * 2; // the two men don't stroke in step
  const UP = new THREE.Vector3(0, 1, 0);
  const tgt = new THREE.Vector3();
  const headT = new THREE.Vector3();
  const headW = new THREE.Vector3();
  const aimPt = new THREE.Vector3();
  const ground = new THREE.Object3D();
  const fwdV = new THREE.Vector3();
  const rightV = new THREE.Vector3();
  const lastPos = new THREE.Vector3(NaN, 0, 0);

  // The recorded motion (assets/phu-gam/worker-idle.glb, worker-walk.glb: Ready Player Me's animation library, the
  // same skeleton as this avatar, so the tracks go straight onto its bones), played by hand: update() sets each
  // clip's time and weight. `travel`: the ground one pass of the walk clip covers, at his height.
  const mixer = new THREE.AnimationMixer(model);
  const acts = {};
  let travel = 1;
  for (const key of ["idle", "walk"]) {
    const { clip, distance } = fitClip(motion[key], bones, key === "walk");
    if (key === "walk") travel = distance * model.scale.x;
    acts[key] = mixer.clipAction(clip);
    acts[key].play();
  }
  // what the recorded pose has each foot and knee doing this frame (world)
  const legs = {
    Left: { foot: new THREE.Vector3(), knee: new THREE.Vector3(), turn: new THREE.Quaternion() },
    Right: { foot: new THREE.Vector3(), knee: new THREE.Vector3(), turn: new THREE.Quaternion() },
  };

  // Each hand's own frame, read from the rest pose: F wrist to middle knuckle, P out of the palm.
  // Then `fit`, the turn from the gun's frame to the hand's, and `offset`, the held point seen from the wrist.
  const hands = {};
  const basis = (f, p) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, p, new THREE.Vector3().crossVectors(f, p)));
  for (const side of ["Left", "Right"]) {
    const at = (name) => bones[`${side}${name}`].getWorldPosition(new THREE.Vector3());
    const inv = bones[`${side}Hand`].getWorldQuaternion(new THREE.Quaternion()).invert();
    const knuckle = at("HandMiddle1").sub(at("Hand"));
    const length = knuckle.length();
    const F = knuckle.applyQuaternion(inv).normalize();
    const L = at("HandIndex1").sub(at("HandPinky1")).applyQuaternion(inv); // towards the index finger
    L.addScaledVector(F, -L.dot(F)).normalize();
    // palm down with fingers forward, the index is on the left of a right hand and the right of a left one
    const P = new THREE.Vector3().crossVectors(F, L).multiplyScalar(side === "Right" ? -1 : 1);
    const hold = HOLD[side];
    const gF = hold.F.clone().normalize();
    const gP = hold.P.clone().addScaledVector(gF, -hold.P.dot(gF)).normalize();
    hands[side] = {
      F,
      P,
      fit: basis(gF, gP).multiply(basis(F, P).invert()),
      offset: F.clone().multiplyScalar(length * hold.along).addScaledVector(P, hold.palm),
      fingers: FINGERS.map((name) => [1, 2, 3].map((j) => bones[`${side}Hand${name}${j}`])),
    };
  }

  // Put one hand on the gun: the arm reaches so the hand's held point lands on the gun's, the hand turns to
  // the gun (half the turn taken up by the forearm, as a wrist does), and the fingers close.
  function holdGun(side, gunQ, gunMatrix, pole) {
    const h = hands[side];
    const q = gunQ.clone().multiply(h.fit);
    const point = HOLD[side].at.clone().applyMatrix4(gunMatrix);
    const wrist = point.sub(h.offset.clone().applyQuaternion(q));
    const fore = bones[`${side}ForeArm`];
    const hand = bones[`${side}Hand`];
    reach(bones[`${side}Arm`], fore, hand, wrist, pole);
    const axis = hand.getWorldPosition(new THREE.Vector3()).sub(fore.getWorldPosition(new THREE.Vector3())).normalize();
    const turn = q.clone().multiply(hand.getWorldQuaternion(new THREE.Quaternion()).invert());
    turnWorld(fore, new THREE.Quaternion().slerp(twistAbout(turn, axis), 0.5));
    setWorldQuaternion(hand, q);
    const fold = new THREE.Vector3().crossVectors(h.F.clone().applyQuaternion(q), h.P.clone().applyQuaternion(q)).normalize();
    h.fingers.forEach((chain, i) => {
      const deg = CURL[side][FINGERS[i]];
      chain.forEach((bone, j) => turnWorld(bone, new THREE.Quaternion().setFromAxisAngle(fold, THREE.MathUtils.degToRad(deg[j]))));
    });
  }

  const wear = bodyGltf ? wearBody(bodyGltf, root, model, bones, materials) : null;

  const gunGrip = new THREE.Vector3();
  const nozzle = new THREE.Vector3();
  const sprayDir = new THREE.Vector3();

  return {
    root,
    /**
     * @param {object} s  visible (0..1), at (floor position), yaw (radians, 0 = facing +z),
     *                    target (world point being sprayed), spraying (0..1), dt (seconds), scale (px per m at 1 m)
     */
    update(s) {
      const show = s.visible > 0.001;
      root.visible = show;
      mist.visible = show;
      hose.visible = show && !!air;
      if (!show) {
        lastPos.set(NaN, 0, 0);
        return;
      }
      // Fading near the camera: a plain see-through fade, but of his outside only. Blended as he was, a half-faded
      // man showed his far sleeve and the inside of his shirt through the near side (the user: his clothes ran
      // through each other); dithered instead, he broke up into grains (the user: weird). So while he fades his
      // shape is laid into the depth buffer first (wearBody's `shells`, drawn without colour), and the fade only
      // paints what is nearest the eye.
      const fading = s.visible < 0.999;
      for (const m of materials) {
        m.transparent = fading;
        m.opacity = s.visible;
      }
      if (wear) for (const shell of wear.shells) shell.visible = fading;

      // Life in the pose (the user: he moved and sprayed stiffly). Nothing snaps: his facing and his aim ease
      // towards where they should be; the gun strokes from side to side while he sprays, his trunk swaying with
      // it and his head following a beat behind; he breathes; walking, his hips dip and roll with each step, and
      // turning on the spot his feet step round.
      clock += s.dt;
      const first = Number.isNaN(lastPos.x);
      // He walks at a man's pace, whatever the page does (the user: fix how he moves): the page says where he should
      // be (s.at, tied to the scroll, so a flick of the wheel used to shoot him across the floor with his legs
      // spinning); he goes there on his own feet, speeding up and slowing down, at walking pace (quicker only if
      // left far behind). On the way he faces where he is going, and he gets to work once he has arrived.
      if (first) {
        own.copy(s.at);
        pace = 0;
      }
      const gap = v2.copy(s.at).sub(own).setY(0);
      const far = gap.length();
      // (the user: by the time he had walked in, the page had been scrolled past) however far behind, he is there in
      // about a second: an easy pace for a step or two, a brisk walk when the page has run ahead of him
      const paceWant = Math.min(far / 0.4, Math.max(PACE, far / 0.9));
      pace += (paceWant - pace) * (1 - Math.exp(-s.dt / 0.12));
      if (far > 1e-4) own.addScaledVector(gap, Math.min(far, pace * s.dt) / far);
      const away = THREE.MathUtils.smoothstep(far, 0.3, 0.7);
      const here = 1 - THREE.MathUtils.smoothstep(far, 0.15, 0.6);
      s = { ...s, at: own, working: s.working * here, spraying: s.spraying * here, yaw: away > 0 ? lerpYaw(s.yaw, Math.atan2(gap.x, gap.z), away) : s.yaw };
      // His own way of standing (style), turned in from the way he walks once he has stopped to work.
      const yawWant = s.yaw + style.yaw * s.working;
      if (first) yawS = yawWant;
      const turn = Math.atan2(Math.sin(yawWant - yawS), Math.cos(yawWant - yawS)) * (1 - Math.exp(-s.dt * 7));
      yawS += turn;
      const yaw = yawS;
      fwdV.set(Math.sin(yaw), 0, Math.cos(yaw));
      rightV.set(-Math.cos(yaw), 0, Math.sin(yaw));
      // the stroke: side to side across the spot, a little along it, only while the trigger is down
      const phase = clock * Math.PI * 2 * 0.55 + strokePhase;
      const stroke = Math.sin(phase) * s.spraying;
      aimPt.copy(s.target).addScaledVector(rightV, 0.26 * stroke).addScaledVector(fwdV, 0.07 * Math.sin(phase * 2 + 1) * s.spraying);
      if (first) {
        tgt.copy(aimPt);
        headT.copy(aimPt);
      }
      tgt.lerp(aimPt, 1 - Math.exp(-s.dt * 9));
      headT.lerp(tgt, 1 - Math.exp(-s.dt * 4));
      // The stepping cycle runs on the ground covered along the way he faces. Slower than a full walk, the recorded
      // stride is blended down towards standing (shorter steps), and the cycle is paced to those shorter steps so
      // the feet still don't slide. (Turning on the spot no longer plays the walk: full strides in place.)
      if (!first) {
        const step = v1.copy(s.at).sub(lastPos);
        speed += (step.length() / Math.max(s.dt, 1e-3) - speed) * (1 - Math.exp(-s.dt / 0.15));
      }
      // (the recording is a brisk walk with a long stride: at full weight, carrying the gun across a shop floor, he
      // lunged; STEP of it, blended with standing, is an easy working pace)
      // (hurrying, he takes the recording's full stride)
      const gait = THREE.MathUtils.lerp(STEP, 1, THREE.MathUtils.smoothstep(speed, PACE, PACE * 1.6)) * THREE.MathUtils.smoothstep(speed / PACE, 0.04, 0.8);
      const still = Math.max(0, 1 - gait / STEP);
      if (!first) {
        const step = v1.copy(s.at).sub(lastPos);
        walked += (step.x * Math.sin(yaw) + step.z * Math.cos(yaw)) / Math.max(gait, 0.2);
      }
      lastPos.copy(s.at);
      const crouch = THREE.MathUtils.lerp(CROUCH, style.crouch, s.working);
      const sway = Math.sin(phase - 0.5) * s.spraying;
      // getting into and out of his working pose takes a moment, not a frame
      workS += (s.working - workS) * (1 - Math.exp(-s.dt / 0.35));
      const smoothW = THREE.MathUtils.smoothstep(workS, 0, 1);

      // The body is a recorded one (the user's boss: he looked plastic and fake, move him like a real man): a
      // motion-captured standing idle (breath, weight shifting from leg to leg) blended into a captured walk by how
      // fast he goes, the walk's cycle driven by the distance covered so the feet don't slide. Posed first standing
      // on the floor where he is; what the capture has the feet and knees doing is kept...
      ground.position.set(s.at.x, 0, s.at.z);
      ground.rotation.y = yaw;
      ground.updateMatrixWorld(true);
      root.rotation.order = "YXZ";
      root.position.set(s.at.x, 0, s.at.z);
      root.rotation.set(0, yaw, 0);
      for (const [b, q] of rest) b.quaternion.copy(q);
      acts.idle.time = (clock + strokePhase * 3) % acts.idle.getClip().duration;
      acts.walk.time = ((((walked / travel) % 1) + 1) % 1) * acts.walk.getClip().duration;
      acts.idle.setEffectiveWeight(1 - gait);
      acts.walk.setEffectiveWeight(gait);
      mixer.update(0);
      // (the user: he stood limp, swishy) the recorded idle rests its weight on one hip; standing at work he is
      // squarer: most of that hip tilt and shift is taken back out, and the feet go apart (below)
      const square = 0.65 * still;
      bones.Hips.quaternion.slerp(rest.get(bones.Hips), square);
      bones.Hips.position.x += (hipsRest.x - bones.Hips.position.x) * square;
      bones.Spine.quaternion.slerp(rest.get(bones.Spine), square * 0.6);
      root.updateMatrixWorld(true);
      for (const side of ["Left", "Right"]) {
        const leg = legs[side];
        bones[`${side}Foot`].getWorldPosition(leg.foot);
        bones[`${side}Foot`].getWorldQuaternion(leg.turn);
        bones[`${side}Leg`].getWorldPosition(leg.knee);
      }
      // ...then he sinks into his crouch and sways with the stroke, and the legs are solved back onto those feet
      // (his own stance at work on top: how wide, and one foot ahead).
      // (the user: he looked limp and swishy) the stroke is in his arms; his hips and trunk only just give with it
      root.position.set(s.at.x + rightV.x * 0.008 * sway, -crouch, s.at.z + rightV.z * 0.008 * sway);
      root.rotation.set(0, yaw + 0.02 * sway, 0);
      root.updateMatrixWorld(true);
      const plant = (1 - gait) * s.working;
      for (const [side, sign] of [["Left", 1], ["Right", -1]]) {
        const leg = legs[side];
        // (a working man's stance: feet a shoulder's width apart whenever he is standing, toes a little out)
        const apart = STANCE * still + style.wide * plant;
        const foot = leg.foot.addScaledVector(rightV, -sign * apart).addScaledVector(fwdV, sign * style.stagger * plant);
        leg.turn.premultiply(toeOut.setFromAxisAngle(UP, sign * 0.14 * still));
        // knees bend forward and a little out over the toes
        const knee = leg.knee.addScaledVector(fwdV, 0.5).addScaledVector(rightV, -0.1 * sign);
        reach(bones[`${side}UpLeg`], bones[`${side}Leg`], bones[`${side}Foot`], foot, knee);
        setWorldQuaternion(bones[`${side}Foot`], leg.turn);
      }

      // Torso: bent back and round towards the spot, as far as his style has it.
      const upper = bones.Spine2.getWorldPosition(new THREE.Vector3());
      aim(bones.Spine, upper, tgt, style.lean * s.working);
      // and his chest turns a little with the stroke
      turnWorld(bones.Spine1, new THREE.Quaternion().setFromAxisAngle(UP, 0.04 * sway));

      // Gun: held at chest height a forearm's length in front of him, tipped up so the nozzle points at the spot.
      const chest = bones.Spine2.getWorldPosition(new THREE.Vector3());
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)); // his right hand side
      // raised up by his face and off to his right, the nozzle a hand's breadth under the floor pan, as the shop's
      // photos show (held at the chest it sprayed a long plume up through the air); how far out, across and up is
      // his own habit (style.grip)
      // (carried low until he is at work: walking in with it held out at arm's length looked like a pose)
      const [gF, gR, gU] = style.grip.map((v, i) => THREE.MathUtils.lerp(CARRY[i], v, smoothW));
      gunGrip.copy(chest).addScaledVector(forward, gF).addScaledVector(right, gR).add(v1.set(0, gU, 0));
      sprayDir.copy(tgt).sub(gunGrip).normalize();
      // gun axes: -x along the spray, -z towards "up" for the gun: with the nozzle tipped up at the floor pan,
      // the cup leans back towards him, as a gravity-feed gun does in the hand
      const xAxis = sprayDir.clone().negate();
      const lean = new THREE.Vector3(0, 1, 0).addScaledVector(forward, -1.2);
      const up = lean.sub(sprayDir.clone().multiplyScalar(lean.dot(sprayDir))).normalize();
      const zAxis = up.clone().negate();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
      const gunQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      // the gun is a child of root; put it in root space so the grip lands on gunGrip
      const inv = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).invert();
      gun.quaternion.copy(gunQ).premultiply(inv);
      gun.updateMatrixWorld(true);
      const gripWorld = GUN_GRIP.clone().applyMatrix4(gun.matrixWorld);
      gun.position.add(root.worldToLocal(gunGrip.clone()).sub(root.worldToLocal(gripWorld.clone())));
      gun.updateMatrixWorld(true);
      layHose(s.at, yaw);

      // Arms: right hand round the grip, left hand under the body; elbows hang down, out and a little back.
      const elbowPole = (side) => chest.clone().add(v1.set(0, -0.7, 0)).addScaledVector(right, 0.45 * side).addScaledVector(forward, -0.2);
      holdGun("Right", gunQ, gun.matrixWorld, elbowPole(1));
      holdGun("Left", gunQ, gun.matrixWorld, elbowPole(-1));

      // Head: look at the spot (part of the way, a neck only bends so far).
      const eyes = bones.LeftEye.getWorldPosition(new THREE.Vector3()).add(bones.RightEye.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
      // (between strokes his gaze drifts: along the car and back, a little up and down)
      const wander = 1 - s.spraying;
      headW.copy(headT)
        .addScaledVector(rightV, 0.1 * wander * Math.sin(clock * 0.43 + strokePhase))
        .add(v1.set(0, 0.03 * wander * Math.sin(clock * 0.61 + 2), 0));
      // (never further than a neck turns: walking in with the spot off to one side, his head lolled onto his
      // shoulder; and on the way there he mostly looks where he is going)
      const neck = bones.Head.getWorldPosition(v3);
      const off = v2.copy(eyes).sub(neck).angleTo(v1.copy(headW).sub(neck));
      aim(bones.Head, eyes, headW, style.head * Math.min(1, THREE.MathUtils.lerp(0.45, 0.95, smoothW) / Math.max(off, 1e-3)) * (0.25 + 0.75 * smoothW));

      if (wear) wear();

      // Mist from the nozzle.
      nozzle.copy(GUN_NOZZLE).applyMatrix4(gun.matrixWorld);
      mistMat.uniforms.uScale.value = s.scale;
      spawnCarry += MIST.rate * s.spraying * s.dt;
      while (spawnCarry >= 1) {
        spawnCarry -= 1;
        const i = next;
        next = (next + 1) % MIST.count;
        pos.set([nozzle.x, nozzle.y, nozzle.z], i * 3);
        const d = sprayDir.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(MIST.spread)).normalize();
        // fast enough to reach the spot within its life (the planted sprayer works a metre or more away)
        const sp = Math.max(MIST.speed, (1.4 * nozzle.distanceTo(tgt)) / MIST.life);
        vel.set([d.x * sp, d.y * sp, d.z * sp], i * 3);
        age[i] = 0;
      }
      for (let i = 0; i < MIST.count; i++) {
        if (age[i] >= 1) continue;
        age[i] = Math.min(1, age[i] + s.dt / MIST.life);
        pos[i * 3] += vel[i * 3] * s.dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * s.dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * s.dt;
        // the cloud spreads and slows as it goes, and stops at the underbody
        vel[i * 3] *= 0.94;
        vel[i * 3 + 1] *= 0.94;
        vel[i * 3 + 2] *= 0.94;
        // what reaches the underbody sticks to it: gone quickly instead of pooling as a grey patch
        if (pos[i * 3 + 1] > s.target.y) {
          pos[i * 3 + 1] = s.target.y;
          age[i] = Math.min(1, age[i] + (3 * s.dt) / MIST.life);
        }
        size[i] = MIST.size[0] + age[i] * MIST.size[1];
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAge.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    },
  };
}
