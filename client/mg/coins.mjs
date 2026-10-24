// COIN RUSH, as drawn and as the AI ball sees it. A round table over the sea,
// felt checkered in two greens with a gold band round it; spinning gold
// coins falling onto it (each one's shadow and a ring where it will land),
// lying there blinking out at the end of their ten seconds, flying off a
// ball bumped hard or spilling in over the rim where one fell; bumpers
// lit gold when they pay, dark red while they recharge; a jackpot called by
// a beam and a ring three seconds before its fountain. Every coin is read
// from its record (src/mg/coins.mjs's layout) and placed on its flight as
// $cr_at places it, so it is drawn where the sim has it, on the clock your
// own ball is drawn at; a coin your predicted ball rolls into is hidden at
// once, before the take comes back from the confirmed world.
import * as L from '../../src/layout.mjs';
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const YL = Math.fround(PLAT_Y + L.CR_CY); // a lying coin's centre, the sim's f32
const GOLD = [1, 0.8, 0.22];
const COIN_R = 0.42, BIG_R = 0.66; // drawn radii, m
const WAIT = [0, L.CR_LOOSE, L.CR_JWAIT]; // by kind: ticks after its throw before a coin is anyone's
// Ticks into play at tick T (fractional) of a round started on tick start: the sim's i32 subtraction wraps.
const since = (T, start) => ((Math.floor(T) - start) | 0) + (T - Math.floor(T));
const ordinal = (n) => `${n}${[, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH'}`;

// ---- the stage, read from the sim (its own state is the confirmed world's: bank 0 always)

const radius = (view) => view.dv.getFloat32(L.PG_H + L.CR_RAD, true);
const centre = (view) => view.dv.getFloat32(L.PG_CX, true);
export function bumpers(view) {
  const n = Math.min(L.CR_NBMAX, view.dv.getUint32(L.PG_H + L.CR_NB, true));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = L.PG_S + L.CR_BUMP + 16 * i;
    out.push({ i, x: view.dv.getFloat32(a, true), z: view.dv.getFloat32(a + 4, true), litAt: view.dv.getUint32(a + 8, true), hits: view.dv.getUint32(a + 12, true) });
  }
  return out;
}
// Jackpot j erupts this many ticks into play.
export const jackAt = (j) => L.CR_JACK0 + j * L.CR_JACKP;
// The jackpot about play tick tp: the next to erupt (or the one just gone,
// within a second), whether it's been called, its spot, its coins.
export function jackpot(view, tp) {
  const len = view.dv.getUint32(L.PG_LEN, true);
  let j = Math.max(0, Math.ceil((tp - L.CR_JACK0 - 125) / L.CR_JACKP));
  if (jackAt(j) >= len) return null;
  const called = view.dv.getUint32(L.PG_H + L.CR_JK, true) > j;
  const live = view.dv.getUint32(L.HDR_LIVE, true);
  return {
    j, at: jackAt(j), called, x: view.dv.getFloat32(L.PG_H + L.CR_JX, true), z: view.dv.getFloat32(L.PG_H + L.CR_JZ, true),
    n: Math.min(L.CR_JACKMAX, L.CR_JACKN0 + Math.floor(live / L.CR_JACKNK)),
  };
}
export const frenzy = (tp) => tp >= L.CR_FRENZY;

