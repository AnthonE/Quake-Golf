import test from 'node:test';
import assert from 'node:assert/strict';
import { newParty, partyBytes, predicted } from './helpers.mjs';
import { View, partyWord } from '../src/party-view.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { playParty, partySeed } from '../tools/genparty.mjs';
import race, { course, at, along, pointAt, standings } from '../client/mg/race.mjs';
import * as L from '../src/layout.mjs';

const TICK = 0.008;
const TURN = 16384;
const f32 = Math.fround;

// A room of n balls on Downhill, on the debug build (a NaN traps), stepped
// into play unless asked not to.
async function room(n = 2, { play = true, seed = 7 } = {}) {
  const sim = await newParty(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = v.dv;
  dv.setUint32(L.PG_FORCE, L.MG_RACE + 1, true);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); assert.equal(sim.error().code, 0, 'no trap'); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (play && v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step, c: course(v) };
}
const rec = (p) => L.PLAYERS + p * L.PSIZE;
// Ball p at (x, y, z) (y its bottom), moving v, on the ground or not; its best place down the course `best` m.
function put(g, p, [x, y, z], { v = [0, 0, 0], ground = true, best = null } = {}) {
  const a = rec(p);
  [x, y, z].forEach((q, i) => g.dv.setFloat32(a + L.P_PX + 4 * i, q, true));
  v.forEach((q, i) => g.dv.setFloat32(a + L.P_VX + 4 * i, q, true));
  g.dv.setUint8(a + L.P_FL, L.PF_LIVE | (ground ? L.PF_GROUND : 0));
  if (best !== null) g.dv.setUint32(a + L.PG_M, Math.round(best * 100), true);
}
// The spot on piece P g of the way along, u across, on its floor; the way down there.
const spot = (P, g, u = 0) => { const q = along(P, g, u); return { pos: [q[0], q[1], q[2]], yaw: q[3], dir: [Math.cos(q[3]), Math.sin(q[3])] }; };
const fxs = (v, kind, from = 0) => { const out = []; for (let k = from; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };
const word = (yaw, o = {}) => partyWord({ yaw: Math.round(yaw / (2 * Math.PI) * TURN) & (TURN - 1), move: 1, ...o });
const speed = (b) => Math.hypot(b.vel[0], b.vel[2]);
// How many pieces' floors (within their edges, clear of their ends) hold (x, z).
function holders(c, x, z) {
  let n = 0;
  for (const P of c.pieces) {
    const a = at({ ...c, pieces: [P], hint: 0 }, x, z);
    if (a && Math.abs(a.u) <= a.w) n++;
  }
  return n;
}

test('the course for 1, 8, 64 and 256: one run of pieces down from RC_TOP, every joint closed, a grid for the crowd, every ball on a spot of its own', async () => {
  let lastW = 0;
  for (const n of [1, 8, 64, 256]) {
    const g = await room(n, { play: false, seed: n });
    const r = g.v.party();
    const c = g.c;
    const w = f32(Math.min(L.RC_W0 + L.RC_WK * n, L.RC_WMAX));
    assert.equal(c.w, w, `${n}: half-width`);
    assert.ok(c.w > lastW, 'wider for a crowd');
    lastW = c.w;
    assert.deepEqual([r.kind, r.len, r.respawn], [L.PK_SCORE, L.RC_LEN, L.RC_BACK]);
    assert.deepEqual([r.acc, r.drag, r.idle].map((x) => x.toFixed(4)), [L.RC_ACC, L.RC_DRAG, L.RC_IDLE].map((x) => f32(x).toFixed(4)));
    assert.ok(c.pieces.length >= 18 && c.pieces.length <= L.RC_NP, `${c.pieces.length} pieces`);
    assert.ok(c.hazards.length > 4 && c.hazards.length <= L.RC_NH, `${c.hazards.length} hazards`);
    assert.equal(c.pieces[0].h0, L.RC_TOP);
    assert.ok(c.pieces[0].fl & L.RCF_START && c.pieces.at(-1).fl & L.RCF_PEN);
    assert.equal(r.floor, c.pieces.at(-1).h1, 'the lowest floor is the pen\'s');
    assert.ok(c.fin > 380 && c.fin < 700, `the line ${c.fin.toFixed(0)} m down`);
    assert.ok(c.top - r.floor > 35, `${(c.top - r.floor).toFixed(0)} m of drop`);
    // every section in it, the jump among them
    for (const sec of [L.RCS_DROP, L.RCS_BEND, L.RCS_JUMP, L.RCS_FUNNEL, L.RCS_BUMPERS, L.RCS_SPINNERS, L.RCS_SWEEPERS, L.RCS_FINISH]) assert.ok(c.pieces.some((P) => P.sec === sec), `${n}: section ${sec}`);
    for (let k = 1; k < c.pieces.length; k++) {
      const A = c.pieces[k - 1], B = c.pieces[k];
      assert.equal(B.s0, f32(A.s0 + A.len), 'metres down run on');
      assert.equal(B.h0, A.h1, 'heights meet');
      assert.equal(B.w0, A.w1, 'widths meet');
      const e = along(A, 1, 0), s = along(B, 0, 0);
      assert.ok(Math.hypot(e[0] - s[0], e[2] - s[2]) < 2e-3, `${n}: piece ${k - 1} ends where ${k} starts`);
      const turn = Math.abs(((e[3] - s[3] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      assert.ok(turn < 2e-3, 'heading on');
      assert.ok(Math.abs(B.yaw) <= L.RC_YAWMAX + L.RC_SWEEP0 + L.RC_SWEEPK, 'never heading back');
    }
    // centred on the stage's centre, PG_SIZE its half span
    const [x0, z0, x1, z1] = c.box;
    assert.ok(Math.abs((x0 + x1) / 2 - L.B_CX) < 0.01 && Math.abs((z0 + z1) / 2 - L.B_CX) < 0.01, 'centred');
    assert.ok(Math.abs(r.size - Math.max(x1 - x0, z1 - z0) / 2) < 0.01);
    // the grid: every ball on the start piece, on its floor, apart
    const G = c.pieces[0];
    const spots = [];
    for (let p = 0; p < n; p++) {
      const b = g.v.partier(p);
      const a = at(c, b.pos[0], b.pos[2]);
      assert.ok(a && a.P === G && Math.abs(a.u) < G.w0 - 1, `${n}: P${p + 1} on the grid`);
      assert.equal(b.pos[1], G.h0);
      assert.ok(b.ground && !b.out);
      spots.push([b.pos[0], b.pos[2]]);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]) > 2.4, `${n}: ${i} and ${j} apart`);
  }
});

test('courses from many seeds and crowds never cross themselves: every spot of a piece\'s floor is over that piece alone, the pen within reach', async () => {
  for (let seed = 1; seed <= 24; seed++) {
    const n = [1, 16, 100, 256][seed % 4];
    const g = await room(n, { play: false, seed: seed * 7919 });
    const c = g.c;
    for (const P of c.pieces) {
      for (const gg of [0.05, 0.3, 0.5, 0.7, 0.95]) for (const uu of [-0.97, -0.5, 0, 0.5, 0.97]) {
        const w = P.w0 + (P.w1 - P.w0) * gg;
        const q = along(P, gg, uu * w);
        assert.equal(holders(c, q[0], q[2]), 1, `seed ${seed}: piece ${P.k} at ${gg}, ${uu}`);
        assert.equal(at(c, q[0], q[2])?.P, P);
      }
    }
    assert.ok(c.box[2] - c.box[0] < 900 && c.box[3] - c.box[1] < 900, 'inside the world');
  }
});

test('the track pulls a ball downhill and it keeps its grip over every slope; on the flat grid it stays put', async () => {
  const g = await room(2);
  const D = g.c.pieces.find((P) => P.sec === L.RCS_DROP);
  const at0 = spot(D, 0.15);
  put(g, 0, at0.pos);
  put(g, 1, spot(g.c.pieces[0], 0.5, -3).pos);
  const start = g.v.partier(1).pos;
  let air = 0;
  for (let k = 0; k < 120; k++) {
    g.step();
    const b = g.v.partier(0);
    if (!b.ground) air++;
    const a = at(g.c, b.pos[0], b.pos[2]);
    if (a && a.P === D) assert.ok(Math.abs(b.pos[1] - a.h) < 0.02, `on the floor ${k}: ${b.pos[1]} vs ${a.h}`);
  }
  const b = g.v.partier(0);
  assert.ok(air <= 2, `${air} ticks off the floor rolling down`);
  const v = b.vel[0] * at0.dir[0] + b.vel[2] * at0.dir[1];
  // a slope of RC_DROPSL or more pulls RC_PULL m/s^2 a unit of it, against the idle drag (no keys): 1.7 m/s in a second
  const sl = -(D.h1 - D.h0) / D.len;
  const want = L.RC_PULL * sl * (1 - Math.exp(-120 * (1 - L.RC_IDLE))) / (125 * (1 - L.RC_IDLE));
  assert.ok(Math.abs(v - want) < 0.15 * want, `${v.toFixed(2)} m/s down the course from rest, no keys (${want.toFixed(2)})`);
  assert.ok(b.vel[1] < 0, 'falling with the slope');
  assert.deepEqual(g.v.partier(1).pos, start, 'the grid is flat');
});

test('off the edge: down once RC_DEEP under its best place, back at its last checkpoint RC_BACK ticks later, its best kept', async () => {
  const g = await room(2);
  const S = g.c.pieces.find((P) => P.sec === L.RCS_SWEEPERS);
  const before = g.c.pieces.filter((P) => (P.fl & L.RCF_CHECK) && P.s0 <= S.s0 + 5).at(-1);
  const q = spot(S, 0.04, S.w0 - 0.2);
  const left = [-q.dir[1], q.dir[0]];
  put(g, 0, q.pos, { v: [left[0] * 6, 0, left[1] * 6], best: S.s0 + 5 });
  const best = g.v.partier(0).m;
  let k = 0;
  while (!g.v.partier(0).out && k++ < 400) g.step();
  const t0 = g.v.tick - 1;
  assert.ok(g.v.partier(0).out, 'down');
  assert.ok(k > 30 && k < 120, `down ${k} ticks after going over`);
  const sink = fxs(g.v, L.FX_SINK).at(-1);
  assert.equal(sink.owner, 0);
  assert.ok(sink.pos[1] < S.h0 - L.RC_DEEP + 0.5, 'RC_DEEP under');
  assert.equal(g.v.partier(0).m, best, 'its best stands');
  while (g.v.partier(0).out) g.step();
  assert.equal(g.v.tick - 1 - t0, L.RC_BACK - 1, 'back a tick before the framework would send it to the grid');
  const b = g.v.partier(0);
  const a = at(g.c, b.pos[0], b.pos[2]);
  assert.equal(a.P, before, 'at the checkpoint');
  assert.ok(Math.abs(a.f * a.P.len - 3) < 0.01 && b.pos[1] > a.h + 1, '3 m in, falling in');
  assert.equal(b.m, best);
  for (let n = 0; n < 60; n++) g.step();
  assert.ok(g.v.partier(0).ground && !g.v.partier(0).out, 'and rolling again');
});

test('rails: a ball shoved at a railed edge stays on; at a bare edge it goes over', async () => {
  const g = await room(2);
  const R = g.c.pieces.find((P) => P.sec === L.RCS_BUMPERS);
  const B = g.c.pieces.find((P) => P.sec === L.RCS_FUNNEL);
  for (const [P, railed] of [[R, true], [B, false]]) {
    const q = spot(P, 0.04, P.w0 - 3.5);
    const left = [-q.dir[1], q.dir[0]];
    put(g, 0, q.pos, { v: [left[0] * 14, 0, left[1] * 14], best: P.s0 });
    for (let k = 0; k < (railed ? 60 : 300) && !g.v.partier(0).out; k++) g.step();
    const b = g.v.partier(0);
    const a = at(g.c, b.pos[0], b.pos[2]);
    if (railed) {
      assert.ok(a && a.u < a.w - 0.99 && a.u > 0, `kept in: u ${a?.u}`);
      assert.ok(b.ground && !b.out);
      assert.ok(b.vel[0] * left[0] + b.vel[2] * left[1] < 0, 'bounced off the rail');
    } else assert.ok(b.out, 'over the bare edge and down');
    put(g, 0, spot(g.c.pieces[0], 0.5).pos, { best: 0 });
    while (g.v.partier(0).out) g.step();
  }
});

test('the jump: fast, a ball leaves the kicker\'s lip flying and lands past the gap; slow, it drops in, the landing\'s face stops it, and it\'s down', async () => {
  const g = await room(2);
  const K = g.c.pieces.find((P, k) => P.sec === L.RCS_JUMP && g.c.pieces[k + 1]?.fl & L.RCF_GAP);
  const Gp = g.c.pieces[K.k + 1], Land = g.c.pieces[K.k + 2];
  assert.ok(Land.fl & L.RCF_FACE && K.h1 > K.h0, 'kicker, gap, landing');
  for (const [v0, clears, g0] of [[15, true, 0.3], [5, false, 0.85]]) {
    const q = spot(K, g0);
    put(g, 0, q.pos, { v: [q.dir[0] * v0, 0, q.dir[1] * v0], best: K.s0 + 2 });
    let flew = false, peak = -1e9, k = 0;
    for (; k < 300; k++) {
      g.step([[L.EV_INPUT, 0, word(q.yaw)]]);
      const b = g.v.partier(0);
      if (b.out) break;
      const a = at(g.c, b.pos[0], b.pos[2]);
      if (a?.P === Gp) { flew = true; peak = Math.max(peak, b.pos[1]); }
      if (a?.P === Land && b.ground) break;
    }
    const b = g.v.partier(0);
    const a = at(g.c, b.pos[0], b.pos[2]);
    if (clears) {
      assert.ok(flew && peak > K.h1 + 0.2, `flew off the lip, up to ${(peak - K.h1).toFixed(2)} m over it`);
      assert.ok(a.P === Land && b.ground && !b.out, 'landed past the gap');
    } else {
      assert.ok(b.out, 'down in the gap');
      const sink = fxs(g.v, L.FX_SINK).at(-1);
      const s = at(g.c, sink.pos[0], sink.pos[2]);
      assert.equal(s?.P, Gp, 'down in the gap, not past its face');
    }
    put(g, 0, spot(g.c.pieces[0], 0.5).pos, { best: 0 });
    while (g.v.partier(0).out) g.step();
  }
});

test('hazards on the clock: a bumper post throws a ball off it; a spinner\'s bar knocks a ball away and up, unless it\'s over the bar; a sweeper shoves a ball across; a pad speeds one down', async () => {
  const g = await room(2);
  const c = g.c;
  const H = (kind) => c.hazards.find((h) => h.kind === kind);
  // a bumper
  const bp = H(L.RCH_BUMPER);
  put(g, 0, [bp.x - bp.piece.dx * 2.6, bp.y, bp.z - bp.piece.dz * 2.6], { v: [bp.piece.dx * 8, 0, bp.piece.dz * 8], best: bp.piece.s0 });
  const fx0 = g.v.fxCount();
  for (let k = 0; k < 40; k++) g.step();
  const hit = fxs(g.v, L.RC_FX_BUMP, fx0)[0];
  assert.ok(hit && hit.owner === 0 && hit.shot === bp.j, 'its FX, the post as shot');
  assert.ok(g.v.partier(0).vel[0] * bp.piece.dx + g.v.partier(0).vel[2] * bp.piece.dz < -4, 'thrown back up the course');
  // a spinner: a ball at rest 3 m out from the post, ahead of the bar by 25 ticks of its turning
  const sp = H(L.RCH_SPINNER);
  for (const over of [false, true]) {
    const t = g.v.party().t;
    const an = (sp.ph + sp.spd * (t + 70)) * 2 * Math.PI / TURN;
    const pos = [sp.x + Math.cos(an) * 3, sp.y, sp.z + Math.sin(an) * 3];
    // over: high enough to stay over the bar (RC_BAR_HI) until it has gone by
    put(g, 0, over ? [pos[0], sp.y + 2.5, pos[2]] : pos, { v: over ? [0, 6, 0] : [0, 0, 0], ground: !over, best: sp.piece.s0 });
    let k = 0, max = 0;
    for (; k < 80; k++) { g.step(); max = Math.max(max, speed(g.v.partier(0))); if (max > 3) break; }
    if (over) assert.ok(max < 1, `over the bar: ${max.toFixed(2)} m/s`);
    else {
      // the bar's side meets the ball when the angle between them is asin(1.45 / 3), 29 degrees
      const due = 70 - Math.asin((1 + L.RC_BAR_R) / 3) / (Math.abs(sp.spd) * 2 * Math.PI / TURN);
      assert.ok(Math.abs(k - due) < 4 && max > 3, `hit ${k} ticks on (due ${due.toFixed(1)}) at ${max.toFixed(1)} m/s`);
      assert.ok(!g.v.partier(0).ground && g.v.partier(0).vel[1] >= L.RC_BAR_POP - 0.2, 'and up');
    }
  }
  // a sweeper: a ball at rest on its lane's middle line, the bar coming
  const sw = H(L.RCH_SWEEPER);
  const left = [-sw.piece.dz, sw.piece.dx];
  const t = g.v.party().t;
  const off = (tt) => sw.a * Math.sin((sw.ph + sw.spd * tt) * 2 * Math.PI / TURN);
  // where the bar's middle will be in 20 ticks, a little further on
  const o = off(t + 20), dir = Math.sign(off(t + 21) - o) || 1;
  put(g, 0, [sw.x + left[0] * (o + dir * 0.3), sw.y, sw.z + left[1] * (o + dir * 0.3)], { best: sw.piece.s0 });
  let lat = 0;
  for (let k = 0; k < 40 && Math.abs(lat) < 2; k++) { g.step(); const b = g.v.partier(0); lat = b.vel[0] * left[0] + b.vel[2] * left[1]; }
  assert.ok(Math.abs(lat) > 2 && Math.sign(lat) === dir, `shoved across at ${lat.toFixed(1)} m/s`);
  // a pad
  const pd = H(L.RCH_PAD);
  put(g, 0, [pd.x - pd.piece.dx * 2, pd.y + (pd.piece.h1 - pd.piece.h0) / pd.piece.len * -2, pd.z - pd.piece.dz * 2], { v: [pd.piece.dx * 5, 0, pd.piece.dz * 5], best: pd.piece.s0 });
  const pad = [];
  for (let k = 0; k < 30; k++) { g.step(); const b = g.v.partier(0); pad.push(b.vel[0] * pd.piece.dx + b.vel[2] * pd.piece.dz); }
  assert.ok(pad.at(-1) > 5 + 30 * L.RC_PAD_A * TICK * 0.5, `${pad.at(-1).toFixed(1)} m/s off the pad`);
});

test('power-up boxes: two rows, halfway down the first drop and early in the last; a ball holding nothing takes what the box hands its slot, the same every pass, and uses it as bumper\'s balls do', async () => {
  const g = await room(3);
  const c = g.c;
  const boxes = c.hazards.filter((h) => h.kind === L.RCH_BOX);
  const rows = [...new Set(boxes.map((h) => h.piece.k))];
  assert.equal(rows.length, 2, 'two rows');
  assert.equal(rows[0], 1, 'the first on the first drop');
  assert.ok(boxes.every((h) => h.piece.sec === L.RCS_DROP));
  assert.ok(boxes.filter((h) => h.piece.k === rows[0]).length >= 2);
  const B = boxes[1];
  const items = new Set();
  for (const p of [0, 1, 2]) {
    put(g, p, [B.x - B.piece.dx * 2.5 + B.piece.dz * 0.2 * p, B.y + (B.piece.h1 - B.piece.h0) / B.piece.len * -2.5, B.z - B.piece.dz * 2.5], { v: [B.piece.dx * 8, 0, B.piece.dz * 8], best: B.piece.s0 + B.piece.len / 2 - 3 });
    const fx0 = g.v.fxCount();
    let k = 0;
    while (!g.v.partier(p).item && k++ < 60) g.step();
    const it = g.v.partier(p).item;
    assert.ok(it >= L.PU_MEGA && it <= L.PU_SPRING, `P${p + 1} took ${L.PU_NAMES[it]}`);
    const f = fxs(g.v, L.FX_PICKUP, fx0).find((x) => x.owner === p);
    assert.ok(f && f.shot === B.j && f.size === it, 'its pickup FX: the box as shot, the power-up as size');
    items.add(it);
    // holding one, it takes no other; back through the same box with nothing, the same one again
    put(g, p, [B.x - B.piece.dx * 2.5, B.y + (B.piece.h1 - B.piece.h0) / B.piece.len * -2.5, B.z - B.piece.dz * 2.5], { v: [B.piece.dx * 8, 0, B.piece.dz * 8], best: B.piece.s0 + B.piece.len / 2 - 3 });
    for (let n = 0; n < 40; n++) g.step();
    assert.equal(g.v.partier(p).item, it, 'kept');
    g.dv.setUint8(rec(p) + L.B_ITEM, 0);
    put(g, p, [B.x - B.piece.dx * 2.5, B.y + (B.piece.h1 - B.piece.h0) / B.piece.len * -2.5, B.z - B.piece.dz * 2.5], { v: [B.piece.dx * 8, 0, B.piece.dz * 8], best: B.piece.s0 + B.piece.len / 2 - 3 });
    k = 0;
    while (!g.v.partier(p).item && k++ < 60) g.step();
    assert.equal(g.v.partier(p).item, it, 'the same again');
    put(g, p, spot(c.pieces[0], 0.5, (p - 1) * 3).pos, { best: 0 });
  }
  // a dash, used: off at DASH_V where it faces
  g.dv.setUint8(rec(0) + L.B_ITEM, L.PU_DASH);
  const yaw = Math.atan2(c.pieces[0].dz, c.pieces[0].dx);
  g.step([[L.EV_INPUT, 0, word(yaw, { move: 0, use: 1 })]]);
  assert.equal(g.v.partier(0).item, 0, 'used');
  assert.ok(speed(g.v.partier(0)) > 15, `dashing at ${speed(g.v.partier(0)).toFixed(1)} m/s`);
});

test('a cut: a ball that comes down more than RC_SKIP past its best is down for it, its best unchanged', async () => {
  const g = await room(2);
  const P = g.c.pieces.find((Q) => Q.sec === L.RCS_SPINNERS);
  put(g, 0, spot(P, 0.5, -P.w0 * 0.6).pos, { best: P.s0 - 40 });
  const fx0 = g.v.fxCount();
  g.step();
  assert.ok(g.v.partier(0).out, 'down');
  assert.equal(fxs(g.v, L.RC_FX_CUT, fx0)[0]?.owner, 0);
  assert.equal(g.v.partier(0).m, Math.round((P.s0 - 40) * 100));
  // within RC_SKIP it's just progress
  put(g, 1, spot(P, 0.1, P.w0 * 0.6).pos, { best: P.s0 + 0.1 * P.len - L.RC_SKIP + 1 });
  g.step();
  const b = g.v.partier(1);
  assert.ok(!b.out && b.m >= Math.floor((P.s0 + 0.1 * P.len - 0.1) * 100), `best now ${b.m / 100}`);
  assert.equal(b.score, Math.floor(b.m / 100), 'PG_SCORE: metres down');
});

test('home: over the line a ball scores RC_WIN plus the ticks it had left and takes its place; the first cuts the clock to RC_LATE; everyone home ends it, placed by finishing order', async () => {
  const g = await room(3);
  const c = g.c;
  const fin = pointAt(c, c.fin - 1.5, 0);
  const F = fin.P;
  const shove = (p, u, v = 8) => { const q = along(F, (c.fin - 1.5 - F.s0) / F.len, u); put(g, p, [q[0], q[1], q[2]], { v: [Math.cos(q[3]) * v, 0, Math.sin(q[3]) * v], best: c.fin - 1.5 }); };
  shove(0, -2);
  const fx0 = g.v.fxCount();
  let k = 0;
  while (g.v.partier(0).score < L.RC_WIN && k++ < 60) g.step();
  const t0 = g.v.party().t - 1;
  assert.equal(g.v.partier(0).score, L.RC_WIN + L.RC_LEN - t0, 'RC_WIN and the ticks it had left');
  g.step();
  const home = fxs(g.v, L.RC_FX_HOME, fx0);
  assert.deepEqual([home.length, home[0].owner, home[0].size], [1, 0, 1], 'home 1st');
  const late = fxs(g.v, L.RC_FX_LATE, fx0)[0];
  assert.equal(late.owner, 0);
  assert.equal(g.v.hole().until, g.v.party().start + t0 + L.RC_LATE, 'the clock cut');
  assert.equal(late.size, L.RC_LATE / 125);
  // in the pen it stays: its walls and the mouth's push keep it in
  for (let n = 0; n < 200; n++) g.step([[L.EV_INPUT, 0, word(fin.p[3] + Math.PI)]]);
  const a = at(c, g.v.partier(0).pos[0], g.v.partier(0).pos[2]);
  assert.ok(a.P.fl & L.RCF_PEN, 'still in the pen');
  // two more, the second over on the same tick as the third
  shove(1, 2);
  shove(2, -4);
  while (g.v.partier(1).score < L.RC_WIN) g.step();
  assert.equal(g.v.partier(1).score, g.v.partier(2).score, 'the same tick, the same score');
  const list = standings(g.v);
  assert.deepEqual(list.map((e) => [e.slot, e.rank]), [[0, 1], [1, 2], [2, 2]]);
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER, 'everyone home: over on that tick');
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).place), [1, 2, 2]);
  assert.deepEqual([0, 1, 2].map((p) => g.v.partier(p).pts), [10, 5, 5], '10 for 1st, 2nd of 3 shared');
  assert.equal(r.winner, 0);
  assert.deepEqual(fxs(g.v, L.RC_FX_HOME, fx0).map((f) => [f.owner, f.size]), [[0, 1], [1, 2], [2, 2]]);
});

