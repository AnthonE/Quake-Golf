// MUSICAL PADS, as drawn and as the AI ball sees it. The floor is a giant
// record, black and grooved, its label turning while the music plays; when it
// stops the record slows to a halt and the pads light, glowing discs under
// spotlights, each in the colour of the ball that would hold it if the claim
// were now (the sim's rule, worked here on the balls as drawn), the gold one
// under a spinning coin. At the claim the balls left without a pad drop
// through trapdoors; the ring the floor is about to lose turns to hazard
// stripes and crumbles away. The schedule is the sim's (src/mg/pads.wat) read
// from its header and drawn on the prediction's clock, so a pad lights on the
// same tick of your own ball whatever your lag.
import * as L from '../../src/layout.mjs';
import { PLAT_Y } from '../../src/party-view.mjs';
import { LOOK, SPRITE, DECAL, COLS } from '../party-render.mjs';
import { C } from '../font.mjs';

const f = Math.fround;
const TICK = 0.008;
const PAD_R = f(L.MP_PAD_R);
const PAD_R2 = f(PAD_R * PAD_R);
const HIGH = f(PLAT_Y + L.MP_HIGH);
const HH = 0.7; // the record's half thickness, m
const BALL_R = 1;
const MUSIC = 0, SCRAMBLE = 1, PAUSE = 2;
// a ball's colour, as the frontend's slotColor has it
const slotColor = (s) => { const h = (s * 0.618034) % 1; return [0, 0.33, 0.67].map((o) => 0.55 + 0.4 * Math.cos(6.2832 * (h + o))); };
const FREE = [0.55, 0.95, 1];
const GOLD = [1, 0.78, 0.18];
const LABELS = [[0.92, 0.3, 0.2], [0.2, 0.55, 0.95], [0.95, 0.75, 0.15], [0.3, 0.8, 0.45], [0.75, 0.3, 0.85]];

// ---- the sim's header and pads, read as they are

// The round's floor and its cycle on the view's bank (PG_H), and where play started.
export function stage(view) {
  const dv = view.dv, o = view.bank || 0;
  const u = (k) => dv.getUint32(L.PG_H + k + o, true), r = (k) => dv.getFloat32(L.PG_H + k + o, true);
  return {
    r0: r(L.MP_R), rimA: r(L.MP_RIMA), rimB: r(L.MP_RIMB), rimT: u(L.MP_RIMT), cycle: u(L.MP_CYCLE), start: u(L.MP_START),
    stop: u(L.MP_STOP), claim: u(L.MP_CLAIM), next: u(L.MP_NEXT), npad: Math.min(u(L.MP_NPAD), L.MP_NMAX), gold: u(L.MP_GOLD),
    glides: u(L.MP_GLIDES), n: u(L.MP_N), held: u(L.MP_HELD), lost: u(L.MP_LOST),
    cx: dv.getFloat32(L.PG_CX + o, true), t0: dv.getUint32(L.HDR_START + o, true), state: dv.getUint32(L.HDR_STATE + o, true),
  };
}
// Pads for n balls ($mp_pads).
export const padsFor = (n) => (n <= L.MP_CHAIRS ? Math.max(1, n - 1) : (n + 1) >> 1);
// The rim on tick t into play ($mp_rim), in f32 on whole ticks; fractional t eases between them for drawing.
export function rimAt(st, t) {
  if (t <= st.rimT) return st.rimA;
  if (t - st.rimT >= L.MP_SHRINKT) return st.rimB;
  if (t !== Math.floor(t)) return st.rimA + (st.rimB - st.rimA) * (t - st.rimT) / L.MP_SHRINKT;
  return f(f(f(st.rimB - st.rimA) * f((t - st.rimT) / L.MP_SHRINKT)) + st.rimA);
}
// What tick t into play is: the music, the scramble or the pause after a claim
// (and past the next cycle's start, before the confirmed world has laid it out, its music).
export const phaseOf = (st, t) => (t < st.stop ? MUSIC : t < st.claim ? SCRAMBLE : t < st.next ? PAUSE : MUSIC);
export const PHASE = { MUSIC, SCRAMBLE, PAUSE };
// The cycle's pads (PG_S, the confirmed world's): where each lights, where it is at the claim, who held it then.
export function padsOf(view, st = stage(view)) {
  const dv = view.dv, out = [];
  for (let i = 0; i < st.npad; i++) {
    const a = L.PG_S + L.MP_PADS + 16 * i;
    out.push({ i, x0: dv.getFloat32(a, true), z0: dv.getFloat32(a + 4, true), x1: dv.getFloat32(a + 8, true), z1: dv.getFloat32(a + 12, true),
      held: view.u8[L.PG_S + L.MP_HOLD + i], gold: i === st.gold });
  }
  return out;
}
// Pad p's centre on tick t into play: gliding from where it lit to where the claim finds it.
export function padAt(st, p, t) {
  const k = Math.max(0, Math.min(1, (t - st.stop) / Math.max(1, st.claim - st.stop)));
  return [p.x0 + (p.x1 - p.x0) * k, p.z0 + (p.z1 - p.z0) * k];
}
// The claims the sim made, as $mp_claim makes them, of balls at pos(p) -> [x, y, z] or null (not in):
// each pad in turn to the nearest ball with its centre on it, near the floor, no pad yet. -> holder per pad, 255 none.
export function claims(pads, centres, pos) {
  const hold = new Uint8Array(pads.length).fill(255), taken = new Uint8Array(L.NPLAYER);
  const at = [];
  for (let p = 0; p < L.NPLAYER; p++) at.push(pos(p));
  for (let i = 0; i < pads.length; i++) {
    const [x, z] = centres[i];
    let best = -1, bd = PAD_R2;
    for (let p = 0; p < L.NPLAYER; p++) {
      const b = at[p];
      if (!b || taken[p] || b[1] > HIGH) continue;
      const dx = f(b[0] - x), dz = f(b[2] - z), d2 = f(f(dx * dx) + f(dz * dz));
      if (d2 < bd) { bd = d2; best = p; }
    }
    if (best >= 0) { hold[i] = best; taken[best] = 1; }
  }
  return hold;
}
// The claims slot p has lived through this round (MP_WON, the confirmed world's).
export const survived = (view, p) => view.u8[L.PG_S + L.MP_WON + p];
// Is the ball at record b in (live, not out, not falling)?
const inAt = (view, b) => (view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) === L.PF_LIVE;

