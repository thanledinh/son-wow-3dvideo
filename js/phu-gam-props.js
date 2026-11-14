// Detail for the phủ gầm page, built in code (the user: "chi tiết hơn": the underbody and the shop round the lift).
//
// buildUnderbody: what an Innova Zenix carries under its floor and the scan doesn't show, laid out to the raised
// car's floor (measured by raycasting the scan: about y 1.66–1.70 between the wheels, 1.58 under the nose,
// 1.83–1.89 under the boot) and to its wheels (centres x ±0.77, y 1.688, z +1.449 / −1.408):
// - the exhaust: down-pipe, catalytic converter, centre pipe and resonator, over the rear beam to the silencer and
//   tailpipe, on rubber hangers, under dimpled heat shields; stainless and heat-tinted (masked when the shop coats)
// - the fuel tank (black plastic, two steel straps) ahead of the rear axle
// - the rear torsion beam with its trailing arms, springs and dampers; the front subframe, lower arms and steering
//   rack; brake and fuel lines along the floor. These are steel and take the coat (makeCoat: a coat material).
// Everything is placed in world space at the raised car and then carried by the car.
//
// buildShop: a working bay round the lift: a tool cart, an air compressor, a stack of GB "UBS R" cans on a dolly,
// two underbody work lights on stands, and a creeper board. Kept out of the camera's paths and the sprayers' walks.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { canLabel } from "./phu-gam-worker.js";

const Y = new THREE.Vector3(0, 1, 0);

// a cylinder (or any y-axis geometry) from a to b
function between(geo, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = geo.clone();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function rod(a, b, r, seg = 12) {
  return between(new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg, 1), a, b);
}

// a tube along points
function pipe(points, r, seg = 64) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.2), seg, r, 12, false);
}

// a rounded box (an oval can for silencers and converters, a tank)
function oval(w, h, len, at, axis = "z") {
  const shape = new THREE.Shape();
  const rx = w / 2;
  const ry = h / 2;
  shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 20 });
  g.translate(0, 0, -len / 2);
  if (axis === "x") g.rotateY(Math.PI / 2);
  g.translate(at.x, at.y, at.z);
  return g;
}

function box(w, h, d, at, rot) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.rotateY(rot);
  return g.translate(at.x, at.y, at.z);
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mesh(parts, mat) {
  // (extruded shapes come unindexed, the rest indexed: all unindexed so they merge)
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    f.clearGroups();
    for (const k of Object.keys(f.attributes)) if (!["position", "normal", "uv"].includes(k)) f.deleteAttribute(k);
    return f;
  });
  const m = new THREE.Mesh(mergeGeometries(flat, false), mat);
  m.castShadow = false;
  return m;
}

