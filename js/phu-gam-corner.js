// What is left on a corner of the car once its wheel is off: vented brake disc on the hub with its five studs,
// the caliper, the dust shield, the knuckle, the strut with its coil spring and, at the front, the drive shaft
// with its boot. 3dshowroom's Innova has none of this, so it is built here.
//
// Local frame: origin at the wheel centre, +x out of the car (the right-hand corners are mirrored), +y up,
// z along the car as in the scene. Sizes are a typical 5×114.3 mm hub with a ~320 mm vented disc.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const DISC_X = -0.035; // middle of the friction ring
const HAT_FACE = 0.031; // where the wheel seats
const R_IN = 0.086;
const R_OUT = 0.162;

let mats = null;
function materials() {
  if (mats) return mats;
  // Faint rings across the friction faces, as left by the lathe and the pads.
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  for (let y = 0; y < 256; y++) {
    const v = 150 + Math.round(Math.random() * 60);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, 4, 1);
  }
  const rings = new THREE.CanvasTexture(c);
  rings.colorSpace = THREE.SRGBColorSpace;
  // Colours follow the shop's own wheel-well photos: a light grey painted disc hat, a friction ring gone
  // brown with flash rust, a bare cast caliper, black strut and knuckle.
  mats = {
    disc: new THREE.MeshStandardMaterial({ color: 0x9a8a7c, map: rings, metalness: 0.85, roughness: 0.48 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x5a3a28, metalness: 0.2, roughness: 0.85 }),
    hat: new THREE.MeshStandardMaterial({ color: 0xa9adb1, metalness: 0.55, roughness: 0.42 }),
    stud: new THREE.MeshStandardMaterial({ color: 0xc8c2b0, metalness: 1, roughness: 0.3 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x8e9092, metalness: 0.6, roughness: 0.62 }),
    cast: new THREE.MeshStandardMaterial({ color: 0x141517, metalness: 0.4, roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0, roughness: 0.6 }),
    spring: new THREE.MeshStandardMaterial({ color: 0x0f1012, metalness: 0.3, roughness: 0.42 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd0d2d4, metalness: 1, roughness: 0.14 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0xb9bcbf, metalness: 1, roughness: 0.28 }),
    // Masking bag over the brake while the coat is sprayed (clear polythene, taped at the knuckle).
    bag: new THREE.MeshPhysicalMaterial({
      // (clear and glossy: a milky white read as paper under the studio lights)
      color: 0xc9d6e0, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04,
      transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }),
    tape: new THREE.MeshStandardMaterial({ color: 0xb8a27a, metalness: 0, roughness: 0.75, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  };
  return mats;
}

// Lathe around the axle: profile points are [radius, x].
function lathe(points, segments = 64, phiStart = 0, phiLength = Math.PI * 2) {
  const geo = new THREE.LatheGeometry(points.map(([r, x]) => new THREE.Vector2(r, x)), segments, phiStart, phiLength);
  return geo.rotateZ(-Math.PI / 2); // lathe axis y -> x
}

function cylinderX(r, x0, x1, segments = 24) {
  return new THREE.CylinderGeometry(r, r, x1 - x0, segments).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, 0, 0);
}

// Annular sector in the wheel plane (angle a from +z towards +y), thick along x.
function sector(r0, r1, aMid, aSpan, x0, x1, bevel = 0.006) {
  const shape = new THREE.Shape();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = aMid - aSpan / 2 + (aSpan * i) / n;
    const p = [-r1 * Math.cos(a), r1 * Math.sin(a)];
    i ? shape.lineTo(...p) : shape.moveTo(...p);
  }
  for (let i = n; i >= 0; i--) {
    const a = aMid - aSpan / 2 + (aSpan * i) / n;
    shape.lineTo(-r0 * Math.cos(a), r0 * Math.sin(a));
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: x1 - x0 - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  // shape x -> -z, extrusion z -> x
  return geo.rotateY(Math.PI / 2).translate(x0 + bevel, 0, 0);
}

function tube(points, r, segments = 48) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, r, 8);
}

function spring(r, wire, y0, y1, turns) {
  const pts = [];
  const n = Math.round(turns * 24);
  for (let i = 0; i <= n; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + ((y1 - y0) * i) / n, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, wire, 6);
}

