import * as THREE from 'three';
import { parseCSV } from './csv.js?v=16';
import { createWorld } from './world/index.js?v=44';
import { createControls } from './controls.js?v=44';
import { audioInit, setScape, oneShot, waterSound, toggleSound, chime } from './audio.js?v=44';
import { L, PATHS, APPROACH, EYE, NARROW, NARROW_Z0, NARROW_Z1 } from './world/layout.js?v=44';
import { pathDist, narrowDist, grassDensity } from './world/grass.js?v=44';
import { ENV, MOON_DIR } from './world/env.js?v=44';

/* =====================================================================
   STATE AND EVENT LOG
   Every meaningful moment is written to state.log with a time stamp in
   milliseconds since the session started, so the whole visit can be
   reconstructed and aligned with other data (e.g. a heart-rate strap).
   ===================================================================== */
const $ = s => document.querySelector(s);
const state = { actions: [], questions: [], poems: [], collected: new Map(), log: [], t0: 0, running: false, stage: -1, autoWalks: 0, gateOpen: false, trail: [], wet: 0 };
const now = () => Math.round(performance.now() - state.t0);
const log = (type, id = '', value = '') => state.log.push({ t: now(), type, id, value: String(value) });
const hooks = new Set();   // per-frame callbacks used by stages

async function loadData() {
  const get = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(u); return r.text(); });
  const [a, q, p] = await Promise.all([get('data/actions.csv'), get('data/questions.csv'), get('data/poems.csv')]);
  state.actions = parseCSV(a).sort((x, y) => Number(x.order) - Number(y.order));
  state.questions = parseCSV(q);
  state.poems = parseCSV(p).sort((x, y) => Number(x.order) - Number(y.order));
}

/* =====================================================================
   WORLD AND PLAYER
   ===================================================================== */
const canvas = $('#scene');
const W = createWorld(canvas);
const { scene, camera, parts, env } = { ...W, env: W.env };

function isWalkable(x, z) {
  const { lane, fence, gate } = L;
  if (x > lane.x0 && x < lane.x1 && z > lane.z0 && z < lane.z1) return true;
  if (!state.gateOpen) return false;
  if (Math.abs(x) < gate.half - 0.12 && z > fence.z1 - 0.6 && z < fence.z1 + 0.6) return true;
  // the back gate, and the footpath and bean field beyond it
  const bg = L.backGate, b = L.beans;
  if (Math.abs(x - bg.x) < bg.half - 0.1 && z > fence.z0 - 0.6 && z < fence.z0 + 0.6) return true;
  if (x > b.x - b.w / 2 - 1.6 && x < b.x + b.w / 2 + 1.6 && z > b.z - b.d / 2 - 0.8 && z < fence.z0 - 0.35) return true;
  return x > fence.x0 + 0.4 && x < fence.x1 - 0.4 && z > fence.z0 + 0.4 && z < fence.z1 - 0.35;
}
const controls = createControls({
  camera, canvas, colliders: W.colliders, isWalkable,
  onTap: (x, y) => handleTap(x, y),
  onUserMove: what => log('auto_walk', '', what),
});
controls.place(L.start[0], L.start[1], 0, -0.04);

