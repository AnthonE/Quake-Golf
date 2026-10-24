// THE WALL, as drawn and as the AI ball sees it. The stage is a square of
// checkered floor over the sea, hazard-striped at its rim. A wall is a row of
// foam blocks in its own colour, the posts at its gaps lit; ahead of it the
// lanes its gaps will sweep glow on the floor (a swaying wall's snake from
// side to side), so where to be reads at a glance; while it waits at its
// edge the edge pulses and chevrons in its lanes point the way it will come.
// The walls are the sim's own table (src/mg/wall.mjs's layout in PG_S, fixed
// when the round is laid out), each one's face and sway a function of the
// tick from there, so what is drawn and what the bots steer by is what the
// sim does.
import * as L from '../../src/layout.mjs';
import { PLAT_Y, B_RAD, hash32 } from '../../src/party-view.mjs';
import { LOOK, SPRITE } from '../party-render.mjs';
import { C } from '../font.mjs';

const TICK = 0.008;
const TURN = 16384;
const WAYS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // a wall's way by its side (it comes from the other way)
const FROM = ['WEST', 'NORTH', 'EAST', 'SOUTH']; // the side, on the north-up minimap
const COLOURS = [[0.95, 0.3, 0.52], [1, 0.52, 0.12], [0.56, 0.36, 0.95], [0.12, 0.72, 0.74], [0.98, 0.78, 0.16], [0.36, 0.74, 0.28]];
const PT = 2; // the platform's thickness, m
const POST = [0.45, 1, 0.85]; // the lit posts at a gap's edges
const RISE = 40; // ticks a wall takes to rise into view as it shows
const SINK = 60; // and to sink away as it goes
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---- the walls, as the sim's table has them

