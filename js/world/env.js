import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { lerp, ease, MAX_ANISO } from './util.js';

/* ---------- quality tier ---------- */
export function pickTier() {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'mid' || q === 'high') return q;
  const touch = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  if (touch && small) return 'low';
  if (touch) return 'mid';
  return 'high';
}
export const TIER = {
  low: { dpr: 1, shadow: 1024, grass: 26000, samples: 0, rays: 0 },
  mid: { dpr: 1.25, shadow: 1024, grass: 52000, samples: 2, rays: 24 },
  high: { dpr: 1.5, shadow: 2048, grass: 110000, samples: 4, rays: 40 },
};

/* where the moon hangs: ahead of the walk home from the bean field, above the hut's east end,
   about 42° up — clear of the trees, and of the roof even when standing at the door */
export const MOON_DIR = [0.12, 0.67, -0.73];

/* ---------- time-of-day presets (linear RGB) ---------- */
export const ENV = {
  morning: { hz: [0.95, 0.84, 0.7], zn: [0.42, 0.56, 0.74], sunCol: [1, 0.8, 0.58], sunDir: [0.42, 0.2, -0.88], light: [1, 0.83, 0.64], lightI: 2.7, sky: [0.82, 0.86, 0.95], gnd: [0.36, 0.32, 0.22], hemiI: 0.55, fog: [0.86, 0.79, 0.68], fogD: 0.021, exp: 0.9, night: 0, cloud: 1, rays: 1 },
  noon: { hz: [0.8, 0.85, 0.88], zn: [0.24, 0.44, 0.78], sunCol: [1, 0.96, 0.88], sunDir: [0.3, 0.88, -0.36], light: [1, 0.97, 0.9], lightI: 3.2, sky: [0.8, 0.86, 0.95], gnd: [0.38, 0.35, 0.24], hemiI: 0.65, fog: [0.78, 0.83, 0.86], fogD: 0.011, exp: 0.78, night: 0, cloud: 1, rays: 0.25 },
  dusk: { hz: [1, 0.6, 0.34], zn: [0.3, 0.32, 0.5], sunCol: [1, 0.48, 0.18], sunDir: [-0.55, 0.06, -0.83], light: [1, 0.58, 0.32], lightI: 2.4, sky: [0.66, 0.56, 0.64], gnd: [0.3, 0.22, 0.16], hemiI: 0.36, fog: [0.85, 0.56, 0.4], fogD: 0.018, exp: 0.95, night: 0.1, cloud: 0.9, rays: 1.3 },
  night: { hz: [0.07, 0.09, 0.15], zn: [0.01, 0.018, 0.05], sunCol: [0.75, 0.85, 1], sunDir: [0.12, 0.67, -0.73], light: [0.55, 0.66, 1], lightI: 0.55, sky: [0.4, 0.5, 0.8], gnd: [0.1, 0.1, 0.12], hemiI: 0.17, fog: [0.05, 0.07, 0.12], fogD: 0.022, exp: 1.2, night: 1, cloud: 0.25, rays: 0.35 },
};
const KEYS = Object.keys(ENV.morning);
export const blendEnv = (a, b, k) => Object.fromEntries(KEYS.map(key => [key, Array.isArray(a[key]) ? a[key].map((v, i) => lerp(v, b[key][i], k)) : lerp(a[key], b[key], k)]));

