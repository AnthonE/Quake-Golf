// Bumper balls' main thread: golf's client (client/main.mjs) with a ball to
// roll. The same net and sim workers and the same prediction layer, on the
// bumper build of the sim; raw mouse and keys into golf's input slots; a
// frame per display refresh drawn from shared memory by
// client/bumper-render.mjs, the camera behind and above your ball.
//   ?bot=1 hands the controls to an AI ball (client/bumper-bot.mjs)
//   ?watch=1 spectates; ?url=, ?hash=, ?impair=, ?sens=, ?res=, ?music=0 as golf's
import * as L from '../src/layout.mjs';
import { View, bumperWord, PLAT_Y } from '../src/bumper-view.mjs';
import { wasmPrefix } from '../net/wire.mjs';
import { createRenderer, COLS, SPRITE } from './bumper-render.mjs';
import { put, C } from './font.mjs';
import { createSound } from './sound.mjs';
import { parseImpair } from '../net/impair.js';
import { readClock } from './clock.mjs';
import { NetGraph } from './netgraph.mjs';
import { Roller } from './bumper-bot.mjs';

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
// the power-ups' colours, and what the HUD says about each
const PU_COLOR = [[1, 1, 1], [1, 0.3, 0.25], [0.3, 0.8, 1], [1, 0.85, 0.2], [1, 0.55, 0.15], [0.5, 1, 0.45]];
const PU_HINT = ['', 'BIG AND HEAVY', 'A BURST OF SPEED', 'SHOVE EVERYONE NEAR', 'A ROCKET WHERE YOU FACE', 'A HIGH JUMP, A STOMP'];
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