/* ---------- a soft column of light over the current target ---------- */
const beacon = new THREE.Group();
{
  const colMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: env.time, color: { value: new THREE.Color(1, 0.9, 0.65) }, fade: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime, fade; uniform vec3 color; varying vec2 vUv;
      void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * (0.55 + 0.25 * sin(uTime * 2.0 + vUv.y * 6.0)) * (0.6 + 0.2 * sin(vUv.x * 6.2831 * 3.0 + uTime) + 0.2);
        a = clamp(a, 0.0, 1.0);
        a *= fade; gl_FragColor = vec4(color * a * 0.5, a * 0.5); }`,
  });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 3.2, 24, 1, true), colMat);
  col.position.y = 1.6;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 40), new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  beacon.add(col, ring);
  beacon.userData.ring = ring;
  beacon.userData.col = colMat;
  beacon.visible = false;
  scene.add(beacon);
}
let skyTarget = null;   // a direction in the sky (the moon), shown with the same edge arrow
let target = null;  // { pos: Vector3, approach: [x,z] }
function setTarget(pos, approachKey) {
  target = pos ? { pos: pos.clone(), approach: APPROACH[approachKey] || [pos.x, pos.z] } : null;
  beacon.visible = !!pos;
  if (pos) beacon.position.set(pos.x, 0, pos.z);
  $('#guide-me').hidden = !pos;
}

/* ---------- water drops from the ladle ---------- */
const DROPS = 160, dropGeo = new THREE.BufferGeometry(), dropVel = new Float32Array(DROPS * 3);
dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 3).fill(-10), 3));
const dropTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ map: dropTex, color: 0xd6ecf5, size: 0.035, transparent: true, depthWrite: false }));
drops.frustumCulled = false;
drops.visible = false;
scene.add(drops);
const pour = { on: false, from: new THREE.Vector3(), to: new THREE.Vector3() };
// soil crumbs flying up when a weed comes out
const CR = 60, crumbGeo = new THREE.BufferGeometry(), crumbVel = new Float32Array(CR * 3);
crumbGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CR * 3).fill(-10), 3));
const crumbs = new THREE.Points(crumbGeo, new THREE.PointsMaterial({ color: 0x4a3526, size: 0.025 }));
crumbs.frustumCulled = false;
scene.add(crumbs);
function burst(p) {
  const a = crumbGeo.attributes.position.array;
  for (let i = 0; i < CR; i++) {
    a[i * 3] = p.x + (Math.random() - 0.5) * 0.08; a[i * 3 + 1] = p.y + 0.02; a[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.08;
    crumbVel[i * 3] = (Math.random() - 0.5) * 1.2; crumbVel[i * 3 + 1] = 0.6 + Math.random() * 1.2; crumbVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
  }
  crumbGeo.attributes.position.needsUpdate = true;
}
hooks.add(dt => {
  const a = crumbGeo.attributes.position.array;
  for (let i = 0; i < CR; i++) {
    if (a[i * 3 + 1] < -5) continue;
    crumbVel[i * 3 + 1] -= 9.8 * dt;
    a[i * 3] += crumbVel[i * 3] * dt; a[i * 3 + 1] += crumbVel[i * 3 + 1] * dt; a[i * 3 + 2] += crumbVel[i * 3 + 2] * dt;
    if (a[i * 3 + 1] < 0.12 && crumbVel[i * 3 + 1] < 0) a[i * 3 + 1] = -10;
  }
  crumbGeo.attributes.position.needsUpdate = true;
});
function updateDrops(dt) {
  const p = dropGeo.attributes.position.array;
  for (let i = 0; i < DROPS; i++) {
    const j = i * 3;
    dropVel[j + 1] -= 9.8 * dt;
    p[j] += dropVel[j] * dt; p[j + 1] += dropVel[j + 1] * dt; p[j + 2] += dropVel[j + 2] * dt;
    if (p[j + 1] < 0.12) {
      if (pour.on && Math.random() < 0.5) {
        p[j] = pour.from.x + (Math.random() - 0.5) * 0.03; p[j + 1] = pour.from.y; p[j + 2] = pour.from.z + (Math.random() - 0.5) * 0.03;
        const t = 0.45, dx = pour.to.x - pour.from.x, dz = pour.to.z - pour.from.z;
        dropVel[j] = dx / t + (Math.random() - 0.5) * 0.4; dropVel[j + 1] = 0.3 + Math.random() * 0.3; dropVel[j + 2] = dz / t + (Math.random() - 0.5) * 0.4;
      } else p[j + 1] = -10;
    }
  }
  dropGeo.attributes.position.needsUpdate = true;
}

/* =====================================================================
   TWEENS AND THE FRAME LOOP
   ===================================================================== */
const tweens = [];
const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const tw = (dur, fn, curve = ease) => new Promise(done => tweens.push({ t: 0, dur, fn, curve, done }));
const wait = ms => new Promise(r => setTimeout(r, ms));
const lerp = (a, b, k) => a + (b - a) * k;

const DEBUG = new URLSearchParams(location.search).has('debug');
const clock = new THREE.Clock();
let stepAcc = 0, posTimer = 0, perf = { frames: 0, time: 0, done: false };
function frame() {
  const dt = Math.min(clock.getDelta(), DEBUG ? 0.5 : 0.05), t = clock.elapsedTime;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i];
    w.t += dt;
    const k = Math.min(1, w.t / w.dur);
    w.fn(w.curve(k));
    if (k >= 1) { tweens.splice(i, 1); w.done(); }
  }
  const moved = controls.update(dt);
  if (moved > 0) {
    stepAcc += moved;
    if (stepAcc > 0.68) {
      stepAcc = 0;
      const onDirt = pathDist(controls.st.x, controls.st.z) < 0.7 || controls.st.z > L.fence.z1;
      oneShot(onDirt ? 'stepDirt' : 'stepGrass', 0.8);
    }
  }
  if (state.running) {
    posTimer += dt;
    if (posTimer > 0.5) {
      posTimer = 0;
      const { x, z, yaw } = controls.st;
      log('pos', state.stage >= 0 ? state.actions[state.stage]?.id || '' : 'pre', `${x.toFixed(2)};${z.toFixed(2)};${yaw.toFixed(2)}`);
      state.trail.push([x, z, state.stage]);
    }
    if (!perf.done) {
      perf.frames++; perf.time += dt;
      if (perf.time > 5) {
        perf.done = true;
        const fps = perf.frames / perf.time;
        log('perf', W.tier, fps.toFixed(1));
        if (fps < 26) { W.env.renderer.setPixelRatio(1); W.resize(); log('perf', 'lowered_resolution'); }
      }
    }
  }
  hooks.forEach(h => h(dt, t));
  if (beacon.visible) {
    const s = 1 + Math.sin(t * 3) * 0.08;
    beacon.userData.ring.scale.set(s, s, s);
    const d = Math.hypot(beacon.position.x - controls.st.x, beacon.position.z - controls.st.z);
    beacon.userData.col.uniforms.fade.value = Math.min(1, Math.max(0, (d - 2.2) / 3));
  }
  if (drops.visible) updateDrops(dt);
  updateNear();
  updateEdge();
  W.update(dt, t);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', W.resize);
W.resize();

/* =====================================================================
   HUD
   ===================================================================== */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAYPOS = { morning: 0.08, noon: 0.42, dusk: 0.72, night: 0.95 };
function setChapter(step, title, tod) {
  $('#chap-step').textContent = step;
  $('#chap-title').textContent = title;
  if (tod in DAYPOS) $('#day-dot').style.left = `${DAYPOS[tod] * 100}%`;
}
function setTask(title, text) {
  $('#task').hidden = !title;
  $('#task-title').textContent = title || '';
  $('#task-text').textContent = text || '';
  if (!title) setSteps(null);
}
/** a row of numbered steps under the task, the current one highlighted */
function setSteps(list, current = 0) {
  const el = $('#task-steps');
  if (!list) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = list.map((s, i) => `<li class="${i < current ? 'done' : i === current ? 'now' : ''}"><b>${i + 1}</b>${esc(s)}</li>`).join('');
}
/* ---------- a short how-to card, shown once for each new kind of action ---------- */
const coached = new Set();
function coach(key, title, lines) {
  if (coached.has(key)) return;
  coached.add(key);
  const c = $('#coach');
  c.innerHTML = `<p class="coach-title">${esc(title)}</p><ol>${lines.map(l => `<li>${l}</li>`).join('')}</ol><button type="button" class="btn-ghost" id="coach-ok">知道了</button>`;
  c.hidden = false;
  log('coach', key);
  $('#coach-ok').addEventListener('click', () => { c.hidden = true; }, { once: true });
}
const hideCoach = () => { $('#coach').hidden = true; };
function setHeld(name) { $('#held').textContent = name ? `手上：${name}` : ''; }

/* ---------- verses: each line appears where it happens, and is kept in the scroll ---------- */
const verseQueue = [];
let versePlaying = false;
function verse(id, how = '') {
  if (!state.running || state.collected.has(id)) return;
  const v = state.poems.find(p => p.id === id);
  if (!v) return;
  state.collected.set(id, now());
  log('verse', id, how);
  updateVerseCount();
  verseQueue.push(v);
  if (!versePlaying) playVerses();
}
async function playVerses() {
  versePlaying = true;
  const el = $('#verse');
  while (verseQueue.length) {
    const v = verseQueue.shift();
    el.innerHTML = `${v.group === 'explore' ? '<p class="v-tag">尋得詩箋</p>' : ''}<div class="v-lines">${v.text.split(/[，,]/).map(l => `<span>${esc(l)}</span>`).join('')}</div><p class="v-src">${esc(v.source)}</p>`;
    el.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    chime();
    await wait(5600);
    el.classList.remove('on');
    await wait(1000);
    el.hidden = true;
  }
  versePlaying = false;
}
function updateVerseCount() {
  const main = state.poems.filter(p => p.group === 'main'), ex = state.poems.filter(p => p.group === 'explore');
  const got = arr => arr.filter(p => state.collected.has(p.id)).length;
  $('#verse-count').textContent = `詩句 ${got(main)}／${main.length}・詩箋 ${got(ex)}／${ex.length}`;
}
function openScroll() {
  const row = p => state.collected.has(p.id)
    ? `<li class="got"><span class="s-text">${esc(p.text)}</span><span class="s-src">${esc(p.source)}</span></li>`
    : `<li><span class="s-text">${'○'.repeat(p.text.replace(/[，,]/g, '').length)}</span><span class="s-src">${esc(p.how)}</span></li>`;
  $('#scroll-main').innerHTML = state.poems.filter(p => p.group === 'main').map(row).join('');
  $('#scroll-explore').innerHTML = state.poems.filter(p => p.group === 'explore').map(row).join('');
  $('#scroll').hidden = false;
  log('scroll_open');
}
const insideHut = (x, z) => { const b = parts.interior.bounds; return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; };
// lines found by wandering (歸園田居其一 and 飲酒其五); never required
let gazeVillage = 0;
const lookDir = new THREE.Vector3();
hooks.add(dt => {
  if (!state.running || !controls.enabled) return;
  const { x, z } = controls.st;
  if (state.stage >= 1 && Math.hypot(x, z + 5.0) < 2.0) verse('e1', 'yard');
  if ((z < L.hut.z - L.hut.d / 2 - 0.3 && Math.abs(x) < 5) || L.peaches.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1.7)) verse('e2', z < L.hut.z ? 'behind' : 'peach');
  if (x > 7.9 && z > L.eastFence.z0 && z < L.eastFence.z1) verse('e5', 'east_fence');
  if (insideHut(x, z)) verse('e4', 'inside');
  camera.getWorldDirection(lookDir);
  const vx = -48 - x, vz = -47 - z, hl = Math.hypot(lookDir.x, lookDir.z) || 1;
  const dot = (lookDir.x * vx + lookDir.z * vz) / Math.hypot(vx, vz) / hl;
  if (dot > 0.975 && lookDir.y > -0.3) { gazeVillage += dt; if (gazeVillage > 1.5) verse('e3', 'gaze'); } else gazeVillage = Math.max(0, gazeVillage - dt);
  // standing a little higher on the hut floor
  controls.st.floorTarget = insideHut(x, z) ? parts.interior.floor : 0;
});
$('#btn-scroll').addEventListener('click', openScroll);
$('#scroll-close').addEventListener('click', () => { $('#scroll').hidden = true; });
let toastTimer = 0;
function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
function walkMode(on) {
  controls.enabled = on;
  $('#stick').hidden = !on;
  $('#keys-hint').hidden = !on;
  if (!on) { $('#act').hidden = true; $('#edge').hidden = true; }
}

/* ---------- the dialogue box ---------- */
const dlg = $('#dlg'), dlgBody = $('#dlg-body'), dlgActions = $('#dlg-actions');
function openDialogue(speaker, tag) {
  walkMode(false);
  $('#dlg-speaker').textContent = speaker || '';
  $('#dlg-tag').textContent = tag || '';
  dlg.hidden = false;
}
function closeDialogue() { dlg.hidden = true; }
function button(label, cls = 'btn-primary') {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = label;
  dlgActions.appendChild(b);
  return b;
}
async function say(speaker, tag, text, label = '繼續') {
  openDialogue(speaker, tag);
  dlgBody.className = 'dlg-body';
  dlgBody.textContent = '';
  dlgActions.innerHTML = '';
  let skip = false;
  const b = button(label);
  b.disabled = true;
  const skipper = () => { skip = true; };
  dlg.addEventListener('pointerdown', skipper);
  for (const ch of text) {
    if (skip) { dlgBody.textContent = text; break; }
    dlgBody.textContent += ch;
    await wait(/[，。、！？]/.test(ch) ? 160 : 42);
  }
  dlg.removeEventListener('pointerdown', skipper);
  b.disabled = false;
  b.focus();
  await new Promise(r => b.addEventListener('click', r, { once: true }));
  closeDialogue();
}
/** end of a stage: the lines found in it, and one gentle question, on one card */
function stageCard(a, tag) {
  const lines = state.poems.filter(p => p.stage === a.id && state.collected.has(p.id));
  return new Promise(resolve => {
    openDialogue('', tag);
    dlgBody.className = 'dlg-body';
    dlgBody.innerHTML = `<div class="recap">${lines.map(p => `<span>${esc(p.text)}</span>`).join('')}</div>
      <p class="rate-q" id="rq">${esc(a.rating_prompt || '此刻你有多放鬆？')}</p>
      <div class="rate-row"><input type="range" class="untouched" id="rin" min="0" max="10" step="1" value="5" aria-labelledby="rq"><span class="rate-val" id="rv">—</span></div>
      <div class="rate-labels"><span>0　完全不放鬆</span><span>非常放鬆　10</span></div>`;
    dlgActions.innerHTML = '';
    const b = button('繼續');
    b.disabled = true;
    const inp = $('#rin'), val = $('#rv');
    const mark = () => { inp.classList.remove('untouched'); val.textContent = inp.value; b.disabled = false; };
    ['input', 'pointerdown', 'keydown'].forEach(ev => inp.addEventListener(ev, mark));
    b.addEventListener('click', () => { log('rating', 'relax_after_' + a.id, inp.value); closeDialogue(); resolve(Number(inp.value)); }, { once: true });
  });
}
/** two-button choice in the dialogue box */
function choose(speaker, tag, text, labels) {
  return new Promise(resolve => {
    openDialogue(speaker, tag);
    dlgBody.className = 'dlg-body';
    dlgBody.textContent = text;
    dlgActions.innerHTML = '';
    labels.forEach((l, i) => { const b = button(l, i ? 'btn-ghost' : 'btn-primary'); b.addEventListener('click', () => { closeDialogue(); resolve(i); }, { once: true }); });
  });
}
async function showPoem(a, tag) {
  openDialogue('陶淵明', tag);
  const lines = a.poem.split(/[，,。.；;]/).map(s => s.trim()).filter(Boolean);
  dlgBody.className = 'dlg-body poem';
  dlgBody.innerHTML = `<div class="lines">${lines.map((l, i) => `<span style="animation-delay:${i * 0.9}s">${esc(l)}</span>`).join('')}</div>
    <div class="src">${esc(a.poem_source)}</div>${a.poem_note ? `<div class="note">${esc(a.poem_note)}</div>` : ''}`;
  dlgActions.innerHTML = '';
  log('poem_shown', a.id);
  const b = button('繼續');
  b.disabled = true;
  await wait(1200 + lines.length * 900);
  b.disabled = false;
  b.focus();
  await new Promise(r => b.addEventListener('click', r, { once: true }));
  closeDialogue();
}
function askRating(q, tag, count) {
  return new Promise(resolve => {
    openDialogue('此刻', tag);
    dlgBody.className = 'dlg-body';
    const mid = Math.round((+q.min + +q.max) / 2);
    dlgBody.innerHTML = `
      <p class="rate-q" id="rq">${esc(q.text)}${count ? ` <span class="rate-count">${esc(count)}</span>` : ''}</p>
      <div class="rate-row"><input type="range" class="untouched" id="rin" min="${q.min}" max="${q.max}" step="1" value="${mid}" aria-labelledby="rq"><span class="rate-val" id="rv">—</span></div>
      <div class="rate-labels"><span>${esc(q.min)}　${esc(q.min_label)}</span><span>${esc(q.max_label)}　${esc(q.max)}</span></div>`;
    dlgActions.innerHTML = '';
    const b = button('確定');
    b.disabled = true;
    const inp = $('#rin'), val = $('#rv');
    const mark = () => { inp.classList.remove('untouched'); val.textContent = inp.value; b.disabled = false; };
    ['input', 'pointerdown', 'keydown'].forEach(ev => inp.addEventListener(ev, mark));
    b.addEventListener('click', () => {
      const v = Number(inp.value);
      log('rating', q.id, v);
      closeDialogue();
      resolve(v);
    }, { once: true });
  });
}

/* ---------- menu ---------- */
$('#btn-help').addEventListener('click', () => { $('#help').hidden = false; log('help_open'); });
$('#help-close').addEventListener('click', () => { $('#help').hidden = true; });
$('#btn-sound').addEventListener('click', () => {
  const on = toggleSound();
  $('#btn-sound').setAttribute('aria-pressed', String(on));
  log('sound', '', on ? 'on' : 'off');
});
$('#btn-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('這個瀏覽器不支援全螢幕'));
});
$('#guide-me').addEventListener('click', async () => {
  if (!target || !controls.enabled) return;
  state.autoWalks++;
  log('auto_walk', '', 'start');
  const arrived = await controls.walkTo(target.approach);
  if (arrived) { log('auto_walk', '', 'arrived'); if (target) controls.faceTo(target.pos.x, target.pos.y || 0.4, target.pos.z, 1.0); }
});

/* =====================================================================
   INTERACTION: walk near something, then tap it or the round button
   ===================================================================== */
let offers = [], near = null, offerResolve = null;
const raycaster = new THREE.Raycaster();
const flat = (a, x, z) => Math.hypot(a.x - x, a.z - z);
// things offered without a mesh of their own (the stool, the door step…) get an invisible, tappable
// volume over their glowing ring, so tapping the ring works as well as the button
const autoHits = [], autoHitGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12), autoHitMat = new THREE.MeshBasicMaterial({ visible: false });
function clearAutoHits() { autoHits.splice(0).forEach(m => scene.remove(m)); }
function offer(list) {
  clearAutoHits();
  list.forEach(it => {
    if (it.obj || !it.pos || it.global) return;
    const m = new THREE.Mesh(autoHitGeo, autoHitMat);
    m.position.set(it.pos.x, (it.ringY || 0) + 0.5, it.pos.z);
    scene.add(m);
    autoHits.push(m);
    it.obj = m;
  });
  offers = list;
  return new Promise(r => { offerResolve = r; });
}
function use(item) {
  if (!offerResolve) return;
  const r = offerResolve;
  offers = []; near = null; offerResolve = null;
  clearAutoHits();
  $('#act').hidden = true;
  log('interact', item.id, item.tag ?? '');
  r(item);
}
const spotRings = [];
const ringGeo = new THREE.RingGeometry(0.2, 0.25, 40);
const actLabel = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(0.17, 0.064, 1);
  sp.renderOrder = 20;
  sp.visible = false;
  sp.userData = { c, t, text: '' };
  scene.add(sp);
  return sp;
})();
function setActLabel(text) {
  const u = actLabel.userData;
  if (u.text === text) return;
  u.text = text;
  const g = u.c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  g.fillStyle = 'rgba(20,25,22,.85)'; g.strokeStyle = '#d2b77e'; g.lineWidth = 4;
  g.beginPath(); g.roundRect(6, 6, 244, 64, 12); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(112, 70); g.lineTo(128, 90); g.lineTo(144, 70); g.fill();
  g.fillStyle = '#f1e9d8'; g.font = '900 38px "Noto Serif TC", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 40);
  u.t.needsUpdate = true;
}
function updateRings(t) {
  const list = controls.enabled ? offers.filter(o => o.ring !== false && o.pos) : [];
  while (spotRings.length < list.length) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 5;
    scene.add(m);
    spotRings.push(m);
  }
  spotRings.forEach((m, i) => {
    const o = list[i];
    m.visible = !!o;
    if (!o) return;
    const y = o.ringY ?? (o.pos.y > 0.05 ? o.pos.y + 0.01 : 0.03);
    m.position.set(o.pos.x, y, o.pos.z);
    const s = (o === near ? 1.25 : 1) * (1 + Math.sin(t * 3 + i) * 0.08);
    m.scale.set(s, s, s);
    m.material.color.set(o === near ? 0xbff0c8 : 0xffe2a0);
  });
  // a label over the nearest thing you can use right now, or the closest one to walk to
  const show = near && !near.global ? near : null;
  if (show) {
    setActLabel(show.label.replace('按住', ''));
    actLabel.position.set(show.pos.x, (show.labelY ?? 0.75) + Math.sin(t * 2.5) * 0.03, show.pos.z);
  }
  actLabel.visible = !!show && !holdSt.active;
}
hooks.add((dt, t) => updateRings(t));
function updateNear() {
  if (!offers.length || !controls.enabled) { if (near) { near = null; $('#act').hidden = true; } return; }
  const { x, z } = controls.st;
  let best = null, bd = 1e9;
  for (const o of offers) {
    const d = o.global ? 0 : flat(o.pos, x, z);
    if (d < (o.reach || 2.2) && d < bd) { best = o; bd = d; }
  }
  if (best !== near) {
    near = best;
    const act = $('#act');
    act.hidden = !best;
    if (best) { act.textContent = best.label; act.style.fontSize = best.label.length > 2 ? '15px' : ''; }
  }
}
/* ---------- press-and-hold actions (pulling weeds, pouring water) ----------
   An offer with `hold: seconds` must be held, on the round button, on the
   thing itself, or with the space bar. `onProgress(p, t)` animates it,
   `onHold(active)` reacts to pressing and letting go, `decay` (default
   true) lets the progress slide back if the person lets go too early. */
const holdSt = { item: null, p: 0, active: false, t0: 0, src: '' };
const actEl = $('#act');
function startHold(item, src) {
  if (!item.hold) { use(item); return; }
  if (holdSt.item && holdSt.item !== item) {
    if (holdSt.active) return;
    // switching to another thing: remember how far the first one got
    holdSt.item._p = holdSt.p;
    holdSt.p = item._p || 0;
  } else if (!holdSt.item) holdSt.p = item._p || 0;
  Object.assign(holdSt, { item, active: true, t0: now(), src });
  controls.st.lookLock = true;
  actEl.classList.add('holding');
  item.onHold && item.onHold(true);
}
function endHold() {
  if (!holdSt.active) return;
  holdSt.active = false;
  controls.st.lookLock = false;
  actEl.classList.remove('holding');
  const it = holdSt.item;
  it && it.onHold && it.onHold(false);
  if (it && holdSt.p < 1) {
    log('hold_release', it.id + (it.tag !== undefined ? ':' + it.tag : ''), `${(now() - holdSt.t0)};${holdSt.p.toFixed(2)}`);
    if (it.decay !== false && holdSt.p > 0.08) toast(it.tooShort || '再按久一點');
  }
}
function updateHold(dt, t) {
  const it = holdSt.item;
  if (!it) return;
  // walking away lets go
  if (holdSt.active && !it.global && flat(it.pos, controls.st.x, controls.st.z) > (it.reach || 2.2) * 1.35) endHold();
  if (holdSt.active) holdSt.p = Math.min(1, holdSt.p + dt / it.hold);
  else if (it.decay !== false) holdSt.p = Math.max(0, holdSt.p - dt * 1.8);
  it.onProgress && it.onProgress(holdSt.p, t);
  actEl.style.setProperty('--p', near === it ? holdSt.p : 0);
  showProgress(it, holdSt.p);
  if (holdSt.p >= 1) {
    flashDone(it);
    it.onHold && it.onHold(false);
    holdSt.active = false; holdSt.item = null; holdSt.p = 0;
    controls.st.lookLock = false;
    actEl.classList.remove('holding');
    actEl.style.setProperty('--p', 0);
    holdSt.lastSrc = holdSt.src;
    log('hold_done', it.id + (it.tag !== undefined ? ':' + it.tag : ''), now() - holdSt.t0);
    use(it);
  } else if (!holdSt.active && holdSt.p === 0 && it.decay !== false) holdSt.item = null;
}
hooks.add(updateHold);

/* ---------- progress: a bar on screen and an arc around the spot on the ground ---------- */
const progEl = $('#progress');
const arcMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { p: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float p; varying vec2 vUv;
    void main(){ vec2 d = vUv - 0.5; float a = fract(atan(d.x, d.y) / 6.2831853 + 1.0);
      vec3 col = a < p ? vec3(0.75, 0.95, 0.78) : vec3(1.0, 1.0, 1.0);
      gl_FragColor = vec4(col, a < p ? 0.95 : 0.18); }`,
});
const arc = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 64), arcMat);
arc.rotation.x = -Math.PI / 2;
arc.renderOrder = 6;
arc.visible = false;
scene.add(arc);
let doneTimer = 0;
function showProgress(it, p) {
  const show = p > 0.001 || holdSt.active;
  progEl.hidden = !show && !progEl.classList.contains('done');
  arc.visible = show && !it.global && !!it.pos;
  if (!show) return;
  arcMat.uniforms.p.value = p;
  if (it.pos) arc.position.set(it.pos.x, (it.pos.y > 0.05 ? it.pos.y : 0) + 0.025, it.pos.z);
  progEl.classList.remove('done');
  clearTimeout(doneTimer);
  $('#progress-label').textContent = it.label.replace('按住', '');
  $('#progress-fill').style.width = `${Math.round(p * 100)}%`;
  $('#progress-pct').textContent = holdSt.active ? `${Math.round(p * 100)}%` : `${Math.round(p * 100)}%　${it.decay === false ? '放開了，再按住可以接著做' : '放開了，會慢慢縮回去'}`;
}
function flashDone(it) {
  arc.visible = false;
  $('#progress-label').textContent = it.label.replace('按住', '');
  $('#progress-fill').style.width = '100%';
  $('#progress-pct').textContent = '完成！';
  progEl.classList.add('done');
  progEl.hidden = false;
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { progEl.hidden = true; progEl.classList.remove('done'); }, 1200);
}
actEl.addEventListener('pointerdown', e => { e.preventDefault(); if (near) startHold(near, 'button'); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => actEl.addEventListener(ev, endHold));
actEl.addEventListener('keydown', e => { if ((e.code === 'Enter' || e.code === 'Space') && near) { e.preventDefault(); startHold(near, 'key'); } });
window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && near && controls.enabled && !e.target.closest?.('button, input')) { e.preventDefault(); startHold(near, 'key'); } });
window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'Enter') endHold(); });
window.addEventListener('pointerup', endHold);
window.addEventListener('blur', endHold);
// pressing on the thing itself starts the hold too
canvas.addEventListener('pointerdown', e => {
  if (!controls.enabled || !offers.some(o => o.hold)) return;
  if (state.weeding && touchSeedling(e.clientX, e.clientY)) return;
  const it = pickOffer(e.clientX, e.clientY);
  if (it && it.hold && !it.global && flat(it.pos, controls.st.x, controls.st.z) <= (it.reach || 2.2) * 1.3) startHold(it, 'touch');
});
function pickOffer(cx, cy) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const objs = offers.filter(o => o.obj).flatMap(o => (Array.isArray(o.obj) ? o.obj : [o.obj]));
  const hit = objs.length ? raycaster.intersectObjects(objs, true)[0] : null;
  return hit ? offers.find(o => o.obj && (Array.isArray(o.obj) ? o.obj : [o.obj]).some(g => { for (let n = hit.object; n; n = n.parent) if (n === g) return true; return false; })) : null;
}
/** while weeding: did this press land on a bean seedling (nearer than any weed)? It sways, and is left alone. */
let seedTouches = 0, seedToastAt = 0;
function touchSeedling(cx, cy) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const sh = raycaster.intersectObjects(parts.seedlings, true).find(h => h.object.userData.seedling);
  if (!sh || sh.distance > 6) return false;
  const objs = offers.filter(o => o.obj).flatMap(o => (Array.isArray(o.obj) ? o.obj : [o.obj]));
  const wh = objs.length ? raycaster.intersectObjects(objs, true)[0] : null;
  if (wh && wh.distance < sh.distance) return false;
  const g = sh.object.parent, i = parts.seedlings.indexOf(g);
  seedTouches++;
  log('seedling_touch', String(i), seedTouches);
  const r0 = g.rotation.z;
  tw(0.8, k => { g.rotation.z = r0 + Math.sin(k * Math.PI * 4) * 0.18 * (1 - k); });
  if (performance.now() - seedToastAt > 2500) { seedToastAt = performance.now(); toast('這是豆苗，留著它；旁邊葉子細長、亂長的才是雜草'); }
  return true;
}
/** a free spot within reach of a thing, as close to the player as possible */
function approachPoint(item) {
  const reach = item.reach || 2.2;
  let best = null, bd = 1e9;
  for (const rr of [0.55, 0.7, 0.85]) for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, x = item.pos.x + Math.cos(a) * reach * rr, z = item.pos.z + Math.sin(a) * reach * rr;
    if (!controls.free(x, z)) continue;
    const d = Math.hypot(x - controls.st.x, z - controls.st.z);
    if (d < bd) { bd = d; best = [x, z]; }
  }
  return best;
}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), groundHit = new THREE.Vector3();
const destRing = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32), new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
destRing.rotation.x = -Math.PI / 2;
destRing.visible = false;
scene.add(destRing);
function walkToPoint(x, z, kind) {
  destRing.position.set(x, 0.04, z);
  destRing.visible = true;
  log('tap_walk', kind, `${x.toFixed(2)};${z.toFixed(2)}`);
  return controls.goTo(x, z).then(ok => { destRing.visible = false; return ok; });
}
let carryTap = null;   // set while a pulled weed is in hand: a tap chooses where it goes
function handleTap(cx, cy) {
  if (!controls.enabled) return;
  if (carryTap && carryTap(cx, cy)) return;
  if (state.weeding && touchSeedling(cx, cy)) return;
  // 1. something we can use?
  const item = pickOffer(cx, cy);
  if (item) {
    const d = item.global ? 0 : flat(item.pos, controls.st.x, controls.st.z);
    const reach = item.reach || 2.2;
    if (d <= reach * 1.3) { if (!item.hold) use(item); else if (holdSt.p < 0.15) toast(item.holdHint || '按住不放才行'); return; }   // held things start on press, not on tap
    // too far: walk to a free spot beside it
    const spot = approachPoint(item);
    if (!spot) { toast('從另一邊過去看看'); return; }
    walkToPoint(spot[0], spot[1], item.id).then(() => {
      controls.faceTo(item.pos.x, 0.2, item.pos.z, 0.6);
      if (!offers.includes(item)) return;
      if (flat(item.pos, controls.st.x, controls.st.z) > reach * 1.3) toast('再走近一點');
      else if (item.hold) toast(item.holdHint || '按住就可以了');
      else use(item);
    });
    return;
  }
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  // 2. otherwise, walk to the spot on the ground
  if (!raycaster.ray.intersectPlane(groundPlane, groundHit)) return;
  const d = flat(groundHit, controls.st.x, controls.st.z);
  if (d < 0.6 || d > 25) return;
  // stop short of anything in the way
  let tx = groundHit.x, tz = groundHit.z;
  for (let i = 0; i < 20 && !controls.free(tx, tz); i++) { tx = controls.st.x + (tx - controls.st.x) * 0.85; tz = controls.st.z + (tz - controls.st.z) * 0.85; }
  if (flat({ x: tx, z: tz }, controls.st.x, controls.st.z) < 0.5) { toast('那裡過不去'); return; }
  walkToPoint(tx, tz, 'ground');
}

