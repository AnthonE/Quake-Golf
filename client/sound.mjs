// Sound from noise and one oscillator: a blast is a low-passed noise burst
// that falls off with distance, a shot a short crack, a sink a rising whoosh.
export function createSound() {
  let ac = null;
  let noise = null;
  const wake = () => {
    if (ac) return;
    try {
      ac = new AudioContext();
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ac = null; }
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
  return {
    wake,
    blast: (dist, radius) => burst(Math.min(1, 6 / (dist + 6)) * (radius > 4.5 ? 0.9 : 0.6), 2400, 0.7, 60),
    shot: (grenade) => burst(0.25, grenade ? 900 : 3000, 0.12, 200),
    sink: (dist) => {
      if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(80, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.8);
      g.gain.setValueAtTime(Math.min(0.3, 3 / (dist + 10)), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + 0.9);
    },
  };
}
