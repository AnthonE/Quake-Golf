// TAG, as drawn and as the AI ball sees it. A walled disc at night, rings of
// soft rubber, a rim of red and white bumpers and tall candy pillars whose
// bands light as a ball comes off them. An it wears a glowing red shell and
// a ring of red on the floor; when only a few are free, each of them is lit
// from the sky. Who is it is the record's PG_M in play (src/mg/tag.wat), and
// in the countdown the deal in PG_S; the pillars are PG_S's from setup on.
// The brain: an it runs down the free ball it can reach soonest (leading
// it, round the pillars in the way, a little shy of one another it already
// hunts) and dashes at it when it's near and dead ahead; a free ball keeps
// away from the its near it, off the rim, and springs when one is about to
// touch it.
import * as L from '../../src/layout.mjs';
import * as MC from '../../src/mg/tag.mjs'; // TG_*: the minigame's own constants
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const IT = MC.TG_M_IT, IN = MC.TG_M_IN;
const PR = MC.TG_PR, PH = MC.TG_PH;
const RED = [1, 0.16, 0.1];
const GOLD = [1, 0.86, 0.35];
const CANDY = [[1, 0.42, 0.66], [1, 0.82, 0.25], [0.38, 0.9, 0.7], [0.62, 0.56, 1], [0.35, 0.75, 1]];
const FLOOR = [[0.16, 0.2, 0.42], [0.2, 0.28, 0.55], [0.36, 0.14, 0.22]]; // the rings, out to in; the its' circle

// ---- the stage, read once a round (the pillars are the confirmed world's, at PG_S whatever the bank)

const STAGES = new WeakMap();
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const r = dv.getFloat32(L.PG_H + MC.TG_RAD + o, true), np = dv.getUint32(L.PG_H + MC.TG_NP + o, true);
  const hole = dv.getUint32(L.HDR_HOLE + o, true), seed = dv.getUint32(L.HDR_SEED + o, true);
  const cx = dv.getFloat32(L.PG_CX + o, true);
  let st = STAGES.get(dv.buffer);
  if (st && st.r === r && st.np === np && st.hole === hole && st.seed === seed && st.cx === cx) return st;
  const px = new Float64Array(np), pz = new Float64Array(np);
  for (let k = 0; k < np; k++) { px[k] = dv.getFloat32(L.PG_S + MC.TG_PILL + 8 * k, true); pz[k] = dv.getFloat32(L.PG_S + MC.TG_PILL + 8 * k + 4, true); }
  st = { r, np, hole, seed, cx, px, pz, lit: new Float32Array(np) };
  STAGES.set(dv.buffer, st);
  return st;
}

// Is slot p it? In play the record says (on the view's bank); in the countdown, the deal.
export function isIt(view, p) {
  const o = view.bank || 0;
  const state = view.dv.getUint32(L.HDR_STATE + o, true);
  if (state === L.H_COUNT) return view.u8[L.PG_S + MC.TG_ROLE + p] === 1;
  return (view.dv.getUint32(L.PLAYERS + o + p * L.PSIZE + L.PG_M, true) & IT) !== 0;
}
// Is slot p free, and in the round?
const isFree = (view, p) => (view.dv.getUint32(L.PLAYERS + (view.bank || 0) + p * L.PSIZE + L.PG_M, true) & (IN | IT)) === IN;

