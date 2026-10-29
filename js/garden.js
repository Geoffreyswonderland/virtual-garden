import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* =====================================================================
   東籬小園: a late-afternoon garden. Built procedurally as a stand-in;
   the research version will use real panoramas and field recordings.
   Techniques: ACES tone mapping, a shader sky that also lights the scene
   (PMREM environment), physically based materials, canvas-painted
   textures, leaf-card tree crowns, instanced swaying grass, noise
   mountains with aerial perspective, and a light film grade.
   ===================================================================== */

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
let seed = 7;
const srand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const srange = (a, b) => a + srand() * (b - a);

// value noise
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
const ridged = (x, y) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 5; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)); f *= 2.1; a *= 0.5; } return s; };

export function createGarden(canvas) {
  /* ---------- renderer ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0.86, 0.82, 0.72);
  scene.fog = new THREE.FogExp2(HORIZON.clone(), 0.022);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 700);
  camera.position.set(0, 1.35, 3.6);
  const look = { yaw: 0, pitch: -0.36 };
  const LIMIT = { yawMin: -1.3, yawMax: 1.3, pitchMin: -0.95, pitchMax: 0.25 };
  const applyLook = () => camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  applyLook();

  const time = { value: 0 };

  /* ---------- sky: horizon-to-zenith gradient, sun glow, drifting clouds ---------- */
  const sunDir = new THREE.Vector3(-0.55, 0.32, -0.78).normalize();
  const NOISE = `
    float qh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float qn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(qh(i),qh(i+vec2(1,0)),f.x),mix(qh(i+vec2(0,1)),qh(i+1.0),f.x),f.y);}
    float qfbm(vec2 p){return qn(p)*.5+qn(p*2.03)*.25+qn(p*4.07)*.13+qn(p*8.1)*.07;}`;
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, hz: { value: HORIZON }, zn: { value: new THREE.Color(0.34, 0.5, 0.72) }, sunCol: { value: new THREE.Color(1.0, 0.78, 0.5) }, uTime: time },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 sunDir, hz, zn, sunCol; uniform float uTime; varying vec3 vDir; ${NOISE}
      void main(){
        vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(hz, zn, pow(h, 0.5));
        if (d.y < 0.0) col = hz * 0.92;
        float s = max(dot(d, sunDir), 0.0);
        col += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 28.0) * 0.45 + pow(s, 5.0) * 0.18);
        vec2 p = d.xz / (d.y + 0.16) * 1.3 + vec2(uTime * 0.006, uTime * 0.002);
        float c = smoothstep(0.52, 0.82, qfbm(p * 1.2));
        vec3 cloud = mix(vec3(0.95, 0.92, 0.88), sunCol * 1.15, pow(s, 6.0) * 0.6);
        col = mix(col, cloud, c * 0.6 * smoothstep(0.02, 0.22, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), skyMat));
  // the same sky lights every physically based material
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;

  /* ---------- lights ---------- */
  scene.add(new THREE.HemisphereLight(0xdde6f0, 0x5d5a3c, 0.45));
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.8);
  sun.position.copy(sunDir).multiplyScalar(20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  scene.add(sun);

  /* ---------- helpers ---------- */
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o });
  function add(geo, m, x = 0, y = 0, z = 0, parent = scene, cast = true, receive = true) {
    const mesh = new THREE.Mesh(geo, typeof m === 'number' ? std(m) : m);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  }
  function canvasTex(size, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
    return t;
  }
  function jitter(geo, amt) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (vnoise(p.getX(i) * 3 + 5, p.getY(i) * 3 + p.getZ(i) * 2) - 0.5) * amt;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    return geo;
  }

  /* ---------- ground with patchy grass colour and gentle undulation ---------- */
  const groundGeo = new THREE.PlaneGeometry(140, 140, 200, 200);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const p = groundGeo.attributes.position, col = new Float32Array(p.count * 3);
    const a = new THREE.Color(0x5f7f3f), b = new THREE.Color(0x9aae5e), dry = new THREE.Color(0xb3a874), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z - 0.5);
      const n = fbm(x * 0.25, z * 0.25), m = fbm(x * 1.3 + 9, z * 1.3);
      p.setY(i, r < 5 ? 0 : (fbm(x * 0.08, z * 0.08) - 0.45) * Math.min(1, (r - 5) / 10) * 2.2);
      c.copy(a).lerp(b, THREE.MathUtils.smoothstep(n, 0.3, 0.7)).lerp(dry, Math.max(0, m - 0.62) * 1.4);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    groundGeo.computeVertexNormals();
  }
  add(groundGeo, std(0xffffff, { vertexColors: true, roughness: 1 }), 0, 0, 0, scene, false, true);

  /* ---------- instanced grass tufts that sway ---------- */
  const grassTex = canvasTex(128, (x, s) => {
    for (let i = 0; i < 34; i++) {
      const bx = rand(14, s - 14), h = rand(s * 0.45, s * 0.95), lean = rand(-18, 18);
      x.strokeStyle = `hsl(${rand(72, 98)},${rand(30, 50)}%,${rand(24, 46)}%)`;
      x.lineWidth = rand(2, 4);
      x.lineCap = 'round';
      x.beginPath(); x.moveTo(bx, s); x.quadraticCurveTo(bx + lean * 0.3, s - h * 0.6, bx + lean, s - h); x.stroke();
    }
  });
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
  grassMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        float k = position.y * 0.5;
        transformed.x += sin(uTime * 1.5 + ip.x * 0.7 + ip.z * 0.4) * k;
        transformed.z += cos(uTime * 1.2 + ip.x * 0.3) * k * 0.6;
      #endif`);
  };
  const grassGeo = new THREE.PlaneGeometry(0.55, 0.4);
  grassGeo.translate(0, 0.2, 0);
  const blocked = (x, z) =>
    (Math.abs(x + 0.2) < 0.75 && z > -4 && z < 3.3) ||
    Math.hypot(x + 3.4, z + 1.8) < 2.2 ||
    (Math.abs(x) < 1.7 && z > 1.0 && z < 2.5) ||
    (x > 1.2 && x < 3.4 && z > -3.2 && z < 1.2);
  [0, Math.PI / 2].forEach(rot => {
    const N = 1400, im = new THREE.InstancedMesh(grassGeo, grassMat, N), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let n = 0;
    while (n < N) {
      const r = Math.sqrt(srand()) * 16 + 0.8, a = srand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r - 2;
      if (blocked(x, z) || z > 3.2) continue;
      e.set(0, rot + srange(0, TAU), 0);
      q.setFromEuler(e);
      const s = srange(0.6, 1.5);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * srange(0.8, 1.3), s));
      im.setMatrixAt(n++, m);
    }
    im.receiveShadow = true;
    scene.add(im);
  });

  /* ---------- trees with leaf-card crowns ---------- */
  const leafTex = canvasTex(256, (x, s) => {
    for (let i = 0; i < 46; i++) {
      const px = rand(28, s - 28), py = rand(28, s - 28), r = rand(10, 22);
      x.save(); x.translate(px, py); x.rotate(rand(0, TAU));
      x.fillStyle = `hsl(${rand(80, 110)},${rand(30, 50)}%,${rand(22, 42)}%)`;
      x.beginPath(); x.ellipse(0, 0, r, r * 0.45, 0, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(20,30,10,.35)'; x.lineWidth = 1.1;
      x.beginPath(); x.moveTo(-r, 0); x.lineTo(r, 0); x.stroke();
      x.restore();
    }
  });
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  const barkMat = std(0x5e4936, { roughness: 1 });
  const canopies = [];
  function tree(x, z, s, hue = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const trunkH = 1.9 * s;
    add(new THREE.CylinderGeometry(0.07 * s, 0.16 * s, trunkH, 8), barkMat, 0, trunkH / 2, 0, g);
    [[0.6, 0.5, 0.9], [-0.7, 0.62, 0.75], [0.2, 0.75, -0.8]].forEach(([dx, dy, dz]) => {
      const br = add(new THREE.CylinderGeometry(0.025 * s, 0.05 * s, 0.9 * s, 6), barkMat, dx * 0.3 * s, trunkH * dy + 0.25 * s, dz * 0.25 * s, g);
      br.rotation.set(dz * 0.7, 0, -dx * 0.8);
    });
    const crown = new THREE.Group();
    crown.position.y = trunkH + 0.35 * s;
    add(new THREE.IcosahedronGeometry(0.8 * s, 1), std(0x2f4a24, { roughness: 1 }), 0, -0.1 * s, 0, crown);
    const N = 190, im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.75 * s, 0.75 * s), leafMat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const u = srand() * TAU, v = Math.acos(srange(-0.6, 1)), r = Math.cbrt(srand()) * 1.15 * s;
      const p = new THREE.Vector3(Math.sin(v) * Math.cos(u) * r * 1.15, Math.cos(v) * r * 0.85, Math.sin(v) * Math.sin(u) * r * 1.15);
      q.setFromEuler(new THREE.Euler(srange(0, TAU), srange(0, TAU), srange(0, TAU)));
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
      const light = 0.75 + 0.45 * (p.y / (1.2 * s) + 0.5) * 0.6;
      im.setColorAt(i, c.setHSL(0.24 + hue + srange(-0.03, 0.03), 0.45, 0.5 * light));
    }
    im.castShadow = true;
    im.receiveShadow = true;
    crown.add(im);
    g.add(crown);
    scene.add(g);
    canopies.push({ crown, phase: srange(0, 6) });
  }
  tree(-2.9, -4.4, 1.35, 0.01); tree(-5.8, 0.4, 1.1, -0.02); tree(3.9, -5.8, 1.5, 0); tree(-0.6, -8.2, 1.7, 0.02);
  tree(6.8, -2.0, 1.2, -0.01); tree(-7.5, -5.5, 1.6, 0.015); tree(-10, -1, 1.3, 0); tree(9.5, -8, 1.8, 0.02);

  /* ---------- far hills and the southern mountain (南山) ---------- */
  function range(x, z, w, d, h, color, scale) {
    const geo = new THREE.PlaneGeometry(w, d, 140, 50);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), base = new THREE.Color(color), c = new THREE.Color();
    const off = srange(0, 50);
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i);
      const env = Math.max(0, 1 - Math.pow(Math.abs(pz) / (d / 2), 2)) * Math.max(0, 1 - Math.pow(Math.abs(px) / (w / 2), 4));
      const n = ridged(px / scale + off, pz / scale + off * 0.7);
      const y = h * env * (0.25 + n * n * 1.1);
      p.setY(i, y - 0.5);
      c.copy(base).multiplyScalar(0.72 + 0.5 * (y / h));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    add(geo, std(0xffffff, { vertexColors: true, roughness: 1 }), x, 0, z, scene, false, false);
  }
  range(-4, -26, 70, 14, 5, 0x55703f, 9);
  range(10, -48, 80, 22, 17, 0x6e8590, 14);
  range(-22, -58, 70, 20, 13, 0x7c919b, 12);
  const MOUNTAIN = new THREE.Vector3(10, 12, -48);

  /* ---------- stepping-stone path and pond ---------- */
  const stoneMat = std(0xb3ad9d, { roughness: 0.95 });
  for (let i = 0; i < 8; i++) {
    const st = add(jitter(new THREE.CylinderGeometry(0.34, 0.38, 0.08, 10), 0.25), stoneMat, Math.sin(i * 1.3) * 0.22 - 0.2, 0.03, 2.75 - i * 0.78);
    st.rotation.y = i * 1.7;
  }
  const pond = add(new THREE.CircleGeometry(1.75, 48), std(0x2e4c4a, { roughness: 0.04, metalness: 0, envMapIntensity: 1.3 }), -3.4, 0.02, -1.8, scene, false, true);
  pond.rotation.x = -Math.PI / 2;
  const rockMat = std(0x8f8a7c, { roughness: 0.95 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + srange(-0.1, 0.1), r = srange(0.15, 0.3);
    const rk = add(jitter(new THREE.DodecahedronGeometry(r, 1), 0.5), rockMat, -3.4 + Math.cos(a) * 1.85, r * 0.45, -1.8 + Math.sin(a) * 1.85);
    rk.rotation.set(srange(0, 3), srange(0, 3), 0);
  }
  const padMat = std(0x4f7a3a, { roughness: 0.6, side: THREE.DoubleSide });
  [[-3.9, -1.4, 0.22], [-2.9, -2.3, 0.18], [-3.6, -2.5, 0.25], [-2.8, -1.2, 0.15]].forEach(([x, z, r], i) => {
    const pad = add(new THREE.CircleGeometry(r, 20, 0.3, TAU - 0.4), padMat, x, 0.03, z, scene, false, true);
    pad.rotation.set(-Math.PI / 2, 0, i);
  });
  const lotus = new THREE.Group();
  lotus.position.set(-3.6, 0.04, -2.5);
  for (let i = 0; i < 9; i++) {
    const pt = add(new THREE.SphereGeometry(0.05, 8, 6), std(0xf0b6c2, { roughness: 0.6 }), 0, 0.05, 0, lotus, true, false);
    const a = (i / 9) * TAU;
    pt.scale.set(0.55, 1.2, 0.35);
    pt.position.set(Math.cos(a) * 0.035, 0.06, Math.sin(a) * 0.035);
    pt.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
  }
  scene.add(lotus);

  /* ---------- bamboo fence on the east (東籬) ---------- */
  const fence = new THREE.Group();
  fence.position.set(2.2, 0, 0.6);
  fence.rotation.y = -0.38;
  scene.add(fence);
  for (let i = 0; i < 10; i++) {
    const h = srange(0.95, 1.1), bm = std(new THREE.Color().setHSL(0.11, 0.38, srange(0.42, 0.52)), { roughness: 0.6 });
    add(new THREE.CylinderGeometry(0.028, 0.032, h, 8), bm, 0, h / 2, -i * 0.42, fence);
    [0.3, 0.62, 0.9].forEach(y => { if (y < h) add(new THREE.TorusGeometry(0.031, 0.006, 4, 10), bm, 0, y, -i * 0.42, fence).rotation.x = Math.PI / 2; });
  }
  [0.35, 0.78].forEach(y => {
    const r = add(new THREE.CylinderGeometry(0.018, 0.018, 3.9, 6), std(0xa88e5c, { roughness: 0.6 }), 0, y, -1.89, fence);
    r.rotation.x = Math.PI / 2;
  });

  /* ---------- chrysanthemums ---------- */
  const flowers = [];
  const stemMat = std(0x4c7a3a), leafMat2 = std(0x52823f, { side: THREE.DoubleSide });
  function chrysanthemum(z, hue, light) {
    const f = new THREE.Group();
    const h = srange(0.55, 0.72);
    add(new THREE.CylinderGeometry(0.01, 0.014, h, 5), stemMat, 0, h / 2, 0, f);
    [0.18, 0.32].forEach((y, i) => {
      const lf = add(new THREE.SphereGeometry(0.055, 8, 5), leafMat2, (i ? -1 : 1) * 0.05, y, 0, f);
      lf.scale.set(1.5, 0.18, 0.7);
      lf.rotation.z = (i ? 1 : -1) * 0.4;
    });
    const head = new THREE.Group();
    head.position.y = h + 0.02;
    const petal = std(new THREE.Color().setHSL(hue, 0.75, light), { roughness: 0.7 });
    const inner = std(new THREE.Color().setHSL(hue - 0.02, 0.8, light - 0.08), { roughness: 0.7 });
    add(new THREE.SphereGeometry(0.035, 10, 8), std(0xb8792a), 0, 0.012, 0, head, true, false);
    [[18, 0.085, 0.3, petal, 1.25], [12, 0.055, 0.8, inner, 0.9]].forEach(([n, rad, tilt, m, len]) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rad * 7;
        const p = add(new THREE.SphereGeometry(0.045, 7, 4), m, Math.cos(a) * rad, 0.01, Math.sin(a) * rad, head, true, false);
        p.scale.set(len, 0.2, 0.35);
        p.rotation.y = -a;
        p.rotation.z = tilt;
      }
    });
    head.rotation.x = 0.55;
    f.add(head);
    f.position.set(-0.3, 0, z);
    fence.add(f);
    flowers.push({ g: f, head, phase: srange(0, 6) });
  }
  [0.15, -0.3, -0.72, -1.1, -1.55, -1.95, -2.4, -2.85, -3.3].forEach((z, i) => chrysanthemum(z, [0.13, 0.12, 0.11, 0.14][i % 4], [0.62, 0.7, 0.58, 0.75][i % 4]));

  /* ---------- raised bed: wood planks and soil ---------- */
  const woodTex = canvasTex(256, (x, s) => {
    x.fillStyle = '#8c6b47'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(${rand(50, 90)},${rand(30, 55)},${rand(15, 30)},${rand(0.15, 0.4)})`;
      x.lineWidth = rand(0.5, 2);
      const y = rand(0, s);
      x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(s * 0.3, y + rand(-6, 6), s * 0.7, y + rand(-6, 6), s, y + rand(-3, 3)); x.stroke();
    }
  });
  const soilTex = canvasTex(256, (x, s) => {
    x.fillStyle = '#4a3324'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = `rgba(${rand(30, 110)},${rand(20, 75)},${rand(10, 45)},${rand(0.3, 0.8)})`;
      x.fillRect(rand(0, s), rand(0, s), rand(1, 3.5), rand(1, 3.5));
    }
  }, 2);
  const BED = new THREE.Vector3(0, 0.2, 1.6);
  const woodMat = std(0xffffff, { map: woodTex, roughness: 0.85 });
  add(new THREE.BoxGeometry(1.3, 0.04, 0.85), std(0xffffff, { map: soilTex, roughness: 1 }), BED.x, 0.22, BED.z);
  add(new THREE.BoxGeometry(1.3, 0.2, 0.85), std(0x3b281c), BED.x, 0.1, BED.z);
  [[0, 0.455, 1.44, 0.06], [0, -0.455, 1.44, 0.06]].forEach(([dx, dz, w, d]) => add(new THREE.BoxGeometry(w, 0.3, d), woodMat, BED.x + dx, 0.15, BED.z + dz));
  [[0.69, 0], [-0.69, 0]].forEach(([dx, dz]) => add(new THREE.BoxGeometry(0.06, 0.3, 0.85), woodMat, BED.x + dx, 0.15, BED.z + dz));

  /* ---------- stools for the tray and the watering can ---------- */
  const standL = new THREE.Vector3(-1.18, 0, 2.0), standR = new THREE.Vector3(1.18, 0, 2.0);
  [standL, standR].forEach(p => {
    add(new THREE.CylinderGeometry(0.24, 0.26, 0.05, 20), woodMat, p.x, 0.42, p.z);
    [0, 1, 2].forEach(i => {
      const a = (i / 3) * TAU, leg = add(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 6), woodMat, p.x + Math.cos(a) * 0.16, 0.21, p.z + Math.sin(a) * 0.16);
      leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    });
  });
  add(new THREE.BoxGeometry(0.36, 0.04, 0.28), std(0x8a9b7a, { roughness: 0.8 }), standL.x, 0.465, standL.z);

  /* ---------- seedling ---------- */
  const seedling = new THREE.Group();
  add(new THREE.CylinderGeometry(0.065, 0.05, 0.09, 14), std(0x9b5f3c, { roughness: 0.8 }), 0, 0.045, 0, seedling);
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 14), std(0x3a281b), 0, 0.088, 0, seedling);
  add(new THREE.CylinderGeometry(0.006, 0.009, 0.16, 5), std(0x5d8f45), 0, 0.17, 0, seedling);
  const sproutMat = std(0x74b356, { roughness: 0.6, side: THREE.DoubleSide });
  const leaves = [];
  [[-1, 0.21], [1, 0.23], [-1, 0.14], [1, 0.13], [0, 0.26]].forEach(([side, y], i) => {
    const l = add(new THREE.SphereGeometry(0.05, 10, 6), sproutMat, side * 0.045, y, side === 0 ? 0.03 : 0, seedling);
    l.scale.set(1.2, 0.22, 0.6);
    l.rotation.z = side * 0.5;
    if (i > 1) { l.visible = false; leaves.push(l); }
  });
  seedling.position.set(standL.x, 0.485, standL.z);
  scene.add(seedling);

  /* ---------- watering can ---------- */
  const can = new THREE.Group();
  const metal = std(0x6f938d, { roughness: 0.35, metalness: 0.65 });
  add(new THREE.CylinderGeometry(0.105, 0.115, 0.2, 24), metal, 0, 0.1, 0, can);
  add(new THREE.TorusGeometry(0.106, 0.008, 6, 24), metal, 0, 0.2, 0, can).rotation.x = Math.PI / 2;
  const spout = add(new THREE.CylinderGeometry(0.011, 0.02, 0.27, 10), metal, 0.15, 0.15, 0, can);
  spout.rotation.z = -0.95;
  add(new THREE.CylinderGeometry(0.028, 0.02, 0.02, 10), metal, 0.255, 0.24, 0, can).rotation.z = -0.95;
  add(new THREE.TorusGeometry(0.07, 0.011, 8, 18, Math.PI), metal, -0.02, 0.2, 0, can).rotation.y = Math.PI / 2;
  can.position.set(standR.x, 0.445, standR.z);
  can.rotation.y = Math.PI;
  scene.add(can);
  const SPOUT_TIP = new THREE.Vector3(0.265, 0.25, 0);

  /* ---------- water droplets ---------- */
  const DROPS = 160;
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 3).fill(-10), 3));
  const softDot = canvasTex(64, (x, s) => {
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  });
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ map: softDot, color: 0xcfe8f2, size: 0.03, transparent: true, depthWrite: false }));
  drops.visible = false;
  scene.add(drops);
  const dropVel = new Float32Array(DROPS * 3);
  const water = { on: false };

  /* ---------- drifting motes in the late light ---------- */
  const MOTES = 140, moteGeo = new THREE.BufferGeometry(), mp = new Float32Array(MOTES * 3), mseed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) { mp[i * 3] = rand(-4, 4); mp[i * 3 + 1] = rand(0.2, 3); mp[i * 3 + 2] = rand(-4, 3); mseed[i] = rand(0, 100); }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: softDot, color: 0xfff1cf, size: 0.035, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(motes);

  /* ---------- two butterflies over the flowers ---------- */
  const wingTex = canvasTex(64, (x, s) => {
    x.fillStyle = '#f4efe2';
    x.beginPath(); x.ellipse(s * 0.5, s * 0.38, s * 0.42, s * 0.3, 0, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(s * 0.45, s * 0.75, s * 0.3, s * 0.2, 0.3, 0, TAU); x.fill();
    x.fillStyle = '#3b3a35'; x.beginPath(); x.arc(s * 0.62, s * 0.32, s * 0.06, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(60,55,45,.6)'; x.lineWidth = 2; x.beginPath(); x.ellipse(s * 0.5, s * 0.38, s * 0.42, s * 0.3, 0, 0, TAU); x.stroke();
  });
  const wingMat = new THREE.MeshStandardMaterial({ map: wingTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  const butterflies = [0, 1].map(i => {
    const b = new THREE.Group();
    const wg = new THREE.PlaneGeometry(0.08, 0.08);
    wg.translate(0.04, 0, 0);
    const l = new THREE.Mesh(wg, wingMat), r = new THREE.Mesh(wg, wingMat);
    r.scale.x = -1;
    l.rotation.x = r.rotation.x = -Math.PI / 2;
    const wl = new THREE.Group(), wr = new THREE.Group();
    wl.add(l); wr.add(r);
    b.add(wl, wr);
    scene.add(b);
    return { b, wl, wr, phase: i * 3.1 };
  });

  /* ---------- marker that shows what to touch ---------- */
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.185, 48), new THREE.MeshBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 10;
  marker.visible = false;
  scene.add(marker);

  /* ---------- post-processing: soft bloom, then a gentle film grade ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.6, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5;
        c.rgb *= mix(0.74, 1.0, smoothstep(0.9, 0.3, length(d * vec2(1.0, 1.15))));
        float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        c.rgb = mix(vec3(l), c.rgb, 0.9);
        c.rgb *= vec3(1.03, 1.0, 0.95);
        float g = fract(sin(dot(vUv * vec2(1291.0, 877.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        c.rgb += (g - 0.5) * 0.022;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);

  /* ---------- per-frame update ---------- */
  function updateDrops(dt) {
    const pos = dropGeo.attributes.position.array, tip = can.localToWorld(SPOUT_TIP.clone());
    for (let i = 0; i < DROPS; i++) {
      const j = i * 3;
      dropVel[j + 1] -= 9.8 * dt;
      pos[j] += dropVel[j] * dt; pos[j + 1] += dropVel[j + 1] * dt; pos[j + 2] += dropVel[j + 2] * dt;
      if (pos[j + 1] < BED.y + 0.05) {
        if (water.on && Math.random() < 0.5) {
          pos[j] = tip.x; pos[j + 1] = tip.y; pos[j + 2] = tip.z;
          dropVel[j] = rand(0.45, 0.8); dropVel[j + 1] = rand(0, 0.3); dropVel[j + 2] = rand(-0.12, 0.12);
        } else pos[j + 1] = -10;
      }
    }
    dropGeo.attributes.position.needsUpdate = true;
  }

  function update(dt, t) {
    time.value = t;
    grade.uniforms.uTime.value = t % 100;
    canopies.forEach(c => { c.crown.rotation.z = Math.sin(t * 0.55 + c.phase) * 0.03; c.crown.rotation.x = Math.cos(t * 0.4 + c.phase) * 0.022; });
    flowers.forEach(f => { if (!f.picked) f.g.rotation.x = Math.sin(t * 1.1 + f.phase) * 0.06; });
    lotus.rotation.y = Math.sin(t * 0.3) * 0.2;
    const mpos = moteGeo.attributes.position.array;
    for (let i = 0; i < MOTES; i++) {
      const j = i * 3, s = mseed[i];
      mpos[j] += Math.sin(t * 0.3 + s) * 0.0015;
      mpos[j + 1] += Math.sin(t * 0.5 + s * 2) * 0.001 + 0.0006;
      mpos[j + 2] += Math.cos(t * 0.25 + s) * 0.0015;
      if (mpos[j + 1] > 3.2) mpos[j + 1] = 0.2;
    }
    moteGeo.attributes.position.needsUpdate = true;
    butterflies.forEach(({ b, wl, wr, phase }) => {
      const k = t * 0.35 + phase;
      b.position.set(1.6 + Math.sin(k) * 0.9, 0.85 + Math.sin(k * 2.3) * 0.18, -0.8 + Math.sin(k * 0.7) * 1.3);
      b.rotation.y = -Math.atan2(Math.cos(k * 0.7) * 0.91, Math.cos(k) * 0.9);
      const flap = Math.sin(t * 14 + phase) * 0.9;
      wl.rotation.z = flap; wr.rotation.z = -flap;
    });
    if (marker.visible) { const s = 1 + Math.sin(t * 3) * 0.12; marker.scale.set(s, s, s); marker.material.opacity = 0.55 + Math.sin(t * 3) * 0.25; }
    if (drops.visible) updateDrops(dt);
    composer.render();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 68 : 55;
    camera.updateProjectionMatrix();
  }

  return { renderer, scene, camera, look, LIMIT, applyLook, BED, standL, standR, seedling, leaves, can, SPOUT_TIP, flowers, MOUNTAIN, marker, drops, water, update, resize };
}
