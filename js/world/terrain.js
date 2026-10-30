import * as THREE from 'three';
import { tex, fbm, smooth } from './util.js';
import { L, PATHS, NARROW } from './layout.js?v=35';

/* Ground: one large plane, flat around the homestead and rolling further
   out. Grass, packed earth and tilled soil are blended in the shader from a
   painted mask, with a macro variation so the tiling does not show. Beyond
   the fence the shader lays out patchwork fields. */

export const MASK = { min: -26, size: 52 };

export function heightAt(x, z) {
  const r = Math.max(Math.abs(x) / 1.0, Math.abs(z - 1) / 1.05);
  if (r < 25) return 0;   // flat out to the bean field behind the garden
  return (fbm(x * 0.02 + 3, z * 0.02) - 0.42) * smooth(25, 50, r) * 9 + smooth(60, 260, r) * 14;
}

function paintMask() {
  const N = 1024, k = N / MASK.size;
  const toPx = (x, z) => [(x - MASK.min) * k, (z - MASK.min) * k];
  const layer = draw => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    g.lineCap = g.lineJoin = 'round';
    draw(g);
    return g.getImageData(0, 0, N, N).data;
  };
  const soft = (g, fn) => { [[1.6, 0.25], [1.25, 0.5], [0.95, 1]].forEach(([w, a]) => fn(w, a)); };
  const dirt = layer(g => {
    soft(g, (w, a) => {
      g.strokeStyle = `rgba(255,255,255,${a})`;
      PATHS.forEach((line, i) => {
        g.lineWidth = (i === 0 ? 1.35 : 1.0) * w * k;
        g.beginPath();
        line.forEach(([x, z], j) => { const [px, pz] = toPx(x, z); j ? g.lineTo(px, pz) : g.moveTo(px, pz); });
        g.stroke();
      });
      // the narrow path home
      g.lineWidth = 0.6 * w * k;
      g.beginPath();
      NARROW.forEach(([x, z], j) => { const [px, pz] = toPx(x, z); j ? g.lineTo(px, pz) : g.moveTo(px, pz); });
      g.stroke();
      // the lane outside the gate is wider
      g.lineWidth = 3.4 * w * k;
      g.beginPath(); g.moveTo(...toPx(0, 10.4)); g.lineTo(...toPx(0, 26)); g.stroke();
      g.beginPath(); g.moveTo(...toPx(-26, 13.2)); g.lineTo(...toPx(26, 13.6)); g.lineWidth = 2.4 * w * k; g.stroke();
      // the yard in front of the hut and the ground under it
      g.fillStyle = `rgba(255,255,255,${a})`;
      const pad = (1.5 - w) * 0.8;
      const { x0, x1, z0, z1 } = L.yard;
      const [ax, az] = toPx(x0 - pad, z0 - 4.6 - pad), [bx, bz] = toPx(x1 + pad, z1 + pad);
      g.beginPath(); g.ellipse((ax + bx) / 2, (az + bz) / 2, (bx - ax) / 2, (bz - az) / 2, 0, 0, Math.PI * 2); g.fill();
    });
  });
  const soil = layer(g => {
    soft(g, (w, a) => {
      g.fillStyle = `rgba(255,255,255,${a})`;
      [L.veg, L.beans].forEach(b => {
        const e = (w - 0.95) * 0.6;
        const [ax, az] = toPx(b.x - b.w / 2 - e, b.z - b.d / 2 - e), [bx, bz] = toPx(b.x + b.w / 2 + e, b.z + b.d / 2 + e);
        g.fillRect(ax, az, bx - ax, bz - az);
      });
    });
  });
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { out[i * 4] = dirt[i * 4]; out[i * 4 + 1] = soil[i * 4]; out[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(out, N, N);
  t.flipY = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function buildTerrain(scene) {
  const size = 700, seg = 280;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, heightAt(x, z));
    uv.setXY(i, x / 4, -z / 4);  // 4 m tiles, in world space
  }
  geo.computeVertexNormals();

  const mask = paintMask();
  const mat = new THREE.MeshStandardMaterial({
    map: tex('ground.jpg'), normalMap: tex('ground_n.jpg', { srgb: false }), normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 1, metalness: 0,
  });
  const uniforms = {
    tDirt: { value: tex('dirt.jpg') }, tSoil: { value: tex('soil.jpg') }, tMask: { value: mask },
    maskMin: { value: MASK.min }, maskSize: { value: MASK.size },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec2 vW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = `uniform sampler2D tDirt, tSoil, tMask; uniform float maskMin, maskSize; varying vec2 vW;
      float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      ` + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 grass = texture2D(map, vW * 0.25).rgb;
        vec3 macro = texture2D(map, vW * 0.021 + 0.37).rgb;
        grass *= 0.72 + 0.6 * macro.g / max(0.001, (macro.r + macro.g + macro.b) / 3.0) * 0.55;
        vec3 dirt = texture2D(tDirt, vW * 0.32).rgb;
        vec3 soil = texture2D(tSoil, vW * 0.55).rgb;
        vec2 muv = (vW - maskMin) / maskSize;
        vec4 m = (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) ? texture2D(tMask, muv) : vec4(0.0);
        float edge = texture2D(map, vW * 0.9).g * 1.6 - 0.45;
        float md = smoothstep(0.35, 0.75, m.r + (edge - 0.3) * 0.4);
        float ms = smoothstep(0.35, 0.75, m.g + (edge - 0.3) * 0.3);
        vec3 col = mix(grass, dirt, md);
        col = mix(col, soil, ms);
        // patchwork fields beyond the fence
        float outside = max(smoothstep(11.0, 13.5, abs(vW.x)), max(smoothstep(-13.0, -15.5, vW.y), smoothstep(17.0, 19.0, vW.y)));
        outside *= 1.0 - max(md, ms);   // the painted paths and the bean field keep their own ground
        outside *= 1.0 - smoothstep(4.5, 2.5, length((vW - vec2(5.9, -17.0)) / vec2(1.0, 1.9)));   // and the meadow round the footpath
        vec2 cell = floor(vW / vec2(16.0, 10.0));
        float hsh = fh(cell);
        vec3 fieldCol = mix(vec3(0.33, 0.42, 0.16), vec3(0.55, 0.52, 0.24), step(0.55, hsh));
        fieldCol = mix(fieldCol, vec3(0.42, 0.33, 0.2), step(0.85, hsh));
        float rows = 0.85 + 0.15 * sin(vW.x * (hsh > 0.5 ? 5.0 : 0.0) + vW.y * (hsh > 0.5 ? 0.0 : 5.0));
        col = mix(col, fieldCol * (0.8 + 0.4 * grass.g) * rows * 1.4, outside * 0.75);
        diffuseColor.rgb *= col;
      `);
  };
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}
