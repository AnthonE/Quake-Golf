// HOT POTATO, as drawn and as the AI ball sees it. A round wooden stage with
// a red trim; a big bomb hangs high over the middle, its fuse the wave's.
// Every holder's rider has a bomb in its right hand (out to the side, never
// between the chase camera and the ball), heating red and blinking faster as
// the fuse runs down, a red ring round the ball and under it, and in the last
// two seconds the blast's reach on the floor; the balls picked for the next
// wave carry an unlit one. A wave going off leaves a fireball
// and a scorch where each holder stood, then the edge goes red and falls in,
// piece by piece, to the next wave's radius. The schedule (src/mg/potato.wat)
// is in the header, so it is worked here as the sim works it; who holds a
// bomb is read off each ball's record, the confirmed world's.
import * as L from '../../src/layout.mjs';
import { PLAT_Y, B_RAD } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL, COLS } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const TICK = 0.008;
const HH = 1; // the stage's half height, m
const SIGN = 22; // m over the floor, the big bomb: over the chase camera's view, there from the title card's
const FALL_G = 30; // m/s^2 a piece of the edge falls at
const LIFE = 1.3; // s a piece is drawn falling
const PIECE = 2.4; // m along the edge a piece
const FLOOR = [0.84, 0.58, 0.34];
const TRIM = [0.66, 0.12, 0.08];
const HOT = [0.95, 0.2, 0.08];
const BOMB = [0.13, 0.12, 0.15];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---- the schedule, as the sim's header has it