// Every ball in on the view's tick: the its and the free, where and how fast,
// in grids of CELL m; once a tick (and bank) for everyone who asks.
const CELL = 8;
const WORLDS = new WeakMap();
function world(view) {
  const dv = view.dv, o = view.bank || 0, tick = dv.getUint32(L.HDR_TICK + o, true);
  let w = WORLDS.get(dv.buffer);
  if (w && w.tick === tick && w.bank === o) return w;
  const its = [], free = [], itGrid = new Map(), freeGrid = new Map();
  const count = dv.getUint32(L.HDR_STATE + o, true) === L.H_COUNT;
  for (let p = 0; p < L.NPLAYER; p++) {
    const a = L.PLAYERS + o + p * L.PSIZE;
    const fl = view.u8[a + L.P_FL];
    if ((fl & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) continue;
    const m = dv.getUint32(a + L.PG_M, true);
    const it = count ? view.u8[L.PG_S + MC.TG_ROLE + p] === 1 : (m & IT) !== 0;
    if (!count && !(m & IN) && !it) continue; // a newcomer, it from the next tick
    const b = { slot: p, x: dv.getFloat32(a + L.P_PX, true), y: dv.getFloat32(a + L.P_PY, true), z: dv.getFloat32(a + L.P_PZ, true),
      vx: dv.getFloat32(a + L.P_VX, true), vz: dv.getFloat32(a + L.P_VZ, true), score: dv.getUint16(a + L.PG_SCORE, true), item: view.u8[a + L.B_ITEM], it };
    (it ? its : free).push(b);
    const g = it ? itGrid : freeGrid, k = cellOf(b.x, b.z);
    const list = g.get(k);
    if (list) list.push(b); else g.set(k, [b]);
  }
  w = { tick, bank: o, its, free, itGrid, freeGrid, claims: new Map() };
  WORLDS.set(dv.buffer, w);
  return w;
}
const cellOf = (x, z) => Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
// The balls of a grid within r of (x, z), but slot.
function within(grid, x, z, r, slot, out = []) {
  out.length = 0;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const list = grid.get(i * 4096 + j);
    if (list) for (const b of list) if (b.slot !== slot && (b.x - x) ** 2 + (b.z - z) ** 2 < r * r) out.push(b);
  }
  return out;
}
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);
const playing = (view) => view.dv.getUint32(L.HDR_STATE + (view.bank || 0), true) === L.H_PLAY;

// ---- the AI ball

// The its near a free ball, the nearest NEAR_MAX within 18 m, for its danger:
// once a think (the bot asks 90 times).
const NEAR_MAX = 8;
const NEAR = { slot: -1, w: null, st: null, list: [] };
function nearIts(view, me, w) {
  if (NEAR.slot === me.slot && NEAR.w === w) return NEAR.list;
  NEAR.slot = me.slot; NEAR.w = w; NEAR.st = stage(view);
  const list = within(w.itGrid, me.pos[0], me.pos[2], 18, me.slot, NEAR.list);
  if (list.length > NEAR_MAX) {
    const d = (b) => (b.x - me.pos[0]) ** 2 + (b.z - me.pos[2]) ** 2;
    list.sort((a, b) => d(a) - d(b) || a.slot - b.slot);
    list.length = NEAR_MAX;
  }
  return list;
}
// The first pillar the way from (x, z) to (gx, gz) runs into, as a point to
// steer round it by (on the side the goal is), or null.
function round(st, x, z, gx, gz, clear = PR + 1.4) {
  const dx = gx - x, dz = gz - z, len = Math.hypot(dx, dz);
  if (len < 0.5) return null;
  const ux = dx / len, uz = dz / len;
  let best = null, at = Infinity;
  for (let k = 0; k < st.np; k++) {
    const ox = st.px[k] - x, oz = st.pz[k] - z;
    const along = ox * ux + oz * uz;
    if (along < 0 || along > Math.min(len, 14) || along > at) continue;
    const side = ox * -uz + oz * ux; // > 0: the pillar's to the left of the way
    if (Math.abs(side) > clear) continue;
    at = along;
    const s = side > 0 ? -1 : 1; // pass on the other side
    best = [st.px[k] + -uz * s * clear * 1.15, st.pz[k] + ux * s * clear * 1.15];
  }
  return best;
}

