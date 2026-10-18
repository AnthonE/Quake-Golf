// The main thread: raw mouse and keys into the input slots, then a frame per
// display refresh drawn straight from the sim's shared memory. Before each
// frame it rebuilds the prediction layer on its own instance of game.wasm:
// your player and your shots, run ahead of the confirmed world through every
// input sampled since its newest tick. The camera and your projectiles come
// from there; everything else from the confirmed world. The net worker and
// the sim worker do the rest; ?bot=1 hands the input slots to a golf bot.
import * as L from '../src/layout.mjs';
import { View } from '../src/view.mjs';
import { wasmPrefix, packInput } from '../net/wire.mjs';
import { createRenderer, COLS } from './render.mjs';
import { put, C } from './font.mjs';
import { createSound } from './sound.mjs';
import { parseImpair } from '../net/impair.js';
import { readClock } from './clock.mjs';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('screen');
const note = document.getElementById('note');
const [W, H] = (q.get('res') || '320x200').split('x').map(Number);
canvas.width = W;
canvas.height = H;
const SENS = Number(q.get('sens') || 3); // yaw units (1/16384 turn) per pixel of mouse
const BOT = q.get('bot') === '1';

const epoch = () => performance.timeOrigin + performance.now();
const stateText = ['CONNECTING', 'CATCHING UP', '', 'DISCONNECTED'];