// Merge each material's pieces into one mesh, so a corner costs a handful of draw calls.
function assemble(parts) {
  const group = new THREE.Group();
  for (const [mat, geos] of parts) {
    const flat = geos.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(ng.attributes)) if (!["position", "normal", "uv"].includes(name)) ng.deleteAttribute(name);
      ng.clearGroups();
      return ng;
    });
    group.add(new THREE.Mesh(mergeGeometries(flat), mat));
  }
  return group;
}

export function buildCorner({ front }) {
  const m = materials();
  const pistonSide = DISC_X - 0.05;
  // Caliper sits behind the axle, towards the middle of the car.
  const calA = front ? Math.PI * 0.82 : Math.PI * 0.18;

  // Vented disc: two friction plates with radial vanes between, and the hat it bolts on by.
  const plates = [
    lathe([[R_IN, DISC_X + 0.0055], [R_OUT, DISC_X + 0.0055], [R_OUT, DISC_X + 0.013], [R_IN, DISC_X + 0.013], [R_IN, DISC_X + 0.0055]]),
    lathe([[R_IN, DISC_X - 0.013], [R_OUT, DISC_X - 0.013], [R_OUT, DISC_X - 0.0055], [R_IN, DISC_X - 0.0055], [R_IN, DISC_X - 0.013]]),
  ];
  const vanes = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const rMid = (R_IN + R_OUT) / 2;
    vanes.push(new THREE.BoxGeometry(0.011, 0.006, R_OUT - R_IN - 0.006)
      .rotateX(-a)
      .translate(DISC_X, Math.sin(a) * rMid, Math.cos(a) * rMid));
  }
  const hat = lathe([
    [R_IN, DISC_X + 0.013], [0.082, 0.004], [0.078, 0.024], [0.073, HAT_FACE], [0.036, HAT_FACE], [0.033, HAT_FACE - 0.006],
  ]);
  const studs = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    studs.push(cylinderX(0.0065, HAT_FACE, HAT_FACE + 0.042, 12).translate(0, Math.sin(a) * 0.05715, Math.cos(a) * 0.05715));
  }
  const hubNut = cylinderX(0.024, HAT_FACE, HAT_FACE + 0.018, 6); // hex axle nut

  // Dust shield behind the disc, open where the caliper reaches round. (Lathe angle phi lands at wheel angle -phi.)
  const shieldGap = 1.5;
  const shield = lathe(
    [[0.07, DISC_X - 0.03], [0.168, DISC_X - 0.03], [0.172, DISC_X - 0.022], [0.172, DISC_X - 0.016]],
    48, shieldGap / 2 - calA, Math.PI * 2 - shieldGap,
  );

  // Floating caliper with its carrier, the piston housing on the inboard side, and the hose up into the arch.
  const caliper = [
    sector(0.118, 0.19, calA, 1.15, DISC_X - 0.048, DISC_X + 0.034),
    sector(0.1, 0.13, calA, 1.45, DISC_X - 0.058, DISC_X - 0.02),
    cylinderX(0.034, pistonSide - 0.02, pistonSide + 0.01, 20)
      .translate(0, Math.sin(calA) * 0.155, Math.cos(calA) * 0.155),
  ];
  const hoseStart = new THREE.Vector3(pistonSide - 0.01, Math.sin(calA) * 0.17 + 0.02, Math.cos(calA) * 0.17);
  const hoseEnd = new THREE.Vector3(-0.17, 0.42, 0);
  const hose = tube([hoseStart, new THREE.Vector3(-0.12, 0.27, hoseStart.z * 0.5), hoseEnd], 0.0055);
  // Crimped fittings at both ends of the hose, and the steel brake line running on up the inner wing.
  const fittings = [hoseStart, hoseEnd].map((p) => new THREE.CylinderGeometry(0.009, 0.009, 0.03, 12).translate(p.x, p.y, p.z));
  const side = Math.sign(hoseStart.z) || 1;
  const line = tube([
    hoseEnd,
    new THREE.Vector3(-0.2, 0.47, side * 0.05),
    new THREE.Vector3(-0.22, 0.5, side * 0.2),
    new THREE.Vector3(-0.24, 0.45, side * 0.36),
  ], 0.0035, 40);

  // Knuckle behind the hub, and the strut rising from it, leaning in at the top.
  const knuckle = [
    new THREE.BoxGeometry(0.05, 0.3, 0.075).translate(DISC_X - 0.075, -0.01, 0),
    cylinderX(0.05, DISC_X - 0.1, DISC_X - 0.03, 24),
  ];
  const lean = 0.22;
  const body = new THREE.CylinderGeometry(0.026, 0.026, 0.26, 20).translate(0, 0.27, 0);
  const shaft = new THREE.CylinderGeometry(0.011, 0.011, 0.2, 12).translate(0, 0.5, 0);
  const seat = new THREE.CylinderGeometry(0.088, 0.088, 0.008, 28).translate(0, 0.33, 0);
  const coil = spring(0.07, 0.0075, 0.335, 0.6, 5.5);
  for (const g of [body, shaft, seat, coil]) g.rotateZ(lean).translate(DISC_X - 0.08, 0, 0);

  const parts = [
    [m.disc, plates],
    [m.rust, vanes],
    [m.hat, [hat]],
    [m.stud, [...studs, hubNut]],
    [m.caliper, caliper],
    [m.cast, [shield, ...knuckle, body, seat]],
    [m.chrome, [shaft]],
    [m.spring, [coil]],
    [m.rubber, [hose]],
    [m.pipe, [line, ...fittings]],
  ];

  if (front) {
    // Drive shaft with its outer and inner boots (the Innova Zenix drives the front wheels).
    const boot = (xa, xb, r0, r1) => {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const rib = i % 2 ? 0.006 : 0;
        pts.push([r0 + (r1 - r0) * t + rib, xa + (xb - xa) * t]);
      }
      return lathe(pts, 24);
    };
    parts.push([m.rubber, [boot(DISC_X - 0.1, DISC_X - 0.21, 0.042, 0.018), boot(-0.52, -0.62, 0.02, 0.04)]]);
    parts.push([m.cast, [cylinderX(0.013, -0.53, DISC_X - 0.2, 12)]]);
  }

  const group = assemble(parts);
  // The masking bag: a crumpled shell over disc and caliper, taped round the knuckle. Shown by setWrap().
  const bag = new THREE.Mesh(bagGeometry(), m.bag);
  bag.position.set(DISC_X + 0.005, 0.01, 0);
  // (an open band round the knuckle: with its ends capped it read as a flat cream disc)
  const tape = new THREE.Mesh(
    new THREE.CylinderGeometry(0.058, 0.062, 0.03, 32, 1, true).rotateZ(Math.PI / 2).translate(DISC_X - 0.095, 0, 0),
    m.tape,
  );
  bag.renderOrder = tape.renderOrder = 2;
  group.add(bag, tape);
  group.userData.wrap = [bag, tape];
  return group;
}