// An it: the free ball it gets to soonest, a little less keen on one other its
// already hunt and keener on its own, led by where it's going; round a pillar.
function hunt(view, me, bot, w, st) {
  const x = bot?.pos?.[0] ?? me.pos[0], z = bot?.pos?.[1] ?? me.pos[2];
  const mem = bot?.mem || {};
  const skill = bot?.skill ?? 0.6;
  let pick = null, best = Infinity;
  const near = within(w.freeGrid, x, z, 36, me.slot, []);
  const list = near.length ? near : w.free;
  for (const b of list) {
    const d = Math.hypot(b.x - x, b.z - z);
    let s = d / 11.5 + 0.5 * (w.claims.get(b.slot) || 0);
    if (mem.tg === b.slot) s -= 0.6;
    if (b.y > PLAT_Y + 1.5) s += 0.6; // in the air on a spring: it comes down somewhere
    if (s < best) { best = s; pick = b; }
  }
  if (!pick) return null;
  if (mem.tg !== pick.slot) mem.tg = pick.slot;
  w.claims.set(pick.slot, (w.claims.get(pick.slot) || 0) + 1);
  const d = Math.hypot(pick.x - x, pick.z - z);
  const lead = Math.min(0.9, d / 12) * (0.4 + 0.6 * skill);
  let gx = pick.x + pick.vx * lead, gz = pick.z + pick.vz * lead;
  // keep the lead inside the rim
  const rr = Math.hypot(gx - st.cx, gz - st.cx), lim = st.r - 1.2;
  if (rr > lim) { gx = st.cx + (gx - st.cx) / rr * lim; gz = st.cx + (gz - st.cx) / rr * lim; }
  const by = round(st, x, z, gx, gz);
  if (by) [gx, gz] = by;
  return { goal: [gx, gz], target: pick, d };
}

// A free ball: the best of FLEE points 9 m round it (and the middle): far
// from where the its near it will be in 0.6 s, not past one on the way, in
// off the rim and clear of the pillars, a little for keeping its heading
// (a juke sideways beats running into the rim). With none near, it drifts
// to open floor away from the nearest, kept in bot.mem for a second.
const FLEE = 12;
const DIRS = Array.from({ length: FLEE }, (_, k) => [Math.cos((2 * Math.PI * k) / FLEE), Math.sin((2 * Math.PI * k) / FLEE)]);
function flee(view, me, bot, w, st) {
  const x = bot?.pos?.[0] ?? me.pos[0], z = bot?.pos?.[1] ?? me.pos[2];
  const vx = bot?.vel?.[0] ?? me.vel[0], vz = bot?.vel?.[1] ?? me.vel[2];
  const sp = Math.hypot(vx, vz);
  const its = nearIts(view, me, w);
  const mem = bot?.mem || {};
  let near = its;
  if (!its.length) {
    // none near: the open floor away from the nearest few, held for a second
    if (mem.drift && w.tick - mem.drift.at < 125 && Math.hypot(mem.drift.x - x, mem.drift.z - z) > 3) return { goal: [mem.drift.x, mem.drift.z] };
    near = within(w.itGrid, x, z, 60, me.slot, []);
    if (!near.length) near = w.its.slice();
    near.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z) || a.slot - b.slot);
    near.length = Math.min(near.length, 6);
  }
  const lim = st.r - 2.5;
  let best = null, score = -Infinity;
  for (let k = 0; k <= FLEE; k++) {
    let cx, cz;
    if (k === FLEE) { cx = st.cx; cz = st.cx; } else { cx = x + DIRS[k][0] * 9; cz = z + DIRS[k][1] * 9; }
    const rx = cx - st.cx, rz = cz - st.cx, rr = Math.hypot(rx, rz);
    if (rr > lim) { cx = st.cx + rx / rr * lim; cz = st.cx + rz / rr * lim; }
    const ux = cx - x, uz = cz - z, len = Math.hypot(ux, uz) || 1;
    let s = 0;
    for (const e of near) {
      const ex = e.x + e.vx * 0.6, ez = e.z + e.vz * 0.6;
      const d = Math.hypot(cx - ex, cz - ez);
      s -= 6 / (d + 1);
      // the way there passes by it
      const along = ((ex - x) * ux + (ez - z) * uz) / len;
      if (along > 0 && along < len) {
        const off = Math.abs((ex - x) * uz - (ez - z) * ux) / len;
        if (off < 3.5) s -= (3.5 - off) * 0.6;
      }
    }
    s -= Math.max(0, rr - (st.r - 7)) * 0.25;
    if (sp > 2 && k < FLEE) s += 0.35 * (ux * vx + uz * vz) / (len * sp);
    for (let j = 0; j < st.np; j++) if ((st.px[j] - cx) ** 2 + (st.pz[j] - cz) ** 2 < (PR + 1.2) ** 2) { s -= 0.5; break; }
    if (s > score) { score = s; best = [cx, cz]; }
  }
  if (!its.length && best) mem.drift = { x: best[0], z: best[1], at: w.tick };
  return { goal: best };
}