let memo = null;
// The round's walls on the view's bank (the table itself is the confirmed
// world's, fixed from the layout on): read once a round, and again if a join
// in the countdown laid the round out again.
export function table(view) {
  const dv = view.dv, o = view.bank || 0;
  const h = dv.getFloat32(L.PG_H + L.WL_HALF + o, true), nw = Math.min(L.WL_NMAX, dv.getUint32(L.PG_H + L.WL_NW + o, true));
  const seed = dv.getUint32(L.HDR_SEED + o, true), hole = dv.getUint32(L.HDR_HOLE + o, true);
  const a0 = L.PG_S + L.WL_TABLE;
  const sig = (dv.getUint32(a0 + L.WL_GAPS, true) ^ Math.imul(dv.getUint32(a0 + L.WL_PH, true) + 1, 0x9e3779b9)
    ^ (nw ? dv.getUint32(a0 + (nw - 1) * L.WL_WSIZE + L.WL_GAPS, true) : 0)) >>> 0;
  if (memo && memo.h === h && memo.nw === nw && memo.seed === seed && memo.hole === hole && memo.sig === sig) return memo;
  const walls = [];
  for (let w = 0; w < nw; w++) {
    const a = a0 + w * L.WL_WSIZE;
    const u = (k) => dv.getUint32(a + k, true), f = (k) => dv.getFloat32(a + k, true);
    const k = Math.min(L.WL_KMAX, u(L.WL_K)), side = u(L.WL_SIDE) & 3;
    const gaps = [];
    for (let j = 0; j < k; j++) gaps.push(f(L.WL_GAPS + 4 * j));
    walls.push({ w, start: u(L.WL_START), go: u(L.WL_GO), end: u(L.WL_END), side, ux: WAYS[side][0], uz: WAYS[side][1], v: f(L.WL_V), g: f(L.WL_G), k, gaps,
      a: f(L.WL_A), ph: u(L.WL_PH), s0: Math.fround(-h - L.WL_LEAD), colour: COLOURS[w % COLOURS.length] });
  }
  memo = { h, nw, seed, hole, sig, cx: dv.getFloat32(L.PG_CX + o, true), walls };
  return memo;
}
// Wall W's leading face t ticks into play (fractions too), m along its way from the stage's centre ($wl_face).
export const face = (W, t) => (t <= W.go ? W.s0 : W.s0 + (t - W.go) * TICK * W.v);
// How far its gaps are off their centres t ticks into play ($wl_sway).
export const sway = (W, t) => (W.a ? W.a * Math.sin((2 * Math.PI * (W.ph + L.WL_SWAYK * Math.max(0, t - W.go))) / TURN) : 0);
// The tick into play the middle of wall W's slab passes u, along its way.
export const over = (W, u) => W.go + (u + L.WL_T / 2 - W.s0) / (W.v * TICK);
// Where gap j of wall W is across it as the wall goes over u: its lane on the floor.
export const laneAt = (W, j, u) => W.gaps[j] + sway(W, over(W, u));
// (x, z) in wall W's frame, [u along its way, v across it], and back.
export const toWall = (T, W, x, z) => [(x - T.cx) * W.ux + (z - T.cx) * W.uz, (z - T.cx) * W.ux - (x - T.cx) * W.uz];
export const toWorld = (T, W, u, v) => [T.cx + u * W.ux - v * W.uz, T.cx + u * W.uz + v * W.ux];
// Is v across wall W in one of its gaps' spans t ticks into play? The gap's index, or -1.
export function gapAt(W, v, t) {
  const c = v - sway(W, t);
  for (let j = 0; j < W.k; j++) if (Math.abs(c - W.gaps[j]) < W.g / 2) return j;
  return -1;
}
// Wall W's blocks across it t ticks into play: [lo, hi] spans, the whole width and a little past the edges.
export function blocksAt(T, W, t) {
  const off = sway(W, t), out = [];
  let lo = -T.h - 0.5;
  for (const c of W.gaps) { if (c + off - W.g / 2 > lo + 0.01) out.push([lo, c + off - W.g / 2]); lo = c + off + W.g / 2; }
  if (T.h + 0.5 > lo + 0.01) out.push([lo, T.h + 0.5]);
  return out;
}
// The walls on the stage t ticks into play (shown, not yet gone).
export const onStage = (T, t) => T.walls.filter((W) => W.start <= t && t < W.end);
// Would a ball at (x, z) be against a block of wall W t ticks into play (its centre in no gap, the slab within its radius)?
export function blocked(T, W, x, z, t, r = B_RAD) {
  if (t < W.start || t >= W.end) return false;
  const [u, v] = toWall(T, W, x, z), s = face(W, t);
  return u - r < s && u + r > s - L.WL_T && gapAt(W, v, t) < 0;
}
// How it stands with wall W for a ball at (x, z) t ticks into play: the
// seconds until the face reaches it (0 if it has), whether it's by now behind
// the wall, the gap its centre is in now (or -1), and the gap it will be in
// as the wall goes over it (where it is: a swaying wall's gaps move).
export function meet(T, W, x, z, t, r = B_RAD) {
  const [u, v] = toWall(T, W, x, z);
  const s = face(W, t);
  const past = u + r <= s - L.WL_T;
  let eta = 0;
  if (!past && u - r > s) eta = t < W.go ? (W.go - t) * TICK + (u - r - s) / W.v : (u - r - s) / W.v;
  return { u, v, s, eta, past, now: gapAt(W, v, t), gap: gapAt(W, v, Math.max(t, over(W, u))) };
}
// The walls slot p has seen go by this round (WL_PASSED, the confirmed world's).
export const passed = (view, p) => view.u8[L.PG_S + L.WL_PASSED + p];

