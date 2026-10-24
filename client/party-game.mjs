// Party's frontend: what the page draws and how it plays, mounted on a host
// (client/host.mjs) that owns the memory, the workers and the GPU. Bumper
// balls' controls and prediction (the same word, the same ball), drawn by
// client/party-render.mjs; the stage is the minigame's (client/mg/<key>.mjs,
// MG[view.party().game]): each frame its draw() fills the Scene, its frame()
// says where the action is (the shadow map's square, the minimap, the
// overview), its fx() turns its own FX into flashes and sounds and its hud()
// adds its lines. The countdown is a title card over a fly-round of the
// stage; then the camera is behind your ball. The board (Tab, and through
// the result) ranks the room by party points. party.html mounts it alone;
// Fireplace will mount it while the room plays party.
//   opts: { canvas, lockTarget (what the pointer locks to, the canvas by default), bot, skill, sens, hud, present, showGraph,
//           external (the slots are driven from outside, as Fireplace's guest does: the camera follows them) }
//
// What a minigame's module gets (the contract its draw, fx and hud build on):
//   draw(view, ctx, out): ctx { tick (the confirmed tick), dt (s past it, to now), t (s into play at tick + dt),
//       ptick, pt (the same on the prediction's clock: the tick your own ball is drawn at, fractional; tick + dt
//       when nothing is predicted), now (ms), ms (since the last frame), cam [x, y, z], slot, me (your partier()
//       record, confirmed, or null), pme (the prediction's, or null), view, pview (the prediction's View) };
//     out { scene, solid [], glow [], beams [], decals [], casters [] (round things for the shadow map: [x, y, z, -r]),
//       paint (null, or set it to a paint layer) }: the balls go in after it, into the same arrays.
//   frame(view) -> { centre: [x, y, z], radius, shape: 'disc' | 'square' }
//   fx(f, ctx): f a confirmed FX record ({ tick, kind, owner, shot, pos, size }) whose kind is FX_MG + 4 * id + k;
//     ctx { slot, glow({ pos, size, color, kind, life (ms), grow }), sound, banner(text, color, ms), feed(text, color),
//       name(p) ('YOU' or 'P12'), dist (m from the camera), C, now, view }
//   facing(view, slot) -> radians, optional: which way a new round's countdown turns you (default: frame()'s centre)
//   hud(view, ctx): ctx { put(x, y, str, c), centre(y, str, c), right(y, str, c), rect(x0, y0, x1, y1, r, g, b, a)
//     (HUD pixels: a cell is 4 x 6), rows, C, slot, me (partier() or null), now, t (s into play) }.
//     The frontend keeps rows 0 and 1 (the clock, who's left or the scores, the round's name), the middle band
//     (banners), the feed and the bottom rows; a minigame's lines go on rows 2 to 6, right-aligned by custom.
import * as L from '../src/layout.mjs';
import { partyWord } from '../src/party-view.mjs';
import { createRenderer, Scene, COLS, SPRITE } from './party-render.mjs';
import { MG } from './mg/index.mjs';
import { put, C } from './font.mjs';
import { readClock } from './clock.mjs';
import { NetGraph } from './netgraph.mjs';
import { Partier } from './party-bot.mjs';
import { epoch, predict, corrector, capturePng, listeners } from './host.mjs';