// Ticks from t (into play) to the next handing out of springs (from t0 TG_GIVE0) or dashes (TG_DASH0).
const nextGive = (t, t0) => (t < t0 ? t0 - t : MC.TG_GIVE - ((t - t0) % MC.TG_GIVE));

// ---- drawing

// The ball p is drawn at: the frontend's extrapolation, the prediction's for your own.
function drawnAt(view, ctx, p) {
  const own = ctx.pme && p === ctx.slot && !ctx.pme.out;
  const b = own ? ctx.pme : null;
  const d = view.dv, a = L.PLAYERS + p * L.PSIZE;
  if (b) {
    const k = ((ctx.ptick ?? 0) - (ctx.pview?.tick ?? 0)) * TICK;
    return [b.pos[0] + b.vel[0] * k, b.pos[1] + b.vel[1] * k, b.pos[2] + b.vel[2] * k, b.radius];
  }
  const dt = ctx.dt || 0;
  return [d.getFloat32(a + L.P_PX, true) + d.getFloat32(a + L.P_VX, true) * dt, d.getFloat32(a + L.P_PY, true) + d.getFloat32(a + L.P_VY, true) * dt,
    d.getFloat32(a + L.P_PZ, true) + d.getFloat32(a + L.P_VZ, true) * dt, d.getUint16(a + L.B_MEGA, true) ? 1.6 : 1];
}