/* ---------- arrow at the screen edge when the target is out of view ---------- */
const proj = new THREE.Vector3();

function updateEdge() {
  const el = $('#edge');
  if (skyTarget && controls.enabled) {
    proj.copy(camera.position).addScaledVector(skyTarget.dir, 100).project(camera);
    const behind = proj.z > 1;
    let { x, y } = proj;
    if (behind) { x = -x; y = -y; }
    if (!behind && Math.abs(x) < 0.75 && Math.abs(y) < 0.7) { el.hidden = true; return; }
    const m = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.78, 1e-3);
    const ex = x / m, ey = y / m;
    el.hidden = false;
    el.style.left = `${(ex * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-ey * 0.5 + 0.5) * innerHeight}px`;
    el.querySelector('.arrow').style.transform = `rotate(${Math.atan2(ex, ey)}rad)`;
    $('#edge-dist').textContent = skyTarget.label;
    return;
  }
  if (!target || !controls.enabled) { el.hidden = true; return; }
  proj.set(target.pos.x, 1.2, target.pos.z).project(camera);
  const behind = proj.z > 1;
  let { x, y } = proj;
  if (behind) { x = -x; y = -y; }
  const inView = !behind && Math.abs(x) < 0.85 && Math.abs(y) < 0.8;
  const dist = flat(target.pos, controls.st.x, controls.st.z);
  if (inView || dist < 3) { el.hidden = true; return; }
  const m = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.78, 1e-3);
  const ex = x / m, ey = y / m;
  el.hidden = false;
  el.style.left = `${(ex * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-ey * 0.5 + 0.5) * innerHeight}px`;
  el.querySelector('.arrow').style.transform = `rotate(${Math.atan2(ex, ey)}rad)`;
  $('#edge-dist').textContent = `${Math.round(dist)} 公尺`;
}

