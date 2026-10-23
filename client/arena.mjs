// The arena's main thread: golf's client (client/main.mjs) with a shooter on
// top. The same net and sim workers and the same prediction layer, on the
// arena's build of the sim; raw mouse and keys into the input slots; a frame
// per display refresh drawn from shared memory by client/arena-render.mjs,
// with tracers, sparks, the gun in your hands, shields and health, ammo, a
// motion tracker, a kill feed and the scoreboard.
//   ?bot=1 hands the controls to an AI fighter (client/arena-bot.mjs)
//   ?watch=1 spectates; ?url=, ?hash=, ?impair=, ?sens=, ?res= as golf's
import * as L from '../src/layout.mjs';
import { View, arenaWord, unpackArena } from '../src/arena-view.mjs';
import { wasmPrefix } from '../net/wire.mjs';
import { createRenderer, COLS } from './arena-render.mjs';
import { put, C } from './font.mjs';
import { createSound } from './sound.mjs';
import { parseImpair } from '../net/impair.js';
import { readClock } from './clock.mjs';
import { NetGraph } from './netgraph.mjs';
import { Fighter } from './arena-bot.mjs';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('screen');
const note = document.getElementById('note');
const [W, H] = (q.get('res') || '320x200').split('x').map(Number);
canvas.width = W;
canvas.height = H;
const SENS = Number(q.get('sens') || 3);
const BOT = q.get('bot') === '1';
const WATCH = q.get('watch') === '1';
const cores = navigator.hardwareConcurrency || 4;
const THREADS = Number(q.get('threads') || (cores >= 8 ? 2 : 1));
const epoch = () => performance.timeOrigin + performance.now();
const TURN = 16384;
const ARMS = L.ARMS;
const COLOR = { // per weapon: tracer colour, viewmodel body
  [L.W_AR]: [1, 0.85, 0.45], [L.W_BR]: [1, 0.9, 0.55], [L.W_MAGNUM]: [1, 0.85, 0.5], [L.W_SNIPER]: [1, 1, 0.9],
  [L.W_SHOTGUN]: [1, 0.8, 0.4], [L.W_ROCKET]: [1, 0.6, 0.2], [L.W_PLASMA]: [0.4, 0.8, 1], [L.W_NEEDLER]: [1, 0.4, 0.9], [L.W_SWORD]: [0.5, 0.9, 1],
};
const SHORT = { [L.W_AR]: 'AR', [L.W_BR]: 'BR', [L.W_MAGNUM]: 'MAGNUM', [L.W_SNIPER]: 'SNIPER', [L.W_SHOTGUN]: 'SHOTGUN', [L.W_ROCKET]: 'ROCKET',
  [L.W_PLASMA]: 'PLASMA', [L.W_NEEDLER]: 'NEEDLER', [L.W_SWORD]: 'SWORD', [L.KILL_GREN]: 'FRAG', [L.KILL_MELEE]: 'MELEE', [L.KILL_BEHIND]: 'ASSASSINATION',
  [L.KILL_SUPER]: 'SUPERCOMBINE', [L.KILL_FALL]: 'FALL' };
const CROSS = { [L.W_AR]: 0, [L.W_BR]: 1, [L.W_MAGNUM]: 1, [L.W_SNIPER]: 1, [L.W_SHOTGUN]: 2, [L.W_ROCKET]: 3, [L.W_PLASMA]: 4, [L.W_NEEDLER]: 4, [L.W_SWORD]: 5 };
const MODE = L.FIESTA ? 'FIESTA' : 'SLAYER';
const MEDALS = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'OVERKILL', 'KILLTACULAR', 'KILLTROCITY', 'KILLAMANJARO'];
const SPREES = { 5: 'KILLING SPREE', 10: 'KILLING FRENZY', 15: 'RUNNING RIOT', 20: 'RAMPAGE' };

