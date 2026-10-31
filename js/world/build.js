import * as THREE from 'three';
import { srand, srange, TAU, tex, surface, std, mesh, cutoutDepth, contactShadow } from './util.js';
import { L } from './layout.js?v=42';

/* Everything made by hand: the thatched hut, the brushwood fence and gate,
   the vegetable bed, the bean field and the tools. */

export const boxColliders = [];     // [x0, x1, z0, z1]
export const circleColliders = [];  // [x, z, r]

const wood = surface('wood', { repeat: 1, roughness: 0.85 });
const darkWood = surface('wood', { repeat: 1, color: 0x8a7a68, roughness: 0.9 });
const twig = surface('bark', { repeat: 1, color: 0xb8a58a, roughness: 1 });
const wall = surface('earthwall', { repeat: 1, roughness: 1 });
const thatchMat = surface('thatch', { repeat: 1, roughness: 1, normalScale: 1.5, color: 0xfff2d6 });
const soilMat = surface('soil', { repeat: 1, roughness: 1, normalScale: 1.4 });
const rootMat = std(0xb59b78, { roughness: 1 });
const stone = surface('dirt', { repeat: 1, color: 0xa39c90, roughness: 0.95 });

/** box with texture coordinates in metres, so textures keep their scale */
function box(w, h, d, mat, x, y, z, parent, tile = 1.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const sx = ax > 0.5 ? d : w, sy = ay > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * sx / tile, uv.getY(i) * sy / tile);
  }
  return mesh(g, mat, x, y, z, parent);
}
function cyl(r0, r1, h, mat, x, y, z, parent, seg = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, r0 * 20), uv.getY(i) * h / 1.2);
  return mesh(g, mat, x, y, z, parent);
}

