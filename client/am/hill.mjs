// KING OF THE HILL (M_HILL), as drawn and as the AI fighter plays it. One hill
// at a time (src/am/hill.wat, its state in AO): a disc on the ground or a roof
// in the colour of the side that holds it (white for nobody, flashing red and
// blue when contested), a chase of lights round its rim and a pillar of light
// from its middle that reads across the map, and a waypoint on it (HOLD when
// your side has it). The HUD says who holds it and when it moves; the board's
// HILL column is each fighter's seconds on a held hill (MR_POINTS). The AI
// fighter goes for the hill, whatever its role (a hill has no home), and
// holds inside two thirds of its radius.
import * as L from '../../src/layout.mjs';
import { C } from '../font.mjs';
import { SIDE, SIDE_C, SIDE_RGB } from './sides.mjs';

const H = Number(L.HL_H);
const WHO = ['NOBODY', ...SIDE, 'CONTESTED'];
const WHO_C = [C.WHITE, ...SIDE_C, C.YELLOW];
const NOBODY_RGB = [0.92, 0.92, 0.88];

// The hill as AO holds it, or null before one is up (a countdown: AO is 0).
export function hillOf(view) {
  if (!view) return null;
  const d = view.dv, a = L.AO;
  const f = (o) => d.getFloat32(a + o, true);
  const r = f(L.HL_R);
  if (!(r > 0)) return null;
  return {
    at: d.getUint32(a + L.HL_AT, true), moves: d.getUint32(a + L.HL_MOVES, true), pos: [f(L.HL_X), f(L.HL_Y), f(L.HL_Z)], r,
    hold: d.getUint32(a + L.HL_HOLD, true) & 3, on: [d.getUint32(a + L.HL_ON, true), d.getUint32(a + L.HL_ON + 4, true)],
    held: [d.getUint16(a + L.HL_HELD, true), d.getUint16(a + L.HL_HELD + 2, true)],
  };
}

// Feet at pos on hill h, as $a_near has it (for drawing: the sim's own count is HL_ON).
export const onHill = (h, pos) => (pos[0] - h.pos[0]) ** 2 + (pos[2] - h.pos[2]) ** 2 < h.r * h.r && Math.abs(pos[1] - h.pos[1]) < H;

// The hill's colour now: its holder's, white for nobody, contested flashing between the two.
export const holdRGB = (hold, now) => (hold === 3 ? SIDE_RGB[Math.floor(now / 300) & 1] : hold ? SIDE_RGB[hold - 1] : NOBODY_RGB);

const clock = (n) => `${Math.floor(n / 125 / 60)}:${String(Math.floor(n / 125) % 60).padStart(2, '0')}`;

// The rim's lights: where the hill's own surface is under each point round
// it (a cave's wall or a roof's edge drops some), worked out once a hill.
let rimKey = '', rim = [];
function rimOf(view, h) {
  const key = `${h.at}:${h.pos.join(',')}:${h.r}`;
  if (key === rimKey) return rim;
  rimKey = key;
  rim = [];
  const n = Math.max(8, Math.min(16, Math.round(h.r * 2)));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    const x = h.pos[0] + Math.cos(a) * h.r * 0.97, z = h.pos[2] + Math.sin(a) * h.r * 0.97;
    const y = view.stand(x, z, h.pos[1] + H);
    if (Math.abs(y - h.pos[1]) < H) rim.push([x, y, z, k]);
  }
  return rim;
}