// Wrapped amount 0..1 for every corner: the bags fade and swell into place, and come off the same way.
export function setWrap(groups, w) {
  const m = materials();
  m.bag.opacity = 0.2 * w;
  m.tape.opacity = w;
  for (const g of groups) {
    for (const o of g.userData.wrap) {
      o.visible = w > 0.001;
      o.scale.setScalar(0.85 + 0.15 * w);
    }
  }
}

// An ellipsoid round the brake, pushed in and out by a few octaves of value noise so it reads as loose polythene.
function bagGeometry() {
  const geo = new THREE.SphereGeometry(1, 48, 32);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const hash = (x, y, z) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const s = (t) => t * t * (3 - 2 * t);
    let sum = 0;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
      const w = (dx ? s(fx) : 1 - s(fx)) * (dy ? s(fy) : 1 - s(fy)) * (dz ? s(fz) : 1 - s(fz));
      sum += w * hash(ix + dx, iy + dy, iz + dz);
    }
    return sum - 0.5;
  };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const crumple = 1 + 0.16 * noise(v.x * 3, v.y * 3, v.z * 3) + 0.07 * noise(v.x * 9, v.y * 9, v.z * 9);
    v.multiplyScalar(crumple).multiply(new THREE.Vector3(0.085, 0.235, 0.235));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
