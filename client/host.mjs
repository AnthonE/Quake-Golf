// What a page's games share: the sim's wasm and one shared memory, the net
// worker (the session, the clocks, the input words) and the sim worker (the
// confirmed world), the main thread's own instance for the prediction, the
// sound, and one GPU device for every renderer the page has. A game's
// frontend (client/<game>-game.mjs) mounts on a host and draws from it; a
// page with one game (bumper.html, arena.html) mounts one and keeps it, and
// Fireplace mounts each game as the room moves into it.
//   q: the page's query (?url=, ?hash=, ?impair=, ?threads=, ?music=0)
import * as L from '../src/layout.mjs';
import { View } from '../src/view.mjs';
import { wasmPrefix } from '../net/wire.mjs';
import { createSound } from './sound.mjs';
import { parseImpair } from '../net/impair.js';

export const epoch = () => performance.timeOrigin + performance.now();

// A canvas's size: the window's own resolution (up to `max`), or ?res=WxH.
export function fitSize(q, max = [1600, 1000]) {
  if (q.has('res')) return q.get('res').split('x').map(Number);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth * dpr, h = innerHeight * dpr;
  const k = Math.min(1, max[0] / w, max[1] / h);
  return [Math.max(320, Math.round(w * k)), Math.max(200, Math.round(h * k))];
}

// wasm: the sim's URL; watch: a spectator; arena: the arena's input words; fireplace: whichever the game on now reads
export async function createHost({ wasm, q = new URLSearchParams(location.search), watch = false, arena = false, fireplace = false, connect = true }) {
  if (!crossOriginIsolated) throw new Error('the page must be served cross-origin isolated (node tools/serve.mjs)');
  const bytes = await (await fetch(wasm)).arrayBuffer();
  const module = await WebAssembly.compile(bytes);
  const prefix = await wasmPrefix(bytes);
  const memory = new WebAssembly.Memory({ initial: L.PAGES, maximum: L.PAGES, shared: true });
  const i32 = new Int32Array(memory.buffer);
  const h = {
    q, watch, module, bytes, prefix, memory,
    u8: new Uint8Array(memory.buffer), i32, u32: new Uint32Array(memory.buffer), f32: new Float32Array(memory.buffer), f64: new Float64Array(memory.buffer),
    view: new View(memory.buffer), pview: new View(memory.buffer, L.PRED_D),
    set: (a, v) => Atomics.store(i32, a >> 2, v),
    get: (a) => Atomics.load(i32, a >> 2),
    press: (a) => Atomics.add(i32, a >> 2, 1),
    error: '', welcome: null, hashes: [], keys: [], desyncs: [],
    sound: createSound({ music: q.get('music') !== '0' }),
    device: null,
    renderers: new Map(), // a frontend's renderer, kept for when it mounts again
    connected: false,
  };
  h.set(L.CL_SLOT, -1);
  h.set(L.CL_PITCH, 512);
  // the prediction's own instance: it writes only PRED
  h.px = (await WebAssembly.instantiate(module, { env: { mem: memory } })).exports;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU is not available in this browser');
  h.device = await adapter.requestDevice();
  h.device.lost.then((info) => { h.error = `GPU device lost (${info.reason}): ${info.message}`; console.error(h.error, performance.now()); });

  // the session: connect() opens it (a page may show something first)
  h.connect = async () => {
    if (h.connected) return;
    h.connected = true;
    const url = q.get('url') || `https://${location.hostname}:4433/`;
    const hash = q.get('hash') || (await (await fetch(new URL('../certs/hash.txt', import.meta.url))).text()).trim();
    const certHash = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
    const cores = navigator.hardwareConcurrency || 4;
    const threads = Number(q.get('threads') || (cores >= 8 ? 2 : 1));
    const ch = new MessageChannel();
    h.net = new Worker(new URL('./net.mjs', import.meta.url), { type: 'module' });
    h.sim = new Worker(new URL('./sim.mjs', import.meta.url), { type: 'module' });
    h.net.onmessage = (e) => { if (e.data.error) h.error = e.data.error.split('\n')[0]; if (e.data.welcome) h.welcome = e.data.welcome; };
    h.sim.onmessage = (e) => {
      const m = e.data;
      if (m.error) h.error = m.error.split('\n')[0];
      if (m.hashes) h.hashes.push(...m.hashes);
      if (m.key) h.keys.push({ ...m.key, at: performance.now() });
      if (m.desync) h.desyncs.push(m.desync);
    };
    for (const w of [h.net, h.sim]) w.onerror = (e) => { h.error = String(e.message || e); e.preventDefault?.(); };
    h.net.postMessage({ url, certHash, memory, prefix, simPort: ch.port1, impair: parseImpair(q.get('impair')), watch, arena, fireplace }, [ch.port1]);
    h.sim.postMessage({ module, memory, netPort: ch.port2, threads }, [ch.port2]);
    addEventListener('pagehide', () => h.net.postMessage({ leave: true }));
  };
  if (connect) await h.connect();
  return h;
}

