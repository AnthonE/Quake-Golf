// Sound from noise and a few oscillators: a blast is a low-passed noise burst
// that falls off with distance, a shot a short crack, a sink a rising whoosh,
// and the rest are blips. The music is bytebeat (see tune below).
export function createSound({ music = true } = {}) {
  let ac = null;
  let noise = null;
  let song = null; // { key, src, gain }
  let want = [null, false]; // the tune last asked for, played once the context wakes
  let cached = { key: null, buf: null };
  const wake = () => {
    if (ac) return;
    try {
      ac = new AudioContext();
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ac = null; }
    play(...want);
  };
  const burst = (gain, cutoff, len, fall) => {
    if (!ac || gain < 0.01) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noise;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(fall, t + len);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(ac.destination);
    src.start(t);
    src.stop(t + len);
  };
  // one oscillator, gliding from `from` to `to` Hz, starting `at` seconds from now
  const blip = (from, to, len, gain, type = 'square', at = 0) => {
    if (!ac) return;
    const t = ac.currentTime + at;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + len);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + len);
  };
  // The tune for `key` loops while `on`, fading in as the one before fades out.
  // Asked for while not on (in the countdown), it is only rendered, ahead of time.
  const play = (key, on) => {
    want = [key, on];
    if (!ac) return;
    if (key !== null && music && cached.key !== key) cached = { key, buf: render(ac, key) };
    if (!on || !music) key = null;
    if ((song?.key ?? null) === key) return;
    const t = ac.currentTime;
    if (song) {
      song.gain.gain.setTargetAtTime(0, t, 0.3);
      song.src.stop(t + 2);
      song = null;
    }
    if (key === null) return;
    const src = ac.createBufferSource();
    src.buffer = cached.buf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3000;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(0.16, t, 0.2);
    src.connect(f).connect(gain).connect(ac.destination);
    src.start(t);
    song = { key, src, gain };
  };
  return {
    wake,
    blast: (dist, radius) => burst(Math.min(1, 6 / (dist + 6)) * (radius > 4.5 ? 0.9 : 0.6), 2400, 0.7, 60),
    shot: (grenade) => burst(0.25, grenade ? 900 : 3000, 0.12, 200),
    sink: (dist) => blip(80, 900, 0.9, Math.min(0.3, 3 / (dist + 10)), 'sawtooth'),
    holed: () => [0, 4, 7, 12].forEach((n, i) => blip(523 * 2 ** (n / 12), 523 * 2 ** (n / 12), 0.25, 0.08, 'square', 0.9 + i * 0.09)),
    count: (n) => blip(n ? 440 : 880, n ? 440 : 880, n ? 0.12 : 0.4, 0.1),
    tick: () => blip(1600, 1200, 0.04, 0.06),
    jump: () => blip(180, 420, 0.12, 0.12, 'triangle'),
    land: (speed) => burst(Math.min(0.5, speed / 30), 500, 0.18, 50),
    weapon: () => blip(900, 1800, 0.04, 0.05),
    // the arena's: a gun by its W_* kind, falling off with distance; a hit, a kill, a melee, a pickup
    gun: (w, dist = 0) => {
      const g = Math.min(1, 8 / (dist + 8));
      ({
        1: () => burst(0.2 * g, 2600, 0.08, 300), 2: () => burst(0.24 * g, 3200, 0.1, 260), 3: () => burst(0.32 * g, 2200, 0.16, 160),
        4: () => { burst(0.55 * g, 1800, 0.5, 70); blip(140, 60, 0.3, 0.12 * g, 'sawtooth'); }, 5: () => burst(0.6 * g, 1300, 0.35, 70),
        6: () => { burst(0.35 * g, 700, 0.45, 60); blip(90, 300, 0.3, 0.06 * g, 'sawtooth'); },
        7: () => blip(1100, 280, 0.09, 0.07 * g, 'sawtooth'), 8: () => blip(2000, 1300, 0.05, 0.05 * g, 'triangle'),
        9: () => blip(180, 700, 0.18, 0.1 * g, 'sawtooth'),
      }[w] || (() => burst(0.2 * g, 2500, 0.1, 200)))();
    },
    hit: (head) => blip(head ? 3000 : 2200, head ? 3000 : 2200, 0.03, 0.05),
    hurt: (shields) => (shields ? blip(1300, 500, 0.12, 0.07, 'sine') : burst(0.3, 600, 0.15, 80)),
    kill: () => [0, 7].forEach((n, i) => blip(660 * 2 ** (n / 12), 660 * 2 ** (n / 12), 0.12, 0.07, 'square', i * 0.08)),
    melee: (dist = 0) => burst(0.3 * Math.min(1, 6 / (dist + 6)), 900, 0.12, 120),
    pickup: () => blip(500, 1500, 0.12, 0.08, 'triangle'),
    music: play,
    toggleMusic: () => { music = !music; play(...want); return music; },
  };
}