/* ---------- carrying things ---------- */
function hold(obj, pos, rot, dur = 0.9) {
  camera.attach(obj);
  const p0 = obj.position.clone(), q0 = obj.quaternion.clone(), q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
  return tw(dur, k => { obj.position.lerpVectors(p0, pos, k); obj.quaternion.slerpQuaternions(q0, q1, k); });
}
function putDown(obj, pos, rot, dur = 0.9) {
  scene.attach(obj);
  const p0 = obj.position.clone(), q0 = obj.quaternion.clone(), q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
  return tw(dur, k => { obj.position.lerpVectors(p0, pos, k); obj.position.y += Math.sin(k * Math.PI) * 0.15; obj.quaternion.slerpQuaternions(q0, q1, k); });
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mesh = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

/* =====================================================================
   STAGES: each `target` in actions.csv maps to one behaviour here
   ===================================================================== */
/* ---------- carrying a pulled weed and putting it down yourself ----------
   Still holding after it comes out: drag it to a spot and let go.
   Pulled with the button or a key: it stays in hand; tap where it should
   go (outside the bed, or the basket). */
const press = { down: false, x: 0, y: 0 };
window.addEventListener('pointerdown', e => { press.down = true; press.x = e.clientX; press.y = e.clientY; }, true);
window.addEventListener('pointermove', e => { press.x = e.clientX; press.y = e.clientY; }, true);
window.addEventListener('pointerup', () => { press.down = false; }, true);
window.addEventListener('pointercancel', () => { press.down = false; }, true);
window.addEventListener('blur', () => { press.down = false; });
document.addEventListener('visibilitychange', () => { press.down = false; });
const dropRing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 32), new THREE.MeshBasicMaterial({ color: 0xbff0c8, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
dropRing.rotation.x = -Math.PI / 2;
dropRing.visible = false;
scene.add(dropRing);
const DROP_REACH = 4.5;   // close enough to toss it in
function inBed(x, z) { const b = L.beans; return Math.abs(x - b.x) < b.w / 2 + 0.2 && Math.abs(z - b.z) < b.d / 2 + 0.2; }
function spotAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const bp = parts.weedBasket.position;
  const ok = flat(bp, controls.st.x, controls.st.z) < DROP_REACH;
  if (raycaster.intersectObject(parts.weedBasket, true).length) return { p: bp.clone(), basket: true, ok };
  if (!raycaster.ray.intersectPlane(groundPlane, groundHit)) return null;
  const p = groundHit.clone();
  if (Math.hypot(p.x - bp.x, p.z - bp.z) < 0.7) return { p: bp.clone(), basket: true, ok };
  return { p, basket: false, ok: false, far: flat(p, controls.st.x, controls.st.z) >= DROP_REACH };
}
let basketCount = 0;
const basketLabel = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,25,22,.82)'; g.strokeStyle = '#d2b77e'; g.lineWidth = 4;
  g.beginPath(); g.roundRect(8, 8, 240, 72, 12); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(112, 80); g.lineTo(128, 104); g.lineTo(144, 80); g.fill();
  g.fillStyle = '#f1e9d8'; g.font = '900 44px "Noto Serif TC", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('竹簍', 128, 46);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(0.11, 0.048, 1);   // constant size on screen
  sp.renderOrder = 20;
  sp.visible = false;
  scene.add(sp);
  return sp;
})();
hooks.add((dt, t) => { if (basketLabel.visible) basketLabel.position.set(parts.weedBasket.position.x, 0.95 + Math.sin(t * 2.5) * 0.05, parts.weedBasket.position.z); });
function showBasketGuide(on) {
  basketLabel.visible = on || state.basketHint;
  if (on) { setTarget(parts.weedBasket.position.clone().setY(0.5), null); target.approach = approachPoint({ pos: parts.weedBasket.position, reach: 1.6 }) || target.approach; }
  else setTarget(null);
}
async function settleWeed(w, spot) {
  scene.attach(w);
  const from = w.position.clone(), r0 = w.rotation.clone();
  let to, rx;
  if (spot.basket) { basketCount++; to = spot.p.clone().add(V((Math.random() - 0.5) * 0.16, 0.2 + basketCount * 0.03, (Math.random() - 0.5) * 0.16)); rx = 0.9; }
  else { to = V(spot.p.x, 0.05, spot.p.z); rx = Math.PI / 2 * 0.92; }
  const s0 = w.scale.x, s1 = spot.basket ? 0.55 : 0.85;
  await tw(0.55, k => {
    w.position.lerpVectors(from, to, k);
    w.position.y += Math.sin(k * Math.PI) * 0.25;
    w.rotation.set(lerp(r0.x, rx, k), r0.y + k * 0.6, lerp(r0.z, 0.2, k));
    const sc = lerp(s0, s1, k); w.scale.set(sc, sc, sc);
  });
  oneShot(spot.basket ? 'seed' : 'stepGrass', 0.8);
}
function placeWeed(w, src) {
  return new Promise(async resolve => {
    const from = w.position.clone(), up = from.clone().add(V(0, 0.4, 0));
    await tw(0.3, k => { w.position.lerpVectors(from, up, k); w.rotation.x = 0; w.rotation.z = k * 0.3; });
    setHeld('一叢雜草（連根帶土）');
    let done = false;
    const finish = async (spot, how) => {
      if (done) return;
      done = true;
      dropRing.visible = false;
      showBasketGuide(false);
      carryTap = null;
      hooks.delete(follow);
      controls.st.lookLock = false;
      offers = []; offerResolve = null; near = null; actEl.hidden = true; clearAutoHits();
      await settleWeed(w, spot);
      setHeld('');
      resolve(`${spot.basket ? 'basket' : 'ground'};${spot.p.x.toFixed(2)};${spot.p.z.toFixed(2)};${how}`);
    };
    // --- hand mode: tap a spot, or the basket button when near it
    const handMode = async () => {
      if (done) return;
      hooks.delete(follow);
      controls.st.lookLock = false;
      dropRing.visible = false;
      w.scale.setScalar(0.45);
      await hold(w, V(0.3, -0.3, -0.62), [0.3, 0.4, 0.6], 0.4);
      setTask('理荒穢', '轉身找到竹簍，點竹簍、按右下角「丟進竹簍」或空白鍵，把草丟進去');
      showBasketGuide(true);
      carryTap = (cx, cy) => {
        const sp = spotAt(cx, cy);
        if (!sp) return false;
        if (sp.basket && sp.ok) { finish(sp, 'tap'); return true; }
        if (sp.basket) return false;            // basket too far: the tap walks over, still carrying
        if (!sp.far) { toast('草要放進竹簍裡'); return true; }
        return false;
      };
      offer([{ id: 'basket', obj: parts.weedBasket, pos: parts.weedBasket.position, reach: DROP_REACH, label: '丟進竹簍' }])
        .then(() => finish({ p: parts.weedBasket.position.clone(), basket: true }, 'button'));
    };
    // --- drag mode: the weed follows the finger until it is let go
    let last = null;
    const follow = () => {
      if (!press.down) {
        if (last && last.basket && last.ok) finish(last, 'drag');
        else { toast('草要放進竹簍裡'); handMode(); }
        return;
      }
      const sp = spotAt(press.x, press.y);
      if (!sp) return;
      last = sp;
      // the weed stays within arm's length; it only goes over the basket if the basket is close
      const d = flat(sp.p, controls.st.x, controls.st.z), k = Math.min(1, 1.6 / Math.max(d, 0.01));
      const tgt = sp.basket && sp.ok ? sp.p : V(lerp(controls.st.x, sp.p.x, k), 0, lerp(controls.st.z, sp.p.z, k));
      w.position.lerp(V(tgt.x, (sp.basket ? 0.75 : 0.55) + Math.sin(performance.now() / 180) * 0.015, tgt.z), 0.25);
      dropRing.position.set(sp.p.x, (sp.basket ? 0.56 : 0.03), sp.p.z);
      dropRing.material.color.set(sp.ok ? 0xbff0c8 : 0xf0a08f);
      dropRing.visible = true;
    };
    // dragging only when the weed itself was pressed on screen; the button and keys keep it in hand
    if (press.down && src === 'touch') {
      controls.st.lookLock = true;
      setTask('理荒穢', '別放手，拖到竹簍上再放開');
      showBasketGuide(true);
      hooks.add(follow);
    } else handMode();
  });
}

