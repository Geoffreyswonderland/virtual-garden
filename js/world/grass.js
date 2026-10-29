import * as THREE from 'three';
import { srand, srange, fbm, TAU } from './util.js';
import { L, PATHS } from './layout.js?v=18';

/* Real blades rather than picture cards: each instance is a thin curved
   ribbon, shaded dark at the root and light at the tip, swaying in gusts. */

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function pathDist(x, z) {
  let d = 1e9;
  for (const line of PATHS) for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segDist(x, z, ...line[i], ...line[i + 1]));
  return d;
}
const inRect = (x, z, b, pad = 0) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad;

/** 0 = no grass, 1 = full meadow */
export function grassDensity(x, z) {
  const { fence } = L;
  if (z > fence.z1 + 0.3 && (Math.abs(x) < 2.0 || Math.abs(z - 13.4) < 1.3)) return 0;   // lanes outside
  if (pathDist(x, z) < 0.62) return 0;
  const y = L.yard;
  if (((x - 0) / 4.2) ** 2 + ((z - (y.z0 + y.z1) / 2 + 2.2) / 3.6) ** 2 < 1) return 0;
  if (inRect(x, z, L.veg, 0.1)) return 0;
  if (Math.hypot(x - L.pond.x, z - L.pond.z) < L.pond.r + 0.25) return 0;
  if (Math.abs(x - L.hut.x) < L.hut.w / 2 + 0.6 && Math.abs(z - L.hut.z) < L.hut.d / 2 + 0.6) return 0;
  if (Math.abs(z - fence.z1) < 0.18 && Math.abs(x) < 10.2) return 0;
  if (inRect(x, z, L.beans, 0)) return 0.22;  // 草盛豆苗稀: weeds between the rows
  const patch = fbm(x * 0.25 + 7, z * 0.25);
  return 0.55 + patch * 0.6;
}

export function buildGrass(scene, time, count) {
  // one blade: 6 segments, tapering, gently curved
  const SEG = 6, pos = [], uv = [], idx = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, w = 0.034 * (1 - t * 0.92);
    const bend = t * t * 0.18;
    pos.push(-w / 2, t, bend, w / 2, t, bend);
    uv.push(0, t, 1, t);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  geo.setIndex(idx);

  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\nvarying float vH;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vH = uv.y;')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float hh = uv.y * uv.y;
        vec2 ip = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        float gust = smoothstep(0.25, 1.0, sin(uTime * 0.45 + ip.x * 0.09 - ip.y * 0.06) * 0.5 + 0.5);
        float flutter = sin(uTime * 2.1 + ip.x * 1.7 + ip.y * 1.3) * 0.5 + sin(uTime * 3.3 + ip.y * 2.1) * 0.25;
        mvPosition.x += (gust * 0.16 + flutter * 0.05) * hh;
        mvPosition.z += (gust * 0.07 + flutter * 0.03) * hh;
        mvPosition.y -= gust * 0.05 * hh;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = 'varying float vH;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(vec3(0.22, 0.26, 0.12), vec3(1.0), smoothstep(0.0, 0.85, vH));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.03 * vH;`);
  };

  const im = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const X0 = -13, X1 = 13, Z0 = -14.5, Z1 = 17;
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 8) {
    const x = srange(X0, X1), z = srange(Z0, Z1);
    if (srand() > grassDensity(x, z)) continue;
    // taller along fences and in the far corners: 道狹草木長
    const edge = Math.min(Math.abs(x - X0), Math.abs(x - X1), Math.abs(z - Z0)) < 3.5 || Math.abs(Math.abs(x) - 10) < 0.8 ? 1.7 : 1;
    const inField = Math.abs(x - L.beans.x) < L.beans.w / 2 && Math.abs(z - L.beans.z) < L.beans.d / 2;
    const hgt = srange(0.14, 0.36) * edge * (0.7 + fbm(x * 0.4, z * 0.4) * 0.8) * (inField ? 0.55 : 1);
    e.set(srange(-0.12, 0.12), srange(0, TAU), srange(-0.12, 0.12));
    q.setFromEuler(e);
    s.set(srange(0.8, 1.3), hgt, 1);
    p.set(x, 0, z);
    m.compose(p, q, s);
    im.setMatrixAt(n, m);
    const dry = srand() < 0.08;
    c.setHSL(dry ? srange(0.11, 0.15) : srange(0.22, 0.3), dry ? 0.4 : srange(0.42, 0.62), dry ? srange(0.42, 0.52) : srange(0.26, 0.4));
    im.setColorAt(n, c);
    n++;
  }
  im.count = n;
  im.receiveShadow = true;
  im.frustumCulled = false;
  scene.add(im);

  // wildflowers
  const fl = buildFlowers(time);
  scene.add(fl);
  return im;
}

function buildFlowers(time) {
  const stem = new THREE.CylinderGeometry(0.004, 0.005, 1, 4);
  stem.translate(0, 0.5, 0);
  const head = new THREE.IcosahedronGeometry(0.035, 0);
  head.scale(1, 0.45, 1);
  head.translate(0, 1.0, 0);
  const colors = (g, r, gg, b) => { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(r, gg, b); g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); };
  colors(stem, 0.25, 0.4, 0.15);
  colors(head, 1, 1, 1);
  const geo = mergeTwo(stem, head);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const N = 1400, im = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const palette = [[0.13, 0.85, 0.62], [0.0, 0.0, 0.95], [0.75, 0.45, 0.7], [0.58, 0.5, 0.72], [0.1, 0.9, 0.55]];
  let n = 0;
  while (n < N) {
    const x = srange(-12, 12), z = srange(-13.5, 16);
    if (grassDensity(x, z) < 0.5 || srand() > fbm(x * 0.3 + 2, z * 0.3) * 1.3) continue;
    const h = srange(0.25, 0.45);
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(srange(-0.2, 0.2), srange(0, TAU), srange(-0.2, 0.2))), new THREE.Vector3(1, h, 1));
    im.setMatrixAt(n, m);
    const pc = palette[Math.floor(srand() * palette.length)];
    im.setColorAt(n, c.setHSL(pc[0], pc[1], pc[2]));
    n++;
  }
  im.receiveShadow = true;
  return im;
}

function mergeTwo(a, b) {
  a = a.index ? a.toNonIndexed() : a;
  b = b.index ? b.toNonIndexed() : b;
  const g = new THREE.BufferGeometry();
  ['position', 'normal', 'color'].forEach(k => {
    const A = a.attributes[k].array, B = b.attributes[k].array, out = new Float32Array(A.length + B.length);
    out.set(A); out.set(B, A.length);
    g.setAttribute(k, new THREE.BufferAttribute(out, 3));
  });
  return g;
}
