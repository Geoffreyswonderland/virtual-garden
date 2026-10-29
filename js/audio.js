/* Soundscapes, synthesised in the browser for the prototype. The research
   version should use loudness-matched field recordings.
   city   : traffic hum and passing carts (久在樊籠裡)
   garden : wind, a small stream, birds
   night  : crickets and a softer wind                                  */

const AU = { ctx: null, master: null, on: true, scape: 'city', bus: {}, water: null };

function noiseBuffer(ctx, brown) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
const filt = (type, freq, q = 0.7) => { const f = AU.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
const gain = v => { const g = AU.ctx.createGain(); g.gain.value = v; return g; };
function loopNoise(brown) {
  const s = AU.ctx.createBufferSource();
  s.buffer = brown ? AU.brown : AU.white;
  s.loop = true;
  s.start(0, Math.random() * 3);
  return s;
}

export function audioInit() {
  if (AU.ctx) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  AU.ctx = ctx;
  AU.white = noiseBuffer(ctx, false);
  AU.brown = noiseBuffer(ctx, true);
  AU.master = gain(AU.on ? 0.7 : 0);
  AU.master.connect(ctx.destination);
  const bus = AU.bus;
  ['city', 'garden', 'night'].forEach(k => { bus[k] = gain(k === AU.scape ? 1 : 0); bus[k].connect(AU.master); });

  // city
  loopNoise(true).connect(filt('lowpass', 160)).connect(gain(0.5)).connect(bus.city);
  loopNoise(false).connect(filt('bandpass', 700, 0.5)).connect(gain(0.05)).connect(bus.city);
  const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 58;
  hum.connect(filt('lowpass', 220)).connect(gain(0.018)).connect(bus.city); hum.start();

  // garden
  const wg = gain(0.2);
  loopNoise(true).connect(filt('lowpass', 420)).connect(wg).connect(bus.garden);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; lfo.connect(gain(0.1)).connect(wg.gain); lfo.start();
  const sf = filt('bandpass', 1300);
  const sp = ctx.createStereoPanner(); sp.pan.value = -0.5;
  loopNoise(false).connect(sf).connect(gain(0.035)).connect(sp).connect(bus.garden);
  setInterval(() => sf.frequency.setTargetAtTime(1000 + Math.random() * 700, ctx.currentTime, 0.4), 700);

  // night
  loopNoise(true).connect(filt('lowpass', 300)).connect(gain(0.1)).connect(bus.night);
  [[4300, -0.5, 27], [4700, 0.6, 31], [3900, 0.1, 24]].forEach(([f, pan, rate]) => {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const am = gain(0), sq = ctx.createOscillator(); sq.type = 'square'; sq.frequency.value = rate;
    sq.connect(gain(0.5)).connect(am.gain); sq.start(); o.start();
    const gate = gain(0), p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(am).connect(gate).connect(gain(0.025)).connect(p).connect(bus.night);
    const loop = () => {
      const t = ctx.currentTime;
      gate.gain.setTargetAtTime(1, t, 0.01);
      gate.gain.setTargetAtTime(0, t + 0.18 + Math.random() * 0.12, 0.02);
      setTimeout(loop, 500 + Math.random() * 1100);
    };
    loop();
  });

  scheduleCart();
  scheduleBird();
}

export function setScape(name, seconds = 3) {
  AU.scape = name;
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime;
  Object.entries(AU.bus).forEach(([k, g]) => g.gain.setTargetAtTime(k === name ? 1 : 0, t, seconds / 3));
}

function scheduleCart() {
  setTimeout(() => {
    if (AU.scape === 'city' && AU.ctx) {
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
    scheduleCart();
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
    g.gain.linearRampToValueAtTime(0.04, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(pan);
    o.start(t); o.stop(t + dur + 0.05);
    t += dur + 0.03 + Math.random() * 0.08;
  }
}
function scheduleBird() {
  setTimeout(() => { if (AU.scape === 'garden' && AU.ctx) chirp(); scheduleBird(); }, 2500 + Math.random() * 5500);
}

const SHOTS = {
  creak: ['bandpass', 380, 6, 0.08, 0.9],
  pull: ['bandpass', 900, 1.2, 0.07, 0.35],
  seed: ['highpass', 3000, 0.7, 0.03, 0.08],
  stepDirt: ['lowpass', 520, 0.7, 0.05, 0.11],
  stepGrass: ['highpass', 1800, 0.6, 0.025, 0.16],
  pick: ['bandpass', 1500, 1.5, 0.04, 0.15],
};
export function oneShot(kind, vol = 1) {
  if (!AU.ctx || !SHOTS[kind]) return;
  const C = AU.ctx, t = C.currentTime, s = C.createBufferSource(); s.buffer = AU.white;
  const [type, f0, q, v, dur] = SHOTS[kind];
  const f = filt(type, f0 * (0.9 + Math.random() * 0.2), q), g = gain(0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  s.connect(f).connect(g).connect(AU.master);
  s.start(t, Math.random() * 3); s.stop(t + dur + 0.05);
}

export function waterSound(on) {
  if (!AU.ctx) return;
  const C = AU.ctx;
  if (on && !AU.water) {
    const s = C.createBufferSource(); s.buffer = AU.white; s.loop = true;
    const g = gain(0); g.gain.linearRampToValueAtTime(0.06, C.currentTime + 0.4);
    s.connect(filt('highpass', 2500)).connect(g).connect(AU.master); s.start();
    AU.water = { s, g };
  } else if (!on && AU.water) {
    const { s, g } = AU.water;
    g.gain.linearRampToValueAtTime(0, C.currentTime + 0.5);
    s.stop(C.currentTime + 0.6);
    AU.water = null;
  }
}

export function toggleSound() {
  AU.on = !AU.on;
  if (AU.master) AU.master.gain.setTargetAtTime(AU.on ? 0.7 : 0, AU.ctx.currentTime, 0.1);
  return AU.on;
}
export const soundOn = () => AU.on;

/** a soft two-note chime when a line of poetry appears */
export function chime() {
  if (!AU.ctx) return;
  const C = AU.ctx, t = C.currentTime;
  [[880, 0], [1318.5, 0.18]].forEach(([f, d]) => {
    const o = C.createOscillator(), g = C.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.05, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + d + 1.6);
    o.connect(g).connect(AU.master); o.start(t + d); o.stop(t + d + 1.7);
  });
}
