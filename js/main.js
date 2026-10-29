import * as THREE from 'three';
import { parseCSV } from './csv.js?v=7';
import { createGarden } from './garden.js?v=7';

/* =====================================================================
   STATE AND EVENT LOG
   Every meaningful moment is written to state.log with a time stamp in
   milliseconds since the session started, so the process can be
   reconstructed and aligned with other data (e.g. a heart-rate strap).
   ===================================================================== */
const $ = s => document.querySelector(s);
const state = { actions: [], questions: [], log: [], t0: 0, running: false };
const now = () => Math.round(performance.now() - state.t0);
const log = (type, id = '', value = '') => state.log.push({ t: now(), type, id, value: String(value) });

async function loadData() {
  const get = u => fetch(u, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(u);
    return r.text();
  });
  const [a, q] = await Promise.all([get('data/actions.csv'), get('data/questions.csv')]);
  state.actions = parseCSV(a).sort((x, y) => Number(x.order) - Number(y.order));
  state.questions = parseCSV(q);
}

/* =====================================================================
   SCENE (built in garden.js)
   ===================================================================== */
const canvas = $('#scene');
const G = createGarden(canvas);
const { scene, camera, look, LIMIT, applyLook, STAND, HUT, BED, HOLES, standL, standR, gate, weeds, pouch, beans, sprouts, can, hoe, drops, dewMat, marker } = G;
scene.add(camera); // so the carried hoe can ride along with the camera

/* =====================================================================
   TWEENS AND LOOP
   ===================================================================== */
const tweens = [];
const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const tw = (dur, fn, curve = ease) => new Promise(done => tweens.push({ t: 0, dur, fn, curve, done }));
const wait = ms => new Promise(r => setTimeout(r, ms));
const lerp = (a, b, k) => a + (b - a) * k;
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i];
    w.t += dt;
    const k = Math.min(1, w.t / w.dur);
    w.fn(w.curve(k));
    if (k >= 1) { tweens.splice(i, 1); w.done(); }
  }
  G.update(dt, t);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', G.resize);
G.resize();
requestAnimationFrame(frame);

/* =====================================================================
   INPUT: drag to look around, tap to interact
   ===================================================================== */
const raycaster = new THREE.Raycaster();
let drag = null, active = null, locked = false;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag || locked) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.moved > 6) {
    canvas.classList.add('dragging');
    look.yaw = drag.yaw + dx * 0.004;
    look.pitch = THREE.MathUtils.clamp(drag.pitch + dy * 0.004, LIMIT.pitchMin, LIMIT.pitchMax);
    applyLook();
  }
});
canvas.addEventListener('pointerup', e => {
  const d = drag;
  drag = null;
  canvas.classList.remove('dragging');
  if (!d || d.moved > 6 || !active) return;
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(p, camera);
  const hit = raycaster.intersectObjects(active.targets, true)[0];
  if (!hit) { log('miss', active.id); return; }
  const a = active;
  active = null;
  marker.visible = false;
  a.resolve(hit.object);
});

function waitTap(id, targets, markerAt) {
  marker.position.copy(markerAt);
  marker.visible = true;
  return new Promise(resolve => { active = { id, targets, resolve }; });
}
const isInside = (obj, group) => { for (let o = obj; o; o = o.parent) if (o === group) return true; return false; };

/* =====================================================================
   SOUNDSCAPES (synthesised for the prototype; the research version will
   use loudness-matched field recordings)
   city   : traffic hum and passing cars (久在樊籠裡)
   garden : wind, a small stream, birds
   night  : crickets and a softer wind
   ===================================================================== */