const HOE_SHOULDER_R = [-0.35, 0.15, -0.55];
const HOE_SHOULDER_P = V(0.42, -0.95, -0.3), HOE_SHOULDER_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...HOE_SHOULDER_R));
const BEHAVIOURS = {
  /* 序：久在樊籠裡，復得返自然 */
  async gate(a) {
    setTarget(V(0, 1, L.gate.z), 'gate');
    setTask(a.name, a.task);
    walkMode(true);
    setTimeout(() => verse('q1', 'lane'), 1500);
    await offer([{ id: 'gate', obj: parts.gate, pos: V(0, 0, L.gate.z + 0.2), reach: 2.6, label: '推開' }]);
    verse('q1', 'lane');
    setTarget(null);
    oneShot('creak');
    setScape('garden', 6);
    log('soundscape', 'garden');
    await tw(2.4, k => { parts.gate[0].rotation.y = 1.65 * k; parts.gate[1].rotation.y = -1.65 * k; });
    state.gateOpen = true;
    verse('q2', 'gate');
    await wait(1500);
  },

  /* 晨：種豆南山下，草盛豆苗稀；晨興理荒穢 — take the hoe, go out the back gate to the field under the
     south mountain, and weed among the thin bean seedlings until noon */
  async weeds(a) {
    walkMode(true);
    const STEPS = ['拿起鋤頭', '到南山下的豆田', '拔草'];
    const B = L.beans;
    const inField = (x, z, pad = 0) => Math.abs(x - B.x) < B.w / 2 + pad && Math.abs(z - B.z) < B.d / 2 + pad;
    // 1. the hoe leaning on the woodpile
    const hoeAt = parts.hoe.position.clone().setY(0);
    setTarget(hoeAt.clone().setY(0.8), 'hoe');
    setTask(a.name, a.task);
    setSteps(STEPS, 0);
    await offer([{ id: 'hoe', obj: parts.hoe, pos: hoeAt, reach: 2.2, label: '扛起鋤頭' }]);
    oneShot('pick');
    await hold(parts.hoe, HOE_SHOULDER_P, HOE_SHOULDER_R, 0.9);
    setHeld('鋤頭');
    log('interact', 'hoe', 'morning');
    // 2. out of the back gate, along the footpath, to the field
    setTarget(V(B.x, 0.8, B.z + B.d / 2), 'beans');
    setTask(a.name, a.task_2);
    setSteps(STEPS, 1);
    coach('out', '豆田在哪裡', ['豆田不在院子裡，在屋後柴門外、南山腳下', '從草屋右邊繞到屋後，穿過後面的小門，沿小路往山的方向走', '迷路了就點右上角的「帶我過去」']);
    await new Promise(resolve => {
      const h = () => { if (inField(controls.st.x, controls.st.z, 0.6)) { hooks.delete(h); resolve(); } };
      hooks.add(h);
    });
    hideCoach();
    log('arrive', 'field');
    verse('m1', 'field');          // 種豆南山下
    verse('m2', 'field');          // 草盛豆苗稀
    // stand the hoe in the ground at the edge of the field: weeding is done by hand
    const hs = V(L.hoeSpot[0], 0.03, L.hoeSpot[1]);
    await putDown(parts.hoe, hs, [0.05, 0.4, 0.06], 0.7);
    oneShot('stepDirt', 1.1);
    setHeld('');
    // 3. pull the weeds; the sun climbs as you work
    let pulled = 0;
    const total = parts.weeds.length;
    state.weeding = true;
    state.basketHint = true;
    basketLabel.visible = true;
    setTarget(null);
    coach('weed', '怎麼拔草', ['草和豆苗長在一起：豆苗矮、葉子圓，雜草葉子細長、亂長', '站近雜草（圈圈變綠），按住草、按住右下角按鈕或空白鍵', '圓環滿了才會連根拔起；拔起來後丟進田邊的竹簍', '別拔到豆苗']);
    while (pulled < total) {
      setTask(a.name, `${a.task_3}（${pulled} / ${total}）`);
      setSteps(STEPS, 2);
      const left = parts.weeds.filter(w => !w.userData.pulled);
      const item = await offer(left.map(w => ({
        id: 'weed', tag: parts.weeds.indexOf(w), obj: w, pos: w.position, reach: 1.5, label: '按住拔草',
        hold: 1.3, holdHint: '要按住草不放，才拔得起來', tooShort: '根還抓著土，再按久一點',
        onProgress: (p, t) => {
          const y0 = w.userData.y0;
          w.position.y = y0 + p * p * 0.1;
          w.rotation.x = Math.sin(t * 38) * 0.06 * p;
          w.rotation.z = Math.sin(t * 31 + 1) * 0.06 * p;
        },
        onHold: on => { if (on) { oneShot('pull', 0.5); hideCoach(); } controls.st.crouchTarget = on ? -0.6 : 0; },
      })));
      const w = item.obj;
      w.userData.pulled = true;
      if (pulled === 0) verse('m3', 'first_weed');      // 晨興理荒穢
      oneShot('pull');
      burst(w.position);
      const where = await placeWeed(w, holdSt.lastSrc);
      pulled++;
      log('weed_drop', String(item.tag), where);
      env.mixEnv('morning', 'noon', pulled / total);
    }
    state.weeding = false;
    log('seedling_touch_total', a.id, seedTouches);
    setTask(a.name, `${a.task_3}（${total} / ${total}）`);
    setSteps(STEPS, 3);
    state.basketHint = false;
    basketLabel.visible = false;
    await wait(1500);
  },

  /* 午後：補種 — with the weeds gone, the gaps show (豆苗稀): dig, drop three beans, cover; the sun goes down */
  async replant(a) {
    walkMode(true);
    const S = parts.spots, rowC = S[1].pos.clone();
    const pose = { mode: 'none', at: rowC, strikes: 0 }, tmpQ = new THREE.Quaternion();
    const hoeHook = (dt, t) => {
      if (pose.mode === 'chop') {
        const ph = t * 7.5, sw = 0.5 - 0.5 * Math.cos(ph);
        parts.hoe.position.lerp(V(0.16, -0.5, -0.35), Math.min(1, dt * 8));
        tmpQ.setFromEuler(new THREE.Euler(lerp(-1.0, -2.05, sw), 0.1, -0.15));
        parts.hoe.quaternion.slerp(tmpQ, Math.min(1, dt * 14));
        const n = Math.floor((ph + Math.PI) / (Math.PI * 2));
        if (n !== pose.strikes) { pose.strikes = n; oneShot('stepDirt', 1.3); burst(pose.at); }
      } else if (pose.mode === 'shoulder') {
        parts.hoe.position.lerp(HOE_SHOULDER_P, Math.min(1, dt * 6));
        parts.hoe.quaternion.slerp(HOE_SHOULDER_Q, Math.min(1, dt * 6));
      }
    };
    const chop = spot => on => { pose.mode = on ? 'chop' : 'shoulder'; pose.at = spot.pos; if (on) hideCoach(); };
    const count = (txt, n) => `${txt}（${n} / ${S.length}）`;
    const STEPS = ['拿起鋤頭', '挖開空缺', '拿種子袋', '放入豆子', '蓋土'];
    const step = i => setSteps(STEPS, i);
    // the afternoon passes with the work: noon → dusk over ten small jobs
    let done = 0;
    const UNITS = S.length * 3 + 1;
    const tick = () => { done++; env.mixEnv('noon', 'dusk', Math.min(1, done / UNITS)); };
    S.forEach(sp => { sp.stick.visible = true; });

    // 1. the hoe from the edge of the field
    setTarget(parts.hoe.position.clone().setY(0.8), null);
    target.approach = approachPoint({ pos: parts.hoe.position, reach: 1.4 }) || target.approach;
    setTask(a.name, a.task);
    step(0);
    await offer([{ id: 'hoe', obj: parts.hoe, pos: parts.hoe.position.clone().setY(0), reach: 2.2, label: '拿起鋤頭' }]);
    oneShot('pick');
    await hold(parts.hoe, HOE_SHOULDER_P, HOE_SHOULDER_R, 0.9);
    pose.mode = 'shoulder';
    hooks.add(hoeHook);
    setHeld('鋤頭');

    // 2. dig open the three gaps marked with twigs
    setTarget(rowC, 'beans');
    coach('dig', '在缺苗的地方挖洞', ['田壟上插著小枝的地方，就是豆子沒長出來的空缺', '站到圈圈旁（變綠就夠近了），按住右下角的「按住挖洞」、按住圈圈或空白鍵', '鋤頭會一下一下挖下去，圓環滿了洞就挖好了']);
    for (let n = 0; n < S.length; n++) {
      setTask(a.name, count(a.task_2, n));
      step(1);
      const item = await offer(S.filter(sp => !sp.dug).map(sp => ({
        id: 'dig', tag: S.indexOf(sp), obj: sp.hit, pos: sp.pos, reach: 1.4, label: '按住挖洞',
        hold: 1.4, decay: false, holdHint: '按住，用鋤頭一下一下把土挖開',
        onHold: chop(sp),
        onProgress: p => { sp.hole.scale.setScalar(Math.max(0.001, p)); sp.pile.scale.y = Math.max(0.001, p * 0.9); sp.stick.visible = p < 0.5; },
      })));
      S[item.tag].dug = true;
      pose.mode = 'shoulder';
      if (n === 0) beacon.visible = false;
      tick();
    }

    // 3. the seed pouch on the stump, 4. three beans in each hole
    setTarget(V(L.pouch[0], 0.6, L.pouch[1]), 'pouch');
    setTask(a.name, a.task_3);
    step(2);
    hideCoach();
    await offer([{ id: 'pouch', obj: parts.pouch, pos: V(L.pouch[0], 0, L.pouch[1]), reach: 2.2, label: '拿起種子袋' }]);
    oneShot('pick');
    const pouchHome = parts.pouch.position.clone();
    await hold(parts.pouch, V(-0.36, -0.44, -0.72), [0.3, 0, -0.2]);
    setHeld('鋤頭、種子袋');
    tick();
    setTarget(rowC, 'beans');
    beacon.visible = false;
    coach('sow', '怎麼放豆子', ['走到剛挖好的洞旁邊，要站得很近（圈圈變綠）', '點一下洞，或按右下角的「放入豆子」', '會蹲下來，把三顆豆子放進洞裡']);
    for (let n = 0; n < S.length; n++) {
      setTask(a.name, count(a.task_4, n));
      step(3);
      const item = await offer(S.filter(sp => !sp.sown).map(sp => ({ id: 'sow', tag: S.indexOf(sp), obj: sp.hit, pos: sp.pos, reach: 1.0, label: '放入豆子' })));
      const sp = S[item.tag];
      sp.sown = true;
      controls.st.crouchTarget = -0.75;
      controls.faceTo(sp.pos.x, sp.pos.y, sp.pos.z, 0.5);
      await wait(550);
      const from = parts.pouch.getWorldPosition(new THREE.Vector3());
      for (const [k, b] of sp.seeds.entries()) {
        const to = sp.pos.clone().add(V(Math.cos(k * 2.1) * 0.03, -0.004, Math.sin(k * 2.1) * 0.03));
        oneShot('seed');
        await tw(0.4, q => { b.position.set(lerp(from.x, to.x, q), lerp(from.y, to.y, q * q) + Math.sin(q * Math.PI) * 0.06, lerp(from.z, to.z, q)); }, q => q);
      }
      controls.st.crouchTarget = 0;
      controls.faceTo(sp.pos.x + (sp.pos.x - controls.st.x) * 3, 1.0, sp.pos.z + (sp.pos.z - controls.st.z) * 3, 0.6);
      tick();
    }
    await putDown(parts.pouch, pouchHome, [0, 0, 0]);
    setHeld('鋤頭');

    // 5. cover the beans with the soil that was dug out
    hideCoach();
    coach('cover', '怎麼蓋土', ['站到有豆子的洞旁邊', '和挖洞一樣，按住右下角的「按住蓋土」或空白鍵', '鋤頭會把旁邊的土撥回洞裡，蓋成小土堆']);
    for (let n = 0; n < S.length; n++) {
      setTask(a.name, count(a.task_5, n));
      step(4);
      const item = await offer(S.filter(sp => !sp.covered).map(sp => ({
        id: 'cover', tag: S.indexOf(sp), obj: sp.hit, pos: sp.pos, reach: 1.4, label: '按住蓋土',
        hold: 1.1, decay: false, holdHint: '按住，用鋤頭把旁邊的土撥回洞裡',
        onHold: chop(sp),
        onProgress: p => {
          sp.pile.scale.y = Math.max(0.001, (1 - p) * 0.9);
          sp.hole.scale.setScalar(Math.max(0.001, 1 - p));
          sp.mound.visible = true;
          sp.mound.scale.y = Math.max(0.001, p * 0.4);
          sp.seeds.forEach(b => { b.visible = p < 0.6; });
        },
      })));
      S[item.tag].covered = true;
      pose.mode = 'shoulder';
      tick();
    }
    hideCoach();
    await wait(600);
    hooks.delete(hoeHook);
    parts.hoe.position.copy(HOE_SHOULDER_P);
    parts.hoe.quaternion.copy(HOE_SHOULDER_Q);
    setTarget(null);
    setSteps(STEPS, STEPS.length);
    setTask(a.name, '補好了。過幾天，空缺的地方就會冒出新芽。');
    await wait(2200);
  },

  /* 暮：帶月荷鋤歸，道狹草木長，夕露沾我衣，衣沾不足惜 — shoulder the hoe and take the footpath home;
     the moon rises ahead, the tall grass along the path wets the hem */
  async hoe(a) {
    walkMode(true);
    const STEPS = ['荷鋤上肩', '走小路回家', '抬頭望月', '走到家門口'];
    if (parts.hoe.parent !== camera) await hold(parts.hoe, HOE_SHOULDER_P, HOE_SHOULDER_R, 0.6);
    setHeld('鋤頭');
    setSteps(STEPS, 1);
    const door = V(L.hut.door[0], 1, L.hut.door[1]);
    setTarget(door, 'door');
    setTask(a.name, a.task);
    coach('narrow', '回家的路', ['沿著早上來的小路往回走，穿過後門，繞過草屋到門口', '小路很窄，兩旁的草比人還高，走過時會被你撥開', '天色會越來越暗，月亮會從家的方向升起來']);
    await state.duskReady;
    tw(4, k => { W.dewMat.uniforms.strength.value = k; });
    log('walk_home', a.id, 'start');
    const t0 = now();
    const moonDir = new THREE.Vector3(...MOON_DIR).normalize();
    const ARRIVE = 2.3;
    const d0 = Math.max(ARRIVE + 1, flat(door, controls.st.x, controls.st.z));
    let kMax = 0, nightSound = false, inNarrow = false, moonUp = 0, gaze = 0, held = false;
    state.wet = 0;
    const showWet = () => { $('#wet-fill').style.width = `${Math.round(state.wet * 100)}%`; };
    await new Promise(resolve => {
      const h = dt => {
        const { x, z } = controls.st;
        const d = flat(door, x, z);
        const k = Math.min(1, Math.max(0, 1 - (d - ARRIVE) / (d0 - ARRIVE)) / 0.6);
        if (k > kMax + 0.002) { kMax = k; env.mixEnv('dusk', 'night', ease(kMax)); }
        if (kMax > 0.5 && !nightSound) { nightSound = true; setScape('night', 8); log('soundscape', 'night'); }
        const onPath = z < NARROW_Z0 && z > NARROW_Z1 && narrowDist(x, z) < 0.9;
        if (!inNarrow && onPath) { inNarrow = true; verse('m5', 'narrow'); hideCoach(); $('#wet').hidden = false; showWet(); }
        // the tall wet grass brushes the hem as you go (夕露沾我衣)
        const sp = controls.speed();
        if (state.wet < 1 && sp > 0.2 && (onPath || grassDensity(x, z) > 0.25)) {
          state.wet = Math.min(1, state.wet + sp * dt * (onPath ? 0.2 : 0.08));
          showWet();
          if (state.wet >= 1) { log('wet', a.id, now() - t0); verse('m6', 'wet'); verse('m7', 'wet'); }
        }
        // the moon: once it is up, look at it for a moment (an arrow at the screen edge shows where)
        if (env.env.night > 0.45 && !state.collected.has('m4')) {
          if (!moonUp) {
            moonUp = performance.now();
            skyTarget = { dir: moonDir, label: '月亮' };
            setTask(a.name, a.task_2);
            setSteps(STEPS, 2);
            toast('月亮升起來了：往上拖曳畫面（或按 R）抬頭看看', 5000);
            log('moon_up', a.id, `${x.toFixed(1)};${z.toFixed(1)}`);
          }
          camera.getWorldDirection(lookDir);
          if (lookDir.dot(moonDir) > 0.93) {
            gaze += dt;
            if (gaze > 1.0) { verse('m4', 'moon_gaze'); log('moon_gaze', a.id, Math.round(performance.now() - moonUp)); skyTarget = null; setTask(a.name, a.task_3); setSteps(STEPS, 3); }
          } else gaze = Math.max(0, gaze - dt * 0.5);
        }
        if (d < ARRIVE) {
          if (state.collected.has('m4') || (moonUp && performance.now() - moonUp > 25000)) { hooks.delete(h); resolve(); }
          else if (!held) { held = true; toast(moonUp ? '先別急著進門，回頭看看月亮' : '再等一下，天快黑了', 4500); }
        } else held = false;
      };
      hooks.add(h);
    });
    log('walk_home', a.id, 'arrived');
    log('linger', a.id, now() - t0);
    env.setEnv('night', 2);
    if (!nightSound) setScape('night', 4);
    // every line is seen, even by someone who never looked up or found another way
    if (!state.collected.has('m5')) verse('m5', 'arrival');
    if (!state.collected.has('m6')) { state.wet = 1; showWet(); verse('m6', 'arrival'); verse('m7', 'arrival'); }
    if (!state.collected.has('m4')) { controls.faceTo(controls.st.x + moonDir.x * 10, 1.6 + moonDir.y * 10, controls.st.z + moonDir.z * 10, 2.0); await wait(1500); verse('m4', 'arrival'); await wait(2200); }
    skyTarget = null;
    setTarget(null);
    setSteps(STEPS, 4);
    await wait(800);
    $('#wet').hidden = true;
  },

  /* 歸：但使願無違 — open the door, hang up the hoe, sit by the window, end when you choose */
  async house(a) {
    walkMode(true);
    const I = parts.interior, STEPS = ['推開門', '掛上鋤頭', '坐到窗邊'];
    const doorP = V(L.hut.x, 0, L.hut.z + L.hut.d / 2 + 0.05);
    setTarget(doorP.clone().setY(1), 'door');
    setTask(a.name, a.task);
    setSteps(STEPS, 0);
    await offer([{ id: 'door', obj: I.doors, pos: doorP, reach: 2.2, label: '推開門' }]);
    oneShot('creak');
    await tw(1.5, k => { I.doors[0].rotation.y = 1.35 * k; I.doors[1].rotation.y = -1.35 * k; });
    const bi = W.colliders.boxes.indexOf(I.doorBlock);
    if (bi >= 0) W.colliders.boxes.splice(bi, 1);
    // 衣沾不足惜 for those who went straight in
    if (!state.collected.has('m7')) verse('m7', 'at_door');
    // hang the hoe on the pegs
    setTarget(I.rack.clone(), null);
    target.approach = [I.rackStand.x, I.rackStand.z];
    setTask(a.name, a.task_2);
    setSteps(STEPS, 1);
    // show exactly where it goes: a glowing outline of the hoe across the two empty pegs
    const hangP = V(I.rack.x + 0.1, I.rack.y + 0.02, I.rack.z - 0.7), hangR = [Math.PI / 2, 0, 0];   // across the two middle pegs
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const ghost = parts.hoe.clone(true);
    ghost.traverse(n => { if (n.isMesh) { n.material = ghostMat; n.castShadow = false; } });
    scene.attach(ghost);
    ghost.position.copy(hangP);
    ghost.rotation.set(...hangR);
    ghost.scale.setScalar(1.03);
    const pulse = (dt, t) => { ghostMat.opacity = 0.45 + 0.3 * Math.sin(performance.now() / 300); };
    hooks.add(pulse);
    coach('rack', '鋤頭掛哪裡', ['進門後往左轉：左邊牆上，斗笠和蓑衣中間那排木釘', '發亮的鋤頭輪廓就是它的位置', '點一下牆上的木架（或輪廓），或走近按右下角的按鈕']);
    await offer([{ id: 'rack', obj: [I.rackHit, ghost], pos: V(I.rack.x + 0.45, 0, I.rack.z), ringY: 0.37, labelY: 1.9, reach: 2.2, label: '掛上鋤頭' }]);
    hooks.delete(pulse);
    scene.remove(ghost);
    hideCoach();
    await putDown(parts.hoe, hangP, hangR, 0.9);
    oneShot('pick');
    setHeld('');
    // sit by the window
    setTarget(I.stool.clone().setY(0.8), null);
    target.approach = [I.stool.x - 0.5, I.stool.z - 0.4];
    setTask(a.name, a.task_3);
    setSteps(STEPS, 2);
    await offer([{ id: 'stool', pos: I.stool, ringY: 0.37, reach: 1.4, label: '坐下' }]);
    setTarget(null);
    walkMode(false);
    $('#hud').classList.add('quiet');
    const from = { x: controls.st.x, z: controls.st.z };
    await tw(1.2, k => { controls.st.x = lerp(from.x, I.stool.x, k); controls.st.z = lerp(from.z, I.stool.z - 0.05, k); });
    controls.st.crouchTarget = -0.7;
    controls.faceTo(I.stool.x, 1.25, L.hut.z + L.hut.d / 2 + 4, 1.5);
    setSteps(STEPS, 3);
    setTask(a.name, '靜靜坐一會兒，看看窗外的月色。想結束的時候再結束。');
    await wait(1800);
    verse('m8', 'sit');
    const tSit = now();
    await wait(7000);
    await endingPoem();
    log('sit_duration', a.id, now() - tSit);
    $('#hud').classList.remove('quiet');
  },
};

