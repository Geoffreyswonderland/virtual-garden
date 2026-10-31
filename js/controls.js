import * as THREE from 'three';
import { EYE, PATHS, APPROACH, NARROW } from './world/layout.js?v=41';

/* First-person walking, kept simple for people who do not play games:
   - joystick: up/down walks forward/back, left/right turns (not sidestep);
     on touch screens it appears wherever the left thumb lands
   - keys: W/S or ↑/↓ walk, A/D or ←/→ turn, Q/E sidestep, Shift to hurry
   - tap the ground to walk there; tap a thing to use it
   - drag to look around: the scenery follows the hand (mouse or finger),
     as in street-view maps
   No head bob, eased starts and stops, to keep motion sickness low. */

const SPEED = 1.8;          // metres per second at full stick
const RUN = 1.6;            // Shift multiplier
const AUTO_SPEED = 1.5;
const TURN = 1.9;           // radians per second at full turn
const R = 0.26;             // player radius

export function createControls({ camera, canvas, colliders, isWalkable, onTap, onUserMove }) {
  const st = {
    x: 0, z: 0, yaw: 0, pitch: -0.05,
    vx: 0, vz: 0, enabled: false, moved: 0,
    stick: { x: 0, y: 0, id: null }, keys: new Set(),
    route: null, turn: null, turnV: 0, crouch: 0, crouchTarget: 0,
  };

  /* ---------- collision ---------- */
  function free(x, z) {
    if (!isWalkable(x, z)) return false;
    for (const [cx, cz, r] of colliders.circles) if ((x - cx) ** 2 + (z - cz) ** 2 < (r + R) ** 2) return false;
    for (const [x0, x1, z0, z1] of colliders.boxes) if (x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R) return false;
    return true;
  }
  function tryMove(dx, dz) {
    const nx = st.x + dx, nz = st.z + dz;
    if (free(nx, nz)) { st.x = nx; st.z = nz; return Math.hypot(dx, dz); }
    if (free(nx, st.z)) { st.x = nx; return Math.abs(dx); }
    if (free(st.x, nz)) { st.z = nz; return Math.abs(dz); }
    return 0;
  }

  /* ---------- joystick ---------- */
  const stickEl = document.getElementById('stick'), knob = document.getElementById('knob');
  const RADIUS = () => stickEl.clientWidth / 2;
  const home = () => { stickEl.style.left = ''; stickEl.style.top = ''; stickEl.style.bottom = ''; };
  let centre = null;
  function stickMove(e) {
    const rad = RADIUS();
    let dx = e.clientX - centre.x, dy = e.clientY - centre.y;
    const len = Math.hypot(dx, dy), max = rad * 0.62;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const x = dx / max, y = -dy / max;
    // small dead zone, and a softer curve so slow walking is easy
    const dz = v => (Math.abs(v) < 0.12 ? 0 : Math.sign(v) * Math.pow((Math.abs(v) - 0.12) / 0.88, 1.3));
    st.stick.x = dz(x); st.stick.y = dz(y);
  }
  function stickStart(e, cx, cy) {
    st.stick.id = e.pointerId;
    centre = { x: cx, y: cy };
    stickEl.classList.add('active');
    stickMove(e);
  }
  stickEl.addEventListener('pointerdown', e => {
    if (!st.enabled) return;
    const r = stickEl.getBoundingClientRect();
    stickEl.setPointerCapture(e.pointerId);
    stickStart(e, r.left + r.width / 2, r.top + r.height / 2);
    e.preventDefault();
  });
  stickEl.addEventListener('pointermove', e => { if (e.pointerId === st.stick.id) stickMove(e); });
  const stickEnd = e => {
    if (e.pointerId !== st.stick.id) return;
    st.stick.id = null; st.stick.x = st.stick.y = 0;
    knob.style.transform = '';
    stickEl.classList.remove('active');
    home();
  };
  stickEl.addEventListener('pointerup', stickEnd);
  stickEl.addEventListener('pointercancel', stickEnd);

  /* ---------- look and tap ---------- */
  const looks = new Map();
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    // a thumb landing on the lower-left of a touch screen becomes the joystick, right there
    if (e.pointerType === 'touch' && st.enabled && st.stick.id === null && e.clientX < innerWidth * 0.42 && e.clientY > innerHeight * 0.45) {
      const rad = RADIUS();
      stickEl.style.left = `${e.clientX - rad}px`;
      stickEl.style.top = `${e.clientY - rad}px`;
      stickEl.style.bottom = 'auto';
      stickStart(e, e.clientX, e.clientY);
      return;
    }
    looks.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, t: performance.now(), dragging: false });
  });
  canvas.addEventListener('pointermove', e => { if (e.pointerId === st.stick.id) stickMove(e); });
  canvas.addEventListener('pointerup', e => { if (e.pointerId === st.stick.id) stickEnd(e); });
  canvas.addEventListener('pointercancel', e => { if (e.pointerId === st.stick.id) stickEnd(e); });
  canvas.addEventListener('pointermove', e => {
    const l = looks.get(e.pointerId);
    if (!l) return;
    l.moved = Math.max(l.moved, Math.hypot(e.clientX - l.sx, e.clientY - l.sy));
    if (st.lookLock) return;   // holding something: the hand is busy
    if (!l.dragging && l.moved > 4) { l.dragging = true; l.x = l.sx; l.y = l.sy; }   // keep the first few pixels too
    if (!l.dragging) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y;
    l.x = e.clientX; l.y = e.clientY;
    canvas.classList.add('dragging');
    const touch = e.pointerType === 'touch';
    // grab the scenery and pull it, as in street-view maps: drag right and the view swings left
    const k = touch ? 0.0055 : 0.005;
    st.yaw += dx * k;
    st.pitch = THREE.MathUtils.clamp(st.pitch + dy * k, -1.1, 0.6);
    st.turn = null;
  });
  const lookEnd = e => {
    const l = looks.get(e.pointerId);
    looks.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (l && l.moved <= 6 && performance.now() - l.t < 600 && e.type === 'pointerup') onTap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', lookEnd);
  canvas.addEventListener('pointercancel', lookEnd);

  /* ---------- keys ---------- */
  const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'tl', KeyD: 'tr', ArrowLeft: 'tl', ArrowRight: 'tr', KeyQ: 'l', KeyE: 'r', KeyR: 'lu', KeyF: 'ld', PageUp: 'lu', PageDown: 'ld', ShiftLeft: 'run', ShiftRight: 'run' };
  window.addEventListener('keydown', e => {
    const k = KEYMAP[e.code];
    if (!k || (e.target.closest && e.target.closest('input, textarea, select'))) return;
    st.keys.add(k);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    // a focused button would otherwise keep the keys from feeling like walking
    if (st.enabled && document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
  });
  window.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) st.keys.delete(k); });
  window.addEventListener('blur', () => st.keys.clear());

  /* ---------- auto walk along the path network ---------- */
  const nodes = [], edges = new Map();
  const nodeId = ([x, z]) => {
    let i = nodes.findIndex(n => Math.hypot(n[0] - x, n[1] - z) < 0.3);
    if (i < 0) { i = nodes.length; nodes.push([x, z]); edges.set(i, new Set()); }
    return i;
  };
  [...PATHS, NARROW].forEach(line => { for (let i = 0; i < line.length - 1; i++) { const a = nodeId(line[i]), b = nodeId(line[i + 1]); edges.get(a).add(b); edges.get(b).add(a); } });
  Object.values(APPROACH).forEach(p => nodeId(p));
  const nearest = (x, z) => nodes.reduce((best, n, i) => (Math.hypot(n[0] - x, n[1] - z) < Math.hypot(nodes[best][0] - x, nodes[best][1] - z) ? i : best), 0);
  function routeTo([tx, tz]) {
    const s = nearest(st.x, st.z), g = nearest(tx, tz);
    const prev = new Map([[s, -1]]), q = [s];
    while (q.length) { const c = q.shift(); if (c === g) break; for (const n of edges.get(c)) if (!prev.has(n)) { prev.set(n, c); q.push(n); } }
    const pts = [];
    for (let c = g; c !== -1 && c !== undefined; c = prev.get(c)) pts.unshift(nodes[c]);
    // skip the first node if we are already past it
    if (pts.length > 1) {
      const [a, b] = pts;
      const ab = [b[0] - a[0], b[1] - a[1]], ap = [st.x - a[0], st.z - a[1]];
      if (ab[0] * ap[0] + ab[1] * ap[1] > 0) pts.shift();
    }
    pts.push([tx, tz]);
    return pts;
  }
  function walkTo(target) {
    return new Promise(resolve => { st.route = { pts: routeTo(target), resolve }; });
  }
  /** walk straight to a point on the ground (tap to walk) */
  function goTo(x, z) {
    cancelRoute();
    return new Promise(resolve => { st.route = { pts: [[x, z]], resolve, keepPitch: true }; });
  }
  function cancelRoute() { if (st.route) { const r = st.route; st.route = null; r.resolve(false); } }

  /** turn the view gently towards a point */
  function faceTo(x, y, z, dur = 1.2) {
    const yaw = Math.atan2(-(x - st.x), -(z - st.z));
    const pitch = Math.atan2(y - (EYE + (st.crouchTarget || 0)), Math.hypot(x - st.x, z - st.z));
    let dy = (yaw - st.yaw) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    st.turn = { y0: st.yaw, dy, p0: st.pitch, p1: THREE.MathUtils.clamp(pitch, -1.1, 0.6), t: 0, dur };
  }

  /* ---------- per frame ---------- */
  const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  function update(dt) {
    let ix = 0, iy = 0;
    let turnIn = 0;
    if (st.enabled) {
      ix = (st.keys.has('r') ? 1 : 0) - (st.keys.has('l') ? 1 : 0);
      iy = st.stick.y + (st.keys.has('f') ? 1 : 0) - (st.keys.has('b') ? 1 : 0);
      // R／F（或 PageUp／PageDown）抬頭、低頭
      if (!st.lookLock && (st.keys.has('lu') || st.keys.has('ld'))) { st.pitch = THREE.MathUtils.clamp(st.pitch + ((st.keys.has('lu') ? 1 : 0) - (st.keys.has('ld') ? 1 : 0)) * 1.1 * dt, -1.1, 0.6); st.turn = null; }
      turnIn = Math.max(-1, Math.min(1, st.stick.x + (st.keys.has('tr') ? 1 : 0) - (st.keys.has('tl') ? 1 : 0)));
      const len = Math.hypot(ix, iy);
      if (len > 1) { ix /= len; iy /= len; }
      if (st.keys.has('run')) { ix *= RUN; iy *= RUN; }
      if (len > 0.05 || Math.abs(turnIn) > 0.05) { st.turn = null; if (st.route) { cancelRoute(); onUserMove && onUserMove('cancel_auto'); } }
    }
    // turning eases in and out quickly, so it feels direct without jerking
    st.turnV += (turnIn * TURN - st.turnV) * (1 - Math.exp(-dt * 12));
    st.yaw -= st.turnV * dt;
    let tvx = 0, tvz = 0;
    if (st.route) {
      const [px, pz] = st.route.pts[0];
      const dx = px - st.x, dz = pz - st.z, d = Math.hypot(dx, dz);
      if (d < 0.25) {
        st.route.pts.shift();
        if (!st.route.pts.length) { const r = st.route; st.route = null; r.resolve(true); }
      } else {
        tvx = dx / d * AUTO_SPEED; tvz = dz / d * AUTO_SPEED;
        const want = Math.atan2(-dx, -dz);
        let dy = (want - st.yaw) % (Math.PI * 2);
        if (dy > Math.PI) dy -= Math.PI * 2;
        if (dy < -Math.PI) dy += Math.PI * 2;
        st.yaw += dy * Math.min(1, dt * 3);
        if (!st.route.keepPitch) st.pitch += (-0.08 - st.pitch) * Math.min(1, dt * 2);
      }
    } else if (ix || iy) {
      const s = Math.sin(st.yaw), c = Math.cos(st.yaw);
      // forward is -z in camera space
      tvx = (-s * iy + c * ix) * SPEED;
      tvz = (-c * iy - s * ix) * SPEED;
    }
    // when walking with the eyes on the ground, the gaze drifts back up to the horizon
    if (!st.turn && !st.lookLock && Math.hypot(st.vx, st.vz) > 0.3 && st.pitch < -0.45) st.pitch += (-0.2 - st.pitch) * Math.min(1, dt * 1.6);
    const speeding = tvx * tvx + tvz * tvz > st.vx * st.vx + st.vz * st.vz;
    const k = 1 - Math.exp(-dt * (speeding ? 9 : 14));
    st.vx += (tvx - st.vx) * k;
    st.vz += (tvz - st.vz) * k;
    const moved = tryMove(st.vx * dt, st.vz * dt);
    if (moved === 0) { st.vx *= 0.5; st.vz *= 0.5; }
    st.moved += moved;
    // give up a route if something blocks the way
    if (st.route) {
      st.route.stuck = moved < 0.2 * AUTO_SPEED * dt ? (st.route.stuck || 0) + dt : 0;
      if (st.route.stuck > 0.7) cancelRoute();
    }
    if (st.turn) {
      const T = st.turn;
      T.t += dt;
      const e = ease(Math.min(1, T.t / T.dur));
      st.yaw = T.y0 + T.dy * e;
      st.pitch = T.p0 + (T.p1 - T.p0) * e;
      if (T.t >= T.dur) st.turn = null;
    }
    // crouching (to sow or pull weeds) eases the eye down and back up
    st.crouch += ((st.crouchTarget || 0) - st.crouch) * Math.min(1, dt * 5);
    st.floorY = (st.floorY || 0) + ((st.floorTarget || 0) - (st.floorY || 0)) * Math.min(1, dt * 8);
    camera.position.set(st.x, EYE + st.crouch + st.floorY, st.z);
    camera.rotation.set(st.pitch, st.yaw, 0, 'YXZ');
    return moved;
  }

  function place(x, z, yaw = 0, pitch = -0.05) { Object.assign(st, { x, z, yaw, pitch, vx: 0, vz: 0 }); update(0); }
  const speed = () => Math.hypot(st.vx, st.vz);

  return { st, update, place, walkTo, goTo, free, cancelRoute, faceTo, speed, set enabled(v) { st.enabled = v; if (!v) { st.stick.x = st.stick.y = 0; knob.style.transform = ''; } }, get enabled() { return st.enabled; } };
}