/* ================================================================ hut */
function hut(scene) {
  const { x: HX, z: HZ, w, d } = L.hut;
  const g = new THREE.Group();
  g.position.set(HX, 0, HZ);
  scene.add(g);
  const FL = 0.34, TOP = 2.85, FZ = d / 2, BZ = -d / 2;
  box(w + 0.7, FL, d + 0.9, stone, 0, FL / 2, 0.15, g, 1.2);
  box(1.4, 0.17, 0.5, stone, 0, 0.085, FZ + 0.62, g, 1);     // step
  // posts and beams
  const xs = [-w / 2, -1.1, 1.1, w / 2];
  xs.forEach(x => [FZ, BZ].forEach(z => cyl(0.12, 0.13, TOP - FL, darkWood, x, (TOP + FL) / 2, z + (z > 0 ? 0.04 : -0.04), g, 10)));
  [FZ, BZ].forEach(z => box(w + 0.3, 0.2, 0.2, wood, 0, TOP, z, g));
  [-w / 2, w / 2].forEach(x => box(0.2, 0.2, d + 0.3, wood, x, TOP, 0, g));
  // walls: back and sides solid
  const T = 0.2, H = TOP - FL;
  box(w, H, T, wall, 0, FL + H / 2, BZ, g);
  [-w / 2, w / 2].forEach(x => box(T, H, d, wall, x, FL + H / 2, 0, g));
  // front: two bays with lattice windows, door in the middle
  const winMat = new THREE.MeshStandardMaterial({ color: 0x17110b, emissive: 0xff9a40, emissiveIntensity: 0, roughness: 0.9 });
  [-1, 1].forEach(side => {
    const cx = side * (w / 4 + 0.55), bw = w / 2 - 1.1;
    const wx0 = 0.5, wy0 = 1.05, wy1 = 1.85;
    box(bw, wy0 - FL, T, wall, cx, (FL + wy0) / 2, FZ, g);
    box(bw, TOP - wy1, T, wall, cx, (wy1 + TOP) / 2, FZ, g);
    [-1, 1].forEach(s2 => box((bw - wx0 * 2) / 2, wy1 - wy0, T, wall, cx + s2 * (wx0 + (bw - wx0 * 2) / 4), (wy0 + wy1) / 2, FZ, g));
    for (let i = 0; i <= 8; i++) cyl(0.018, 0.018, wy1 - wy0, darkWood, cx - wx0 + i * (wx0 * 2 / 8), (wy0 + wy1) / 2, FZ + 0.02, g, 5);
    box(wx0 * 2 + 0.12, 0.07, 0.08, darkWood, cx, wy0, FZ + 0.06, g);
    box(wx0 * 2 + 0.12, 0.07, 0.08, darkWood, cx, wy1, FZ + 0.06, g);
    mesh(new THREE.PlaneGeometry(wx0 * 2, wy1 - wy0), winMat, cx, (wy0 + wy1) / 2, FZ - 0.06, g, { cast: false });
  });
  // door opening, ajar leaves, dark interior that glows at night
  const DW = 1.1, DH = 2.25;
  box(2.2 - DW, TOP - FL, T, wall, -(DW / 2 + (2.2 - DW) / 4), FL + H / 2, FZ, g).scale.x = 0.5;
  box(2.2 - DW, TOP - FL, T, wall, (DW / 2 + (2.2 - DW) / 4), FL + H / 2, FZ, g).scale.x = 0.5;
  box(DW, TOP - DH, T, wall, 0, (DH + TOP) / 2, FZ, g);
  box(DW + 0.2, 0.12, 0.24, wood, 0, DH, FZ, g);
  const doorL = new THREE.Group(), doorR = new THREE.Group();
  doorL.position.set(-DW / 2, FL, FZ - 0.02);
  doorR.position.set(DW / 2, FL, FZ - 0.02);
  box(DW / 2, DH - FL - 0.04, 0.06, darkWood, DW / 4, (DH - FL) / 2, 0, doorL, 0.8);
  box(DW / 2, DH - FL - 0.04, 0.06, darkWood, -DW / 4, (DH - FL) / 2, 0, doorR, 0.8);
  g.add(doorL, doorR);   // closed until the end of the day; they swing inwards
  // gable roof with a thick thatch
  const pitch = 0.62, over = 1.0, half = d / 2 + over, slabLen = half / Math.cos(pitch), rise = half * Math.tan(pitch);
  const thatchUV = (mat, len) => { const m = mat.clone(); m.map = mat.map.clone(); m.normalMap = mat.normalMap.clone(); [m.map, m.normalMap].forEach(t => { t.repeat.set((w + 1.3) / 2.2, len / 1.6); }); return m; };
  const roofMat = thatchUV(thatchMat, slabLen);
  [-1, 1].forEach(side => {
    const slab = box(w + 1.3, 0.46, slabLen, roofMat, 0, TOP + rise / 2 + 0.14, side * half / 2, g, 99);
    slab.geometry = new THREE.BoxGeometry(w + 1.3, 0.46, slabLen);
    slab.rotation.x = side * pitch;
  });
  const ridge = cyl(0.26, 0.26, w + 1.5, thatchMat, 0, TOP + rise + 0.22, 0, g, 14);
  ridge.rotation.z = Math.PI / 2;
  [-1, 1].forEach(s => { [-0.5, 0.5].forEach(k => { const st = cyl(0.025, 0.025, 1.0, darkWood, s * (w / 2 + 0.3) + k * 0.1, TOP + rise + 0.45, 0, g, 5); st.rotation.x = k * 1.4; }); });
  // gable triangles
  const tri = new THREE.Shape();
  tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, (d / 2) * Math.tan(pitch)); tri.lineTo(-d / 2, 0);
  const triGeo = new THREE.ShapeGeometry(tri);
  const tuv = triGeo.attributes.uv, tp = triGeo.attributes.position;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tp.getX(i) / 1.5, tp.getY(i) / 1.5);
  [-1, 1].forEach(s => { const m = mesh(triGeo, wall, s * w / 2, TOP + 0.1, 0, g); m.rotation.y = s * Math.PI / 2; m.material = wall.clone(); m.material.side = THREE.DoubleSide; });
  // light from inside, on at night
  const lamp = new THREE.PointLight(0xffa850, 0, 7, 1.7);
  lamp.position.set(0, 1.6, FZ + 0.4);
  g.add(lamp);
  contactShadow(scene, HX, HZ + 0.2, 5.2, 0.5);
  // walls as colliders, with the doorway left open (blocked by the closed door until it opens)
  const wz0 = HZ + BZ, wz1 = HZ + FZ, t2 = 0.18;
  boxColliders.push([HX - w / 2 - 0.3, HX + w / 2 + 0.3, wz0 - 0.45, wz0 + t2]);                 // back
  boxColliders.push([HX - w / 2 - 0.45, HX - w / 2 + t2, wz0 - 0.45, wz1 + 0.15]);                // left
  boxColliders.push([HX + w / 2 - t2, HX + w / 2 + 0.45, wz0 - 0.45, wz1 + 0.15]);                // right
  boxColliders.push([HX - w / 2 - 0.45, HX - DW / 2, wz1 - t2, wz1 + 0.15]);                      // front left
  boxColliders.push([HX + DW / 2, HX + w / 2 + 0.45, wz1 - t2, wz1 + 0.15]);                      // front right
  const doorBlock = [HX - DW / 2, HX + DW / 2, wz1 - t2, wz1 + 0.15];
  boxColliders.push(doorBlock);

  // ---- inside: an earthen-floored room lit by an oil lamp
  box(w - 0.25, 0.03, d - 0.25, surface('wood', { repeat: 1, color: 0x9c8466, roughness: 0.95 }), 0, FL + 0.015, 0, g, 1.0);
  // low table with an oil lamp
  const tx = 1.6, tz = -0.75;
  box(0.95, 0.05, 0.6, wood, tx, FL + 0.42, tz, g);
  [[-0.4, -0.24], [0.4, -0.24], [-0.4, 0.24], [0.4, 0.24]].forEach(([a, b]) => box(0.05, 0.4, 0.05, wood, tx + a, FL + 0.2, tz + b, g));
  const lampDish = new THREE.LatheGeometry([[0, 0], [0.07, 0.01], [0.09, 0.04], [0.085, 0.045]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
  mesh(lampDish, std(0x5a4a3a, { roughness: 0.5 }), tx, FL + 0.45, tz, g);
  const flame = mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a }), tx + 0.05, FL + 0.52, tz, g, { cast: false, receive: false });
  flame.scale.set(1, 1.8, 1);
  const roomLight = new THREE.PointLight(0xffb066, 0, 7, 1.6);
  roomLight.position.set(tx + 0.05, FL + 0.75, tz);
  g.add(roomLight);
  // ---- a room someone lives in: bed, stove, water jar, wine, books and a stringless qin
  const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const clay = std(0x6b4a34, { roughness: 0.45 }), glaze = std(0x3b2f27, { roughness: 0.25 }), celadon = std(0x8fa58c, { roughness: 0.3 });
  const cloth = std(0x34435e, { roughness: 1 }), linen = std(0xd9cdb4, { roughness: 1 }), straw = std(0xc8b07a, { map: tex('thatch.jpg'), roughness: 1 });
  const iron = std(0x2a2826, { roughness: 0.55, metalness: 0.6 }), brick = surface('earthwall', { repeat: 1, color: 0xb59c86, roughness: 1 });
  const paper = std(0xe9dfc6, { roughness: 1 });

  // a low wooden bed (榻) against the back wall, straw mat, indigo quilt, a ceramic pillow
  const BX = -2.3, BZb = BZ + 0.6;
  box(1.95, 0.08, 1.0, wood, BX, FL + 0.38, BZb, g);
  [[-0.9, -0.42], [0.9, -0.42], [-0.9, 0.42], [0.9, 0.42]].forEach(([a, b]) => box(0.08, 0.34, 0.08, darkWood, BX + a, FL + 0.17, BZb + b, g));
  box(1.85, 0.03, 0.92, straw, BX, FL + 0.435, BZb, g, 1);
  box(0.75, 0.1, 0.8, cloth, BX + 0.45, FL + 0.5, BZb, g, 1);                 // quilt, folded at the foot
  box(0.7, 0.05, 0.75, cloth, BX + 0.45, FL + 0.575, BZb + 0.02, g, 1);
  box(0.32, 0.12, 0.16, celadon, BX - 0.7, FL + 0.51, BZb - 0.2, g, 1);       // pillow
  boxColliders.push([HX + BX - 1.05, HX + BX + 1.05, HZ + BZb - 0.6, HZ + BZb + 0.6]);
  // shelf above the bed: bowls, a jar, a bundle of thread-bound books
  box(0.9, 0.04, 0.28, wood, -2.3, 1.55, BZ + 0.25, g);
  mesh(lathe([[0, 0], [0.1, 0.01], [0.14, 0.12], [0.1, 0.24], [0.07, 0.26]], 14), clay, -2.6, 1.57, BZ + 0.25, g);
  [-2.25, -2.1].forEach((x, i) => mesh(lathe([[0, 0], [0.04, 0], [0.08, 0.05], [0.085, 0.06]], 14), i ? celadon : glaze, x, 1.57 + i * 0.06, BZ + 0.25, g));
  [0, 1, 2].forEach(i => box(0.22, 0.03, 0.16, i % 2 ? linen : std(0x8a6a48, { roughness: 1 }), -1.95, 1.585 + i * 0.03, BZ + 0.26, g, 1));

  // the earthen stove (灶) in the back-right corner, an iron wok with a wooden lid, a chimney
  const SX = 2.55, SZ = BZ + 0.5;
  box(1.2, 0.72, 0.75, brick, SX, FL + 0.36, SZ, g, 0.9);
  mesh(new THREE.CircleGeometry(0.22, 18), std(0x0d0a08), SX - 0.2, FL + 0.27, SZ + 0.376, g, { cast: false });   // fire mouth
  const ember = mesh(new THREE.CircleGeometry(0.13, 14), new THREE.MeshBasicMaterial({ color: 0xff6a20 }), SX - 0.2, FL + 0.21, SZ + 0.378, g, { cast: false, receive: false });
  const wok = mesh(new THREE.SphereGeometry(0.3, 18, 8, 0, TAU, Math.PI / 2, Math.PI / 2), iron, SX - 0.15, FL + 0.74, SZ, g);
  wok.scale.y = 0.5;
  mesh(new THREE.SphereGeometry(0.29, 18, 6, 0, TAU, 0, Math.PI / 2), wood, SX - 0.15, FL + 0.72, SZ, g).scale.y = 0.22;   // lid
  cyl(0.11, 0.13, TOP - FL - 0.7 + 1.6, brick, SX + 0.4, FL + 0.72 + (TOP - FL - 0.7 + 1.6) / 2, SZ - 0.15, g, 10);      // chimney through the roof
  boxColliders.push([HX + SX - 0.7, HX + SX + 0.75, HZ + SZ - 0.45, HZ + SZ + 0.45]);
  // firewood beside the stove, a basket of vegetables
  for (let i = 0; i < 7; i++) { const l = cyl(0.04, 0.04, 0.6, twig, SX - 0.85 + (i % 4) * 0.09, FL + 0.05 + Math.floor(i / 4) * 0.08, SZ + 0.15, g, 6); l.rotation.x = Math.PI / 2; }
  mesh(lathe([[0, 0], [0.15, 0.01], [0.2, 0.1], [0.21, 0.18]], 16), std(0xa58a5c, { roughness: 1, side: THREE.DoubleSide }), 1.55, FL, BZ + 0.35, g);
  [[0.05, 0], [-0.06, 0.04], [0.02, -0.07]].forEach(([a, b], i) => mesh(new THREE.SphereGeometry(0.06, 10, 8), std(i ? 0x6f8a3c : 0xa4482c, { roughness: 0.6 }), 1.55 + a, FL + 0.16, BZ + 0.35 + b, g));
  // garlic and dried peppers hanging from the beam near the stove
  [1.85, 2.0, 2.15].forEach((x, i) => {
    cyl(0.004, 0.004, 0.7, twig, x, TOP - 0.35, BZ + 0.3, g, 3);
    for (let k = 0; k < 4; k++) mesh(new THREE.SphereGeometry(0.035, 8, 6), std(i === 1 ? 0x9a2c1c : 0xe6dcc6, { roughness: 0.7 }), x + (k % 2 ? 0.02 : -0.02), TOP - 0.55 - k * 0.09, BZ + 0.3, g, { cast: false });
  });
  // a big water jar with a gourd ladle, by the right wall
  mesh(lathe([[0, 0], [0.2, 0.01], [0.3, 0.2], [0.3, 0.45], [0.26, 0.6], [0.27, 0.62]], 20), clay, w / 2 - 0.45, FL, 0.15, g);
  const jw = mesh(new THREE.CircleGeometry(0.25, 20), std(0x1a2b2a, { roughness: 0.05 }), w / 2 - 0.45, FL + 0.56, 0.15, g, { cast: false });
  jw.rotation.x = -Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.06, 10, 8), std(0xb59a52, { roughness: 0.6 }), w / 2 - 0.4, FL + 0.6, 0.12, g);
  circleColliders.push([HX + w / 2 - 0.45, HZ + 0.15, 0.35]);

  // on the table: a teapot and two cups, an open book
  mesh(lathe([[0, 0], [0.06, 0], [0.08, 0.04], [0.075, 0.08], [0.03, 0.1], [0.012, 0.12]], 16), glaze, tx - 0.25, FL + 0.445, tz - 0.1, g);
  [[-0.05, 0.12], [0.08, 0.15]].forEach(([a, b]) => mesh(lathe([[0, 0], [0.025, 0], [0.035, 0.04]], 12), celadon, tx + a, FL + 0.445, tz + b, g));
  [-1, 1].forEach(sd => { const pg = box(0.15, 0.012, 0.21, paper, tx + 0.25 + sd * 0.075, FL + 0.452, tz - 0.05, g, 1); pg.rotation.z = sd * -0.06; });
  // a stringless qin on a low stand by the back wall (蓄素琴一張，弦徽不具)
  const qin = new THREE.Group();
  box(1.2, 0.05, 0.19, std(0x2b1a12, { roughness: 0.35 }), 0, 0.33, 0, qin, 1);
  [-0.45, 0.45].forEach(x => box(0.06, 0.3, 0.2, darkWood, x, 0.15, 0, qin));
  qin.position.set(0.05, FL, BZ + 0.35);
  g.add(qin);
  // and a wine jar under a red cloth
  mesh(lathe([[0, 0], [0.13, 0.01], [0.2, 0.15], [0.19, 0.3], [0.09, 0.4], [0.08, 0.44]], 18), glaze, 0.95, FL, BZ + 0.35, g);
  mesh(new THREE.SphereGeometry(0.1, 12, 6, 0, TAU, 0, Math.PI / 2), std(0x8e2a1e, { roughness: 1 }), 0.95, FL + 0.43, BZ + 0.35, g).scale.y = 0.5;
  // a hanging scroll above the qin
  const scrollTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512; const x = c.getContext('2d');
    x.fillStyle = '#ece2c8'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = '#221a14'; x.font = '84px "Noto Serif TC", "Songti TC", "PMingLiU", serif'; x.textAlign = 'center';
    ['歸', '去', '來', '兮'].forEach((ch, i) => x.fillText(ch, 64, 110 + i * 105));
    x.fillStyle = '#a3291c'; x.fillRect(84, 462, 22, 22);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  mesh(new THREE.PlaneGeometry(0.42, 1.25), new THREE.MeshStandardMaterial({ map: scrollTex, roughness: 1 }), 0.05, 1.75, BZ + T / 2 + 0.012, g, { cast: false });
  cyl(0.015, 0.015, 0.5, darkWood, 0.05, 1.12, BZ + T / 2 + 0.03, g, 6).rotation.z = Math.PI / 2;

  // the tool wall: the left-hand wall as you come in. A rack board with pegs, straw hat and rain cape,
  // a sickle; the hoe's two pegs are empty. Built facing -z, then turned to face into the room (+x).
  const tw = new THREE.Group();
  tw.position.set(-w / 2 + T / 2 + 0.02, 0, 0.6);
  tw.rotation.y = -Math.PI / 2;
  g.add(tw);
  box(2.0, 0.1, 0.04, darkWood, 0, 1.8, -0.02, tw);                       // the board, above the pegs
  [-0.95, -0.35, 0.35, 0.95].forEach(px => {
    box(0.07, 0.34, 0.035, darkWood, px, 1.62, -0.02, tw);               // a slat down from the board
    const pg = cyl(0.02, 0.02, 0.2, darkWood, px, 1.52, -0.12, tw, 6); pg.rotation.x = Math.PI / 2 - 0.25;   // peg, tipped up
  });
  const hat = mesh(new THREE.ConeGeometry(0.32, 0.16, 20, 1, true), std(0xc8ad74, { map: tex('thatch.jpg'), roughness: 1, side: THREE.DoubleSide }), -0.95, 1.45, -0.14, tw);
  hat.rotation.x = Math.PI / 2.2;
  const cape = mesh(new THREE.ConeGeometry(0.34, 0.9, 14, 1, true, Math.PI * 0.15, Math.PI * 0.7), std(0x8a7448, { map: tex('thatch.jpg'), roughness: 1, side: THREE.DoubleSide }), 0.95, 1.05, -0.14, tw);
  cape.rotation.y = Math.PI;
  const sickle = new THREE.Group();
  cyl(0.014, 0.014, 0.3, wood, 0, 0, 0, sickle, 6);
  mesh(new THREE.TorusGeometry(0.11, 0.012, 4, 14, Math.PI * 0.9), iron, 0.1, 0.15, 0, sickle);
  sickle.position.set(0.68, 1.38, -0.05);
  sickle.rotation.z = 0.3;
  tw.add(sickle);
  mesh(lathe([[0, 0], [0.16, 0.01], [0.22, 0.16], [0.23, 0.24]], 16), std(0xa58a5c, { roughness: 1, side: THREE.DoubleSide }), -0.95, FL, -0.3, tw);
  // a clickable panel over the rack (the hoe's outline is shown by the story when it is time to hang it)
  const rackHit = mesh(new THREE.BoxGeometry(2.0, 1.0, 0.5), new THREE.MeshBasicMaterial({ visible: false }), 0, 1.5, -0.25, tw, { cast: false, receive: false });
  // a broom in the far corner
  const broom = new THREE.Group();
  cyl(0.014, 0.014, 1.2, wood, 0, 0.75, 0, broom, 6);
  cyl(0.02, 0.13, 0.35, straw, 0, 0.17, 0, broom, 10);
  broom.position.set(w / 2 - 0.25, FL, FZ - 0.35); broom.rotation.z = -0.12;
  g.add(broom);
  // a stool by the right-hand window
  cyl(0.17, 0.19, 0.42, wood, 2.2, FL + 0.21, FZ - 0.6, g, 14);
  circleColliders.push([HX + tx, HZ + tz, 0.55]);
  boxColliders.push([HX - 0.65, HX + 1.2, HZ + BZ, HZ + BZ + 0.65]);   // qin and wine jar

  const toWorld = (x, y, z) => new THREE.Vector3(HX + x, y, HZ + z);
  const interior = {
    doors: [doorL, doorR], doorBlock,
    rack: toWorld(-w / 2 + 0.2, 1.55, 0.6), rackStand: toWorld(-w / 2 + 1.05, 0, 0.6), rackHit, ember,
    stool: toWorld(2.2, 0, FZ - 0.6), roomLight, flame,
    bounds: { x0: HX - w / 2, x1: HX + w / 2, z0: HZ + BZ, z1: HZ + FZ },
    floor: FL,
  };

  // props around the hut
  const jarG = new THREE.LatheGeometry([[0, 0], [0.28, 0.02], [0.4, 0.25], [0.42, 0.45], [0.36, 0.62], [0.34, 0.66], [0.3, 0.66], [0.3, 0.6]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
  mesh(jarG, std(0x3a2a20, { roughness: 0.35 }), L.jar[0], 0, L.jar[1], scene);
  const water = mesh(new THREE.CircleGeometry(0.3, 24), std(0x1a2b2a, { roughness: 0.05 }), L.jar[0], 0.58, L.jar[1], scene, { cast: false });
  water.rotation.x = -Math.PI / 2;
  circleColliders.push([L.jar[0], L.jar[1], 0.55]);
  contactShadow(scene, L.jar[0], L.jar[1], 0.75, 0.6);
  // woodpile under the eave
  const logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8), twig, 34);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let row = 0; row < 5; row++) for (let i = 0; i < 8 - row && n < 34; i++) {
    m.compose(new THREE.Vector3(L.woodpile[0] - 0.55 + i * 0.15 + row * 0.075, 0.08 + row * 0.13, L.woodpile[1] + srange(-0.04, 0.04)), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, srange(-0.05, 0.05))), new THREE.Vector3(1, srange(0.9, 1.1), 1));
    logs.setMatrixAt(n++, m);
  }
  logs.count = n;
  logs.castShadow = logs.receiveShadow = true;
  scene.add(logs);
  boxColliders.push([L.woodpile[0] - 0.75, L.woodpile[0] + 0.75, L.woodpile[1] - 0.55, L.woodpile[1] + 0.55]);
  // bench and a basket by the door
  box(1.3, 0.06, 0.32, wood, -2.1, 0.47, -6.55, scene);
  [-0.55, 0.55].forEach(dx => box(0.06, 0.44, 0.26, wood, -2.1 + dx, 0.22, -6.55, scene));
  const basket = new THREE.LatheGeometry([[0, 0], [0.18, 0.01], [0.24, 0.12], [0.26, 0.28], [0.25, 0.3]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
  mesh(basket, std(0xa58a5c, { roughness: 1, side: THREE.DoubleSide }), 1.7, 0, -6.45, scene);
  // gourds hanging under the eave
  [[-2.6, -6.75], [-2.35, -6.78]].forEach(([x, z]) => {
    const gg = new THREE.Group();
    mesh(new THREE.SphereGeometry(0.11, 14, 10), std(0xb59a52, { roughness: 0.6 }), 0, 0, 0, gg);
    mesh(new THREE.SphereGeometry(0.07, 12, 8), std(0xb59a52, { roughness: 0.6 }), 0, 0.14, 0, gg);
    cyl(0.004, 0.004, 0.4, darkWood, 0, 0.4, 0, gg, 3);
    gg.position.set(x, 2.15, z);
    scene.add(gg);
  });
  return { winMat, lamp, interior };
}

/* ================================================================ fence & gate */
function fence(scene) {
  const { x0, x1, z0, z1 } = L.fence, gh = L.gate.half + 0.05;
  const stakes = [];
  const side = (ax, az, bx, bz, skip) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 0.12);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (skip && skip(x, z)) continue;
      stakes.push([x + srange(-0.02, 0.02), z + srange(-0.03, 0.03), srange(1.0, 1.35)]);
    }
  };
  const bg = L.backGate, bgh = bg.half + 0.05;
  side(x0, z1, x1, z1, (x) => Math.abs(x) < gh);
  side(x0, z0, x1, z0, (x) => Math.abs(x - bg.x) < bgh); side(x0, z0, x0, z1); side(x1, z0, x1, z1);
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.03, 1, 5).translate(0, 0.5, 0), twig, stakes.length);
  const m = new THREE.Matrix4();
  stakes.forEach(([x, z, h], i) => { m.compose(new THREE.Vector3(x, -0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(srange(-0.07, 0.07), srange(0, TAU), srange(-0.07, 0.07))), new THREE.Vector3(1, h, 1)); im.setMatrixAt(i, m); });
  im.castShadow = im.receiveShadow = true;
  scene.add(im);
  // woven bands
  const band = (ax, az, bx, bz, y) => {
    const len = Math.hypot(bx - ax, bz - az);
    const c = cyl(0.035, 0.035, len, twig, (ax + bx) / 2, y, (az + bz) / 2, scene, 6);
    c.rotation.z = Math.PI / 2;
    c.rotation.y = -Math.atan2(bz - az, bx - ax);
  };
  [0.32, 0.72].forEach(y => {
    band(x0, z1, -gh, z1, y); band(gh, z1, x1, z1, y);
    band(x0, z0, bg.x - bgh, z0, y); band(bg.x + bgh, z0, x1, z0, y); band(x0, z0, x0, z1, y); band(x1, z0, x1, z1, y);
  });
  // the back gate: just an opening between two posts, with a crossbar, out to the fields
  [-1, 1].forEach(s => cyl(0.06, 0.07, 1.6, darkWood, bg.x + s * (bgh + 0.02), 0.8, z0, scene, 8));
  const bar = cyl(0.04, 0.04, 2 * bgh + 0.3, darkWood, bg.x, 1.58, z0, scene, 6);
  bar.rotation.z = Math.PI / 2;
  // gate posts, a little thatched cap and two leaves
  [-1, 1].forEach(s => cyl(0.07, 0.08, 1.95, darkWood, s * (gh + 0.02), 0.97, z1, scene, 10));
  const beam = cyl(0.05, 0.05, 2 * gh + 0.5, darkWood, 0, 1.92, z1, scene, 8);
  beam.rotation.z = Math.PI / 2;
  const capMat = thatchMat.clone();
  [-1, 1].forEach(s => { const c = box(2 * gh + 0.8, 0.12, 0.55, capMat, 0, 2.08, z1 + s * 0.2, scene, 1); c.rotation.x = s * 0.5; });
  const leaves = [-1, 1].map(s => {
    const hinge = new THREE.Group();
    hinge.position.set(s * (gh - 0.04), 0, z1);
    scene.add(hinge);
    const wdt = gh - 0.06;
    for (let i = 0; i < 7; i++) cyl(0.02, 0.024, 1.15, twig, -s * (0.06 + i * (wdt - 0.08) / 6), 0.62, 0, hinge, 5);
    [0.3, 0.95].forEach(y => { const r = cyl(0.025, 0.025, wdt, darkWood, -s * wdt / 2, y, 0.03, hinge, 6); r.rotation.z = Math.PI / 2; });
    const br = cyl(0.02, 0.02, Math.hypot(wdt, 0.65), darkWood, -s * wdt / 2, 0.62, 0.035, hinge, 5);
    br.rotation.z = s * Math.atan2(wdt, 0.65);
    // an invisible panel so a tap through the gaps still counts as the gate
    mesh(new THREE.BoxGeometry(wdt, 1.2, 0.15), new THREE.MeshBasicMaterial({ visible: false }), -s * wdt / 2, 0.6, 0, hinge, { cast: false, receive: false });
    return hinge;
  });
  return leaves;
}