/** the whole poem, line by line; the person decides when the day ends */
function endingPoem() {
  return new Promise(resolve => {
    openDialogue('陶淵明', '歸園田居・其三');
    dlgBody.className = 'dlg-body poem ending';
    const lines = state.poems.filter(p => p.group === 'main' && p.source.includes('其三'));
    // in the order of the poem
    const order = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
    const sorted = order.map(id => lines.find(p => p.id === id)).filter(Boolean);
    const pairs = [];
    for (let i = 0; i < sorted.length; i += 2) pairs.push(sorted.slice(i, i + 2).map(p => p.text).join('，') + '。');
    dlgBody.innerHTML = `<div class="lines">${pairs.map((l, i) => `<span style="animation-delay:${i * 1.2}s">${esc(l)}</span>`).join('')}</div>`;
    dlgActions.innerHTML = '';
    const stay = button('再坐一會兒', 'btn-ghost');
    const end = button('結束今天');
    end.disabled = true;
    setTimeout(() => { end.disabled = false; }, pairs.length * 1200 + 800);
    stay.addEventListener('click', () => { log('stay_longer'); closeDialogue(); setTimeout(() => endingPoem().then(resolve), 15000); }, { once: true });
    end.addEventListener('click', () => { closeDialogue(); resolve(); }, { once: true });
  });
}