async function main() {
  if (!crossOriginIsolated) throw new Error('the page must be served cross-origin isolated (node tools/serve.mjs)');
  const bytes = await (await fetch('../build/arena/game.wasm')).arrayBuffer();
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
  const press = (a) => Atomics.add(i32, a >> 2, 1);
  set(L.CL_SLOT, -1);
  set(L.CL_PITCH, 512);
  const { exports: px } = await WebAssembly.instantiate(module, { env: { mem: memory } });

  const renderer = await createRenderer(canvas, { present: q.get('present') !== '0' });
  const sound = createSound({ music: false });
  const ch = new MessageChannel();
  const net = new Worker(new URL('./net.mjs', import.meta.url), { type: 'module' });
  const sim = new Worker(new URL('./sim.mjs', import.meta.url), { type: 'module' });
  let error = '';
  let welcome = null;
  const hashes = [], keys = [], desyncs = [];
  net.onmessage = (e) => { if (e.data.error) error = e.data.error.split('\n')[0]; if (e.data.welcome) welcome = e.data.welcome; };
  sim.onmessage = (e) => {
    const m = e.data;
    if (m.error) error = m.error.split('\n')[0];
    if (m.hashes) hashes.push(...m.hashes);
    if (m.key) keys.push({ ...m.key, at: performance.now() });
    if (m.desync) desyncs.push(m.desync);
  };
  for (const w of [net, sim]) w.onerror = (e) => { error = String(e.message || e); e.preventDefault?.(); };
  net.postMessage({ url, certHash, memory, prefix, simPort: ch.port1, impair: parseImpair(q.get('impair')), watch: WATCH, arena: true }, [ch.port1]);
  sim.postMessage({ module, memory, netPort: ch.port2, threads: THREADS }, [ch.port2]);
  addEventListener('pagehide', () => net.postMessage({ leave: true }));

  // ---- input
  let yaw = 0, pitch = 512;
  let slotOut = 0;
  let zoomed = false;
  let trigger = false;
  const held = new Set();
  const MOVES = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8, Space: 16 };
  const writeKeys = () => { let m = 0; for (const k of held) m |= MOVES[k] || 0; set(L.CL_MOVE, m); };
  const aim = () => { set(L.CL_YAW, Math.round(yaw) & 0x3fff); set(L.CL_PITCH, Math.round(pitch)); };
  const swap = (s) => { if (s !== slotOut) { sound.weapon(); zoomed = false; } slotOut = s; set(L.CL_WEAPON, s); };
  let locked = false;
  let watched = -1;
  let showGraph = q.get('net') === '1';
  let bot = null;
  const nextLive = (from, step) => {
    for (let k = 1; k <= L.NPLAYER; k++) {
      const p = (((from + step * k) % L.NPLAYER) + L.NPLAYER) % L.NPLAYER;
      if (view.player(p).live) return p;
    }
    return -1;
  };
  if (WATCH) {
    const turn = (step) => { watched = nextLive(watched, step); };
    canvas.addEventListener('click', () => turn(1));
    document.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowRight' || e.code === 'Space') turn(1);
      if (e.code === 'ArrowLeft') turn(-1);
      if (e.code === 'Tab') { e.preventDefault(); held.add('Tab'); }
      if (e.code === 'KeyN' && !e.repeat) showGraph = !showGraph;
    });
    document.addEventListener('keyup', (e) => held.delete(e.code));
  } else if (BOT) {
    bot = new Fighter(0, (Math.random() * 1e9) | 0, Number(q.get('skill') || 0.7));
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); held.add('Tab'); }
      if (e.code === 'KeyN' && !e.repeat) showGraph = !showGraph;
    });
    document.addEventListener('keyup', (e) => held.delete(e.code));
  } else {
    canvas.addEventListener('click', () => {
      sound.wake();
      if (!locked) canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => canvas.requestPointerLock());
    });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvas;
      if (!locked) { held.clear(); writeKeys(); trigger = false; set(L.CL_AUTO, 0); }
    });
    const look = (e) => {
      if (!locked) return;
      const s = SENS / (zoomed ? zoomOf() : 1);
      yaw += e.movementX * s;
      pitch = Math.max(16, Math.min(1008, pitch - e.movementY * s / 8));
      aim();
    };
    document.addEventListener('onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', look);
    document.addEventListener('mousedown', (e) => {
      if (!locked) return;
      if (e.button === 0) { press(L.CL_PRESSES); trigger = true; }
      if (e.button === 2) { if (zoomOf() > 1) { zoomed = !zoomed; sound.weapon(); } }
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) { trigger = false; set(L.CL_AUTO, 0); } });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { if (locked && e.deltaY) swap(slotOut ^ 1); });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Digit1') swap(0);
      else if (e.code === 'Digit2') swap(1);
      else if ((e.code === 'KeyX' || e.code === 'KeyY') && !e.repeat) swap(slotOut ^ 1);
      else if ((e.code === 'KeyQ' || e.code === 'KeyV') && !e.repeat) { press(L.CL_MELEE); zoomed = false; }
      else if (e.code === 'KeyG' && !e.repeat) { press(L.CL_GREN); zoomed = false; }
      else if (e.code === 'KeyR' && !e.repeat) { press(L.CL_RELOAD); zoomed = false; }
      else if (e.code === 'KeyE' && !e.repeat) press(L.CL_USE);
      else if (e.code === 'KeyN' && !e.repeat) showGraph = !showGraph;
      else if (e.code === 'KeyF' && !e.repeat) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().then(() => navigator.keyboard?.lock?.()).catch(() => {});
      }
      if (MOVES[e.code] || e.code === 'Tab') e.preventDefault();
      held.add(e.code);
      writeKeys();
    });
    document.addEventListener('keyup', (e) => { held.delete(e.code); writeKeys(); });
    addEventListener('blur', () => { held.clear(); writeKeys(); trigger = false; set(L.CL_AUTO, 0); });
  }

  // ---- the prediction (as golf's), with the arena's word in progress
  const live = () => {
    const sent = get(L.CL_SENT), mv = get(L.CL_MOVE);
    const room = get(L.CL_ROOM), next = get(L.CL_NEXT);
    const ahead = (a, s) => ((get(a) - get(s)) > 0 ? get(s) + 1 : get(s)) & 1;
    return arenaWord({ yaw: get(L.CL_YAW), pitch: get(L.CL_PITCH), move: mv & 15, jump: (mv >> 4) & 1,
      shot: (get(L.CL_PRESSES) - sent) > 0 || get(L.CL_AUTO) ? sent + 1 : sent, melee: ahead(L.CL_MELEE, L.CL_MSENT), gren: ahead(L.CL_GREN, L.CL_GSENT),
      slot: get(L.CL_WEAPON), serial: (get(L.CL_FRAME) >> ((next - room) & 7)) & 1 });
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

  // ---- what happened: FX into flashes, tracers, the feed and sounds
  const text = new Uint32Array(COLS * renderer.rows);
  const netGraph = new NetGraph(memory, { watch: WATCH });
  const glows = []; // { pos, size, color, kind, born, life, grow }
  const tracers = []; // { a, b, width, color, born, life }
  const feed = []; // { text, color, born }
  let banner = { text: '', until: 0, color: C.YELLOW };
  let medal = { text: '', until: 0 };
  let marker = 0, hurt = 0, kick = 0, lastShotAt = -1e9, meleeAt = -1e9, swapAt = -1e9, lastSlot = 0, lastWeapon = 0;
  let dealt = false;
  let fxSeen = 0, seed = -1, spawnedAt = -1, lastKill = -1e9, multi = 0, spree = 0, matchSeen = -1;
  const played = {}; // kind -> newest of my shot numbers played
  const newer = (a, b) => { const d = (a - b) & 0xffff; return d > 0 && d < 0x8000; };
  const lastShots = new Map(); // slot -> [shots, when], for the motion tracker
  let frames = 0, fpsAt = performance.now(), fps = 0, lastFrame = performance.now();
  let me = null, pme = null;
  const muzzle = (cam, cy, sy, cp, sp) => [cam[0] + cy * cp * 0.7 - sy * 0.22, cam[1] + sp * 0.7 - 0.22, cam[2] + sy * cp * 0.7 + cy * 0.22];
  window.__qa = { hashes, keys, desyncs, state: () => ({ slot: get(L.CL_SLOT), clState: get(L.CL_STATE), me, error, welcome, match: view.hole(), feed: feed.map((f) => f.text) }) };

  function show(f, slot, cam, now, mine, eyeOf) {
    const d = Math.hypot(f.pos[0] - cam[0], f.pos[1] - cam[1], f.pos[2] - cam[2]);
    switch (f.kind) {
      case L.FX_SHOT:
        if (mine) { kick = 1; lastShotAt = now; }
        else glows.push({ pos: eyeOf(f.owner), size: 0.35, color: [...(COLOR[f.size] || [1, 1, 1]), 1], kind: 3, born: now, life: 60 });
        sound.gun(f.size, mine ? 0 : d);
        break;
      case L.FX_TRACER: {
        const w = f.size;
        const a = mine ? muzzle(cam, Math.cos(camYaw), Math.sin(camYaw), Math.cos(camPitch), Math.sin(camPitch)) : eyeOf(f.owner);
        const sniper = w === L.W_SNIPER;
        tracers.push({ a, b: f.pos, width: sniper ? 0.06 : 0.025, color: [...(COLOR[w] || [1, 1, 1]), sniper ? 0.9 : 0.7], born: now, life: sniper ? 500 : 70 });
        if (!mine || d < 80) glows.push({ pos: f.pos, size: 0.15, color: [1, 0.9, 0.6, 0.8], kind: 5, born: now, life: 120 });
        break;
      }
      case L.FX_HIT: {
        const shield = f.size === 1;
        glows.push({ pos: f.pos, size: shield ? 0.9 : 0.35, color: shield ? [0.5, 0.75, 1, 0.9] : [0.9, 0.1, 0.1, 0.9], kind: shield ? 6 : 5, born: now, life: shield ? 220 : 160 });
        if (f.owner === slot && slot >= 0) { marker = 1; sound.hit(f.size === 3); }
        if (f.shot === slot && f.owner !== slot) { hurt = Math.min(1, hurt + 0.5); zoomed = false; sound.hurt(shield); }
        break;
      }
      case L.FX_KILL: {
        const name = (p) => (p === slot ? 'YOU' : `P${p + 1}`);
        const cause = SHORT[f.size] || '?';
        feed.push({ text: f.owner === f.shot ? `${name(f.shot)} DIED` : `${name(f.owner)} [${cause}] ${name(f.shot)}`, color: f.owner === slot ? C.GREEN : f.shot === slot ? C.RED : C.WHITE, born: now });
        if (feed.length > 5) feed.shift();
        glows.push({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 1.4, color: [1, 0.3, 0.2, 0.8], kind: 3, born: now, life: 400 });
        if (f.owner === slot && f.shot !== slot) {
          multi = now - lastKill < 4500 ? multi + 1 : 1;
          lastKill = now;
          spree++;
          sound.kill();
          const m = SPREES[spree] || MEDALS[Math.min(multi, MEDALS.length - 1)] || (f.size === L.KILL_BEHIND ? 'ASSASSINATION' : f.size === L.KILL_SUPER ? 'NEEDLER SUPERCOMBINE' : '');
          if (m) medal = { text: m, until: now + 2500 };
          banner = { text: `YOU KILLED P${f.shot + 1}`, until: now + 1800, color: C.GREEN };
        }
        if (f.shot === slot) { spree = 0; multi = 0; banner = { text: f.owner === slot ? 'YOU DIED' : `KILLED BY P${f.owner + 1}`, until: now + 3000, color: C.RED }; }
        break;
      }
      case L.FX_BLAST:
        glows.push({ pos: f.pos, size: f.size < 1 ? 0.6 : f.size, color: f.size < 1 ? [0.4, 0.8, 1, 1] : [1, 0.6, 0.2, 1], kind: 3, born: now, life: 500, grow: true });
        if (f.size >= 1) sound.blast(d, f.size);
        break;
      case L.FX_SPAWN:
        glows.push({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 1.2, color: [0.4, 0.7, 1, 0.8], kind: 6, born: now, life: 500 });
        if (f.owner === slot) { spawnedAt = now; spree = 0; if (L.FIESTA) dealt = true; }
        break;
      case L.FX_PICKUP:
        if (f.owner === slot) { sound.pickup(); banner = { text: ARMS[f.size].name, until: now + 1500, color: C.CYAN }; }
        break;
      case L.FX_MELEE:
        if (mine) meleeAt = now;
        sound.melee(mine ? 0 : d);
        break;
      default:
    }
  }

  let camYaw = 0, camPitch = 0;
  function zoomOf() {
    const f = pme || me;
    if (!f) return 1;
    return ARMS[f.weapon]?.zoom || 1;
  }

  // The gun in your hands as rectangles, at 320x200, pointing at the centre.
  function gunRects(w, now, moving) {
    const out = [];
    const s = W / 320;
    const t = now / 1000;
    const bob = moving ? Math.sin(t * 9) * 2.5 : Math.sin(t * 1.5) * 0.8;
    const drop = Math.max(0, 1 - (now - swapAt) / 350) * 60 + (pme?.reload ? 26 : 0) + (pme?.dead ? 200 : 0);
    const lunge = Math.max(0, 1 - (now - meleeAt) / 250);
    const k = kick * (w === L.W_SNIPER || w === L.W_ROCKET || w === L.W_SHOTGUN ? 2.2 : 1);
    const ox = bob + k * 5 - lunge * 40 - 16, oy = Math.abs(bob) + k * 7 + drop - lunge * 10 - 8;
    const rect = (x0, y0, x1, y1, c, a = 1) => out.push([(x0 + ox) * s, (y0 + oy) * s, (x1 + ox) * s, (y1 + oy) * s, c[0], c[1], c[2], a]);
    // a thick line from (x0, y0) to (x1, y1) as a stair of rects
    const bar = (x0, y0, x1, y1, wd, c) => {
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * (i + 0.5) / n, y = y0 + (y1 - y0) * (i + 0.5) / n;
        const shade = 0.8 + 0.25 * (i / n);
        rect(x - wd / 2, y - wd / 2, x + wd / 2, y + wd / 2, c.map((v) => v * shade));
      }
    };
    const flash = now - lastShotAt < 50 && w !== L.W_SWORD;
    let tip = [205, 142];
    switch (w) {
      case L.W_AR:
        bar(305, 210, 232, 158, 24, [0.3, 0.33, 0.28]); bar(236, 160, 205, 142, 9, [0.15, 0.16, 0.15]);
        rect(262, 166, 274, 172, [0.3, 0.9, 1]); bar(268, 186, 262, 205, 9, [0.2, 0.22, 0.2]);
        break;
      case L.W_BR:
        bar(305, 210, 230, 158, 22, [0.42, 0.44, 0.46]); bar(232, 159, 200, 140, 8, [0.2, 0.2, 0.22]); bar(270, 168, 238, 150, 8, [0.12, 0.12, 0.14]);
        tip = [200, 140];
        break;
      case L.W_MAGNUM:
        bar(300, 212, 252, 172, 18, [0.72, 0.74, 0.78]); bar(255, 174, 228, 156, 9, [0.55, 0.57, 0.6]); bar(290, 200, 296, 215, 12, [0.25, 0.22, 0.2]);
        tip = [228, 156];
        break;
      case L.W_SNIPER:
        bar(310, 214, 236, 160, 20, [0.17, 0.19, 0.19]); bar(238, 161, 178, 126, 6, [0.1, 0.1, 0.1]); bar(282, 176, 240, 152, 11, [0.06, 0.06, 0.07]);
        tip = [178, 126];
        break;
      case L.W_SHOTGUN:
        bar(312, 214, 262, 180, 22, [0.38, 0.25, 0.15]); bar(265, 182, 206, 146, 12, [0.3, 0.3, 0.32]); bar(250, 178, 222, 160, 9, [0.22, 0.15, 0.1]);
        tip = [206, 146];
        break;
      case L.W_ROCKET:
        bar(330, 212, 224, 146, 36, [0.28, 0.33, 0.22]); bar(232, 151, 222, 145, 38, [0.15, 0.17, 0.12]); bar(300, 170, 270, 150, 8, [0.12, 0.12, 0.12]);
        tip = [222, 145];
        break;
      case L.W_PLASMA:
        bar(305, 210, 236, 166, 28, [0.42, 0.3, 0.62]); bar(244, 160, 214, 146, 5, [0.4, 0.85, 1]); bar(246, 174, 216, 156, 5, [0.4, 0.85, 1]);
        tip = [214, 151];
        break;
      case L.W_NEEDLER:
        bar(305, 210, 238, 166, 26, [0.38, 0.22, 0.45]);
        for (let i = 0; i < 6; i++) { const x = 290 - i * 9, y = 186 - i * 6; rect(x - 2, y - 12, x + 2, y - 2, [1, 0.45, 0.9]); }
        tip = [232, 160];
        break;
      case L.W_SWORD:
        bar(300, 214, 272, 186, 14, [0.3, 0.3, 0.33]); bar(270, 186, 222, 104, 6, [0.55, 0.95, 1]); bar(282, 190, 248, 100, 6, [0.55, 0.95, 1]);
        break;
      default:
        bar(300, 214, 262, 180, 16, [0.85, 0.7, 0.55]);
    }
    if (flash) { rect(tip[0] - 9, tip[1] - 7, tip[0] + 5, tip[1] + 5, w === L.W_PLASMA ? [0.5, 0.9, 1] : w === L.W_NEEDLER ? [1, 0.5, 0.9] : [1, 0.85, 0.4], 0.95); }
    return out;
  }

  function hudRects(f, now) {
    const out = [];
    const s = W / 320;
    const r = (x0, y0, x1, y1, c, a = 1) => out.push([x0 * s, y0 * s, x1 * s, y1 * s, c[0], c[1], c[2], a]);
    // shields over health, top centre under the clock
    const low = f.sh < 25 && Math.floor(now / 150) % 2;
    r(109, 8, 211, 15, [0.05, 0.08, 0.12], 0.7);
    r(110, 9, 110 + f.sh, 14, low ? [1, 0.3, 0.2] : [0.35, 0.7, 1]);
    if (f.shieldIn === 0 && f.sh < 100) r(110 + f.sh, 9, 111 + f.sh, 14, [1, 1, 1]);
    for (let k = 0; k < 8; k++) {
      const filled = f.hp > k * 12.5;
      r(110 + k * 12.6, 17, 110 + k * 12.6 + 11, 20, filled ? (f.hp < 35 ? [1, 0.3, 0.2] : [0.4, 0.9, 0.4]) : [0.15, 0.15, 0.15], 0.85);
    }
    // the motion tracker: enemies within 25 m that move or shoot
    const R = 26, cx = 32 * s, cy = (H / s - 32) * s;
    const fy = Math.cos(camYaw), fz = Math.sin(camYaw);
    for (let p = 0; p < L.NPLAYER; p++) {
      if (p === f.slot) continue;
      const o = view.fighter(p);
      if (!o.live || o.dead) continue;
      const dx = o.pos[0] - f.pos[0], dz = o.pos[2] - f.pos[2];
      const dist = Math.hypot(dx, dz);
      const ls = lastShots.get(p);
      if (!ls || ls[0] !== o.shots) lastShots.set(p, [o.shots, now]);
      const loud = Math.hypot(o.vel[0], o.vel[2]) > 3 || now - (lastShots.get(p)?.[1] ?? -1e9) < 1500;
      if (dist > 25 || !loud) continue;
      const fwd = dx * fy + dz * fz, right = -dx * fz + dz * fy;
      const x = cx / s + right / 25 * R, y = cy / s - fwd / 25 * R;
      r(x - 1.5, y - 1.5, x + 1.5, y + 1.5, [1, 0.25, 0.2]);
    }
    return { rects: out, tracker: [cx, cy, R * s] };
  }

  // Is the crosshair over an enemy within the gun's range? For the red reticle.
  function onTarget(f, cam) {
    const arm = ARMS[f.weapon];
    if (!arm) return false;
    const range = arm.type === 0 ? arm.range : arm.type === 2 ? 5 : 60;
    const d = [Math.cos(camPitch) * Math.cos(camYaw), Math.sin(camPitch), Math.cos(camPitch) * Math.sin(camYaw)];
    for (let p = 0; p < L.NPLAYER; p++) {
      if (p === f.slot) continue;
      const o = view.player(p);
      if (!o.live || u8[L.PLAYERS + p * L.PSIZE + L.P_FL] & L.PF_DEAD) continue;
      const c = [o.pos[0] - cam[0], o.pos[1] + 1 - cam[1], o.pos[2] - cam[2]];
      const t = c[0] * d[0] + c[1] * d[1] + c[2] * d[2];
      if (t < 0 || t > range) continue;
      const miss = Math.hypot(c[0] - d[0] * t, (c[1] - d[1] * t) * 0.6, c[2] - d[2] * t);
      if (miss < 0.6) return true;
    }
    return false;
  }

  let last = null;
  function frame(now) {
    requestAnimationFrame(frame);
    frames++;
    if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; }
    const ms = Math.min(100, now - lastFrame);
    lastFrame = now;
    const nowE = epoch();
    const st = get(L.CL_STATE);
    const slot = get(L.CL_SLOT);
    const h = view.hole();
    if (st >= 1 && view.dv.getUint32(L.HDR_SEED, true) !== seed && welcome) {
      seed = view.dv.getUint32(L.HDR_SEED, true);
      renderer.setTerrain(u8);
    }
    const room = get(L.CL_ROOM);
    const dt = Math.max(0, Math.min(3, readClock(i32, f64, L.CL_PLAY, nowE) - room - h.tick)) * 0.008;
    me = slot >= 0 ? view.fighter(slot) : null;
    pme = null;
    let tgt = null;
    if (WATCH && st >= 1) {
      if (watched < 0 || !view.player(watched).live) watched = nextLive(watched, 1);
      tgt = watched >= 0 ? view.fighter(watched) : null;
    }
    // the bot drives the slots as the keys and mouse would
    if (bot && me?.live && st === 2) {
      const w = unpackArena(bot.think(view, h.tick, Math.round(readClock(i32, f64, L.CL_PRED, nowE) - readClock(i32, f64, L.CL_PLAY, nowE))));
      yaw = w.yaw; pitch = w.pitch;
      aim();
      set(L.CL_MOVE, w.move | (w.jump << 4));
      if (w.shot !== (bot.lastShot ?? w.shot)) press(L.CL_PRESSES);
      if (w.melee !== (bot.lastMelee ?? w.melee)) press(L.CL_MELEE);
      if (w.gren !== (bot.lastGren ?? w.gren)) press(L.CL_GREN);
      if (bot.wantUse) press(L.CL_USE);
      Object.assign(bot, { lastShot: w.shot, lastMelee: w.melee, lastGren: w.gren });
      swap(w.slot);
    }
    let dtPred = dt;
    if (me?.live && st === 2) {
      const n = predict(slot);
      if (n >= 0) {
        pme = pview.fighter(slot);
        dtPred = Math.max(-2.5, Math.min(1, readClock(i32, f64, L.CL_PRED, nowE) - room - pview.tick)) * 0.008;
        correct(n, ms);
        for (const k of [L.FX_SHOT, L.FX_TRACER, L.FX_MELEE, L.FX_BLAST]) if (played[k] === undefined) played[k] = me.shots;
      }
    }
    // automatics keep asking while the trigger is held
    if (!BOT && !WATCH) set(L.CL_AUTO, trigger && locked && ARMS[(pme || me)?.weapon]?.auto ? 1 : 0);
    // a new life or a new match: look down the gulch
    if (me?.live && h.hole !== matchSeen) { matchSeen = h.hole; if (!BOT) { yaw = me.pos[0] < 512 ? 0 : TURN / 2; pitch = 512; aim(); } }
    const f = tgt || pme || me;
    if (dealt && me?.live && !me.dead) { dealt = false; banner = { text: `${ARMS[me.gun[0]].name} + ${ARMS[me.gun[1]].name}`, until: now + 2500, color: C.CYAN }; }
    if (pme && (pme.hand !== lastSlot || pme.weapon !== lastWeapon)) { swapAt = now; lastSlot = pme.hand; lastWeapon = pme.weapon; }
    let cam;
    if (pme) cam = [0, 1, 2].map((k) => pme.pos[k] + pme.vel[k] * dtPred + corr[k] + (k === 1 ? 1.6 : 0));
    else if (me?.live) cam = [me.pos[0] + me.vel[0] * dt, me.pos[1] + me.vel[1] * dt + 1.6, me.pos[2] + me.vel[2] * dt];
    else if (tgt) cam = [tgt.pos[0] + tgt.vel[0] * dt, tgt.pos[1] + tgt.vel[1] * dt + 1.6, tgt.pos[2] + tgt.vel[2] * dt];
    else cam = [512 - 140, view.height(372, 512) + 14, 512];
    camYaw = me?.live && !WATCH ? yaw / TURN * 2 * Math.PI : tgt ? tgt.yaw : 0;
    camPitch = me?.live && !WATCH ? (pitch - 512) / 1024 * Math.PI : tgt ? tgt.pitch : -0.15;
    // dead: the camera backs up and rises over where you fell
    if (f?.dead) {
      const up = Math.min(1, (L.RESPAWN_TICKS - f.respawn) / 150);
      cam[0] -= Math.cos(camYaw) * 5 * up; cam[2] -= Math.sin(camYaw) * 5 * up; cam[1] += 1 + 5 * up;
      camPitch = -0.45;
    }
    // never inside the ground
    cam[1] = Math.max(cam[1], view.height(cam[0], cam[2]) + 0.4);

    // FX: mine from the prediction first, then the confirmed ring
    const eyeOf = (p) => { const o = view.player(p); return [o.pos[0] + o.vel[0] * dt, o.pos[1] + 1.45, o.pos[2] + o.vel[2] * dt]; };
    const mineKinds = new Set([L.FX_SHOT, L.FX_TRACER, L.FX_MELEE, L.FX_BLAST]);
    const isMine = (x) => x.owner === slot && slot >= 0 && mineKinds.has(x.kind) && (x.kind !== L.FX_BLAST || x.shot !== 0);
    if (pme) {
      const best = {};
      for (let k = 0; k < pview.fxCount(); k++) {
        const x = pview.fx(k);
        if (isMine(x) && newer(x.shot, played[x.kind])) { show(x, slot, cam, now, true, eyeOf); best[x.kind] = newer(x.shot, best[x.kind] ?? played[x.kind]) ? x.shot : best[x.kind]; }
      }
      Object.assign(played, best);
    }
    const nfx = view.fxCount();
    if (nfx - fxSeen > L.FX_MAX) fxSeen = nfx - L.FX_MAX;
    for (; fxSeen < nfx; fxSeen++) {
      const x = view.fx(fxSeen);
      if (h.tick - x.tick > 60) continue;
      if (isMine(x)) { if (played[x.kind] !== undefined && !newer(x.shot, played[x.kind])) continue; played[x.kind] = x.shot; show(x, slot, cam, now, true, eyeOf); continue; }
      show(x, slot, cam, now, false, eyeOf);
    }
    kick *= Math.exp(-ms / 70);
    marker *= Math.exp(-ms / 120);
    hurt *= Math.exp(-ms / 400);

    // sprites: the pads' guns, then what glows
    const solid = [];
    for (const p of view.pads()) {
      if (p.wait) continue;
      const c = COLOR[p.weapon];
      solid.push({ pos: [p.pos[0], p.pos[1] + 0.7 + 0.15 * Math.sin(now / 400 + p.k), p.pos[2]], size: 0.55, aspect: 0.8, color: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1], kind: 4, minpx: 2 });
    }
    const glow = [];
    for (let k = glows.length - 1; k >= 0; k--) {
      const g = glows[k];
      const a = (now - g.born) / g.life;
      if (a >= 1) { glows.splice(k, 1); continue; }
      const grow = g.grow ? 0.35 + 0.65 * Math.min(1, a / 0.4) : 1;
      glow.push({ pos: g.pos, size: g.size * grow, color: [g.color[0], g.color[1], g.color[2], (g.color[3] ?? 1) * (1 - a)], kind: g.kind, minpx: 1 });
    }
    const beams = [];
    for (let k = tracers.length - 1; k >= 0; k--) {
      const t = tracers[k];
      const a = (now - t.born) / t.life;
      if (a >= 1) { tracers.splice(k, 1); continue; }
      beams.push({ a: t.a, b: t.b, width: t.width, color: [t.color[0], t.color[1], t.color[2], t.color[3] * (1 - a)] });
    }
    let rects = [], tracker = null;
    const playing = st === 2 && f?.live;
    if (playing) {
      if (!WATCH && !f.dead) rects = gunRects(f.weapon, now, Math.hypot(f.vel[0], f.vel[2]) > 1 && f.ground);
      if (!f.dead) { const hr = hudRects(f, now); rects.push(...hr.rects); tracker = hr.tracker; }
    }
    const zoom = zoomed && f && !f.dead ? zoomOf() : 1;
    hudText(text, { h, f, slot: tgt ? watched : slot, st, now, fps });
    netGraph.sample(now, hashes, keys);
    const graph = showGraph && st > 0 ? netGraph.build((x, y, s, c) => put(text, COLS, x, y, s, c), C) : null;
    const spread = ARMS[f?.weapon]?.spread || 0;
    last = {
      cam, yaw: camYaw, pitch: camPitch, zoom, time: now / 1000, dt, dtPred, proj: pme ? L.PROJ + L.PRED_D : L.PROJ, slot: tgt ? watched : slot < 0 ? 999 : slot,
      solid, glow, beams, rects, tracker, text, graph, marker, hurt, scope: zoom >= 4,
      crosshair: (CROSS[f?.weapon] ?? 0) + (playing && !f.dead && onTarget(f, cam) ? 8 : 0), gap: spread / 30 + kick * 3,
    };
    renderer.frame(u8, last);
  }

  window.__qa.capture = async (scale = 2) => {
    if (!last) return null;
    const { width, height, rgba } = await renderer.capture(u8, last);
    const small = new OffscreenCanvas(width, height);
    small.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    const big = new OffscreenCanvas(width * scale, height * scale);
    const g = big.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, width * scale, height * scale);
    const bytes = new Uint8Array(await (await big.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  function hudText(t, { h, f, slot, st, now, fps }) {
    t.fill(0);
    const rows = renderer.rows;
    const right = (y, s, c) => put(t, COLS, COLS - 1 - String(s).length, y, s, c);
    const centre = (y, s, c) => put(t, COLS, Math.floor((COLS - String(s).length) / 2), y, s, c);
    if (st !== 2 || (!f?.live && !WATCH)) centre(Math.floor(rows / 2) - 3, error ? 'ERROR: ' + error.slice(0, 64) : ['CONNECTING', 'CATCHING UP', '', 'DISCONNECTED'][st] || 'JOINING', error ? C.RED : C.YELLOW);
    const list = [];
    for (let p = 0; p < L.NPLAYER; p++) { const o = view.fighter(p); if (o.live) list.push(o); }
    list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.slot - b.slot);
    const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
    const left = Math.max(0, h.until - h.tick);
    if (h.state === L.H_COUNT) centre(4, `${L.FIESTA ? 'FIESTA  RANDOM GUNS  MOST KILLS IN 10 MIN' : `SLAYER  ${L.FRAG_LIMIT} KILLS`}  STARTS IN ${Math.ceil(left / 125)}`, C.YELLOW);
    if (h.state === L.H_PLAY) centre(0, clock(left), left < 30 * 125 ? C.RED : C.WHITE);
    if (f?.live) {
      const leader = list[0];
      put(t, COLS, 1, 0, `${WATCH ? 'P' + (slot + 1) : 'YOU'} ${f.kills}`, C.YELLOW);
      if (leader && leader.slot !== f.slot) put(t, COLS, 1, 1, `P${leader.slot + 1} ${leader.kills}`, C.GREY);
      else if (list[1]) put(t, COLS, 1, 1, `P${list[1].slot + 1} ${list[1].kills}`, C.GREY);
      if (f.dead) centre(Math.floor(rows / 2) + 2, `RESPAWN IN ${Math.ceil(f.respawn / 125)}`, C.YELLOW);
      else {
        const arm = ARMS[f.weapon];
        if (arm) {
          const ammo = arm.reload ? `${f.mag[f.hand]} / ${f.res[f.hand]}` : f.weapon === L.W_SWORD ? `${f.mag[f.hand] * 10}%` : `${f.mag[f.hand]}%`;
          right(rows - 3, arm.name, C.WHITE);
          right(rows - 2, f.reload ? 'RELOADING' : f.mag[f.hand] === 0 && f.res[f.hand] === 0 ? 'EMPTY' : ammo, f.mag[f.hand] === 0 ? C.RED : C.CYAN);
          const other = ARMS[f.gun[f.hand ^ 1]];
          right(rows - 4, other ? `${f.hand ? 1 : 2} ${other.name}` : '', C.GREY);
        }
        right(rows - 5, `FRAGS ${f.grens}`, C.ORANGE);
        // a gun on the pad underfoot
        const pad = view.pads().find((p) => !p.wait && Math.hypot(p.pos[0] - f.pos[0], p.pos[2] - f.pos[2]) < 1.5);
        if (pad && !WATCH && !f.gun.includes(pad.weapon)) centre(Math.floor(rows / 2) + 5, `E: PICK UP ${ARMS[pad.weapon].name}`, C.WHITE);
        if (f.mag[f.hand] === 0 && f.res[f.hand] > 0 && !f.reload) centre(Math.floor(rows / 2) + 3, 'R: RELOAD', C.RED);
      }
      // the feed, over the tracker
      feed.forEach((e, k) => { if (now - e.born < 6000) put(t, COLS, 1, rows - 12 - (feed.length - 1 - k), e.text, e.color); });
    }
    if (banner.until > now) centre(Math.floor(rows / 2) - 6, banner.text, banner.color);
    if (medal.until > now) centre(Math.floor(rows / 2) - 8, medal.text, C.ORANGE);
    if (st === 2 && !BOT && !WATCH && !locked) centre(Math.floor(rows / 2) + 7, 'CLICK TO PLAY', C.WHITE);
    if (WATCH && st === 2) put(t, COLS, 1, 3, f?.live ? `WATCHING P${slot + 1}  < >` : 'NOBODY TO WATCH', C.CYAN);
    if (showGraph) put(t, COLS, 1, rows - 1, `${fps} FPS  LEAD ${f32[L.CL_LEAD >> 2].toFixed(1)}  DELAY ${f32[L.CL_DELAY >> 2].toFixed(1)}  LAG ${f?.lag ?? 0}  REPAIRS ${get(L.CL_REPAIRS)}`, C.GREY);
    const board = h.state === L.H_OVER || (held.has('Tab') && h.live);
    if (board) {
      const y0 = 6;
      const top = list[0];
      centre(y0, h.state === L.H_OVER ? `GAME OVER  ${top ? (top.slot === slot ? 'YOU WIN' : `P${top.slot + 1} WINS`) : ''}` : `${MODE}  ${list.length} PLAYERS`, C.YELLOW);
      centre(y0 + 2, 'RANK  PLAYER    KILLS  DEATHS', C.GREY);
      const fit = rows - y0 - 6;
      const mine = list.findIndex((o) => o.slot === slot);
      const shown = mine >= fit ? [...list.slice(0, fit - 1), list[mine]] : list.slice(0, fit);
      shown.forEach((o, k) => {
        const rank = list.indexOf(o) + 1;
        const name = (o.slot === slot && !WATCH ? 'YOU ' : 'P') + String(o.slot + 1);
        centre(y0 + 3 + k, `${String(rank).padStart(4)}  ${name.padEnd(8)}  ${String(o.kills).padStart(5)}  ${String(o.deaths).padStart(6)}`, o.slot === slot ? C.YELLOW : C.WHITE);
      });
    }
  }

  note.remove();
  requestAnimationFrame(frame);
}

main().catch((e) => {
  note.textContent = String(e?.message || e);
  window.__qa = { error: String(e?.stack || e) };
});
