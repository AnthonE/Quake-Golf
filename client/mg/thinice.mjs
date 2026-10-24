// THIN ICE, as drawn and as the AI ball sees it. Every tile a hex prism of
// ice (LOOK.ICE), its cracks spreading over the TI_HOLD ticks after a ball
// cracks it, then dropping away, tumbling and fading. The tiles are read
// straight from the sim (src/mg/thinice.mjs's layout): 0 no tile, 1 whole,
// else the tick it stops holding, so what a tile does on any tick, drawn or
// asked about, is a comparison with that tick.
import * as L from '../../src/layout.mjs';
import { PLAT_Y, hexAt, hexCentre } from '../../src/party-view.mjs';
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
    const now = ctx.tick + ctx.dt / TICK;
    const span = Math.min(L.TI_N, Math.ceil(rad / L.TI_S) + 1);
    for (let k = 0; k < L.TI_LAYERS; k++) {
      const [cr, cg, cb] = COLOR[k];
      for (let r = -span; r <= span; r++) for (let q = -span; q <= span; q++) {
        const v = at(view, index(q, r, k));
        if (!v) continue;
        const [x, z] = hexCentre(q, r, L.TI_S, cx);
        if (v === 1 || now < v) {
          const crack = v === 1 ? 0 : Math.min(1, Math.max(0, (now - (v - L.TI_HOLD)) / L.TI_HOLD));
          // a cracked tile trembles as it gives
          const shake = crack > 0.6 ? 0.03 * Math.sin(now * 2.1 + q * 7 + r * 3) : 0;
          out.scene.hex(x + shake, top(k) - HH, z, L.TI_S * 0.97, HH, 0, cr, cg, cb, LOOK.ICE, crack);
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
    // no tile there is a fall, deadly from the last layer; a cracked tile is
    // worse the nearer it is to going
    danger(view, x, z, tick, me) {
      const b = ball(view, me);
      const k = b ? layerOf(b.pos[1]) : 0;
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      const [q, r] = hexAt(x, z, L.TI_S, cx);
      const v = cell(view, q, r, k);
      if (!holds(v, tick)) {
        if (k === L.TI_LAYERS - 1) return 1;
        return holds(cell(view, q, r, k + 1), tick + 140) ? 0.75 : 0.95;
      }
      if (v > 1) return 0.3 + 0.45 * Math.min(1, Math.max(0, 1 - (v - tick) / L.TI_HOLD));
      const e = radius(view) - Math.hypot(x - cx, z - cx);
      return e < 2.5 ? 0.25 : 0;
    },

    // whole ice near it, with whole ice round it, away from the crowd and the rim
    goal(view, me) {
      const b = ball(view, me);
      if (!b || !b.live || b.out) return null;
      const k = layerOf(b.pos[1]);
      const cx = view.dv.getFloat32(L.PG_CX + view.bank, true);
      const rim = radius(view) - 4;
      const [mq, mr] = hexAt(b.pos[0], b.pos[2], L.TI_S, cx);
      const count = crowd(view);
      const tiles = view.i32;
      const base = k * L.TI_CELLS + L.TI_N * L.TI_W + L.TI_N; // cell (0, 0) of layer k
      const mine = Math.abs(mq) <= L.TI_N && Math.abs(mr) <= L.TI_N ? base + mr * L.TI_W + mq : -1;
      const ok = (q, r) => q >= -L.TI_N && q <= L.TI_N && r >= -L.TI_N && r <= L.TI_N;
      let best = null, score = -Infinity;
      for (let dr = -6; dr <= 6; dr++) for (let dq = -6; dq <= 6; dq++) {
        if (Math.abs(dq + dr) > 6) continue;
        const q = mq + dq, r = mr + dr;
        if (!ok(q, r) || tiles[TILE0 + base + r * L.TI_W + q] !== 1) continue;
        const x = cx + L.TI_S * (1.7320508 * q + 0.8660254 * r), z = cx + L.TI_S * 1.5 * r;
        let s = 0, people = count[base + r * L.TI_W + q];
        for (const [a, c] of NEAR) {
          if (!ok(q + a, r + c)) continue;
          const n = base + (r + c) * L.TI_W + q + a;
          if (tiles[TILE0 + n] === 1) s += 0.15;
          people += 0.5 * count[n];
        }
        if (mine >= 0 && Math.abs(dq) <= 1 && Math.abs(dr) <= 1 && Math.abs(dq + dr) <= 1) people -= dq || dr ? 0.5 : 1;
        s -= 0.6 * people;
        const ex = x - b.pos[0], ez = z - b.pos[2], ox = x - cx, oz = z - cx;
        s -= 0.04 * Math.sqrt(ex * ex + ez * ez);
        if (ox * ox + oz * oz > rim * rim) s -= 0.5;
        if (s > score) { score = s; best = [x, z]; }
      }
      return best;
    },

    hop() { return false; },
  },
};
