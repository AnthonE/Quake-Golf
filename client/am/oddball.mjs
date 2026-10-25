// ODDBALL (M_ODDBALL), as drawn and as the AI fighter plays it. One skull
// (src/am/oddball.wat, its state in AO as src/am/oddball.mjs lays it out): at
// its spot or dropped it hovers glowing where it lies, carried it rides over
// its carrier's head (your own is your HUD's: the frontend's carry rects).
// A waypoint on it says what to do: SKULL while it's free, KILL on an enemy
// carrier, GUARD on your side's. The HUD says who has it and your side's
// seconds; the board's SKULL column is each fighter's seconds carrying it.
// The brain: the carrier keeps away from enemies, toward its own side, but
// within KEEP of the skull's spot; everyone else runs for a free skull,
// hunts an enemy carrier, or for their own side's carrier escorts it
// (defenders) or meets whoever comes for it.
import * as L from '../../src/layout.mjs';
import * as AC from '../../src/am/consts.mjs';
import { boxClear } from '../../src/arena-view.mjs';
import { C } from '../font.mjs';
import { SIDE, SIDE_C } from './sides.mjs';

const SKULL_RGB = [0.95, 0.92, 0.82];
const HOLD = 35; // m: a carrier with no enemy nearer than this holds where it is
// m from the skull's spot a carrier keeps to: let it run home and the other
// side, respawning at its own end, hardly ever reaches it (the side behind
// after 20,000 ticks of 8 and of 16 AI fighters, three seeds each: 9 to 46
// points without it, 36 to 52 with it)
const KEEP = 40;

// The skull as AO holds it: state (AC.OB_*), where it is (feet), its carrier
// (-1 unless carried) and side, ticks left lying dropped, each side's ticks
// toward its next point. Before play starts AO is clear: it is at its spot,
// MAP_BALL where $stand puts it.
export function skullOf(view) {
  const d = view.dv, f = (o) => d.getFloat32(L.AO + o, true);
  let spot = [f(AC.OB_SPOT), f(AC.OB_SPOT + 4), f(AC.OB_SPOT + 8)];
  if (spot[0] === 0 && spot[2] === 0) { const [x, z, top] = view.map().ball; spot = [x, view.stand(x, z, top), z]; }
  const state = view.u8[L.AO + AC.OB_STATE];
  return {
    state, spot, pos: state === AC.OB_HOME ? spot : [f(AC.OB_POS), f(AC.OB_POS + 4), f(AC.OB_POS + 8)],
    carrier: state === AC.OB_CARRIED ? view.u8[L.AO + AC.OB_CARRIER] : -1, side: view.u8[L.AO + AC.OB_SIDE],
    left: d.getUint16(L.AO + AC.OB_LEFT, true), held: [d.getUint16(L.AO + AC.OB_HELD, true), d.getUint16(L.AO + AC.OB_HELD + 2, true)],
  };
}