// Ticks into play to draw at, on the prediction's clock (fractional), or -1 before play; frozen where the round ended.
function playTime(view, g, ctx) {
  if (g.state !== L.H_PLAY && g.state !== L.H_OVER) return -1;
  let t = typeof ctx?.ptick === 'number' ? ctx.ptick - g.start : g.t + (ctx?.dt || 0) / TICK;
  if (g.state === L.H_OVER) t = Math.min(t, (g.until - L.P_OVER - g.start) | 0);
  return Math.max(0, t);
}

// ---- drawing

const look = { spin: 0, w: 0, at: -1, tp: -1, me: null }; // the record's turn, the last frame's clock and ball (for the HUD)

// The record: the floor to the rim (hazard stripes on the ring it is about to
// lose), grooves, the label turning, the ring it lost crumbling away.
function record(out, st, tp, now) {
  const sc = out.scene, cx = st.cx;
  const rim = tp < 0 ? st.r0 : rimAt(st, tp);
  const warn = tp >= 0 && st.rimB < st.rimA && tp >= st.rimT - L.MP_SHRINK0 && rim > st.rimB + 0.01;
  const inner = warn ? st.rimB : rim;
  sc.cyl(cx, PLAT_Y - HH, cx, inner, HH, 0.035, 0.035, 0.045, LOOK.RUBBER);
  if (warn) sc.cyl(cx, PLAT_Y - HH - 0.01, cx, rim, HH, 0.9, 0.22, 0.12, LOOK.HAZARD, 0.9);
  // the grooves, faintly lit, pulsing with the music
  const beat = look.w > 0.3 ? 0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 4) : 0;
  const lab = Math.max(3, Math.min(9, st.r0 * 0.22));
  for (let r = lab + 1.4; r < inner - 0.6; r += 2.2) {
    out.decals.push({ pos: [cx, PLAT_Y + 0.01, cx], radius: r, width: 0.12, color: [0.42, 0.45, 0.6, 0.12 + 0.1 * beat * look.w], kind: DECAL.RING });
  }
  // the label, its print turning with the record, a hole in the middle
  const [lr, lg, lb] = LABELS[st.cycle % LABELS.length] || LABELS[0];
  sc.cyl(cx, PLAT_Y + 0.005, cx, lab, 0.02, lr, lg, lb, LOOK.MATTE);
  const a = look.spin;
  for (let k = 0; k < 2; k++) {
    const b = a + k * Math.PI, d = lab * 0.55;
    sc.box(cx + Math.cos(b) * d, PLAT_Y + 0.03, cx + Math.sin(b) * d, lab * 0.28, 0.01, lab * 0.07, b, 0.98, 0.94, 0.82, LOOK.MATTE, 0, 0, 1, 7 + k);
    sc.box(cx + Math.cos(b + 0.5) * d * 0.7, PLAT_Y + 0.03, cx + Math.sin(b + 0.5) * d * 0.7, lab * 0.16, 0.01, lab * 0.04, b + 0.5, 0.98, 0.94, 0.82, LOOK.MATTE, 0, 0, 1, 9 + k);
  }
  sc.cyl(cx, PLAT_Y + 0.02, cx, 0.45, 0.03, 0.6, 0.62, 0.66, LOOK.METAL);
  // what the rim lost: pieces dropping from where it passed, tumbling, for a second
  if (tp >= 0 && st.rimB < st.rimA && tp > st.rimT) {
    const span = st.rimA - st.rimB;
    for (let r = st.rimA - 0.75; r > st.rimB; r -= 1.5) {
      const passed = st.rimT + L.MP_SHRINKT * (st.rimA - r) / span;
      const age = (tp - passed) * TICK;
      if (age < 0 || age > 1.1) continue;
      const m = Math.max(12, Math.round(2 * Math.PI * r / 3));
      const y = PLAT_Y - HH - 0.5 * 22 * age * age;
      for (let j = 0; j < m; j++) {
        const b = (j + 0.5) / m * 2 * Math.PI + r;
        sc.box(cx + Math.cos(b) * r, y, cx + Math.sin(b) * r, 0.7, HH, Math.PI * r / m * 0.92, b + age * ((j & 3) - 1.5), 0.9, 0.22, 0.12, LOOK.HAZARD, 0.9, 0, 1 - age / 1.1, j);
      }
    }
  }
  return rim;
}