export default {
  id: L.MG_TAG, key: 'tag', name: 'TAG',
  hint: 'RED IS IT  A POINT A SECOND WHILE FREE  CATCH THE LAST ONE TO WIN',
  rules: 'TOUCHED BY RED YOU TURN RED  SPRINGS FOR THE FREE  DASHES FOR RED',
  env: 'night',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.r > 0)) return;
    const g = view.party();
    const sc = out.scene, cx = st.cx, R = st.r;
    const now = (ctx.now ?? 0) / 1000;
    // the floor: rings of rubber, the its' circle in the middle
    sc.cyl(cx, PLAT_Y - 0.6, cx, R + 0.6, 0.6, ...FLOOR[0], LOOK.RUBBER);
    sc.cyl(cx, PLAT_Y - 0.59, cx, R * 0.68, 0.6, ...FLOOR[1], LOOK.RUBBER);
    sc.cyl(cx, PLAT_Y - 0.58, cx, R * 0.4, 0.6, ...FLOOR[0], LOOK.RUBBER);
    sc.cyl(cx, PLAT_Y - 0.57, cx, R * MC.TG_ITR + 1.6, 0.6, ...FLOOR[2], LOOK.RUBBER);
    out.decals?.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: R * 0.68, width: 0.12, color: [0.6, 0.75, 1, 0.25], kind: DECAL.RING });
    out.decals?.push({ pos: [cx, PLAT_Y + 0.02, cx], radius: R * 0.4, width: 0.12, color: [0.6, 0.75, 1, 0.25], kind: DECAL.RING });
    // the rim: red and white bumpers
    const K = Math.max(16, Math.ceil(2 * Math.PI * R / 2.4) & ~1);
    const half = Math.PI * (R + 0.3) / K * 1.02;
    for (let k = 0; k < K; k++) {
      const a = (k + 0.5) / K * 2 * Math.PI;
      const c = k & 1 ? [0.95, 0.95, 0.92] : [0.9, 0.12, 0.14];
      sc.box(cx + Math.cos(a) * (R + 0.3), PLAT_Y + 0.55, cx + Math.sin(a) * (R + 0.3), half, 0.55, 0.3, a + Math.PI / 2, ...c, LOOK.PLASTIC);
    }
    // the pillars, their bands lit by a ball near (and fading after)
    const w = world(view);
    const lit = st.lit;
    for (let k = 0; k < st.np; k++) lit[k] *= Math.exp(-(ctx.ms || 16) / 220);
    for (const list of [w.its, w.free]) for (const b of list) {
      for (let k = 0; k < st.np; k++) {
        const dx = b.x - st.px[k], dz = b.z - st.pz[k];
        if (Math.abs(dx) > PR + 1.6 || Math.abs(dz) > PR + 1.6) continue;
        const d = Math.hypot(dx, dz) - PR - 1;
        if (d < 0.35) lit[k] = 1;
      }
    }
    // a pillar between the camera and your ball (or right by the camera) is drawn see-through
    const cam = ctx.cam || [cx, PLAT_Y + 50, cx];
    const own = ctx.pme && !ctx.pme.out ? drawnAt(view, ctx, ctx.slot) : null;
    const sx = own ? own[0] - cam[0] : 0, sz = own ? own[2] - cam[2] : 0, s2 = sx * sx + sz * sz;
    for (let k = 0; k < st.np; k++) {
      const x = st.px[k], z = st.pz[k], c = CANDY[k % CANDY.length];
      let alpha = 1;
      const ox = x - cam[0], oz = z - cam[2];
      if (ox * ox + oz * oz < (PR + 2) ** 2) alpha = 0.25;
      else if (own && s2 > 1) {
        const u = (ox * sx + oz * sz) / s2;
        if (u > 0 && u < 1 && Math.abs(ox * sz - oz * sx) / Math.sqrt(s2) < PR + 1.1 && cam[1] < PLAT_Y + PH + 3) alpha = 0.3;
      }
      sc.cyl(x, PLAT_Y + PH / 2, z, PR, PH / 2, ...c, LOOK.PLASTIC, 0, 0, alpha);
      sc.cyl(x, PLAT_Y + 1, z, PR + 0.07, 0.28, ...c, LOOK.GLOW, 0.5 + 1.6 * lit[k], 0.3, alpha);
      sc.cyl(x, PLAT_Y + PH + 0.06, z, PR * 0.75, 0.06, 1, 0.95, 0.8, LOOK.GLOW, 0.9, 0.4, alpha);
      if (lit[k] > 0.05) out.glow?.push({ pos: [x, PLAT_Y + 1, z], size: PR * 2.6, color: [...c, 0.35 * lit[k]], kind: SPRITE.FLASH });
    }
    // the its: a red shell and a ring under; the hunted few, light from the sky
    if (g.state !== L.H_COUNT && g.state !== L.H_PLAY && g.state !== L.H_OVER) return;
    const pulse = 0.5 + 0.5 * Math.sin(now * 6);
    const few = g.state === L.H_PLAY && w.free.length > 0 && w.free.length <= Math.max(3, Math.ceil(g.n0 / 12));
    for (let p = 0; p < L.NPLAYER; p++) {
      const a = L.PLAYERS + p * L.PSIZE;
      if ((view.u8[a + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) continue;
      const it = isIt(view, p);
      if (!it && !(few && isFree(view, p))) continue;
      const [x, y, z, r] = drawnAt(view, ctx, p);
      if (it) {
        sc.sphere(x, y + r, z, r * 1.14, ...RED, LOOK.GLOW, 0.55 + 0.3 * pulse, 0.6, 0.55);
        out.decals?.push({ pos: [x, PLAT_Y + 0.03, z], radius: r * 1.7, width: 0.3, color: [...RED, 0.55 + 0.35 * pulse], kind: DECAL.RING });
        out.glow?.push({ pos: [x, y + r, z], size: r * 1.9, color: [...RED, 0.16], kind: SPRITE.FLASH });
      } else {
        // the beam is for the hunters to find them by: not over your own ball, nor one by the camera (it would fill the view)
        if (p !== ctx.slot && (x - cam[0]) ** 2 + (z - cam[2]) ** 2 > 36) out.beams?.push({ a: [x, PLAT_Y + 40, z], b: [x, y + 2 * r + 1.2, z], width: 0.9 + 0.3 * pulse, color: [...GOLD, 0.3] });
        out.decals?.push({ pos: [x, PLAT_Y + 0.03, z], radius: r * 2, width: 0.3, color: [...GOLD, 0.7], kind: DECAL.RING });
      }
    }
  },

  frame(view) {
    const st = stage(view);
    const g = view.party();
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: (st.r || g.size) + 0.6, shape: 'disc' };
  },

  fx(f, ctx) {
    if (f.kind !== MC.TG_FX_TAG) return;
    const q = f.owner, p = f.shot & 255, left = f.shot >> 8, secs = Math.round(f.size);
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const name = (s) => ctx.name?.(s) ?? `P${s + 1}`;
    ctx.glow?.({ pos: f.pos, size: 3.6, color: [...RED, 0.9], kind: SPRITE.RING, life: 650, grow: true });
    ctx.glow?.({ pos: f.pos, size: 2.4, color: [1, 0.45, 0.3, 0.8], kind: SPRITE.FLASH, life: 320 });
    if (p < L.NPLAYER) {
      const last = left === 0;
      ctx.feed?.(last ? `${name(p)} CAUGHT THE LAST ONE  ${name(q)} ${secs} S` : `${name(p)} TAGGED ${name(q)}`, q === ctx.slot ? C.RED : p === ctx.slot ? C.GREEN : C.WHITE);
      if (q === ctx.slot) { ctx.banner?.(`TAGGED BY ${name(p)}  YOU'RE IT`, C.RED, 2200); ctx.sound?.sink?.(0); }
      else if (p === ctx.slot) { ctx.banner?.(last ? 'YOU CAUGHT THE LAST ONE!' : `YOU TAGGED ${name(q)}`, last ? C.YELLOW : C.GREEN, 1800); ctx.sound?.kill?.(); }
      else ctx.sound?.boing?.(9, d);
    } else {
      ctx.feed?.(p === 255 ? `${name(q)} JOINS AS IT` : `${name(q)} IS IT NOW`, C.GREY);
      if (q === ctx.slot) ctx.banner?.(p === 255 ? 'YOU JOIN AS IT  TAG SOMEONE' : 'YOU\'RE IT', C.RED, 2200);
    }
    if (left === 1 && ctx.view) {
      let last = -1;
      for (let s = 0; s < L.NPLAYER && last < 0; s++) if ((ctx.view.u8[L.PLAYERS + s * L.PSIZE + L.P_FL] & L.PF_LIVE) && isFree(ctx.view, s)) last = s;
      if (last >= 0) ctx.banner?.(last === ctx.slot ? 'YOU\'RE THE LAST ONE FREE!' : `${name(last)} IS THE LAST ONE FREE  CATCH THEM`, C.YELLOW, 2500);
    }
  },

  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const w = world(view);
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    ctx.right(3, `FREE ${w.free.length}  IT ${w.its.length}`, C.GREY);
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (!me || !me.live || me.out) return;
    const it = (me.m & IT) !== 0;
    if (it) {
      const t = g.t - (me.m >>> 8);
      let best = null, bd = Infinity;
      for (const b of w.free) { const d = Math.hypot(b.x - me.pos[0], b.z - me.pos[2]); if (d < bd) { bd = d; best = b; } }
      ctx.centre(row, t < 375 ? 'YOU\'RE IT!  TAG SOMEONE' : 'YOU\'RE IT', C.RED);
      if (best) ctx.centre(row + 1, w.free.length === 1 ? `CATCH P${best.slot + 1} TO WIN  ${Math.round(bd)} M` : `NEAREST FREE P${best.slot + 1}  ${Math.round(bd)} M`, w.free.length === 1 ? C.YELLOW : C.WHITE);
      if (me.item !== L.PU_DASH) ctx.centre(row + 2, `NEXT DASH IN ${Math.ceil(nextGive(g.t, MC.TG_DASH0) / 125)}`, C.GREY);
    } else if (me.m & IN) {
      let bd = Infinity;
      for (const b of w.its) bd = Math.min(bd, Math.hypot(b.x - me.pos[0], b.z - me.pos[2]));
      ctx.centre(row, w.free.length === 1 ? 'THE LAST ONE FREE  RUN!' : `FREE  NEAREST IT ${Number.isFinite(bd) ? Math.round(bd) : '-'} M`, bd < 6 ? C.RED : bd < 14 ? C.YELLOW : C.GREEN);
      if (me.item !== L.PU_SPRING) ctx.centre(row + 1, `NEXT SPRING IN ${Math.ceil(nextGive(g.t, MC.TG_GIVE0) / 125)}`, C.GREY);
    }
  },

  brain: {
    // a free ball: an it where it's going to be is a tag, nearer is worse;
    // the rim corners it a little. An it fears nothing.
    danger(view, x, z, tick, me) {
      const b = ball(view, me);
      if (!b || (b.m & (IN | IT)) !== IN || !playing(view)) return 0;
      const w = world(view);
      const list = nearIts(view, b, w), st = NEAR.st;
      const tau = Math.max(0, Math.min(1, (tick - w.tick) * TICK));
      let v = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        // an it holding a dash reaches further
        const reach = e.item === L.PU_DASH ? 6.5 : 5;
        const dx = e.x + e.vx * tau - x, dz = e.z + e.vz * tau - z, d2 = dx * dx + dz * dz;
        if (d2 < reach * reach) v = Math.max(v, Math.min(1, (reach - Math.sqrt(d2)) / 2.8));
      }
      const rx = x - st.cx, rz = z - st.cx, lim = st.r - 3;
      if (rx * rx + rz * rz > lim * lim) v = Math.max(v, 0.25 * Math.min(1, (Math.hypot(rx, rz) - lim) / 3));
      return v;
    },
    goal(view, me, bot) {
      const b = ball(view, me);
      if (!b || !playing(view)) return null;
      const st = stage(view), w = world(view);
      if (b.m & IT) return hunt(view, b, bot, w, st)?.goal ?? null;
      return flee(view, b, bot, w, st).goal;
    },
    hop() { return false; },
    // an it steers itself (the planner would keep it off the ball it hunts);
    // a free one leaves the steering to the planner and springs when it must
    think(view, me, bot, tick) {
      const b = ball(view, me);
      if (!b || !b.live || b.out || !playing(view)) return null;
      const st = stage(view), w = world(view);
      const x = bot?.pos?.[0] ?? b.pos[0], z = bot?.pos?.[1] ?? b.pos[2];
      // the power-up is the brain's to spend (the planner's own rule would jump in
      // any crowd, or dash at whoever is ahead): the record it reads holds none
      // (a fresh one each think)
      const item = b.item;
      if (typeof me === 'object') me.item = 0;
      if (b.m & IT) {
        const h = hunt(view, b, bot, w, st);
        if (!h) return null;
        if (bot) bot.goal = h.goal;
        // a dash at the free ball it hunts, near and straight ahead of where it rolls
        let use = false;
        if (item === L.PU_DASH && b.ground && h.d > 2.6 && h.d < 5 + 3 * (bot?.skill ?? 0.6)) {
          const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2], sp = Math.hypot(vx, vz);
          const gx = h.goal[0] - x, gz = h.goal[1] - z, gd = Math.hypot(gx, gz) || 1;
          use = sp > 4 && (gx * vx + gz * vz) / (gd * sp) > 0.93 && (w.tick + b.slot) % 3 === 0;
        }
        return { yaw: Math.atan2(h.goal[1] - z, h.goal[0] - x), move: 1, use };
      }
      if (!(b.m & IN) || item !== L.PU_SPRING) return null;
      if (!b.ground) return null;
      const skill = bot?.skill ?? 0.6;
      // an it within a skin or two in the next fifth of a second, coming on: jump
      for (const e of nearIts(view, b, w)) {
        const ex = e.x + e.vx * 0.2, ez = e.z + e.vz * 0.2;
        const d = Math.hypot(ex - x, ez - z);
        if (d < 2.6 + 1.2 * skill && Math.hypot(e.x - x, e.z - z) > d) return { use: true };
      }
      return null;
    },
  },
};
