// The film's half of a page (Fireplace's ?film=<seconds>, driven by
// tools/film.mjs): the page's clock held to the film's, the game's own sound
// rendered offline on the film's timeline, and each frame composed to the
// film's size. A replay steps the sim, so nothing here touches the world.
import { createSound } from './sound.mjs';
import { cardText } from './room-render.mjs';

// The main thread's performance.now() reads the film's time, plus the real
// time since the frame began (at most 5 ms, so a wait that counts real time
// still ends). The sim's clock is the replay's, paused at the film's tick.
export function filmClock() {
  const real = performance.now.bind(performance);
  let film = 0, from = real();
  performance.now = () => film + Math.min(5, real() - from);
  return { at(ms) { film = ms; from = real(); } };
}

// The game's sound into an OfflineAudioContext `seconds` long, each call at
// the film's output time. While the film skips (live false) only the tune
// asked for is kept, and it starts when the film goes live again.
export function filmSound(seconds, { music = true } = {}) {
  const RATE = 48000;
  const off = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
  let out = 0, live = false, held = null;
  const ctx = new Proxy(off, { get: (o, k) => (k === 'currentTime' ? out : typeof o[k] === 'function' ? o[k].bind(o) : o[k]) });
  const real = createSound({ music, context: ctx });
  real.wake();
  const sound = {};
  for (const [k, fn] of Object.entries(real)) {
    sound[k] = (...a) => {
      if (k === 'music' && !live) { held = a; return undefined; }
      return live || k === 'wake' || k === 'toggleMusic' ? fn(...a) : undefined;
    };
  }
  return {
    sound,
    at(t, on) {
      out = Math.min(t, seconds);
      if (on && !live && held) { real.music(...held); held = null; }
      live = on;
    },
    // the whole track as a 16-bit WAV, base64
    async render() {
      const buf = await off.startRendering();
      const d = buf.getChannelData(0);
      const b = new DataView(new ArrayBuffer(44 + 2 * d.length));
      const str = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF'); b.setUint32(4, 36 + 2 * d.length, true); str(8, 'WAVEfmt ');
      b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, RATE, true);
      b.setUint32(28, RATE * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, 2 * d.length, true);
      for (let i = 0; i < d.length; i++) b.setInt16(44 + 2 * i, Math.max(-1, Math.min(1, d[i])) * 32767, true);
      return base64(new Uint8Array(b.buffer));
    },
  };
}

// A screenshot (a base64 PNG) fitted to W x H on black, a game drawn small
// scaled up in whole pixels first so it stays sharp; a caption in the games'
// 3x5 font low on the right, clear of the games' maps. A JPEG, base64.
export async function compose(png, W, H, caption = '') {
  const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const k = Math.min(W / img.width, H / img.height);
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  let src = img;
  if (k > 1.5) {
    const n = Math.ceil(k);
    const big = new OffscreenCanvas(img.width * n, img.height * n);
    const bg = big.getContext('2d');
    bg.imageSmoothingEnabled = false;
    bg.drawImage(img, 0, 0, big.width, big.height);
    src = big;
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  if (caption) {
    const px = Math.round(H / 135);
    const lines = caption.toUpperCase().split('\n');
    const y0 = H - Math.round(H * 0.09) - lines.length * 8 * px;
    const wide = Math.max(...lines.map((s) => s.length * 4 * px));
    const x = W - Math.round(W * 0.06);
    g.fillStyle = 'rgba(8, 6, 4, 0.72)';
    g.fillRect(x - wide - 3 * px, y0 - 2 * px, W - x + wide + 3 * px, lines.length * 8 * px + 3 * px);
    lines.forEach((s, i) => cardText(g, s, x, y0 + i * 8 * px, px, i ? '#e8d6c0' : '#ffcf6a', 'right'));
  }
  return base64(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.93 })).arrayBuffer()));
}

function base64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