// The tonearm on its post off the rim: level, its needle down on the outer
// groove while the music plays, lifted clear when it stops.
function tonearm(out, st, rim, lift) {
  const sc = out.scene, cx = st.cx, R = st.r0;
  const ab = -Math.PI / 4; // the post's bearing from the middle
  const bx = cx + Math.cos(ab) * (R + 7), bz = cx + Math.sin(ab) * (R + 7);
  const top = PLAT_Y + 4 + 2.5 * lift;
  sc.cyl(bx, (top + PLAT_Y - 3) / 2, bz, 2.2, (top - PLAT_Y + 3) / 2, 0.55, 0.57, 0.62, LOOK.METAL);
  const at = ab + 0.32 - 0.06 * lift, rr = rim - 1.2 + 1.5 * lift;
  const tx = cx + Math.cos(at) * rr, tz = cx + Math.sin(at) * rr;
  const dx = tx - bx, dz = tz - bz, yaw = Math.atan2(dz, dx);
  sc.box((bx + tx) / 2, top, (bz + tz) / 2, Math.hypot(dx, dz) / 2, 0.3, 0.3, yaw, 0.8, 0.82, 0.86, LOOK.METAL, 0, 0, 1, 40);
  sc.box(tx, top - 0.2, tz, 0.9, 0.45, 0.6, yaw, 0.12, 0.12, 0.14, LOOK.PLASTIC, 0, 0, 1, 41);
  sc.box(tx, top - 2.3, tz, 0.08, 1.7, 0.08, yaw, 0.8, 0.82, 0.86, LOOK.METAL, 0, 0, 1, 42);
}