/** questionnaire pages (before and after the day). Each item is a row of numbered buttons:
    quicker and calmer than a slider, and every point of the original scale is visible. */
const PAGE_META = {
  pre_now: { eyebrow: '開始之前', title: '此刻的你', lede: '先記下你現在的狀態，等一下結束時會再問一次同樣的題目。沒有對錯，憑當下的感覺就好。' },
  post_now: { eyebrow: '回到現實之前・1／2', title: '剛才那一天', lede: '「這裡」指剛才的園子和田野。下面每一句話，有多符合你的感受？1＝完全不符合，7＝完全符合。沒有對錯。' },
  post_place: { eyebrow: '回到現實之前・2／2', title: '剛才的園子', lede: '請回想剛才在園子和田野裡的體驗，問問自己：「這句話有多符合我在那裡的經驗？」0＝完全不符合，6＝相當符合，10＝完全符合。' },
};
function questionPages(questions, phase) {
  const pages = [];
  for (const q of questions) {
    let pg = pages.find(x => x.key === q.page);
    if (!pg) pages.push(pg = { key: q.page, qs: [] });
    pg.qs.push(q);
  }
  return pages.map(pg => ({ ...(PAGE_META[`${phase}_${pg.key}`] || { eyebrow: '', title: '', lede: '' }), qs: pg.qs }));
}
async function askPages(questions, phase) {
  const pages = questionPages(questions, phase);
  for (const [i, pg] of pages.entries()) { $('#post-ok').textContent = i < pages.length - 1 ? '下一步' : (phase === 'pre' ? '開始' : '完成'); await postPage(pg.qs, pg); }
}
function postPage(questions, meta = {}) {
  return new Promise(resolve => {
    $('#post-eyebrow').textContent = meta.eyebrow || '';
    $('#post-title').textContent = meta.title || '';
    $('#post-lede').textContent = meta.lede || '';
    const box = $('#post-qs');
    const vals = new Map();
    box.innerHTML = questions.map((q, i) => {
      const lo = +q.min, hi = +q.max, n = hi - lo + 1;
      const chips = Array.from({ length: n }, (_, k) => `<button type="button" class="chip" data-i="${i}" data-v="${lo + k}" aria-pressed="false">${lo + k}</button>`).join('');
      return `<div class="pq" role="group" aria-labelledby="pq${i}">
        <p class="rate-q" id="pq${i}"><span class="qn">${i + 1}</span>${esc(q.text)}</p>
        <div class="chips" style="--n:${n}">${chips}</div>
        <div class="rate-labels"><span>${esc(q.min)}　${esc(q.min_label)}</span><span>${esc(q.max_label)}　${esc(q.max)}</span></div>
      </div>`;
    }).join('');
    const ok = $('#post-ok');
    const left = () => { const k = questions.length - vals.size; ok.disabled = k > 0; $('#post-left').textContent = k > 0 ? `還有 ${k} 題` : ''; };
    box.onclick = e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      const i = +c.dataset.i;
      vals.set(i, +c.dataset.v);
      c.parentElement.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
      c.closest('.pq').classList.add('done');
      left();
    };
    left();
    $('#post-left').textContent = `共 ${questions.length} 題`;
    $('#post').hidden = false;
    $('#post').scrollTop = 0;
    ok.onclick = () => {
      questions.forEach((q, i) => log('rating', q.id, vals.get(i)));
      $('#post').hidden = true;
      resolve();
    };
  });
}