test('the clock: nobody home, the round ends at PG_LEN, placed by how far down; a newcomer in play starts on the grid', async () => {
  const g = await room(3);
  const c = g.c;
  // parked on the flat grid, each with a best place down the course
  for (const [p, s] of [[0, 120.4], [1, 300.9], [2, 300.2]]) put(g, p, spot(c.pieces[0], 0.5, (p - 1) * 3).pos, { best: s });
  g.step([[L.EV_JOIN, 3]]);
  const b = g.v.partier(3);
  const a = at(c, b.pos[0], b.pos[2]);
  assert.ok(a?.P === c.pieces[0] && b.pos[1] > a.h + 5 && !b.out, 'a newcomer drops onto the grid');
  while (g.v.party().state === L.H_PLAY) g.step();
  const r = g.v.party();
  assert.equal(r.state, L.H_OVER);
  assert.equal(r.tick - 1 - r.start, L.RC_LEN, 'at PG_LEN');
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).score), [120, 300, 300, g.v.partier(3).score]);
  assert.deepEqual([0, 1, 2, 3].map((p) => g.v.partier(p).place), [3, 1, 1, 4], 'by metres, ties shared');
});

test('the prediction matches the confirmed ball bit for bit down the course: its slopes, a bend\'s rail, the jump, the spinners, the sweepers, bumpers and pads', async () => {
  const g = await room(2);
  const c = g.c;
  let compared = 0;
  // from the start of each section, rolling for the course's way through it (a wobble across, a hop now and then)
  for (const sec of [L.RCS_DROP, L.RCS_BEND, L.RCS_JUMP, L.RCS_SPINNERS, L.RCS_SWEEPERS, L.RCS_BUMPERS, L.RCS_FUNNEL]) {
    const P = c.pieces.find((Q) => Q.sec === sec);
    for (const lane of [-0.5, 0.3]) {
      const q = spot(P, 0.02, lane * P.w0);
      put(g, 0, q.pos, { v: [q.dir[0] * 10, 0, q.dir[1] * 10], best: P.s0 });
      put(g, 1, spot(c.pieces[0], 0.5).pos, { best: 0 });
      for (let n = 0; n < 16; n++) {
        const b = g.v.partier(0);
        if (b.out || b.falling || b.pos[1] < (at(c, b.pos[0], b.pos[2])?.h ?? -1e9) - 2) break;
        const a = at(c, b.pos[0], b.pos[2]);
        const yaw = a ? Math.atan2(a.tz, a.tx) : q.yaw;
        const words = Array.from({ length: 10 }, (_, i) => word(yaw + 0.4 * Math.sin((n * 10 + i) * 0.05), { hop: (n * 10 + i) % 70 === 35 ? 1 : 0 }));
        compared += predicted(g, words);
      }
    }
  }
  assert.ok(compared > 800, `${compared} predictions compared`);
});

