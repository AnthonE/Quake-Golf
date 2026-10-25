// CAPTURE THE FLAG (M_CTF), as drawn and as the AI fighter plays it (the
// rules are src/am/ctf.wat's, the state AO's as src/am/ctf.mjs lays it out).
// Each flag waves on its stand in its side's colour, lies where it was
// dropped, or rides over its carrier; a ring marks each stand. Waypoints say
// what to do: TAKE the enemy's flag, ESCORT your side's carrier, RETURN your
// own lying flag, KILL its carrier, and carrying, go HOME. The HUD has both
// flags' state, the feed every take, capture, drop and return.
// The brain: a carrier runs home and waits there for its own flag; a
// defender (every third of its side) holds its stand, runs to return its
// lying flag and chases its carrier; attackers run for the enemy's flag past
// everyone and fight their way in over its last RUSH m, escort their own
// carrier, and with their own flag gone go and get it back (a capture needs
// it home).
import * as L from '../../src/layout.mjs';
import * as AC from '../../src/am/consts.mjs';
import { SIDE, SIDE_C, SIDE_RGB } from './sides.mjs';

const NAME = ['RED FLAG', 'BLUE FLAG'];
// m from the enemy's flag inside which an attacker going for it fights its
// way on (hurry 0.7) instead of running past everyone (1). With 16 AI
// fighters on Blood Gulch, 20,000 ticks, seeds 7 to 13: 6 to 15 takes and 2
// to 3 captures each; at 0.7 all the way across, none at all.
const RUSH = 25;

// Both flags as AO holds them: { k, pos, stand, state, by, left }. In the
// countdown AO is still 0, so each is home on its stand as the map has it.
export function flags(view) {
  const map = view.map();
  return [0, 1].map((k) => {
    const a = L.AO + AC.CF_FLAG + k * AC.CF_FSIZE;
    const f = (o) => view.dv.getFloat32(a + o, true);
    let stand = [f(AC.CF_STAND), f(AC.CF_STAND + 4), f(AC.CF_STAND + 8)];
    let pos = [f(AC.CF_POS), f(AC.CF_POS + 4), f(AC.CF_POS + 8)];
    if (stand[0] === 0 && stand[2] === 0) {
      const [x, z, top] = map.flags[k];
      stand = [x, view.stand(x, z, top), z];
      pos = stand;
    }
    return { k, pos, stand, state: view.u8[a + AC.CF_STATE], by: view.u8[a + AC.CF_BY], left: view.dv.getUint16(a + AC.CF_LEFT, true) };
  });
}

// Slot p's feet, and moved on by its velocity dt s (drawing only).
function feet(view, p, dt = 0) {
  const b = L.PLAYERS + p * L.PSIZE, f = (o) => view.dv.getFloat32(b + o, true);
  return [f(L.P_PX) + f(L.P_VX) * dt, f(L.P_PY) + f(L.P_VY) * dt, f(L.P_PZ) + f(L.P_VZ) * dt];
}