export default {
  mode: L.M_HILL,
  key: 'hill',
  hud(view, ctx) {
    const h = hillOf(view);
    if (!h) return;
    const hd = view.hole();
    const head = `HILL: ${WHO[h.hold]}`;
    ctx.put(1, 2, head, WHO_C[h.hold]);
    // the last hill of a match never moves (the clock ends it first)
    if (hd.state === L.H_PLAY && h.moves < hd.until) ctx.put(1 + head.length + 2, 2, `MOVES IN ${clock(Math.max(0, h.moves - hd.tick))}`, C.GREY);
    // on it yourself: how it stands for your side; else who's on it
    if (ctx.me?.live && !ctx.me.dead && ctx.team >= 0 && onHill(h, ctx.me.pos)) {
      const how = h.hold === ctx.team + 1 ? 'YOU ARE HOLDING IT' : h.hold === 3 ? 'CONTESTED: CLEAR THEM OFF' : h.hold ? 'OUTNUMBERED' : 'YOU ARE ON IT';
      ctx.put(1, 3, how, h.hold === 3 ? C.YELLOW : SIDE_C[ctx.team]);
    } else if (h.on[0] + h.on[1]) {
      ctx.put(1, 3, 'ON IT', C.GREY);
      ctx.put(7, 3, `${SIDE[0]} ${h.on[0]}`, SIDE_C[0]);
      ctx.put(8 + `${SIDE[0]} ${h.on[0]}`.length, 3, `${SIDE[1]} ${h.on[1]}`, SIDE_C[1]);
    }
    const md = view.mode();
    if (md.target) ctx.put(1, 4, `FIRST TO ${md.target} SECONDS`, C.GREY);
  },
  news(f, ctx) {
    const h = hillOf(ctx.view);
    const mine = ctx.me?.live ? ctx.me.team : -1;
    const ring = (rgb) => ctx.glow({ pos: [f.pos[0], f.pos[1] + 0.3, f.pos[2]], size: h ? h.r : 4, color: [...rgb, 0.8], kind: 6, life: 900, grow: true });
    if (f.size === L.HL_MX_MOVE) {
      ctx.feed('THE HILL MOVED', C.YELLOW);
      ctx.banner('THE HILL MOVED', C.YELLOW, 2000);
      ring(NOBODY_RGB);
    } else if (f.size === L.HL_MX_TAKE) {
      const side = f.shot - 1;
      if (side !== 0 && side !== 1) return;
      ctx.feed(`${SIDE[side]} HAS THE HILL`, SIDE_C[side]);
      if (mine >= 0) ctx.banner(mine === side ? 'YOUR SIDE HAS THE HILL' : `${SIDE[side]} HAS THE HILL`, SIDE_C[side], 1800);
      ring(SIDE_RGB[side]);
    } else if (f.size === L.HL_MX_CONTEST) {
      ctx.feed('THE HILL IS CONTESTED', C.YELLOW);
      if (mine >= 0) ctx.banner('THE HILL IS CONTESTED', C.YELLOW, 1500);
      ring([1, 0.85, 0.3]);
    }
  },
  draw(view, ctx, out) {
    const h = hillOf(view);
    if (!h) return;
    const [x, y, z] = h.pos;
    const rgb = holdRGB(h.hold, ctx.now);
    out.zone = { x, z, r: h.r, y, h: H, color: rgb, pulse: h.hold ? 1 : 0.35 };
    // a light chasing round the rim, and a pillar of light from the middle
    for (const [px, py, pz, k] of rimOf(view, h)) {
      const a = 0.45 + 0.45 * Math.max(0, Math.sin(ctx.now / 180 - k * 0.8));
      out.glow.push({ pos: [px, py + 0.35, pz], size: 0.4, color: [...rgb, a], kind: 3, minpx: 1 });
    }
    // (the pillar fades out as you come close, where it would only fog the view)
    const far = Math.min(1, Math.max(0, (Math.hypot(ctx.cam[0] - x, ctx.cam[2] - z) - 12) / 30));
    if (far > 0) out.beams.push({ a: [x, y + 2, z], b: [x, y + 30, z], width: 0.3, color: [...rgb, 0.3 * far] });
    // the waypoint, but not over your head while you're on it
    const me = ctx.me?.live && !ctx.me.dead ? ctx.me : null;
    if (!me || !onHill(h, me.pos)) out.markers.push({ pos: [x, y + 3, z], label: me && me.team >= 0 && h.hold === me.team + 1 ? 'HOLD' : 'HILL', color: WHO_C[h.hold], kind: 'hill' });
  },
  cols: [{ head: 'HILL', get: (o) => String(o.points) }],
  // everyone to the hill, defenders too, at a run that still shoots back; held from two thirds of its radius in
  goal(view) {
    const h = hillOf(view);
    return h && { pos: h.pos, r: h.r * (2 / 3), hurry: 0.6, hold: true };
  },
  state(view) {
    const h = hillOf(view);
    return h && { hill: h.at, hold: h.hold, on: h.on, moves: h.moves, score: view.mode().score, target: view.mode().target };
  },
};
