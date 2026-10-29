import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

// deterministic random so the garden looks the same every visit
let seed = 20261201;
export const srand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
export const srange = (a, b) => a + srand() * (b - a);
export const spick = arr => arr[Math.floor(srand() * arr.length)];

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
export const ridged = (x, y, o = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)); f *= 2.1; a *= 0.5; } return s; };

/* ---------- textures ---------- */
const loader = new THREE.TextureLoader();
const cache = new Map();
export const MAX_ANISO = { value: 4 };
export function tex(name, { repeat = 1, srgb = true } = {}) {
  const key = name + repeat + srgb;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load('textures/' + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = MAX_ANISO.value;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
/** A textured standard material with its normal map. */
export function surface(name, { repeat = 1, color = 0xffffff, roughness = 0.95, normalScale = 1, ...rest } = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(name + '.jpg', { repeat }),
    normalMap: tex(name + '_n.jpg', { repeat, srgb: false }),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    color, roughness, metalness: 0, ...rest,
  });
}
export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const softDot = canvasTex(64, 64, (x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
});
export const blobShadow = canvasTex(128, 128, (x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.6, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
});
export const puff = canvasTex(128, 128, (x, s) => {
  for (let i = 0; i < 14; i++) {
    const px = s / 2 + (Math.random() - 0.5) * s * 0.4, py = s / 2 + (Math.random() - 0.5) * s * 0.4, r = s * (0.18 + Math.random() * 0.2);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  }
});

/* ---------- mesh helpers ---------- */
export function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (parent) parent.add(m);
  return m;
}
export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o });

/** Depth material so alpha-tested foliage casts leaf-shaped shadows instead of squares. */
export function cutoutDepth(map, alphaTest = 0.5) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest });
}

/** Soft dark disc on the ground, for contact shadow under objects. */
export function contactShadow(parent, x, z, r, opacity = 0.6, y = 0.012) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: blobShadow, transparent: true, depthWrite: false, opacity }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = 1;
  parent.add(m);
  return m;
}