const AU = { ctx: null, master: null, on: true, scape: 'city', bus: {} };
function noiseBuffer(ctx, brown) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
function loopNoise(brown) {
  const s = AU.ctx.createBufferSource();
  s.buffer = brown ? AU.brown : AU.white;
  s.loop = true;
  s.start();
  return s;
}
function filt(type, freq, q = 0.7) { const f = AU.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
function gain(v) { const g = AU.ctx.createGain(); g.gain.value = v; return g; }

function audioInit() {
  if (AU.ctx) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  AU.ctx = ctx;
  AU.white = noiseBuffer(ctx, false);
  AU.brown = noiseBuffer(ctx, true);
  AU.master = gain(0.7);
  AU.master.connect(ctx.destination);
  const bus = AU.bus;
  ['city', 'garden', 'night'].forEach(k => { bus[k] = gain(k === 'city' ? 1 : 0); bus[k].connect(AU.master); });

  // city: low rumble, a band of tyre noise, an occasional horn-like hum
  loopNoise(true).connect(filt('lowpass', 160)).connect(gain(0.5)).connect(bus.city);
  loopNoise(false).connect(filt('bandpass', 700, 0.5)).connect(gain(0.05)).connect(bus.city);
  const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 58;
  hum.connect(filt('lowpass', 220)).connect(gain(0.018)).connect(bus.city); hum.start();

  // garden: wind with slow gusts, a stream on the left
  const wg = gain(0.22);
  loopNoise(true).connect(filt('lowpass', 420)).connect(wg).connect(bus.garden);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; lfo.connect(gain(0.1)).connect(wg.gain); lfo.start();
  const sf = filt('bandpass', 1300);
  const sp = ctx.createStereoPanner(); sp.pan.value = -0.6;
  loopNoise(false).connect(sf).connect(gain(0.045)).connect(sp).connect(bus.garden);
  setInterval(() => sf.frequency.setTargetAtTime(1000 + Math.random() * 700, ctx.currentTime, 0.4), 700);

  // night: soft wind and two crickets
  loopNoise(true).connect(filt('lowpass', 300)).connect(gain(0.12)).connect(bus.night);
  [[4300, -0.5, 27], [4700, 0.6, 31]].forEach(([f, pan, rate]) => {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const am = gain(0); const sq = ctx.createOscillator(); sq.type = 'square'; sq.frequency.value = rate;
    sq.connect(gain(0.5)).connect(am.gain); sq.start(); o.start();
    const gate = gain(0), p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(am).connect(gate).connect(gain(0.03)).connect(p).connect(bus.night);
    const chirpLoop = () => {
      const t = ctx.currentTime;
      gate.gain.setTargetAtTime(1, t, 0.01);
      gate.gain.setTargetAtTime(0, t + 0.18 + Math.random() * 0.12, 0.02);
      setTimeout(chirpLoop, 500 + Math.random() * 900);
    };
    chirpLoop();
  });

  scheduleCar();
  scheduleBird();
}
function setScape(name, seconds = 3) {
  AU.scape = name;
  log('soundscape', name);
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime;
  Object.entries(AU.bus).forEach(([k, g]) => g.gain.setTargetAtTime(k === name ? 1 : 0, t, seconds / 3));
}
function scheduleCar() {
  setTimeout(() => {
    if (AU.scape === 'city') {
      const C = AU.ctx, t = C.currentTime, d = 2.5 + Math.random() * 2;
      const s = C.createBufferSource(); s.buffer = AU.white;
      const f = filt('lowpass', 300), g = gain(0), p = C.createStereoPanner();
      const dir = Math.random() < 0.5 ? -1 : 1;
      p.pan.setValueAtTime(-0.9 * dir, t); p.pan.linearRampToValueAtTime(0.9 * dir, t + d);
      f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1400, t + d / 2); f.frequency.linearRampToValueAtTime(350, t + d);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + d / 2); g.gain.linearRampToValueAtTime(0, t + d);
      s.connect(f).connect(g).connect(p).connect(AU.bus.city);
      s.start(t); s.stop(t + d + 0.1);
    }
    scheduleCar();
  }, 2500 + Math.random() * 4500);
}
function chirp() {
  const C = AU.ctx, pan = C.createStereoPanner();
  pan.pan.value = Math.random() * 1.8 - 0.9;
  pan.connect(AU.bus.garden);
  let t = C.currentTime + 0.05;
  const base = 2300 + Math.random() * 1500, n = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const o = C.createOscillator(), g = C.createGain(), dur = 0.05 + Math.random() * 0.1;
    const f0 = base * (0.85 + Math.random() * 0.5);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.8), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(pan);
    o.start(t); o.stop(t + dur + 0.05);
    t += dur + 0.03 + Math.random() * 0.08;
  }
}
function scheduleBird() {
  setTimeout(() => { if (AU.scape === 'garden') chirp(); scheduleBird(); }, 2500 + Math.random() * 5500);
}
function oneShot(kind) {
  if (!AU.ctx) return;
  const C = AU.ctx, t = C.currentTime, s = C.createBufferSource(); s.buffer = AU.white;
  const spec = { creak: ['bandpass', 380, 6, 0.08, 0.9], pull: ['bandpass', 900, 1.2, 0.07, 0.35], seed: ['highpass', 3000, 0.7, 0.03, 0.08], step: ['lowpass', 500, 0.7, 0.05, 0.12] }[kind];
  const f = filt(spec[0], spec[1], spec[2]), g = gain(0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(spec[3], t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + spec[4]);
  s.connect(f).connect(g).connect(AU.master);
  s.start(t); s.stop(t + spec[4] + 0.05);
}
function waterSound(on) {
  if (!AU.ctx) return;
  const C = AU.ctx;
  if (on) {
    const s = C.createBufferSource(); s.buffer = AU.white; s.loop = true;
    const g = gain(0); g.gain.linearRampToValueAtTime(0.06, C.currentTime + 0.4);
    s.connect(filt('highpass', 2500)).connect(g).connect(AU.master); s.start();
    AU.water = { s, g };
  } else if (AU.water) {
    const { s, g } = AU.water;
    g.gain.linearRampToValueAtTime(0, C.currentTime + 0.5);
    s.stop(C.currentTime + 0.6);
    AU.water = null;
  }
}
$('#sound').addEventListener('click', () => {
  AU.on = !AU.on;
  if (AU.master) AU.master.gain.setTargetAtTime(AU.on ? 0.7 : 0, AU.ctx.currentTime, 0.1);
  $('#sound').textContent = AU.on ? '聲音：開' : '聲音：關';
  $('#sound').setAttribute('aria-pressed', String(AU.on));
  log('sound', '', AU.on ? 'on' : 'off');
});

/* =====================================================================
   PANELS: poem and slider questions
   ===================================================================== */
const panel = $('#panel'), card = $('#panel-card');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const say = text => { $('#instruction').textContent = text; };

function askSliders(questions, heading = '') {
  return new Promise(resolve => {
    card.innerHTML = (heading ? `<p class="eyebrow">${esc(heading)}</p>` : '') + questions.map((q, i) => `
      <div class="q">
        <p class="q-text" id="qt${i}">${esc(q.text)}</p>
        <div class="q-row"><input type="range" id="q${i}" min="${q.min}" max="${q.max}" step="1" value="${Math.round((+q.min + +q.max) / 2)}" aria-labelledby="qt${i}"><span class="q-val empty" id="qv${i}">—</span></div>
        <div class="q-labels"><span>${esc(q.min)}　${esc(q.min_label)}</span><span>${esc(q.max_label)}　${esc(q.max)}</span></div>
      </div>`).join('') + '<p class="q-err" id="qerr" hidden>每一題都請先拖曳或點一下滑桿。</p><button class="primary" id="qok" type="button">繼續</button>';
    const touched = new Set();
    questions.forEach((q, i) => {
      const inp = $('#q' + i), val = $('#qv' + i);
      const mark = () => { touched.add(i); val.textContent = inp.value; val.classList.remove('empty'); $('#qerr').hidden = true; };
      inp.addEventListener('input', mark);
      inp.addEventListener('pointerdown', mark);
      inp.addEventListener('keydown', mark);
    });
    panel.hidden = false;
    $('#qok').addEventListener('click', () => {
      if (touched.size < questions.length) { $('#qerr').hidden = false; return; }
      const answers = questions.map((q, i) => {
        const v = Number($('#q' + i).value);
        log('rating', q.id, v);
        return { ...q, value: v, t: now() };
      });
      panel.hidden = true;
      resolve(answers);
    });
  });
}

function showPoem(a) {
  return new Promise(resolve => {
    const box = $('#poem-box');
    const lines = a.poem.split(/[，,。.；;]/).map(s => s.trim()).filter(Boolean);
    box.innerHTML = `<div class="poem-lines">${lines.map(l => `<span>${esc(l)}</span>`).join('')}</div>
      <p class="poem-src">${esc(a.poem_source)}</p>
      ${a.poem_note ? `<p class="poem-note">${esc(a.poem_note)}</p>` : ''}
      <button id="pok" type="button" class="ghost" hidden>繼續</button>`;
    box.hidden = false;
    log('poem_shown', a.id);
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('on')));
    setTimeout(() => { const b = $('#pok'); b.hidden = false; b.focus(); }, 3400);
    $('#pok').addEventListener('click', () => {
      box.classList.remove('on');
      setTimeout(() => { box.hidden = true; resolve(); }, 600);
    });
  });
}