export function createEnv(canvas, tierName) {
  const tier = TIER[tierName];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.dpr));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  MAX_ANISO.value = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.02);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const time = { value: 0 };

  /* ---------- sky: gradient, hazy sun or moon, stars, slow clouds ---------- */
  const U = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, hz: { value: new THREE.Color() }, zn: { value: new THREE.Color() },
    sunCol: { value: new THREE.Color() }, night: { value: 0 }, cloud: { value: 1 }, uTime: time,
    moonDir: { value: new THREE.Vector3(...MOON_DIR).normalize() },
  };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 sunDir, moonDir, hz, zn, sunCol; uniform float uTime, night, cloud; varying vec3 vDir;
      float qh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float qn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(qh(i),qh(i+vec2(1,0)),f.x),mix(qh(i+vec2(0,1)),qh(i+1.0),f.x),f.y);}
      float qfbm(vec2 p){return qn(p)*.5+qn(p*2.03)*.25+qn(p*4.07)*.13+qn(p*8.1)*.07;}
      void main(){
        vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(hz, zn, pow(h, 0.45));
        if (d.y < 0.0) col = hz * 0.9;
        float s = max(dot(d, sunDir), 0.0);
        // a wide warm haze around the sun, brighter near the horizon
        float hazeK = pow(s, 4.0) * (0.35 + 0.65 * (1.0 - h));
        vec3 day = sunCol * (pow(s, 1400.0) * 30.0 + pow(s, 60.0) * 0.9 + pow(s, 12.0) * 0.35 + hazeK * 0.45);
        // the moon stays put while the sun sets; it fades in as night falls
        float m = max(dot(d, moonDir), 0.0);
        float disc = smoothstep(0.99935, 0.99955, m);            // about 3.5° across: easy to find
        vec2 mp = (d - moonDir * m).xy * 900.0;
        float mare = 0.82 + 0.18 * qn(mp * 0.9 + 7.0);            // faint grey patches on the face
        vec3 moon = vec3(1.0, 0.97, 0.88) * disc * 6.0 * mare
                  + vec3(0.75, 0.85, 1.0) * (pow(m, 900.0) * 0.9 + pow(m, 90.0) * 0.22 + pow(m, 12.0) * 0.05);
        float mk = smoothstep(0.2, 0.65, night);
        col += day * (1.0 - night) + moon * mk;
        vec2 sp = floor(d.xz / (d.y + 0.35) * 280.0);
        float star = step(0.9974, qh(sp)) * smoothstep(0.08, 0.35, d.y) * (0.6 + 0.4 * sin(uTime * 2.0 + qh(sp + 3.0) * 40.0));
        col += vec3(0.85, 0.9, 1.0) * star * night * 1.4;
        vec2 p = d.xz / (d.y + 0.14) * 1.2 + vec2(uTime * 0.005, uTime * 0.0018);
        float c = smoothstep(0.5, 0.85, qfbm(p));
        vec3 cloudCol = mix(hz * 1.05, sunCol * 1.3, pow(s, 5.0) * 0.7) * cloud;
        cloudCol = mix(cloudCol, vec3(0.06, 0.07, 0.11), night * 0.85);
        col = mix(col, cloudCol, c * 0.55 * smoothstep(0.02, 0.25, d.y) * (1.0 - mk * smoothstep(0.994, 0.9992, m)));   // keep the moon clear
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  function refreshEnv() {
    const old = scene.environment;
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    if (old) old.dispose();
  }

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x554a33, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(tier.shadow, tier.shadow);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const SH = 16;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 90 });
  scene.add(sun, sun.target);

  /* ---------- post-processing ---------- */
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: tier.samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const rays = new ShaderPass({
    defines: { SAMPLES: Math.max(1, tier.rays) },
    uniforms: { tDiffuse: { value: null }, sunPos: { value: new THREE.Vector2(0.5, 0.5) }, strength: { value: 0 }, aspect: { value: 1 }, tint: { value: new THREE.Color() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 sunPos; uniform float strength, aspect; uniform vec3 tint; varying vec2 vUv;
      void main(){
        vec4 base = texture2D(tDiffuse, vUv);
        if (strength < 0.001) { gl_FragColor = base; return; }
        vec2 delta = (vUv - sunPos) / float(SAMPLES) * 0.85;
        vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          uv -= delta;
          vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
          if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec2 dd = (uv - sunPos) * vec2(aspect, 1.0);
          acc += c * smoothstep(0.85, 2.4, l) * exp(-dot(dd, dd) * 3.5) * decay;
          decay *= 0.96;
        }
        base.rgb += acc / float(SAMPLES) * strength * tint;
        gl_FragColor = base;
      }`,
  });
  rays.enabled = tier.rays > 0;
  composer.addPass(rays);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.26, 0.6, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, night: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, night; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5;
        c.rgb *= mix(0.68, 1.0, smoothstep(0.95, 0.32, length(d * vec2(1.0, 1.2))));
        float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        c.rgb = mix(vec3(l), c.rgb, 0.92);
        c.rgb = mix(c.rgb * vec3(1.035, 1.0, 0.94), c.rgb * vec3(0.92, 0.98, 1.08), night);
        c.rgb = c.rgb * 0.97 + 0.012;  // lift the blacks a little, like paper
        float g = fract(sin(dot(vUv * vec2(1291.0, 877.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        c.rgb += (g - 0.5) * 0.02;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);

  /* ---------- applying a time of day ---------- */
  let cur = { ...ENV.morning };
  let tween = null, lastRefresh = -1, dirty = false;
  const sunVec = new THREE.Vector3();
  function apply(p) {
    U.hz.value.setRGB(...p.hz); U.zn.value.setRGB(...p.zn); U.sunCol.value.setRGB(...p.sunCol);
    U.sunDir.value.set(...p.sunDir).normalize();
    U.night.value = p.night; U.cloud.value = p.cloud;
    sun.color.setRGB(...p.light); sun.intensity = p.lightI;
    hemi.color.setRGB(...p.sky); hemi.groundColor.setRGB(...p.gnd); hemi.intensity = p.hemiI;
    scene.fog.color.setRGB(...p.fog); scene.fog.density = p.fogD;
    renderer.toneMappingExposure = p.exp;
    grade.uniforms.night.value = p.night;
    rays.uniforms.tint.value.setRGB(...p.sunCol);
    cur = p;
    dirty = true;
    listeners.forEach(fn => fn(p));
  }
  const listeners = [];
  function setEnv(name, seconds = 5) {
    const to = ENV[name];
    if (!to) return Promise.resolve();
    if (seconds <= 0) { apply({ ...to }); refreshEnv(); return Promise.resolve(); }
    return new Promise(done => { tween = { from: { ...cur }, to, t: 0, dur: seconds, done }; });
  }
  /** Drive the look directly (e.g. by walking progress); k in 0..1. */
  function mixEnv(a, b, k) { tween = null; apply(blendEnv(ENV[a], ENV[b], k)); }
  apply(cur);
  refreshEnv();
  dirty = false;

  const camDir = new THREE.Vector3(), proj = new THREE.Vector3();
  function update(dt, t) {
    time.value = t;
    grade.uniforms.uTime.value = t % 100;
    if (tween) {
      tween.t += dt;
      const k = Math.min(1, tween.t / tween.dur);
      apply(blendEnv(tween.from, tween.to, ease(k)));
      if (k >= 1) { const d = tween.done; tween = null; d(); }
    }
    // the light probe is costly; refresh it a couple of times a second while the sky changes
    if (dirty && t - lastRefresh > 0.6) { refreshEnv(); lastRefresh = t; dirty = false; }
    sky.position.copy(camera.position);
    // shadows follow the player, snapped to texels to avoid shimmering
    const texel = (SH * 2) / tier.shadow;
    const cx = Math.round(camera.position.x / texel) * texel, cz = Math.round(camera.position.z / texel) * texel;
    sun.target.position.set(cx, 0, cz);
    sun.position.copy(U.sunDir.value).multiplyScalar(40).add(sun.target.position);
    // god rays: where is the sun on screen?
    if (rays.enabled) {
      camera.getWorldDirection(camDir);
      const facing = camDir.dot(U.sunDir.value);
      sunVec.copy(U.sunDir.value).multiplyScalar(500).add(camera.position);
      proj.copy(sunVec).project(camera);
      rays.uniforms.sunPos.value.set(proj.x * 0.5 + 0.5, proj.y * 0.5 + 0.5);
      rays.uniforms.strength.value = cur.rays * 1.4 * THREE.MathUtils.smoothstep(facing, 0.05, 0.45);
    }
    composer.render();
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    rays.uniforms.aspect.value = w / h;
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 72 : 60;
    camera.updateProjectionMatrix();
  }

  return { renderer, scene, camera, time, tier, sun, setEnv, mixEnv, onEnv: fn => listeners.push(fn), get env() { return cur; }, update, resize };
}