// Bytebeat: a tune as one line of arithmetic per sample, 8000 samples a
// second, 8 bits, the way the demoscene fits a song in a tweet. The key picks
// a pentatonic, four chord roots and 32 notes walked up and down it: a
// plucked square lead, a saw bass, a kick, a snare and a hat, 117 bpm. The
// loop is 2^18 samples (33 s) and its second half repeats the first with an
// echo.
export const RATE = 8000;
export const LEN = 1 << 18;
export function tune(key) {
  let s = (key >>> 0) || 1;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
  for (let i = 0; i < 4; i++) r();
  const major = r() & 1;
  const SCALE = major ? [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] : [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
  const ROOTS = (major ? [[0, 9, 5, 7], [0, 5, 9, 7], [0, 7, 9, 5]] : [[0, 8, 3, 10], [0, 5, 8, 7], [0, 10, 8, 7]])[r() % 3];
  const p = (n) => 8 * 2 ** (n / 12); // a saw's step per sample: 8 is 250 Hz
  const mel = [];
  for (let i = 0, k = 4; i < 32; i++) {
    k = Math.max(0, Math.min(9, k + (r() % 5) - 2));
    mel.push(r() % 6 ? p(SCALE[k]) : 0);
  }
  const bassP = ROOTS.map((n) => p(n - 12));
  const noise = (t) => { let h = Math.imul(t, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); return ((h ^ h >>> 13) >>> 24) / 128 - 1; };
  const lead = (t) => {
    const step = t >> 11, n = mel[(step & 15) | (step >> 4 & 1) << 4];
    return n && ((t * n) & 128 ? 1 : -1) * (2047 - (t & 2047)) / 2048;
  };
  return (t) => {
    const step = t >> 11, e = t & 2047, k = t & 8191, q = t & 4095;
    const echo = t >= LEN / 2 ? lead((t - 3 * 2048) & (LEN - 1)) * 0.4 : 0;
    const bass = ((t * bassP[step >> 4 & 3]) & 255) / 128 - 1;
    const kick = k < 4096 ? Math.sin(Math.sqrt(k) * 1.6) * Math.max(0, 1 - k / 3000) : 0;
    const snare = k >= 4096 ? noise(t) * Math.max(0, 1 - q / 1500) : 0;
    const hat = step & 1 ? noise(t) * Math.max(0, 1 - e / 500) : 0;
    const v = lead(t) * 0.26 + echo * 0.26 + bass * (step & 1 ? 0.14 : 0.22) + kick * 0.34 + snare * 0.16 + hat * 0.07;
    return Math.max(0, Math.min(255, Math.round(128 + v * 127)));
  };
}

function render(ac, key) {
  const f = tune(key);
  const buf = ac.createBuffer(1, LEN, RATE);
  const d = buf.getChannelData(0);
  for (let t = 0; t < LEN; t++) d[t] = (f(t) - 128) / 128;
  return buf;
}
