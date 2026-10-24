// Bumper balls' frontend: what the page draws and how it plays, mounted on a
// host (client/host.mjs) that owns the memory, the workers and the GPU. Raw
// mouse and keys into golf's input slots; a frame per display refresh drawn
// from shared memory by client/bumper-render.mjs, the camera behind and above
// your ball. bumper.html mounts it alone; Fireplace mounts it while the room
// plays bumper balls.
//   opts: { canvas, lockTarget (what the pointer locks to, the canvas by default), bot, skill, sens, hud, present, showGraph,
//           external (the slots are driven from outside, as Fireplace's guest does: the camera follows them) }
import * as L from '../src/layout.mjs';
import { bumperWord, PLAT_Y } from '../src/bumper-view.mjs';
import { createRenderer, COLS, SPRITE } from './bumper-render.mjs';
import { put, C } from './font.mjs';
import { readClock } from './clock.mjs';
import { NetGraph } from './netgraph.mjs';
import { Roller } from './bumper-bot.mjs';
import { epoch, predict, corrector, capturePng, listeners } from './host.mjs';

const TURN = 16384;
// the power-ups' colours, and what the HUD says about each
export const PU_COLOR = [[1, 1, 1], [1, 0.3, 0.25], [0.3, 0.8, 1], [1, 0.85, 0.2], [1, 0.55, 0.15], [0.5, 1, 0.45]];
const PU_HINT = ['', 'BIG AND HEAVY', 'A BURST OF SPEED', 'SHOVE EVERYONE NEAR', 'A ROCKET WHERE YOU FACE', 'A HIGH JUMP, A STOMP'];
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