// Live fighters other than slot `me` (feet), as [slot, pos, ally].
function others(view, me, ally) {
  const out = [];
  for (let q = 0; q < L.NPLAYER; q++) {
    const b = L.PLAYERS + q * L.PSIZE;
    if (q === me || (view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD)) !== L.PF_LIVE) continue;
    out.push([q, [view.dv.getFloat32(b + L.P_PX, true), view.dv.getFloat32(b + L.P_PY, true), view.dv.getFloat32(b + L.P_PZ, true)], ally(me, q)]);
  }
  return out;
}
const across = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// Where the carrier at `pos` goes: of eight points 14 m round it it can walk
// to (no box across the way at knee or chest height, not in a building, not
// up or down a cliff, 20 m inside the map's bounds, within KEEP of the
// skull's spot or, beyond it, no farther out), the one farthest from
// the nearest enemy, less a little for each metre from its nearest teammate;
// null if none is clear.
function away(view, pos, enemies, friends, spot) {
  const map = view.map(), [x0, x1, z0, z1] = map.bounds;
  const keep = Math.max(KEEP, across(pos, spot));
  let best = null, bs = -Infinity;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const x = pos[0] + 14 * Math.cos(a), z = pos[2] + 14 * Math.sin(a);
    if (x < x0 + 20 || x > x1 - 20 || z < z0 + 20 || z > z1 - 20 || across([x, 0, z], spot) > keep) continue;
    const y = view.stand(x, z);
    if (Math.abs(y - pos[1]) > 3) continue;
    if (map.groups.some((g) => x > g.box[0] - 1 && x < g.box[3] + 1 && z > g.box[2] - 1 && z < g.box[5] + 1)) continue;
    if (![0.5, 1.4].every((h) => boxClear(map, [pos[0], pos[1] + h, pos[2]], [x, y + h, z]))) continue;
    const p = [x, y, z];
    const foe = Math.min(...enemies.map((e) => across(e, p)));
    const pal = friends.length ? Math.min(...friends.map((e) => across(e, p))) : 0;
    const s = Math.min(foe, 60) - 0.3 * pal;
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}