/* ================================================================ 東籬 bamboo fence and chrysanthemums */
function eastFence(scene) {
  const { x, z0, z1 } = L.eastFence;
  const bam = std(0xb3a66a, { roughness: 0.55 });
  for (let z = z0; z <= z1; z += 0.45) {
    const h = srange(1.05, 1.2);
    cyl(0.03, 0.033, h, bam, x, h / 2, z, scene, 8);
    [0.35, 0.7, 1.0].forEach(y => { if (y < h) { const t = mesh(new THREE.TorusGeometry(0.033, 0.007, 4, 12), bam, x, y, z, scene); t.rotation.x = Math.PI / 2; } });
  }
  [0.4, 0.85].forEach(y => { const r = cyl(0.02, 0.02, z1 - z0, bam, x, y, (z0 + z1) / 2, scene, 6); r.rotation.x = Math.PI / 2; });
  boxColliders.push([x - 0.15, x + 0.15, z0, z1]);
  // chrysanthemums (instanced heads, simple leaves)
  const heads = [], stems = [];
  for (let z = z0 + 0.2; z < z1; z += srange(0.22, 0.34)) {
    const xx = x - srange(0.25, 0.6), h = srange(0.5, 0.75);
    stems.push([xx, z, h]);
    heads.push([xx, h, z]);
  }
  const stemIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.012, 1, 4).translate(0, 0.5, 0), std(0x4c7a3a), stems.length);
  const m = new THREE.Matrix4();
  stems.forEach(([xx, z, h], i) => { m.compose(new THREE.Vector3(xx, 0, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)); stemIM.setMatrixAt(i, m); });
  scene.add(stemIM);
  const headGeo = new THREE.SphereGeometry(0.075, 12, 6, 0, TAU, 0, Math.PI / 2);
  headGeo.scale(1, 0.55, 1);
  const headIM = new THREE.InstancedMesh(headGeo, std(0xffffff, { roughness: 0.7 }), heads.length);
  const c = new THREE.Color();
  heads.forEach(([xx, y, z], i) => {
    m.compose(new THREE.Vector3(xx, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(srange(0.2, 0.6), srange(0, TAU), 0)), new THREE.Vector3(1, 1, 1));
    headIM.setMatrixAt(i, m);
    headIM.setColorAt(i, c.setHSL(srange(0.1, 0.14), 0.85, srange(0.5, 0.6)));
  });
  headIM.castShadow = true;
  scene.add(headIM);
  const leafIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 5).scale(1.4, 0.25, 0.8), std(0x456f35, { roughness: 0.8 }), stems.length * 3);
  let n = 0;
  stems.forEach(([xx, z, h]) => { for (let k = 0; k < 3; k++) { m.compose(new THREE.Vector3(xx + srange(-0.06, 0.06), h * (0.25 + k * 0.22), z + srange(-0.06, 0.06)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, srange(0, TAU), srange(-0.4, 0.4))), new THREE.Vector3(1, 1, 1)); leafIM.setMatrixAt(n++, m); } });
  scene.add(leafIM);
}

