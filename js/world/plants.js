import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { srand, srange, TAU, tex, surface, std, cutoutDepth, contactShadow, softDot } from './util.js';
import { L } from './layout.js?v=39';

/* Trees and plants. Branches are tapered tubes grown recursively; crowns
   are leaf cards whose normals point out from the crown centre so the
   canopy shades as one soft volume, with a little glow when backlit. */

export const FOLIAGE = { sunView: { value: new THREE.Vector3(0, 1, 0) }, uTime: null, night: { value: 0 } };
const colliders = [];
export const plantColliders = colliders;

/* ---------- tapered tube along a curve ---------- */
function taperTube(curve, segs, radial, r0, r1, vScale = 1.4) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const len = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t), N = frames.normals[i], B = frames.binormals[i];
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, cx = Math.cos(a), sx = Math.sin(a);
      const n = new THREE.Vector3().addScaledVector(N, cx).addScaledVector(B, sx).normalize();
      const knob = 1 + (Math.sin(a * 3 + t * 9) * 0.04);
      pos.push(p.x + n.x * r * knob, p.y + n.y * r * knob, p.z + n.z * r * knob);
      nor.push(n.x, n.y, n.z);
      uv.push(j / radial * Math.max(1, Math.round(r0 * 12)), t * len / vScale);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** grow a branch system; returns {geos, tips:[{p, dir, depth}]} */
function grow(opts) {
  const geos = [], tips = [], limbs = [];
  function branch(start, dir, len, r, depth) {
    const pts = [start.clone()];
    let d = dir.clone(), p = start.clone();
    const n = 4;
    for (let i = 1; i <= n; i++) {
      d.add(new THREE.Vector3(srange(-1, 1), srange(-1, 1), srange(-1, 1)).multiplyScalar(opts.wobble));
      d.y += opts.gravity;
      d.normalize();
      p = p.clone().addScaledVector(d, len / n);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const rEnd = r * opts.taper;
    geos.push(taperTube(curve, depth === 0 ? 10 : 6, depth === 0 ? 10 : depth === 1 ? 7 : 5, r, rEnd));
    limbs.push({ curve, depth, len });
    if (depth >= opts.depth) { tips.push({ p: p.clone(), dir: d.clone(), depth }); return; }
    const kids = opts.kids[depth];
    for (let i = 0; i < kids; i++) {
      const t = opts.from + (1 - opts.from) * ((i + srand() * 0.8) / kids);
      const at = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const side = new THREE.Vector3(Math.cos(i * 2.4 + srand()), 0, Math.sin(i * 2.4 + srand())).normalize();
      const nd = tan.clone().multiplyScalar(1 - opts.spread).addScaledVector(side, opts.spread).add(new THREE.Vector3(0, opts.lift, 0)).normalize();
      branch(at, nd, len * opts.shrink * srange(0.75, 1.1), r * opts.taper * srange(0.85, 1) * (1 - t * 0.35), depth + 1);
    }
    if (depth > 0) tips.push({ p: p.clone(), dir: d.clone(), depth });
  }
  branch(new THREE.Vector3(0, -0.15, 0), opts.dir || new THREE.Vector3(0, 1, 0), opts.len, opts.r, 0);
  return { geo: mergeGeometries(geos), tips, limbs };
}

/* ---------- foliage material: spherical normals + backlight glow + wind ---------- */
function foliageMaterial(map, { alphaTest = 0.45, tint = 0xffffff, hang = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, color: tint });
  mat.onBeforeCompile = function (sh) {
    sh.uniforms.sunView = FOLIAGE.sunView;
    sh.uniforms.uTime = FOLIAGE.uTime;
    sh.uniforms.night = FOLIAGE.night;
    sh.vertexShader = 'uniform float uTime; uniform vec3 crown;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
        vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        #ifdef USE_INSTANCING
          vec3 ipos = instanceMatrix[3].xyz;
          objectNormal = normalize(ipos - crownC + vec3(position.x, position.y, 0.0) * 0.6);
          objectNormal = (inverse(mat3(instanceMatrix)) * objectNormal);
        #endif
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = dot(instanceMatrix[3].xyz, vec3(0.7, 0.3, 0.5));
          ${hang
            ? 'float k = pow(clamp(1.0 - uv.y, 0.0, 1.0), 1.6); transformed.x += (sin(uTime * 1.1 + ph) * 0.18 + sin(uTime * 2.3 + ph * 2.0) * 0.05) * k; transformed.z += cos(uTime * 0.9 + ph) * 0.12 * k;'
            : 'transformed += vec3(sin(uTime * 1.3 + ph), sin(uTime * 1.7 + ph * 1.3) * 0.5, cos(uTime * 1.1 + ph)) * 0.025;'}
        #endif`);
    sh.vertexShader = 'uniform vec3 crownC;\n' + sh.vertexShader;
    sh.uniforms.crownC = { value: this.userData.crown || new THREE.Vector3() };
    sh.fragmentShader = 'uniform vec3 sunView; uniform float night;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float back = pow(max(dot(normalize(-vViewPosition), sunView), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.95, 0.7) * back * 0.55 * (1.0 - night);`);
  };
  mat.customProgramCacheKey = () => (hang ? 'hang' : 'leaf');
  return mat;
}
// the crown centre differs per tree, so each tree gets its own material instance sharing one program
function crownMat(base, center) {
  const m = base.clone();
  m.userData.crown = center;
  m.onBeforeCompile = base.onBeforeCompile.bind(m);
  m.customProgramCacheKey = base.customProgramCacheKey;
  return m;
}