const TURN = 16384;
const TICK = 0.008;
// the power-ups' colours, and what the HUD says about each (bumper's)
const PU_COLOR = [[1, 1, 1], [1, 0.3, 0.25], [0.3, 0.8, 1], [1, 0.85, 0.2], [1, 0.55, 0.15], [0.5, 1, 0.45]];
const PU_HINT = ['', 'BIG AND HEAVY', 'A BURST OF SPEED', 'SHOVE EVERYONE NEAR', 'A ROCKET WHERE YOU FACE', 'A HIGH JUMP, A STOMP'];
export const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
export const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;
// the points a place earns, as $p_end gives them: 10 for 1st down to 1 for last of m placed
export const gain = (place, m) => 1 + Math.floor((9 * (m - Math.min(place, m))) / Math.max(1, m - 1));
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export async function mount(h, { canvas, lockTarget = canvas, bot: BOT = false, skill = 0.8, sens: SENS = 3, hud, present = true, showGraph: graphOn = false, external = false } = {}) {
  const { u8, i32, f32, f64, view, pview, set, get, press, sound, memory, hashes, keys } = h;
  const WATCH = h.watch;
  const W = canvas.width, H = canvas.height;
  // the HUD's 3x5 font in pixels this many screen pixels a side
  const HS = hud || Math.max(1, Math.round(H / 240));
  const renderer = h.renderers.get('party') || await createRenderer(canvas, { present, hudScale: HS, device: h.device });
  h.renderers.set('party', renderer);
  const { on, off } = listeners();
  set(L.CL_PITCH, 512);
  set(L.CL_WEAPON, 0);
  const scene = new Scene(24000);

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
  // a ball worth watching: in, and not already falling out of the world
  const inBall = (p) => { const b = view.bumper(p); return b.live && !b.out && !b.falling; };
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
    if (BOT && !external) bot = new Partier(0, (Math.random() * 1e9) | 0, skill);
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

  // ---- the prediction (as bumper's): the sampled words, then the word in progress
  const live = () => {
    const sent = get(L.CL_SENT), mv = get(L.CL_MOVE);
    return partyWord({ yaw: get(L.CL_YAW), move: mv & 15, hop: (mv >> 4) & 1, use: ((get(L.CL_PRESSES) - sent) > 0 ? sent + 1 : sent) & 3 });
  };
  const corr = corrector(h);

  // ---- what happened: FX into flashes, the feed and sounds
  const text = new Uint32Array(COLS * renderer.rows);
  const netGraph = new NetGraph(memory, { watch: WATCH });
  const glows = []; // { pos, size, color, kind, born, life, grow }
  const feed = []; // { text, color, born }
  let banner = { text: '', until: 0, color: C.YELLOW, big: 0 };
  let flash = 0;
  let fxSeen = 0, seenRound = -1, lastState = -1, lastSecs = -1, lastDrop = -1;
  const roll = new Map(); // slot -> the angle its stripes have turned through
  let frames = 0, fpsAt = performance.now(), fps = 0, lastFrame = performance.now();
  let me = null, pme = null;
  let last = null;
  let held0 = null; // PK_SCORE: where the camera waits while your ball is down
  let cut = 0; // the title card's camera: 1 the fly-round, 0 behind your ball

  const name = (p, slot) => (p === slot ? 'YOU' : `P${p + 1}`);
  const pushFeed = (t, color) => { feed.push({ text: t, color, born: performance.now() }); if (feed.length > 5) feed.shift(); };
  const setBanner = (t, color = C.YELLOW, ms = 2000, big = 0) => { banner = { text: t, until: performance.now() + ms, color, big }; };
  function show(f, slot, cam, g) {
    const now = performance.now();
    const d = Math.hypot(f.pos[0] - cam[0], f.pos[1] - cam[1], f.pos[2] - cam[2]);
    if (f.kind >= L.FX_MG) {
      const m = MG[(f.kind - L.FX_MG) >> 2];
      m?.fx?.(f, {
        slot, sound, C, now, view, dist: d, name: (p) => name(p, slot),
        glow: (o) => glows.push({ life: 400, ...o, born: o.born ?? now }),
        banner: (t, color = C.YELLOW, ms = 2000) => setBanner(t, color, ms),
        feed: (t, color = C.WHITE) => pushFeed(t, color),
      });
      return;
    }
    switch (f.kind) {
      case L.FX_BUMP: {
        const mine = f.owner === slot || f.shot === slot;
        glows.push({ pos: f.pos, size: 0.5 + f.size * 0.08, color: [1, 1, 0.8, 1], kind: SPRITE.SPARK, born: now, life: 220 });
        sound.boing(f.size, mine ? 0 : d);
        if (mine) flash = Math.min(1, flash + f.size / 25);
        break;
      }
      case L.FX_SINK: {
        const score = g.kind === L.PK_SCORE;
        const by = f.shot === 255 ? '' : ` BY ${name(f.shot, slot)}`;
        pushFeed(f.shot === 255 ? `${name(f.owner, slot)} FELL` : `${name(f.owner, slot)} KNOCKED ${score ? 'OFF' : 'OUT'}${by}`, f.owner === slot ? C.RED : f.shot === slot ? C.GREEN : C.WHITE);
        glows.push({ pos: [f.pos[0], f.pos[1] + 0.5, f.pos[2]], size: 3, color: [0.6, 0.85, 1, 0.9], kind: SPRITE.RING, born: now, life: 600, grow: true });
        sound.sink(f.owner === slot ? 0 : d);
        if (f.owner === slot) {
          if (score) setBanner(`DOWN  BACK IN ${Math.ceil(g.respawn / 125)}`, C.RED, 1800);
          else { setBanner(`OUT  ${ordinal(f.size)} OF ${g.n0}`, C.RED, 4000, 2); watched = -1; }
        }
        if (f.shot === slot) { setBanner(`YOU KNOCKED ${score ? 'OFF' : 'OUT'} P${f.owner + 1}`, C.GREEN, 2000); sound.kill(); }
        break;
      }
      case L.FX_PICKUP:
        glows.push({ pos: f.pos, size: 1.4, color: [...PU_COLOR[f.size], 1], kind: SPRITE.FLASH, born: now, life: 300 });
        if (f.owner === slot) { sound.pickup(); setBanner(`${L.PU_NAMES[f.size]}: ${PU_HINT[f.size]}`, C.CYAN, 2500); }
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

  // the camera behind and above a point, looking along yaw (bumper's)
  const chase = (at, r, cy, cp) => {
    const back = 6 + r * 3.2;
    const fo = [at[0], at[1] + r + 0.6, at[2]];
    return [fo[0] - Math.cos(cy) * Math.cos(cp) * back, fo[1] - Math.sin(cp) * back, fo[2] - Math.sin(cy) * Math.cos(cp) * back];
  };
  // high over the stage's edge, going round it
  const overview = (fr, now) => {
    const t = now / 24000;
    const R = fr.radius * 1.25 + 14;
    const c = fr.centre;
    return { cam: [c[0] + Math.cos(t) * R, c[1] + R * 0.62 + 4, c[2] + Math.sin(t) * R], yaw: t + Math.PI, pitch: -Math.atan2(R * 0.62 + 4, R) * 0.92 };
  };

  function frame(now, target) {
    frames++;
    if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; }
    const ms = Math.min(100, now - lastFrame);
    lastFrame = now;
    const nowE = epoch();
    const st = get(L.CL_STATE);
    const slot = get(L.CL_SLOT);
    const g = view.party();
    const mod = MG[g.game] || MG[0];
    const room = get(L.CL_ROOM);
    const dt = Math.max(0, Math.min(3, readClock(i32, f64, L.CL_PLAY, nowE) - room - g.tick)) * TICK;
    me = slot >= 0 ? view.partier(slot) : null;
    pme = null;
    if (external) yaw = get(L.CL_YAW);
    // the bot drives the slots as the keys and mouse would
    if (bot && me?.live && st === 2) {
      const word = bot.think(view, g.tick, Math.round(readClock(i32, f64, L.CL_PRED, nowE) - readClock(i32, f64, L.CL_PLAY, nowE)));
      yaw = word & (TURN - 1);
      aim();
      set(L.CL_MOVE, ((word >>> 24) & 15) | (((word >>> 28) & 1) << 4));
      const use = (word >>> 29) & 3;
      if (use !== (bot.lastUse ?? use)) press(L.CL_PRESSES);
      bot.lastUse = use;
    }
    let dtPred = dt, ptick = g.tick + dt / TICK;
    if (me?.live && !me.out && st === 2) {
      const n = predict(h, slot, live);
      if (n >= 0) {
        pme = pview.partier(slot);
        dtPred = Math.max(-2.5, Math.min(1, readClock(i32, f64, L.CL_PRED, nowE) - room - pview.tick)) * TICK;
        ptick = pview.tick + dtPred / TICK;
        corr.update(n, ms);
      }
    }
    const fr = mod.frame?.(view) || { centre: [g.cx, g.floor, g.cx], radius: g.size, shape: 'disc' };
    // a new round: face the action, the feed cleared
    if (me?.live && g.hole !== seenRound && g.state === L.H_COUNT) {
      seenRound = g.hole;
      if (!BOT && !external && !me.out) {
        const fy = mod.facing?.(view, slot);
        const dx = fr.centre[0] - me.pos[0], dz = fr.centre[2] - me.pos[2];
        const a = fy ?? (Math.hypot(dx, dz) > 2 ? Math.atan2(dz, dx) : null);
        if (a !== null) { yaw = Math.round(a / (2 * Math.PI) * TURN) & (TURN - 1); aim(); }
      }
      feed.length = 0;
      held0 = null;
    }
    // the countdown's beeps, GO, the result
    const secs = Math.ceil((g.until - g.tick) / 125);
    if (g.state === L.H_COUNT && secs !== lastSecs && secs <= 3 && secs > 0) sound.count(secs);
    if (g.state === L.H_PLAY && lastState === L.H_COUNT) { sound.count(0); setBanner('GO!', C.GREEN, 1000, 4); }
    if (g.state === L.H_OVER && lastState === L.H_PLAY) {
      if (g.winner === slot && slot >= 0) { setBanner('YOU WIN!', C.YELLOW, 5000, 4); sound.holed(); }
      else if (me?.live && me.place === 1) { setBanner('A SHARED WIN', C.YELLOW, 5000, 3); sound.holed(); }
      else setBanner(g.winner === 255 ? 'TIME' : `P${g.winner + 1} WINS`, C.YELLOW, 5000, 3);
    }
    lastSecs = secs;
    lastState = g.state;
    sound.music(g.state === L.H_PLAY ? (view.dv.getUint32(L.HDR_SEED, true) ^ Math.imul(g.hole + 7, 0x9e3779b9)) >>> 0 : null, g.state === L.H_PLAY);

    // who the camera follows: you, or (out, watching) a ball still in, the winner when it's over
    const mine = pme && !pme.out ? pme : null;
    const toWinner = g.state === L.H_OVER && g.winner !== 255 && g.winner !== slot;
    let tgt = null, tgtPos = null;
    if (mine && !toWinner) {
      tgt = mine;
      tgtPos = [0, 1, 2].map((k) => mine.pos[k] + mine.vel[k] * dtPred + corr.off[k]);
      held0 = null;
    } else if (st >= 1) {
      if (g.state === L.H_OVER && g.winner !== 255) watched = g.winner;
      if (me && !me.out && g.state !== L.H_PLAY && !toWinner) watched = slot;
      if (watched < 0 || !inBall(watched)) watched = nextIn(watched, 1);
      if (watched >= 0) {
        tgt = view.bumper(watched);
        tgtPos = [0, 1, 2].map((k) => tgt.pos[k] + tgt.vel[k] * dt);
      }
    }
    // PK_SCORE, your ball down: the camera waits where it went down
    const down = me?.live && me.out && g.kind === L.PK_SCORE && g.state === L.H_PLAY && last;
    let cam, camYaw, camPitch = look;
    if (down) {
      held0 = held0 || { cam: last.cam, yaw: last.yaw, pitch: last.pitch };
      ({ cam, yaw: camYaw, pitch: camPitch } = held0);
    } else if (tgt && g.state === L.H_OVER) {
      // the result: going slowly round the winner (or you), low, so the ball sits under the board
      const a = now / 5000, r = tgt.radius, R = 7 + r * 2;
      const b = [tgtPos[0], Math.max(tgtPos[1], g.floor - 3), tgtPos[2]];
      cam = [b[0] + Math.cos(a) * R, b[1] + r + 3, b[2] + Math.sin(a) * R];
      camYaw = a + Math.PI;
      camPitch = Math.atan2(0.5 - r, R);
    } else if (tgt) {
      const r = tgt.radius;
      camYaw = tgt === mine || (me && tgt.slot === slot) ? yaw / TURN * 2 * Math.PI : tgt.yaw;
      // followed down to the lowest floor, not into the sea
      cam = chase([tgtPos[0], Math.max(tgtPos[1], g.floor - 3), tgtPos[2]], r, camYaw, camPitch);
    } else {
      ({ cam, yaw: camYaw, pitch: camPitch } = overview(fr, now));
    }
    // the title card: the stage from round its edge, then down behind your ball for the last two seconds
    const want = g.state === L.H_COUNT && st === 2 ? smooth(1.2, 3, (g.until - g.tick) / 125) : 0;
    cut += (want - cut) * (want > cut ? 1 : Math.min(1, ms / 120));
    if (cut > 0.001 && tgt) {
      const o = overview(fr, now);
      const k = cut;
      cam = cam.map((v, i) => v + (o.cam[i] - v) * k);
      camYaw += wrap(o.yaw - camYaw) * k;
      camPitch += (o.pitch - camPitch) * k;
    }

    // FX from the confirmed ring
    const nfx = view.fxCount();
    if (nfx - fxSeen > L.FX_MAX) fxSeen = nfx - L.FX_MAX;
    for (; fxSeen < nfx; fxSeen++) {
      const x = view.fx(fxSeen);
      if (g.tick - x.tick > 60) continue;
      show(x, slot, cam, g);
    }
    flash *= Math.exp(-ms / 250);

    // the stage, as the minigame draws it
    scene.clear();
    const solid = [], glow = [], beams = [], decals = [], extra = [];
    const out = { scene, solid, glow, beams, decals, casters: extra, paint: null };
    const t = g.state === L.H_PLAY ? g.t * TICK + dt : 0;
    const pt = g.state === L.H_PLAY ? (ptick - g.start) * TICK : 0;
    mod.draw?.(view, { tick: g.tick, dt, t, ptick, pt, now, ms, cam, slot, me, pme, view, pview }, out);

    // the balls, their riders and what they hold, rockets, then what glows
    const casters = [];
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
    for (const c of extra) casters.push(c);
    for (const j of view.projectiles()) {
      const pos = [0, 1, 2].map((k) => j.pos[k] + j.vel[k] * dt);
      solid.push({ pos, size: 0.3, color: [1, 0.7, 0.3, 1], kind: SPRITE.ROCKET, minpx: 1.5 });
      glow.push({ pos: [pos[0] - j.vel[0] * 0.03, pos[1], pos[2] - j.vel[2] * 0.03], size: 0.7, color: [1, 0.6, 0.2, 0.8], kind: SPRITE.FLASH, minpx: 1 });
    }
    for (let k = glows.length - 1; k >= 0; k--) {
      const gl = glows[k];
      const a = (now - gl.born) / gl.life;
      if (a >= 1) { glows.splice(k, 1); continue; }
      const grow = gl.grow ? 0.25 + 0.75 * Math.min(1, a / 0.5) : 1;
      glow.push({ pos: gl.pos, size: gl.size * grow, color: [gl.color[0], gl.color[1], gl.color[2], (gl.color[3] ?? 1) * (1 - a)], kind: gl.kind, minpx: 1 });
    }

    // the HUD (in HUD pixels, the text block's: x from its left, y from the top, 4 x 6 a character)
    const rects = [], big = [];
    const hx = (x) => renderer.hudX + x * HS, hy = (y) => y * HS;
    const playing = st === 2 && me?.live;
    const item = (mine || me)?.item || 0;
    if (playing && !me.out && item) {
      const c = PU_COLOR[item];
      const y = (renderer.rows - 3) * 6;
      rects.push([hx(47 * 4 - 14), hy(y - 4), hx(47 * 4 + 13 * 4), hy(y + 9), 0.05, 0.06, 0.1, 0.7]);
      rects.push([hx(47 * 4 - 11), hy(y - 1), hx(47 * 4 - 4), hy(y + 6), c[0], c[1], c[2], 1]);
    }
    hudText(text, { g, mod, slot, st, now, fps, f: tgt, item, rects, big, hx, hy, t });
    netGraph.sample(now, hashes, keys);
    const graph = showGraph && st > 0 ? netGraph.build((x, y, s2, c) => put(text, COLS, x, y, s2, c), C) : null;
    const xz = [fr.centre[0], fr.centre[2]];
    const ext = Math.min(fr.radius + 6, 70);
    // a stage too big for one shadow map: the square round what the camera looks at
    const focus = fr.radius + 6 > 70 && tgtPos ? [tgtPos[0] + Math.cos(camYaw) * 20, tgtPos[2] + Math.sin(camYaw) * 20] : xz;
    last = {
      cam, yaw: camYaw, pitch: camPitch, time: now / 1000, slot: slot >= 0 ? slot : -1, env: mod.env || 'day',
      focus, extent: ext, scene, casters, solid, glow, beams, decals, paint: out.paint || null, rects, text, graph, flash, big,
      mini: st === 2 && g.state !== L.H_IDLE ? [36 * HS, H - 36 * HS, 30 * HS, Math.max(12, fr.radius * 1.08 + 2)] : null,
      miniShape: fr.shape === 'square' ? 'square' : 'disc', miniCentre: xz,
    };
    renderer.frame(u8, last, target);
  }

  function hudText(tx, { g, mod, slot, st, now, fps, f, item, rects, big, hx, hy, t }) {
    tx.fill(0);
    const rows = renderer.rows;
    const right = (y, str, c) => put(tx, COLS, COLS - 1 - String(str).length, y, str, c);
    const centre = (y, str, c) => put(tx, COLS, Math.floor((COLS - String(str).length) / 2), y, str, c);
    // a line of big text across the middle, its top at HUD row y
    const bigLine = (y, str, c, scale) => {
      const s = String(str).slice(0, 32);
      const k = Math.max(1, Math.min(scale, Math.floor((COLS * 4 - 8) / (s.length * 4))));
      big.push({ text: s, x: Math.floor((COLS * 4 - s.length * 4 * k) / 2) + 1, y: y * 6, scale: k, color: c });
      return Math.ceil(6 * k / 6);
    };
    const band = (y0, y1, a = 0.55) => rects.push([0, hy(y0 * 6), W, hy(y1 * 6), 0.02, 0.03, 0.07, a]);
    if (st !== 2 || (!me?.live && !WATCH)) centre(Math.floor(rows / 2) - 3, h.error ? 'ERROR: ' + h.error.slice(0, 64) : ['CONNECTING', 'CATCHING UP', '', 'DISCONNECTED'][st] || 'JOINING', h.error ? C.RED : C.YELLOW);
    const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;
    const left = Math.max(0, g.until - g.tick);
    const score = g.kind === L.PK_SCORE;
    const board = g.state === L.H_OVER || (held.has('Tab') && g.live);
    const mid = Math.floor(rows / 2);
    if (g.state === L.H_COUNT && st === 2) {
      // the title card: ROUND n, the name big, the hint, the seconds
      const n = Math.ceil(left / 125);
      const y0 = Math.max(2, mid - 12);
      band(y0 - 1, y0 + 11);
      centre(y0, `ROUND ${g.round + 1}   ${g.n0} ${g.n0 === 1 ? 'PLAYER' : 'PLAYERS'}`, C.GREY);
      bigLine(y0 + 2, mod.name || g.name, C.YELLOW, 4);
      centre(y0 + 7, mod.hint || '', C.WHITE);
      centre(y0 + 9, score ? `MOST POINTS WINS  A FALL KEEPS YOU OUT ${Math.round(g.respawn / 125)} S` : 'FALL AND YOU ARE OUT  THE LAST ONE IN WINS', C.CYAN);
      if (n <= 3) bigLine(y0 + 13, String(n), C.WHITE, 5);
      else centre(y0 + 13, `STARTS IN ${n}`, C.YELLOW);
    }
    if (g.state === L.H_PLAY) {
      centre(0, clock(left), left < 10 * 125 ? C.RED : C.WHITE);
      centre(1, mod.name || g.name, C.GREY);
    }
    if (g.state !== L.H_IDLE && st === 2) {
      if (score) {
        // your score and the leader's
        let lead = -1, best = -1;
        for (let p = 0; p < L.NPLAYER; p++) {
          const a = L.PLAYERS + p * L.PSIZE;
          if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
          const s = view.dv.getUint16(a + L.PG_SCORE, true);
          if (s > best) { best = s; lead = p; }
        }
        if (me?.live) put(tx, COLS, 1, 0, `SCORE ${me.score}`, C.YELLOW);
        if (lead >= 0 && g.state !== L.H_COUNT) put(tx, COLS, 1, 1, lead === slot ? 'YOU LEAD' : `LEADER P${lead + 1} ${best}`, lead === slot ? C.GREEN : C.WHITE);
      } else put(tx, COLS, 1, 0, `${g.left} OF ${g.n0} LEFT`, C.YELLOW);
    }
    if (me?.live) {
      right(0, `POINTS ${me.pts}  WINS ${me.wins}`, C.YELLOW);
      if (me.out && g.state === L.H_PLAY && !score) centre(rows - 4, f ? `OUT  WATCHING P${f.slot + 1}  CLICK FOR ANOTHER` : 'OUT', C.GREY);
      if (me.out && me.place === 0 && g.state === L.H_PLAY && !score) centre(rows - 5, 'YOU PLAY THE NEXT ROUND', C.CYAN);
      if (me.out && g.state === L.H_PLAY && score) centre(rows - 4, `DOWN  BACK IN ${Math.max(0, Math.ceil((g.respawn - ((g.tick - me.outAt) | 0)) / 125))}`, C.GREY);
      if (item && !me.out) put(tx, COLS, 47, rows - 3, `${L.PU_NAMES[item]}  CLICK`, C.WHITE);
    } else if (WATCH && f) put(tx, COLS, 1, 1, `WATCHING P${f.slot + 1}  < >`, C.CYAN);
    // the minigame's own lines
    if (g.state === L.H_PLAY && !board) {
      try {
        mod.hud?.(view, {
          put: (x, y, s2, c) => put(tx, COLS, x, y, s2, c), centre, right, rows, C, slot, me, now, t,
          rect: (x0, y0, x1, y1, r, gg, b, a = 1) => rects.push([hx(x0), hy(y0), hx(x1), hy(y1), r, gg, b, a]),
        });
      } catch (e) { console.error(e); }
    }
    if (!board) feed.forEach((e, k) => { if (now - e.born < 6000) put(tx, COLS, 18, rows - 9 - (feed.length - 1 - k), e.text, e.color); });
    if (banner.until > now && !(g.state === L.H_OVER && banner.big)) {
      if (banner.big) bigLine(Math.max(2, mid - 9 - banner.big), banner.text, banner.color, banner.big);
      else centre(mid - 8, banner.text, banner.color);
    }
    if (st === 2 && !BOT && !WATCH && !locked) centre(mid + 7, 'CLICK TO PLAY  WASD ROLL  SPACE HOP  CLICK USES WHAT YOU HOLD', C.WHITE);
    if (showGraph) put(tx, COLS, 1, rows - 1, `${fps} FPS  LEAD ${f32[L.CL_LEAD >> 2].toFixed(1)}  DELAY ${f32[L.CL_DELAY >> 2].toFixed(1)}  REPAIRS ${get(L.CL_REPAIRS)}`, C.GREY);
    if (board) boardText({ g, mod, slot, rows, centre, bigLine, band });
  }

  // The board: everyone in the room by party points, then wins, then this
  // round's place; through the result, your place called out over it.
  function boardText({ g, mod, slot, rows, centre, bigLine, band }) {
    const list = [];
    let m = 0;
    for (let p = 0; p < L.NPLAYER; p++) {
      const b = view.partier(p);
      if (!b.live) continue;
      list.push(b);
      if (b.place) m++;
    }
    list.sort((a, b) => b.pts - a.pts || b.wins - a.wins || (a.place || 999) - (b.place || 999) || a.slot - b.slot);
    const over = g.state === L.H_OVER;
    let y0 = 3;
    if (over) {
      // the result: you won, or your place, and who won
      const won = me?.live && me.place === 1 && (g.kind === L.PK_SCORE || !me.out);
      const who = g.winner !== 255 ? (g.winner === slot ? 'YOU WIN' : `P${g.winner + 1} WINS`) : list.some((o) => o.place === 1) ? 'A SHARED WIN' : 'NO WINNER';
      band(1, 9, 0.55);
      if (me?.live && me.place) {
        bigLine(2, won ? (g.winner === slot ? 'YOU WIN!' : 'A SHARED WIN') : `${ordinal(me.place)} OF ${m}`, won ? C.YELLOW : C.WHITE, 4);
        centre(7, `${won ? `${ordinal(me.place)} OF ${m}  ` : ''}+${gain(me.place, m)} POINTS${won ? '' : `   ${who}`}`, C.GREEN);
      } else {
        bigLine(2, who, C.YELLOW, 4);
        centre(7, `${mod.name || g.name}  YOU PLAY THE NEXT ROUND`, C.CYAN);
      }
      y0 = 10;
    }
    const nextIn = Math.max(0, Math.ceil((g.until - g.tick) / 125));
    const fit = Math.max(1, rows - y0 - 6);
    const mineAt = list.findIndex((o) => o.slot === slot);
    const shown = mineAt >= fit ? [...list.slice(0, fit - 1), list[mineAt]] : list.slice(0, fit);
    band(y0 - 1, y0 + 4 + shown.length, 0.45);
    centre(y0, `ROUND ${g.round + 1}  ${mod.name || g.name}  ${list.length} PLAYERS${over ? `  NEXT IN ${nextIn}` : ''}`, C.YELLOW);
    centre(y0 + 2, 'RANK  PLAYER    POINTS  WINS  KOS  ROUND  ', C.GREY);
    let rank = 0;
    shown.forEach((o, k) => {
      const i = list.indexOf(o);
      // ties share a rank
      rank = i > 0 && list[i - 1].pts === o.pts && list[i - 1].wins === o.wins && k > 0 && shown[k - 1] === list[i - 1] ? rank : i + 1;
      const nm = (o.slot === slot && !WATCH ? 'YOU ' : 'P') + String(o.slot + 1);
      const now = !o.out && g.state === L.H_PLAY && g.kind === L.PK_OUT ? 'IN' : o.place ? `${ordinal(o.place)}${over ? ` +${gain(o.place, m)}` : ''}` : '-';
      centre(y0 + 3 + k, `${String(rank).padStart(4)}  ${nm.padEnd(8)}  ${String(o.pts).padStart(6)}  ${String(o.wins).padStart(4)}  ${String(o.kos).padStart(3)}  ${now.padEnd(7)}`, o.slot === slot ? C.YELLOW : C.WHITE);
    });
  }

  return {
    frame,
    unmount() { off(); held.clear(); set(L.CL_MOVE, 0); sound.music(null, false); if (document.pointerLockElement === lockTarget && lockTarget === canvas) document.exitPointerLock(); },
    capture: (scale = W > 640 ? 1 : 2) => (last ? capturePng(renderer, u8, last, scale) : null),
    state: () => {
      const g = view.party();
      return { slot: get(L.CL_SLOT), clState: get(L.CL_STATE), me, error: h.error, welcome: h.welcome, round: g, game: g.game, name: g.name, feed: feed.map((f) => f.text), fps };
    },
    get locked() { return locked; },
  };
}