/* ================================================================ vegetable bed with weeds */
function vegBed(scene) {
  const { x, z, w, d } = L.veg;
  const geo = new THREE.PlaneGeometry(w, d, 48, 30);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), pz = p.getZ(i);
    const ex = 1 - Math.pow(Math.abs(px) / (w / 2), 6), ez = 1 - Math.pow(Math.abs(pz) / (d / 2), 6);
    p.setY(i, 0.17 * Math.max(0, ex * ez) + (srand() - 0.5) * 0.015);
    uv.setXY(i, px / 1.2, pz / 1.2);
  }
  geo.computeVertexNormals();
  mesh(geo, soilMat, x, 0.01, z, scene, { cast: false });
  // low wattle edging
  const pts = [];
  for (let t = 0; t < 1; t += 0.025) {
    const per = 2 * (w + d), s = t * per;
    let px, pz;
    if (s < w) { px = -w / 2 + s; pz = -d / 2; } else if (s < w + d) { px = w / 2; pz = -d / 2 + (s - w); } else if (s < 2 * w + d) { px = w / 2 - (s - w - d); pz = d / 2; } else { px = -w / 2; pz = d / 2 - (s - 2 * w - d); }
    pts.push([x + px * 1.04, z + pz * 1.06]);
  }
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.022, 0.32, 5).translate(0, 0.16, 0), twig, pts.length);
  const m = new THREE.Matrix4();
  pts.forEach(([px, pz], i) => { m.compose(new THREE.Vector3(px, 0, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(srange(-0.1, 0.1), 0, srange(-0.1, 0.1))), new THREE.Vector3(1, srange(0.8, 1.15), 1)); im.setMatrixAt(i, m); });
  im.castShadow = true;
  scene.add(im);
  // no collider: the edging is low, and you can step in among the plants to reach a weed
  // 菘 (Chinese cabbage) rosettes
  const leafG = new THREE.SphereGeometry(0.11, 10, 6, 0, TAU, 0, Math.PI / 2).scale(0.7, 1.6, 0.35);
  const cab = std(0x7fa45f, { roughness: 0.6, side: THREE.DoubleSide });
  [[-1.1, 0.45], [-0.35, 0.5], [0.4, 0.45], [1.15, 0.5], [-0.7, -0.5], [0.85, -0.45]].forEach(([dx, dz]) => {
    for (let k = 0; k < 7; k++) {
      const a = k * TAU / 7 + srand();
      const l = mesh(leafG, cab, x + dx + Math.cos(a) * 0.05, 0.16, z + dz + Math.sin(a) * 0.05, scene);
      l.rotation.set(0, -a, 0.45);
      l.rotateX(0.2);
    }
  });
  [[-1.1, -0.05], [-0.35, 0.0], [0.4, -0.05], [1.15, 0.0]].forEach(([dx, dz]) => {
    for (let k = 0; k < 7; k++) {
      const a = k * TAU / 7 + srand();
      const l = mesh(leafG, cab, x + dx + Math.cos(a) * 0.05, 0.16, z + dz + Math.sin(a) * 0.05, scene);
      l.rotation.set(0, -a, 0.45);
      l.rotateX(0.2);
    }
  });
}

