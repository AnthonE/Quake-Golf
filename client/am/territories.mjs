// TERRITORIES (M_TERRITORY), as drawn and as the AI fighter plays it (the
// rules are src/am/territories.wat's, the state AO's as
// src/am/territories.mjs lays it out). Each territory is lettered A, B, C...
// in the map's order. It is a disc on the ground or a roof in its holder's
// colour (grey for nobody's), a ring of lights round its rim filling with
// its gauge in the colour of the side it leans to, a pillar of light that
// reads across the map, and waypoints: DEFEND on one of yours the other side
// outnumbers you on, TAKE on the nearest your side doesn't hold, three at
// most and none that would land on a nearer one's label. The HUD has
// the letters over who holds each (R, B or -, on a chip filled to its gauge)
// and how many are your side's, and how the one you stand on goes; the feed
// says each one taken and lost; the board's TIME ON is each fighter's time
// on its side's territories (MR_POINTS, seconds).
// The brain: each side's live fighters, in slot order, are dealt a
// territory each, the nearest across counting SPREAD m more for each of
// their side already dealt it past the enemies standing on it: attackers
// (two in three) among those their side doesn't hold, defenders among those
// it does (and each the other's when there are none), so they spread out
// rather than all run for one. Every bot deals the same hand from the same
// view. Each runs to its own by the route, shooting back, and holds it from
// two thirds of its radius in until the hand changes.
import * as L from '../../src/layout.mjs';
import * as AC from '../../src/am/consts.mjs';
import { C } from '../font.mjs';
import { SIDE, SIDE_C, SIDE_RGB } from './sides.mjs';

const R = Number(AC.TR_R), H = Number(AC.TR_H), CAP = AC.TR_CAP;
const NOBODY_RGB = [0.85, 0.85, 0.82]; // light grey: it reads on the sand and the grass
export const LETTER = 'ABCDEFGH';
// m a fighter's cost to a territory goes up for each more of its side
// dealt it than it needs: with 8 a side on Box Canyon's six (60 to 130 m
// apart), every territory gets someone before any gets two
const SPREAD = 60;

// The territories as AO holds them: { k, pos, gauge, hold, on }. Before play
// lays them out (a countdown: AO is 0), none; with map, the map's hill points
// as they will stand, neutral (for drawing them over the countdown).
export function territories(view, { map = false } = {}) {
  if (!view) return [];
  const d = view.dv;
  const n = Math.min(L.NHILL, d.getUint32(L.AO + AC.TR_N, true));
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = L.AO + AC.TR_T + k * AC.TR_TSIZE;
    const f = (o) => d.getFloat32(a + o, true);
    out.push({ k, pos: [f(AC.TR_X), f(AC.TR_Y), f(AC.TR_Z)], gauge: d.getInt32(a + AC.TR_GAUGE, true), hold: d.getUint32(a + AC.TR_HOLD, true) & 3,
      on: [d.getUint16(a + AC.TR_ON, true), d.getUint16(a + AC.TR_ON + 2, true)] });
  }
  if (!n && map) view.map().hills.forEach(([x, z, top], k) => out.push({ k, pos: [x, view.stand(x, z, top), z], gauge: 0, hold: 0, on: [0, 0] }));
  return out;
}

// Feet at pos on territory t, as $a_near has it (for drawing: the sim's own count is TR_ON).
export const onIt = (t, pos) => (pos[0] - t.pos[0]) ** 2 + (pos[2] - t.pos[2]) ** 2 < R * R && Math.abs(pos[1] - t.pos[1]) < H;

// Which way its gauge goes next tick, as the sim steps it: +1 toward red's
// end, -1 toward blue's, 0 still (as many each, or resting at an end or neutral).
export function push(t) {
  const [r, b] = t.on;
  if (r !== b) return r > b ? (t.gauge < CAP ? 1 : 0) : (t.gauge > -CAP ? -1 : 0);
  if (r) return 0;
  if (t.hold === 1) return t.gauge < CAP ? 1 : 0;
  if (t.hold === 2) return t.gauge > -CAP ? -1 : 0;
  return t.gauge > 0 ? -1 : t.gauge < 0 ? 1 : 0;
}