// Every coin in the records: { c, x, z (where it lies), x0, y0, z0, h, t0, air, v, kind, ready (the tick it is
// anyone's, lying or low enough), gone (the tick it goes) }, once a world tick.
export function coins(view) {
  if (view._cr?.tick === view.tick) return view._cr.list;
  const dv = view.dv, list = [];
  for (let c = 0; c < L.CR_MAX; c++) {
    const a = L.PG_BIG + L.CR_COINS + c * L.CR_CSIZE;
    const v = view.u8[a + L.CR_C_V];
    if (!v) continue;
    const t0 = dv.getUint32(a + L.CR_C_T0, true), air = dv.getUint16(a + L.CR_C_AIR, true), kind = view.u8[a + L.CR_C_KIND];
    list.push({
      c, v, kind, t0, air, x: dv.getFloat32(a + L.CR_C_X, true), z: dv.getFloat32(a + L.CR_C_Z, true),
      x0: dv.getFloat32(a + L.CR_C_X0, true), y0: dv.getFloat32(a + L.CR_C_Y0, true), z0: dv.getFloat32(a + L.CR_C_Z0, true), h: dv.getFloat32(a + L.CR_C_H, true),
      ready: t0 + Math.max(WAIT[kind] ?? 0, air - 8), gone: t0 + air + L.CR_LIFE,
    });
  }
  view._cr = { tick: view.tick, list };
  return list;
}
// Where coin k is on tick t (fractional), as $cr_at: [x, y, z].
export function coinAt(k, t) {
  const tau = t - k.t0;
  if (tau >= k.air) return [k.x, YL, k.z];
  const u = tau / k.air;
  return [k.x0 + (k.x - k.x0) * u, k.y0 + (YL - k.y0) * u + 4 * k.h * u * (1 - u), k.z0 + (k.z - k.z0) * u];
}
// Is a ball whose bottom is at (x, y, z) within reach of coin k on tick t, as $cr_tick takes them?
function reaches(k, t, x, y, z, r = 1) {
  if (t < k.t0 + (WAIT[k.kind] ?? 0) || t >= k.gone) return false;
  const p = coinAt(k, t);
  if (p[1] > PLAT_Y + L.CR_GRABH) return false;
  const R = r + L.CR_REACH;
  return (p[0] - x) ** 2 + (p[1] - y - r) ** 2 + (p[2] - z) ** 2 < R * R;
}

// ---- drawing

// Coins your own predicted ball has rolled into: hidden till the confirmed world has had time to agree.
const ghosts = new Map(); // `${c}:${t0}` -> the confirmed tick by which the take should be back
const hitAt = new Map(); // bumper -> ms of its last throw, for the flash
let env = 'sunset';

function table(out, cx, R, now) {
  const sc = out.scene;
  // felt, a gold band round its edge, the stand under it
  sc.cyl(cx, PLAT_Y - 0.6, cx, R, 0.6, 0.08, 0.42, 0.3, LOOK.CHECKER, 4, 0.55);
  sc.cyl(cx, PLAT_Y - 0.5, cx, R + 0.14, 0.38, ...GOLD, LOOK.METAL);
  sc.cyl(cx, PLAT_Y - 3.2, cx, R * 0.9, 2.2, 0.32, 0.12, 0.4, LOOK.PLASTIC);
  sc.cyl(cx, PLAT_Y - 7, cx, R * 0.55, 2, 0.24, 0.08, 0.3, LOOK.PLASTIC);
  // the edge, and a coin's star in the middle
  out.decals.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: R - 0.1, width: 0.3, color: [1, 0.9, 0.55, 0.75], kind: DECAL.RING });
  out.decals.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: R - 2.6, width: 0.12, color: [1, 0.9, 0.55, 0.22 + 0.06 * Math.sin(now / 600)], kind: DECAL.RING });
  out.decals.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: 3, width: 0.3, color: [1, 0.85, 0.35, 0.4], kind: DECAL.TARGET });
}

