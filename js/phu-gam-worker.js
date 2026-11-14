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

// GB's can as in the shop's photo: blue with the white "GB" mark and "UBS R" down its length, the lower part
// white with a blue dot screen, a silver base. Drawn once; u runs round the can, v from base (0) to top (1).
export function canLabel() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d");
  const blue = g.createLinearGradient(0, 0, 0, 512);
  blue.addColorStop(0, "#2f6fc4");
  blue.addColorStop(0.6, "#1f4f9c");
  g.fillStyle = blue;
  g.fillRect(0, 0, 512, 512);
  // the lower third: white with blue dots thinning out downwards
  g.fillStyle = "#e9edf2";
  g.fillRect(0, 330, 512, 182);
  g.fillStyle = "#2a63b5";
  for (let y = 330; y < 470; y += 9) {
    for (let x = (y / 9) % 2 ? 4 : 0; x < 512; x += 9) g.beginPath(), g.arc(x, y, 3.6 * (1 - (y - 330) / 150), 0, Math.PI * 2), g.fill();
  }
  g.fillStyle = "#b9bfc6"; // silver base
  g.fillRect(0, 488, 512, 24);
  // the front of the can (u 0.25..0.75 faces out): mark and name, turned to read along the can
  g.save();
  g.translate(256, 170);
  g.rotate(-Math.PI / 2);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "900 64px Arial, sans-serif";
  g.fillText("GB", 0, -70);
  g.font = "900 58px Arial, sans-serif";
  g.fillText("UBS R", 0, 0);
  g.font = "600 17px Arial, sans-serif";
  g.fillText("UNDER BODY COATING", 0, 52);
  g.restore();
  g.fillStyle = "#1f4f9c";
  g.font = "700 22px Arial, sans-serif";
  g.textAlign = "center";
  g.fillText("1L", 256, 470);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
  diffuseColor.rgb += vec3(0.05, 0.052, 0.058) * (1.0 - smoothstep(0.04, 0.2, ubLum));
}`;

function dress(model, bones) {
  const parts = {};
  let skin = null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name;
    for (const k of ["Outfit_Bottom", "Outfit_Top", "Headwear", "Glasses", "Body"]) if (n.includes(k)) parts[k] = o;
  });
  if (parts.Glasses) parts.Glasses.visible = false;
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
    shirt.material.onBeforeCompile = (sh) => {
      sh.uniforms.uBlue = { value: UNIFORM.blue };
      sh.uniforms.uWhite = { value: UNIFORM.white };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBind;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBind;\nuniform vec3 uBlue;\nuniform vec3 uWhite;")
        .replace("#include <map_fragment>", `#include <map_fragment>
