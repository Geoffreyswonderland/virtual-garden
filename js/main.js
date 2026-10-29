import * as THREE from 'three';
import { parseCSV } from './csv.js';
import { createGarden } from './garden.js';

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
const { scene, camera, look, LIMIT, applyLook, BED, standL, standR, seedling, leaves, can, flowers, MOUNTAIN, marker, drops } = G;

/* =====================================================================
   TWEENS AND LOOP
   ===================================================================== */
const tweens = [];
const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const tw = (dur, fn) => new Promise(done => tweens.push({ t: 0, dur, fn, done }));
const wait = ms => new Promise(r => setTimeout(r, ms));
const lerp = (a, b, k) => a + (b - a) * k;

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i];
    w.t += dt;
    const k = Math.min(1, w.t / w.dur);
    w.fn(ease(k));
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
let drag = null, active = null;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.moved > 6) {
    canvas.classList.add('dragging');
    look.yaw = THREE.MathUtils.clamp(drag.yaw + dx * 0.004, LIMIT.yawMin, LIMIT.yawMax);
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
   AMBIENT SOUND (synthesised for the prototype; the research version
   will use loudness-matched field recordings)
   ===================================================================== */
const AU = { ctx: null, master: null, on: true, birdTimer: 0 };
function noiseBuffer(ctx, brown) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
function audioInit() {
  if (AU.ctx) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  AU.ctx = ctx;
  AU.master = ctx.createGain();
  AU.master.gain.value = 0.7;
  AU.master.connect(ctx.destination);
  // wind
  const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(ctx, true); wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420;
  const wg = ctx.createGain(); wg.gain.value = 0.22;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lg = ctx.createGain(); lg.gain.value = 0.1;
  lfo.connect(lg).connect(wg.gain);
  wind.connect(wf).connect(wg).connect(AU.master);
  // a small stream on the left
  const st = ctx.createBufferSource(); st.buffer = noiseBuffer(ctx, false); st.loop = true;
  const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1300; sf.Q.value = 0.7;
  const sg = ctx.createGain(); sg.gain.value = 0.045;
  const sp = ctx.createStereoPanner(); sp.pan.value = -0.6;
  st.connect(sf).connect(sg).connect(sp).connect(AU.master);
  setInterval(() => sf.frequency.setTargetAtTime(1000 + Math.random() * 700, ctx.currentTime, 0.4), 700);
  wind.start(); st.start(); lfo.start();
  scheduleBird();
}
function chirp() {
  const C = AU.ctx, pan = C.createStereoPanner();
  pan.pan.value = Math.random() * 1.8 - 0.9;
  pan.connect(AU.master);
  let t = C.currentTime + 0.05;
  const base = 2300 + Math.random() * 1500, n = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const o = C.createOscillator(), g = C.createGain(), dur = 0.05 + Math.random() * 0.1;
    const f0 = base * (0.85 + Math.random() * 0.5);
    o.type = 'sine';
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
  AU.birdTimer = setTimeout(() => { chirp(); scheduleBird(); }, 2500 + Math.random() * 5500);
}
function waterSound(on) {
  if (!AU.ctx) return;
  if (on) {
    const C = AU.ctx, s = C.createBufferSource(); s.buffer = noiseBuffer(C, false); s.loop = true;
    const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = C.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.06, C.currentTime + 0.4);
    s.connect(f).connect(g).connect(AU.master); s.start();
    AU.water = { s, g };
  } else if (AU.water) {
    const { s, g } = AU.water, C = AU.ctx;
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
    const lines = a.poem.split(/[，,]/).map(s => s.replace(/[。.]$/, '')).filter(Boolean);
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
   ACTIONS: each `target` in actions.csv maps to one behaviour here
   ===================================================================== */
async function lookTo(yaw, pitch, dur = 1.4) {
  const y0 = look.yaw, p0 = look.pitch;
  await tw(dur, k => { look.yaw = lerp(y0, yaw, k); look.pitch = lerp(p0, pitch, k); applyLook(); });
}
const yawTo = v => Math.atan2(-(v.x - camera.position.x), -(v.z - camera.position.z));
const pitchTo = v => Math.atan2(v.y - camera.position.y, Math.hypot(v.x - camera.position.x, v.z - camera.position.z));

const BEHAVIOURS = {
  async seedling(a) {
    await lookTo(-0.12, -0.5);
    await waitTap(a.id, [seedling], new THREE.Vector3(standL.x, 0.75, standL.z));
    const from = seedling.position.clone(), to = new THREE.Vector3(BED.x, BED.y + 0.08, BED.z);
    await tw(1.6, k => { seedling.position.lerpVectors(from, to, k); seedling.position.y += Math.sin(k * Math.PI) * 0.35; });
    await tw(0.5, k => { seedling.position.y = lerp(to.y, BED.y - 0.02, k); });
  },
  async can(a) {
    await lookTo(0.12, -0.5);
    await waitTap(a.id, [can], new THREE.Vector3(standR.x, 0.78, standR.z));
    const from = can.position.clone(), over = new THREE.Vector3(BED.x - 0.32, 0.72, BED.z);
    const r0 = can.rotation.y;
    await tw(1.4, k => { can.position.lerpVectors(from, over, k); can.rotation.y = lerp(r0, 0, k); });
    await tw(0.6, k => { can.rotation.z = lerp(0, -0.55, k); });
    G.water.on = true; drops.visible = true; waterSound(true);
    leaves.forEach(l => { l.visible = true; l.scale.set(0.01, 0.01, 0.01); });
    await tw(3.2, k => {
      const s = 1 + k * 1.3;
      seedling.scale.set(s, s, s);
      leaves.forEach(l => l.scale.set(1.2 * k, 0.28 * k, 0.6 * k));
    });
    G.water.on = false; waterSound(false);
    await tw(0.6, k => { can.rotation.z = lerp(-0.55, 0, k); });
    await wait(400);
    drops.visible = false;
    await tw(1.2, k => { can.position.lerpVectors(over, from, k); can.rotation.y = lerp(0, r0, k); });
  },
  async flower(a) {
    const first = flowers[1].g.getWorldPosition(new THREE.Vector3());
    await lookTo(yawTo(first) - 0.15, -0.3);
    const target = flowers[2].g.getWorldPosition(new THREE.Vector3());
    const obj = await waitTap(a.id, flowers.filter(f => !f.picked).map(f => f.g), new THREE.Vector3(target.x, 0.95, target.z));
    const f = flowers.find(x => isInside(obj, x.g));
    f.picked = true;
    log('flower_picked', a.id, flowers.indexOf(f));
    const head = f.head;
    const start = head.getWorldPosition(new THREE.Vector3());
    scene.attach(head);
    const end = camera.localToWorld(new THREE.Vector3(0.18, -0.25, -0.9));
    await tw(1.6, k => { head.position.lerpVectors(start, end, k); head.rotation.x = lerp(0.5, 1.4, k); });
    await wait(500);
    await tw(0.8, k => { const s = 1 - k; head.scale.set(s, s, s); });
    head.visible = false;
    // 悠然見南山: turn slowly towards the mountain and linger
    log('view_mountain', a.id);
    await lookTo(yawTo(MOUNTAIN), pitchTo(new THREE.Vector3(MOUNTAIN.x, 4, MOUNTAIN.z)), 3.5);
    await wait(2500);
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
  viewTimer = setInterval(() => log('view', '', `${look.yaw.toFixed(2)};${look.pitch.toFixed(2)}`), 1000);
  $('#hud').hidden = false;

  const pre = state.questions.filter(q => q.phase === 'pre');
  const post = state.questions.filter(q => q.phase === 'post');
  $('#step').textContent = '開始之前';
  $('#instruction').textContent = '先感受一下此刻的自己。';
  await askSliders(pre, '開始之前');

  for (const [i, a] of state.actions.entries()) {
    $('#step').textContent = `第 ${i + 1} / ${state.actions.length} 段・${a.name}`;
    $('#instruction').textContent = a.instruction;
    log('action_start', a.id);
    const run = BEHAVIOURS[a.target];
    if (run) await run(a);
    else console.warn(`actions.csv: unknown target "${a.target}" for ${a.id}`);
    log('action_complete', a.id);
    $('#instruction').textContent = '';
    await showPoem(a);
    await askSliders([{ id: 'relax_after_' + a.id, text: a.rating_prompt || '此刻你有多放鬆？', min: 0, max: 10, min_label: '完全不放鬆', max_label: '非常放鬆' }], a.name + '之後');
  }

  $('#step').textContent = '結束';
  $('#instruction').textContent = '最後，回想剛才在小園裡的體驗。';
  await askSliders(post, '體驗之後');
  log('session_end');
  clearInterval(viewTimer);
  state.running = false;
  $('#hud').hidden = true;
  showResult();
}

/* =====================================================================
   RESULT: relaxation over the session, with each action marked
   ===================================================================== */
function showResult() {
  const ratings = state.log.filter(e => e.type === 'rating');
  const relax = ratings.filter(e => e.id.startsWith('relax'));
  const done = state.log.filter(e => e.type === 'action_complete');
  const end = state.log.at(-1).t || 1;
  const W = 680, H = 280, L = 56, R = 24, T = 24, B = 48;
  const X = t => L + (t / end) * (W - L - R), Y = v => T + (1 - v / 10) * (H - T - B);
  const label = id => {
    if (id === 'relax_pre') return '開始前';
    if (id === 'relax_post') return '結束時';
    const a = state.actions.find(x => 'relax_after_' + x.id === id);
    return a ? a.name + '後' : id;
  };
  const name = id => (state.actions.find(a => a.id === id) || {}).name || id;
  const pts = relax.map(e => [X(e.t), Y(Number(e.value))]);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="放鬆程度隨活動進行的變化">
    ${[0, 2, 4, 6, 8, 10].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(34,48,42,.1)"/><text x="${L - 10}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="#55665c">${v}</text>`).join('')}
    <text x="14" y="${T + (H - T - B) / 2}" font-size="12" fill="#55665c" transform="rotate(-90 14 ${T + (H - T - B) / 2})" text-anchor="middle">放鬆程度（0–10）</text>
    ${done.map(e => `<line x1="${X(e.t)}" x2="${X(e.t)}" y1="${T}" y2="${H - B}" stroke="#b5762a" stroke-dasharray="4 4"/><text x="${X(e.t)}" y="${H - B + 18}" text-anchor="middle" font-size="12.5" fill="#b5762a">${esc(name(e.id))}</text>`).join('')}
    <polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#3d6b52" stroke-width="2.5"/>
    ${relax.map((e, i) => `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="5" fill="#3d6b52"/><text x="${pts[i][0]}" y="${pts[i][1] - 12}" text-anchor="middle" font-size="12" fill="#22302a">${esc(label(e.id))} ${e.value}</text>`).join('')}
    <text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="12" fill="#55665c">經過時間 ${Math.round(end / 1000)} 秒</text>
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
  b.textContent = '走進小園';
}).catch(err => {
  console.error(err);
  const e = $('#load-error');
  e.hidden = false;
  e.textContent = '無法讀取 data/ 資料夾裡的 CSV 檔。請透過 GitHub Pages 網址或本機伺服器開啟，不能直接雙擊 index.html。';
  $('#start').textContent = '無法開始';
});