export default {
  mode: L.M_ODDBALL,
  key: 'oddball',
  carry: 'skull',
  hud(view, ctx) {
    // (26 cells: the shield bar starts at the 28th)
    const s = skullOf(view), md = view.mode(), team = ctx.team;
    let row = 2;
    if (ctx.me?.carry) { ctx.put(1, row++, 'YOU HAVE THE SKULL', ctx.C.YELLOW); ctx.put(1, row++, 'STAY ALIVE', ctx.C.YELLOW); }
    else if (s.state === AC.OB_CARRIED) ctx.put(1, row++, `${SIDE[s.side]} HAS THE SKULL  P${s.carrier + 1}`, SIDE_C[s.side]);
    else if (s.state === AC.OB_DROPPED) ctx.put(1, row++, `SKULL DOWN  BACK IN ${Math.ceil(s.left / 125)}`, ctx.C.WHITE);
    else ctx.put(1, row++, 'THE SKULL IS FREE', ctx.C.WHITE);
    if (team >= 0) ctx.put(1, row, `YOUR SIDE ${md.score[team]} S OF ${md.target || AC.OB_TARGET}`, SIDE_C[team]); // (the target is set as play starts)
    else ctx.put(1, row, `RED ${md.score[0]} S  BLUE ${md.score[1]} S`, ctx.C.GREY);
  },
  news(f, ctx) {
    const mine = ctx.me ? ctx.team(ctx.slot) : -1;
    const side = f.shot === 0 || f.shot === 1 ? f.shot : -1;
    const color = side >= 0 ? SIDE_C[side] : ctx.C.WHITE;
    const at = [f.pos[0], f.pos[1] + 0.5, f.pos[2]];
    switch (f.size) {
      case AC.OB_MX_TAKE:
        ctx.feed(`${ctx.name(f.owner)} TOOK THE SKULL`, color);
        ctx.glow({ pos: at, size: 1.8, color: [...SKULL_RGB, 0.9], kind: 6, life: 500, grow: true });
        if (f.owner === ctx.slot) { ctx.banner('YOU HAVE THE SKULL', ctx.C.YELLOW, 2500); ctx.sound.pickup(); }
        else if (mine >= 0 && side >= 0) ctx.banner(side === mine ? 'YOUR SIDE HAS THE SKULL' : `${SIDE[side]} HAS THE SKULL`, color, 2000);
        break;
      case AC.OB_MX_DROP:
        ctx.feed(`${ctx.name(f.owner)} DROPPED THE SKULL`, color);
        ctx.glow({ pos: at, size: 1.4, color: [...SKULL_RGB, 0.8], kind: 6, life: 400, grow: true });
        break;
      case AC.OB_MX_RESET:
        ctx.feed('THE SKULL IS BACK', ctx.C.WHITE);
        ctx.glow({ pos: at, size: 2.2, color: [...SKULL_RGB, 0.9], kind: 6, life: 700, grow: true });
        break;
      default:
    }
  },
  draw(view, ctx, out) {
    const s = skullOf(view);
    // the fighter shown (a spectator's watched one): its side's GUARD or KILL, nothing over its own head
    const eye = ctx.shown >= 0 ? view.fighter(ctx.shown) : null;
    const team = eye?.live && view.mode().teamed ? eye.team : -1;
    let pos;
    if (s.carrier >= 0) {
      if (s.carrier === ctx.shown) return;
      // over its carrier's head, where the renderer draws the carrier (the confirmed world run on by dt)
      const c = view.fighter(s.carrier);
      pos = [0, 1, 2].map((k) => c.pos[k] + c.vel[k] * ctx.dt + (k === 1 ? 2.25 : 0));
    } else pos = [s.pos[0], s.pos[1] + 0.5 + 0.08 * Math.sin(ctx.now / 300), s.pos[2]];
    out.solid.push({ pos, size: 0.35, aspect: 1, color: [...SKULL_RGB, 1], kind: 8, minpx: 2 });
    // its glow, pulsing faster while it lies dropped
    const pulse = s.state === AC.OB_DROPPED ? 0.4 + 0.25 * Math.sin(ctx.now / 120) : 0.5 + 0.1 * Math.sin(ctx.now / 400);
    out.glow.push({ pos, size: 1.1, color: [1, 0.95, 0.7, pulse], kind: 3, minpx: 1 });
    // the waypoint well over it, so its distance doesn't hide it
    const mark = [pos[0], pos[1] + 1.6, pos[2]];
    if (s.carrier < 0) out.markers.push({ pos: mark, label: 'SKULL', color: C.YELLOW, kind: 'skull' });
    else out.markers.push({ pos: mark, label: team < 0 ? SIDE[s.side] : s.side === team ? 'GUARD' : 'KILL', color: SIDE_C[s.side], kind: 'skull' });
  },
  cols: [{ head: 'SKULL', get: (o) => String(o.points) }],
  // the carrier: away from enemies inside HOLD; else hold. Free: everyone
  // runs for it. An enemy carrier: hunt it, shooting on the way. Your own
  // side's: defenders stay by it fighting whoever turns up, the rest go for
  // the enemy nearest it.
  goal(view, me, ctx) {
    const s = skullOf(view);
    if (view.hole().state !== L.H_PLAY) return null;
    if (me.carry && s.carrier === me.slot) {
      const all = others(view, me.slot, ctx.ally);
      const enemies = all.filter((o) => !o[2]).map((o) => o[1]), friends = all.filter((o) => o[2]).map((o) => o[1]);
      const near = enemies.some((e) => across(e, me.pos) < HOLD);
      const to = near ? away(view, me.pos, enemies, friends, s.spot) : null;
      return { pos: to || me.pos, r: 3, hurry: 1, hold: true };
    }
    if (s.carrier < 0) return { pos: s.pos, r: 1, hurry: 1, hold: false };
    const c = view.fighter(s.carrier);
    if (ctx.ally(me.slot, s.carrier)) {
      if (ctx.role === 'defend') return { pos: c.pos, r: 6, hurry: 0.2, hold: true };
      // the rest meet whoever comes for it: the enemy nearest the carrier
      const foes = others(view, s.carrier, ctx.ally).filter((o) => !o[2]);
      if (!foes.length) return { pos: c.pos, r: 6, hurry: 0.2, hold: true };
      foes.sort((a, b) => across(a[1], c.pos) - across(b[1], c.pos));
      return { pos: foes[0][1], r: 6, hurry: 0, hold: false };
    }
    return { pos: c.pos, r: 2, hurry: 0.8, hold: false };
  },
  state(view) {
    const s = skullOf(view);
    return { score: view.mode().score, target: view.mode().target, skull: { state: s.state, carrier: s.carrier, side: s.side, held: s.held, left: s.left } };
  },
};