export async function mount(h, { canvas, lockTarget = canvas, bot: BOT = false, skill = 0.8, sens: SENS = 3, hud, present = true, showGraph: graphOn = false, external = false } = {}) {
  const { u8, i32, f32, f64, view, pview, set, get, press, sound, memory, hashes, keys } = h;
  const WATCH = h.watch;
  const W = canvas.width, H = canvas.height;
  // the HUD's 3x5 font in pixels this many screen pixels a side
  const HS = hud || Math.max(1, Math.round(H / 240));
  const renderer = h.renderers.get('bumper') || await createRenderer(canvas, { present, hudScale: HS, device: h.device });
  h.renderers.set('bumper', renderer);
  const { on, off } = listeners();
  set(L.CL_PITCH, 512);
  set(L.CL_WEAPON, 0);

  // ---- input: the mouse turns you (and the camera with you), the keys push
  let yaw = get(L.CL_YAW), look = -0.42;
  const held = new Set();
  const MOVES = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8, Space: 16 };
  const writeKeys = () => { let m = 0; for (const k of held) m |= MOVES[k] || 0; set(L.CL_MOVE, m); };
  const aim = () => set(L.CL_YAW, Math.round(yaw) & (TURN - 1));
  let locked = document.pointerLockElement === lockTarget;
  let watched = -1;
  let showGraph = graphOn;
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
    if (BOT && !external) bot = new Roller(0, (Math.random() * 1e9) | 0, skill);
    on(canvas, 'click', () => { sound.wake(); watched = nextIn(watched, 1); });
    on(document, 'keydown', (e) => {
      if (e.code === 'ArrowRight') watched = nextIn(watched, 1);
      if (e.code === 'ArrowLeft') watched = nextIn(watched, -1);
      common(e);
    });
    on(document, 'keyup', (e) => held.delete(e.code));
  } else {
    on(canvas, 'click', () => {
      sound.wake();
      if (!locked) lockTarget.requestPointerLock({ unadjustedMovement: true }).catch(() => lockTarget.requestPointerLock());
    });
    on(document, 'pointerlockchange', () => {
      locked = document.pointerLockElement === lockTarget;
      if (!locked) { held.clear(); writeKeys(); }
    });
    const mouse = (e) => {
      if (!locked) return;
      yaw += e.movementX * SENS;
      look = Math.max(-1.2, Math.min(-0.08, look - e.movementY * SENS * 0.0004));
      aim();
    };
    on(document, 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', mouse);
    on(document, 'mousedown', (e) => { if (locked && (e.button === 0 || e.button === 2)) press(L.CL_PRESSES); });
    on(document, 'contextmenu', (e) => e.preventDefault());
    on(document, 'keydown', (e) => {
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
    on(document, 'keyup', (e) => { held.delete(e.code); writeKeys(); });
    on(window, 'blur', () => { held.clear(); writeKeys(); });
  }

  // ---- the prediction (as golf's): the sampled words, then the word in progress
  const live = () => {
    const sent = get(L.CL_SENT), mv = get(L.CL_MOVE);
    return bumperWord({ yaw: get(L.CL_YAW), move: mv & 15, hop: (mv >> 4) & 1, use: ((get(L.CL_PRESSES) - sent) > 0 ? sent + 1 : sent) & 3 });
  };
  const corr = corrector(h);

  // ---- what happened: FX into flashes, the feed and sounds
  const text = new Uint32Array(COLS * renderer.rows);
  const netGraph = new NetGraph(memory, { watch: WATCH });
  const glows = []; // { pos, size, color, kind, born, life, grow }
  const feed = []; // { text, color, born }
  let banner = { text: '', until: 0, color: C.YELLOW };
  let flash = 0;
  let fxSeen = 0, seenRound = -1, lastState = -1, lastSecs = -1, lastDrop = -1;
  const roll = new Map(); // slot -> the angle its stripes have turned through
  const crumbs = []; // { pos, vel, size, born }: cheese falling off the rim as it crumbles, for the look of it
  let frames = 0, fpsAt = performance.now(), fps = 0, lastFrame = performance.now();
  let me = null, pme = null;
  let last = null;

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

  function frame(now, target) {
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
    if (external) yaw = get(L.CL_YAW);
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
      const n = predict(h, slot, live);
      if (n >= 0) {
        pme = pview.bumper(slot);
        dtPred = Math.max(-2.5, Math.min(1, readClock(i32, f64, L.CL_PRED, nowE) - room - pview.tick)) * 0.008;
        corr.update(n, ms);
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
      tgtPos = [0, 1, 2].map((k) => mine.pos[k] + mine.vel[k] * dtPred + corr.off[k]);
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
      // the rider faces where the ball does (you: where you look), bobbing a little as it rolls
      const face = own ? yaw / TURN * 2 * Math.PI : src.yaw;
      const fv = [Math.cos(face), 0, Math.sin(face)];
      const bob = Math.abs(Math.sin(ang * 2)) * Math.min(1, speed / 6) * 0.06;
      solid.push({ pos: [pos[0], pos[1] + r, pos[2]], size: r, color: [...col, 1], kind: SPRITE.BALL, minpx: 1, vel: src.vel, roll: ang, seed: p });
      solid.push({ pos: [pos[0], pos[1] + 2 * r + 0.22 + bob, pos[2]], size: 0.34, color: [...col, 1], kind: SPRITE.BODY, minpx: 1 });
      solid.push({ pos: [pos[0], pos[1] + 2 * r + 0.78 + bob, pos[2]], size: 0.3, color: [...col, 1], kind: SPRITE.HEAD, minpx: 1, vel: fv });
      if (src.item) solid.push({ pos: [pos[0], pos[1] + 2 * r + 1.55, pos[2]], size: 0.26, color: [...PU_COLOR[src.item], 1], kind: SPRITE.ORB, minpx: 1 });
      if (own) solid.push({ pos: [pos[0], pos[1] + 2 * r + (src.item ? 2.15 : 1.65) + 0.1 * Math.sin(now / 200), pos[2]], size: 0.3, color: [1, 1, 0.4, 1], kind: SPRITE.ARROW, minpx: 2 });
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
    // crumbs off the rim while it crumbles, near enough to see
    if (w.state === L.H_PLAY && w.squeeze > 0 && w.squeeze < 1) {
      for (let k = 0; k < ms / 8 && crumbs.length < 300; k++) {
        const a = Math.random() * 2 * Math.PI;
        const x = L.B_CX + Math.cos(a) * w.rim, z = L.B_CX + Math.sin(a) * w.rim;
        if (Math.hypot(x - cam[0], z - cam[2]) > 120) continue;
        crumbs.push({ pos: [x, PLAT_Y - Math.random() * 5, z], vel: [Math.cos(a) * Math.random(), Math.random() * 1.5, Math.sin(a) * Math.random()], size: 0.08 + 0.25 * Math.random() ** 2, born: now });
      }
    }
    for (let k = crumbs.length - 1; k >= 0; k--) {
      const c = crumbs[k];
      c.vel[1] -= 20 * ms / 1000;
      for (let i = 0; i < 3; i++) c.pos[i] += c.vel[i] * ms / 1000;
      if (now - c.born > 2500) { crumbs.splice(k, 1); continue; }
      solid.push({ pos: c.pos, size: c.size, color: [1, 0.8, 0.3, 1], kind: SPRITE.CRUMB, minpx: 1 });
    }
    for (let k = glows.length - 1; k >= 0; k--) {
      const g = glows[k];
      const a = (now - g.born) / g.life;
      if (a >= 1) { glows.splice(k, 1); continue; }
      const grow = g.grow ? 0.25 + 0.75 * Math.min(1, a / 0.5) : 1;
      glow.push({ pos: g.pos, size: g.size * grow, color: [g.color[0], g.color[1], g.color[2], (g.color[3] ?? 1) * (1 - a)], kind: g.kind, minpx: 1 });
    }

    // the HUD: the power-up you hold, in a box at the bottom
    // (in HUD pixels, the text block's: x from its left, y from the top, 4 x 6 a character)
    const rects = [];
    const hx = (x) => renderer.hudX + x * HS, hy = (y) => y * HS;
    const playing = st === 2 && me?.live;
    const item = (mine || me)?.item || 0;
    if (playing && !me.out && item) {
      const c = PU_COLOR[item];
      const y = (renderer.rows - 3) * 6;
      rects.push([hx(47 * 4 - 14), hy(y - 4), hx(47 * 4 + 13 * 4), hy(y + 9), 0.05, 0.06, 0.1, 0.7]);
      rects.push([hx(47 * 4 - 11), hy(y - 1), hx(47 * 4 - 4), hy(y + 6), c[0], c[1], c[2], 1]);
    }
    hudText(text, { w, slot, st, now, fps, f: tgt, item });
    netGraph.sample(now, hashes, keys);
    const graph = showGraph && st > 0 ? netGraph.build((x, y, s2, c) => put(text, COLS, x, y, s2, c), C) : null;
    last = {
      cam, yaw: camYaw, pitch: camPitch, time: now / 1000, slot: slot >= 0 ? slot : -1, wheel: w,
      casters, solid, glow, beams, rects, text, graph, flash,
      mini: st === 2 ? [36 * HS, H - 36 * HS, 30 * HS, Math.max(12, w.rim * 1.06)] : null,
    };
    renderer.frame(u8, last, target);
  }

  function hudText(t, { w, slot, st, now, fps, f, item }) {
    t.fill(0);
    const rows = renderer.rows;
    const right = (y, str, c) => put(t, COLS, COLS - 1 - String(str).length, y, str, c);
    const centre = (y, str, c) => put(t, COLS, Math.floor((COLS - String(str).length) / 2), y, str, c);
    if (st !== 2 || (!me?.live && !WATCH)) centre(Math.floor(rows / 2) - 3, h.error ? 'ERROR: ' + h.error.slice(0, 64) : ['CONNECTING', 'CATCHING UP', '', 'DISCONNECTED'][st] || 'JOINING', h.error ? C.RED : C.YELLOW);
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


  return {
    frame,
    unmount() { off(); held.clear(); set(L.CL_MOVE, 0); sound.music(null, false); if (document.pointerLockElement === lockTarget && lockTarget === canvas) document.exitPointerLock(); },
    capture: (scale = W > 640 ? 1 : 2) => (last ? capturePng(renderer, u8, last, scale) : null),
    state: () => ({ slot: get(L.CL_SLOT), clState: get(L.CL_STATE), me, error: h.error, welcome: h.welcome, round: view.wheel(), feed: feed.map((f) => f.text), fps }),
    get locked() { return locked; },
  };
}