/* =====================================================================
   CAMERA HELPERS
   ===================================================================== */
async function lookTo(yaw, pitch, dur = 1.4) {
  const y0 = look.yaw, p0 = look.pitch, dy = angDiff(y0, yaw);
  await tw(dur, k => { look.yaw = y0 + dy * k; look.pitch = lerp(p0, pitch, k); applyLook(); });
}
const yawTo = v => Math.atan2(-(v.x - camera.position.x), -(v.z - camera.position.z));
const pitchTo = v => Math.atan2(v.y - camera.position.y, Math.hypot(v.x - camera.position.x, v.z - camera.position.z));
const lookAt = (v, dur) => lookTo(yawTo(v), pitchTo(v), dur);
const mid = (a, b, y = 0) => new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2);
const BED_TOP = new THREE.Vector3(BED.x, BED.y, BED.z);

/* =====================================================================
   STAGES: each `target` in actions.csv maps to one behaviour here
   ===================================================================== */
const BEHAVIOURS = {
  /* 序：久在樊籠裡，復得返自然 */
  async gate(a) {
    await waitTap(a.id, gate, new THREE.Vector3(0, 0.03, 5.25));
    oneShot('creak');
    log('gate_open', a.id);
    setScape('garden', 5);
    await tw(2.2, k => { gate[0].rotation.y = 1.55 * k; gate[1].rotation.y = -1.55 * k; });
    say('');
    const from = camera.position.clone();
    const steps = setInterval(() => oneShot('step'), 620);
    await tw(4.2, k => { camera.position.lerpVectors(from, STAND, k); camera.position.y += Math.sin(k * Math.PI * 7) * 0.012; });
    clearInterval(steps);
    await lookAt(BED_TOP, 1.6);
  },

  /* 晨：晨興理荒穢 */
  async weeds(a) {
    await lookAt(BED_TOP, 1.2);
    const left = () => weeds.filter(w => !w.userData.pulled);
    while (left().length) {
      say(`${a.instruction}（還剩 ${left().length} 叢）`);
      const next = left()[0];
      const obj = await waitTap(a.id, left(), new THREE.Vector3(next.position.x, next.position.y + 0.01, next.position.z));
      const w = weeds.find(x => isInside(obj, x));
      w.userData.pulled = true;
      log('weed_pulled', a.id, weeds.indexOf(w));
      oneShot('pull');
      const y0 = w.position.y;
      await tw(0.7, k => { w.position.y = y0 + k * 0.35; w.rotation.z = k * 0.6; const s = 1 - k * 0.85; w.scale.set(s, s, s); });
      w.visible = false;
    }
    say('');
    await wait(600);
  },

  /* 午：種豆南山下 */
  async sow(a) {
    await lookAt(mid(standL, BED, 0.3), 1.4);
    await waitTap(a.id, [pouch], new THREE.Vector3(standL.x, 0.47, standL.z));
    const home = pouch.position.clone();
    for (const [i, h] of HOLES.entries()) {
      const from = pouch.position.clone(), over = new THREE.Vector3(h.x - 0.02, BED.y + 0.32, h.z);
      await tw(i ? 0.6 : 1.2, k => { pouch.position.lerpVectors(from, over, k); pouch.position.y += Math.sin(k * Math.PI) * (i ? 0.03 : 0.15); pouch.rotation.z = k * 0.9; });
      const b = beans[i], b0 = new THREE.Vector3(over.x + 0.08, over.y + 0.14, over.z);
      oneShot('seed');
      await tw(0.45, k => { b.position.set(lerp(b0.x, h.x, k), lerp(b0.y, h.y + 0.012, k * k), lerp(b0.z, h.z, k)); }, k => k);
      log('bean_sown', a.id, i);
    }
    const end = pouch.position.clone();
    await tw(1.0, k => { pouch.position.lerpVectors(end, home, k); pouch.rotation.z = lerp(0.9, 0, k); });

    say(a.instruction_2 || '點一下澆水壺，替豆子澆水。');
    await lookAt(mid(standR, BED, 0.3), 1.4);
    await waitTap(a.id + '_water', [can], new THREE.Vector3(standR.x, 0.47, standR.z));
    const from = can.position.clone(), over = new THREE.Vector3(BED.x - 0.34, 0.74, BED.z);
    const r0 = can.rotation.y;
    await tw(1.4, k => { can.position.lerpVectors(from, over, k); can.rotation.y = lerp(r0, 0, k); });
    await tw(0.6, k => { can.rotation.z = lerp(0, -0.55, k); });
    G.water.on = true; drops.visible = true; waterSound(true);
    log('watered', a.id);
    sprouts.forEach(s => { s.visible = true; });
    await tw(3.4, k => {
      sprouts.forEach((s, i) => { const kk = THREE.MathUtils.clamp(k * 1.4 - i * 0.2, 0, 1); s.scale.setScalar(Math.max(0.001, kk)); });
      over.x = BED.x - 0.34 + Math.sin(k * Math.PI * 2) * 0.12; can.position.x = over.x;
    });
    G.water.on = false; waterSound(false);
    await tw(0.6, k => { can.rotation.z = lerp(-0.55, 0, k); });
    await wait(400);
    drops.visible = false;
    const back = can.position.clone();
    await tw(1.2, k => { can.position.lerpVectors(back, from, k); can.rotation.y = lerp(0, r0, k); });
  },

  /* 暮：帶月荷鋤歸，道狹草木長 */
  async hoe(a) {
    await lookAt(new THREE.Vector3(hoe.position.x, 0.5, hoe.position.z), 1.4);
    await waitTap(a.id, [hoe], new THREE.Vector3(hoe.position.x, 0.03, hoe.position.z + 0.12));
    log('hoe_taken', a.id);
    camera.attach(hoe);
    const p0 = hoe.position.clone(), q0 = hoe.quaternion.clone();
    const p1 = new THREE.Vector3(0.34, -1.05, -0.75), q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, 0.2, -0.55));
    await tw(1.3, k => { hoe.position.lerpVectors(p0, p1, k); hoe.quaternion.slerpQuaternions(q0, q1, k); });

    say('沿著小徑，慢慢走回家。');
    locked = true;
    const pts = [[0, 3.6], [-0.7, 3.05], [-1.55, 2.25], [-2.25, 0.5], [-2.1, -2], [-1.7, -4.3], [-1.5, -5.6]];
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 1.42, z)));
    const dur = 15;
    log('walk_start', a.id);
    G.setEnv('night', dur - 1);
    const y0 = look.yaw, p0p = look.pitch;
    const steps = setInterval(() => oneShot('step'), 640);
    await tw(dur, k => {
      const p = curve.getPointAt(k), ahead = curve.getPointAt(Math.min(1, k + 0.05));
      camera.position.copy(p);
      camera.position.y += Math.sin(k * dur * Math.PI * 1.6) * 0.014;
      const want = Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z));
      const blendIn = Math.min(1, k * 6);
      look.yaw = (k < 0.98 ? y0 + angDiff(y0, want) * blendIn : look.yaw);
      look.pitch = lerp(p0p, 0.02, Math.min(1, k * 4));
      applyLook();
    }, k => k);
    clearInterval(steps);
    log('walk_end', a.id);
    setScape('night', 4);
    locked = false;
    await lookTo(yawTo(HUT), 0.2, 2.2);
    say('');
    await wait(1200);
  },

  /* 結：夕露沾我衣 */
  async linger(a) {
    await lookTo(look.yaw + Math.PI, -0.32, 3.2);
    await tw(3, k => { dewMat.uniforms.strength.value = k; });
    const t0 = now();
    await new Promise(resolve => {
      card.innerHTML = `<p class="eyebrow">${esc(a.name)}</p><p class="lede">${esc(a.instruction)}</p><button class="ghost" id="lok" type="button" hidden>好了</button>`;
      panel.hidden = false;
      setTimeout(() => { const b = $('#lok'); if (b) { b.hidden = false; b.focus(); } }, 8000);
      $('#lok').addEventListener('click', () => { panel.hidden = true; resolve(); });
    });
    log('linger', a.id, now() - t0);
    say('');
  },
};