// Ticks into play to draw at (fractional): the prediction's clock in play, 0
// through the countdown (the first wall waits at its edge), frozen where the
// round ended through the result.
function playTime(view, g, ctx) {
  if (g.state === L.H_COUNT) return 0;
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.ptick === 'number' ? ctx.ptick - g.start : typeof ctx?.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

// A box in wall W's frame: centre (u, y, v), half extents along its way, up, across it.
function wbox(sc, T, W, u, y, v, hu, hy, hv, rgb, look, a = 0, b = 0, alpha = 1, seed) {
  const [x, z] = toWorld(T, W, u, v);
  if (W.ux) return sc.box(x, y, z, hu, hy, hv, 0, rgb[0], rgb[1], rgb[2], look, a, b, alpha, seed);
  return sc.box(x, y, z, hv, hy, hu, 0, rgb[0], rgb[1], rgb[2], look, a, b, alpha, seed);
}
// A thin glowing bar on the floor in wall W's frame from (u0, v0) to (u1, v1), turned to lie along it.
function bar(sc, T, W, u0, v0, u1, v1, half, y, rgb, a, alpha) {
  const [x0, z0] = toWorld(T, W, u0, v0), [x1, z1] = toWorld(T, W, u1, v1);
  const len = Math.hypot(x1 - x0, z1 - z0) / 2;
  sc.box((x0 + x1) / 2, y, (z0 + z1) / 2, len, 0.012, half, Math.atan2(z1 - z0, x1 - x0), rgb[0], rgb[1], rgb[2], LOOK.GLOW, a, 0.6, alpha);
}
const lift = (rgb, k) => rgb.map((c) => c + (1 - c) * k);

// What the HUD knows of your ball between frames: the prediction's, as draw last saw it.
let seen = { pme: null, ptick: 0, at: -1 };

// ---- the AI ball

const MINDS = new WeakMap();
const SLOT_MINDS = [];
function mindOf(bot, slot) {
  if (bot && typeof bot === 'object') {
    let m = MINDS.get(bot);
    if (!m) MINDS.set(bot, (m = { round: -1 }));
    return m;
  }
  return (SLOT_MINDS[slot] ||= { round: -1 });
}
// A number in [0, 1) for this ball, this wall and k: its own luck, from what anyone can see.
const luck = (T, slot, w, k) => hash32(slot * 977 + k, w, T.seed ^ 0x2545f491) / 2 ** 32;

// The balls in, once a world tick, where they'll be lag s on; and per wall
// asked about, each one's place in that wall's frame and the gap whose lane
// it's on.
function crowdOf(view, lag) {
  const c = view._wl;
  if (c && c.tick === view.tick && c.bank === view.bank) return c;
  const xs = [], zs = [], slots = [];
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + view.bank + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    xs.push(view.dv.getFloat32(b + L.P_PX, true) + view.dv.getFloat32(b + L.P_VX, true) * lag);
    zs.push(view.dv.getFloat32(b + L.P_PZ, true) + view.dv.getFloat32(b + L.P_VZ, true) * lag);
    slots.push(p);
  }
  view._wl = { tick: view.tick, bank: view.bank, xs, zs, slots, frames: new Map() };
  return view._wl;
}
function frameOf(crowd, T, W, t) {
  let f = crowd.frames.get(W.w);
  if (f) return f;
  const n = crowd.xs.length, bu = new Float64Array(n), bv = new Float64Array(n), gap = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const [u, v] = toWall(T, W, crowd.xs[i], crowd.zs[i]);
    bu[i] = u; bv[i] = v; gap[i] = gapAt(W, v, Math.max(t, over(W, u)));
  }
  crowd.frames.set(W.w, (f = { bu, bv, gap }));
  return f;
}