/* ================================================================ bean field */
function beanField(scene) {
  const { x, z, w, d } = L.beans;
  const ROWS = [-1.125, -0.375, 0.375, 1.125];
  const geo = new THREE.PlaneGeometry(w, d, 80, 90);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), pz = p.getZ(i);
    const ridge = 0.5 + 0.5 * Math.cos((pz - ROWS[0]) / 0.75 * TAU);
    const edge = Math.min(1, (w / 2 - Math.abs(px)) / 0.25, (d / 2 - Math.abs(pz)) / 0.2);
    p.setY(i, (0.03 + 0.1 * ridge) * Math.max(0, edge) + (srand() - 0.5) * 0.012);
    uv.setXY(i, px / 1.1, pz / 1.1);
  }
  geo.computeVertexNormals();
  mesh(geo, soilMat, x, 0.005, z, scene, { cast: false });
  const rowY = 0.13;
  const ridgeH = pz => 0.03 + 0.1 * (0.5 + 0.5 * Math.cos((pz - ROWS[0]) / 0.75 * TAU));
  // 豆苗稀: the beans came up thinly, with long gaps along the rows
  const SEED = [[-1.9, 3], [-0.7, 3], [0.9, 3], [2.1, 3], [-2.1, 2], [1.5, 2], [2.2, 2], [-1.6, 1], [0.2, 1], [1.2, 1], [-2.0, 0], [-0.5, 0], [1.8, 0]];
  const plantLeaf = std(0x5f8f43, { roughness: 0.7, side: THREE.DoubleSide }), stemMat = std(0x5a7f3b);
  const seedHit = new THREE.MeshBasicMaterial({ visible: false });
  const seedlings = SEED.map(([dx, r]) => {
    const pg = new THREE.Group();
    pg.position.set(x + dx, rowY, z + ROWS[r]);
    const hgt = srange(0.2, 0.32);
    cyl(0.007, 0.011, hgt, stemMat, 0, hgt / 2, 0, pg, 5);
    for (let k = 0; k < 3; k++) {
      const sy = hgt * (0.5 + k * 0.25);
      for (let j = 0; j < 3; j++) {
        const a = j * TAU / 3 + k;
        const lf = mesh(new THREE.SphereGeometry(0.045, 8, 5), plantLeaf, Math.cos(a) * 0.045, sy, Math.sin(a) * 0.045, pg);
        lf.scale.set(1.3, 0.18, 0.8); lf.rotation.y = -a;
      }
    }
    // an invisible volume, so a tap on a seedling can be told apart from a tap on a weed
    mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.4, 8), seedHit, 0, 0.2, 0, pg, { cast: false, receive: false }).userData.seedling = true;
    pg.rotation.y = srand() * TAU;
    scene.add(pg);
    return pg;
  });

  // the gaps where beans did not come up: dug, re-sown and covered in the afternoon (補種)
  const holes = [-1.4, -0.4, 0.6].map(dx => new THREE.Vector3(x + dx, rowY, z + ROWS[2]));
  const holeMat = std(0x1f150d, { roughness: 1 });
  const beanMat = std(0xc89a62, { roughness: 0.5 });
  const wetMat = new THREE.MeshStandardMaterial({ color: 0x1a110a, roughness: 0.45, transparent: true, opacity: 0, depthWrite: false });
  const spots = holes.map(h => {
    // a twig marks each gap (shown when it is time to re-sow)
    const stick = cyl(0.006, 0.008, 0.22, darkWood, h.x + 0.1, rowY + 0.09, h.z - 0.08, scene, 4);
    stick.rotation.z = 0.15;
    stick.visible = false;
    const hole = mesh(new THREE.CircleGeometry(0.095, 18), holeMat, h.x, rowY + 0.005, h.z, scene, { cast: false });
    hole.rotation.x = -Math.PI / 2;
    hole.scale.setScalar(0.001);
    const pile = mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, TAU, 0, Math.PI / 2), soilMat, h.x + 0.16, rowY - 0.005, h.z + 0.02, scene, { receive: true });
    pile.scale.set(1.1, 0.001, 0.9);
    const mound = mesh(new THREE.SphereGeometry(0.085, 12, 8, 0, TAU, 0, Math.PI / 2), soilMat, h.x, rowY - 0.01, h.z, scene);
    mound.scale.set(1, 0.001, 1);
    mound.visible = false;
    const wet = mesh(new THREE.CircleGeometry(0.17, 20), wetMat.clone(), h.x, rowY + 0.012, h.z, scene, { cast: false });
    wet.rotation.x = -Math.PI / 2;
    const seeds = [0, 1, 2].map(() => { const b = mesh(new THREE.SphereGeometry(0.016, 10, 8), beanMat, 0, -5, 0, scene); b.scale.set(1.3, 0.9, 0.9); return b; });
    const hit = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.4, 10), new THREE.MeshBasicMaterial({ visible: false }), h.x, rowY, h.z, scene, { cast: false, receive: false });
    hit.userData.hit = true;
    return { pos: h, stick, hole, pile, mound, wet, seeds, hit };
  });

  // 草盛: weeds crowding the seedlings, in the three rows nearest the path (荒穢, pulled from morning to noon)
  const weedTex = tex('weed.png');
  const weedMat = new THREE.MeshStandardMaterial({ map: weedTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
  const weedDepth = cutoutDepth(weedTex, 0.4);
  const WEEDS = [[-2.35, 0.75], [-1.3, 1.125], [0.1, 0.75], [1.5, 1.1], [-0.9, 0.0], [1.0, 0.0], [-0.6, -0.75]];
  const weeds = WEEDS.map(([dx, dz]) => {
    const wg = new THREE.Group();
    wg.position.set(x + dx, ridgeH(dz) + 0.005, z + dz);
    const sc = srange(0.85, 1.1);
    for (let k = 0; k < 3; k++) {
      const c = mesh(new THREE.PlaneGeometry(0.5 * sc, 0.46 * sc), weedMat, 0, 0.22 * sc, 0, wg, { receive: false });
      c.rotation.y = k * Math.PI / 3 + srand();
      c.customDepthMaterial = weedDepth;
    }
    for (let k = 0; k < 7; k++) {
      const len = srange(0.12, 0.24);
      const root = mesh(new THREE.CylinderGeometry(0.002, 0.007, len, 4), rootMat, srange(-0.03, 0.03), -len / 2 + 0.01, srange(-0.03, 0.03), wg, { receive: false });
      root.rotation.set(srange(-0.6, 0.6), 0, srange(-0.6, 0.6));
    }
    const clod = mesh(new THREE.SphereGeometry(0.06, 10, 6), soilMat, 0, -0.01, 0, wg, { receive: false });
    clod.scale.set(1.2, 0.6, 1.2);
    const hit = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.55, 8), new THREE.MeshBasicMaterial({ visible: false }), 0, 0.27, 0, wg, { cast: false, receive: false });
    hit.userData.hit = true;
    wg.userData.y0 = wg.position.y;
    scene.add(wg);
    return wg;
  });

  // a big bamboo basket on the near edge of the field, in the open (not in the tall grass), for the pulled weeds
  const bx = x - w / 2 - 0.55, bz = z + d / 2 - 0.6;   // just off the west end of the field
  const basket = new THREE.Group();
  const weave = std(0xc2a56c, { map: tex('thatch.jpg'), roughness: 1, side: THREE.DoubleSide });
  mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.52, 24, 1, true), weave, 0, 0.26, 0, basket);
  mesh(new THREE.CircleGeometry(0.3, 20), weave, 0, 0.01, 0, basket).rotation.x = -Math.PI / 2;
  const rim = mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 28), std(0x8a6f45), 0, 0.52, 0, basket);
  rim.rotation.x = Math.PI / 2;
  [0.14, 0.36].forEach(y => { const b = mesh(new THREE.TorusGeometry(0.3 + y * 0.23, 0.015, 6, 28), std(0x9a7d4e), 0, y, 0, basket); b.rotation.x = Math.PI / 2; });
  mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 12), new THREE.MeshBasicMaterial({ visible: false }), 0, 0.5, 0, basket, { cast: false, receive: false });
  basket.position.set(bx, 0, bz);
  scene.add(basket);
  circleColliders.push([bx, bz, 0.45]);
  contactShadow(scene, bx, bz, 0.65, 0.6);

  const fieldHit = mesh(new THREE.BoxGeometry(w, 0.3, d), new THREE.MeshBasicMaterial({ visible: false }), x, 0.12, z, scene, { cast: false, receive: false });
  fieldHit.userData.hit = true;
  return { holes, spots, fieldHit, rowY, seedlings, weeds, weedBasket: basket };
}