// The pads as they stand on tick tp, each lit in its holder's colour (the claim if it were now), or free.
function pads(view, ctx, out, st, tp, ph) {
  const list = padsOf(view, st);
  const cam = ctx.cam;
  if (!list.length) return;
  const centres = list.map((p) => padAt(st, p, Math.min(tp, st.claim)));
  let hold;
  if (ph === PAUSE && tpDone(view, st)) hold = Uint8Array.from(list, (p) => p.held);
  else {
    const me = ctx.pme && !ctx.pme.out ? ctx.pme : null;
    const dt = ctx.dt || 0;
    hold = claims(list, centres, (p) => {
      if (me && p === ctx.slot) return me.pos;
      const b = L.PLAYERS + p * L.PSIZE;
      if (!inAt(view, b)) return null;
      const d = view.dv;
      return [d.getFloat32(b + L.P_PX, true) + d.getFloat32(b + L.P_VX, true) * dt, d.getFloat32(b + L.P_PY, true), d.getFloat32(b + L.P_PZ, true) + d.getFloat32(b + L.P_VZ, true) * dt];
    });
  }
  const left = ph === SCRAMBLE ? Math.max(0, st.claim - tp) : 0;
  const urgency = ph === SCRAMBLE ? 1 - left / Math.max(1, st.claim - st.stop) : 1;
  const pulse = 0.5 + 0.5 * Math.sin(tp * TICK * Math.PI * 2 * (1.5 + 5 * urgency));
  const born = ph === SCRAMBLE ? Math.min(1, (tp - st.stop) / 12) : 1;
  const fade = ph === PAUSE ? Math.max(0, 1 - (tp - st.claim) / L.MP_PAUSE) : 1;
  for (let i = 0; i < list.length; i++) {
    const p = list[i], [x, z] = centres[i], h = hold[i];
    const rgb = h !== 255 ? slotColor(h) : p.gold ? GOLD : FREE;
    if (ph === PAUSE && h === 255) {
      // nobody held it: it goes dark
      out.scene.cyl(x, PLAT_Y + 0.03, z, PAD_R * 0.98, 0.05, rgb[0] * 0.4, rgb[1] * 0.4, rgb[2] * 0.4, LOOK.GLOW, 0.2 * fade, 0.3, Math.max(0.05, fade));
      continue;
    }
    const glow = h !== 255 ? 0.85 + 0.25 * pulse : 0.55 + 0.55 * pulse;
    out.scene.cyl(x, PLAT_Y + 0.03 + 0.12 * (1 - born), z, PAD_R * 0.98 * (0.4 + 0.6 * born), 0.05, rgb[0], rgb[1], rgb[2], LOOK.GLOW, glow, 0.35);
    out.decals.push({ pos: [x, PLAT_Y + 0.09, z], radius: PAD_R + 0.45, width: 0.22 + 0.12 * urgency, color: [...rgb, (0.55 + 0.45 * pulse) * fade], kind: DECAL.RING });
    if (h === 255 && ph === SCRAMBLE) {
      // a spotlight on a free pad, faint, and gone near the eye
      const near = cam ? Math.max(0, Math.min(1, (Math.hypot(x - cam[0], z - cam[2]) - 5) / 15)) : 1;
      if (near > 0) out.beams.push({ a: [x, PLAT_Y + 34, z], b: [x, PLAT_Y + 0.15, z], width: 0.9, color: [...rgb, (0.1 + 0.06 * pulse) * near] });
    }
    if (p.gold) out.solid.push({ pos: [x, PLAT_Y + 4.4 + 0.25 * Math.sin(tp * TICK * 3), z], size: 0.8, color: [1, 0.82, 0.25, 1], kind: SPRITE.COIN, roll: tp * TICK * 4, minpx: 2 });
  }
}
// Has the confirmed world made this cycle's claim (so MP_HOLD is its)? It makes it on the step that plays tick claim.
const tpDone = (view, st) => (view.party().t | 0) > st.claim;

// The balls a claim put out, dropping through trapdoors where they stood, for a second.
function trapdoors(view, ctx, out) {
  const now = ctx.tick + (ctx.dt || 0) / TICK;
  const d = view.dv;
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + p * L.PSIZE;
    if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== (L.PF_LIVE | L.PF_DEAD)) continue;
    const age = (now - d.getUint32(b + L.B_OUTAT, true)) * TICK;
    const y0 = d.getFloat32(b + L.P_PY, true);
    if (age < 0 || age > 1.2 || y0 < PLAT_Y - 2) continue;
    const x = d.getFloat32(b + L.P_PX, true), z = d.getFloat32(b + L.P_PZ, true);
    out.decals.push({ pos: [x, PLAT_Y + 0.02, z], radius: 1.35, width: 0.3, color: [0, 0, 0, 0.95 * (1 - age / 1.2)], kind: DECAL.DISC });
    if (age > 0.9) continue;
    const y = y0 - 0.5 * 24 * age * age;
    const col = [...slotColor(p), 1];
    out.solid.push({ pos: [x, y + BALL_R, z], size: BALL_R, color: col, kind: SPRITE.BALL, minpx: 1, vel: [0, 0, 0], roll: 0, seed: p });
    out.solid.push({ pos: [x, y + 2 * BALL_R + 0.22, z], size: 0.34, color: col, kind: SPRITE.BODY, minpx: 1 });
    out.solid.push({ pos: [x, y + 2 * BALL_R + 0.78, z], size: 0.3, color: col, kind: SPRITE.HEAD, minpx: 1, vel: [1, 0, 0] });
  }
}

// ---- the AI ball