// What the ball wants on tick `tick` (the one its word is for), seen from a
// world `tick - view.tick` old: the walls it has seen show (a reaction time
// after they do), the one to reach it first and the one after; a gap of the
// first that it can get to in time and whose lane isn't crowded where it is,
// on the second's lane too where they cross; a spot on that lane clear of
// the balls already on it, inside the stage; and braking onto it. With no
// wall near, where it is, in off the edges.
function plan(view, me, bot, tick) {
  const dv = view.dv, o = view.bank || 0;
  const slot = typeof me === 'number' ? me : me?.slot;
  if (dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY || !(slot >= 0)) return null;
  const rb = L.PLAYERS + o + slot * L.PSIZE;
  if ((view.u8[rb + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) return null;
  const T = table(view);
  if (!(T.h > 0)) return null;
  // where it will be, and when: a Partier has rolled its ball on to the tick its word lands (view.tick + its lag);
  // asked without one, from the view's tick on to `tick`
  // (a Partier rolls at most 40 ticks; past that, on at the speed it has)
  const rolled = !!(bot?.pos && bot.at === tick);
  const ahead = rolled ? clamp(bot.lag | 0, 0, 90) : clamp((tick - view.tick) | 0, 0, 90);
  const t = Math.max(0, (view.tick + ahead - dv.getUint32(L.HDR_START + o, true)) | 0);
  const lag = ahead * TICK, more = rolled ? Math.max(0, ahead - 40) * TICK : 0;
  const mind = mindOf(bot, slot);
  const skill = bot?.skill ?? 0.6;
  const round = dv.getUint32(L.HDR_HOLE + o, true);
  if (mind.round !== round) { mind.round = round; mind.w = -1; mind.gap = -1; mind.yaw = undefined; }
  const vel = [dv.getFloat32(rb + L.P_VX, true), dv.getFloat32(rb + L.P_VZ, true)];
  if (rolled) { vel[0] = bot.vel[0]; vel[1] = bot.vel[1]; }
  const pos = rolled ? [bot.pos[0] + vel[0] * more, bot.pos[1] + vel[1] * more] : [dv.getFloat32(rb + L.P_PX, true) + vel[0] * lag, dv.getFloat32(rb + L.P_PZ, true) + vel[1] * lag];
  const crowd = crowdOf(view, lag);
  // the walls it has seen: shown a reaction time ago (0.15 s to 0.6 s)
  const react = Math.round((0.15 + 0.45 * (1 - skill)) / TICK);
  let first = null, second = null;
  for (const W of T.walls) {
    if (W.start + react > t) break;
    if (t >= W.end) continue;
    const m = meet(T, W, pos[0], pos[1], t);
    if (m.past) continue;
    const e = { W, ...m };
    if (!first || e.eta < first.eta) { second = first; first = e; } else if (!second || e.eta < second.eta) second = e;
  }
  const h = T.h, edge = h - 1.6;
  if (!first || first.eta > 7) {
    // nothing coming soon: where it is, unless that's out near the edge (a wall from that side would be on it at once)
    const k = h * 0.6;
    return { goal: [clamp(pos[0], T.cx - k, T.cx + k), clamp(pos[1], T.cx - k, T.cx + k)], vmax: 5, pos, vel, slot, slack: 1, lag, room: 1, crowd };
  }
  const W = first.W;
  // a gap of the first wall: near, reachable in time, its lane not crowded at this end
  if (mind.w !== W.w) { mind.w = W.w; mind.gap = -1; mind.err = (luck(T, slot, W.w, 3) - 0.5) * W.g * 0.7 * (1 - skill); }
  const pinned = first.eta === 0 && first.now < 0;
  const F = frameOf(crowd, T, W, t);
  const near = new Array(W.k).fill(0);
  for (let i = 0; i < F.gap.length; i++) if (F.gap[i] >= 0 && crowd.slots[i] !== slot && Math.abs(F.bu[i] - first.u) < 6) near[F.gap[i]]++;
  let best = Infinity, pick = mind.gap;
  for (let j = 0; j < W.k; j++) {
    const dv0 = Math.abs(first.v - (pinned ? W.gaps[j] + sway(W, t) : laneAt(W, j, first.u)));
    const need = dv0 > 0.3 ? 2 * Math.sqrt(dv0 / 9) + 0.15 : 0; // s to get there and stop, roughly
    let s = dv0;
    if (need > first.eta + 0.1) s += 20 + dv0;
    if (!pinned) s += 2.2 * near[j];
    if (j === mind.gap) s -= 1.5; // keep to the choice unless another is clearly better
    s += luck(T, slot, W.w, 10 + j) * 2 * (1 - skill);
    if (s < best) { best = s; pick = j; }
  }
  mind.gap = pick;
  // along the lane: in toward the middle (where the next wall, from wherever, takes longest), inside the
  // stage; where a second wall crosses soon, on its lane too
  let along = clamp(first.u * 0.55, first.u - 6, first.u + 6);
  along = clamp(along, -edge, edge);
  if (second && second.W.ux !== W.ux && second.W.uz !== W.uz && second.eta < first.eta + 4 && !pinned) {
    const S = second.W;
    let bj = -1, bd = Infinity;
    for (let j = 0; j < S.k; j++) { const d = Math.abs(second.v - laneAt(S, j, second.u)); if (d < bd) { bd = d; bj = j; } }
    // the second's lane fixes the other world axis near here: the point on the first's lane it crosses
    const [x2, z2] = toWorld(T, S, second.u, laneAt(S, bj, second.u));
    const [cu] = toWall(T, W, x2, z2);
    if (Math.abs(cu - first.u) < 6 + 6 * first.eta) along = clamp(cu, -edge, edge);
  }
  // a spot on the lane clear of the balls already on it
  const taken = (u) => {
    for (let i = 0; i < F.gap.length; i++) {
      if (F.gap[i] !== pick || crowd.slots[i] === slot) continue;
      if (Math.abs(F.bu[i] - u) < 2.3) return true;
    }
    return false;
  };
  if (!pinned && taken(along)) {
    for (let k = 1; k <= 6; k++) {
      const a = clamp(along + 2.4 * k, -edge, edge), b = clamp(along - 2.4 * k, -edge, edge);
      if (!taken(a)) { along = a; break; }
      if (!taken(b)) { along = b; break; }
    }
  }
  // pinned: along the face to the gap's edge now; else onto its lane where it will stand
  if (pinned) along = first.u;
  const lane = pinned ? W.gaps[pick] + sway(W, t) : laneAt(W, pick, along) + mind.err;
  const goal = toWorld(T, W, along, lane);
  return { goal, vmax: first.eta < 1.5 || pinned ? 10 : 7, pos, vel, slot, slack: pinned ? 0 : 0.25, lane, wall: W.w, lag,
    room: pinned || first.eta < 0.5 ? 0.3 : 1, crowd };
}

// Push for the velocity that gets to the goal and stops there: full speed
// while far, braking as it closes (the earlier the longer its word takes to
// land), no keys (the strong idle brake) once there.
// A ball touching another bounces off it (bumper's kick), so it keeps clear
// of the balls round it, the less the more it's in a hurry.
const ROOM = 3.2;
function steer(p, last) {
  const dx = p.goal[0] - p.pos[0], dz = p.goal[1] - p.pos[1], d = Math.hypot(dx, dz);
  const want = Math.min(p.vmax, Math.sqrt(2 * (7 / (1 + 3 * p.lag)) * Math.max(0, d - 0.15)));
  let vx = d > 1e-6 ? (dx / d) * want : 0, vz = d > 1e-6 ? (dz / d) * want : 0;
  let near = false;
  if (p.crowd && p.room > 0) {
    const { xs, zs, slots } = p.crowd;
    for (let i = 0; i < xs.length; i++) {
      if (slots[i] === p.slot) continue;
      const ox = p.pos[0] - xs[i], oz = p.pos[1] - zs[i];
      if (Math.abs(ox) > ROOM || Math.abs(oz) > ROOM) continue;
      const od = Math.hypot(ox, oz);
      if (od >= ROOM || od < 1e-6) continue;
      const k = (4 * p.room * (ROOM - od)) / ROOM / od;
      vx += ox * k; vz += oz * k;
      near = true;
    }
  }
  const ax = vx - p.vel[0], az = vz - p.vel[1];
  if (Math.hypot(ax, az) < 0.7 || (d < p.slack && !near)) return { yaw: last ?? 0, move: 0, hop: 0, use: 0 };
  return { yaw: Math.atan2(az, ax), move: 1, hop: 0, use: 0 };
}

export default {
  id: L.MG_WALL, key: 'wall', name: 'THE WALL',
  hint: 'WALLS SWEEP THE STAGE  GET IN A GAP AND HOLD  LAST ONE ON WINS',
  env: 'sunset',

  draw(view, ctx, out) {
    const T = table(view);
    if (!(T.h > 0)) return;
    const g = view.party();
    const tp = playTime(view, g, ctx);
    if (ctx?.pme) seen = { pme: ctx.pme, ptick: tp, at: ctx.now };
    const sc = out.scene;
    const h = T.h, cx = T.cx;
    const now = (ctx?.now ?? 0) / 1000;
    // the floor, its rim striped
    sc.box(cx, PLAT_Y - PT / 2, cx, h, PT / 2, h, 0, 0.9, 0.87, 0.8, LOOK.CHECKER, 2, 0.8);
    for (const [ox, oz, hx, hz] of [[0, -h + 0.3, h, 0.3], [0, h - 0.3, h, 0.3], [-h + 0.3, 0, 0.3, h - 0.6], [h - 0.3, 0, 0.3, h - 0.6]]) {
      sc.box(cx + ox, PLAT_Y - 0.04, cx + oz, hx, 0.05, hz, 0, 1, 0.78, 0.1, LOOK.HAZARD, 0.5);
    }
    if (tp < 0) return;
    // the wall to reach you next: its posts pulse, its lanes the brighter
    const mine = ctx?.pme || ctx?.me;
    let next = -1, soonest = Infinity;
    const live = onStage(T, tp);
    if (mine && mine.live && !mine.out) {
      for (const W of live) {
        const m = meet(T, W, mine.pos[0], mine.pos[2], tp);
        if (!m.past && m.eta < soonest) { soonest = m.eta; next = W.w; }
      }
    }
    const HH = (L.WL_HIGH + L.WL_DEEP) / 2, YC = PLAT_Y + (L.WL_HIGH - L.WL_DEEP) / 2;
    for (const W of live) {
      const s = face(W, tp), off = sway(W, tp);
      const rise = W.w === 0 ? 1 : clamp((tp - W.start) / RISE, 0, 1), sink = clamp((tp - (W.end - SINK)) / SINK, 0, 1);
      const dy = -6 * (1 - rise) * (1 - rise) - 8 * sink * sink;
      const col = W.colour, seed = (W.w * 131) % 4096;
      // the blocks, a darker cap along each
      blocksAt(T, W, tp).forEach(([lo, hi], i) => {
        wbox(sc, T, W, s - L.WL_T / 2, YC + dy, (lo + hi) / 2, L.WL_T / 2, HH, (hi - lo) / 2, col, LOOK.RUBBER, 0, 0, 1, (seed + i * 17) % 4096);
        wbox(sc, T, W, s - L.WL_T / 2, PLAT_Y + L.WL_HIGH + 0.08 + dy, (lo + hi) / 2, L.WL_T / 2 + 0.06, 0.08, (hi - lo) / 2 + 0.02, col.map((c) => c * 0.55), LOOK.PLASTIC, 0, 0, 1, (seed + i * 17 + 5) % 4096);
      });
      // the gaps: posts lit at their edges
      const glow = 1.5 + 0.8 * (W.w === next ? 0.5 + 0.5 * Math.sin(now * 8) : 0);
      for (const c of W.gaps) for (const e of [c + off - W.g / 2, c + off + W.g / 2]) {
        wbox(sc, T, W, s - L.WL_T / 2, YC + 0.06 + dy, e, L.WL_T / 2 + 0.05, HH + 0.06, 0.1, POST, LOOK.GLOW, glow, 0.2);
      }
      // the lanes the gaps will sweep, from the face to the far edge (a swaying wall's in short pieces, snaking)
      const u0 = Math.max(s + 0.1, -h + 0.05);
      if (u0 < h - 0.2 && rise > 0.5 && sink === 0) {
        const bright = W.w === next ? 1 : 0.55;
        const rgb = lift(col, 0.35), a = 0.55 * bright, alpha = 0.3 + 0.25 * bright;
        for (let j = 0; j < W.k; j++) {
          if (!W.a) {
            const len = (h - u0) / 2;
            wbox(sc, T, W, u0 + len, PLAT_Y + 0.012, W.gaps[j], len, 0.012, W.g * 0.42, rgb, LOOK.GLOW, a, 0.6, alpha);
            continue;
          }
          const n = Math.max(1, Math.ceil((h - u0) / 1.2));
          let pu = u0, pv = laneAt(W, j, u0);
          for (let i = 1; i <= n; i++) {
            const u = u0 + ((h - u0) * i) / n, v = laneAt(W, j, u);
            bar(sc, T, W, pu, pv, u, v, W.g * 0.42, PLAT_Y + 0.012, rgb, a, alpha);
            pu = u; pv = v;
          }
        }
      }
      if (tp < W.go) {
        // waiting at its edge: the edge pulses, and chevrons in each lane point the way it comes
        const k = (tp - W.start) / Math.max(1, W.go - W.start);
        const pulse = 0.5 + 0.5 * Math.sin(now * 10 + k * 6);
        wbox(sc, T, W, -h + 0.75, PLAT_Y + 0.02, 0, 0.15, 0.02, h, lift(col, 0.4), LOOK.GLOW, 1 + pulse, 0.3, 0.6);
        for (let j = 0; j < W.k; j++) for (let n = 0; n < 3; n++) {
          const u = -h + 2.2 + n * 1.6 + 1.2 * ((now * 1.5) % 1), c = laneAt(W, j, u);
          const al = Math.min(1, (u + h) / 2) * (1 - n / 3.2) * (0.4 + 0.6 * pulse);
          bar(sc, T, W, u - 0.7, c - 0.7, u, c, 0.09, PLAT_Y + 0.03, lift(col, 0.5), 1.2, al * 0.65);
          bar(sc, T, W, u - 0.7, c + 0.7, u, c, 0.09, PLAT_Y + 0.03, lift(col, 0.5), 1.2, al * 0.65);
        }
      }
    }
    // the next wall still to show, within 1.5 s: a faint line at its edge
    for (const W of T.walls) {
      if (W.start <= tp) continue;
      if (W.start - tp < 190) wbox(sc, T, W, -h + 0.75, PLAT_Y + 0.02, 0, 0.12, 0.02, h, lift(W.colour, 0.4), LOOK.GLOW, 0.5, 0.3, 0.3 * (1 - (W.start - tp) / 190));
      break;
    }
  },

  frame(view) {
    const T = table(view), g = view.party();
    const h = T.h > 0 ? T.h : g.size, cx = T.h > 0 ? T.cx : g.cx;
    return { centre: [cx, PLAT_Y, cx], radius: h, shape: 'square' };
  },

  // facing the side the first wall comes from, so it's seen coming
  facing(view) {
    const W = table(view).walls[0];
    return W ? Math.atan2(-W.uz, -W.ux) : undefined;
  },

  fx(f, ctx) {
    const T = ctx.view ? table(ctx.view) : null;
    const W = T?.walls[f.shot & 255];
    const me = ctx.slot >= 0 && ctx.view ? ctx.view.bumper(ctx.slot) : null;
    const playing = me?.live && !me.out;
    if (f.kind === L.WL_FX_SHOW && W) {
      // where it comes from, as you face
      let where = `FROM THE ${FROM[W.side]}`;
      if (playing) {
        const ox = -W.ux, oz = -W.uz, a = me.yaw;
        const ahead = Math.cos(a) * ox + Math.sin(a) * oz, right = -Math.sin(a) * ox + Math.cos(a) * oz;
        where = ahead > 0.7 ? 'AHEAD' : ahead < -0.7 ? 'BEHIND YOU' : right > 0 ? 'FROM YOUR RIGHT' : 'FROM YOUR LEFT';
      }
      ctx.banner?.(`WALL ${W.w + 1}  ${where}${W.a ? '  SWAYING' : ''}`, W.a ? C.PURPLE : W.w === 0 ? C.YELLOW : C.ORANGE, 1400);
      ctx.sound?.tick?.();
    } else if (f.kind === L.WL_FX_GO) {
      ctx.sound?.land?.(Math.min(24, 240 / ((ctx.dist ?? 0) + 10)));
    } else if (f.kind === L.WL_FX_PIN) {
      const mine = f.owner === ctx.slot;
      if (mine || (ctx.dist ?? 0) < 25) ctx.sound?.boing?.(f.size, mine ? 0 : ctx.dist ?? 0);
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 1.2, color: [1, 0.9, 0.6, 0.8], kind: SPRITE.SPARK, life: 260 });
    } else if (f.kind === L.WL_FX_GONE) {
      if (playing) ctx.sound?.tick?.();
    }
  },

  // the wall on, its speed and gaps, the walls you've seen go by; and how you stand with the one to reach you next
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const T = table(view);
    if (!(T.h > 0)) return;
    const tp = typeof ctx.t === 'number' && ctx.t > 0 ? ctx.t / TICK : g.t;
    let cur = null;
    for (const W of T.walls) { if (W.start > tp) break; cur = W; }
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const playing = me && me.live && !me.out;
    if (cur) {
      ctx.right(3, `WALL ${cur.w + 1}  ${cur.v.toFixed(1)} M/S  ${cur.k} ${cur.k === 1 ? 'GAP' : 'GAPS'}${cur.a ? '  SWAYING' : ''}` + (playing ? `  CLEARED ${passed(view, me.slot)}` : ''), C.GREY);
    }
    if (!playing) return;
    // your ball as the prediction has it, if draw has just seen it
    const fresh = seen.pme && seen.at === ctx.now;
    const p = fresh ? seen.pme : me, t = fresh ? seen.ptick : tp;
    let first = null;
    for (const W of onStage(T, t)) {
      const m = meet(T, W, p.pos[0], p.pos[2], t);
      if (!m.past && (!first || m.eta < first.eta)) first = m;
    }
    if (!first || first.eta > 3) return;
    const row = Math.max(3, Math.floor((ctx.rows || 40) * 0.18));
    if (first.eta === 0 && first.now < 0) ctx.centre(row, 'PINNED  SLIDE INTO A GAP', C.RED);
    else if (first.gap >= 0) ctx.centre(row, 'IN A GAP  HOLD IT', C.GREEN);
    else ctx.centre(row, `GET IN A GAP  ${first.eta.toFixed(1)}`, first.eta < 1 ? C.RED : C.YELLOW);
  },

  brain: {
    // off the square is a fall; against a block on that tick nearly as bad
    // (it carries you to the edge unless a gap comes); just ahead of a face, a warning
    danger(view, x, z, tick) {
      const o = view.bank || 0;
      if (view.dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY) return 0;
      const T = table(view);
      const dx = Math.abs(x - T.cx), dz = Math.abs(z - T.cx);
      if (dx > T.h || dz > T.h) return 1;
      const t = Math.max(0, (tick - view.dv.getUint32(L.HDR_START + o, true)) | 0);
      let d = Math.max(dx, dz) > T.h - 1 ? 0.2 : 0;
      for (const W of T.walls) {
        if (W.start > t) break;
        if (t >= W.end) continue;
        const [u, v] = toWall(T, W, x, z), s = face(W, t);
        if (u + B_RAD <= s - L.WL_T || u - B_RAD >= s + 1.5 || gapAt(W, v, t) >= 0) continue;
        if (u - B_RAD < s) return 0.9;
        if (t >= W.go) d = Math.max(d, 0.5);
      }
      return d;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot, view.tick);
      return p ? p.goal : null;
    },
    hop() { return false; },
    // all of it, as a word's fields (yaw in radians, as client/party-bot.mjs takes it)
    think(view, me, bot, tick = view.tick) {
      const p = plan(view, me, bot, tick);
      if (!p) return null;
      const mind = mindOf(bot, p.slot);
      const s = steer(p, mind.yaw);
      mind.yaw = s.yaw;
      return s;
    },
  },
};