const clock = (ticks) => { const s = Math.ceil(ticks / 125); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// A flag's state in words: HOME, TAKEN BY P5 (YOU HAVE IT), DROPPED 0:12.
function says(fl, slot) {
  if (fl.state === AC.CF_CARRIED) return fl.by === slot ? 'YOU HAVE IT' : `TAKEN BY P${fl.by + 1}`;
  if (fl.state === AC.CF_DROPPED) return `DROPPED ${clock(fl.left + 1)}`;
  return 'HOME';
}

// A flag on its pole as the renderer draws it (kind 7: 0.6 m half-wide, 2.4 m tall), its feet at p.
const pennant = (p, k, size = 0.6, a = 1) => ({ pos: [p[0], p[1] + 2 * size, p[2]], size, aspect: 2, color: [...SIDE_RGB[k], a], kind: 7, minpx: 2 });

// Where the brain goes: a point near p, offset by rank round it (escorts spread out).
const beside = (p, rank, r) => { const a = rank * 2.4; return [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r]; };

export default {
  mode: L.M_CTF,
  key: 'ctf',
  carry: 'flag',

  hud(view, ctx) {
    const fs = flags(view);
    if (ctx.team < 0) {
      fs.forEach((fl, k) => ctx.put(1, 2 + k, `${NAME[k]}  ${says(fl, ctx.slot)}`, SIDE_C[k]));
      return;
    }
    const mine = fs[ctx.team], theirs = fs[1 - ctx.team];
    ctx.put(1, 2, `YOUR FLAG  ${says(mine, ctx.slot)}`, mine.state === AC.CF_HOME ? SIDE_C[ctx.team] : ctx.C.YELLOW);
    ctx.put(1, 3, `THEIR FLAG  ${says(theirs, ctx.slot)}`, SIDE_C[1 - ctx.team]);
    // carrying: what to do with it (a capture needs your own home; row 3 already says you have it)
    if (ctx.me?.carry && !ctx.me.dead) ctx.put(1, 4, mine.state === AC.CF_HOME ? 'RUN HOME TO SCORE' : 'WAIT AT HOME FOR YOUR FLAG', (ctx.now >> 8) & 1 ? ctx.C.YELLOW : ctx.C.WHITE);
  },

  // The feed in the doer's side's colour (the flag's for CF_MX_HOME, the one
  // news nobody did: its owner 255 is not slot 255); a banner for what
  // happens to your own flag and for what you did.
  news(f, ctx) {
    const k = f.shot;
    if (k !== 0 && k !== 1) return;
    const who = ctx.name(f.owner), you = f.owner === ctx.slot && ctx.slot >= 0, ours = ctx.slot >= 0 && ctx.team(ctx.slot) === k;
    const col = SIDE_C[f.size === AC.CF_MX_HOME ? k : ctx.team(f.owner)];
    const flag = `THE ${NAME[k]}`;
    const near = ctx.dist === undefined || ctx.dist < 60;
    switch (f.size) {
      case AC.CF_MX_TAKE:
        ctx.feed(`${who} TOOK ${flag}`, col);
        if (you) ctx.banner('YOU HAVE THE FLAG  RUN HOME', ctx.C.YELLOW, 2500);
        else if (ours) ctx.banner('YOUR FLAG IS TAKEN', SIDE_C[k], 2500);
        ctx.sound?.pickup?.();
        ctx.glow({ pos: [f.pos[0], f.pos[1] + 1.2, f.pos[2]], size: 1.6, color: [...SIDE_RGB[k], 0.9], kind: 6, life: 500, grow: true });
        break;
      case AC.CF_MX_CAP:
        ctx.feed(`${who} CAPTURED ${flag}`, col);
        if (you) ctx.banner('YOU CAPTURED THE FLAG', ctx.C.YELLOW, 3000);
        else if (ours) ctx.banner(`${SIDE[1 - k]} CAPTURED YOUR FLAG`, SIDE_C[1 - k], 3000);
        else if (ctx.slot >= 0) ctx.banner('YOUR SIDE SCORES', SIDE_C[1 - k], 3000);
        ctx.sound?.holed?.();
        ctx.glow({ pos: [f.pos[0], f.pos[1] + 1, f.pos[2]], size: 3, color: [...SIDE_RGB[1 - k], 0.9], kind: 3, life: 700, grow: true });
        break;
      case AC.CF_MX_RETURN:
        ctx.feed(`${who} RETURNED ${flag}`, col);
        if (you) ctx.banner('YOU RETURNED YOUR FLAG', SIDE_C[k], 2000);
        else if (ours) ctx.banner('YOUR FLAG IS HOME', SIDE_C[k], 2000);
        ctx.sound?.pickup?.();
        break;
      case AC.CF_MX_HOME:
        ctx.feed(`${flag} IS HOME`, col);
        if (ours) ctx.banner('YOUR FLAG IS HOME', SIDE_C[k], 2000);
        if (near) ctx.sound?.count?.(0);
        break;
      case AC.CF_MX_DROP:
        ctx.feed(`${who} DROPPED ${flag}`, col);
        if (ours) ctx.banner('YOUR FLAG IS DOWN  RETURN IT', SIDE_C[k], 2500);
        ctx.glow({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: 1.2, color: [...SIDE_RGB[k], 0.8], kind: 6, life: 600, grow: true });
        break;
      default:
    }
  },

  draw(view, ctx, out) {
    const fs = flags(view);
    // the side of the fighter shown (a spectator's watched one), as the HUD's lines
    const eye = ctx.shown >= 0 ? view.fighter(ctx.shown) : null;
    const team = eye?.live && view.teamed() ? eye.team : -1;
    const pulse = 0.5 + 0.5 * Math.sin(ctx.now / 250);
    for (const fl of fs) {
      const k = fl.k;
      // its stand: a ring, bright with the flag on it, pulsing without
      const home = fl.state === AC.CF_HOME;
      out.glow.push({ pos: [fl.stand[0], fl.stand[1] + 0.1, fl.stand[2]], size: 1.8, color: [...SIDE_RGB[k], home ? 0.75 : 0.3 + 0.4 * pulse], kind: 6, minpx: 1 });
      if (fl.state === AC.CF_CARRIED) {
        // over its carrier's shoulder, where the carrier is drawn (but not over the one shown: it's in your hands)
        if (fl.by !== ctx.shown) out.solid.push(pennant(feet(view, fl.by, ctx.dt).map((v, i) => v + (i === 1 ? 1.1 : 0)), k, 0.42));
      } else {
        out.solid.push(pennant(fl.pos, k));
        if (!home) out.glow.push({ pos: [fl.pos[0], fl.pos[1] + 0.15, fl.pos[2]], size: 1.1, color: [...SIDE_RGB[k], 0.4 + 0.4 * pulse], kind: 3, minpx: 1 });
      }
    }
    if (team < 0) return;
    // waypoints: the enemy's flag (TAKE, or ESCORT your side's carrier, or HOME when it's the one shown), your own away
    // from home; over a carrier, above the flag it carries
    const theirs = fs[1 - team], mine = fs[team];
    const up = (p, h = 2.9) => [p[0], p[1] + h, p[2]];
    if (theirs.state === AC.CF_CARRIED) {
      if (theirs.by === ctx.shown) out.markers.push({ pos: up(mine.stand), label: mine.state === AC.CF_HOME ? 'HOME' : 'HOME  WAIT', color: SIDE_C[team], kind: 'flag' });
      else out.markers.push({ pos: up(feet(view, theirs.by, ctx.dt), 3.6), label: 'ESCORT', color: SIDE_C[team], kind: 'flag' });
    } else out.markers.push({ pos: up(theirs.pos), label: 'TAKE', color: SIDE_C[1 - team], kind: 'flag' });
    if (mine.state === AC.CF_DROPPED) out.markers.push({ pos: up(mine.pos), label: 'RETURN', color: SIDE_C[team], kind: 'flag' });
    else if (mine.state === AC.CF_CARRIED) out.markers.push({ pos: up(feet(view, mine.by, ctx.dt), 3.6), label: 'KILL', color: SIDE_C[1 - team], kind: 'flag' });
  },

  cols: [{ head: 'CAPS', get: (o) => String(o.points) }, { head: 'RETURNS', get: (o) => String(o.aux) }],

  goal(view, me, ctx) {
    const team = me.team;
    if (team !== 0 && team !== 1) return null;
    const fs = flags(view), mine = fs[team], theirs = fs[1 - team];
    // carrying: home to its own stand, and wait there for its own flag
    if (me.carry) return { pos: mine.stand, r: 1.5, hurry: 1, hold: true };
    // its own flag lying somewhere: whoever goes for it runs
    const fetch = () => (mine.state === AC.CF_DROPPED ? { pos: mine.pos, r: 0.8, hurry: 1, hold: false }
      : { pos: feet(view, mine.by), r: 2, hurry: 0.7, hold: false });
    if (ctx.role === 'defend') return mine.state === AC.CF_HOME ? { pos: mine.stand, r: 4, hurry: 0, hold: true } : fetch();
    if (theirs.state === AC.CF_CARRIED) {
      // your side has theirs: it needs your own home to score, so get it back; else ride along
      if (mine.state !== AC.CF_HOME) return fetch();
      return { pos: beside(feet(view, theirs.by), ctx.rank, 3), r: 3, hurry: 0.6, hold: false };
    }
    // for theirs: past everyone across the field (a fight in the middle every
    // time is how nobody ever gets there), fighting once within RUSH of it
    // (its defenders, then it's taken under fire)
    return { pos: theirs.pos, r: 0.8, hurry: Math.hypot(theirs.pos[0] - me.pos[0], theirs.pos[2] - me.pos[2]) < RUSH ? 0.7 : 1, hold: false };
  },

  state(view) {
    return { score: view.mode().score, flags: flags(view).map((f) => ({ state: f.state, by: f.by, left: f.left, pos: f.pos.map((v) => Math.round(v * 10) / 10) })) };
  },
};