const MINDS = new WeakMap();
const SLOT_MINDS = [];
function mindOf(bot, slot) {
  if (bot && typeof bot === 'object') {
    if (bot.mem && typeof bot.mem === 'object') return (bot.mem.mp ||= { c: -1 });
    let m = MINDS.get(bot);
    if (!m) MINDS.set(bot, (m = { c: -1 }));
    return m;
  }
  return (SLOT_MINDS[slot] ||= { c: -1 });
}
// A number in [0, 1) for this ball, this cycle and k: its own luck.
const luck = (slot, c, k, s) => (((Math.imul(slot * 977 + k, 0x9e3779b1) ^ Math.imul(c + 1, 0x85ebca6b) ^ s) >>> 0) % 100003) / 100003;
// The pads and who's nearest each, once per world tick (shared by every bot looking at it), and the pads the bots make for.
let world = null;
function worldOf(view, st) {
  const key = `${view.tick}:${view.bank || 0}:${st.cycle}:${st.npad}`;
  if (world?.key === key && world.buf === view.dv.buffer) return world;
  const list = padsOf(view, st);
  const t = Math.max(0, (view.tick - st.t0) | 0);
  const at = list.map((p) => padAt(st, p, Math.min(t, st.claim)));
  const n1 = new Float64Array(list.length).fill(1e9), s1 = new Int16Array(list.length).fill(-1), n2 = new Float64Array(list.length).fill(1e9);
  const balls = [];
  const d = view.dv;
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + (view.bank || 0) + p * L.PSIZE;
    if (!inAt(view, b)) continue;
    balls.push([p, d.getFloat32(b + L.P_PX, true), d.getFloat32(b + L.P_PZ, true)]);
  }
  for (let i = 0; i < list.length; i++) {
    const [x, z] = at[i];
    for (const [p, bx, bz] of balls) {
      const dd = Math.hypot(bx - x, bz - z);
      if (dd < n1[i]) { n2[i] = n1[i]; n1[i] = dd; s1[i] = p; } else if (dd < n2[i]) n2[i] = dd;
    }
  }
  const keep = world && world.cycleKey === `${st.t0}:${st.cycle}` ? world.claimed : new Uint16Array(L.MP_NMAX);
  world = { key, buf: view.dv.buffer, list, at, n1, s1, n2, balls, claimed: keep, cycleKey: `${st.t0}:${st.cycle}` };
  return world;
}

