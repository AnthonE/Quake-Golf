// BULLSEYE, as drawn and as the AI ball sees it. A disc of frosted ice over
// a block of glacier, icicles hanging off its rim, and the house painted in
// its middle as decals: the bull white, the rings red, white and blue out to
// its edge, a dark line between each. A bell hangs high over the bull and
// swings as it rings; the last 2 s before it the rings pulse and the HUD
// counts; after it the shove wave runs out over the house as a ring of
// frost, the house frosted behind it till the wave is done. Under your own ball a ring says what you'd score now. The stage
// and the clock are the sim's (src/mg/bullseye.wat) worked again here from
// PG_H and the tick, so the bots steer by what the sim does.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/bullseye.mjs'; // BE_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const ICE = [0.8, 0.9, 1];
const GLACIER = [0.5, 0.7, 0.86];
const ROCK = [0.34, 0.36, 0.4];
const GOLD = [1, 0.78, 0.3];
// the bull and the rings' paint, inside out, and the HUD's word and colour for each
const PAINT = [[1, 1, 1], [0.95, 0.12, 0.1], [1, 1, 1], [0.1, 0.3, 1]];
const WORD = ['IN THE BULL', 'ON THE RED', 'ON THE WHITE', 'ON THE BLUE'];
const HUE = [C.YELLOW, C.RED, C.WHITE, C.CYAN];
const MARK = [[1, 0.85, 0.3], [1, 0.3, 0.25], [0.8, 0.92, 1], [0.35, 0.6, 1]]; // the ring under your ball, by the ring it's on
const BELL_UP = 11; // m over the ice the bell hangs

// ---- the stage and the clock, as the sim has them

export function stage(view) {
  const o = view.bank || 0;
  if (view._be && view._be.tick === view.tick && view._be.o === o) return view._be;
  const dv = view.dv, h = L.PG_H + o;
  view._be = {
    tick: view.tick, o, cx: dv.getFloat32(L.PG_CX + o, true), rad: dv.getFloat32(h + MC.BE_RAD, true),
    ring: [0, 1, 2, 3].map((k) => dv.getFloat32(h + MC.BE_RING + 4 * k, true)), wt: dv.getUint32(h + MC.BE_WT, true),
  };
  return view._be;
}
// The ring (x, z) is in: 0 the bull .. 3 the blue, -1 out of the house ($be_bell's).
export function ringAt(st, x, z) {
  const d2 = Math.fround(Math.fround((x - st.cx) * (x - st.cx)) + Math.fround((z - st.cx) * (z - st.cx)));
  for (let k = 0; k < 4; k++) if (d2 <= Math.fround(st.ring[k] * st.ring[k])) return k;
  return -1;
}
// The end tick t into play is in (1..BE_ENDS), and whether it scores double.
export const endOf = (t) => Math.min(MC.BE_ENDS, Math.floor(Math.max(0, t - 1) / MC.BE_END) + 1);
export const doubled = (k) => k > MC.BE_ENDS - MC.BE_DOUBLE;
// What ring k pays at end e.
export const pays = (k, e) => (k < 0 ? 0 : MC.BE_PTS[k] * (doubled(e) ? 2 : 1));
// Ticks from t into play to the next bell (the bell on t itself is 0).
export const toBell = (t) => (t > 0 && t % MC.BE_END === 0 ? 0 : MC.BE_END - (((t % MC.BE_END) + MC.BE_END) % MC.BE_END));
// Ticks after a bell tick t into play is, while its wave runs (1..BE_WT), else 0 ($be_after's).
export function inWave(st, t) {
  const k = Math.floor(t / MC.BE_END), a = t - k * MC.BE_END;
  return k < 1 || k >= MC.BE_ENDS || a <= 0 || a > st.wt ? 0 : a;
}
// The shove wave's front on tick t into play, m out from the middle, or -1
// when there is none or it has run past the house (it carries on there till BE_WT).
export function waveAt(st, t) {
  const a = inWave(st, t);
  if (!a) return -1;
  const f = a * MC.BE_WAVEDT;
  return f - MC.BE_BAND > st.ring[3] + MC.BE_CLR ? -1 : f;
}
// The wave's speed out at r m from the middle ($be_wave's).
export const waveSpeed = (st, r) => Math.min(MC.BE_WMAX, Math.fround(MC.BE_WK * Math.fround(Math.fround(st.ring[3] + MC.BE_WM) - r)));
// Ticks into play to draw at (fractional), frozen where the round ended; -1 before play.
function playTime(view, g, ctx) {
  if (g.state === L.H_COUNT) return 0;
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.pt === 'number' && ctx.pt > 0 ? ctx.pt / TICK : typeof ctx?.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
  if (g.state === L.H_OVER) t = Math.min(t, MC.BE_LEN);
  return Math.max(0, t);
}