const barkMat = surface('bark', { repeat: 1, normalScale: 1.2 });
const leafTex = tex('leaves_elm.png');
const willowTex = tex('willow_strand.png');
const blossomTex = tex('blossom.png');
const leafBase = foliageMaterial(leafTex);
const willowLeafBase = foliageMaterial(leafTex, { tint: 0xd8f0a8 });
const strandBase = foliageMaterial(willowTex, { alphaTest: 0.35, hang: true });
const blossomBase = foliageMaterial(blossomTex, { alphaTest: 0.4 });
const leafDepth = cutoutDepth(leafTex), strandDepth = cutoutDepth(willowTex, 0.35), blossomDepth = cutoutDepth(blossomTex, 0.4);

function cards(parent, base, depthMat, center, items, size, colorFn) {
  const geo = new THREE.PlaneGeometry(size, size);
  const im = new THREE.InstancedMesh(geo, crownMat(base, center), items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  items.forEach((p, i) => {
    q.setFromEuler(new THREE.Euler(srange(0, TAU), srange(0, TAU), srange(0, TAU)));
    const s = srange(0.75, 1.25);
    m.compose(p, q, new THREE.Vector3(s, s, s));
    im.setMatrixAt(i, m);
    im.setColorAt(i, colorFn ? colorFn(p, c) : c.setRGB(1, 1, 1));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.customDepthMaterial = depthMat;
  parent.add(im);
  return im;
}

/* ---------- species ---------- */
function elm(x, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = srange(0, TAU);
  const { geo, tips } = grow({ len: 3.6 * s, r: 0.24 * s, depth: 3, kids: [5, 3, 2], from: 0.45, spread: 0.6, lift: 0.25, shrink: 0.55, taper: 0.55, wobble: 0.18, gravity: 0.02 });
  const trunk = new THREE.Mesh(geo, barkMat);
  trunk.castShadow = trunk.receiveShadow = true;
  g.add(trunk);
  const center = new THREE.Vector3(0, 4.4 * s, 0);
  const pts = [];
  tips.forEach(t => { for (let i = 0; i < 4; i++) pts.push(t.p.clone().add(new THREE.Vector3(srange(-0.7, 0.7), srange(-0.4, 0.6), srange(-0.7, 0.7)).multiplyScalar(s))); });
  for (let i = 0; i < 70; i++) { const u = srand() * TAU, v = Math.acos(srange(-0.3, 1)), r = Math.cbrt(srand()) * 2.2 * s; pts.push(center.clone().add(new THREE.Vector3(Math.sin(v) * Math.cos(u) * r * 1.2, Math.cos(v) * r * 0.75, Math.sin(v) * Math.sin(u) * r * 1.2))); }
  cards(g, leafBase, leafDepth, center, pts, 1.25 * s, (p, c) => c.setHSL(0.24 + srange(-0.03, 0.03), 0.45, 0.45 + (p.y - center.y) / (8 * s)));
  scene_.add(g);
  colliders.push([x, z, 0.4 * s]);
  contactShadow(scene_, x, z, 2.6 * s, 0.45);
}

function willow(x, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = srange(0, TAU);
  const lean = new THREE.Vector3(srange(-0.25, 0.25), 1, srange(-0.25, 0.25)).normalize();
  const { geo, limbs } = grow({ dir: lean, len: 2.6 * s, r: 0.3 * s, depth: 2, kids: [6, 3], from: 0.7, spread: 0.65, lift: 0.55, shrink: 0.85, taper: 0.5, wobble: 0.22, gravity: -0.05 });
  const trunk = new THREE.Mesh(geo, barkMat);
  trunk.castShadow = trunk.receiveShadow = true;
  g.add(trunk);
  // hanging strands from points along the upper limbs
  const geoS = new THREE.PlaneGeometry(0.26, 1);
  geoS.translate(0, -0.5, 0);
  const strandMat = crownMat(strandBase, new THREE.Vector3(0, 3 * s, 0));
  const N = Math.round(210 * s);
  const im = new THREE.InstancedMesh(geoS, strandMat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const upper = limbs.filter(l => l.depth > 0);
  const tops = [];
  for (let i = 0; i < N; i++) {
    const l = upper[i % upper.length];
    const p = l.curve.getPointAt(srange(0.35, 1));
    const len = srange(1.2, 2.8) * s * Math.min(1, Math.max(0.4, (p.y - 1.4) / (2.6 * s)));
    q.setFromEuler(new THREE.Euler(srange(-0.08, 0.08), srange(0, TAU), srange(-0.08, 0.08)));
    m.compose(p, q, new THREE.Vector3(srange(0.8, 1.3), len, 1));
    im.setMatrixAt(i, m);
    im.setColorAt(i, c.setHSL(0.21 + srange(-0.02, 0.03), 0.42, srange(0.36, 0.52)));
    tops.push(p);
  }
  im.castShadow = true;
  im.receiveShadow = true;
  im.customDepthMaterial = strandDepth;
  g.add(im);
  cards(g, willowLeafBase, leafDepth, new THREE.Vector3(0, 3.6 * s, 0), tops.filter((_, i) => i % 6 === 0).map(p => p.clone().add(new THREE.Vector3(0, 0.15, 0))), 0.9 * s);
  scene_.add(g);
  colliders.push([x, z, 0.45 * s]);
  contactShadow(scene_, x, z, 2.8 * s, 0.4);
}

const petals = [];
function blossomTree(x, z, kind) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = srange(0, TAU);
  const { geo, tips } = grow({ len: 1.5, r: 0.13, depth: 3, kids: [4, 3, 2], from: 0.55, spread: 0.75, lift: 0.3, shrink: 0.68, taper: 0.55, wobble: 0.3, gravity: -0.01 });
  const trunk = new THREE.Mesh(geo, barkMat);
  trunk.castShadow = trunk.receiveShadow = true;
  g.add(trunk);
  const center = new THREE.Vector3(0, 2.3, 0);
  const pts = [];
  tips.forEach(t => { for (let i = 0; i < 3; i++) pts.push(t.p.clone().add(new THREE.Vector3(srange(-0.3, 0.3), srange(-0.2, 0.25), srange(-0.3, 0.3)))); });
  cards(g, blossomBase, blossomDepth, center, pts, 0.58, (p, c) => (kind === 'plum' ? c.setRGB(1.08, 1.06, 1.06) : c.setRGB(1, 0.86, 0.9)));
  scene_.add(g);
  colliders.push([x, z, 0.3]);
  contactShadow(scene_, x, z, 2.0, 0.4);
  petals.push({ x, z, kind });
}

function bush(x, z, s = 1, hue = 0.25) {
  const center = new THREE.Vector3(x, 0.45 * s, z);
  const pts = [];
  for (let i = 0; i < 26; i++) { const u = srand() * TAU, r = Math.sqrt(srand()) * 0.75 * s; pts.push(new THREE.Vector3(x + Math.cos(u) * r, srange(0.15, 0.85) * s, z + Math.sin(u) * r * 0.8)); }
  cards(scene_, leafBase, leafDepth, center, pts, 0.7 * s, (p, c) => c.setHSL(hue + srange(-0.03, 0.03), 0.45, 0.32 + p.y * 0.15));
}

function reeds() {
  const geo = new THREE.PlaneGeometry(0.03, 1, 1, 4);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a9a52, side: THREE.DoubleSide, roughness: 0.8 });
  const N = 420, im = new THREE.InstancedMesh(geo, mat, N), m = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const a = srand() * TAU, r = L.pond.r + srange(-0.25, 0.35);
    if (Math.sin(a) > 0.55) { i--; continue; }  // keep the side facing the path open
    m.compose(new THREE.Vector3(L.pond.x + Math.cos(a) * r, 0, L.pond.z + Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(srange(-0.15, 0.15), srange(0, TAU), srange(-0.15, 0.15))), new THREE.Vector3(1, srange(0.7, 1.7), 1));
    im.setMatrixAt(i, m);
    im.setColorAt(i, c.setHSL(srange(0.16, 0.22), 0.4, srange(0.35, 0.55)));
  }
  im.castShadow = true;
  im.receiveShadow = true;
  scene_.add(im);
}