// What the ball wants on tick `tick` (the one its word is for): where to be,
// how fast, and whether to brake there. Through the music it idles round a
// spot in the middle of the floor, clear of the rim to come and of the crowd;
// once the music stops (and it notices: a reaction time by its skill) it
// makes for the pad it would reach first, not one a rival is nearer, nor one
// the other AI balls are making for, the gold one if it's close; if every pad
// is someone else's it goes to shove the nearest holder off.
function plan(view, me, bot, tick) {
  const dv = view.dv, o = view.bank || 0;
  const slot = typeof me === 'number' ? me : me?.slot;
  if (dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY || !(slot >= 0)) return null;
  const rb = L.PLAYERS + o + slot * L.PSIZE;
  if ((view.u8[rb + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) return null;
  const st = stage(view);
  if (!(st.r0 > 0)) return null;
  const t = Math.max(0, (tick - st.t0) | 0);
  const ph = phaseOf(st, t);
  const skill = bot?.skill ?? 0.6;
  const mind = mindOf(bot, slot);
  const lag = Math.max(0, Math.min(40, (tick - view.tick) | 0)) * TICK;
  const vel = bot?.vel ? [bot.vel[0], bot.vel[1]] : [dv.getFloat32(rb + L.P_VX, true), dv.getFloat32(rb + L.P_VZ, true)];
  const pos = bot?.pos ? [bot.pos[0], bot.pos[1]] : [dv.getFloat32(rb + L.P_PX, true) + vel[0] * lag, dv.getFloat32(rb + L.P_PZ, true) + vel[1] * lag];
  const seed = dv.getUint32(L.HDR_SEED + o, true);
  if (mind.c !== st.cycle || mind.t0 !== st.t0) {
    mind.c = st.cycle;
    mind.t0 = st.t0;
    mind.react = st.stop + Math.round((0.15 + 0.55 * (1 - skill) * luck(slot, st.cycle, 1, seed)) / TICK);
    mind.target = -1;
    mind.at = -1e9;
    mind.wander = null;
  }
  const safe = Math.max(2, Math.min(rimAt(st, t), st.rimB) - 2.5);
  const w = worldOf(view, st);
  if (ph !== SCRAMBLE || t < mind.react) {
    // idle about the floor: a spot within 0.75 of the floor to come, a new one every few seconds, the least crowded of a few
    if (!mind.wander || t - mind.wander.at > 250 + 250 * luck(slot, st.cycle, 5 + (mind.wander.n || 0), seed) || Math.hypot(mind.wander.x - pos[0], mind.wander.z - pos[1]) < 1.5) {
      const n = (mind.wander?.n || 0) + 1;
      let best = null, bs = Infinity;
      for (let k = 0; k < 4; k++) {
        const r = safe * 0.75 * Math.sqrt(luck(slot, n, 10 + k, seed)), a = 2 * Math.PI * luck(slot, n, 20 + k, seed);
        const x = st.cx + Math.cos(a) * r, z = st.cx + Math.sin(a) * r;
        let crowd = 0;
        for (const [, bx, bz] of w.balls) { const dd = Math.hypot(bx - x, bz - z); if (dd < 5) crowd += 5 - dd; }
        const s = crowd + Math.hypot(x - pos[0], z - pos[1]) * 0.1;
        if (s < bs) { bs = s; best = { x, z }; }
      }
      mind.wander = { ...best, at: t, n };
    }
    // past the floor to come: straight in
    const rho = Math.hypot(pos[0] - st.cx, pos[1] - st.cx);
    if (rho > safe) return { goal: [st.cx + (pos[0] - st.cx) / rho * safe * 0.7, st.cx + (pos[1] - st.cx) / rho * safe * 0.7], vmax: 9, pvel: [0, 0], pos, vel, slot };
    return { goal: [mind.wander.x, mind.wander.z], vmax: 2.5 + 2 * luck(slot, st.cycle, 3, seed), pvel: [0, 0], pos, vel, slot };
  }
  // the scramble: choose (again every 8 ticks) the pad to make for
  const list = w.list;
  if (!list.length) return { goal: [st.cx, st.cx], vmax: 4, pvel: [0, 0], pos, vel, slot };
  const T = st.claim - st.stop;
  const remain = (st.claim - t) * TICK;
  if (mind.target < 0 || t - mind.at >= 8 || mind.target >= list.length) {
    mind.at = t;
    const mine = mind.target >= 0 && mind.target < list.length ? mind.target : -1;
    let best = -1, bs = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const d0 = Math.hypot(w.at[i][0] - pos[0], w.at[i][1] - pos[1]);
      const eta = d0 / 7 + 0.2;
      const [x, z] = padAt(st, p, Math.min(st.claim, t + eta / TICK));
      const d = Math.hypot(x - pos[0], z - pos[1]);
      const rival = w.s1[i] === slot ? w.n2[i] : w.n1[i];
      let s = d / 7 + 0.2;
      if (s > remain + 0.15) s += 4 + s;
      if (rival < d - 0.8) s += 1.6 + 0.25 * (d - rival); // someone gets there first
      if (rival < PAD_R && d > 2.5) s += 3; // someone is on it already
      if (w.s1[i] === slot && d < 4) s -= 1; // nearest, and nearly there: mine
      s += 2 * Math.max(0, w.claimed[i] - (i === mine ? 1 : 0)); // another AI ball is making for it
      if (i === mine) s -= 0.5;
      if (p.gold) s -= 0.6 * skill;
      s += 0.3 * (1 - skill) * luck(slot, st.cycle, 100 + i, seed);
      if (s < bs) { bs = s; best = i; }
    }
    if (best !== mine) {
      if (mine >= 0 && w.claimed[mine]) w.claimed[mine]--;
      if (best >= 0) w.claimed[best]++;
    }
    mind.target = best;
  }
  const i = mind.target, p = list[i];
  const d0 = Math.hypot(w.at[i][0] - pos[0], w.at[i][1] - pos[1]);
  const lead = Math.min(st.claim, t + Math.min(60, d0 / 7 / TICK));
  const goal = padAt(st, p, lead);
  const pvel = st.glides && t < st.claim ? [(p.x1 - p.x0) / (T * TICK), (p.z1 - p.z0) / (T * TICK)] : [0, 0];
  // someone else is on it: wait a few metres off, and charge through it at the last moment, as a player would
  const rival = w.s1[i] !== slot && w.n1[i] < PAD_R && w.n1[i] < d0 - 1;
  const charge = 0.9 + 0.5 * luck(slot, st.cycle, 7, seed);
  if (rival && remain > charge + d0 / 9) {
    const k = Math.min(1, 4 / Math.max(d0, 1e-3));
    return { goal: [goal[0] + (pos[0] - goal[0]) * k, goal[1] + (pos[1] - goal[1]) * k], vmax: 6, pvel, pos, vel, slot };
  }
  return { goal, vmax: 10, pvel, pos, vel, slot };
}

// Push for the velocity that gets to the goal and stops there (riding a
// gliding pad's own velocity): full speed while far, braking as it closes,
// no keys once it's there (the floor's strong braking).
function steer(p, last) {
  const dx = p.goal[0] - p.pos[0], dz = p.goal[1] - p.pos[1], d = Math.hypot(dx, dz);
  const want = Math.min(p.vmax, Math.sqrt(2 * 6.5 * Math.max(0, d - 0.15)));
  const vx = (d > 1e-6 ? (dx / d) * want : 0) + p.pvel[0], vz = (d > 1e-6 ? (dz / d) * want : 0) + p.pvel[1];
  const ax = vx - p.vel[0], az = vz - p.vel[1];
  if (Math.hypot(ax, az) < 0.6) return { yaw: last ?? 0, move: 0, hop: 0, use: 0 };
  return { yaw: Math.atan2(az, ax), move: 1, hop: 0, use: 0 };
}

export default {
  id: L.MG_PADS, key: 'pads', name: 'MUSICAL PADS',
  hint: 'WHEN THE MUSIC STOPS GET ON A PAD  ONE BALL A PAD  THE REST ARE OUT',
  env: 'night',

  draw(view, ctx, out) {
    const st = stage(view);
    if (!(st.r0 > 0)) return;
    const g = view.party();
    const tp = playTime(view, g, ctx);
    const ph = tp < 0 ? MUSIC : phaseOf(st, tp);
    const now = ctx?.now ?? 0;
    // the record turns with the music, slows to a halt when it stops
    const ms = Math.min(100, Math.max(0, ctx?.ms ?? 16));
    const want = tp < 0 ? 0.25 : ph === MUSIC && g.state === L.H_PLAY ? 1 : 0;
    look.w += (want - look.w) * (want > look.w ? Math.min(1, ms / 400) : Math.min(1, ms / 220));
    look.spin = (look.spin + look.w * 1.1 * ms / 1000) % (2 * Math.PI * 64);
    look.tp = tp;
    look.me = ctx?.pme && !ctx.pme.out ? ctx.pme : ctx?.me ?? null;
    look.at = now;
    const rim = record(out, st, tp, now);
    tonearm(out, st, rim, 1 - look.w);
    if (tp < 0) return;
    if (ph === SCRAMBLE || ph === PAUSE) pads(view, ctx, out, st, tp, ph);
    else if (look.w > 0.2) {
      // the music: a few coloured lights sweeping the floor
      for (let k = 0; k < 6; k++) {
        const a = now / 1000 * (0.35 + 0.07 * k) * (k & 1 ? 1 : -1) + k * 1.7, r = rim * (0.25 + 0.11 * k);
        const c = LABELS[k % LABELS.length];
        out.decals.push({ pos: [st.cx + Math.cos(a) * r, PLAT_Y + 0.015, st.cx + Math.sin(a) * r], radius: 3 + 0.25 * rim / 10, width: 1, color: [...c, 0.13 * look.w], kind: DECAL.DISC });
      }
    }
    trapdoors(view, ctx, out);
  },

  // the floor as it stands
  frame(view) {
    const st = stage(view);
    const g = view.party();
    const t = g.state === L.H_PLAY ? g.t : 0;
    const r = (st.r0 > 0 ? rimAt(st, t) : g.size) + 1;
    return { centre: [st.cx || g.cx, PLAT_Y, st.cx || g.cx], radius: r, shape: 'disc' };
  },

  // the music, only while it plays (on the prediction's clock, as the pads light)
  music(view, ptick) {
    const st = stage(view);
    if (st.state !== L.H_PLAY || !(st.r0 > 0)) return true;
    return phaseOf(st, (ptick ?? view.tick) - st.t0) === MUSIC;
  },

  fx(fx, ctx) {
    if (fx.kind === L.MP_FX_STOP) {
      ctx.banner?.('THE MUSIC STOPPED!', C.YELLOW, 1300);
      ctx.sound?.shot?.(false);
      ctx.sound?.count?.(0);
    } else if (fx.kind === L.MP_FX_CLAIM) {
      if (fx.shot === 0) { ctx.banner?.('NOBODY MADE IT  AGAIN', C.ORANGE, 1800); return; }
      if (fx.owner !== 255) { ctx.banner?.(`A POINT TO ${ctx.name?.(fx.owner) ?? `P${fx.owner + 1}`}`, C.YELLOW, 1600); ctx.sound?.pickup?.(); return; }
      ctx.sound?.land?.(24);
      if (fx.size) ctx.feed?.(`${fx.size} OUT AT THE CLAIM`, C.GREY);
      const me = ctx.slot >= 0 ? ctx.view?.u8?.[L.PG_S + L.MP_PADOF + ctx.slot] : 255;
      if (me !== undefined && me !== 255) { ctx.banner?.('SAFE!', C.GREEN, 1200); ctx.sound?.pickup?.(); }
    } else if (fx.kind === L.MP_FX_CLOSE) {
      // the HUD says so while it closes
      ctx.sound?.tick?.();
    } else if (fx.kind === L.MP_FX_MUSIC && fx.shot > 0) {
      ctx.sound?.tick?.();
    }
  },

  // the music or the scramble, its clock, and whether you'd hold a pad now
  hud(view, ctx) {
    const g = view.party();
    if (g.state !== L.H_PLAY) return;
    const st = stage(view);
    if (!(st.r0 > 0)) return;
    const fresh = look.tp >= 0 && Math.abs((ctx.now ?? look.at) - look.at) < 200;
    const tp = fresh ? look.tp : ctx.t ? ctx.t / TICK : g.t;
    const ph = phaseOf(st, tp);
    const row = 4;
    const me = fresh && look.me ? look.me : ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    const playing = me && me.live && !me.out;
    const name = (p) => (p === ctx.slot ? 'YOU' : `P${p + 1}`);
    const bar = (y, u, c, n = 30) => {
      const lit = Math.max(0, Math.min(n, Math.round(u * n))), x = Math.floor((COLS - n) / 2);
      if (lit) ctx.put(x, y, '='.repeat(lit), c);
      if (lit < n) ctx.put(x + lit, y, '-'.repeat(n - lit), C.GREY);
    };
    // the final: the two left, their claims of it
    let final = null;
    if (g.left === 2 && st.npad === 1) {
      const two = [];
      for (let p = 0; p < L.NPLAYER && two.length < 2; p++) { const b = L.PLAYERS + p * L.PSIZE; if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) === L.PF_LIVE) two.push(p); }
      if (two.length === 2) final = `${name(two[0])} ${view.u8[L.PG_S + L.MP_FINAL + two[0]]} - ${view.u8[L.PG_S + L.MP_FINAL + two[1]]} ${name(two[1])}`;
    }
    if (ph === MUSIC) {
      const k = Math.floor(tp / 30) % 4;
      ctx.centre(row, `${' '.repeat(k)}~ MUSIC ~${' '.repeat(3 - k)}`, C.PURPLE);
      if (final) ctx.centre(row + 1, `FINAL  ${final}  FIRST TO ${L.MP_FINALS}`, C.YELLOW);
      else if (tp < st.next) ctx.centre(row + 1, st.npad === 1 ? 'ONE PAD WHEN IT STOPS' : `${st.npad} PADS WHEN IT STOPS`, C.GREY);
    } else if (ph === SCRAMBLE) {
      const left = (st.claim - tp) * TICK;
      ctx.centre(row, `GET ON A PAD!  ${Math.max(0, left).toFixed(1)}`, C.YELLOW);
      bar(row + 1, left / ((st.claim - st.stop) * TICK), left < 1 ? C.RED : C.YELLOW);
      if (playing) {
        const list = padsOf(view, st);
        const centres = list.map((p) => padAt(st, p, tp));
        const pos = me.pos;
        let on = -1;
        for (let i = 0; i < list.length; i++) if (Math.hypot(pos[0] - centres[i][0], pos[2] - centres[i][1]) < PAD_R) on = i;
        if (on < 0) ctx.centre(row + 2, 'NO PAD!', C.RED);
        else {
          // nearer its middle than anyone else on it?
          let mine = true;
          const d0 = Math.hypot(pos[0] - centres[on][0], pos[2] - centres[on][1]);
          for (let p = 0; p < L.NPLAYER && mine; p++) {
            if (p === ctx.slot) continue;
            const b = L.PLAYERS + p * L.PSIZE;
            if (!inAt(view, b)) continue;
            if (Math.hypot(view.dv.getFloat32(b + L.P_PX, true) - centres[on][0], view.dv.getFloat32(b + L.P_PZ, true) - centres[on][1]) < d0) mine = false;
          }
          ctx.centre(row + 2, !mine ? 'SOMEONE IS NEARER ITS MIDDLE' : list[on].gold ? 'ON THE GOLD PAD: A POWER-UP' : 'ON A PAD', !mine ? C.ORANGE : list[on].gold ? C.YELLOW : C.GREEN);
        }
      }
    } else if (tpDone(view, st)) {
      if (final && st.lost === 0 && st.held === 1) ctx.centre(row, `FINAL  ${final}`, C.YELLOW);
      else if (st.held) ctx.centre(row, st.lost === 1 ? '1 OUT' : `${st.lost} OUT`, C.WHITE);
    }
    if (st.rimB < st.rimA && tp >= st.rimT - L.MP_SHRINK0 && tp < st.rimT + L.MP_SHRINKT) ctx.centre(row + 3, 'THE FLOOR CLOSES IN', C.ORANGE);
    ctx.right(3, `SONG ${st.cycle + 1}  PADS ${st.npad}` + (playing ? `  CLAIMS ${survived(view, ctx.slot)}` : ''), C.GREY);
  },

  brain: {
    // off the floor (or off the floor to come, as it closes in) is a fall
    danger(view, x, z, tick) {
      const o = view.bank || 0;
      if (view.dv.getUint32(L.HDR_STATE + o, true) !== L.H_PLAY) return 0;
      const st = stage(view);
      const t = Math.max(0, (tick - st.t0) | 0);
      const r = Math.hypot(x - st.cx, z - st.cx);
      const rim = rimAt(st, t);
      if (r > rim) return 1;
      if (r > rim - 1.5) return 0.35;
      return st.rimB < rim && r > st.rimB - 1 ? 0.2 : 0;
    },
    goal(view, me, bot) {
      const p = plan(view, me, bot, view.tick);
      return p ? p.goal : null;
    },
    hop() { return false; },
    // all of it, as a word's fields (yaw in radians)
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