export default {
  id: L.MG_COINS, key: 'coins', name: 'COIN RUSH',
  hint: 'GRAB THE COINS  BUMP RIVALS TO KNOCK THEIRS LOOSE  FALL AND LOSE HALF',
  get env() { return env; },

  draw(view, ctx, out) {
    const R = radius(view);
    if (!(R > 0)) return;
    const cx = centre(view);
    const g = view.party();
    const now = ctx.now ?? 0;
    // on the prediction's clock, where your own ball is drawn
    const T = ctx.ptick ?? ctx.tick + (ctx.dt || 0) / TICK;
    const playing = g.state === L.H_PLAY;
    const tp = playing ? since(T, g.start) : 0;
    env = playing && frenzy(tp) ? 'night' : 'sunset';
    table(out, cx, R, now);
    // the bumpers, pinball posts: a red skirt, a band glowing gold while lit (dark while it recharges,
    // blinking its last second back), a white cap; white-hot as it throws
    const H = L.CR_BH;
    for (const b of bumpers(view)) {
      const lit = !playing || tp >= b.litAt;
      const flash = Math.max(0, 1 - (now - (hitAt.get(b.i) ?? -1e9)) / 180);
      const soon = !lit && b.litAt - tp < 125 && Math.sin(now / 60) > 0;
      const pulse = 0.5 + 0.5 * Math.sin(now / 200 + b.i);
      out.scene.cyl(b.x, PLAT_Y + 0.2, b.z, L.CR_BR, 0.2, 0.86, 0.13, 0.12, LOOK.PLASTIC);
      if (lit || soon) out.scene.cyl(b.x, PLAT_Y + 0.4 + (H - 0.6) / 2, b.z, L.CR_BR * 0.9, (H - 0.6) / 2, 1, 0.8 + 0.1 * pulse, 0.3, LOOK.GLOW, 0.9 + 0.5 * pulse + 2 * flash, 0.3);
      else out.scene.cyl(b.x, PLAT_Y + 0.4 + (H - 0.6) / 2, b.z, L.CR_BR * 0.9, (H - 0.6) / 2, 0.3 + 0.7 * flash, 0.08 + 0.7 * flash, 0.1 + 0.7 * flash, flash > 0 ? LOOK.GLOW : LOOK.PLASTIC, 2 * flash);
      out.scene.cyl(b.x, PLAT_Y + H - 0.1, b.z, L.CR_BR, 0.1, 0.96, 0.95, 0.92, LOOK.PLASTIC);
      out.decals.push({ pos: [b.x, PLAT_Y + 0.03, b.z], radius: L.CR_BR + 0.55, width: 0.25, color: lit ? [1, 0.85, 0.3, 0.8] : [0.8, 0.2, 0.15, 0.45], kind: DECAL.RING });
      if (lit && playing) out.glow.push({ pos: [b.x, PLAT_Y + H + 0.5, b.z], size: 1.6 + 0.4 * pulse, color: [1, 0.8, 0.3, 0.3], kind: SPRITE.FLASH, minpx: 1 });
    }
    const night = env === 'night';
    // the jackpot called: a ring where it will erupt, filling as it nears, a beam down on it, the pot over it
    const jp = playing ? jackpot(view, tp) : null;
    if (jp?.called) {
      const left = (jp.at - tp) * TICK;
      const r = L.CR_JACKR0 + L.CR_JACKRK * Math.sqrt(jp.n);
      if (left > 0) {
        const k = 1 - left / (L.CR_JACKW * TICK);
        const beat = 0.5 + 0.5 * Math.sin(now / (160 - 100 * k));
        out.decals.push({ pos: [jp.x, PLAT_Y + 0.04, jp.z], radius: r, width: r, color: [1, 0.82, 0.25, 0.2 + 0.3 * k * beat], kind: DECAL.ZONE });
        out.decals.push({ pos: [jp.x, PLAT_Y + 0.05, jp.z], radius: r * (1 - 0.8 * k) + 0.6, width: 0.3, color: [1, 0.95, 0.6, 0.9], kind: DECAL.RING });
        out.beams.push({ a: [jp.x, PLAT_Y + 60, jp.z], b: [jp.x, PLAT_Y + 0.2, jp.z], width: 0.6 + 0.6 * k, color: [1, 0.85, 0.35, 0.35 + 0.3 * beat] });
        out.solid.push({ pos: [jp.x, PLAT_Y + 4 + 0.3 * Math.sin(now / 300), jp.z], size: 1.3, color: [1, 0.85, 0.25, 1], kind: SPRITE.COIN, minpx: 2, roll: now / 150 });
        out.glow.push({ pos: [jp.x, PLAT_Y + 4, jp.z], size: 3.5 + beat, color: [1, 0.8, 0.3, 0.45], kind: SPRITE.FLASH, minpx: 1 });
      } else if (left > -1) {
        out.glow.push({ pos: [jp.x, PLAT_Y + 1, jp.z], size: r * (1 + left), color: [1, 0.85, 0.4, 0.5 * (1 + left)], kind: SPRITE.FLASH, minpx: 1 });
      }
    }
    // the coins
    const me = ctx.pme && !ctx.pme.out ? ctx.pme : null;
    for (const [key, until] of ghosts) if (view.tick > until) ghosts.delete(key);
    for (const k of coins(view)) {
      if (T < k.t0 || T >= k.gone) continue;
      const key = `${k.c}:${k.t0}`;
      if (me && !ghosts.has(key) && reaches(k, Math.floor(T), me.pos[0], me.pos[1], me.pos[2], me.radius)) ghosts.set(key, Math.ceil(T) + 30);
      if (ghosts.has(key)) continue;
      // the last two seconds it blinks, faster as it goes
      const left = (k.gone - T) * TICK;
      if (left < 2 && Math.sin(now / (40 + 60 * left)) < -0.2) continue;
      const big = k.v >= L.CR_BIGV;
      const r = big ? BIG_R : COIN_R;
      const p = coinAt(k, T);
      const lying = T - k.t0 >= k.air;
      if (lying) p[1] += r - L.CR_CY + 0.12 + 0.07 * Math.sin(now / 280 + k.c);
      out.solid.push({ pos: p, size: r, color: big ? [1, 0.9, 0.42, 1] : [1, 0.78, 0.2, 1], kind: SPRITE.COIN, minpx: 1.5, roll: k.c * 0.77 });
      // big ones shine; at night (the frenzy) every one does
      if (big || night) out.glow.push({ pos: p, size: big ? 1.3 : 0.9, color: [1, 0.85, 0.35, big ? 0.3 : 0.25], kind: SPRITE.FLASH, minpx: 1 });
      if (!lying) {
        // its shadow, and a ring where it will land, closing in as it comes down
        out.casters.push([p[0], p[1], p[2], -r * 1.2]);
        const u = (T - k.t0) / k.air;
        if (k.kind === L.CR_KRAIN) out.decals.push({ pos: [k.x, PLAT_Y + 0.03, k.z], radius: 0.5 + 0.8 * (1 - u), width: 0.14, color: [1, 0.85, 0.3, 0.25 + 0.5 * u], kind: DECAL.RING });
      }
    }
  },

  frame(view) {
    const R = radius(view) || view.party().size;
    const cx = centre(view);
    return { centre: [cx, PLAT_Y, cx], radius: R, shape: 'disc' };
  },

  fx(f, ctx) {
    const mine = f.owner === ctx.slot;
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    if (f.kind === L.CR_FX_TAKE) {
      if (f.shot >= L.CR_MAX) {
        // a lit bumper's pay
        ctx.glow?.({ pos: f.pos, size: 3, color: [1, 0.85, 0.3, 0.9], kind: SPRITE.FLASH, life: 350, grow: true });
        if (mine) { ctx.sound?.kill?.(); ctx.banner?.(`+${f.size} BUMPER`, C.YELLOW, 700); }
        return;
      }
      const big = f.size >= L.CR_BIGV;
      ctx.glow?.({ pos: f.pos, size: big ? 1.6 : 0.9, color: [1, 0.9, 0.4, 0.9], kind: SPRITE.SPARK, life: 260 });
      if (big) ctx.glow?.({ pos: f.pos, size: 2.2, color: [1, 0.85, 0.3, 0.6], kind: SPRITE.RING, life: 400, grow: true });
      if (mine) { if (big) ctx.sound?.kill?.(); else ctx.sound?.pickup?.(); }
      return;
    }
    if (f.kind === L.CR_FX_LOSE) {
      const fall = f.size > 0.5;
      ctx.glow?.({ pos: f.pos, size: fall ? 3 : 2, color: [1, 0.8, 0.3, 0.8], kind: SPRITE.RING, life: 450, grow: true });
      if (mine) ctx.banner?.(fall ? `FELL  -${f.shot} COINS` : `-${f.shot} ${f.shot === 1 ? 'COIN' : 'COINS'}`, C.RED, fall ? 1800 : 900);
      else if (fall && f.shot >= 10) ctx.feed?.(`${ctx.name?.(f.owner) ?? `P${f.owner + 1}`} SPILLED ${f.shot} COINS`, C.YELLOW);
      if (mine || d < 20) ctx.sound?.land?.(fall ? 30 : 18);
      return;
    }
    if (f.kind === L.CR_FX_CALL) {
      if (f.shot === 0) { ctx.banner?.('JACKPOT CALLED  GET TO THE BEAM', C.YELLOW, 1800); ctx.sound?.count?.(1); }
      else if (f.shot === 1) {
        ctx.banner?.('JACKPOT!', C.YELLOW, 1200);
        ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 8, color: [1, 0.85, 0.35, 0.9], kind: SPRITE.FLASH, life: 600, grow: true });
        if (d < 40) ctx.sound?.blast?.(d, 4);
        ctx.sound?.holed?.();
      } else if (f.shot === 2) { ctx.banner?.('COIN FRENZY!  DOUBLE RAIN', C.ORANGE, 2200); ctx.sound?.holed?.(); }
      return;
    }
    if (f.kind === L.CR_FX_BUMP) {
      hitAt.set(f.shot, ctx.now ?? performance.now());
      ctx.glow?.({ pos: f.pos, size: 1.8, color: [1, 0.95, 0.7, 0.9], kind: SPRITE.RING, life: 260, grow: true });
      ctx.sound?.boing?.(Math.max(6, f.size), mine ? 0 : d);
    }
  },

  // the jackpot and the frenzy on the clock, and where you stand
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const tp = typeof ctx.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
    const jp = jackpot(view, tp);
    if (jp) {
      const left = (jp.at - tp) * TICK;
      if (jp.called && left > 0) ctx.right(3, `JACKPOT IN ${left.toFixed(1)}`, C.YELLOW);
      else if (left > 0) ctx.right(3, `NEXT JACKPOT ${Math.ceil(left)}`, C.GREY);
    }
    if (frenzy(tp)) ctx.right(4, 'COIN FRENZY', Math.floor(ctx.now / 250) % 2 ? C.ORANGE : C.YELLOW);
    else ctx.right(4, `FRENZY IN ${Math.ceil((L.CR_FRENZY - tp) * TICK)}`, C.GREY);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (me?.live) {
      let place = 1, n = 0;
      for (let p = 0; p < L.NPLAYER; p++) {
        const a = L.PLAYERS + p * L.PSIZE;
        if (!(view.u8[a + L.P_FL] & L.PF_LIVE)) continue;
        n++;
        if (view.dv.getUint16(a + L.PG_SCORE, true) > me.score) place++;
      }
      ctx.right(5, `${ordinal(place)} OF ${n}`, place === 1 ? C.GREEN : C.WHITE);
    }
  },

  brain: {
    // off the rim is the sea, its last 2.5 m a warning; a bumper throws you about
    danger(view, x, z) {
      const w = fieldOf(view);
      const dx = x - w.cx, dz = z - w.cx, d2 = dx * dx + dz * dz;
      if (d2 >= w.R * w.R) return 1;
      const e = w.R - Math.sqrt(d2);
      let d = e < 2.5 ? 0.5 * (2.5 - e) / 2.5 : 0;
      if (d2 < w.ring2) for (const b of w.bumpers) if ((x - b.x) ** 2 + (z - b.z) ** 2 < (L.CR_BR + 1.1) ** 2) d = Math.max(d, 0.12);
      return d;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot);
      return p ? p.goal : null;
    },
    hop() { return false; },
    // The whole word: the disc is round and flat, so the ball steers straight
    // for what it's after (through a coin at full speed, up to one by the rim
    // slow enough to stop short of it), kept off the rim by where it would
    // coast to.
    think(view, me, bot) {
      const p = plan(view, me, bot);
      return p ? steer(p, fieldOf(view)) : null;
    },
  },
};