const rgbOf = (hold) => (hold ? SIDE_RGB[hold - 1] : NOBODY_RGB);
const pct = (x) => `${Math.max(0, Math.min(100, Math.floor(100 * x)))}%`;
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// How territory t stands for side s with its fighter on it: [words, colour]. The
// fighter counts itself: the confirmed count lags its own feet by a round trip.
function standing(t, s) {
  const us = Math.max(t.on[s], 1), them = t.on[1 - s];
  const g = s ? -t.gauge : t.gauge; // toward your end, + ; theirs, -
  const name = LETTER[t.k];
  if (t.hold === s + 1) return them > us ? [`LOSING ${name} ${pct(g / CAP)}`, C.YELLOW] : [g < CAP ? `HOLDING ${name} ${pct(g / CAP)}` : `HOLDING ${name}`, SIDE_C[s]];
  if (us === them) return [`${name} CONTESTED`, C.YELLOW];
  if (us < them) return [`OUTNUMBERED ON ${name}`, C.YELLOW];
  if (t.hold) return [`PUSHING ${name} BACK ${pct(1 + g / CAP)}`, SIDE_C[s]];
  return [`TAKING ${name} ${pct(Math.max(0, g) / CAP)}`, SIDE_C[s]];
}

// The rim's lights: where the territory's own surface is under each of n
// points round it (a cave's wall or a roof's edge drops some), worked out
// once a territory; each [x, y, z, k] with k its place round from +x.
const RIM = 12;
const rims = new Map();
function rimOf(view, t) {
  const key = t.pos.join(',');
  let rim = rims.get(key);
  if (rim) return rim;
  rim = [];
  for (let k = 0; k < RIM; k++) {
    const a = (k / RIM) * 2 * Math.PI;
    const x = t.pos[0] + Math.cos(a) * R * 0.97, z = t.pos[2] + Math.sin(a) * R * 0.97;
    const y = view.stand(x, z, t.pos[1] + H);
    if (Math.abs(y - t.pos[1]) < H) rim.push([x, y, z, k]);
  }
  if (rims.size > 64) rims.clear();
  rims.set(key, rim);
  return rim;
}

// The waypoints worth drawing, at most MARKS: those to defend, then the
// nearest to take, leaving out one that would land on a nearer one's label:
// within NEAR radians across of it as the camera at cam, facing yaw, sees
// them, one off the screen counted at its edge (the HUD pulls it in there, so
// two off one edge, or one off it and one just inside, land together).
// want: [{ d (to sort by), m (the marker) }].
const MARKS = 3, NEAR = 0.2, EDGE = 0.65; // a waypoint pulled in to the edge is 0.65 rad off the middle (focal 0.62 of the width)
export function thin(want, cam, yaw) {
  const kept = [];
  for (const { m } of want.sort((a, b) => a.d - b.d)) {
    if (kept.length >= MARKS) break;
    let a = Math.atan2(m.pos[2] - cam[2], m.pos[0] - cam[0]) - yaw;
    a = Math.max(-EDGE, Math.min(EDGE, Math.atan2(Math.sin(a), Math.cos(a))));
    if (kept.some((k) => Math.abs(a - k.a) < NEAR)) continue;
    kept.push({ m, a });
  }
  return kept.map((k) => k.m);
}

// Each side's hand: its live fighters in slot order, slot -> the index of the
// territory it's dealt. Dealt for both sides at once and kept for the tick:
// each bot asks on its own tick of 8, and the first to ask on a tick deals
// for the whole room.
let dealt = { view: null, tick: -1, hand: null };
export function deal(view, ts = territories(view)) {
  if (dealt.view === view && dealt.tick === view.tick && dealt.hand) return dealt.hand;
  const hand = new Map();
  const b = (p) => L.PLAYERS + p * L.PSIZE;
  for (const s of [0, 1]) {
    const load = ts.map(() => 0);
    const mine = ts.filter((t) => t.hold === s + 1), rest = ts.filter((t) => t.hold !== s + 1);
    const pools = { defend: mine.length ? mine : rest, attack: rest.length ? rest : mine };
    let rank = 0;
    for (let p = 0; p < L.NPLAYER; p++) {
      const fl = view.u8[b(p) + L.P_FL];
      if (!(fl & L.PF_LIVE) || (fl & L.PF_BLUE ? 1 : 0) !== s) continue;
      const pool = pools[rank++ % 3 === 2 ? 'defend' : 'attack'];
      if (fl & L.PF_DEAD) continue;
      const x = view.dv.getFloat32(b(p) + L.P_PX, true), z = view.dv.getFloat32(b(p) + L.P_PZ, true);
      let best = -1, bc = Infinity;
      for (const t of pool) {
        const c = Math.hypot(t.pos[0] - x, t.pos[2] - z) + SPREAD * Math.max(0, load[t.k] - t.on[1 - s]);
        if (c < bc) { bc = c; best = t.k; }
      }
      if (best < 0) continue;
      load[best]++;
      hand.set(p, best);
    }
  }
  dealt = { view, tick: view.tick, hand };
  return hand;
}