/* ================================================================ tools */
function tools(scene) {
  // seed pouch on a stump
  const [px, pz] = L.pouch;
  cyl(0.24, 0.27, 0.46, twig, px, 0.23, pz, scene, 14);
  const top = mesh(new THREE.CircleGeometry(0.24, 18), wood, px, 0.461, pz, scene, { cast: false });
  top.rotation.x = -Math.PI / 2;
  circleColliders.push([px, pz, 0.35]);
  contactShadow(scene, px, pz, 0.5, 0.6);
  const pouch = new THREE.Group();
  const cloth = std(0xcdb88e, { roughness: 1 });
  const body = mesh(new THREE.SphereGeometry(0.1, 16, 12), cloth, 0, 0.09, 0, pouch);
  body.scale.set(1, 0.85, 1);
  cyl(0.035, 0.05, 0.06, cloth, 0, 0.19, 0, pouch, 12);
  const tie = mesh(new THREE.TorusGeometry(0.038, 0.008, 6, 14), std(0x7a4a2a), 0, 0.18, 0, pouch);
  tie.rotation.x = Math.PI / 2;
  pouch.position.set(px, 0.462, pz);
  scene.add(pouch);

  // wooden bucket with a gourd ladle (瓢)
  const [bx, bz] = L.bucket;
  const bucket = new THREE.Group();
  const staves = new THREE.CylinderGeometry(0.22, 0.19, 0.42, 22, 1, true);
  mesh(staves, std(0x8b6d4c, { map: tex('wood.jpg'), roughness: 0.85, side: THREE.DoubleSide }), 0, 0.21, 0, bucket);
  mesh(new THREE.CircleGeometry(0.19, 20), wood, 0, 0.02, 0, bucket).rotation.x = -Math.PI / 2;
  [0.08, 0.33].forEach(y => { const r = mesh(new THREE.TorusGeometry(0.215 - (0.33 - y) * 0.05, 0.008, 6, 26), std(0x3d3a36, { roughness: 0.5, metalness: 0.5 }), 0, y, 0, bucket); r.rotation.x = Math.PI / 2; });
  const wtr = mesh(new THREE.CircleGeometry(0.2, 22), std(0x2a4544, { roughness: 0.05 }), 0, 0.34, 0, bucket, { cast: false });
  wtr.rotation.x = -Math.PI / 2;
  bucket.position.set(bx, 0, bz);
  scene.add(bucket);
  circleColliders.push([bx, bz, 0.35]);
  contactShadow(scene, bx, bz, 0.45, 0.6);
  const ladle = new THREE.Group();
  const bowl = mesh(new THREE.SphereGeometry(0.09, 16, 10, 0, TAU, Math.PI / 2, Math.PI / 2), std(0xc9ab62, { roughness: 0.6, side: THREE.DoubleSide }), 0, 0, 0, ladle);
  bowl.rotation.x = 0;
  const neck = cyl(0.018, 0.03, 0.28, std(0xb79a55, { roughness: 0.6 }), 0.18, 0.02, 0, ladle, 8);
  neck.rotation.z = Math.PI / 2 - 0.3;
  // the water it carries, shown once it has been dipped in the bucket
  const scoop = mesh(new THREE.CircleGeometry(0.078, 20), std(0x3d5f5c, { roughness: 0.05 }), 0, -0.02, 0, ladle, { cast: false });
  scoop.rotation.x = -Math.PI / 2;
  scoop.visible = false;
  ladle.userData.scoop = scoop;
  ladle.position.set(bx, 0.43, bz);
  ladle.rotation.y = 0.6;
  scene.add(ladle);

  const [hx, hz] = L.hoe;
  const hoe = new THREE.Group();
  cyl(0.017, 0.021, 1.45, std(0xa1825a, { roughness: 0.8 }), 0, 0.72, 0, hoe, 8);
  const blade = box(0.2, 0.16, 0.014, std(0x5c5852, { roughness: 0.45, metalness: 0.65 }), 0, 1.42, 0.1, hoe, 1);
  blade.rotation.x = 1.2;
  // in the morning it leans against the wall beside the front door, standing on the stone base
  hoe.position.set(hx, 0.34, hz);
  hoe.rotation.set(-0.2, 0.3, 0.0);
  scene.add(hoe);
  return { pouch, bucket, ladle, hoe };
}

