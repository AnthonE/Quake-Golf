// THIN ICE, as drawn and as the AI ball sees it. Every tile a hex prism of
// ice (LOOK.ICE), its cracks spreading over the TI_HOLD ticks after a ball
// cracks it, then dropping away, tumbling and fading. The tiles are read
// straight from the sim (src/mg/thinice.mjs's layout): 0 no tile, 1 whole,
// else the tick it stops holding, so what a tile does on any tick, drawn or
// asked about, is a comparison with that tick.
import * as L from '../../src/layout.mjs';
import { PLAT_Y, hexAt } from '../../src/party-view.mjs';
import { LOOK, SPRITE } from '../party-render.mjs';

const TICK = 0.008;
const HH = 0.25; // a tile's half height, m
const FALL = 1.4; // s a dropped tile is drawn falling
const COLOR = [[0.8, 0.92, 1], [0.66, 0.84, 1], [0.54, 0.74, 0.98]]; // by layer, top first

const top = (k) => PLAT_Y - k * L.TI_GAP;
const index = (q, r, k) => k * L.TI_CELLS + (r + L.TI_N) * L.TI_W + q + L.TI_N;
const TILE0 = (L.PG_BIG + L.TI_TILES) >> 2;
const at = (view, c) => view.i32[TILE0 + c] >>> 0;
// What cell (q, r) of layer k holds, 0 off the grid.
function cell(view, q, r, k) {
  if (q < -L.TI_N || q > L.TI_N || r < -L.TI_N || r > L.TI_N || k < 0 || k >= L.TI_LAYERS) return 0;
  return at(view, index(q, r, k));
}
// What layer k holds under (x, z): hexAt in doubles, for the brain (a point
// right on a cell's edge may pick its neighbour, which steering never minds).
function tileAt(view, x, z, k, cx) {
  const u = (x - cx) / L.TI_S, w = (z - cx) / L.TI_S;
  const fq = u * 0.5773502691896258 - w / 3, fr = w * 0.6666666666666666, fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs), dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return cell(view, q, r, k);
}
// Does a tile holding v hold on tick t (t may be fractional)? As $ti_ground has it.
const holds = (v, t) => v === 1 || (v > 1 && t < v);
const radius = (view) => view.dv.getFloat32(L.PG_H + L.TI_RAD, true);
// The layer a ball at height y is on, or will land on.
const layerOf = (y) => Math.max(0, Math.min(L.TI_LAYERS - 1, Math.ceil((PLAT_Y - y) / L.TI_GAP - 0.01)));
const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
// A ball as the brain is handed it: a slot or a record.
const ball = (view, me) => (typeof me === 'number' ? view.partier(me) : me);

// Balls in, counted by the cell they're over, once per world tick.
function crowd(view) {
  if (view._ti?.tick === view.tick) return view._ti.count;
  const count = new Uint16Array(L.TI_LAYERS * L.TI_CELLS);
  const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
  for (let p = 0; p < L.NPLAYER; p++) {
    const b = L.PLAYERS + view.bank + p * L.PSIZE;
    const fl = view.u8[b + L.P_FL];
    if ((fl & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) !== L.PF_LIVE) continue;
    const [q, r] = hexAt(view.dv.getFloat32(b + L.P_PX, true), view.dv.getFloat32(b + L.P_PZ, true), L.TI_S, cx);
    if (Math.abs(q) <= L.TI_N && Math.abs(r) <= L.TI_N) count[index(q, r, layerOf(view.dv.getFloat32(b + L.P_PY, true)))]++;
  }
  view._ti = { tick: view.tick, count };
  return count;
}