// ---- the AI ball

const MINDS = new WeakMap();
const SLOT_MINDS = [];
const mindOf = (bot, slot) => {
  if (bot && typeof bot === 'object') { let m = MINDS.get(bot); if (!m) MINDS.set(bot, (m = {})); return m; }
  return (SLOT_MINDS[slot] ||= {});
};
// a number in [0, 1) that is this ball's own: how keen it is to ram
const keen = (slot) => (((slot + 1) * 2654435761) >>> 0) / 2 ** 32;
const CELL = 8, GN = 16; // the brain's grids: 8 m cells over 128 m round the stage's centre
// what a plan is after: a coin (its record and throw), a bumper, the jackpot, a rival
const COIN = 0, BUMPER = 1, JACK = 2, RAM = 3;

// What every AI ball looking at one world tick shares: the stage, the coins
// and the balls in, each in a grid of CELL m squares (head per cell, a link
// per entry), each coin with how far in from the rim it lies.
function fieldOf(view) {
  if (view._crf?.tick === view.tick) return view._crf;
  const R = radius(view), cx = centre(view), o = cx - (GN * CELL) / 2;
  const cell = (x, z) => {
    const i = Math.floor((x - o) / CELL), j = Math.floor((z - o) / CELL);
    return i < 0 || j < 0 || i >= GN || j >= GN ? -1 : j * GN + i;
  };
  const list = coins(view);
  const coinHead = new Int32Array(GN * GN).fill(-1), coinNext = new Int32Array(list.length);
  list.forEach((k, n) => {
    k.inside = R - Math.hypot(k.x - cx, k.z - cx);
    k.key = k.t0 * L.CR_MAX + k.c;
    const c = cell(k.x, k.z);
    coinNext[n] = -1;
    if (c >= 0) { coinNext[n] = coinHead[c]; coinHead[c] = n; }
  });
  const balls = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    balls.push({ slot: p, x: view.dv.getFloat32(b + L.P_PX, true), z: view.dv.getFloat32(b + L.P_PZ, true), vx: view.dv.getFloat32(b + L.P_VX, true),
      vz: view.dv.getFloat32(b + L.P_VZ, true), score: view.dv.getUint16(b + L.PG_SCORE, true) });
  }
  const ballHead = new Int32Array(GN * GN).fill(-1), ballNext = new Int32Array(balls.length);
  balls.forEach((b, n) => { const c = cell(b.x, b.z); ballNext[n] = -1; if (c >= 0) { ballNext[n] = ballHead[c]; ballHead[c] = n; } });
  const bs = bumpers(view);
  const ring = R * L.CR_BRING + L.CR_BR + 1.2;
  const most = balls.reduce((m, b) => Math.max(m, b.score), 0);
  view._crf = { tick: view.tick, R, cx, o, list, coinHead, coinNext, balls, ballHead, ballNext, bumpers: bs, ring2: ring * ring, most };
  return view._crf;
}
// Calls fn(entry) for every entry of a grid in the cells within r of (x, z).
function around(w, head, next, items, x, z, r, fn) {
  const i0 = Math.max(0, Math.floor((x - r - w.o) / CELL)), i1 = Math.min(GN - 1, Math.floor((x + r - w.o) / CELL));
  const j0 = Math.max(0, Math.floor((z - r - w.o) / CELL)), j1 = Math.min(GN - 1, Math.floor((z + r - w.o) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let n = head[j * GN + i]; n >= 0; n = next[n]) fn(items[n]);
}

// What the ball goes for, thought again every 4th tick: a coin it can reach
// before it goes (and not much before it's anyone's), a lit bumper, the
// jackpot once called, and (a keen ball) a rival with coins to knock loose
// near by; worth over the time to get there, less near the rim, less for
// every rival nearer it. It keeps what it's after unless something is
// clearly better. { goal [x, z], pos, vel, edge (how far in from the rim the goal is), ram } or null.
const top = []; // the best 6 of a think, best first (bots think one at a time)
function plan(view, me, bot) {
  const slot = typeof me === 'number' ? me : me?.slot;
  const g = view.party();
  if (g.state !== L.H_PLAY || !(slot >= 0)) return null;
  const b = L.PLAYERS + slot * L.PSIZE;
  if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) return null;
  const mind = mindOf(bot, slot);
  const t = bot?.at ?? view.tick;
  if (mind.at === t && mind.round === g.round) return mind.plan;
  const w = fieldOf(view);
  const { R, cx } = w;
  const x0 = bot?.pos?.[0] ?? view.dv.getFloat32(b + L.P_PX, true), z0 = bot?.pos?.[1] ?? view.dv.getFloat32(b + L.P_PZ, true);
  const vx = bot?.vel?.[0] ?? view.dv.getFloat32(b + L.P_VX, true), vz = bot?.vel?.[1] ?? view.dv.getFloat32(b + L.P_VZ, true);
  const sp = Math.hypot(vx, vz), ux = sp > 1 ? vx / sp : 0, uz = sp > 1 ? vz / sp : 0, turnK = Math.min(1, sp / 8) * 0.35;
  const skill = bot?.skill ?? 0.6;
  const slow = 0.1 + 0.3 * (1 - skill);
  const tp = (t - g.start) | 0;
  // the time to get to (x, z): rolling at ~9 m/s, a turn costing a little, more for the clumsy
  const eta = (x, z) => {
    const dx = x - x0, dz = z - z0, d = Math.sqrt(dx * dx + dz * dz);
    return d / 9 + (d > 0.5 ? (1 - (dx * ux + dz * uz) / d) * turnK : 0) + slow;
  };
  top.length = 0;
  const consider = (x, z, s, kind, key, edge) => {
    if (top.length === 6 && s <= top[5].s) return;
    let k = top.length;
    while (k > 0 && top[k - 1].s < s) k--;
    top.splice(k, 0, { x, z, s, kind, key, edge });
    if (top.length > 6) top.pop();
  };
  const coin = (k) => {
    let e = eta(k.x, k.z);
    const at = t + e / TICK;
    if (at > k.gone - 20) return;
    if (at < k.ready) e += (k.ready - at) * TICK * 0.8;
    if (e > 6) return;
    consider(k.x, k.z, k.v / (e + 0.35) * (k.inside < 3 ? 0.75 : 1), COIN, k.key, k.inside);
  };
  // many coins: the near ones (and further round if that finds too few)
  if (w.list.length > 48) {
    around(w, w.coinHead, w.coinNext, w.list, x0, z0, CELL, coin);
    if (top.length < 3) around(w, w.coinHead, w.coinNext, w.list, x0, z0, 3 * CELL, coin);
  } else for (const k of w.list) coin(k);
  for (const bp of w.bumpers) {
    if (tp < bp.litAt) continue;
    const dx = bp.x - x0, dz = bp.z - z0, d = Math.hypot(dx, dz) || 1;
    // the near side of it
    const ex = bp.x - dx / d * (L.CR_BR + 0.6), ez = bp.z - dz / d * (L.CR_BR + 0.6);
    consider(ex, ez, L.CR_BPAY * 0.8 / (eta(ex, ez) + 0.35), BUMPER, bp.i, R);
  }
  const jp = jackpot(view, tp);
  if (jp?.called && jp.at > tp) {
    const e = Math.max(eta(jp.x, jp.z), (jp.at - tp) * TICK + 0.3);
    consider(jp.x, jp.z, jp.n * 0.35 / (e + 0.35), JACK, jp.j, R);
  }
  // a keen ball rams a rival worth it (5 coins or more, the leader more so) when it's on it already:
  // near, nearly ahead and itself rolling hard (only a hard bump knocks coins loose); never by the
  // rim, where it would go over itself. A chase from a standstill costs more than it knocks loose.
  const k0 = keen(slot) * skill;
  if (k0 > 0.25 && sp > 5) {
    around(w, w.ballHead, w.ballNext, w.balls, x0, z0, 7, (o) => {
      if (o.slot === slot || o.score < 5) return;
      const dx = o.x - x0, dz = o.z - z0, d = Math.sqrt(dx * dx + dz * dz);
      if (d > 7 || d < 0.5 || (dx * ux + dz * uz) / d < 0.6 || R - Math.hypot(o.x - cx, o.z - cx) < 5) return;
      const lead = d / 10;
      const ax = o.x + o.vx * lead, az = o.z + o.vz * lead;
      const worth = Math.min(3, o.score) * (o.score >= w.most ? 1.5 : 1);
      consider(ax, az, worth * k0 * 0.5 / (eta(ax, az) + 0.35), RAM, o.slot, R);
    });
  }
  let best = null;
  // each marked down for every rival nearer it (within 10 m of it) than this ball is
  for (const k of top) {
    if (k.kind !== RAM) {
      const r = Math.min(10, Math.hypot(k.x - x0, k.z - z0) * 0.85), r2 = r * r;
      let closer = 0;
      around(w, w.ballHead, w.ballNext, w.balls, k.x, k.z, r, (o) => { if (o.slot !== slot && (o.x - k.x) ** 2 + (o.z - k.z) ** 2 < r2) closer++; });
      k.s /= 1 + (k.kind === JACK ? 0.08 : 1.2) * closer;
    }
    if (k.kind === mind.kind && k.key === mind.key) k.s *= 1.3 + 0.7 * (1 - skill); // what it's after already (a clumsy ball hangs on)
    if (!best || k.s > best.s) best = k;
  }
  mind.at = t;
  mind.round = g.round;
  mind.kind = best?.kind;
  mind.key = best?.key;
  mind.plan = best
    ? { goal: [best.x, best.z], pos: [x0, z0], vel: [vx, vz], edge: best.edge, ram: best.kind === RAM, slot, skill }
    : { goal: [cx, cx], pos: [x0, z0], vel: [vx, vz], edge: R, ram: false, slot, skill };
  return mind.plan;
}