/* ================================================================ pond */
function pond(scene) {
  const { x, z, r } = L.pond;
  const nm = tex('ground_n.jpg', { srgb: false, repeat: 3 }).clone();
  const water = mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ color: 0x1d3833, roughness: 0.06, metalness: 0, normalMap: nm, normalScale: new THREE.Vector2(0.12, 0.12), envMapIntensity: 1.2 }), x, 0.03, z, scene, { cast: false });
  water.rotation.x = -Math.PI / 2;
  const rockMat = surface('dirt', { repeat: 1, color: 0x9a948a });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU + srange(-0.1, 0.1), rr = srange(0.16, 0.32);
    const g = new THREE.DodecahedronGeometry(rr, 1);
    const pp = g.attributes.position;
    for (let k = 0; k < pp.count; k++) { const s = 1 + (Math.sin(pp.getX(k) * 9 + pp.getZ(k) * 7) * 0.12); pp.setXYZ(k, pp.getX(k) * s, pp.getY(k) * 0.65, pp.getZ(k) * s); }
    g.computeVertexNormals();
    mesh(g, rockMat, x + Math.cos(a) * (r + 0.05), rr * 0.25, z + Math.sin(a) * (r + 0.05), scene).rotation.y = srand() * 3;
  }
  const pad = std(0x4d7a3b, { roughness: 0.55, side: THREE.DoubleSide });
  [[-0.6, 0.3, 0.24], [0.5, -0.6, 0.2], [-0.2, -0.8, 0.27], [0.7, 0.5, 0.16], [0.1, 0.7, 0.2], [-0.9, -0.3, 0.18]].forEach(([dx, dz, rr], i) => {
    const pm = mesh(new THREE.CircleGeometry(rr, 20, 0.3, TAU - 0.45), pad, x + dx, 0.045, z + dz, scene, { cast: false });
    pm.rotation.set(-Math.PI / 2, 0, i * 1.3);
  });
  circleColliders.push([x, z, r + 0.3]);
  return water;
}

/* ================================================================ */
export function buildStructures(scene) {
  const hutParts = hut(scene);
  const gate = fence(scene);
  eastFence(scene);
  vegBed(scene);
  const field = beanField(scene);
  const t = tools(scene);
  const water = pond(scene);
  return { ...hutParts, gate, ...field, ...t, water };
}