export default {
  id: L.MG_THINICE, key: 'thinice', name: 'THIN ICE',
  hint: 'THE ICE CRACKS UNDER YOU  KEEP ROLLING  LAST ONE UP WINS',
  env: 'snow',

  draw(view, ctx, out) {
    const rad = radius(view);
    if (!(rad > 0)) return;
    const cx = view.party().cx;
    // on the prediction's clock: a tile goes as your own ball drops through it
    const now = ctx.ptick ?? ctx.tick + ctx.dt / TICK;
    const span = Math.min(L.TI_N, Math.ceil(rad / L.TI_S) + 1);
    for (let k = 0; k < L.TI_LAYERS; k++) {
      const [cr, cg, cb] = COLOR[k];
      for (let r = -span; r <= span; r++) for (let q = -span; q <= span; q++) {
        const v = at(view, index(q, r, k));
        if (!v) continue;
        const x = cx + L.TI_S * (1.7320508 * q + 0.8660254 * r), z = cx + L.TI_S * 1.5 * r;
        if (v === 1 || now < v) {
          // cracked: lines at once, spreading, the ice whitening and sinking a little, trembling as it gives
          const crack = v === 1 ? 0 : Math.min(1, Math.max(0, 0.2 + 0.8 * (now - (v - L.TI_HOLD)) / L.TI_HOLD));
          const shake = crack > 0.6 ? 0.04 * Math.sin(now * 2.1 + q * 7 + r * 3) : 0;
          const w = crack * 0.35;
          out.scene.hex(x + shake, top(k) - HH - 0.08 * crack, z, L.TI_S * 0.97, HH, 0, cr + (1 - cr) * w, cg + (1 - cg) * w, cb + (1 - cb) * w, LOOK.ICE, crack);
          continue;
        }
        const fall = (now - v) * TICK;
        if (fall >= FALL) continue;
        out.scene.hex(x, top(k) - HH - 10 * fall * fall, z, L.TI_S * 0.97, HH, fall * (((q * 5 + r * 3) & 3) - 1.5) * 2,
          cr, cg, cb, LOOK.ICE, 1, 0, 1 - fall / FALL);
      }
    }
  },

  // the disc, centred on the highest layer a ball still stands on
  frame(view) {
    const rad = radius(view) || view.party().size;
    const cx = view.party().cx;
    let k = L.TI_LAYERS - 1;
    for (let p = 0; p < L.NPLAYER; p++) {
      const b = L.PLAYERS + view.bank + p * L.PSIZE;
      if ((view.u8[b + L.P_FL] & (L.PF_LIVE | L.PF_DEAD | L.PF_FALL)) === L.PF_LIVE) k = Math.min(k, layerOf(view.dv.getFloat32(b + L.P_PY, true)));
    }
    return { centre: [cx, top(k), cx], radius: rad, shape: 'disc' };
  },

  fx(f, ctx) {
    const d = typeof ctx.dist === 'function' ? ctx.dist(f.pos) : ctx.dist ?? 0;
    const mine = f.owner === ctx.slot;
    if (f.kind === L.TI_FX_CRACK) {
      if (mine || d < 25) ctx.sound?.crackle?.(mine ? 1.2 : Math.min(1, 8 / (d + 8)));
      ctx.glow?.({ pos: [f.pos[0], f.pos[1] + 0.05, f.pos[2]], size: 1.1, color: [0.85, 0.95, 1, 0.8], kind: SPRITE.SPARK, life: 260 });
    } else if (f.kind === L.TI_FX_DROP) {
      if (d < 30) ctx.sound?.land?.(Math.min(12, 120 / (d + 10)));
      ctx.glow?.({ pos: f.pos, size: 2.2, color: [0.75, 0.9, 1, 0.55], kind: SPRITE.RING, life: 400, grow: true });
    }
  },

  // which layer you're on, and how much of it is left
  hud(view, ctx) {
    const me = ctx.me ?? (ctx.slot >= 0 ? view.partier(ctx.slot) : null);
    if (!me || !me.live || me.out || view.hole().state !== L.H_PLAY) return;
    const k = layerOf(me.pos[1]);
    const t = view.tick;
    let left = 0, all = 0;
    for (let c = k * L.TI_CELLS; c < (k + 1) * L.TI_CELLS; c++) {
      const v = at(view, c);
      if (v) { all++; if (holds(v, t)) left++; }
    }
    const pct = all ? Math.round((100 * left) / all) : 0;
    ctx.right(3, `LAYER ${k + 1} OF ${L.TI_LAYERS}  ICE ${pct}%`, k === L.TI_LAYERS - 1 ? ctx.C?.RED : ctx.C?.CYAN);
  },

  brain: {
    // being at (x, z) on tick t, on the layer the ball is on (or falling to):
    // no tile holding there is a fall, deadly from the last layer; a cracked
    // tile that still holds is only a little worse than whole ice, more so the
    // nearer it is to going (the samples further on say whether it lingers)
    danger(view, x, z, tick, me) {
      const b = ball(view, me);
      const k = b ? layerOf(b.pos[1]) : 0;
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      const v = tileAt(view, x, z, k, cx);
      if (!holds(v, tick)) {
        if (k === L.TI_LAYERS - 1) return 1;
        return holds(tileAt(view, x, z, k + 1, cx), tick + 140) ? 0.8 : 0.95;
      }
      if (v > 1) return 0.05 + 0.25 * Math.min(1, Math.max(0, 1 - (v - tick) / L.TI_HOLD));
      const R = radius(view) - 2.5, dx = x - cx, dz = z - cx;
      return dx * dx + dz * dz > R * R ? 0.15 : 0;
    },

    // A point 8 or 14 m off over whole ice, kept (in bot.mem) until the ball
    // is within 6 m of it, it cracks, or it is 2.5 s old: each of 16 ways
    // scored by the whole ice along it (none past a hole) and round its
    // end, the crowd there, the rim, and how sharp a turn it is from the way
    // the ball rolls: a ball that keeps its speed outruns its own cracks.
    goal(view, me, bot) {
      const b = ball(view, me);
      if (!b || !b.live || b.out) return null;
      const k = layerOf(b.pos[1]);
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      const t = view.tick;
      const mem = bot?.mem || {};
      const x0 = bot?.pos?.[0] ?? b.pos[0], z0 = bot?.pos?.[1] ?? b.pos[2];
      const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
      const g = mem.ti;
      if (g && g.k === k && t - g.at < 312 && Math.hypot(g.x - x0, g.z - z0) > 6 && tileAt(view, g.x, g.z, k, cx) === 1) return [g.x, g.z];
      const rim = radius(view) - 3;
      const count = crowd(view);
      const sp = Math.hypot(vx, vz);
      let best = null, score = -Infinity;
      for (let a = 0; a < 16; a++) {
        const ux = Math.cos(a * Math.PI / 8), uz = Math.sin(a * Math.PI / 8);
        let s = sp > 2 ? 2 * Math.min(1, sp / 6) * (ux * vx + uz * vz) / sp : 0, run = 0;
        for (let d = 2; d <= 14; d += 2) {
          const x = x0 + ux * d, z = z0 + uz * d;
          const [q, r] = hexAt(x, z, L.TI_S, cx);
          const v = cell(view, q, r, k);
          if (v !== 1 && !holds(v, t + 40)) { run -= 4; break; }
          run += v === 1 ? 1 : -0.5;
          if ((x - cx) ** 2 + (z - cx) ** 2 > rim * rim) run -= 2;
          if (d !== 8 && d !== 14) continue;
          let whole = 0, people = 0;
          for (const [dq, dr] of [[0, 0], ...NEAR]) {
            if (cell(view, q + dq, r + dr, k) === 1) whole++;
            if (Math.abs(q + dq) <= L.TI_N && Math.abs(r + dr) <= L.TI_N) people += count[index(q + dq, r + dr, k)];
          }
          const total = s + run + 0.4 * whole - 0.8 * people;
          if (total > score) { score = total; best = [x, z]; }
        }
      }
      if (best) mem.ti = { x: best[0], z: best[1], k, at: t };
      return best;
    },

    // a hole just ahead and whole ice where a hop would come down: over it
    hop(view, me, bot) {
      const b = ball(view, me);
      if (!b || !b.ground || b.out) return false;
      const k = layerOf(b.pos[1]);
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      const x0 = bot?.pos?.[0] ?? b.pos[0], z0 = bot?.pos?.[1] ?? b.pos[2];
      const vx = bot?.vel?.[0] ?? b.vel[0], vz = bot?.vel?.[1] ?? b.vel[2];
      const sp = Math.hypot(vx, vz);
      if (sp < 5.5) return false;
      const t = bot?.at ?? view.tick;
      let hole = false;
      for (let d = 0.8; d <= 2.4 && !hole; d += 0.8) hole = !holds(tileAt(view, x0 + vx / sp * d, z0 + vz / sp * d, k, cx), t + d / sp / TICK);
      if (!hole) return false;
      const air = 2 * view.dv.getFloat32(L.PG_HOP + view.bank, true) / 20; // s up and down again
      return holds(tileAt(view, x0 + vx * air, z0 + vz * air, k, cx), t + air / TICK + 30);
    },
  },
};
