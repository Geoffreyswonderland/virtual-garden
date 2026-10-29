import * as THREE from 'three';
import { parseCSV } from './csv.js?v=16';
import { createWorld } from './world/index.js?v=26';
import { createControls } from './controls.js?v=29';
import { audioInit, setScape, oneShot, waterSound, toggleSound } from './audio.js?v=16';
import { L, PATHS, APPROACH, EYE } from './world/layout.js?v=18';
import { pathDist } from './world/grass.js?v=21';

/* =====================================================================
   STATE AND EVENT LOG
   Every meaningful moment is written to state.log with a time stamp in
   milliseconds since the session started, so the whole visit can be
   reconstructed and aligned with other data (e.g. a heart-rate strap).
   ===================================================================== */
const $ = s => document.querySelector(s);
const state = { actions: [], questions: [], log: [], t0: 0, running: false, stage: -1, autoWalks: 0, gateOpen: false, trail: [] };
const now = () => Math.round(performance.now() - state.t0);
const log = (type, id = '', value = '') => state.log.push({ t: now(), type, id, value: String(value) });
const hooks = new Set();   // per-frame callbacks used by stages

async function loadData() {
  const get = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(u); return r.text(); });
  const [a, q] = await Promise.all([get('data/actions.csv'), get('data/questions.csv')]);
  state.actions = parseCSV(a).sort((x, y) => Number(x.order) - Number(y.order));
  state.questions = parseCSV(q);
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
function offer(list) {
  offers = list;
  return new Promise(r => { offerResolve = r; });
}
function use(item) {
  if (!offerResolve) return;
  const r = offerResolve;
  offers = []; near = null; offerResolve = null;
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
  const list = controls.enabled ? offers.filter(o => !o.global && o.ring !== false && o.pos) : [];
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
function inBed(x, z) { const b = L.veg; return Math.abs(x - b.x) < b.w / 2 + 0.2 && Math.abs(z - b.z) < b.d / 2 + 0.2; }
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
      offers = []; offerResolve = null; near = null; actEl.hidden = true;
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

const BEHAVIOURS = {
  /* 序：久在樊籠裡，復得返自然 */
  async gate(a) {
    setTarget(V(0, 1, L.gate.z), 'gate');
    setTask(a.name, a.task);
    walkMode(true);
    await offer([{ id: 'gate', obj: parts.gate, pos: V(0, 0, L.gate.z + 0.2), reach: 2.6, label: '推開' }]);
    setTarget(null);
    oneShot('creak');
    setScape('garden', 6);
    log('soundscape', 'garden');
    await tw(2.4, k => { parts.gate[0].rotation.y = 1.65 * k; parts.gate[1].rotation.y = -1.65 * k; });
    state.gateOpen = true;
    await wait(700);
  },

  /* 晨：晨興理荒穢 */
  async weeds(a) {
    const center = V(L.veg.x, 0.3, L.veg.z);
    setTarget(center, 'veg');
    walkMode(true);
    let pulled = 0;
    const total = parts.weeds.length;
    // point out the basket before anything else
    state.basketHint = true;
    basketLabel.visible = true;
    coach('weed', '怎麼拔草', ['走到菜圃前，站到發亮的圈圈旁（圈圈變綠就是夠近了）', '按住草、按住右下角的「按住拔草」，或按住空白鍵', '草會先抖動鬆開，圓環滿了才會連根拔起', '拔起來後，把草丟進菜圃前的竹簍']);
    while (pulled < total) {
      setTask(a.name, `${a.task}（${pulled} / ${total}）　按住草，把它連根拔起`);
      const left = parts.weeds.filter(w => !w.userData.pulled);
      const item = await offer(left.map(w => ({
        id: 'weed', tag: parts.weeds.indexOf(w), obj: w, pos: w.position, reach: 1.5, label: '按住拔草',
        hold: 1.3, holdHint: '要按住草不放，才拔得起來', tooShort: '根還抓著土，再按久一點',
        // the weed resists: it trembles and lifts a little as you pull
        onProgress: (p, t) => {
          const y0 = w.userData.y0;
          w.position.y = y0 + p * p * 0.1;
          w.rotation.x = Math.sin(t * 38) * 0.06 * p;
          w.rotation.z = Math.sin(t * 31 + 1) * 0.06 * p;
        },
        onHold: on => { if (on) oneShot('pull', 0.5); controls.st.crouchTarget = on ? -0.6 : 0; },
      })));
      const w = item.obj;
      w.userData.pulled = true;
      if (pulled === 0) beacon.visible = false;
      oneShot('pull');
      burst(w.position);
      const where = await placeWeed(w, holdSt.lastSrc);
      pulled++;
      log('weed_drop', String(item.tag), where);
      if (pulled < total) { setTarget(center, 'veg'); beacon.visible = false; }
    }
    setTask(a.name, `${a.task}（${total} / ${total}）`);
    setTarget(null);
    state.basketHint = false;
    basketLabel.visible = false;
    await wait(1500);
  },

  /* 午：種豆南山下 — dig, drop three beans, cover with soil, put the hoe away, water */
  async sow(a) {
    walkMode(true);
    const S = parts.spots, rowC = S[1].pos.clone();
    // the hoe rests on the shoulder, and swings down while digging or covering
    const SHOULDER_P = V(0.42, -0.95, -0.3), SHOULDER_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0.15, -0.55));
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
        parts.hoe.position.lerp(SHOULDER_P, Math.min(1, dt * 6));
        parts.hoe.quaternion.slerp(SHOULDER_Q, Math.min(1, dt * 6));
      }
    };
    const chop = spot => on => { pose.mode = on ? 'chop' : 'shoulder'; pose.at = spot.pos; if (on) hideCoach(); };
    const count = (txt, n) => `${txt}（${n} / ${S.length}）`;
    const STEPS = ['拿鋤頭', '挖洞', '拿種子袋', '放豆子', '蓋土', '插好鋤頭', '澆水'];
    const step = i => setSteps(STEPS, i);

    // 1. the hoe
    setTarget(parts.hoe.position.clone().setY(0.8), 'pouch');
    setTask(a.name, a.task);
    step(0);
    await offer([{ id: 'hoe', obj: parts.hoe, pos: parts.hoe.position.clone(), reach: 2.2, label: '拿起鋤頭' }]);
    oneShot('pick');
    await hold(parts.hoe, SHOULDER_P, [-0.35, 0.15, -0.55], 0.9);
    pose.mode = 'shoulder';
    hooks.add(hoeHook);
    setHeld('鋤頭');

    // 2. dig three holes where the twigs are
    setTarget(rowC, 'beans');
    coach('dig', '怎麼用鋤頭挖洞', ['走進豆田，站到發亮的圈圈旁邊（圈圈變綠就是夠近了）', '按住右下角的「按住挖洞」、按住圈圈，或按住空白鍵', '鋤頭會一下一下挖下去；按到圓環滿了，洞就挖好了', '三個圈圈都挖好，就會進到下一步']);
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
    }

    // 3. the seed pouch, 4. three beans in each hole
    setTarget(V(L.pouch[0], 0.6, L.pouch[1]), 'pouch');
    setTask(a.name, a.task_3);
    step(2);
    hideCoach();
    await offer([{ id: 'pouch', obj: parts.pouch, pos: V(L.pouch[0], 0, L.pouch[1]), reach: 2.2, label: '拿起種子袋' }]);
    oneShot('pick');
    const pouchHome = parts.pouch.position.clone();
    await hold(parts.pouch, V(-0.36, -0.44, -0.72), [0.3, 0, -0.2]);
    setHeld('鋤頭、種子袋');
    setTarget(rowC, 'beans');
    beacon.visible = false;
    coach('sow', '怎麼放豆子', ['走到剛挖好的洞旁邊，要站得很近（圈圈變綠）', '點一下洞，或按右下角的「放入豆子」', '會蹲下來，把三顆豆子放進洞裡', '三個洞都要一個一個走過去放']);
    for (let n = 0; n < S.length; n++) {
      setTask(a.name, count(a.task_4, n));
      step(3);
      const item = await offer(S.filter(sp => !sp.sown).map(sp => ({ id: 'sow', tag: S.indexOf(sp), obj: sp.hit, pos: sp.pos, reach: 1.0, label: '放入豆子' })));
      const sp = S[item.tag];
      sp.sown = true;
      // crouch beside the hole and drop the beans in by hand
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
    }

    // 6. stand the hoe upright at the edge of the field, to free the hands (picked up again at dusk)
    hideCoach();
    const hoeSpot = V(S[2].pos.x + 0.75, 0.04, S[2].pos.z + 0.35);   // just past the last mound
    setTarget(hoeSpot.clone().setY(0.6), null);
    target.approach = approachPoint({ pos: hoeSpot, reach: 1.4 }) || target.approach;
    setTask(a.name, a.task_6);
    step(5);
    coach('hoe_away', '鋤頭插在哪裡', ['就在剛蓋好的土堆旁邊，地上有發亮的圈圈和光柱', '走近到圈圈變綠', '按右下角的「插好鋤頭」或空白鍵，或點一下圈圈']);
    const hoeMark = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 10), new THREE.MeshBasicMaterial({ visible: false }), hoeSpot.x, 0.25, hoeSpot.z, scene);
    await offer([{ id: 'hoe_away', obj: hoeMark, pos: hoeSpot, reach: 2.4, label: '插好鋤頭' }]);
    scene.remove(hoeMark);
    setTarget(null);
    hooks.delete(hoeHook);
    await putDown(parts.hoe, hoeSpot, [0.04, 0.5, 0.05], 0.7);
    oneShot('stepDirt', 1.2);
    setHeld('');

    // 7. dip the ladle in the bucket, carry it to the mounds, and pour on each one
    setTarget(V(L.bucket[0], 0.4, L.bucket[1]), 'bucket');
    setTask(a.name, a.task_7);
    step(6);
    coach('scoop', '怎麼舀水', ['到田邊的水桶旁（圈圈變綠）', '點一下水桶，或按右下角的「舀水」', '會用水瓢從桶裡舀起一瓢水，拿在手上']);
    await offer([{ id: 'bucket', obj: parts.bucket, pos: V(L.bucket[0], 0, L.bucket[1]), reach: 2.2, label: '舀水' }]);
    hideCoach();
    const ladle = parts.ladle, scoop = ladle.userData.scoop;
    const ladleHome = ladle.position.clone(), ladleRot = ladle.rotation.clone();
    const bucketP = V(L.bucket[0], 0, L.bucket[1]);
    // dip in, come up full
    await tw(0.5, k => { ladle.position.set(lerp(ladleHome.x, bucketP.x, k), ladleHome.y + Math.sin(k * Math.PI) * 0.12, lerp(ladleHome.z, bucketP.z, k)); });
    await tw(0.45, k => { ladle.position.y = lerp(0.43, 0.24, k); ladle.rotation.z = lerp(0, 0.5, k); });
    oneShot('pull', 0.6);
    scoop.visible = true;
    scoop.scale.setScalar(1);
    await tw(0.45, k => { ladle.position.y = lerp(0.24, 0.62, k); ladle.rotation.z = lerp(0.5, 0, k); });
    const HAND = V(0.24, -0.3, -0.55);
    await hold(ladle, HAND, [0, 0.3, 0], 0.6);
    setHeld('一瓢水');

    coach('water', '怎麼澆水', ['拿著水瓢，走到土堆旁（圈圈變綠）', '按住右下角的「按住澆水」或空白鍵，水瓢會傾斜，把水倒在土堆上', '放開就停；三個土堆都澆到變深色，就完成了']);
    let tilt = 0;
    const tiltHook = dt => {
      tilt += ((pour.on ? 1.15 : 0) - tilt) * Math.min(1, dt * 6);
      ladle.rotation.z = tilt;
      ladle.position.lerp(pour.on ? V(0.14, -0.22, -0.5) : HAND, Math.min(1, dt * 5));
      if (pour.on) ladle.getWorldPosition(pour.from);
    };
    hooks.add(tiltHook);
    let left = 1;
    for (let n = 0; n < S.length; n++) {
      setTarget(S.find(sp => !sp.watered).pos.clone().setY(0.5), null);
      target.approach = approachPoint({ pos: target.pos, reach: 1.2 }) || target.approach;
      setTask(a.name, `走到土堆旁，按住澆水（${n} / ${S.length}）`);
      const item = await offer(S.filter(sp => !sp.watered).map(sp => ({
        id: 'water', tag: S.indexOf(sp), obj: sp.hit, pos: sp.pos, reach: 1.2, label: '按住澆水',
        hold: 1.4, decay: false, holdHint: '走到土堆旁，按住才會倒水',
        onHold: on => { pour.on = on; pour.to.copy(sp.pos); drops.visible = true; waterSound(on); if (on) { beacon.visible = false; hideCoach(); } },
        onProgress: p => {
          sp.wet.material.opacity = p * 0.75;
          scoop.scale.setScalar(Math.max(0.05, left - p / S.length));
        },
      })));
      const sp = S[item.tag];
      sp.watered = true;
      left -= 1 / S.length;
      pour.on = false; waterSound(false);
    }
    await wait(400);
    hooks.delete(tiltHook);
    ladle.rotation.z = 0;
    scoop.visible = false;
    setTimeout(() => { drops.visible = false; }, 700);
    setTarget(null);
    setTask(a.name, '水澆好了，水瓢放回水桶上');
    await putDown(ladle, ladleHome, [ladleRot.x, ladleRot.y, ladleRot.z]);
    setHeld('');
    setTarget(null);
    setSteps(STEPS, STEPS.length);
    setTask(a.name, '豆子種好了。要等上幾天，才會冒出芽來。');
    await wait(2200);
  },

  /* 暮：帶月荷鋤歸，道狹草木長 */
  async hoe(a) {
    walkMode(true);
    const hoeAt = parts.hoe.position.clone().setY(0);
    setTarget(hoeAt.clone().setY(0.8), null);
    target.approach = approachPoint({ pos: hoeAt, reach: 1.6 }) || target.approach;
    setTask(a.name, a.task);
    setSteps(['扛起鋤頭', '走回草屋'], 0);
    await offer([{ id: 'hoe', obj: parts.hoe, pos: hoeAt, reach: 2.3, label: '扛起' }]);
    setSteps(['扛起鋤頭', '走回草屋'], 1);
    oneShot('pick');
    await hold(parts.hoe, V(0.42, -0.95, -0.3), [-0.35, 0.15, -0.55], 1.1);
    setHeld('鋤頭');
    const door = V(L.hut.door[0], 1, L.hut.door[1]);
    setTarget(door, 'door');
    setTask(a.name, a.task_2);
    await state.duskReady;
    log('walk_home', a.id, 'start');
    const ARRIVE = 2.3;
    const d0 = Math.max(ARRIVE + 1, flat(door, controls.st.x, controls.st.z));
    let kMax = 0, nightSound = false;
    await new Promise(resolve => {
      const h = () => {
        const d = flat(door, controls.st.x, controls.st.z);
        const k = Math.min(1, Math.max(0, 1 - (d - ARRIVE) / (d0 - ARRIVE)));
        if (k > kMax + 0.002) { kMax = k; env.mixEnv('dusk', 'night', ease(kMax)); }
        if (kMax > 0.5 && !nightSound) { nightSound = true; setScape('night', 8); log('soundscape', 'night'); }
        if (d < ARRIVE) { hooks.delete(h); resolve(); }
      };
      hooks.add(h);
    });
    log('walk_home', a.id, 'arrived');
    env.setEnv('night', 2);
    if (!nightSound) setScape('night', 4);
    setTarget(null);
    await putDown(parts.hoe, V(1.25, 0.34, L.hut.z + L.hut.d / 2 + 0.12), [0.2, 0, 0.12], 1.1);
    setHeld('');
    await wait(600);
  },

  /* 結：夕露沾我衣 */
  async linger(a) {
    walkMode(true);
    controls.faceTo(0, 0.3, -1.5, 3.2);
    tw(3.5, k => { W.dewMat.uniforms.strength.value = k; });
    setTask(a.name, a.task);
    const t0 = now(), m0 = controls.st.moved;
    await wait(10000);
    setTask(a.name, `${a.task}。想好了，就回屋歇息吧。`);
    await offer([{ id: 'rest', global: true, label: '回屋歇息' }]);
    log('linger', a.id, now() - t0);
    log('linger_distance', a.id, (controls.st.moved - m0).toFixed(1));
  },
};