async function main() {
  if (!crossOriginIsolated) throw new Error('the page must be served cross-origin isolated (node tools/serve.mjs)');
  const bytes = await (await fetch('../build/game.wasm')).arrayBuffer();
  const module = await WebAssembly.compile(bytes);
  const prefix = await wasmPrefix(bytes);
  const url = q.get('url') || `https://${location.hostname}:4433/`;
  const hash = q.get('hash') || (await (await fetch('../certs/hash.txt')).text()).trim();
  const certHash = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
  const memory = new WebAssembly.Memory({ initial: L.PAGES, maximum: L.PAGES, shared: true });
  const u8 = new Uint8Array(memory.buffer);
  const i32 = new Int32Array(memory.buffer);
  const u32 = new Uint32Array(memory.buffer);
  const f32 = new Float32Array(memory.buffer);
  const f64 = new Float64Array(memory.buffer);
  const view = new View(memory.buffer);
  const pview = new View(memory.buffer, L.PRED_D);
  const set = (a, v) => Atomics.store(i32, a >> 2, v);
  const get = (a) => Atomics.load(i32, a >> 2);
  set(L.CL_SLOT, -1);
  set(L.CL_PITCH, 512);
  // the prediction's own instance: it writes only PRED
  const { exports: px } = await WebAssembly.instantiate(module, { env: { mem: memory } });

  const renderer = await createRenderer(canvas, { present: q.get('present') !== '0' });
  const sound = createSound();
  const ch = new MessageChannel();
  const net = new Worker(new URL('./net.mjs', import.meta.url), { type: 'module' });
  const sim = new Worker(new URL('./sim.mjs', import.meta.url), { type: 'module' });
  let error = '';
  let welcome = null;
  // for the runs: [sim tick, interval hash], keyframes restored, desyncs named, resyncs asked for, fills
  const hashes = [], keys = [], desyncs = [], syncs = [], fills = [];
  let netSeen = null;
  net.onmessage = (e) => { if (e.data.error) error = e.data.error.split('\n')[0]; if (e.data.welcome) welcome = e.data.welcome; if (e.data.seen) netSeen = e.data.seen; };
  sim.onmessage = (e) => {
    const m = e.data;
    if (m.error) error = m.error.split('\n')[0];
    if (m.hashes) hashes.push(...m.hashes);
    if (m.key) keys.push({ ...m.key, at: performance.now() });
    if (m.desync) desyncs.push({ ...m.desync, at: performance.now() });
    if (m.sync !== undefined) syncs.push({ why: m.sync, at: performance.now(), next: m.next, newest: m.newest, after: m.after, behind: m.behind });
    if (m.filled) fills.push(m.filled);
  };
  // an exception a worker's own timer throws reaches only its error event
  for (const w of [net, sim]) w.onerror = (e) => { error = String(e.message || e); e.preventDefault?.(); };
  net.postMessage({ url, certHash, memory, prefix, simPort: ch.port1, impair: parseImpair(q.get('impair')) }, [ch.port1]);
  sim.postMessage({ module, memory, netPort: ch.port2 }, [ch.port2]);
  addEventListener('pagehide', () => net.postMessage({ leave: true }));

  // input: yaw and pitch kept as floats for the camera, sampled as integers
  let yaw = 0, pitch = 512;
  let weapon = 0;
  const held = new Set();
  const MOVES = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8, Space: 16 };
  const setMove = (m) => { if (m !== get(L.CL_MOVE)) { set(L.CL_MOVE, m); f64[L.CL_MOVEAT >> 3] = epoch(); } };
  const writeKeys = () => { let m = 0; for (const k of held) m |= MOVES[k] || 0; setMove(m); };
  const aim = () => { set(L.CL_YAW, Math.round(yaw) & 0x3fff); set(L.CL_PITCH, Math.round(pitch)); };
  const setWeapon = (w) => { weapon = w; set(L.CL_WEAPON, w); };
  let locked = false;
  if (BOT) {
    const bot = new Worker(new URL('./botworker.mjs', import.meta.url), { type: 'module' });
    bot.postMessage({ module, memory, genome: q.get('genome') });
  } else {
    canvas.addEventListener('click', () => {
      sound.wake();
      if (!locked) canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => canvas.requestPointerLock());
    });
    document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (!locked) { held.clear(); writeKeys(); } });
    const look = (e) => {
      if (!locked) return;
      yaw += e.movementX * SENS;
      pitch = Math.max(16, Math.min(1008, pitch - e.movementY * SENS / 8));
      aim();
    };
    document.addEventListener('onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', look);
    document.addEventListener('mousedown', (e) => {
      if (!locked) return;
      if (e.button === 0) set(L.CL_PRESSES, get(L.CL_PRESSES) + 1);
      if (e.button === 2) setWeapon(weapon ^ 1);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { if (locked && e.deltaY) setWeapon(e.deltaY > 0 ? 1 : 0); });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Digit1') setWeapon(0);
      else if (e.code === 'Digit2') setWeapon(1);
      else if (e.code === 'KeyQ' && !e.repeat) setWeapon(weapon ^ 1);
      else if (e.code === 'KeyF' && !e.repeat) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().then(() => navigator.keyboard?.lock?.()).catch(() => {});
      }
      if (MOVES[e.code] || e.code === 'Tab') e.preventDefault();
      held.add(e.code);
      writeKeys();
    });
    document.addEventListener('keyup', (e) => { held.delete(e.code); writeKeys(); });
    addEventListener('blur', () => { held.clear(); writeKeys(); });
  }

  const text = new Uint32Array(COLS * renderer.rows);
  const flashes = [];
  let fxSeen = 0;
  let seed = -1;
  let faced = -1;
  let banner = { text: '', until: 0 };
  let frames = 0, fpsAt = performance.now(), fps = 0, lastFrame = performance.now();
  // input to screen, ms: when the move keys changed until a frame's predicted
  // player had them, and until the confirmed world had stepped the first tick
  // with them; and in frames, 1 being the first frame drawn after the change
  const latency = { pred: [], conf: [], frames: [], gaps: [] };
  let moved = { at: 0 }, sampled = { tick: -1 };
  let me = null, pme = null;
  window.__qg = {
    hashes, keys, desyncs, syncs, fills, latency, net: () => netSeen,
    state: () => ({
      slot: get(L.CL_SLOT), clState: get(L.CL_STATE), keys: get(L.CL_KEYS), repairs: get(L.CL_REPAIRS), hole: view.hole(), me, predicted: pme, nballs: view.nballs, error, welcome,
      lead: f32[L.CL_LEAD >> 2], delay: f32[L.CL_DELAY >> 2], jitter: f32[L.CL_JITTER >> 2], queued: get(L.CL_QUEUED), next: get(L.CL_NEXT),
      play: readClock(i32, f64, L.CL_PLAY, epoch()), pred: readClock(i32, f64, L.CL_PRED, epoch()), room: get(L.CL_ROOM), net: netSeen,
    }),
    // the debug flip: one bit of this client's confirmed world (by default the lowest of ball 0's x)
    flip: (addr = L.PX, bit = 0) => sim.postMessage({ flip: { addr, bit } }),
  };

  // The prediction layer for this frame: the newest confirmed tick plus every
  // input sampled since, then the tick in progress with the input as it is
  // now (a click counted as its next shot), stepped on the copy. So a key or a
  // click shows on the next frame. A copy the sim worker stepped under is made
  // again. Returns the ticks predicted, or -1 for none.
  const live = () => {
    const sent = get(L.CL_SENT);
    const mv = get(L.CL_MOVE);
    return packInput({ yaw: get(L.CL_YAW), pitch: get(L.CL_PITCH), move: mv & 15, jump: (mv >> 4) & 1, shot: (get(L.CL_PRESSES) - sent) > 0 ? sent + 1 : sent, weapon: get(L.CL_WEAPON) });
  };
  function predict(slot) {
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
  // offset that decays over 100 ms. A jump past 4 m (a new tee) snaps.
  let track = new Map();
  let corr = [0, 0, 0];
  function correct(n, ms) {
    const now = new Map();
    for (let i = 0; i < n; i++) { const o = (L.PTRACK >> 2) + 4 * i; now.set(u32[o + 3], [f32[o], f32[o + 1], f32[o + 2]]); }
    let t = -1;
    for (const k of now.keys()) if (track.has(k) && k > t) t = k;
    if (t >= 0) {
      const a = track.get(t), b = now.get(t);
      const d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      if (Math.hypot(...d) > 4) corr = [0, 0, 0];
      else corr = corr.map((v, k) => v + d[k]);
    }
    if (n) track = now;
    const f = Math.exp(-ms / 100);
    corr = corr.map((v) => v * f);
  }
  // Your shots and blasts play once: from the prediction when it has them,
  // else from the confirmed ring. Your shot numbers only go up.
  const played = { [L.FX_SHOT]: -1, [L.FX_BLAST]: -1 };
  const fresh = (f) => { const d = (f.shot - played[f.kind]) & 0xffff; return d > 0 && d < 0x8000; };

  function frame(now) {
    requestAnimationFrame(frame);
    frames++;
    if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; }
    const ms = now - lastFrame;
    lastFrame = now;
    if (ms > 50) latency.gaps.push(Math.round(ms));
    const nowE = epoch();
    const st = get(L.CL_STATE);
    const slot = get(L.CL_SLOT);
    const h = view.hole();
    if (st >= 1 && view.dv.getUint32(L.HDR_SEED, true) !== seed && welcome) {
      seed = view.dv.getUint32(L.HDR_SEED, true);
      renderer.setTerrain(u8);
    }
    // the playout clock says how far past the newest stepped tick to draw the confirmed world
    const room = get(L.CL_ROOM);
    const dt = Math.max(0, Math.min(3, readClock(i32, f64, L.CL_PLAY, nowE) - room - h.tick)) * 0.008;
    me = slot >= 0 ? view.player(slot) : null;
    pme = null;
    let dtPred = dt;
    if (me?.live && st === 2) {
      const n = predict(slot);
      if (n >= 0) {
        pme = pview.player(slot);
        // the prediction stands at the end of the tick in progress; the predicted clock is one or two ticks before that
        dtPred = Math.max(-2.5, Math.min(1, readClock(i32, f64, L.CL_PRED, nowE) - room - pview.tick)) * 0.008;
        correct(n, ms);
        if (played[L.FX_SHOT] < 0) played[L.FX_SHOT] = played[L.FX_BLAST] = me.shots;
      }
    }
    if (me?.live && faced !== h.hole) {
      // face the cup on a new hole
      faced = h.hole;
      yaw = Math.atan2(h.dir[1], h.dir[0]) / (2 * Math.PI) * 16384;
      pitch = 512;
      if (!BOT) aim();
    }
    if (BOT) { yaw = get(L.CL_YAW); pitch = get(L.CL_PITCH); }
    let cam;
    if (pme) cam = [0, 1, 2].map((k) => pme.pos[k] + pme.vel[k] * dtPred + corr[k] + (k === 1 ? 1.6 : 0));
    else if (me?.live) cam = [me.pos[0] + me.vel[0] * dt, me.pos[1] + me.vel[1] * dt + 1.6, me.pos[2] + me.vel[2] * dt];
    else cam = [h.tee[0] - h.dir[0] * 25, h.tee[1] + 12, h.tee[2] - h.dir[1] * 25];
    const camYaw = me?.live ? yaw / 16384 * 2 * Math.PI : Math.atan2(h.dir[1], h.dir[0]);
    const camPitch = me?.live ? (pitch - 512) / 1024 * Math.PI : -0.12;

    // how long a change of keys takes to show, predicted and confirmed
    // (only changes made and shown in play count: one made in the countdown waits for the tee-off)
    const playing = h.state === L.H_PLAY && me?.live && st === 2;
    const movedAt = f64[L.CL_MOVEAT >> 3];
    if (movedAt !== moved.at) moved = { at: movedAt, bits: get(L.CL_MOVE) & 15, done: !playing, frame: frames };
    const moveTick = get(L.CL_MOVETICK);
    if (moveTick !== sampled.tick) sampled = { tick: moveTick, at: f64[L.CL_MOVESEEN >> 3], done: !playing };
    if (!playing) moved.done = sampled.done = true;
    else {
      if (moved.at && !moved.done && pme && ((pme.input >>> 24) & 15) === moved.bits) {
        moved.done = true;
        latency.pred.push(nowE - moved.at);
        latency.frames.push(frames - moved.frame + 1);
      }
      if (sampled.at && !sampled.done && room + h.tick > sampled.tick) { sampled.done = true; latency.conf.push(nowE - sampled.at); }
    }

    // FX: flashes and sounds, yours from the prediction first, skipping what a catch-up stepped through
    const show = (f) => {
      const d = Math.hypot(f.pos[0] - cam[0], f.pos[1] - cam[1], f.pos[2] - cam[2]);
      if (f.kind === L.FX_BLAST) { flashes.push({ pos: f.pos, born: now, size: f.size * 0.7, kind: 1 }); sound.blast(d, f.size); }
      if (f.kind === L.FX_SHOT && f.owner === slot) sound.shot(f.size);
      if (f.kind === L.FX_SINK) {
        flashes.push({ pos: [f.pos[0], f.pos[1] + 0.5, f.pos[2]], born: now, size: 2.5, kind: 2 });
        sound.sink(d);
        if (f.owner === slot) banner = { text: `IN THE HOLE IN ${f.shot}`, until: now + 4000 };
      }
    };
    const mine = (f) => f.owner === slot && (f.kind === L.FX_SHOT || f.kind === L.FX_BLAST);
    if (pme) {
      for (let k = 0; k < pview.fxCount(); k++) {
        const f = pview.fx(k);
        if (mine(f) && fresh(f)) { played[f.kind] = f.shot; show(f); }
      }
    }
    const nfx = view.fxCount();
    for (; fxSeen < nfx; fxSeen++) {
      const f = view.fx(fxSeen);
      if (h.tick - f.tick > 60) continue;
      if (mine(f)) { if (!fresh(f)) continue; played[f.kind] = f.shot; }
      show(f);
    }
    for (let k = flashes.length - 1; k >= 0; k--) {
      flashes[k].age = (now - flashes[k].born) / 1000;
      if (flashes[k].age > 0.6) flashes.splice(k, 1);
    }

    hudText(text, { h, me: pme || me, slot, st, cam, now, fps, banner });
    last = {
      cam, yaw: camYaw, pitch: camPitch, time: now / 1000, dt, dtPred, proj: pme ? L.PROJ + L.PRED_D : L.PROJ, cup: h.cup, dir: h.dir, slot: slot < 0 ? 999 : slot,
      myBall: me?.live ? me.ball : -1, nballs: view.nballs, flashes, text,
    };
    renderer.frame(u8, last);
  }
  let last = null;
  // a PNG of the next frame, read back from the GPU (headless browsers can't composite WebGPU)
  window.__qg.capture = async (scale = 2) => {
    if (!last) return null;
    const { width, height, rgba } = await renderer.capture(u8, last);
    const small = new OffscreenCanvas(width, height);
    small.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    const big = new OffscreenCanvas(width * scale, height * scale);
    const g = big.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, width * scale, height * scale);
    const blob = await big.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  function hudText(t, { h, me, slot, st, cam, now, fps, banner }) {
    t.fill(0);
    const rows = renderer.rows;
    const right = (y, s, c) => put(t, COLS, COLS - 1 - String(s).length, y, s, c);
    const centre = (y, s, c) => put(t, COLS, Math.floor((COLS - String(s).length) / 2), y, s, c);
    if (st !== 2 || !me?.live) {
      centre(Math.floor(rows / 2) - 3, error ? 'ERROR: ' + error.slice(0, 64) : stateText[st] || 'JOINING', error ? C.RED : C.YELLOW);
    }
    const dist = Math.hypot(h.cup[0] - h.tee[0], h.cup[2] - h.tee[2]);
    put(t, COLS, 1, 0, `HOLE ${h.hole + 1}  PAR ${h.par}  ${Math.round(dist)}M`);
    if (me?.live) right(0, `STROKES ${me.strokes}`, C.YELLOW);
    const left = Math.max(0, h.until - h.tick);
    const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
    if (h.state === L.H_COUNT) centre(2, `TEE OFF IN ${Math.ceil(left / 125)}`, C.YELLOW);
    if (h.state === L.H_PLAY) centre(1, clock(left), left < 30 * 125 ? C.RED : C.WHITE);
    if (banner.until > now) centre(Math.floor(rows / 2) + 4, banner.text, C.GREEN);
    if (me?.live) {
      put(t, COLS, 1, rows - 1, '1 ROCKET', get(L.CL_WEAPON) === 0 ? C.ORANGE : C.GREY);
      put(t, COLS, 11, rows - 1, '2 GRENADE', get(L.CL_WEAPON) === 1 ? C.ORANGE : C.GREY);
      if (me.done) right(rows - 1, 'IN', C.GREEN);
      else if (me.ball >= 0) {
        const b = view.ball(me.ball).pos;
        right(rows - 1, `BALL ${Math.round(Math.hypot(b[0] - h.cup[0], b[2] - h.cup[2]))}M TO CUP  YOU ${Math.round(Math.hypot(b[0] - cam[0], b[2] - cam[2]))}M`, C.CYAN);
      }
    }
    put(t, COLS, 1, rows - 2, `${fps} FPS  LEAD ${f32[L.CL_LEAD >> 2].toFixed(1)}  DELAY ${f32[L.CL_DELAY >> 2].toFixed(1)}  SLACK ${f32[L.CL_PING >> 2].toFixed(1)}MS  REPAIRS ${get(L.CL_REPAIRS)}  KEYS ${get(L.CL_KEYS)}`, C.GREY);
    if (!BOT && !locked && st === 2) centre(Math.floor(rows / 2) + 2, 'CLICK TO PLAY', C.WHITE);
    if (h.state === L.H_OVER || (held.has('Tab') && h.live)) {
      const list = [];
      for (let p = 0; p < L.NPLAYER; p++) { const pl = view.player(p); if (pl.live) list.push(pl); }
      list.sort((a, b) => a.total - b.total || a.slot - b.slot);
      const y0 = 6;
      centre(y0, h.state === L.H_OVER ? 'HOLE OVER' : 'SCORES', C.YELLOW);
      centre(y0 + 2, 'PLAYER      HOLE  TOTAL  HOLES', C.GREY);
      list.slice(0, rows - y0 - 6).forEach((pl, k) => {
        const name = (pl.slot === slot ? 'YOU ' : 'P') + String(pl.slot + 1);
        const hole = h.state === L.H_OVER ? String(pl.score) : String(pl.strokes);
        centre(y0 + 3 + k, `${name.padEnd(10)}  ${hole.padStart(4)}  ${String(pl.total).padStart(5)}  ${String(pl.holes).padStart(5)}`, pl.slot === slot ? C.YELLOW : C.WHITE);
      });
    }
  }

  note.remove();
  requestAnimationFrame(frame);
}

main().catch((e) => {
  note.textContent = String(e?.message || e);
  window.__qg = { error: String(e?.stack || e) };
});