for (const [balls, ticks] of [[8, 14000], [64, 14000]]) {
  test(`a round of ${balls} AI balls on the debug build: no trap, most of them home, the round over and placed; equal on 1 and 4 threads`, async () => {
    let start = -1, over = -1, places = null, pts = null, home = 0, seen = 0;
    const { log, sim, view } = await playParty({ bytes: partyBytes(true), seed: balls + 3, mg: L.MG_RACE, bots: balls, ticks, onTick: (t, s, v) => {
      if (s.error().code) throw new Error(`trap ${JSON.stringify(s.error())}`);
      const g = v.party();
      if (start < 0 && g.state === L.H_PLAY) start = t;
      for (; seen < v.fxCount(); seen++) { const f = v.fx(seen); if (over < 0) home += f.kind === L.RC_FX_HOME; }
      if (over < 0 && start >= 0 && g.state === L.H_OVER) {
        over = t;
        places = [...Array(balls).keys()].map((p) => v.partier(p).place);
        pts = [...Array(balls).keys()].map((p) => v.partier(p).pts);
      }
    } });
    assert.equal(sim.error().code, 0);
    assert.ok(over > 0, 'the round ended');
    const secs = (over - start) * TICK;
    assert.ok(secs > 25 && secs <= L.RC_LEN * TICK, `${secs.toFixed(1)} s of play`);
    assert.ok(home >= balls * 0.4, `${home} of ${balls} home`);
    assert.ok(places.every((x) => x >= 1 && x <= balls), `places ${places}`);
    assert.ok(pts.every((x) => x >= 1 && x <= 10), `points ${pts}`);
    assert.ok(places.includes(1) && pts.includes(10), 'somebody won');
    assert.equal(view.party().game, L.MG_RACE);
    const parsed = parseLog(log);
    const n = over + 50;
    const a = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 1, tag: 't1' });
    const b = await replay({ bytes: partyBytes(), log: parsed, ticks: n, threads: 4, tag: 't4', startWorkers });
    const d = await replay({ bytes: partyBytes(true), log: parsed, ticks: n, threads: 1, tag: 'd1' });
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
    assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(d.trace).tickHashes], 'the debug build steps the same bits');
    assert.equal(partySeed(balls + 3, L.MG_RACE) >>> 24, 0xa7);
  });
}

