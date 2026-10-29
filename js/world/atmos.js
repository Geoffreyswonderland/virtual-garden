import * as THREE from 'three';
import { srand, srange, TAU, ridged, fbm, lerp, softDot, puff, canvasTex, std } from './util.js';

/* The far distance: layered mountains with mist between them (南山), a
   village whose smoke rises slowly (曖曖遠人村，依依墟里煙), birds going
   home at dusk, and the small lights: motes, fireflies and dew. */

const mistTex = canvasTex(256, 64, (x, w, h) => {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const img = x.getImageData(0, 0, w, h);
  for (let i = 0; i < w; i++) { const k = 0.6 + 0.4 * Math.sin(i / w * TAU * 3 + 1) * Math.sin(i / w * TAU * 7); for (let j = 0; j < h; j++) img.data[(j * w + i) * 4 + 3] *= k; }
  x.putImageData(img, 0, 0);
});
mistTex.wrapS = THREE.RepeatWrapping;

export function buildAtmos(scene, env) {
  const layers = [];
  /* ---------- mountain ranges, nearest first ---------- */
  function range({ cx, cz, w, depth, h, scale, haze, tone, yaw = 0, peak = null }) {
    const geo = new THREE.PlaneGeometry(w, depth, 160, 40);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    const off = srange(0, 80);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const envl = Math.max(0, 1 - Math.pow(Math.abs(z) / (depth / 2), 2)) * Math.max(0, 1 - Math.pow(Math.abs(x) / (w / 2), 3));
      let y = h * envl * (0.3 + Math.pow(ridged(x / scale + off, z / scale + off * 0.6), 2) * 1.1);
      if (peak) { const d = Math.hypot(x - peak[0], z - peak[1]); y += peak[2] * Math.exp(-(d * d) / (2 * peak[3] * peak[3])) * (0.8 + 0.3 * ridged(x / 20, z / 20)); }
      p.setY(i, y - 6);
      const k = 0.55 + 0.45 * Math.min(1, Math.max(0, y) / (h * 1.1 + (peak ? peak[2] : 0) * 0.6));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, 0, cz);
    m.rotation.y = yaw;
    scene.add(m);
    // a band of mist along its foot
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.1, h * 0.55), new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, fog: false }));
    mist.position.set(cx, h * 0.12, cz + depth * 0.3);
    mist.rotation.y = yaw;
    mist.material.map = mistTex.clone();
    mist.material.map.repeat.set(1.5, 1);
    scene.add(mist);
    layers.push({ mat, mist, haze, tone: new THREE.Color(tone) });
  }
  range({ cx: -40, cz: -95, w: 220, depth: 40, h: 16, scale: 22, haze: 0.42, tone: 0x3f5a3a });
  range({ cx: 70, cz: -120, w: 200, depth: 50, h: 22, scale: 26, haze: 0.5, tone: 0x46604a, yaw: -0.25 });
  range({ cx: 30, cz: -260, w: 420, depth: 90, h: 34, scale: 40, haze: 0.66, tone: 0x5b6f6a, peak: [20, 0, 62, 70] });   // 南山
  range({ cx: -150, cz: -300, w: 420, depth: 90, h: 55, scale: 48, haze: 0.78, tone: 0x6c7f86, yaw: 0.35 });
  range({ cx: 220, cz: -200, w: 300, depth: 80, h: 45, scale: 40, haze: 0.74, tone: 0x6c7f86, yaw: -0.9 });
  range({ cx: -200, cz: 40, w: 300, depth: 80, h: 40, scale: 40, haze: 0.74, tone: 0x6c7f86, yaw: 1.4 });
  range({ cx: 180, cz: 120, w: 300, depth: 80, h: 36, scale: 40, haze: 0.76, tone: 0x6c7f86, yaw: -2.2 });
  range({ cx: 0, cz: 260, w: 420, depth: 80, h: 40, scale: 40, haze: 0.78, tone: 0x6c7f86, yaw: Math.PI });

  /* ---------- the distant village and its smoke ---------- */
  const roof = std(0x3c3a36, { roughness: 0.95 }), walls = std(0xb9a98e, { roughness: 1 });
  const chimneys = [];
  const houses = [[-46, -42], [-52, -48], [-40, -55], [-58, -38], [-33, -48], [-64, -52], [38, 30], [46, 36], [-30, 34]];
  houses.forEach(([x, z], i) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = srange(-0.4, 0.4);
    const w = srange(4, 6), d = srange(3, 4);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), walls); b.position.y = 1.2; g.add(b);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.01, d * 0.78, 1.6, 4, 1), roof);
    r.rotation.y = Math.PI / 4; r.scale.set(w / d * 1.15, 1, 1.1); r.position.y = 3.2; g.add(r);
    scene.add(g);
    if (i % 2 === 0) chimneys.push(new THREE.Vector3(x + 1, 3.5, z));
  });
  // haystacks in the fields outside
  const hay = std(0xb79c62, { roughness: 1 });
  [[-16, 20], [-19, 23], [15, -18], [18, 24], [-20, -16]].forEach(([x, z]) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 1.2, 14), hay); c.position.y = 0.6;
    const t = new THREE.Mesh(new THREE.ConeGeometry(1.08, 1.4, 14), hay); t.position.y = 1.9;
    c.castShadow = t.castShadow = true;
    g.add(c, t);
    scene.add(g);
  });

  const SM = 40 * chimneys.length, smokeGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(SM * 3), sAge = new Float32Array(SM);
  for (let i = 0; i < SM; i++) { sAge[i] = srand(); }
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const smokeMat = new THREE.PointsMaterial({ map: puff, color: 0xe8e4dc, size: 5.5, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false;
  scene.add(smoke);

  /* ---------- birds going home at dusk (飛鳥相與還) ---------- */
  const birds = new THREE.Group();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1d1a18, side: THREE.DoubleSide, fog: false });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.5, 0, -0.12, 0.42, 0, 0.12], 3));
  const flock = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Group(), l = new THREE.Mesh(wingGeo, birdMat), r = new THREE.Mesh(wingGeo, birdMat);
    r.scale.x = -1;
    b.add(l, r);
    b.position.set(i * 1.4 - (i % 2) * 0.8, (i % 3) * 0.6, Math.abs(i - 3) * 1.2);
    birds.add(b);
    flock.push({ l, r, ph: srand() * 6 });
  }
  birds.scale.setScalar(1.6);
  birds.visible = false;
  scene.add(birds);

  /* ---------- small lights ---------- */
  const MOTES = 220, moteGeo = new THREE.BufferGeometry(), mp = new Float32Array(MOTES * 3), ms = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) { mp[i * 3] = srange(-9, 9); mp[i * 3 + 1] = srange(0.2, 3); mp[i * 3 + 2] = srange(-10, 12); ms[i] = srand() * 100; }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const moteMat = new THREE.PointsMaterial({ map: softDot, color: 0xfff1cf, size: 0.035, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);

  const dewP = [];
  for (let i = 0; i < 900; i++) { const a = srand() * TAU, r = Math.sqrt(srand()) * 7; const x = Math.cos(a) * r, z = -2.5 + Math.sin(a) * r * 1.1; if (Math.abs(x) < 0.7 && z > -6) continue; dewP.push(x, srange(0.04, 0.35), z); }
  const dewGeo = new THREE.BufferGeometry();
  dewGeo.setAttribute('position', new THREE.Float32BufferAttribute(dewP, 3));
  const dewMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: softDot }, uTime: env.time, strength: { value: 0 } },
    vertexShader: `uniform float uTime; varying float vTw;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vTw = 0.3 + 0.7 * pow(clamp(0.5 + 0.5 * sin(uTime * 2.1 + position.x * 17.0 + position.z * 11.0), 0.0, 1.0), 8.0);
        gl_PointSize = 30.0 / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform float strength; varying float vTw;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = t.a * vTw * strength; gl_FragColor = vec4(vec3(0.78, 0.9, 1.0) * a, a); }`,
  });
  const dew = new THREE.Points(dewGeo, dewMat);
  dew.frustumCulled = false;
  scene.add(dew);

  /* ---------- butterflies (day) ---------- */
  const wingTex = canvasTex(64, 64, (x, s) => {
    x.fillStyle = '#f4efe2';
    x.beginPath(); x.ellipse(s * 0.5, s * 0.38, s * 0.42, s * 0.3, 0, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(s * 0.45, s * 0.75, s * 0.3, s * 0.2, 0.3, 0, TAU); x.fill();
    x.fillStyle = '#3b3a35'; x.beginPath(); x.arc(s * 0.62, s * 0.32, s * 0.06, 0, TAU); x.fill();
  });
  const wingMat = new THREE.MeshStandardMaterial({ map: wingTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  const butterflies = [[-4.5, 3.6], [8.2, -3.5], [-2.5, -4.8]].map(([cx, cz], i) => {
    const b = new THREE.Group(), wg = new THREE.PlaneGeometry(0.08, 0.08);
    wg.translate(0.04, 0, 0);
    const l = new THREE.Mesh(wg, wingMat), r = new THREE.Mesh(wg, wingMat);
    r.scale.x = -1;
    l.rotation.x = r.rotation.x = -Math.PI / 2;
    const wl = new THREE.Group(), wr = new THREE.Group();
    wl.add(l); wr.add(r); b.add(wl, wr);
    scene.add(b);
    return { b, wl, wr, cx, cz, ph: i * 2.3 };
  });

  /* ---------- respond to the time of day ---------- */
  const fog = new THREE.Color(), tmp = new THREE.Color(), light = new THREE.Color();
  const dayMote = new THREE.Color(1, 0.94, 0.8), firefly = new THREE.Color(0.7, 1, 0.4);
  let night = 0, dusk = 0;
  env.onEnv(p => {
    fog.setRGB(...p.fog);
    light.setRGB(...p.light).multiplyScalar(Math.min(1.2, p.lightI / 2.6));
    layers.forEach(Ly => {
      tmp.copy(Ly.tone).multiply(light).lerp(fog, Ly.haze);
      Ly.mat.color.copy(tmp);
      Ly.mist.material.color.copy(fog).multiplyScalar(1.05);
      Ly.mist.material.opacity = lerp(0.75, 0.35, p.night);
    });
    night = p.night;
    dusk = Math.max(0, 1 - Math.abs(p.sunDir[1] - 0.07) * 6) * (1 - p.night);
    smokeMat.color.setRGB(...p.fog).lerp(new THREE.Color(0.9, 0.9, 0.88), 0.4);
    smokeMat.opacity = lerp(0.5, 0.15, p.night);
    moteMat.color.copy(dayMote).lerp(firefly, p.night);
    moteMat.size = lerp(0.035, 0.07, p.night);
    moteMat.opacity = lerp(0.55, 1, p.night);
    butterflies.forEach(b => { b.b.visible = p.night < 0.3; });
  });

  function update(dt, t) {
    // smoke
    chimneys.forEach((c, k) => {
      for (let i = 0; i < 40; i++) {
        const idx = k * 40 + i, j = idx * 3;
        sAge[idx] += dt * 0.035;
        if (sAge[idx] > 1) sAge[idx] -= 1;
        const a = sAge[idx];
        sp[j] = c.x + a * 9 + Math.sin(a * 6 + k) * 1.2;
        sp[j + 1] = c.y + a * 16;
        sp[j + 2] = c.z + Math.cos(a * 5 + k) * 0.8;
      }
    });
    smokeGeo.attributes.position.needsUpdate = true;
    // motes / fireflies
    const mpos = moteGeo.attributes.position.array, sp2 = 1 + night * 1.5;
    for (let i = 0; i < MOTES; i++) {
      const j = i * 3, s = ms[i];
      mpos[j] += Math.sin(t * 0.3 * sp2 + s) * 0.0016 * sp2;
      mpos[j + 1] += Math.sin(t * 0.5 * sp2 + s * 2) * 0.001 * sp2 + 0.0004;
      mpos[j + 2] += Math.cos(t * 0.25 * sp2 + s) * 0.0016 * sp2;
      if (mpos[j + 1] > 3.2) mpos[j + 1] = 0.2;
    }
    moteGeo.attributes.position.needsUpdate = true;
    // butterflies
    butterflies.forEach(({ b, wl, wr, cx, cz, ph }) => {
      const k = t * 0.35 + ph;
      b.position.set(cx + Math.sin(k) * 1.1, 0.75 + Math.sin(k * 2.3) * 0.22, cz + Math.sin(k * 0.7) * 1.2);
      b.rotation.y = -Math.atan2(Math.cos(k * 0.7) * 0.84, Math.cos(k) * 1.1);
      const flap = Math.sin(t * 14 + ph) * 0.9;
      wl.rotation.z = flap; wr.rotation.z = -flap;
    });
    // birds cross the sky while the light is low
    birds.visible = dusk > 0.2;
    if (birds.visible) {
      const k = (t * 0.012) % 1;
      birds.position.set(lerp(-160, 160, k), 38 + Math.sin(k * 6) * 3, -150);
      birds.rotation.y = -Math.PI / 2;
      flock.forEach(f => { const fl = Math.sin(t * 6 + f.ph) * 0.6; f.l.rotation.z = fl; f.r.rotation.z = -fl; });
    }
  }
  return { update, dewMat };
}