${CHARCOAL}
{
  float r = abs(vBind.x);
  // along the sleeve from the shoulder seam, tilted by height so the band runs on the diagonal
  float d = r - 0.21 + (vBind.y - 1.36) * 0.55;
  float shade = clamp(dot(diffuseColor.rgb, vec3(0.333)) / 0.04, 0.6, 1.4);
  if (r > 0.2 && d > 0.02 && d < 0.075) diffuseColor.rgb = uBlue * shade;
  else if (r > 0.2 && d >= 0.075 && d < 0.09) diffuseColor.rgb = uWhite * shade;
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

export function createWorker(workerGltf, scene, styleIn = {}) {
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
  let clock = 0;
  let yawS = 0;
  const strokePhase = Math.random() * Math.PI * 2; // the two men don't stroke in step
  const UP = new THREE.Vector3(0, 1, 0);
  const tgt = new THREE.Vector3();
  const headT = new THREE.Vector3();
  const aimPt = new THREE.Vector3();
  const ground = new THREE.Object3D();
  const fwdV = new THREE.Vector3();
  const rightV = new THREE.Vector3();
  const lastPos = new THREE.Vector3(NaN, 0, 0);

  // Where the feet stand, in the worker's own space (root is still at the origin, unturned, at load).
  const feetRest = {
    Left: bones.LeftFoot.getWorldPosition(new THREE.Vector3()),
    Right: bones.RightFoot.getWorldPosition(new THREE.Vector3()),
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
      for (const m of materials) {
        m.transparent = s.visible < 0.999;
        m.opacity = s.visible;
      }

      // Life in the pose (the user: he moved and sprayed stiffly). Nothing snaps: his facing and his aim ease
      // towards where they should be; the gun strokes from side to side while he sprays, his trunk swaying with
      // it and his head following a beat behind; he breathes; walking, his hips dip and roll with each step, and
      // turning on the spot his feet step round.
      clock += s.dt;
      const first = Number.isNaN(lastPos.x);
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
      // Walk distance along the way he faces, for the stepping cycle; the steps fade out when he stops. Turning
      // counts as walking too, so a man turning on the spot shuffles his feet round.
      if (!first) {
        const step = v1.copy(s.at).sub(lastPos);
        const along = step.x * Math.sin(yaw) + step.z * Math.cos(yaw);
        walked += along + Math.abs(turn) * 0.22;
        speed = THREE.MathUtils.lerp(speed, (step.length() + Math.abs(turn) * 0.22) / Math.max(s.dt, 1e-3), 0.15);
      }
      lastPos.copy(s.at);
      const gait = THREE.MathUtils.clamp(speed / 0.35, 0, 1);
      const crouch = THREE.MathUtils.lerp(CROUCH, style.crouch, s.working);
      const stride = (walked / STRIDE) * Math.PI * 2;
      const sway = Math.sin(phase - 0.5) * s.spraying;
      const dip = -0.022 * gait * Math.abs(Math.sin(stride)) + 0.004 * Math.sin(clock * 1.7);

      // the feet are planted from the ground under him, the body rides above them
      ground.position.set(s.at.x, 0, s.at.z);
      ground.rotation.y = yaw;
      ground.updateMatrixWorld(true);
      root.rotation.order = "YXZ";
      root.position.set(s.at.x + rightV.x * 0.025 * sway, -crouch + dip, s.at.z + rightV.z * 0.025 * sway);
      root.rotation.set(0, yaw + 0.06 * sway, 0.035 * gait * Math.sin(stride));
      for (const [b, q] of rest) b.quaternion.copy(q);
      root.updateMatrixWorld(true);

      // Legs: feet planted on the floor (his stance: how wide, and one foot ahead), stepping as he goes.
      for (const [side, phase, sign] of [["Left", 0, 1], ["Right", 0.5, -1]]) {
        const u = (((walked / STRIDE + phase) % 1) + 1) % 1;
        const stance = u < 0.5;
        const z = (stance ? 0.5 - 2 * u : -0.5 + (2 * u - 1)) * STRIDE * gait;
        const lift = stance ? 0 : Math.sin(Math.PI * (2 * u - 1)) * 0.07 * gait;
        const plant = 1 - gait;
        const wide = sign * style.wide * plant;
        const ahead = (side === "Left" ? style.stagger : -style.stagger) * plant;
        const foot = ground.localToWorld(feetRest[side].clone().add(new THREE.Vector3(wide, lift, z + ahead)));
        // knees bend forward and a little out over the toes (straight forward, a wide stance knocked them in)
        const knee = bones[`${side}UpLeg`].getWorldPosition(new THREE.Vector3())
          .add(new THREE.Vector3(Math.sin(yaw), -0.2, Math.cos(yaw)).multiplyScalar(0.6))
          .add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(0.12 * sign));
        reach(bones[`${side}UpLeg`], bones[`${side}Leg`], bones[`${side}Foot`], foot, knee);
      }

      // Torso: bent back and round towards the spot, as far as his style has it.
      const upper = bones.Spine2.getWorldPosition(new THREE.Vector3());
      aim(bones.Spine, upper, tgt, style.lean * s.working);
      // and his chest turns a little with the stroke
      turnWorld(bones.Spine1, new THREE.Quaternion().setFromAxisAngle(UP, 0.1 * sway));

      // Gun: held at chest height a forearm's length in front of him, tipped up so the nozzle points at the spot.
      const chest = bones.Spine2.getWorldPosition(new THREE.Vector3());
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)); // his right hand side
      // raised up by his face and off to his right, the nozzle a hand's breadth under the floor pan, as the shop's
      // photos show (held at the chest it sprayed a long plume up through the air); how far out, across and up is
      // his own habit (style.grip)
      const [gF, gR, gU] = style.grip;
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
      aim(bones.Head, eyes, headT, style.head);

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