/** mean score of a set of items, with reverse-keyed items flipped (min + max − value) */
function scaleMean(filter) {
  const vs = state.questions.filter(filter).map(q => {
    const e = state.log.find(x => x.type === 'rating' && x.id === q.id);
    if (!e || e.value === undefined || e.value === '') return null;
    const v = Number(e.value);
    return q.reverse === '1' ? +q.min + +q.max - v : v;
  }).filter(v => v !== null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

/* =====================================================================
   SESSION FLOW
   ===================================================================== */
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];
async function runSession() {
  hooks.delete(drift);
  controls.place(L.start[0], L.start[1], 0, -0.04);
  state.log = [];
  state.trail = [];
  seedTouches = 0;
  state.t0 = performance.now();
  state.running = true;
  log('session_start', W.tier, new Date().toISOString());
  if (state.consentAt) log('consent', 'intro', state.consentAt);
  log('soundscape', 'city');
  state.collected = new Map();
  $('#hud').hidden = false;
  updateVerseCount();
  setTask('', '');
  setChapter('序・入園之前', '歸去來', 'morning');
  setTarget(null);
  walkMode(false);

  const pre = state.questions.filter(q => q.phase === 'pre');
  const post = state.questions.filter(q => q.phase === 'post');
  // only one gentle question before the day starts: the baseline for the relaxation curve
  if (pre.length === 1) await askRating(pre[0], '開始之前');
  else if (pre.length) { $('#hud').hidden = true; await askPages(pre, 'pre'); $('#hud').hidden = false; }

  const from = DEBUG ? Number(new URLSearchParams(location.search).get('from') || 0) : 0;
  if (from > 0) { state.gateOpen = true; parts.gate[0].rotation.y = 1.65; parts.gate[1].rotation.y = -1.65; controls.place(0, -5.6, 0, 0); }
  if (from >= 2) {   // debug: start later in the day, in the field, with the weeding done
    parts.weeds.forEach(w => { w.userData.pulled = true; w.visible = false; });
    parts.hoe.position.set(L.hoeSpot[0], 0.03, L.hoeSpot[1]); parts.hoe.rotation.set(0.05, 0.4, 0.06);
    if (from <= 3) controls.place(6.3, -18.9, Math.PI, 0);
  }
  for (const [i, a] of state.actions.entries()) {
    if (i < from) continue;
    state.stage = i;
    const tag = `第${NUM[i] || i + 1}段`;
    setChapter(`${tag}・${a.time_label || ''}`, a.name, a.time_of_day);
    log('action_start', a.id);
    if (a.time_of_day) {
      const p = env.setEnv(a.time_of_day, i === from ? 0.01 : (a.time_of_day === 'night' ? 2 : 7));
      if (a.target === 'hoe') state.duskReady = p;
    }
    if (i === from && a.target === 'house') { setScape('night', 0.5); controls.place(0, -4.8, Math.PI, -0.1); }
    await say('旁白', tag, a.narration || a.task || '', '好');
    const run = BEHAVIOURS[a.target];
    if (run) await run(a);
    else console.warn(`actions.csv: unknown target "${a.target}" for ${a.id}`);
    log('action_complete', a.id);
    walkMode(false);
    setTask('', '');
    // wait for any line still on screen, then one gentle question with the stage's lines
    while (versePlaying) await wait(300);
    if (a.rating_prompt) await stageCard(a, tag);
  }

  state.stage = state.actions.length;
  $('#hud').hidden = true;
  const relaxPost = post.find(q => q.id === 'relax_post');
  if (relaxPost) await askRating(relaxPost, '結束時');
  await askPages(post.filter(q => q !== relaxPost), 'post');
  log('session_end');
  state.running = false;
  $('#hud').hidden = true;
  showResult();
}

/* =====================================================================
   RESULT: relaxation over time, and where the person walked
   ===================================================================== */
const STAGE_COL = ['#9fc7b4', '#e2cb82', '#e8a06a', '#c08ac6', '#8fb0e8', '#f0d3a0'];
function showResult() {
  const ratings = state.log.filter(e => e.type === 'rating');
  const relax = ratings.filter(e => e.id.startsWith('relax'));
  const done = state.log.filter(e => e.type === 'action_complete');
  const end = state.log.at(-1).t || 1;
  const Wd = 620, H = 300, Lm = 50, Rm = 24, T = 34, B = 54;
  const X = t => Lm + (t / end) * (Wd - Lm - Rm), Y = v => T + (1 - v / 10) * (H - T - B);
  const label = id => id === 'relax_pre' ? '開始前' : id === 'relax_post' ? '結束時' : (state.actions.find(x => 'relax_after_' + x.id === id) || {}).name || id;
  const pts = relax.map(e => [X(e.t), Y(Number(e.value))]);
  const tick = 'rgba(241,233,216,.12)', txt = '#bdb4a1';
  $('#timeline').innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="放鬆程度隨活動進行的變化">
    ${[0, 2, 4, 6, 8, 10].map(v => `<line x1="${Lm}" x2="${Wd - Rm}" y1="${Y(v)}" y2="${Y(v)}" stroke="${tick}"/><text x="${Lm - 10}" y="${Y(v) + 4}" text-anchor="end" font-size="13" fill="${txt}">${v}</text>`).join('')}
    ${done.map((e, i) => `<line x1="${X(e.t)}" x2="${X(e.t)}" y1="${T}" y2="${H - B}" stroke="${STAGE_COL[i % 6]}" stroke-dasharray="3 4" opacity=".7"/><text x="${X(e.t)}" y="${H - B + (i % 2 ? 36 : 20)}" text-anchor="middle" font-size="13" fill="${STAGE_COL[i % 6]}">${esc((state.actions.find(a => a.id === e.id) || {}).name || e.id)}</text>`).join('')}
    <polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#d2b77e" stroke-width="2.5"/>
    ${relax.map((e, i) => `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="5" fill="#f1e9d8" stroke="#d2b77e" stroke-width="2"/><text x="${pts[i][0]}" y="${pts[i][1] + (i % 2 ? 24 : -12)}" text-anchor="middle" font-size="13" fill="#f1e9d8">${esc(label(e.id))} ${e.value}</text>`).join('')}
    <text x="${Wd - Rm}" y="${T - 14}" text-anchor="end" font-size="12" fill="${txt}">經過 ${Math.round(end / 1000)} 秒</text>
  </svg>`;

  // top-down map: the start is at the bottom, the hut at the top
  const x0 = -11, x1 = 11, z0 = -23, z1 = 16.5, k = 11;
  const MX = x => (x - x0) * k, MZ = z => (z - z0) * k;
  const MW = (x1 - x0) * k, MH = (z1 - z0) * k;
  const rect = (b, fill, stroke) => `<rect x="${MX(b.x - b.w / 2)}" y="${MZ(b.z - b.d / 2)}" width="${b.w * k}" height="${b.d * k}" fill="${fill}" stroke="${stroke}"/>`;
  const seg = [];
  let cur = null;
  state.trail.forEach(([x, z, s]) => { if (!cur || cur.s !== s) { if (cur) cur.p.push([x, z]); cur = { s, p: [] }; seg.push(cur); } cur.p.push([x, z]); });
  const walked = state.trail.reduce((acc, p, i, arr) => acc + (i ? Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) : 0), 0);
  $('#pathmap').innerHTML = `<svg viewBox="0 0 ${MW} ${MH}" role="img" aria-label="走動軌跡俯視圖">
    <rect x="${MX(L.fence.x0)}" y="${MZ(L.fence.z0)}" width="${(L.fence.x1 - L.fence.x0) * k}" height="${(L.fence.z1 - L.fence.z0) * k}" fill="rgba(127,174,150,.08)" stroke="rgba(210,183,126,.45)" stroke-dasharray="4 3"/>
    ${[...PATHS, NARROW].map(l => `<polyline points="${l.map(([x, z]) => `${MX(x)},${MZ(z)}`).join(' ')}" fill="none" stroke="rgba(241,233,216,.12)" stroke-width="${0.9 * k}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${rect(L.hut, 'rgba(210,183,126,.25)', 'rgba(210,183,126,.6)')}
    ${rect(L.veg, 'rgba(120,90,60,.35)', 'none')}${rect(L.beans, 'rgba(120,90,60,.35)', 'none')}
    <circle cx="${MX(L.pond.x)}" cy="${MZ(L.pond.z)}" r="${L.pond.r * k}" fill="rgba(110,150,170,.3)"/>
    <text x="${MX(L.hut.x)}" y="${MZ(L.hut.z) + 5}" text-anchor="middle" font-size="14" fill="#f1e9d8">草屋</text>
    <text x="${MX(L.veg.x)}" y="${MZ(L.veg.z) + 5}" text-anchor="middle" font-size="12" fill="#bdb4a1">菜圃</text>
    <text x="${MX(L.beans.x)}" y="${MZ(L.beans.z) + 5}" text-anchor="middle" font-size="12" fill="#bdb4a1">豆田</text>
    <text x="${MX(L.pond.x)}" y="${MZ(L.pond.z) + 4}" text-anchor="middle" font-size="12" fill="#bdb4a1">池</text>
    <text x="${MX(L.eastFence.x) - 4}" y="${MZ((L.eastFence.z0 + L.eastFence.z1) / 2)}" text-anchor="end" font-size="12" fill="#bdb4a1">東籬</text>
    ${seg.filter(s => s.s >= 0 && s.s < 6).map(s => `<polyline points="${s.p.map(([x, z]) => `${MX(x).toFixed(1)},${MZ(z).toFixed(1)}`).join(' ')}" fill="none" stroke="${STAGE_COL[s.s]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <circle cx="${MX(L.start[0])}" cy="${MZ(L.start[1])}" r="5" fill="#f1e9d8"/><text x="${MX(L.start[0]) + 9}" y="${MZ(L.start[1]) + 4}" font-size="12" fill="#f1e9d8">起點</text>
  </svg>
  <p class="fine">${state.actions.map((a, i) => `<span style="color:${STAGE_COL[i % 6]}">━ ${esc(a.name)}</span>`).join('　')}</p>`;

  // questionnaire scores: ROS before → after, PRS subscale means (reverse-keyed items flipped)
  const f1 = v => (v === null ? '—' : v.toFixed(1));
  const rosPost = scaleMean(q => q.scale === 'ROS' && q.phase === 'post');
  // each card: what it is in plain words, the score out of its maximum, and how to read it
  const extra = [['恢復感', rosPost === null ? '—' : `${f1(rosPost)}／7`, '6 題平均（1–7）。越高代表這段體驗之後越覺得平靜、專注、思緒清楚']];
  const SUB = { 吸引: '環境有沒有吸引注意的事物', 遠離: '有沒有離開日常壓力的感覺', 一致: '環境看起來有沒有秩序、整體感', 範圍: '環境是否夠大、可以探索' };
  [...new Set(state.questions.filter(q => q.scale === 'PRS-11').map(q => q.subscale))].forEach(sub => {
    const v = scaleMean(q => q.scale === 'PRS-11' && q.subscale === sub);
    extra.push([`園子的${sub}感`, v === null ? '—' : `${f1(v)}／10`, `${SUB[sub] || ''}（0–10）`]);
  });
  const lingerMs = Number((state.log.find(e => e.type === 'linger') || {}).value || 0);
  const main = state.poems.filter(p => p.group === 'main'), ex = state.poems.filter(p => p.group === 'explore');
  const got = arr => arr.filter(p => state.collected.has(p.id)).length;
  const sitMs = Number((state.log.find(e => e.type === 'sit_duration') || {}).value || 0);
  const cards = [...extra, ['走動距離', `${Math.round(walked)} 公尺`, '整段體驗走了多遠'], ['走回家', `${Math.round(lingerMs / 1000)} 秒`, '黃昏從豆田走到家門花的時間'], ['窗邊坐了', `${Math.round(sitMs / 1000)} 秒`, '坐下後多久才選擇結束'], ['詩句', `${got(main)}／${main.length}`, '主線詩句出現幾句'], ['尋得的詩箋', `${got(ex)}／${ex.length}`, '自己探索找到的詩箋'], ['誤觸豆苗', `${seedTouches} 次`, '除草時點到豆苗的次數'], ['「帶我過去」', `${state.autoWalks} 次`, '使用自動帶路的次數']];
  $('#post-scores').innerHTML = cards.map(([k2, v, h]) => `<div class="score">${esc(k2)}<b>${esc(v)}</b>${h ? `<small>${esc(h)}</small>` : ''}</div>`).join('');
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
// title → research information (read, tick, start) → the day
$('#start').addEventListener('click', () => {
  $('#title').hidden = true;
  $('#intro').hidden = false;
  $('#intro').scrollTop = 0;
});
$('#intro-agree').addEventListener('change', e => { $('#intro-ok').disabled = !e.target.checked; });
$('#intro-back').addEventListener('click', () => { $('#intro').hidden = true; $('#title').hidden = false; });
$('#intro-ok').addEventListener('click', () => {
  state.consentAt = new Date().toISOString();
  $('#intro').hidden = true;
  audioInit();
  setScape('city', 0.1);
  runSession();
});

env.setEnv('morning', 0);
// a slow drift of the camera behind the title card
controls.place(0, 15.2, -0.05, -0.02);
const drift = (dt, t) => { if (!state.running) controls.st.yaw = Math.sin(t * 0.08) * 0.12; };
hooks.add(drift);
requestAnimationFrame(frame);

let dataReady = false, texReady = false;
const startBtn = $('#start');
function ready() {
  if (!dataReady || !texReady) return;
  startBtn.disabled = false;
  startBtn.textContent = '開始';
}
THREE.DefaultLoadingManager.onProgress = (_u, loaded, total) => { if (!texReady) startBtn.textContent = `載入中 ${Math.round((loaded / total) * 100)}%`; };
THREE.DefaultLoadingManager.onLoad = () => { texReady = true; ready(); };
setTimeout(() => { if (!texReady) { texReady = true; ready(); } }, 15000);
loadData().then(() => { dataReady = true; ready(); }).catch(err => {
  console.error(err);
  const e = $('#load-error');
  e.hidden = false;
  e.textContent = '無法讀取 data/ 資料夾裡的 CSV 檔。請透過 GitHub Pages 網址或本機伺服器開啟，不能直接雙擊 index.html。';
  startBtn.textContent = '無法開始';
});

// for automated checks: ?debug=1 exposes a few internals
if (new URLSearchParams(location.search).has('debug')) window.__vg = { state, controls, get offers() { return offers; }, use, W, hooks, holdSt, startHold, endHold, approachPoint, parts };