/* =====================================================================
   SESSION FLOW
   ===================================================================== */
let viewTimer = 0;
async function runSession() {
  state.log = [];
  state.t0 = performance.now();
  state.running = true;
  log('session_start', '', new Date().toISOString());
  log('soundscape', 'city');
  viewTimer = setInterval(() => log('view', '', `${look.yaw.toFixed(2)};${look.pitch.toFixed(2)}`), 1000);
  $('#hud').hidden = false;

  const pre = state.questions.filter(q => q.phase === 'pre');
  const post = state.questions.filter(q => q.phase === 'post');
  $('#step').textContent = '開始之前';
  say('先感受一下此刻的自己。');
  await askSliders(pre, '開始之前');

  for (const [i, a] of state.actions.entries()) {
    $('#step').textContent = `第 ${i + 1} / ${state.actions.length} 段・${a.name}`;
    say(a.instruction);
    log('action_start', a.id);
    if (a.time_of_day) G.setEnv(a.time_of_day, 6);
    const run = BEHAVIOURS[a.target];
    if (run) await run(a);
    else console.warn(`actions.csv: unknown target "${a.target}" for ${a.id}`);
    log('action_complete', a.id);
    say('');
    await showPoem(a);
    await askSliders([{ id: 'relax_after_' + a.id, text: a.rating_prompt || '此刻你有多放鬆？', min: 0, max: 10, min_label: '完全不放鬆', max_label: '非常放鬆' }], a.name + '之後');
  }

  $('#step').textContent = '結束';
  say('最後，回想剛才在園子裡的這一天。');
  await askSliders(post, '體驗之後');
  log('session_end');
  clearInterval(viewTimer);
  state.running = false;
  $('#hud').hidden = true;
  showResult();
}