export default {
  mode: L.M_TERRITORY,
  key: 'territories',

  // rows 2 to 4: the letters; under each who holds it on a chip its gauge
  // fills from the bottom (in the colour it leans to), and your side's count
  // (both sides' to a spectator); how the one you stand on goes
  hud(view, ctx) {
    const ts = territories(view, { map: true });
    if (!ts.length) return;
    ts.forEach((t, i) => {
      const x = 1 + 2 * i;
      ctx.put(x, 2, LETTER[t.k], C.GREY);
      ctx.put(x, 3, t.hold ? 'RB'[t.hold - 1] : '-', C.WHITE);
      if (!ctx.rect) return;
      // the chip: 5 x 7 units round the letter's cell (text cells are 4 x 6, the glyph its top left 3 x 5)
      const x0 = 4 * x - 1, y0 = 17, x1 = 4 * x + 4, y1 = 24;
      ctx.rect(x0, y0, x1, y1, 0.08, 0.08, 0.1, 0.7);
      const fill = Math.abs(t.gauge) / CAP;
      if (fill > 0) {
        const c = SIDE_RGB[t.gauge > 0 ? 0 : 1], k = t.hold ? 0.85 : 0.55;
        ctx.rect(x0, y1 - Math.max(1, Math.round(fill * (y1 - y0))), x1, y1, c[0] * k, c[1] * k, c[2] * k, 0.9);
      }
    });
    const held = [1, 2].map((h) => ts.filter((t) => t.hold === h).length);
    const x = 2 + 2 * ts.length;
    if (ctx.team === 0 || ctx.team === 1) ctx.put(x, 3, `YOURS ${held[ctx.team]}`, SIDE_C[ctx.team]);
    else {
      ctx.put(x, 3, `${SIDE[0]} ${held[0]}`, SIDE_C[0]);
      ctx.put(x + `${SIDE[0]} ${held[0]} `.length, 3, `${SIDE[1]} ${held[1]}`, SIDE_C[1]);
    }
    const me = ctx.me;
    if (ctx.t > 0 && me?.live && !me.dead && (ctx.team === 0 || ctx.team === 1)) {
      const t = ts.find((u) => onIt(u, me.pos));
      if (t) { const [s, c] = standing(t, ctx.team); ctx.put(1, 4, s, c); }
    }
  },

  // The feed in the side's colour, a ring where it happened; a banner to whoever
  // stands on it as it goes, and to a side that lost one.
  news(f, ctx) {
    const side = (f.shot & 3) - 1, k = f.shot >> 2;
    if (side !== 0 && side !== 1) return;
    const mine = ctx.me?.live ? ctx.me.team : -1;
    const here = ctx.me?.live && !ctx.me.dead && Math.hypot(ctx.me.pos[0] - f.pos[0], ctx.me.pos[2] - f.pos[2]) < R && Math.abs(ctx.me.pos[1] - f.pos[1]) < H;
    const name = LETTER[k] ?? '?';
    const ring = (rgb) => ctx.glow({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: R, color: [...rgb, 0.85], kind: 6, life: 900, grow: true });
    if (f.size === AC.TR_MX_TAKE) {
      ctx.feed(`${SIDE[side]} TOOK ${name}`, SIDE_C[side]);
      if (here) ctx.banner(mine === side ? `YOUR SIDE TOOK ${name}` : `${SIDE[side]} TOOK ${name}`, SIDE_C[side], 1800);
      if (mine === side && (ctx.dist === undefined || ctx.dist < 60)) ctx.sound?.pickup?.();
      ring(SIDE_RGB[side]);
    } else if (f.size === AC.TR_MX_LOSE) {
      ctx.feed(`${SIDE[side]} LOST ${name}`, SIDE_C[side]);
      if (mine === side) ctx.banner(`YOUR SIDE LOST ${name}`, SIDE_C[side], 1800);
      else if (here) ctx.banner(`${name} IS NEUTRAL  TAKE IT`, SIDE_C[1 - side], 1500);
      ring(NOBODY_RGB);
    }
  },

  draw(view, ctx, out) {
    const ts = territories(view, { map: true });
    if (!ts.length) return;
    // the side of the fighter shown (a spectator's watched one), as the HUD's lines
    const eye = ctx.shown >= 0 ? view.fighter(ctx.shown) : null;
    const me = eye?.live && !eye.dead ? eye : null;
    const team = eye?.live && view.teamed() ? eye.team : -1;
    const want = [];
    out.zone = [];
    for (const t of ts) {
      const [x, y, z] = t.pos;
      const rgb = rgbOf(t.hold), go = push(t);
      // the disc, its rings running harder while its gauge moves
      out.zone.push({ x, z, r: R, y, h: H, color: rgb, pulse: go ? 1 : t.hold ? 0.5 : 0.3 });
      // the rim's lights: as many lit round from +x as the gauge is full, in the
      // colour it leans to, the next one blinking while it moves; the rest dim
      const d = Math.hypot(ctx.cam[0] - x, ctx.cam[2] - z);
      if (d < 160) {
        const lean = SIDE_RGB[t.gauge > 0 ? 0 : 1], lit = Math.abs(t.gauge) / CAP * RIM;
        for (const [px, py, pz, k] of rimOf(view, t)) {
          const on = k < Math.floor(lit) || lit >= RIM, next = !on && k === Math.floor(lit) && go !== 0;
          const a = on ? 0.85 : next ? 0.3 + 0.5 * (Math.floor(ctx.now / 200) & 1) : 0.2;
          out.glow.push({ pos: [px, py + 0.35, pz], size: 0.4, color: [...(on || next ? lean : NOBODY_RGB), a], kind: 3, minpx: 1 });
        }
      }
      // a pillar of light from the middle, fading out as you come close (where it would only fog the view)
      const far = Math.min(1, Math.max(0, (d - 12) / 30));
      if (far > 0) out.beams.push({ a: [x, y + 2, z], b: [x, y + 24, z], width: 0.25, color: [...rgb, 0.25 * far] });
      // the waypoint, rising with the distance (3 m up to 30 m away, 8 m from 80), never over the head of the
      // fighter shown while it stands on it
      if (team < 0 || (me && onIt(t, me.pos))) continue;
      const up = Math.min(8, Math.max(3, d / 10));
      const pos = [x, y + up, z];
      if (t.hold !== team + 1) want.push({ d, m: { pos, label: `TAKE ${LETTER[t.k]}`, color: t.hold ? SIDE_C[t.hold - 1] : C.WHITE, kind: 'hill' } });
      else if (t.on[1 - team] > t.on[team]) want.push({ d: d - 1e4, m: { pos, label: `DEFEND ${LETTER[t.k]}`, color: C.YELLOW, kind: 'hill' } });
    }
    out.markers.push(...thin(want, ctx.cam, eye?.yaw ?? 0));
  },

  cols: [{ head: 'TIME ON', get: (o) => clock(o.points) }],

  // the territory this fighter is dealt, at a run that still shoots back (a
  // holder fights from it), held from two thirds of its radius in
  goal(view, me) {
    const team = me.team;
    if (team !== 0 && team !== 1) return null;
    const ts = territories(view);
    if (!ts.length) return null;
    const t = ts[deal(view, ts).get(me.slot)];
    if (!t) return null;
    return { pos: t.pos, r: R * (2 / 3), hurry: 0.6, hold: true };
  },

  state(view) {
    const ts = territories(view);
    return ts.length ? { hold: ts.map((t) => t.hold), gauge: ts.map((t) => t.gauge), on: ts.map((t) => t.on), held: [1, 2].map((h) => ts.filter((t) => t.hold === h).length),
      score: view.mode().score, target: view.mode().target } : null;
  },
};