// The wave and the edge on the view's bank.
export function sched(view) {
  const dv = view.dv, o = view.bank || 0;
  const u = (k) => dv.getUint32(L.PG_H + k + o, true), h = (k) => dv.getFloat32(L.PG_H + k + o, true);
  return { rad: h(L.HP_RAD), rnext: h(L.HP_RNEXT), wave: u(L.HP_WAVE), deal: u(L.HP_DEAL), boom: u(L.HP_BOOM), last: u(L.HP_LAST),
    bombs: u(L.HP_BOMBS), fuse: u(L.HP_FUSE), cx: dv.getFloat32(L.PG_CX + o, true) };
}
// The edge's radius on tick t into play ($hp_rim, in f32 for a whole tick; a fraction for drawing).
export function rimAt(s, t) {
  const a = s.last + L.HP_SHRINK0, b = s.deal;
  if (t >= b) return s.rnext;
  if (t <= a) return s.rad;
  return Number.isInteger(t) ? f(f(f(s.rnext - s.rad) * f(f(t - a) / f(b - a))) + s.rad) : s.rad + (s.rnext - s.rad) * (t - a) / (b - a);
}
// The tick into play the edge comes in to radius r, between the boom's hold and the deal.
const rimWhen = (s, r) => s.last + L.HP_SHRINK0 + (s.rad - r) / Math.max(1e-6, s.rad - s.rnext) * (s.deal - s.last - L.HP_SHRINK0);
const rec = (view, p) => L.PLAYERS + (view.bank || 0) + p * L.PSIZE;
// Does slot p hold a bomb ($hp_holds: in the room, not out)?
export const holds = (view, p) => (view.u8[rec(view, p) + L.HP_FL] & L.HP_HOLD) !== 0 && (view.u8[rec(view, p) + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) === L.PF_LIVE;
// Is slot p picked for the next deal (tick t into play, still before it)? PG_S is the confirmed world's.
export const picked = (view, s, p, t) => t < s.deal && view.u8[L.PG_S + L.HP_NEXT + p] === s.wave + 1;
// Ticks into play slot p's bomb sticks till (it can't pass it on before).
export const freeAt = (view, p) => view.dv.getUint16(rec(view, p) + L.HP_AT, true) + L.HP_COOL;

// Ticks into play to draw at (fractional; the prediction's clock if given), -1 before play; frozen where the round ended.
function playTime(view, g, ctx) {
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.pt === 'number' && ctx.pt > 0 ? ctx.pt / TICK : typeof ctx?.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}
const luck = (a, b) => { let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b + 7, 0x165667b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 2 ** 32; };

// ---- the AI ball

const SCRATCH = { slot: -1, tick: -1, threats: [] };
// What every AI ball looking at one world tick shares: the schedule, the
// clock, every ball in (where, how fast, whether it holds a bomb or is
// picked for one, when its bomb frees).
function worldOf(view) {
  const o = view.bank || 0;
  const w0 = view._hp;
  if (w0 && w0.tick === view.tick && w0.bank === o) return w0;
  const dv = view.dv, u8 = view.u8;
  const s = sched(view);
  const state = dv.getUint32(L.HDR_STATE + o, true);
  const start = dv.getUint32(L.HDR_START + o, true);
  const t = state === L.H_PLAY ? (view.tick - start) | 0 : 0;
  const balls = [], bySlot = new Array(L.NPLAYER).fill(null), threats = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + o + p * L.PSIZE;
    if ((u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const hold = (u8[a + L.HP_FL] & L.HP_HOLD) !== 0;
    const b = { slot: p, x: dv.getFloat32(a + L.P_PX, true), z: dv.getFloat32(a + L.P_PZ, true), vx: dv.getFloat32(a + L.P_VX, true), vz: dv.getFloat32(a + L.P_VZ, true),
      hold, pick: !hold && picked(view, s, p, t), free: hold ? dv.getUint16(a + L.HP_AT, true) + L.HP_COOL : 0 };
    balls.push(b);
    bySlot[p] = b;
    if (b.hold || b.pick) threats.push(b);
  }
  view._hp = { tick: view.tick, bank: o, s, t, start, state, balls, bySlot, threats };
  return view._hp;
}
const slotOf = (me) => (typeof me === 'number' ? me : me?.slot);

// The threats within 24 m of (x, z), for danger to look through.
function near(w, x, z) {
  const out = [];
  for (const h of w.threats) if (Math.abs(h.x - x) < 24 && Math.abs(h.z - z) < 24) out.push(h);
  return out;
}

// A holder (or a ball whose bomb comes in a moment) goes for the nearest
// ball without one, where it will be, kept from the edge; a ball's push for
// the velocity that gets there at full tilt.
function chase(view, w, mine, bot, tick) {
  const s = w.s, cx = s.cx;
  const lag = Math.max(0, Math.min(40, (tick - view.tick) | 0)) * TICK;
  const mx = bot?.pos?.[0] ?? mine.x + mine.vx * lag, mz = bot?.pos?.[1] ?? mine.z + mine.vz * lag;
  const vx = bot?.vel?.[0] ?? mine.vx, vz = bot?.vel?.[1] ?? mine.vz;
  const mem = bot?.mem || {};
  let best = null, score = Infinity;
  for (const b of w.balls) {
    if (b.hold || b.pick || b.slot === mine.slot) continue;
    const bx = b.x + b.vx * lag, bz = b.z + b.vz * lag;
    const d = Math.hypot(bx - mx, bz - mz);
    // closing on it: its speed away from me counts against it
    const away = d > 0.1 ? ((bx - mx) * b.vx + (bz - mz) * b.vz) / d : 0;
    const sc = d / 11 + Math.max(0, away) * 0.06 - (mem.hpTarget === b.slot ? 0.35 : 0);
    if (sc < score) { score = sc; best = { b, bx, bz, d }; }
  }
  if (!best) return null;
  mem.hpTarget = best.b.slot;
  const T = Math.min(1, best.d / 12);
  let ax = best.bx + best.b.vx * T, az = best.bz + best.b.vz * T;
  if (best.d < 3) { ax = best.bx; az = best.bz; }
  // not past the edge as it will be
  const R = rimAt(s, Math.max(0, w.t + Math.round(lag / TICK) + 60)) - 1.6;
  const ar = Math.hypot(ax - cx, az - cx);
  if (ar > R) { ax = cx + (ax - cx) * R / ar; az = cx + (az - cx) * R / ar; }
  // the velocity it wants: flat out at it, but never rolling outward faster
  // than it could stop before the edge; the push is what it lacks of that
  const mr = Math.hypot(mx - cx, mz - cx) || 1e-6;
  const nx = (mx - cx) / mr, nz = (mz - cx) / mr;
  const dx = ax - mx, dz = az - mz, dd = Math.hypot(dx, dz) || 1;
  let ux = (dx / dd) * 13, uz = (dz / dd) * 13;
  const cap = Math.sqrt(2 * 7 * Math.max(0, R + 0.4 - mr)), out = ux * nx + uz * nz;
  if (out > cap) { ux -= nx * (out - cap); uz -= nz * (out - cap); }
  const wx = ux - vx, wz = uz - vz;
  const skill = bot?.skill ?? 0.6;
  const err = (luck(mine.slot * 131 + (tick >> 6), w.s.wave) - 0.5) * 0.5 * (1 - skill);
  return { yaw: Math.atan2(wz, wx) + err, move: 1, hop: 0, use: 0 }; // radians, as the planner reads a yaw under 2 pi
}

export default {
  id: L.MG_POTATO, key: 'potato', name: 'HOT POTATO',
  hint: 'BUMP SOMEONE TO PASS THE BOMB ON  DON\'T HOLD IT WHEN IT BLOWS',
  env: 'sunset',

  draw(view, ctx, out) {
    const s = sched(view);
    if (!(s.rad > 0)) return;
    const g = view.party();
    const tp = playTime(view, g, ctx);
    const tt = Math.max(0, tp);
    const sc = out.scene, cx = s.cx;
    const now = (ctx?.now ?? 0) / 1000;
    const R = rimAt(s, tt);
    // the stage, and through a fall the ring going in pieces
    const ring = tp >= 0 && s.rnext < s.rad - 1e-3 && tt < s.deal + LIFE / TICK;
    const inner = ring ? s.rnext : R;
    sc.cyl(cx, PLAT_Y - HH, cx, inner, HH, ...FLOOR, LOOK.WOOD, 0.6);
    sc.cyl(cx, PLAT_Y - HH - 0.3, cx, inner + 0.3, HH, ...TRIM, LOOK.PLASTIC);
    if (ring) {
      const bands = Math.max(1, Math.round((s.rad - s.rnext) / 2.2)), bw = (s.rad - s.rnext) / bands;
      for (let k = 0; k < bands; k++) {
        const r0 = s.rnext + k * bw, r1 = r0 + bw, rc = (r0 + r1) / 2;
        const n = Math.max(12, Math.ceil((2 * Math.PI * rc) / PIECE));
        // a piece goes as the edge reaches its outer side, a little before the sim lets go of a ball on its middle
        const go0 = rimWhen(s, r1 - 0.2);
        for (let j = 0; j < n; j++) {
          const a = ((j + (k & 1) * 0.5) / n) * 2 * Math.PI;
          const x = cx + Math.cos(a) * rc, z = cx + Math.sin(a) * rc;
          const ht = (Math.PI * rc) / n * 1.06, hr = bw / 2;
          const go = go0 + (luck(j, k) - 0.5) * 16;
          if (tt < go) {
            const warn = clamp01(1 - (go - tt) / 110);
            const shake = warn > 0.5 ? 0.05 * Math.sin(tt * 2.7 + j * 5.3) : 0;
            const m = 0.45 + 0.45 * warn * (0.6 + 0.4 * Math.sin(tt * 0.35 + j));
            sc.box(x + shake, PLAT_Y - HH, z, hr, HH, ht, a, ...FLOOR.map((v, i) => v + (HOT[i] - v) * m), LOOK.WOOD, 0.6);
          } else {
            const age = (tt - go) * TICK;
            if (age < LIFE) sc.box(x, PLAT_Y - HH - 0.5 * FALL_G * age * age, z, hr, HH, ht, a + age * (luck(k, j) - 0.5) * 3,
              ...HOT, LOOK.WOOD, 0.6, 0, 1 - age / LIFE);
          }
        }
      }
    }
    // the big bomb over the middle: the wave's fuse
    const lit = tp >= 0 && tt >= s.deal && tt < s.boom;
    const heat = lit ? clamp01((tt - s.deal) / Math.max(1, s.fuse)) : 0;
    out.solid.push({ pos: [cx, PLAT_Y + SIGN, cx], size: 2.6, color: [...BOMB, 1], kind: SPRITE.BOMB, minpx: 4, roll: heat * 0.6 });
    out.casters?.push([cx, PLAT_Y + SIGN, cx, -1.9]);
    if (lit) out.glow.push({ pos: [cx, PLAT_Y + SIGN + 3, cx], size: 2.2 + 2.6 * heat, color: [1, 0.65, 0.25, 0.3 + 0.3 * heat], kind: SPRITE.FLASH });
    // the balls with bombs, and those picked for the next
    const dvb = view.dv, u8 = view.u8;
    const mine = ctx?.pme && !ctx.pme.out ? ctx.pme : null;
    const dtp = mine && ctx.ptick !== undefined && ctx.pview ? (ctx.ptick - ctx.pview.tick) * TICK : 0;
    const last = tp >= 0 && tt < s.boom && s.boom - tt < 250;
    const pulse = 0.5 + 0.5 * Math.sin(now * (6 + 18 * heat));
    const dt = ctx?.dt || 0;
    // the fireballs dimmer the more went off at once, so a crowd's boom doesn't white the screen out
    const boomAt = (g.start + s.last) | 0, age = (tt - s.last) * TICK;
    let blown = 0;
    if (tp >= 0 && s.wave > 0 && age < 0.9) {
      for (let p = 0; p < L.NPLAYER; p++) {
        const a = L.PLAYERS + p * L.PSIZE;
        if ((u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) === (L.PF_LIVE | L.PF_DEAD) && (dvb.getUint32(a + L.B_OUTAT, true) | 0) === boomAt) blown++;
      }
    }
    const fire = Math.min(1, 6 / Math.max(1, blown));
    for (let p = 0; p < L.NPLAYER; p++) {
      const a = L.PLAYERS + p * L.PSIZE;
      const fl = u8[a + L.P_FL];
      if ((fl & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) {
        // where a holder went off at the last boom: a fireball, then a scorch
        if ((fl & L.PF_LIVE) && tp >= 0 && s.wave > 0 && (dvb.getUint32(a + L.B_OUTAT, true) | 0) === boomAt) {
          const x = dvb.getFloat32(a + L.P_PX, true), y = dvb.getFloat32(a + L.P_PY, true), z = dvb.getFloat32(a + L.P_PZ, true);
          if (y > PLAT_Y - 0.5 && Math.hypot(x - cx, z - cx) < R - 0.5) sc.cyl(x, PLAT_Y + 0.012, z, 1.3, 0.01, 0.07, 0.05, 0.05, LOOK.MATTE, 0, 0, 0.45);
          if (age < 0.8) {
            const k = clamp01(age / 0.2);
            out.glow.push({ pos: [x, y + 1.2 + age * 2.5, z], size: 1.5 + 3 * k, color: [1, 0.5, 0.12, (1 - age / 0.8) * fire], kind: SPRITE.FLASH, minpx: 2 });
          }
        }
        continue;
      }
      const hold = (u8[a + L.HP_FL] & L.HP_HOLD) !== 0;
      const pick = !hold && (tp < 0 ? u8[L.PG_S + L.HP_NEXT + p] === 1 : picked(view, s, p, tt));
      if (!hold && !pick) continue;
      let x, y, z;
      if (mine && p === ctx.slot) { x = mine.pos[0] + mine.vel[0] * dtp; y = mine.pos[1] + mine.vel[1] * dtp; z = mine.pos[2] + mine.vel[2] * dtp; }
      else {
        x = dvb.getFloat32(a + L.P_PX, true) + dvb.getFloat32(a + L.P_VX, true) * dt;
        y = dvb.getFloat32(a + L.P_PY, true) + dvb.getFloat32(a + L.P_VY, true) * dt;
        z = dvb.getFloat32(a + L.P_PZ, true) + dvb.getFloat32(a + L.P_VZ, true) * dt;
      }
      const r = dvb.getUint16(a + L.B_MEGA, true) ? 1.6 : B_RAD;
      // in the rider's right hand, out to its side: never between the chase camera and the ball
      const yaw = mine && p === ctx.slot ? mine.yaw : ((dvb.getUint32(a + L.P_IN, true) & 0x3fff) / 16384) * 2 * Math.PI;
      const hx = x - Math.sin(yaw) * 0.62, hz = z + Math.cos(yaw) * 0.62;
      if (hold) {
        const stuck = tt < dvb.getUint16(a + L.HP_AT, true) + L.HP_COOL;
        const hy = y + 2 * r + 0.42 + (stuck ? 0.06 * Math.sin(now * 40) : 0);
        out.solid.push({ pos: [hx, hy, hz], size: 0.4, color: [...BOMB, 1], kind: SPRITE.BOMB, minpx: 2.5, roll: heat });
        out.casters?.push([hx, hy, hz, -0.3]);
        out.glow.push({ pos: [x, y + r, z], size: r * 1.45, color: [1, 0.3, 0.1, 0.3 + 0.3 * pulse], kind: SPRITE.RING, minpx: 1 });
        if (stuck) out.glow.push({ pos: [hx, hy, hz], size: 0.9, color: [1, 1, 1, 0.5], kind: SPRITE.SPARK, minpx: 1 });
        if (y > PLAT_Y - 0.5) {
          out.decals.push({ pos: [x, PLAT_Y + 0.02, z], radius: 1.75, width: 0.35, color: [1, 0.3, 0.08, 0.75], kind: DECAL.RING });
          if (last) out.decals.push({ pos: [x, PLAT_Y + 0.02, z], radius: L.HP_BLAST_R, width: 0.25, color: [1, 0.15, 0.05, 0.25 + 0.5 * pulse], kind: DECAL.RING });
        }
      } else {
        // picked for the next wave: an unlit bomb, bobbing, and an orange ring
        out.solid.push({ pos: [hx, y + 2 * r + 0.5 + 0.12 * Math.sin(now * 5 + p), hz], size: 0.32, color: [0.32, 0.3, 0.34, 1], kind: SPRITE.BOMB, minpx: 2, roll: 0 });
        if (y > PLAT_Y - 0.5) out.decals.push({ pos: [x, PLAT_Y + 0.02, z], radius: 1.7, width: 0.2, color: [1, 0.6, 0.1, 0.35 + 0.3 * Math.sin(now * 6)], kind: DECAL.RING });
      }
    }
  },

  // the stage as the edge stands now
  frame(view) {
    const s = sched(view);
    const g = view.party();
    const t = g.state === L.H_PLAY ? Math.max(0, g.t) : 0;
    return { centre: [s.cx || g.cx, PLAT_Y, s.cx || g.cx], radius: (s.rad > 0 ? rimAt(s, t) : g.size) + 0.3, shape: 'disc' };
  },

  fx(fx, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(fx.pos) : ctx.dist ?? 0;
    if (fx.kind === L.HP_FX_PASS) {
      ctx.glow?.({ pos: fx.pos, size: 1.6, color: [1, 0.6, 0.2, 0.9], kind: SPRITE.SPARK, life: 300 });
      ctx.glow?.({ pos: fx.pos, size: 2.2, color: [1, 0.4, 0.1, 0.7], kind: SPRITE.RING, life: 350, grow: true });
      if (fx.owner === ctx.slot) {
        ctx.banner?.(`P${fx.shot + 1} GAVE YOU THE BOMB!`, C.RED, 1400);
        ctx.sound?.hurt?.(false);
      } else if (fx.shot === ctx.slot) {
        ctx.banner?.(`PASSED TO P${fx.owner + 1}!`, C.GREEN, 1100);
        ctx.sound?.pickup?.();
      }
      if (d < 30) ctx.sound?.crackle?.(Math.min(1.5, 12 / (d + 8)));
    } else if (fx.kind === L.HP_FX_BOOM) {
      ctx.banner?.(fx.shot ? `BOOM!  ${fx.shot} OUT` : 'BOOM!', C.ORANGE, 1600);
      ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + SIGN, fx.pos[2]], size: 14, color: [1, 0.6, 0.2, 0.9], kind: SPRITE.FLASH, life: 500, grow: true });
      ctx.sound?.blast?.(0, 6);
    } else if (fx.kind === L.HP_FX_TICK) {
      ctx.sound?.count?.(fx.shot);
      ctx.glow?.({ pos: [fx.pos[0], fx.pos[1] + SIGN, fx.pos[2]], size: 6, color: [1, 0.4, 0.15, 0.7], kind: SPRITE.FLASH, life: 300 });
    } else if (fx.kind === L.HP_FX_DEAL) {
      // (a holder's own line is the HUD's)
      ctx.banner?.(`${fx.shot} ${fx.shot === 1 ? 'BOMB' : 'BOMBS'} LIT  ${Math.round(fx.size * TICK)} S`, C.YELLOW, 1500);
      ctx.sound?.count?.(0);
    }
  },

  // the feed for a ball out: a holder out on the boom's tick blew up (the KO, if any, to whoever passed it the bomb)
  sink(f, name, view) {
    const g = view.party();
    if (f.tick !== ((g.start + sched(view).last) >>> 0) || sched(view).wave === 0) return null;
    return `${name(f.owner)} BLEW UP` + (f.shot === 255 ? '' : `  ${name(f.shot)} PASSED IT`);
  },

  // the fuse, big, with a bar; whether you have a bomb; the wave
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const s = sched(view);
    if (!(s.rad > 0)) return;
    const tt = typeof ctx.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const playing = me && me.live && !me.out;
    let n = 0;
    for (let p = 0; p < L.NPLAYER; p++) if (holds(view, p)) n++;
    const bar = (u, r, gg, b) => {
      if (!ctx.rect) return;
      const x0 = COLS * 2 - 60, y0 = (row + 1) * 6 + 1;
      ctx.rect(x0 - 1, y0 - 1, x0 + 121, y0 + 5, 0.05, 0.04, 0.06, 0.7);
      if (u > 0) ctx.rect(x0, y0, x0 + Math.round(120 * u), y0 + 4, r, gg, b, 1);
    };
    if (tt < s.deal) {
      const secs = ((s.deal - tt) * TICK).toFixed(1);
      ctx.centre(row, s.wave === 0 ? `BOMBS LIT IN ${secs}` : `NEXT BOMBS IN ${secs}`, C.YELLOW);
      ctx.centre(row + 1, `${s.bombs} ${s.bombs === 1 ? 'BOMB' : 'BOMBS'}  ${Math.round(s.fuse * TICK)} S FUSE` + (s.rnext < s.rad - 1e-3 && tt < s.deal ? '  THE EDGE FALLS IN' : ''), C.ORANGE);
      if (playing && picked(view, s, ctx.slot, tt)) ctx.centre(row + 2, 'YOU GET ONE', C.RED);
    } else {
      const left = Math.max(0, s.boom - tt);
      const u = left / Math.max(1, s.fuse);
      const c = left < 250 ? C.RED : left < 625 ? C.ORANGE : C.YELLOW;
      ctx.centre(row, `BOOM IN ${(left * TICK).toFixed(1)}`, c);
      bar(u, 1, 0.25 + 0.55 * u, 0.1);
      if (playing && holds(view, ctx.slot)) {
        const free = freeAt(view, ctx.slot) - tt;
        const blink = Math.floor((ctx.now || 0) / 250) & 1;
        ctx.centre(row + 2, free > 0 ? `YOU HAVE THE BOMB  STUCK ${(free * TICK).toFixed(1)}` : 'YOU HAVE THE BOMB!  BUMP SOMEONE', blink ? C.RED : C.WHITE);
      }
    }
    ctx.right(3, `WAVE ${s.wave + 1}  ${tt < s.deal ? 'BOMBS NEXT' : 'HOLDING'} ${tt < s.deal ? s.bombs : n}`, C.GREY);
  },

  brain: {
    // past the edge (as it will be then) is deadly, the last 4.5 m before it
    // a warning (a bump puts a ball that far over); a ball with a bomb (or
    // about to get one) where it will be by then, coming my way, the worse as
    // the fuse runs down, and its blast's reach in the last second; nothing
    // of that to a ball that has one
    danger(view, x, z, tick, me) {
      const w = worldOf(view);
      if (w.state !== L.H_PLAY) return 0;
      const s = w.s, t = (tick - w.start) | 0;
      const R = rimAt(s, Math.max(0, t));
      const rho = Math.hypot(x - s.cx, z - s.cx);
      if (rho > R - 0.3) return 1;
      let d = rho > R - 4.5 ? ((rho - (R - 4.5)) / 4.2) * 0.55 : 0;
      const slot = slotOf(me);
      const mine = w.bySlot[slot];
      if (!mine || mine.hold || mine.pick || t >= s.boom) return d;
      const ahead = Math.max(0, Math.min(1, (tick - view.tick) * TICK));
      const urgent = t >= s.deal ? clamp01((t - s.deal) / Math.max(1, s.fuse)) : 0;
      const list = SCRATCH.slot === slot && SCRATCH.tick === view.tick ? SCRATCH.threats : w.threats;
      for (const h of list) {
        const hx = h.x + h.vx * ahead, hz = h.z + h.vz * ahead;
        const dd = Math.hypot(x - hx, z - hz);
        let k = 0;
        if (h.hold) {
          k = clamp01((5 - dd) / 3) * (0.5 + 0.35 * urgent);
          if (s.boom - t < 125 && dd < L.HP_BLAST_R + 0.5) k = Math.max(k, 0.6);
        } else if (t >= s.deal - 125) k = clamp01((4 - dd) / 3) * 0.4;
        if (k > d) d = k;
      }
      return d;
    },
    // away from the balls with bombs near, weighted by how near, and in from
    // the edge; with none near, somewhere roomy in the middle, kept a while
    goal(view, me, bot) {
      const w = worldOf(view);
      const slot = slotOf(me);
      const mine = w.bySlot[slot];
      if (!mine || w.state !== L.H_PLAY) return null;
      const s = w.s, cx = s.cx;
      const mx = bot?.pos?.[0] ?? mine.x, mz = bot?.pos?.[1] ?? mine.z;
      const R = rimAt(s, w.t + 125);
      let fx = 0, fz = 0;
      for (const h of SCRATCH.slot === slot && SCRATCH.tick === view.tick ? SCRATCH.threats : near(w, mx, mz)) {
        const dx = mx - h.x, dz = mz - h.z, d2 = Math.max(1, dx * dx + dz * dz);
        const k = h.hold ? 1 : 0.5;
        fx += (dx / d2) * k * 10; fz += (dz / d2) * k * 10;
      }
      // near the edge, nothing of it outward (along it or in instead), and a pull in
      const rho = Math.hypot(mx - cx, mz - cx) || 1;
      const nx = (mx - cx) / rho, nz = (mz - cx) / rho;
      const edge = clamp01((8 - (R - rho)) / 6);
      const out = fx * nx + fz * nz;
      if (out > 0) { fx -= nx * out * edge; fz -= nz * out * edge; }
      const inward = Math.max(0, rho / R - 0.5) * 2 + 2 * edge;
      fx -= nx * inward; fz -= nz * inward;
      const mem = bot?.mem || {};
      let gx, gz;
      if (Math.hypot(fx, fz) > 0.2) {
        const k = 8 / Math.hypot(fx, fz);
        gx = mx + fx * k; gz = mz + fz * k;
        mem.hpWander = null;
      } else {
        const v = mem.hpWander;
        if (!v || w.tick - v.at > 400 || Math.hypot(v.x - mx, v.z - mz) < 3) {
          const a = (bot?.rand?.() ?? luck(slot, w.tick)) * 2 * Math.PI, rr = R * 0.55 * Math.sqrt(bot?.rand?.() ?? 0.5);
          mem.hpWander = { x: cx + Math.cos(a) * rr, z: cx + Math.sin(a) * rr, at: w.tick };
        }
        gx = mem.hpWander.x; gz = mem.hpWander.z;
      }
      const gr = Math.hypot(gx - cx, gz - cx), lim = Math.max(1, R - 3);
      if (gr > lim) { gx = cx + ((gx - cx) * lim) / gr; gz = cx + ((gz - cx) * lim) / gr; }
      return [gx, gz];
    },
    hop() { return false; },
    // a ball with a bomb, or one about to have one, chases; the rest leave
    // it to the planner (and their threats near, gathered for danger)
    think(view, me, bot, tick = view.tick) {
      const w = worldOf(view);
      const slot = slotOf(me);
      const mine = w.bySlot[slot];
      if (!mine || w.state !== L.H_PLAY) return null;
      if (mine.hold || (mine.pick && w.t >= w.s.deal - 190)) return chase(view, w, mine, bot, tick);
      SCRATCH.slot = slot;
      SCRATCH.tick = view.tick;
      SCRATCH.threats = near(w, bot?.pos?.[0] ?? mine.x, bot?.pos?.[1] ?? mine.z);
      return null;
    },
  },
};