test('the client module: the course as the sim has it (a ball dropped anywhere on it lands on the floor the mirror says), drawn, framed, its HUD lines and its brain', async () => {
  const { Scene } = await import('../client/party-render.mjs');
  const g = await room(4, { seed: 99 });
  const c = g.c;
  let k = 0;
  for (const P of c.pieces) {
    if (P.fl & L.RCF_GAP) continue;
    for (const gg of [0.2, 0.6]) {
      const u = ((k++ * 37) % 11 - 5) / 6 * P.w0 * 0.9;
      const q = along(P, gg, u);
      const a = at(c, q[0], q[2]);
      put(g, 1, [q[0], a.h + 0.25, q[2]], { ground: false, best: P.s0 + gg * P.len });
      g.step();
      const b = g.v.partier(1);
      const a2 = at(c, b.pos[0], b.pos[2]);
      assert.ok(b.ground && Math.abs(b.pos[1] - a2.h) < 1e-3, `piece ${P.k}: on the floor at ${b.pos[1]} (${a2.h})`);
    }
  }
  const out = { scene: new Scene(24000), solid: [], glow: [], beams: [], decals: [], casters: [], paint: null };
  race.draw(g.v, { tick: g.v.tick, dt: 0, t: g.v.party().t * TICK, ptick: g.v.tick, now: 0, slot: 0 }, out);
  assert.ok(out.scene.count > 500 && out.scene.count < 12000, `${out.scene.count} solids`);
  for (let i = 0; i < out.scene.count * 16; i++) assert.ok(Number.isFinite(out.scene.data[i]), 'finite');
  const fr = race.frame(g.v);
  assert.equal(fr.shape, 'square');
  assert.ok(Math.abs(fr.radius - g.v.party().size) < 0.01);
  assert.equal(race.facing(g.v, 0), Math.atan2(c.pieces[0].dz, c.pieces[0].dx));
  const lines = [];
  const hctx = { put: (x, y, s, col) => lines.push([y, s, col]), centre: (y, s, col) => lines.push([y, s, col]), right: (y, s, col) => lines.push([y, s, col]), rows: 44, C: {}, slot: 0, me: g.v.partier(0), now: 0 };
  race.hud(g.v, hctx);
  const text = lines.map((l) => l[1]).join(' | ');
  assert.ok(/(\d+)(ST|ND|RD|TH) OF 4/.test(text) && /M TO GO/.test(text), text);
  for (const l of lines) assert.ok(l[1].length <= 80, l[1]);
  assert.ok(race.hint.length <= 70);
  // danger: off the course deadly, the middle of a drop fine, a spinner's bar where it will be
  const D = c.pieces.find((P) => P.sec === L.RCS_DROP && P.k > 1);
  const mid = along(D, 0.5, 0);
  assert.equal(race.brain.danger(g.v, mid[0], mid[2], g.v.tick, g.v.partier(0)), 0);
  assert.equal(race.brain.danger(g.v, mid[0] + Math.cos(mid[3] + Math.PI / 2) * (D.w0 + 4), mid[2] + Math.sin(mid[3] + Math.PI / 2) * (D.w0 + 4), g.v.tick, g.v.partier(0)), 1);
  const sp = c.hazards.find((h) => h.kind === L.RCH_SPINNER);
  const T = g.v.tick + 40, an = (sp.ph + sp.spd * (T - g.v.party().start)) * 2 * Math.PI / TURN;
  assert.ok(race.brain.danger(g.v, sp.x + Math.cos(an) * 4, sp.z + Math.sin(an) * 4, T, g.v.partier(0)) > 0.8, 'on the bar');
  // its goal is down the course from it
  const b = g.v.partier(0);
  const goal = race.brain.goal(g.v, b, { mem: {}, skill: 0.6 });
  const ga = at(c, goal[0], goal[1]), ba = at(c, b.pos[0], b.pos[2]);
  assert.ok(ga && ba && ga.s > ba.s, 'ahead');
});