/* =====================================================================
   RESULT: relaxation over the session, with each stage marked
   ===================================================================== */
function showResult() {
  const ratings = state.log.filter(e => e.type === 'rating');
  const relax = ratings.filter(e => e.id.startsWith('relax'));
  const done = state.log.filter(e => e.type === 'action_complete');
  const end = state.log.at(-1).t || 1;
  const W = 640, H = 300, L = 52, R = 60, T = 36, B = 48;
  const X = t => L + (t / end) * (W - L - R), Y = v => T + (1 - v / 10) * (H - T - B);
  const label = id => {
    if (id === 'relax_pre') return '開始前';
    if (id === 'relax_post') return '結束時';
    const a = state.actions.find(x => 'relax_after_' + x.id === id);
    return a ? a.name : id;
  };
  const name = id => (state.actions.find(a => a.id === id) || {}).name || id;
  const pts = relax.map(e => [X(e.t), Y(Number(e.value))]);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="放鬆程度隨活動進行的變化">
    ${[0, 2, 4, 6, 8, 10].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(34,48,42,.1)"/><text x="${L - 10}" y="${Y(v) + 4}" text-anchor="end" font-size="13" fill="#55665c">${v}</text>`).join('')}
    <text x="14" y="${T + (H - T - B) / 2}" font-size="12" fill="#55665c" transform="rotate(-90 14 ${T + (H - T - B) / 2})" text-anchor="middle">放鬆程度（0–10）</text>
    ${done.map((e, i) => `<line x1="${X(e.t)}" x2="${X(e.t)}" y1="${T}" y2="${H - B}" stroke="#b5762a" stroke-dasharray="4 4"/><text x="${X(e.t)}" y="${H - B + (i % 2 ? 34 : 18)}" text-anchor="middle" font-size="13" fill="#b5762a">${esc(name(e.id))}</text>`).join('')}
    <polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#3d6b52" stroke-width="2.5"/>
    ${relax.map((e, i) => `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="5" fill="#3d6b52"/><text x="${pts[i][0]}" y="${pts[i][1] + (i % 2 ? 24 : -12)}" text-anchor="middle" font-size="13" font-weight="500" fill="#22302a">${esc(label(e.id))} ${e.value}</text>`).join('')}
    <text x="${W - R}" y="${T - 14}" text-anchor="end" font-size="12" fill="#55665c">經過時間 ${Math.round(end / 1000)} 秒</text>
  </svg>`;
  $('#timeline').innerHTML = svg;
  const extra = ratings.filter(e => e.id.startsWith('prs_'));
  $('#post-scores').innerHTML = extra.map(e => {
    const q = state.questions.find(x => x.id === e.id) || {};
    return `<div class="score">${esc(q.subscale || e.id)}<b>${e.value}</b></div>`;
  }).join('');
  $('#result').hidden = false;
}

function downloadCSV() {
  const rows = [['t_ms', 'type', 'id', 'value'], ...state.log.map(e => [e.t, e.type, e.id, e.value])];
  const csv = '﻿' + rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  a.href = url;
  a.download = `virtual-garden-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =====================================================================
   BOOT
   ===================================================================== */
$('#download').addEventListener('click', downloadCSV);
$('#restart').addEventListener('click', () => location.reload());
$('#start').addEventListener('click', () => {
  audioInit();
  $('#title').hidden = true;
  runSession();
});

loadData().then(() => {
  const b = $('#start');
  b.disabled = false;
  b.textContent = '推開柴門';
}).catch(err => {
  console.error(err);
  const e = $('#load-error');
  e.hidden = false;
  e.textContent = '無法讀取 data/ 資料夾裡的 CSV 檔。請透過 GitHub Pages 網址或本機伺服器開啟，不能直接雙擊 index.html。';
  $('#start').textContent = '無法開始';
});