/* =====================================================================
   SESSION FLOW
   ===================================================================== */
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];
async function runSession() {
  hooks.delete(drift);
  controls.place(L.start[0], L.start[1], 0, -0.04);
  state.log = [];
  state.trail = [];
  state.t0 = performance.now();
  state.running = true;
  log('session_start', W.tier, new Date().toISOString());
  log('soundscape', 'city');
  $('#hud').hidden = false;
  setTask('', '');
  setChapter('序・入園之前', '歸去來', 'morning');
  setTarget(null);
  walkMode(false);

  const pre = state.questions.filter(q => q.phase === 'pre');
  const post = state.questions.filter(q => q.phase === 'post');
  for (const q of pre) await askRating(q, '開始之前');

  const from = DEBUG ? Number(new URLSearchParams(location.search).get('from') || 0) : 0;
  if (from > 0) { state.gateOpen = true; parts.gate[0].rotation.y = 1.65; parts.gate[1].rotation.y = -1.65; controls.place(0, -5.6, 0, 0); }
  for (const [i, a] of state.actions.entries()) {
    if (i < from) continue;
    state.stage = i;
    const tag = `第${NUM[i] || i + 1}段`;
    setChapter(`${tag}・${a.time_label || ''}`, a.name, a.time_of_day);
    log('action_start', a.id);
    if (a.target === 'linger' && i === from) env.setEnv('night', 0.01);
    if (a.time_of_day && a.target !== 'linger') {
      const p = env.setEnv(a.time_of_day, i === from ? 0.01 : 7);
      if (a.target === 'hoe') state.duskReady = p;
    }
    await say('旁白', tag, a.narration || a.task || '', '好');
    const run = BEHAVIOURS[a.target];
    if (run) await run(a);
    else console.warn(`actions.csv: unknown target "${a.target}" for ${a.id}`);
    log('action_complete', a.id);
    walkMode(false);
    setTask('', '');
    await showPoem(a, tag);
    await askRating({ id: 'relax_after_' + a.id, text: a.rating_prompt || '此刻你有多放鬆？', min: 0, max: 10, min_label: '完全不放鬆', max_label: '非常放鬆' }, tag);
  }

  state.stage = state.actions.length;
  setChapter('結・回到屋裡', '但使願無違', 'night');
  for (const [i, q] of post.entries()) await askRating(q, '體驗之後', `${i + 1} / ${post.length}`);
  log('session_end');
  state.running = false;
  $('#hud').hidden = true;
  showResult();
}