export function buildUnderbody(makeCoat) {
  const group = new THREE.Group();
  group.name = "Underbody_Detail";
  const steelBare = makeCoat();
  // (dulled: polished, the centre pipe caught the light bars and read as a fluorescent tube)
  const exhaust = new THREE.MeshStandardMaterial({ color: 0x5e5a55, metalness: 0.85, roughness: 0.62 });
  const tint = new THREE.MeshStandardMaterial({ color: 0x5f4c40, metalness: 0.85, roughness: 0.58 }); // heat-tinted bronze
  const shield = new THREE.MeshStandardMaterial({ color: 0xc3c6ca, metalness: 1, roughness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.7 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x141517, metalness: 0, roughness: 0.55 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 1, roughness: 0.3 });

  // exhaust run, a little right of the middle (the tank takes the left)
  const ex = [V(0.18, 1.5, 1.75), V(0.16, 1.47, 1.5), V(0.14, 1.52, 1.25)];
  const center = [V(0.14, 1.55, 0.72), V(0.14, 1.57, 0.2), V(0.14, 1.57, -0.35)];
  const rear = [V(0.15, 1.57, -0.85), V(0.2, 1.6, -1.15), V(0.26, 1.7, -1.4), V(0.32, 1.68, -1.68)];
  const tail = [V(0.36, 1.67, -2.2), V(0.48, 1.64, -2.32), V(0.55, 1.62, -2.42)];
  group.add(mesh([
    pipe(ex, 0.028, 24),
    pipe([ex[2], V(0.14, 1.54, 1.12)], 0.028, 6),
    pipe([V(0.14, 1.55, 0.78), ...center], 0.026, 40),
    pipe([V(0.14, 1.57, -0.78), ...rear], 0.026, 40),
    pipe(tail, 0.024, 16),
  ], exhaust));
  group.add(mesh([
    oval(0.13, 0.1, 0.36, V(0.14, 1.545, 0.95)), // catalytic converter
    oval(0.15, 0.09, 0.42, V(0.14, 1.575, -0.56)), // resonator
    oval(0.36, 0.15, 0.44, V(0.36, 1.7, -1.94)), // silencer, under the boot
  ], tint));
  // hangers: short rubber posts up to the floor
  const hang = [V(0.14, 1.57, 0.45), V(0.14, 1.585, -0.15), V(0.2, 1.61, -1.1), V(0.24, 1.75, -1.75), V(0.5, 1.75, -2.05)];
  group.add(mesh(hang.map((p) => rod(p, p.clone().add(V(0, 0.09, 0)), 0.009, 8)), rubber));
  // heat shields above the converter and the centre pipe: thin dimpled plates just under the floor
  const shieldGeo = (z0, z1, w, y) => {
    const g = new THREE.PlaneGeometry(w, z1 - z0, 10, 24).rotateX(Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      // dished over the pipe, with a dimple pattern pressed in
      p.setY(i, 0.018 * (1 - (2 * x / w) ** 2) + 0.0025 * Math.sin(x * 90) * Math.sin(z * 90));
    }
    g.computeVertexNormals();
    return g.translate(0.14, y, (z0 + z1) / 2);
  };
  group.add(mesh([shieldGeo(0.7, 1.2, 0.24, 1.615), shieldGeo(-0.85, 0.65, 0.18, 1.63)], shield));

  // fuel tank, left of the exhaust, ahead of the rear axle, on two straps
  const tank = oval(0.62, 0.15, 0.7, V(-0.32, 1.585, -0.7), "x");
  tank.rotateY(0); // (already across the car)
  group.add(mesh([tank], plastic));
  group.add(mesh([-0.5, -0.9].map((z) => box(0.66, 0.006, 0.035, V(-0.32, 1.505, z))), steelBare));

  // rear torsion beam: the beam across, trailing arms forward to their pivots, spring seats, springs, dampers
  const beam = [];
  for (const s of [1, -1]) {
    const hub = V(0.66 * s, 1.69, -1.4);
    const pivot = V(0.6 * s, 1.72, -0.92);
    beam.push(rod(hub, pivot, 0.035, 14));
    beam.push(rod(pivot, pivot.clone().add(V(0, 0.08, 0)), 0.04, 14)); // bushing bracket
    beam.push(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20).translate(0.55 * s, 1.72, -1.47)); // spring seat
    beam.push(rod(V(0.6 * s, 1.68, -1.52), V(0.62 * s, 1.9, -1.55), 0.018, 12)); // damper
  }
  beam.push(rod(V(-0.66, 1.67, -1.32), V(0.66, 1.67, -1.32), 0.045, 16));
  group.add(mesh(beam, steelBare));
  const coil = [];
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const a = (i / 80) * Math.PI * 2 * 5;
      pts.push(V(0.55 * s + Math.cos(a) * 0.05, 1.725 + (i / 80) * 0.15, -1.47 + Math.sin(a) * 0.05));
    }
    coil.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.008, 6));
  }
  group.add(mesh(coil, new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.3, roughness: 0.45 })));

  // front: subframe crossmember, lower arms out to the hubs, the steering rack ahead of them
  const front = [
    box(1.0, 0.07, 0.12, V(0, 1.56, 1.22)),
    rod(V(-0.45, 1.57, 1.22), V(-0.45, 1.6, 0.85), 0.03), rod(V(0.45, 1.57, 1.22), V(0.45, 1.6, 0.85), 0.03),
  ];
  for (const s of [1, -1]) {
    front.push(rod(V(0.42 * s, 1.56, 1.3), V(0.7 * s, 1.6, 1.45), 0.025));
    front.push(rod(V(0.42 * s, 1.56, 1.12), V(0.7 * s, 1.6, 1.45), 0.022));
  }
  group.add(mesh(front, steelBare));
  group.add(mesh([rod(V(-0.42, 1.6, 1.58), V(0.42, 1.6, 1.58), 0.026, 14)], new THREE.MeshStandardMaterial({ color: 0x5c5e61, metalness: 0.8, roughness: 0.5 })));
  group.add(mesh([-0.38, 0.38].map((x) => rod(V(x, 1.6, 1.58), V(x * 1.55, 1.62, 1.5), 0.012)), steelBare)); // tie rods
  group.add(mesh([-0.42, 0.42].map((x) => rod(V(x - 0.04 * Math.sign(x), 1.6, 1.58), V(x + 0.06 * Math.sign(x), 1.6, 1.58), 0.035, 14)), rubber)); // rack boots

  // brake and fuel lines along the left of the floor
  const lines = [];
  for (const [x, y] of [[-0.6, 1.655], [-0.63, 1.66], [-0.66, 1.665]]) lines.push(pipe([V(x, y, 1.15), V(x, y, 0), V(x + 0.02, y, -1.1)], 0.004, 30));
  group.add(mesh(lines, lineMat));
  return group;
}