// the prediction's ball as last drawn, for the HUD (which gets the confirmed one); the count's last second sounded
let mine = null;
let counted = -1;

// ---- the AI ball

const MINDS = new WeakMap();
function mindOf(bot) {
  if (!bot || typeof bot !== 'object') return {};
  if (bot.mem) return (bot.mem.be ||= {});
  let m = MINDS.get(bot);
  if (!m) MINDS.set(bot, (m = {}));
  return m;
}
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
// A number in [0, 1) for this ball and k, its own and the same every time.
const luck = (slot, k) => { let h = Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return (h >>> 0) / 2 ** 32; };
// How many balls a ring holds before a ball looks further out: its area over a ball's room.
const ROOMY = Math.PI * 1.35 * 1.35;

// The house as every AI ball looking at one world tick sees it: each ball
// in it or near it (where, how fast, its ring) and in a grid of CELL m
// squares, how many each ring holds.
const CELL = 4;
const cellOf = (x, z) => Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
function house(view, st) {
  const c = view._beh;
  if (c && c.tick === view.tick && c.o === st.o) return c;
  const balls = [], count = [0, 0, 0, 0], grid = new Map();
  for (let p = 0; p < L.NPLAYER; p++) {
    const r = L.PLAYERS + st.o + p * L.PSIZE;
    if ((view.u8[r + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const x = view.dv.getFloat32(r + L.P_PX, true), z = view.dv.getFloat32(r + L.P_PZ, true);
    const k = ringAt(st, x, z);
    if (k < 0 && Math.hypot(x - st.cx, z - st.cx) > st.ring[3] + 2) continue;
    if (k >= 0) count[k]++;
    const b = { slot: p, x, z, vx: view.dv.getFloat32(r + L.P_VX, true), vz: view.dv.getFloat32(r + L.P_VZ, true), k, big: view.dv.getUint16(r + L.B_MEGA, true) > 0 };
    balls.push(b);
    const key = cellOf(x, z), list = grid.get(key);
    if (list) list.push(b); else grid.set(key, [b]);
  }
  const area = st.ring.map((r, k) => Math.PI * (r * r - (k ? st.ring[k - 1] ** 2 : 0)));
  view._beh = { tick: view.tick, o: st.o, balls, grid, count, cap: area.map((a) => Math.max(1, Math.floor(a / ROOMY * 0.7))) };
  return view._beh;
}

// The nearest any other ball in the house comes to (x, z), at most CELL m.
function clearance(h, slot, x, z) {
  let m = CELL * CELL;
  const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
    const list = h.grid.get(i * 4096 + j);
    if (list) for (const b of list) if (b.slot !== slot) m = Math.min(m, (b.x - x) ** 2 + (b.z - z) ** 2);
  }
  return Math.sqrt(m);
}

// What the ball is after on tick `tick`: a spot in the house to hold as the
// bell rings, or a rival in the bull to knock out of it.
//   The bull if it's free; else, a ball keen enough (by its luck and skill)
//   that is faster or bigger than the one in the bull, or far enough out to
//   be faster when it gets there, rams it, with a second and a half to the
//   bell at least to get back; else the innermost ring with room in it, at
//   its roomiest of 10 spots round it (the near side favoured), kept a
//   second unless someone sits on it.
function plan(view, me, bot, tick) {
  const b = ball(view, me);
  const o = view.bank || 0;
  if (!b || !b.live || b.out || b.falling || view.dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY) return null;
  const st = stage(view);
  if (!(st.rad > 0)) return null;
  const t = Math.max(0, (tick - view.dv.getUint32(L.HDR_START + o, true)) | 0);
  const pos = bot?.pos ?? [b.pos[0], b.pos[2]];
  const vel = bot?.vel ?? [b.vel[0], b.vel[2]];
  const skill = bot?.skill ?? 0.6;
  const mind = mindOf(bot);
  const h = house(view, st);
  const tb = toBell(t);
  const slot = b.slot;
  const myK = ringAt(st, pos[0], pos[1]);
  const plan = { pos, vel, st, t, tb, mind, goal: null, ram: null, tol: 0.35 };
  // the ball in the bull nearest its middle, not this one
  let held = null, hd = Infinity;
  for (const r of h.balls) {
    if (r.slot === slot || r.k !== 0) continue;
    const d = Math.hypot(r.x - st.cx, r.z - st.cx);
    if (d < hd) { hd = d; held = r; }
  }
  if (held && myK !== 0) {
    const d = Math.hypot(held.x - pos[0], held.z - pos[1]);
    const sp = Math.hypot(vel[0], vel[1]), its = Math.hypot(held.vx, held.vz);
    const faster = sp > its + 1.5 || (d > 3 && its < 2);
    const keen = luck(slot, 40 + Math.floor(t / 375)) < 0.15 + 0.5 * skill;
    if ((faster || (b.mega && !held.big)) && keen && d < 16 && tb > 190 && tb < MC.BE_END - 120) {
      // lead it by where it will be when this ball gets there
      const tt = d / Math.max(3, sp);
      plan.ram = held;
      plan.goal = [held.x + held.vx * tt, held.z + held.vz * tt];
      return plan;
    }
  }
  // the spot: kept a second, unless taken
  const keep = mind.spot && t - mind.spot.at < 125 && mind.spot.round === view.dv.getUint32(L.HDR_HOLE + o, true);
  if (keep && clearance(h, slot, mind.spot.x, mind.spot.z) > 1.7) { plan.goal = [mind.spot.x, mind.spot.z]; return plan; }
  let k = 0;
  for (; k < 3; k++) {
    const others = h.count[k] - (myK === k ? 1 : 0);
    if (others < h.cap[k] * (k === 0 ? 1 : 0.85 + 0.3 * luck(slot, k))) break;
  }
  // a clumsy ball sometimes settles for the next ring out
  if (k < 3 && luck(slot, 7 + Math.floor(t / MC.BE_END)) > 0.55 + 0.45 * skill) k++;
  const r0 = k ? st.ring[k - 1] : 0, r1 = st.ring[k];
  const rr = k ? r0 + (r1 - r0) * (0.3 + 0.4 * luck(slot, 11 + Math.floor(t / 250))) : r1 * 0.35 * luck(slot, 12);
  const a0 = Math.atan2(pos[1] - st.cx, pos[0] - st.cx);
  let best = -Infinity, bx = st.cx, bz = st.cx;
  for (let i = 0; i < 10; i++) {
    const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (2 * Math.PI / 10) + 0.4 * (luck(slot, 13) - 0.5);
    const x = st.cx + Math.cos(a) * rr, z = st.cx + Math.sin(a) * rr;
    const s = clearance(h, slot, x, z) - 0.08 * Math.hypot(x - pos[0], z - pos[1]);
    if (s > best) { best = s; bx = x; bz = z; }
  }
  mind.spot = { x: bx, z: bz, at: t, round: view.dv.getUint32(L.HDR_HOLE + o, true) };
  plan.goal = [bx, bz];
  return plan;
}

// The word for a plan: on ice the push is slow and the slide long, so it
// pushes for the velocity that stops it at its goal (braking by pushing
// back, as it closes), or flat out at a rival it rams; and first, wherever
// it would slide to if it pushed back from now is kept inside the edge.
function steer(p, acc, last) {
  const { st, pos, vel } = p;
  const a = Math.max(1, acc);
  const sp = Math.hypot(vel[0], vel[1]);
  // where it stops pushing straight back from here
  const stop = sp * sp / (2 * 0.8 * a);
  const sx = pos[0] + (sp > 1e-6 ? vel[0] / sp * stop : 0), sz = pos[1] + (sp > 1e-6 ? vel[1] / sp * stop : 0);
  let want;
  if (Math.hypot(sx - st.cx, sz - st.cx) > st.rad - 2.5) {
    // headed off the edge: back toward the middle
    const dx = st.cx - pos[0], dz = st.cx - pos[1], d = Math.hypot(dx, dz) || 1;
    want = [dx / d * 3, dz / d * 3];
  } else {
    const dx = p.goal[0] - pos[0], dz = p.goal[1] - pos[1], d = Math.hypot(dx, dz);
    const v = p.ram ? 9 : Math.min(8, Math.sqrt(2 * 0.7 * a * Math.max(0, d - p.tol)));
    want = d > 1e-6 ? [dx / d * v, dz / d * v] : [0, 0];
  }
  const ax = want[0] - vel[0], az = want[1] - vel[1];
  if (Math.hypot(ax, az) < 0.3) return { yaw: last ?? 0, move: 0 };
  return { yaw: Math.atan2(az, ax), move: 1 };
}

export default {
  id: L.MG_BULLSEYE, key: 'bullseye', name: 'BULLSEYE',
  hint: 'BE IN THE HOUSE AS THE BELL RINGS  BUMP THE OTHERS OUT',
  rules: 'A BELL EVERY 10 S  BULL 5  RED 3  WHITE 2  BLUE 1  LAST THREE DOUBLE',
  env: 'snow',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.rad > 0)) return;
    const g = view.party();
    const sc = out.scene;
    const { cx, rad, ring } = st;
    // the ice, the glacier under it, a rocky root, icicles off the rim
    sc.cyl(cx, PLAT_Y - 0.6, cx, rad, 0.6, ...ICE, LOOK.ICE, 0, 0.35);
    sc.cyl(cx, PLAT_Y - 4.2, cx, rad - 0.35, 3, ...GLACIER, LOOK.ICE, 0.12, 0.65);
    sc.cyl(cx, PLAT_Y - 9, cx, rad * 0.7, 2, ...ROCK, LOOK.RUBBER);
    const n = Math.round((2 * Math.PI * rad) / 2.3);
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n + 0.3 * luck(i, 1), r = rad - 0.25 - 0.3 * luck(i, 2), len = 0.5 + 1.6 * luck(i, 3);
      const x = cx + Math.cos(a) * r, z = cx + Math.sin(a) * r;
      sc.cyl(x, PLAT_Y - 1.2 - len * 0.35, z, 0.26, len * 0.35, ...ICE, LOOK.ICE, 0, 0.25, 0.9, i);
      sc.cyl(x, PLAT_Y - 1.2 - len * 0.85, z, 0.12, len * 0.15, ...ICE, LOOK.ICE, 0, 0.25, 0.9, i);
    }
    out.decals?.push({ pos: [cx, PLAT_Y + 0.01, cx], radius: rad, width: 0.4, color: [1, 1, 1, 0.45], kind: DECAL.RING });
    const tp = playTime(view, g, ctx);
    const now = (ctx?.now ?? 0) / 1000;
    const tb = tp >= 0 && g.state === L.H_PLAY ? toBell(Math.floor(tp)) : MC.BE_END;
    // the last 2 s before a bell the rings pulse, three beats a second, brighter as it comes
    const warn = tb > 0 && tb <= MC.BE_WARN;
    const beat = warn ? 0.5 + 0.5 * Math.cos(2 * Math.PI * 3 * (MC.BE_WARN - tb) * TICK) : 0;
    const glow = warn ? 0.7 + 0.3 * beat * (1 + (MC.BE_WARN - tb) / MC.BE_WARN) : 0.85;
    for (let k = 3; k >= 0; k--) {
      const w = k ? ring[k] - ring[k - 1] : ring[0];
      const c = PAINT[k];
      out.decals?.push({ pos: [cx, PLAT_Y + 0.01, cx], radius: ring[k], width: w, color: [c[0] * glow, c[1] * glow, c[2] * glow, 0.9], kind: DECAL.RING });
      out.decals?.push({ pos: [cx, PLAT_Y + 0.012, cx], radius: ring[k] + 0.05, width: 0.12, color: [0.04, 0.06, 0.16, 0.9], kind: DECAL.RING });
    }
    out.decals?.push({ pos: [cx, PLAT_Y + 0.014, cx], radius: 0.3, width: 0.3, color: [0.95, 0.12, 0.1, 0.9], kind: DECAL.DISC });
    if (warn) out.decals?.push({ pos: [cx, PLAT_Y + 0.016, cx], radius: ring[3] + 0.4 + 0.6 * beat, width: 0.25, color: [1, 0.9, 0.5, 0.5 + 0.4 * beat], kind: DECAL.RING });
    // the wave: a ring of frost running out over the house
    const f = tp >= 0 && g.state === L.H_PLAY ? waveAt(st, tp) : -1;
    if (f > 0) {
      const fade = Math.max(0, 1 - Math.max(0, f - ring[3]) / 2.5);
      out.decals?.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: f, width: MC.BE_BAND, color: [0.85, 0.97, 1, 0.85 * fade], kind: DECAL.RING });
    }
    // and behind it, till it's done, the house frosted over: closed
    const wa = tp >= 0 && g.state === L.H_PLAY ? inWave(st, Math.floor(tp)) : 0;
    if (wa) {
      const fr = Math.min(f > 0 ? f : Infinity, ring[3] + MC.BE_CLR), fade = Math.min(1, (st.wt - wa) / 25);
      if (fr > 0.5) out.decals?.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: fr - 0.15, width: fr, color: [0.6, 0.85, 1, 0.22 * fade], kind: DECAL.RING });
    }
    // the bell over the bull, swinging for a while after it rings
    const rang = Math.floor(Math.max(0, tp) / MC.BE_END) * MC.BE_END;
    const since = tp >= MC.BE_END ? (tp - rang) * TICK : 9;
    const swing = since < 3 ? 0.32 * Math.sin(since * 8) * Math.exp(-since * 1.4) : 0;
    const top = PLAT_Y + BELL_UP + 2.2;
    const at = (y) => [cx, top - y * Math.cos(swing), cx - y * Math.sin(swing)];
    const [x1, y1, z1] = at(0.9), [x2, y2, z2] = at(1.9), [x3, y3, z3] = at(2.3), [x4, y4, z4] = at(2.75);
    sc.sphere(x1, y1, z1, 0.95, ...GOLD, LOOK.METAL);
    sc.cyl(x2, y2, z2, 1.05, 0.75, ...GOLD, LOOK.METAL, 0, 0, 1, 7, swing);
    sc.cyl(x3, y3, z3, 1.4, 0.18, ...GOLD, LOOK.METAL, 0, 0, 1, 8, swing);
    sc.sphere(x4, y4, z4, 0.32, 0.5, 0.42, 0.3, LOOK.METAL);
    sc.cyl(cx, top + 0.6, cx, 0.12, 0.6, 0.3, 0.3, 0.32, LOOK.METAL);
    out.glow?.push({ pos: [cx, top - 1.5, cx], size: warn ? 5 + 2 * beat : 3.5, color: [1, 0.85, 0.4, warn ? 0.45 : 0.2], kind: SPRITE.FLASH });
    // the count, a tick a second
    if (warn && ctx?.sound && Math.ceil(tb * TICK) !== counted) { counted = Math.ceil(tb * TICK); ctx.sound.count?.(1); }
    if (!warn) counted = -1;
    // under your own ball, what it would score now
    mine = ctx?.pme && ctx.pme.live && !ctx.pme.out ? ctx.pme : null;
    if (mine && g.state === L.H_PLAY) {
      const k = ringAt(st, mine.pos[0], mine.pos[2]);
      const dt = Math.max(-0.02, Math.min(0.03, ((ctx.ptick ?? 0) - (ctx.pview?.tick ?? ctx.ptick ?? 0)) * TICK));
      if (k >= 0) {
        out.decals?.push({ pos: [mine.pos[0] + mine.vel[0] * dt, mine.pos[1] + 0.05, mine.pos[2] + mine.vel[2] * dt], radius: 1.5, width: 0.28, color: [...MARK[k], 0.9], kind: DECAL.RING });
      }
    }
  },

  frame(view) {
    const st = stage(view);
    const g = view.party();
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: st.rad || g.size, shape: 'disc' };
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    if (f.kind === MC.BE_FX_BELL) {
      ctx.sound?.count?.(0);
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: 14, color: [0.85, 0.95, 1, 0.8], kind: SPRITE.RING, life: 900, grow: true });
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + BELL_UP + 1, f.pos[2]], size: 7, color: [1, 0.85, 0.4, 0.9], kind: SPRITE.FLASH, life: 500, grow: true });
      // what you took (your PG_M says, if this end scored you)
      const me = ctx.view?.partier?.(ctx.slot);
      if (me && me.live) {
        const m = me.m;
        if (m >>> 16 === f.shot && (m & 255)) {
          const k = ((m >>> 8) & 255) - 1;
          ctx.banner?.(`END ${f.shot}  ${WORD[k] ?? ''}  +${m & 255}`, HUE[k] ?? C.WHITE, 1800);
          ctx.sound?.pickup?.();
        } else if (!me.out) ctx.banner?.(`END ${f.shot}  NOTHING`, C.GREY, 1500);
      }
      if (f.shot === MC.BE_ENDS - MC.BE_DOUBLE) ctx.feed?.('THE LAST THREE ENDS SCORE DOUBLE', C.ORANGE);
    } else if (f.kind === MC.BE_FX_BULL) {
      if (f.owner === ctx.slot) ctx.sound?.holed?.();
      else {
        ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} IN THE BULL  +${f.size}`, C.YELLOW);
        if (d < 40) ctx.sound?.tick?.();
      }
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 3.5, color: [1, 0.85, 0.35, 0.9], kind: SPRITE.FLASH, life: 600, grow: true });
    }
  },

  // the end, its bell and what each ring pays; where you are and what it's worth
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    if (!(st.rad > 0)) return;
    const t = Math.floor(typeof ctx.t === 'number' ? ctx.t / TICK : g.t);
    const e = endOf(t), tb = toBell(t);
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    ctx.right(3, `END ${e} OF ${MC.BE_ENDS}${doubled(e) ? '  DOUBLE' : ''}  BELL IN ${Math.ceil(tb * TICK)}`, doubled(e) ? C.ORANGE : C.GREY);
    ctx.right(4, `BULL ${pays(0, e)}  RED ${pays(1, e)}  WHITE ${pays(2, e)}  BLUE ${pays(3, e)}`, C.GREY);
    const me = mine && mine.slot === ctx.slot ? mine : ctx.me;
    if (me && me.live && !me.out) {
      const k = ringAt(st, me.pos[0], me.pos[2]);
      ctx.centre(row, k < 0 ? 'GET IN THE HOUSE' : `${WORD[k]}  +${pays(k, e)}`, k < 0 ? C.WHITE : HUE[k]);
    }
    if (tb > 0 && tb <= MC.BE_WARN) ctx.centre(row + 1, `BELL  ${Math.ceil(tb * TICK)}`, C.ORANGE);
    else if (inWave(st, t)) ctx.centre(row + 1, 'THE WAVE CLEARS THE HOUSE', C.CYAN);
  },

  brain: {
    // off the ice is a fall; its last 3 m a warning
    danger(view, x, z) {
      const st = stage(view);
      const e = st.rad - Math.hypot(x - st.cx, z - st.cx);
      return e <= 0 ? 1 : e < 3 ? ((3 - e) / 3) * 0.7 : 0;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot, bot?.at ?? view.tick);
      return p ? p.goal : null;
    },
    hop() { return false; },
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      if (!p) return null;
      const s = steer(p, view.party().acc * Number(L.BPHYS.B_ACC_DT) / TICK, p.mind.yaw);
      p.mind.yaw = s.yaw;
      return s;
    },
  },
};