// The prediction for slot: the newest confirmed tick plus every input sampled
// since, then the tick in progress with live() as the word for it, stepped on
// the copy. A copy the sim worker stepped under is made again. Returns the
// ticks predicted, or -1 for none.
export function predict(h, slot, live) {
  const { get, i32, u32, view, px } = h;
  const room = get(L.CL_ROOM);
  for (let tries = 0; tries < 4; tries++) {
    const t = performance.now();
    let s0;
    while (((s0 = Atomics.load(i32, L.CL_SEQ >> 2)) & 1) && performance.now() - t < 2);
    if (s0 & 1) return -1;
    const from = room + view.tick;
    const n = get(L.CL_NEXT) - from;
    if (n < 0 || n > 200) return -1;
    for (let i = 0; i < n; i++) u32[(L.PWORDS >> 2) + i] = u32[(L.CL_WORDS >> 2) + ((from + i) & 255)];
    u32[(L.PWORDS >> 2) + n] = live();
    px.predict(slot, n + 1);
    if (Atomics.load(i32, L.CL_SEQ >> 2) === s0) return n + 1;
  }
  return -1;
}

// Corrections ease in: where this rebuild puts the newest tick the last one
// also predicted, against where that one put it, goes into a render-only
// offset that decays over 100 ms. A jump past 4 m (a respawn) snaps.
export function corrector(h) {
  const { u32, f32 } = h;
  let track = new Map();
  const c = { off: [0, 0, 0] };
  c.update = (n, ms) => {
    const now = new Map();
    for (let i = 0; i < n; i++) { const o = (L.PTRACK >> 2) + 4 * i; now.set(u32[o + 3], [f32[o], f32[o + 1], f32[o + 2]]); }
    let t = -1;
    for (const k of now.keys()) if (track.has(k) && k > t) t = k;
    if (t >= 0) {
      const a = track.get(t), b = now.get(t);
      const d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      if (Math.hypot(...d) > 4) c.off = [0, 0, 0];
      else c.off = c.off.map((v, k) => v + d[k]);
    }
    if (n) track = now;
    const f = Math.exp(-ms / 100);
    c.off = c.off.map((v) => v * f);
  };
  return c;
}

// A PNG (base64) of a renderer's next frame, read back from the GPU (headless browsers can't composite WebGPU).
export async function capturePng(renderer, u8, s, scale = 1) {
  const { width, height, rgba } = await renderer.capture(u8, s);
  const small = new OffscreenCanvas(width, height);
  small.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  const big = new OffscreenCanvas(width * scale, height * scale);
  const g = big.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, width * scale, height * scale);
  const out = new Uint8Array(await (await big.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Listeners that go when the frontend does: on(target, type, fn, opts).
export function listeners() {
  const ac = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal });
  return { on, off: () => ac.abort() };
}