export function buildShop() {
  const group = new THREE.Group();
  group.name = "Shop_Props";
  const paint = (c, rough = 0.45, metal = 0.3) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  const black = paint(0x151618);
  const grey = paint(0x3a3d41, 0.4, 0.6);
  const chrome = paint(0xc8ccd0, 0.2, 1);
  const rubber = paint(0x0b0b0c, 0.75, 0);
  const caster = (x, z, h = 0.07) => [new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14).rotateZ(Math.PI / 2).translate(x, 0.035, z), rod(V(x, 0.06, z), V(x, h, z), 0.008)];

  // tool cart: a black roller cabinet with seven drawers, chrome pulls, a top tray and a push handle
  {
    const cart = new THREE.Group();
    const body = [box(0.72, 0.78, 0.46, V(0, 0.48, 0))];
    const fronts = [];
    const pulls = [];
    for (let i = 0; i < 7; i++) {
      const y = 0.15 + i * 0.1 + (i > 3 ? 0.02 : 0);
      fronts.push(box(0.68, 0.085, 0.01, V(0, y + 0.05, 0.235)));
      pulls.push(box(0.5, 0.012, 0.018, V(0, y + 0.085, 0.247)));
    }
    cart.add(mesh(body, black), mesh(fronts, paint(0x1f2124, 0.35, 0.4)), mesh(pulls, chrome));
    cart.add(mesh([box(0.72, 0.03, 0.46, V(0, 0.885, 0)), box(0.7, 0.05, 0.01, V(0, 0.92, 0.225)), box(0.7, 0.05, 0.01, V(0, 0.92, -0.225))], grey));
    cart.add(mesh([rod(V(-0.42, 0.75, -0.18), V(-0.42, 0.75, 0.18), 0.012), rod(V(-0.36, 0.75, -0.18), V(-0.42, 0.75, -0.18), 0.012), rod(V(-0.36, 0.75, 0.18), V(-0.42, 0.75, 0.18), 0.012)], chrome));
    cart.add(mesh([...caster(-0.3, -0.18), ...caster(0.3, -0.18), ...caster(-0.3, 0.18), ...caster(0.3, 0.18)], rubber));
    // a few tools on the top: a spray can, a roll of masking tape, a scraper
    cart.add(mesh([new THREE.CylinderGeometry(0.03, 0.03, 0.2, 16).translate(0.2, 1.0, 0.05)], new THREE.MeshStandardMaterial({ map: canLabel(), roughness: 0.3, metalness: 0.3 })));
    cart.add(mesh([new THREE.TorusGeometry(0.045, 0.02, 10, 24).rotateX(Math.PI / 2).translate(-0.12, 0.92, -0.05)], paint(0xc9b98f, 0.8, 0)));
    cart.add(mesh([box(0.2, 0.01, 0.06, V(0.02, 0.91, 0.1), 0.4)], grey));
    cart.position.set(-2.75, 0, 1.45);
    cart.rotation.y = 0.35;
    group.add(cart);
  }

  // air compressor: a horizontal tank on wheels, motor and pump on top, a gauge, the outlet line to the posts
  {
    const comp = new THREE.Group();
    const blue = paint(0x1d4f8f, 0.35, 0.4);
    comp.add(mesh([new THREE.CylinderGeometry(0.22, 0.22, 0.9, 28).rotateZ(Math.PI / 2).translate(0, 0.33, 0), new THREE.SphereGeometry(0.22, 24, 12).scale(0.35, 1, 1).translate(0.45, 0.33, 0), new THREE.SphereGeometry(0.22, 24, 12).scale(0.35, 1, 1).translate(-0.45, 0.33, 0)], blue));
    comp.add(mesh([box(0.3, 0.2, 0.22, V(-0.15, 0.65, 0)), new THREE.CylinderGeometry(0.11, 0.11, 0.08, 20).rotateX(Math.PI / 2).translate(0.18, 0.66, 0.06)], black));
    comp.add(mesh([new THREE.CylinderGeometry(0.04, 0.04, 0.02, 20).rotateX(Math.PI / 2).translate(0.32, 0.6, 0.12)], chrome));
    comp.add(mesh([new THREE.CylinderGeometry(0.09, 0.09, 0.06, 18).rotateX(Math.PI / 2).translate(-0.35, 0.09, 0.2), new THREE.CylinderGeometry(0.09, 0.09, 0.06, 18).rotateX(Math.PI / 2).translate(-0.35, 0.09, -0.2), box(0.06, 0.12, 0.3, V(0.38, 0.06, 0))], rubber));
    comp.position.set(-3.1, 0, -2.05);
    comp.rotation.y = -0.5;
    group.add(comp);
  }

  // GB cans: two rows of 1 L cans on a low dolly, and an opened carton
  {
    const cans = new THREE.Group();
    const label = new THREE.MeshStandardMaterial({ map: canLabel(), roughness: 0.3, metalness: 0.3 });
    const geos = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) geos.push(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 24).rotateY(-Math.PI / 2 + i * 0.4).translate(-0.15 + i * 0.1, 0.17, -0.1 + j * 0.1));
    cans.add(mesh(geos, label));
    cans.add(mesh([box(0.5, 0.03, 0.4, V(0, 0.055, 0))], paint(0x2a2c2f, 0.5, 0.3)), mesh([...caster(-0.2, -0.15, 0.05), ...caster(0.2, -0.15, 0.05), ...caster(-0.2, 0.15, 0.05), ...caster(0.2, 0.15, 0.05)], rubber));
    cans.add(mesh([box(0.42, 0.26, 0.32, V(0.48, 0.13, 0.05), 0.2)], paint(0x9b7b55, 0.9, 0)));
    cans.position.set(2.55, 0, -2.45);
    cans.rotation.y = 0.6;
    group.add(cans);
  }

  // underbody work lights: a tripod stand with an LED bar tilted up at the floor pan
  const lights = [];
  for (const [x, z, ry] of [[2.45, 0.85, -0.9], [-2.4, 0.3, 2.3]]) {
    const st = new THREE.Group();
    const legs = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      legs.push(rod(V(Math.cos(a) * 0.32, 0.01, Math.sin(a) * 0.32), V(0, 0.42, 0), 0.01));
    }
    legs.push(rod(V(0, 0.4, 0), V(0, 1.05, 0), 0.014));
    st.add(mesh(legs, black));
    // the head: a long housing across, its lit face (+z) turned at the car's floor pan
    const head = new THREE.Group();
    head.add(mesh([box(0.62, 0.07, 0.06, V(0, 0, 0))], grey));
    const bar = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.95).multiplyScalar(5) });
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.045, 0.01).translate(0, 0, 0.033), bar));
    head.position.set(0, 1.1, 0);
    st.add(head);
    st.position.set(x, 0, z);
    st.rotation.y = ry;
    group.add(st);
    st.updateMatrixWorld(true);
    head.lookAt(V(0, 1.6, z * 0.6));
    lights.push(bar);
  }

  // creeper board on the floor
  {
    const cr = new THREE.Group();
    cr.add(mesh([box(0.42, 0.03, 1.0, V(0, 0.07, 0)), box(0.3, 0.05, 0.16, V(0, 0.1, -0.4))], paint(0x22252a, 0.4, 0.2)));
    cr.add(mesh([...caster(-0.17, -0.42, 0.06), ...caster(0.17, -0.42, 0.06), ...caster(-0.17, 0.42, 0.06), ...caster(0.17, 0.42, 0.06)], rubber));
    cr.position.set(-3.0, 0, 3.2); // (clear of where the rear-half sprayer waits at (-1.95, 2.6))
    cr.rotation.y = 0.25;
    group.add(cr);
  }
  return { group, lights };
}