/* ---------- falling petals near the blossom trees ---------- */
let petalPts = null;
function buildPetals() {
  const N = 90, pos = new Float32Array(N * 3), seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) { const t = petals[i % petals.length]; pos[i * 3] = t.x + srange(-1.5, 1.5); pos[i * 3 + 1] = srange(0, 2.8); pos[i * 3 + 2] = t.z + srange(-1.5, 1.5); seeds[i] = srand() * 100; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  petalPts = new THREE.Points(g, new THREE.PointsMaterial({ map: softDot, color: 0xffd6e2, size: 0.05, transparent: true, depthWrite: false }));
  petalPts.userData.seeds = seeds;
  scene_.add(petalPts);
}

let scene_ = null;
export function buildPlants(scene, time) {
  scene_ = scene;
  FOLIAGE.uTime = time;
  L.willows.forEach(([x, z]) => willow(x, z, srange(0.95, 1.1)));
  L.elms.forEach(([x, z]) => elm(x, z, srange(0.95, 1.2)));
  L.laneTrees.forEach(([x, z]) => elm(x, z, 1.1));
  L.peaches.forEach(([x, z, k]) => blossomTree(x, z, k));
  // shrubs along the fence and around the hut, to soften the edges
  [[-9.2, 8.8], [-9.3, 4.5], [-9.1, 0.5], [9.2, 8.6], [9.1, 5.2], [-9.2, -6.5], [-9, -10.8], [9.1, -11], [-3.9, -10.6], [3.9, -10.4], [-1.9, 9.2], [1.9, 9.25], [-6.5, 9.2], [6.2, 9.3], [-5.2, -1.6], [-7.6, -5.3], [6.3, -3.3]].forEach(([x, z]) => bush(x, z, srange(0.9, 1.4), srange(0.22, 0.28)));
  // shrubs and trees beyond the fence fill the middle distance
  for (let i = 0; i < 26; i++) {
    const side = i % 3, x = side === 0 ? srange(-30, -12) : side === 1 ? srange(12, 30) : srange(-25, 25), z = side === 2 ? srange(-30, -15) : srange(-28, 20);
    if (Math.abs(x) < 6 && z > 9) continue;
    if (x > -1 && x < 13 && z > -27 && z < -10) continue;   // keep the bean field and its footpath open
    elm(x, z, srange(0.9, 1.5));
  }
  reeds();
  buildPetals();
}

export function updatePlants(dt, t) {
  if (!petalPts) return;
  const p = petalPts.geometry.attributes.position.array, s = petalPts.userData.seeds;
  for (let i = 0; i < s.length; i++) {
    const j = i * 3;
    p[j] += (Math.sin(t * 0.8 + s[i]) * 0.25 + 0.15) * dt;
    p[j + 1] -= (0.25 + Math.sin(t * 2 + s[i]) * 0.08) * dt;
    p[j + 2] += Math.cos(t * 0.6 + s[i]) * 0.2 * dt;
    if (p[j + 1] < 0.02) { const tr = petals[i % petals.length]; p[j] = tr.x + srange(-1.3, 1.3); p[j + 1] = srange(2, 2.9); p[j + 2] = tr.z + srange(-1.3, 1.3); }
  }
  petalPts.geometry.attributes.position.needsUpdate = true;
}