/* =====================================================================
   RESULT: relaxation over time, and where the person walked
   ===================================================================== */
const STAGE_COL = ['#9fc7b4', '#e2cb82', '#e8a06a', '#c08ac6', '#8fb0e8'];
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
    ${done.map((e, i) => `<line x1="${X(e.t)}" x2="${X(e.t)}" y1="${T}" y2="${H - B}" stroke="${STAGE_COL[i % 5]}" stroke-dasharray="3 4" opacity=".7"/><text x="${X(e.t)}" y="${H - B + (i % 2 ? 36 : 20)}" text-anchor="middle" font-size="13" fill="${STAGE_COL[i % 5]}">${esc((state.actions.find(a => a.id === e.id) || {}).name || e.id)}</text>`).join('')}
    <polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#d2b77e" stroke-width="2.5"/>
    ${relax.map((e, i) => `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="5" fill="#f1e9d8" stroke="#d2b77e" stroke-width="2"/><text x="${pts[i][0]}" y="${pts[i][1] + (i % 2 ? 24 : -12)}" text-anchor="middle" font-size="13" fill="#f1e9d8">${esc(label(e.id))} ${e.value}</text>`).join('')}
    <text x="${Wd - Rm}" y="${T - 14}" text-anchor="end" font-size="12" fill="${txt}">經過 ${Math.round(end / 1000)} 秒</text>
  </svg>`;

  // top-down map: the start is at the bottom, the hut at the top
  const x0 = -11, x1 = 11, z0 = -13.5, z1 = 16.5, k = 13;
  const MX = x => (x - x0) * k, MZ = z => (z - z0) * k;
  const MW = (x1 - x0) * k, MH = (z1 - z0) * k;
  const rect = (b, fill, stroke) => `<rect x="${MX(b.x - b.w / 2)}" y="${MZ(b.z - b.d / 2)}" width="${b.w * k}" height="${b.d * k}" fill="${fill}" stroke="${stroke}"/>`;
  const seg = [];
  let cur = null;
  state.trail.forEach(([x, z, s]) => { if (!cur || cur.s !== s) { if (cur) cur.p.push([x, z]); cur = { s, p: [] }; seg.push(cur); } cur.p.push([x, z]); });
  const walked = state.trail.reduce((acc, p, i, arr) => acc + (i ? Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) : 0), 0);
  $('#pathmap').innerHTML = `<svg viewBox="0 0 ${MW} ${MH}" role="img" aria-label="走動軌跡俯視圖">
    <rect x="${MX(L.fence.x0)}" y="${MZ(L.fence.z0)}" width="${(L.fence.x1 - L.fence.x0) * k}" height="${(L.fence.z1 - L.fence.z0) * k}" fill="rgba(127,174,150,.08)" stroke="rgba(210,183,126,.45)" stroke-dasharray="4 3"/>
    ${PATHS.map(l => `<polyline points="${l.map(([x, z]) => `${MX(x)},${MZ(z)}`).join(' ')}" fill="none" stroke="rgba(241,233,216,.12)" stroke-width="${0.9 * k}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${rect(L.hut, 'rgba(210,183,126,.25)', 'rgba(210,183,126,.6)')}
    ${rect(L.veg, 'rgba(120,90,60,.35)', 'none')}${rect(L.beans, 'rgba(120,90,60,.35)', 'none')}
    <circle cx="${MX(L.pond.x)}" cy="${MZ(L.pond.z)}" r="${L.pond.r * k}" fill="rgba(110,150,170,.3)"/>
    <text x="${MX(L.hut.x)}" y="${MZ(L.hut.z) + 5}" text-anchor="middle" font-size="14" fill="#f1e9d8">草屋</text>
    <text x="${MX(L.veg.x)}" y="${MZ(L.veg.z) + 5}" text-anchor="middle" font-size="12" fill="#bdb4a1">菜圃</text>
    <text x="${MX(L.beans.x)}" y="${MZ(L.beans.z) + 5}" text-anchor="middle" font-size="12" fill="#bdb4a1">豆田</text>
    <text x="${MX(L.pond.x)}" y="${MZ(L.pond.z) + 4}" text-anchor="middle" font-size="12" fill="#bdb4a1">池</text>
    <text x="${MX(L.eastFence.x) - 4}" y="${MZ((L.eastFence.z0 + L.eastFence.z1) / 2)}" text-anchor="end" font-size="12" fill="#bdb4a1">東籬</text>
    ${seg.filter(s => s.s >= 0 && s.s < 5).map(s => `<polyline points="${s.p.map(([x, z]) => `${MX(x).toFixed(1)},${MZ(z).toFixed(1)}`).join(' ')}" fill="none" stroke="${STAGE_COL[s.s]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <circle cx="${MX(L.start[0])}" cy="${MZ(L.start[1])}" r="5" fill="#f1e9d8"/><text x="${MX(L.start[0]) + 9}" y="${MZ(L.start[1]) + 4}" font-size="12" fill="#f1e9d8">起點</text>
  </svg>
  <p class="fine">${state.actions.map((a, i) => `<span style="color:${STAGE_COL[i % 5]}">━ ${esc(a.name)}</span>`).join('　')}</p>`;

  const extra = ratings.filter(e => e.id.startsWith('prs_')).map(e => {
    const q = state.questions.find(x => x.id === e.id) || {};
    return [q.subscale || e.id, e.value];
  });
  const lingerMs = Number((state.log.find(e => e.type === 'linger') || {}).value || 0);
  const cards = [...extra, ['走動距離（公尺）', Math.round(walked)], ['月下停留（秒）', Math.round(lingerMs / 1000)], ['使用「帶我過去」', `${state.autoWalks} 次`]];
  $('#post-scores').innerHTML = cards.map(([k2, v]) => `<div class="score">${esc(k2)}<b>${esc(v)}</b></div>`).join('');
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
  setScape('city', 0.1);
  $('#title').hidden = true;
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