// Keys for the velocity that gets the ball to its goal: flat out, but slow
// enough near the rim to stop 2 m short of it past the goal; the rim held off
// by an inward pull as soon as where it would coast to (0.7 s on, for a
// skilled ball; a clumsy one looks less far) is near it. No keys (the brake)
// when it's already going as it wants to.
const ACC = 9; // m/s^2 a ball turns its velocity by, about
function steer(p, w) {
  const dx = p.goal[0] - p.pos[0], dz = p.goal[1] - p.pos[1], d = Math.hypot(dx, dz);
  const room = Math.max(0, p.edge - 2);
  const want = p.ram ? 12 : Math.min(10, Math.sqrt(2 * ACC * (d + room)));
  let wx = d > 1e-6 ? (dx / d) * want : 0, wz = d > 1e-6 ? (dz / d) * want : 0;
  const ahead = 0.3 + 0.45 * p.skill;
  const fx = p.pos[0] + p.vel[0] * ahead - w.cx, fz = p.pos[1] + p.vel[1] * ahead - w.cx, f = Math.hypot(fx, fz);
  const over = f - (w.R - 1.5 - 1.5 * p.skill);
  if (over > 0 && f > 1e-6) { wx -= (fx / f) * over * 4; wz -= (fz / f) * over * 4; }
  const ax = wx - p.vel[0], az = wz - p.vel[1];
  if (Math.hypot(ax, az) < 0.6) return { yaw: Math.atan2(p.vel[1], p.vel[0]), move: 0, hop: 0, use: 0 };
  return { yaw: Math.atan2(az, ax), move: 1, hop: 0, use: 0 };
}