async function main() {
  if (!crossOriginIsolated) throw new Error('the page must be served cross-origin isolated (node tools/serve.mjs)');
  const bytes = await (await fetch('../build/bumper/game.wasm')).arrayBuffer();
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
  set(L.CL_WEAPON, 0);
  const { exports: px } = await WebAssembly.instantiate(module, { env: { mem: memory } });

  const renderer = await createRenderer(canvas, { present: q.get('present') !== '0' });
  const sound = createSound({ music: q.get('music') !== '0' });
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
  net.postMessage({ url, certHash, memory, prefix, simPort: ch.port1, impair: parseImpair(q.get('impair')), watch: WATCH }, [ch.port1]);
  sim.postMessage({ module, memory, netPort: ch.port2, threads: THREADS }, [ch.port2]);
  addEventListener('pagehide', () => net.postMessage({ leave: true }));

  // ---- input: the mouse turns you (and the camera with you), the keys push
  let yaw = 0, look = -0.42;
  const held = new Set();
  const MOVES = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8, Space: 16 };
  const writeKeys = () => { let m = 0; for (const k of held) m |= MOVES[k] || 0; set(L.CL_MOVE, m); };
  const aim = () => set(L.CL_YAW, Math.round(yaw) & (TURN - 1));
  let locked = false;
  let watched = -1;
  let showGraph = q.get('net') === '1';
  let bot = null;
  const inBall = (p) => { const b = view.bumper(p); return b.live && !b.out; };
  const nextIn = (from, step) => {
    for (let k = 1; k <= L.NPLAYER; k++) {
      const p = (((from + step * k) % L.NPLAYER) + L.NPLAYER) % L.NPLAYER;
      if (inBall(p)) return p;
    }
    return -1;
  };
  const common = (e) => {
    if (e.code === 'Tab') { e.preventDefault(); held.add('Tab'); }
    if (e.code === 'KeyN' && !e.repeat) showGraph = !showGraph;
    if (e.code === 'KeyM' && !e.repeat) banner = { text: sound.toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', until: performance.now() + 1500, color: C.GREY };
  };
  if (WATCH || BOT) {
    if (BOT) bot = new Roller(0, (Math.random() * 1e9) | 0, Number(q.get('skill') || 0.8));
    canvas.addEventListener('click', () => { sound.wake(); watched = nextIn(watched, 1); });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowRight') watched = nextIn(watched, 1);
      if (e.code === 'ArrowLeft') watched = nextIn(watched, -1);
      common(e);
    });
    document.addEventListener('keyup', (e) => held.delete(e.code));
  } else {
    canvas.addEventListener('click', () => {
      sound.wake();
      if (!locked) canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => canvas.requestPointerLock());
    });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvas;
      if (!locked) { held.clear(); writeKeys(); }
    });
    const mouse = (e) => {
      if (!locked) return;
      yaw += e.movementX * SENS;
      look = Math.max(-1.2, Math.min(-0.08, look - e.movementY * SENS * 0.0004));
      aim();
    };
    document.addEventListener('onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', mouse);
    document.addEventListener('mousedown', (e) => { if (locked && (e.button === 0 || e.button === 2)) press(L.CL_PRESSES); });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if ((e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'KeyQ') && !e.repeat) press(L.CL_PRESSES);
      else if (e.code === 'KeyF' && !e.repeat) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().then(() => navigator.keyboard?.lock?.()).catch(() => {});
      }
      common(e);
      if (MOVES[e.code]) e.preventDefault();
      held.add(e.code);
      writeKeys();
    });
    document.addEventListener('keyup', (e) => { held.delete(e.code); writeKeys(); });
    addEventListener('blur', () => { held.clear(); writeKeys(); });
  }

  // ---- the prediction (as golf's): the sampled words, then the word in progress
  const live = () => {
    const sent = get(L.CL_SENT), mv = get(L.CL_MOVE);
    return bumperWord({ yaw: get(L.CL_YAW), move: mv & 15, hop: (mv >> 4) & 1, use: ((get(L.CL_PRESSES) - sent) > 0 ? sent + 1 : sent) & 3 });
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

  // ---- what happened: FX into flashes, the feed and sounds
  const text = new Uint32Array(COLS * renderer.rows);
  const netGraph = new NetGraph(memory, { watch: WATCH });
  const glows = []; // { pos, size, color, kind, born, life, grow }
  const feed = []; // { text, color, born }
  let banner = { text: '', until: 0, color: C.YELLOW };
  let flash = 0;
  let fxSeen = 0, seenRound = -1, lastState = -1, lastSecs = -1, lastDrop = -1;
  const roll = new Map(); // slot -> the angle its stripes have turned through
  let frames = 0, fpsAt = performance.now(), fps = 0, lastFrame = performance.now();
  let me = null, pme = null;
  let last = null;
  window.__qa = { hashes, keys, desyncs, state: () => ({ slot: get(L.CL_SLOT), clState: get(L.CL_STATE), me, error, welcome, round: view.wheel(), feed: feed.map((f) => f.text), fps }) };

  const name = (p, slot) => (p === slot ? 'YOU' : `P${p + 1}`);
  function show(f, slot, cam) {
    const now = performance.now();
    const d = Math.hypot(f.pos[0] - cam[0], f.pos[1] - cam[1], f.pos[2] - cam[2]);
    switch (f.kind) {
      case L.FX_BUMP: {
        const mine = f.owner === slot || f.shot === slot;
        glows.push({ pos: f.pos, size: 0.5 + f.size * 0.08, color: [1, 1, 0.8, 1], kind: SPRITE.SPARK, born: now, life: 220 });
        sound.boing(f.size, mine ? 0 : d);
        if (mine) flash = Math.min(1, flash + f.size / 25);
        break;
      }
      case L.FX_SINK: {
        const by = f.shot === 255 ? '' : ` BY ${name(f.shot, slot)}`;
        feed.push({ text: f.shot === 255 ? `${name(f.owner, slot)} FELL IN` : `${name(f.owner, slot)} KNOCKED OUT${by}`, color: f.owner === slot ? C.RED : f.shot === slot ? C.GREEN : C.WHITE, born: now });
        if (feed.length > 5) feed.shift();
        glows.push({ pos: [f.pos[0], f.pos[1] + 0.5, f.pos[2]], size: 3, color: [0.6, 0.85, 1, 0.9], kind: SPRITE.RING, born: now, life: 600, grow: true });
        sound.sink(f.owner === slot ? 0 : d);
        if (f.owner === slot) { banner = { text: `OUT  ${ordinal(f.size)} OF ${view.wheel().n0}`, until: now + 4000, color: C.RED }; watched = -1; }
        if (f.shot === slot) { banner = { text: `YOU KNOCKED OUT P${f.owner + 1}`, until: now + 2000, color: C.GREEN }; sound.kill(); }
        break;
      }
      case L.FX_PICKUP:
        glows.push({ pos: f.pos, size: 1.4, color: [...PU_COLOR[f.size], 1], kind: SPRITE.FLASH, born: now, life: 300 });
        if (f.owner === slot) { sound.pickup(); banner = { text: `${L.PU_NAMES[f.size]}: ${PU_HINT[f.size]}`, until: now + 2500, color: C.CYAN }; }
        break;
      case L.FX_USE: {
        const k = f.size;
        glows.push({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: k === L.PU_MEGA ? 3 : 1.6, color: [...PU_COLOR[k], 1], kind: SPRITE.FLASH, born: now, life: 350 });
        if (k === L.PU_ROCKET) sound.gun(L.W_ROCKET, f.owner === slot ? 0 : d);
        else if (k === L.PU_SPRING || k === L.PU_MEGA) sound.jump();
        else if (k === L.PU_DASH) sound.land(20);
        break;
      }
      case L.FX_BLAST:
        glows.push({ pos: f.pos, size: f.size, color: [1, 0.85, 0.4, 1], kind: SPRITE.RING, born: now, life: 450, grow: true });
        glows.push({ pos: f.pos, size: f.size * 0.4, color: [1, 0.6, 0.2, 1], kind: SPRITE.FLASH, born: now, life: 300, grow: true });
        sound.blast(d, f.size);
        break;
      case L.FX_DROP:
        if (now - lastDrop > 500) { sound.tick(); lastDrop = now; }
        break;
      default:
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    frames++;
    if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; }
    const ms = Math.min(100, now - lastFrame);
    lastFrame = now;
    const nowE = epoch();
    const st = get(L.CL_STATE);
    const slot = get(L.CL_SLOT);
    const w = view.wheel();
    const room = get(L.CL_ROOM);
    const dt = Math.max(0, Math.min(3, readClock(i32, f64, L.CL_PLAY, nowE) - room - w.tick)) * 0.008;
    me = slot >= 0 ? view.bumper(slot) : null;
    pme = null;
    // the bot drives the slots as the keys and mouse would
    if (bot && me?.live && st === 2) {
      const word = bot.think(view, w.tick, Math.round(readClock(i32, f64, L.CL_PRED, nowE) - readClock(i32, f64, L.CL_PLAY, nowE)));
      yaw = word & (TURN - 1);
      aim();
      set(L.CL_MOVE, ((word >>> 24) & 15) | (((word >>> 28) & 1) << 4));
      const use = (word >>> 29) & 3;
      if (use !== (bot.lastUse ?? use)) press(L.CL_PRESSES);
      bot.lastUse = use;
    }
    let dtPred = dt;
    if (me?.live && !me.out && st === 2) {
      const n = predict(slot);
      if (n >= 0) {
        pme = pview.bumper(slot);
        dtPred = Math.max(-2.5, Math.min(1, readClock(i32, f64, L.CL_PRED, nowE) - room - pview.tick)) * 0.008;
        correct(n, ms);
      }
    }
    // a new round: face the middle
    if (me?.live && w.hole !== seenRound && w.state === L.H_COUNT) {
      seenRound = w.hole;
      if (!BOT && !me.out) { yaw = Math.round(Math.atan2(L.B_CX - me.pos[2], L.B_CX - me.pos[0]) / (2 * Math.PI) * TURN) & (TURN - 1); aim(); }
      feed.length = 0;
    }
    // the countdown's beeps, the result
    const secs = Math.ceil((w.until - w.tick) / 125);
    if (w.state === L.H_COUNT && secs !== lastSecs && secs <= 3 && secs > 0) sound.count(secs);
    if (w.state === L.H_PLAY && lastState === L.H_COUNT) { sound.count(0); banner = { text: 'GO!', until: now + 1000, color: C.GREEN }; }
    if (w.state === L.H_OVER && lastState === L.H_PLAY) {
      if (w.winner === slot && slot >= 0) { banner = { text: 'YOU WIN!', until: now + 5000, color: C.YELLOW }; sound.holed(); }
      else banner = { text: w.winner === 255 ? (me && !me.out && me.place === 1 ? 'A SHARED WIN' : 'NO WINNER') : `P${w.winner + 1} WINS`, until: now + 5000, color: C.YELLOW };
    }
    lastSecs = secs;
    lastState = w.state;
    sound.music(w.state === L.H_PLAY ? (view.dv.getUint32(L.HDR_SEED, true) ^ Math.imul(w.hole + 7, 0x9e3779b9)) >>> 0 : null, w.state === L.H_PLAY);

    // who the camera follows: you, or (out, watching) a ball still in, the winner when it's over
    const mine = pme && !pme.out ? pme : null;
    let tgt = null, tgtPos = null;
    if (mine) {
      tgt = mine;
      tgtPos = [0, 1, 2].map((k) => mine.pos[k] + mine.vel[k] * dtPred + corr[k]);
    } else if (st >= 1) {
      if (w.state === L.H_OVER && w.winner !== 255) watched = w.winner;
      if (me && !me.out && w.state !== L.H_PLAY) watched = slot;
      if (watched < 0 || !inBall(watched)) watched = nextIn(watched, 1);
      if (watched >= 0) {
        tgt = view.bumper(watched);
        tgtPos = [0, 1, 2].map((k) => tgt.pos[k] + tgt.vel[k] * dt);
      }
    }
    let cam, camYaw, camPitch = look;
    if (tgt) {
      const r = tgt.radius;
      camYaw = tgt === mine || (me && tgt.slot === slot) ? yaw / TURN * 2 * Math.PI : tgt.yaw;
      const back = 6 + r * 3.2;
      const focus = [tgtPos[0], Math.max(tgtPos[1], PLAT_Y - 3) + r + 0.6, tgtPos[2]];
      cam = [focus[0] - Math.cos(camYaw) * Math.cos(camPitch) * back, focus[1] - Math.sin(camPitch) * back, focus[2] - Math.sin(camYaw) * Math.cos(camPitch) * back];
    } else {
      // nobody to follow: the wheel from high over its edge
      const t = now / 20000;
      camYaw = t + Math.PI;
      camPitch = -0.6;
      const R = w.r0 * 1.6 + 10;
      cam = [L.B_CX + Math.cos(t) * R, PLAT_Y + R * 0.75, L.B_CX + Math.sin(t) * R];
    }

    // FX from the confirmed ring
    const nfx = view.fxCount();
    if (nfx - fxSeen > L.FX_MAX) fxSeen = nfx - L.FX_MAX;
    for (; fxSeen < nfx; fxSeen++) {
      const x = view.fx(fxSeen);
      if (w.tick - x.tick > 60) continue;
      show(x, slot, cam);
    }
    flash *= Math.exp(-ms / 250);

    // sprites: the balls, their riders and what they hold, the orbs, rockets, then what glows
    const solid = [], glow = [], beams = [], casters = [];
    for (let p = 0; p < L.NPLAYER; p++) {
      const b = view.bumper(p);
      if (!b.live || b.out) { casters.push([0, -1000, 0, 0]); continue; }
      const own = mine && p === slot;
      const src = own ? mine : b;
      const pos = own ? tgtPos : [0, 1, 2].map((k) => b.pos[k] + b.vel[k] * dt);
      const r = src.radius;
      casters.push([pos[0], pos[1], pos[2], r]);
      // a ball right at the lens would fill the screen: leave it out of the picture (its shadow stays)
      if (!own && Math.hypot(pos[0] - cam[0], pos[1] + r - cam[1], pos[2] - cam[2]) < r + 2.5) continue;
      const speed = Math.hypot(src.vel[0], src.vel[2]);
      const ang = (roll.get(p) || 0) + speed * ms / 1000 / r;
      roll.set(p, ang % (2 * Math.PI * 64));
      const col = slotColor(p);
      solid.push({ pos: [pos[0], pos[1] + r, pos[2]], size: r, color: [...col, 1], kind: SPRITE.BALL, minpx: 1, vel: src.vel, roll: ang, seed: p });
      solid.push({ pos: [pos[0], pos[1] + 2 * r + 0.4, pos[2]], size: 0.42, aspect: 1.25, color: [...col, 1], kind: SPRITE.RIDER, minpx: 1 });
      if (src.item) solid.push({ pos: [pos[0], pos[1] + 2 * r + 1.3, pos[2]], size: 0.28, color: [...PU_COLOR[src.item], 1], kind: SPRITE.ORB, minpx: 1 });
      if (own) solid.push({ pos: [pos[0], pos[1] + 2 * r + (src.item ? 1.9 : 1.4) + 0.1 * Math.sin(now / 200), pos[2]], size: 0.3, color: [1, 1, 0.4, 1], kind: SPRITE.ARROW, minpx: 2 });
      if (src.dash) glow.push({ pos: [pos[0] - src.vel[0] * 0.05, pos[1] + r, pos[2] - src.vel[2] * 0.05], size: r * 1.3, color: [0.4, 0.85, 1, 0.5], kind: SPRITE.FLASH, minpx: 1 });
      if (src.mega) glow.push({ pos: [pos[0], pos[1] + r, pos[2]], size: r * 1.25, color: [1, 0.35, 0.3, 0.35 + 0.15 * Math.sin(now / 120)], kind: SPRITE.RING, minpx: 1 });
    }
    for (const o of view.orbs()) {
      const y = o.falling ? o.pos[1] : o.pos[1] + 0.15 * Math.sin(now / 300 + o.k);
      casters.push([o.pos[0], y, o.pos[2], -0.6]);
      const fade = !o.falling && o.life < 250 && Math.floor(now / 100) % 2;
      if (!fade) solid.push({ pos: [o.pos[0], y, o.pos[2]], size: 0.6, color: [...PU_COLOR[o.kind], 1], kind: SPRITE.ORB, minpx: 2 });
      glow.push({ pos: [o.pos[0], y, o.pos[2]], size: 1.3, color: [...PU_COLOR[o.kind], 0.5], kind: SPRITE.FLASH, minpx: 2 });
      if (o.falling) beams.push({ a: [o.pos[0], y, o.pos[2]], b: [o.pos[0], PLAT_Y, o.pos[2]], width: 0.08, color: [...PU_COLOR[o.kind], 0.25] });
    }
    for (const j of view.projectiles()) {
      const pos = [0, 1, 2].map((k) => j.pos[k] + j.vel[k] * dt);
      solid.push({ pos, size: 0.3, color: [1, 0.7, 0.3, 1], kind: SPRITE.ROCKET, minpx: 1.5 });
      glow.push({ pos: [pos[0] - j.vel[0] * 0.03, pos[1], pos[2] - j.vel[2] * 0.03], size: 0.7, color: [1, 0.6, 0.2, 0.8], kind: SPRITE.FLASH, minpx: 1 });
    }
    for (let k = glows.length - 1; k >= 0; k--) {
      const g = glows[k];
      const a = (now - g.born) / g.life;
      if (a >= 1) { glows.splice(k, 1); continue; }
      const grow = g.grow ? 0.25 + 0.75 * Math.min(1, a / 0.5) : 1;
      glow.push({ pos: g.pos, size: g.size * grow, color: [g.color[0], g.color[1], g.color[2], (g.color[3] ?? 1) * (1 - a)], kind: g.kind, minpx: 1 });
    }

    // the HUD: the power-up you hold, in a box at the bottom
    const rects = [];
    const s = W / 320;
    const playing = st === 2 && me?.live;
    const item = (mine || me)?.item || 0;
    if (playing && !me.out && item) {
      const c = PU_COLOR[item];
      rects.push([132 * s, (H / s - 22) * s, 188 * s, (H / s - 6) * s, 0.05, 0.06, 0.1, 0.75]);
      rects.push([134 * s, (H / s - 20) * s, 138 * s, (H / s - 8) * s, c[0], c[1], c[2], 1]);
    }
    hudText(text, { w, slot, st, now, fps, f: tgt, item });
    netGraph.sample(now, hashes, keys);
    const graph = showGraph && st > 0 ? netGraph.build((x, y, s2, c) => put(text, COLS, x, y, s2, c), C) : null;
    last = {
      cam, yaw: camYaw, pitch: camPitch, time: now / 1000, slot: slot >= 0 ? slot : -1, wheel: w,
      casters, solid, glow, beams, rects, text, graph, flash,
      mini: st === 2 ? [34 * s, H - 34 * s, 28 * s, w.r0 * 1.04] : null,
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
    const bytes2 = new Uint8Array(await (await big.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes2.length; i += 0x8000) bin += String.fromCharCode(...bytes2.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  function hudText(t, { w, slot, st, now, fps, f, item }) {
    t.fill(0);
    const rows = renderer.rows;
    const right = (y, str, c) => put(t, COLS, COLS - 1 - String(str).length, y, str, c);
    const centre = (y, str, c) => put(t, COLS, Math.floor((COLS - String(str).length) / 2), y, str, c);
    if (st !== 2 || (!me?.live && !WATCH)) centre(Math.floor(rows / 2) - 3, error ? 'ERROR: ' + error.slice(0, 64) : ['CONNECTING', 'CATCHING UP', '', 'DISCONNECTED'][st] || 'JOINING', error ? C.RED : C.YELLOW);
    const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
    const left = Math.max(0, w.until - w.tick);
    if (w.state === L.H_COUNT) {
      centre(4, `BUMPER BALLS  ${w.n0} BALLS  LAST ONE ROLLING WINS`, C.YELLOW);
      const n = Math.ceil(left / 125);
      centre(Math.floor(rows / 2) - 6, n <= 3 ? String(n) : `STARTS IN ${n}`, n <= 3 ? C.WHITE : C.YELLOW);
      centre(6, 'KEEP OUT OF THE HOLES  BUMP THE OTHERS IN  GRAB WHAT FALLS', C.GREY);
    }
    if (w.state === L.H_PLAY) {
      centre(0, clock(left), left < 20 * 125 ? C.RED : C.WHITE);
      if (w.squeeze > 0 && w.squeeze < 1 && Math.floor(now / 600) % 4 === 0) centre(1, 'THE CHEESE IS CRUMBLING', C.ORANGE);
    }
    put(t, COLS, 1, 0, `${w.left} OF ${w.n0} LEFT`, C.YELLOW);
    if (me?.live) {
      right(0, `WINS ${me.wins}  KOS ${me.kos}`, C.YELLOW);
      if (me.out && w.state === L.H_PLAY) centre(rows - 4, f ? `OUT  WATCHING P${f.slot + 1}  CLICK FOR ANOTHER` : 'OUT', C.GREY);
      if (me.out && me.place === 0 && w.state === L.H_PLAY) centre(rows - 5, 'YOU PLAY THE NEXT ROUND', C.CYAN);
      if (item && !me.out) put(t, COLS, 47, rows - 3, `${L.PU_NAMES[item]}  CLICK`, C.WHITE);
    } else if (WATCH && f) put(t, COLS, 1, 1, `WATCHING P${f.slot + 1}  < >`, C.CYAN);
    const board = w.state === L.H_OVER || (held.has('Tab') && w.live);
    if (!board) feed.forEach((e, k) => { if (now - e.born < 6000) put(t, COLS, 18, rows - 9 - (feed.length - 1 - k), e.text, e.color); });
    if (banner.until > now) centre(Math.floor(rows / 2) - 8, banner.text, banner.color);
    if (st === 2 && !BOT && !WATCH && !locked) centre(Math.floor(rows / 2) + 7, 'CLICK TO PLAY  WASD ROLL  SPACE HOP  CLICK USES WHAT YOU HOLD', C.WHITE);
    if (showGraph) put(t, COLS, 1, rows - 1, `${fps} FPS  LEAD ${f32[L.CL_LEAD >> 2].toFixed(1)}  DELAY ${f32[L.CL_DELAY >> 2].toFixed(1)}  REPAIRS ${get(L.CL_REPAIRS)}`, C.GREY);
    if (board) {
      const list = [];
      for (let p = 0; p < L.NPLAYER; p++) { const b = view.bumper(p); if (b.live) list.push(b); }
      list.sort((a, b) => b.wins - a.wins || b.kos - a.kos || b.bumps - a.bumps || a.slot - b.slot);
      const y0 = 6;
      centre(y0, `ROUND ${w.hole + 1}  ${list.length} PLAYERS`, C.YELLOW);
      centre(y0 + 2, 'RANK  PLAYER    WINS  KOS  BUMPS  LAST', C.GREY);
      const fit = rows - y0 - 8;
      const mineAt = list.findIndex((o) => o.slot === slot);
      const shown = mineAt >= fit ? [...list.slice(0, fit - 1), list[mineAt]] : list.slice(0, fit);
      shown.forEach((o, k) => {
        const rank = list.indexOf(o) + 1;
        const nm = (o.slot === slot && !WATCH ? 'YOU ' : 'P') + String(o.slot + 1);
        const lastPlace = !o.out && w.state === L.H_PLAY ? 'IN' : o.place ? ordinal(o.place) : '-';
        centre(y0 + 3 + k, `${String(rank).padStart(4)}  ${nm.padEnd(8)}  ${String(o.wins).padStart(4)}  ${String(o.kos).padStart(3)}  ${String(o.bumps).padStart(5)}  ${lastPlace.padStart(4)}`, o.slot === slot ? C.YELLOW : C.WHITE);
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
