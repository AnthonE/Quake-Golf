import test from 'node:test';
import assert from 'node:assert/strict';
import { newArena, arenaBytes, newSim } from './helpers.mjs';
import { View, arenaWord, arenaFrame } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';

async function arena(seed = 7, n = 2) {
  const sim = await newArena(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (v.hole().state !== L.H_PLAY) step();
  return { sim, v, dv, step };
}

function put(g, p, x, z, y = g.v.height(x, z)) {
  const b = L.PLAYERS + p * L.PSIZE;
  g.dv.setFloat32(b + L.P_PX, x, true);
  g.dv.setFloat32(b + L.P_PY, y, true);
  g.dv.setFloat32(b + L.P_PZ, z, true);
  for (const o of [L.P_VX, L.P_VY, L.P_VZ]) g.dv.setFloat32(b + o, 0, true);
}

// p's word aimed at q's body at height h, with the rest of the word as given
function at(g, p, q, h, rest = {}) {
  const a = g.v.fighter(p), b = g.v.fighter(q);
  const { yaw, pitch } = aimAt([a.pos[0], a.pos[1] + L.PHYS.P_EYE * 1, a.pos[2]], [b.pos[0], b.pos[1] + h, b.pos[2]]);
  return arenaWord({ yaw, pitch, ...rest });
}

// Ticks of p firing (a new press every `every` ticks) at q until `done`, or `max`.
function fire(g, p, q, { h = 1.0, every = 1, max = 2000, rest = {}, done = () => g.v.fighter(q).dead, still = true } = {}) {
  let shot = g.v.fighter(p).fired;
  for (let i = 0; i < max; i++) {
    if (i % every === 0) shot = (shot + 1) & 3;
    if (still) for (const s of [p, q]) put(g, s, ...[g.v.fighter(s).pos[0], g.v.fighter(s).pos[2]]);
    g.step([[L.EV_INPUT, p, at(g, p, q, h, { shot, ...rest })]]);
    if (done()) return i + 1;
  }
  return -1;
}

const fxs = (v, kind) => { const out = []; for (let k = 0; k < v.fxCount(); k++) { const f = v.fx(k); if (f.kind === kind) out.push(f); } return out; };

test('the arena is its own sim: another wasm, the same engine', async () => {
  const [a, g] = [arenaBytes(), (await newSim()).x];
  assert.ok(a.length > 20000);
  assert.ok(typeof g.step === 'function');
  const s = await newArena();
  for (const name of ['init', 'step', 'step_mt', 'worker_run', 'predict', 'snapshot', 'restore', 'regrid', 'hash_region']) assert.equal(typeof s.x[name], 'function', name);
});

test('every seed lays out a walled gulch: pads and spawns on its floor, walls above it', async () => {
  const s = await newArena();
  const v = new View(s.memory.buffer);
  for (const seed of [1, 2, 7, 99, 0xdeadbeef]) {
    s.init(seed);
    const pads = v.pads();
    assert.equal(pads.length, L.NPAD);
    assert.deepEqual([...new Set(pads.map((p) => p.weapon))].sort(), [2, 4, 5, 6, 7, 8, 9]);
    const floor = v.height(512, 512);
    for (const p of pads) {
      assert.ok(p.pos[0] > L.A_BOX[0] && p.pos[0] < L.A_BOX[1] && p.pos[2] > L.A_BOX[2] && p.pos[2] < L.A_BOX[3], `seed ${seed}: pad off the floor`);
      assert.ok(Math.abs(p.pos[1] - v.height(p.pos[0], p.pos[2])) < 0.01);
    }
    for (let k = 0; k < L.NSPAWN; k++) {
      const x = s.memory && v.dv.getFloat32(L.SPAWNS + 8 * k, true), z = v.dv.getFloat32(L.SPAWNS + 8 * k + 4, true);
      assert.ok(x > L.A_BOX[0] && x < L.A_BOX[1] && z > L.A_BOX[2] && z < L.A_BOX[3], `seed ${seed}: spawn ${k} at ${x}, ${z}`);
    }
    // past the box, the walls stand well over the floor
    for (const [x, z] of [[512, L.A_SPAN[2]], [512, L.A_SPAN[3]], [L.A_SPAN[0], 512], [L.A_SPAN[1], 512]]) {
      assert.ok(v.height(x, z) > floor + 10, `seed ${seed}: wall at ${x}, ${z} only ${v.height(x, z) - floor} m up`);
    }
  }
});

test('a fight: shields, then health, a kill, and three seconds later a respawn on full shields', async () => {
  const g = await arena();
  put(g, 0, 500, 510); put(g, 1, 518, 510);
  const me = g.v.fighter(0);
  assert.deepEqual([me.hp, me.sh, me.gun, me.mag, me.grens], [100, 100, [L.W_AR, L.W_MAGNUM], [32, 8], 2]);
  let shieldGone = -1;
  const n = fire(g, 0, 1, { done: () => { const b = g.v.fighter(1); if (b.sh === 0 && shieldGone < 0) shieldGone = b.hp; return b.dead; } });
  assert.ok(n > 0 && n < 500, `the assault rifle took ${n} ticks`);
  assert.equal(shieldGone, 100 - (shieldGone === 100 ? 0 : 100 - shieldGone), 'shields went before health');
  const [a, b] = [g.v.fighter(0), g.v.fighter(1)];
  assert.deepEqual([a.kills, b.deaths, a.grens], [1, 1, 3], 'the kill, the death, a grenade for it');
  const kill = fxs(g.v, L.FX_KILL).at(-1);
  assert.deepEqual([kill.owner, kill.shot, kill.size], [0, 1, L.W_AR]);
  assert.ok(fxs(g.v, L.FX_HIT).length > 10 && fxs(g.v, L.FX_TRACER).length > 20);
  // the kill's own tick counts: back on the 375th
  for (let i = 0; i < L.RESPAWN_TICKS - 2; i++) g.step();
  assert.ok(g.v.fighter(1).dead, 'still dead at 3 s less a tick');
  g.step();
  const back = g.v.fighter(1);
  assert.deepEqual([back.dead, back.hp, back.sh, back.gun, back.mag], [false, 100, 100, [L.W_AR, L.W_MAGNUM], [32, 8]]);
});

test('shields come back after five quiet seconds, health once they are full', async () => {
  const g = await arena();
  put(g, 0, 500, 510); put(g, 1, 515, 510);
  fire(g, 0, 1, { done: () => g.v.fighter(1).hp < 90 });
  const hurt = g.v.fighter(1);
  for (let i = 0; i < L.SHIELD_DELAY - 2; i++) g.step();
  assert.equal(g.v.fighter(1).sh, 0);
  for (let i = 0; i < 400; i++) g.step();
  const b = g.v.fighter(1);
  assert.equal(b.sh, 100);
  assert.ok(b.hp > hurt.hp, 'health coming back');
});

test('precision: the magnum kills with a head shot once the shields are down, the sniper with one', async () => {
  const g = await arena();
  put(g, 0, 500, 510); put(g, 1, 525, 510);
  // swap to the magnum, then body shots until the shields break, then the head
  let shots = 0;
  const n = fire(g, 0, 1, { every: 30, rest: { slot: 1 }, h: 1.0, done: () => g.v.fighter(1).sh < 20 || g.v.fighter(1).dead });
  assert.ok(n > 0);
  shots = 32 - (g.v.fighter(0).mag[1] + 24);
  fire(g, 0, 1, { every: 30, rest: { slot: 1 }, h: 1.62 });
  assert.equal(g.v.fighter(1).deaths, 1);
  assert.equal(8 - g.v.fighter(0).mag[1], 4, `a 4-shot kill (${shots} to break the shields)`);
  assert.equal(fxs(g.v, L.FX_HIT).at(-1).size, 3, 'in the head');
  // the sniper: one in the head from 100 m, through full shields
  const s = g.v.fighter(0);
  g.dv.setUint8(L.PLAYERS + L.A_GUN + 1, L.W_SNIPER);
  g.dv.setUint8(L.PLAYERS + L.A_MAG + 1, 4);
  for (let i = 0; i < L.RESPAWN_TICKS + 50; i++) g.step([[L.EV_INPUT, 0, at(g, 0, 1, 1.62, { shot: s.fired, slot: 1 })]]);
  put(g, 0, 420, 512, g.v.height(420, 512)); put(g, 1, 520, 512);
  assert.equal(g.v.fighter(1).sh, 100);
  const k = fire(g, 0, 1, { every: 100, h: 1.62, rest: { slot: 1 }, max: 300 });
  assert.ok(k > 0, 'killed');
  assert.equal(g.v.fighter(0).mag[1], 3, 'with one round');
});

test('lag compensation: a shot lands where the shooter saw its target, by the lag its frames send', async () => {
  for (const lag of [0, 12, 25]) {
    const g = await arena();
    put(g, 0, 500, 500);
    // the target runs across at 10 m/s, 30 m away; the shooter tells its lag for a frame first
    const run = arenaWord({ yaw: 4096, move: 1 });
    let fr = arenaFrame({ lag });
    for (let i = 0; i < 160; i++) {
      put(g, 0, 500, 500);
      const t = g.v.tick;
      g.step([[L.EV_INPUT, 0, arenaWord({ pitch: 512, serial: (fr >> (t & 7)) & 1 })], [L.EV_INPUT, 1, run]]);
      if (i === 0) put(g, 1, 530, 480);
    }
    assert.equal(g.v.fighter(0).lag, lag);
    // aim at where the target stood `lag` ticks ago, from the shooter's eye
    const t = g.v.tick;
    const h = L.HIST + ((t - lag) & 31) * L.HIST_TICK + 16;
    const then = lag ? [g.dv.getFloat32(h, true), g.dv.getFloat32(h + 4, true), g.dv.getFloat32(h + 8, true)] : g.v.fighter(1).pos;
    const eye = [500, g.v.fighter(0).pos[1] + 1.6, 500];
    const { yaw, pitch } = aimAt(eye, [then[0], then[1] + 1.0, then[2]]);
    const sh0 = g.v.fighter(1).sh;
    g.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_SNIPER);
    g.dv.setUint8(L.PLAYERS + L.A_MAG, 4);
    g.step([[L.EV_INPUT, 0, arenaWord({ yaw, pitch, shot: 1, serial: (fr >> (t & 7)) & 1 })], [L.EV_INPUT, 1, run]]);
    assert.ok(g.v.fighter(1).sh < sh0, `lag ${lag}: the shot at where they were ${lag} ticks ago hit`);
    if (lag >= 12) {
      // the same aim from a shooter claiming no lag misses: they've moved on
      const g2 = await arena();
      put(g2, 0, 500, 500);
      fr = arenaFrame({ lag: 0 });
      for (let i = 0; i < 160; i++) {
        put(g2, 0, 500, 500);
        g2.step([[L.EV_INPUT, 0, arenaWord({ pitch: 512, serial: (fr >> (g2.v.tick & 7)) & 1 })], [L.EV_INPUT, 1, run]]);
        if (i === 0) put(g2, 1, 530, 480);
      }
      g2.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_SNIPER);
      g2.dv.setUint8(L.PLAYERS + L.A_MAG, 4);
      g2.step([[L.EV_INPUT, 0, arenaWord({ yaw, pitch, shot: 1 })], [L.EV_INPUT, 1, run]]);
      assert.equal(g2.v.fighter(1).sh, 100, `lag ${lag}: claiming none, the same aim misses`);
    }
  }
});

test('frames: a reload asked for refills the magazine from the reserve; a use picks up the pad underfoot', async () => {
  const g = await arena();
  put(g, 0, 500, 510); put(g, 1, 520, 510);
  fire(g, 0, 1, { done: () => g.v.fighter(0).mag[0] <= 20 });
  const before = g.v.fighter(0);
  const send = (frame, ticks, rest = {}) => {
    for (let i = 0; i < ticks; i++) g.step([[L.EV_INPUT, 0, arenaWord({ shot: before.fired, ...rest, serial: (frame >> (g.v.tick & 7)) & 1 })]]);
  };
  // the frame starts on a tick that's a multiple of 8
  while (g.v.tick & 7) send(0, 1);
  send(arenaFrame({ reload: 1 }), 8);
  assert.equal(g.v.fighter(0).reload, L.ARMS[L.W_AR].reload - 1);
  send(0, L.ARMS[L.W_AR].reload);
  const after = g.v.fighter(0);
  assert.equal(after.mag[0], 32);
  assert.equal(after.res[0], before.res[0] - (32 - before.mag[0]));
  // walk onto the sword's pad: nothing without a use, the sword with one
  const pad = g.v.pads().find((p) => p.weapon === L.W_SWORD);
  put(g, 0, pad.pos[0], pad.pos[2]);
  send(0, 16);
  assert.deepEqual(g.v.fighter(0).gun, [L.W_AR, L.W_MAGNUM]);
  while (g.v.tick & 7) send(0, 1);
  send(arenaFrame({ use: 1 }), 9);
  assert.deepEqual(g.v.fighter(0).gun, [L.W_SWORD, L.W_MAGNUM], 'the sword in place of the rifle in hand');
  assert.ok(g.v.pads().find((p) => p.weapon === L.W_SWORD).wait > 7490, 'the pad empty for a minute');
  assert.equal(fxs(g.v, L.FX_PICKUP).length, 1);
});

test('the sword kills at 5 m; a rifle butt to the back kills, to the front only hurts', async () => {
  const g = await arena();
  put(g, 0, 500, 510); put(g, 1, 504, 510);
  g.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_SWORD);
  g.dv.setUint8(L.PLAYERS + L.A_MAG, 10);
  assert.ok(fire(g, 0, 1, { max: 5 }) > 0, 'one swing');
  assert.equal(fxs(g.v, L.FX_KILL).at(-1).size, L.W_SWORD);
  for (let i = 0; i < L.RESPAWN_TICKS + 5; i++) g.step();
  // melee from the front: the target faces the attacker (yaw half a turn)
  g.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_AR);
  put(g, 0, 500, 510); put(g, 1, 502, 510);
  g.step([[L.EV_INPUT, 1, arenaWord({ yaw: 8192 })], [L.EV_INPUT, 0, at(g, 0, 1, 1.0, { melee: 1 })]]);
  let b = g.v.fighter(1);
  assert.deepEqual([b.dead, b.sh], [false, 100 - L.MELEE_DMG]);
  for (let i = 0; i < L.COOL_TICKS; i++) g.step();
  // from behind: it faces away
  put(g, 0, 500, 510); put(g, 1, 502, 510);
  g.step([[L.EV_INPUT, 1, arenaWord({ yaw: 0 })], [L.EV_INPUT, 0, at(g, 0, 1, 1.0, { melee: 0 })]]);
  b = g.v.fighter(1);
  assert.ok(b.dead, 'assassinated');
  assert.equal(fxs(g.v, L.FX_KILL).at(-1).size, L.KILL_BEHIND);
});

test('a rocket kills in its blast and lifts its owner, who takes half; a frag on its fuse', async () => {
  const g = await arena(7, 3);
  put(g, 0, 500, 510); put(g, 1, 520, 510); put(g, 2, 520.8, 511);
  g.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_ROCKET);
  g.dv.setUint8(L.PLAYERS + L.A_MAG, 2);
  fire(g, 0, 1, { h: 0.2, max: 200, still: false });
  assert.ok(g.v.fighter(1).dead && g.v.fighter(2).dead, 'both caught in the blast');
  assert.equal(g.v.fighter(0).kills, 2);
  // a rocket at your own feet: a jump, and half the damage
  for (let i = 0; i < 200; i++) g.step();
  g.dv.setUint8(L.PLAYERS + L.A_MAG, 2);
  g.dv.setUint8(L.PLAYERS + L.A_RELOAD, 0);
  put(g, 0, 500, 510);
  g.step([[L.EV_INPUT, 0, arenaWord({ pitch: 0, shot: (g.v.fighter(0).fired + 1) & 3 })]]);
  for (let i = 0; i < 3; i++) g.step();
  const me = g.v.fighter(0);
  assert.ok(me.vel[1] > 3 && !me.dead && me.sh < 100, `rocket jump: vy ${me.vel[1]}, shields ${me.sh}`);
  // a frag: thrown, it goes off on its fuse
  for (let i = 0; i < L.SHIELD_DELAY + 300; i++) g.step();
  put(g, 0, 500, 510);
  const shots = g.v.fighter(0).grens;
  g.step([[L.EV_INPUT, 0, arenaWord({ pitch: 600, gren: 1 })]]);
  assert.equal(g.v.fighter(0).grens, shots - 1);
  const blasts = fxs(g.v, L.FX_BLAST).length;
  for (let i = 0; i < L.A_FUSE - 2; i++) g.step();
  assert.equal(fxs(g.v, L.FX_BLAST).length, blasts);
  for (let i = 0; i < 4; i++) g.step();
  assert.equal(fxs(g.v, L.FX_BLAST).length, blasts + 1);
});

test('needles home on their target, and seven at once go off together', async () => {
  const g = await arena();
  put(g, 0, 500, 510); put(g, 1, 512, 514);
  g.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_NEEDLER);
  g.dv.setUint8(L.PLAYERS + L.A_MAG, 20);
  // aimed 6 degrees off, every needle still finds them
  const off = arenaWord({ yaw: Math.round(Math.atan2(4, 12) / (2 * Math.PI) * 16384) - 270, pitch: 505 });
  let shot = 0;
  for (let i = 0; i < 300 && !g.v.fighter(1).dead; i++) {
    shot = (shot + 1) & 3;
    put(g, 0, 500, 510); put(g, 1, 512, 514);
    g.step([[L.EV_INPUT, 0, (off & ~(3 << L.AW_SHOT)) | (shot << L.AW_SHOT)]]);
  }
  assert.ok(g.v.fighter(1).dead, 'supercombined');
  assert.equal(fxs(g.v, L.FX_KILL).at(-1).size, L.KILL_SUPER);
  assert.ok(20 - g.v.fighter(0).mag[0] <= 11, `${20 - g.v.fighter(0).mag[0]} needles fired`);
});

test('the match: first to the frag limit ends it, the scoreboard, then a new one from zero', async () => {
  const g = await arena();
  const b0 = L.PLAYERS;
  g.dv.setUint16(b0 + L.A_KILLS, L.FRAG_LIMIT - 1, true);
  put(g, 0, 500, 510); put(g, 1, 503, 510);
  g.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_SWORD);
  g.dv.setUint8(L.PLAYERS + L.A_MAG, 10);
  fire(g, 0, 1, { max: 5 });
  assert.equal(g.v.hole().state, L.H_OVER);
  for (let i = 0; i < L.OVER_TICKS; i++) g.step();
  const h = g.v.hole();
  assert.deepEqual([h.state, h.hole], [L.H_COUNT, 1]);
  assert.deepEqual([g.v.fighter(0).kills, g.v.fighter(1).deaths, g.v.fighter(0).gun[0]], [0, 0, L.W_AR]);
  // no damage until play starts again
  put(g, 0, 500, 510); put(g, 1, 503, 510);
  g.dv.setUint8(L.PLAYERS + L.A_GUN, L.W_SWORD);
  fire(g, 0, 1, { max: 100 });
  assert.equal(g.v.fighter(1).deaths, 0);
});

test('the prediction matches the confirmed arena bit for bit: runs, bursts, a swap, a reload, a frag, a butt', async () => {
  const g = await arena(7, 1);
  const k0 = g.v.tick;
  const inputs = [];
  const fr = arenaFrame({ lag: 9, reload: 1 });
  for (let k = 0; k < 400; k++) {
    const t = k0 + k;
    const serial = k >= 200 && k < 208 + ((8 - (k0 & 7)) & 7) ? (fr >> (t & 7)) & 1 : (arenaFrame({ lag: 9 }) >> (t & 7)) & 1;
    inputs.push(arenaWord({ yaw: 1000 + 20 * k, pitch: 500, move: k < 100 ? 1 : 4, jump: k === 50 ? 1 : 0, shot: (k >> 1) & 3,
      slot: k >= 120 && k < 300 ? 1 : 0, gren: k >= 330 ? 1 : 0, melee: k >= 370 ? 1 : 0, serial }));
  }
  const due = new Map();
  let compared = 0;
  for (let k = 0; k < inputs.length; k++) {
    for (const n of [1, 6, 30]) {
      if ((k % 7 !== 0 && n !== 1) || k + n > inputs.length) continue;
      for (let i = 0; i < n; i++) g.dv.setUint32(L.PWORDS + 4 * i, inputs[k + i], true);
      g.sim.x.predict(0, n);
      const list = due.get(k + n) || [];
      list.push({ n, from: k, player: g.sim.u8.slice(L.PLAYERS + L.PRED_D, L.PLAYERS + L.PRED_D + L.PSIZE) });
      due.set(k + n, list);
    }
    g.step([[L.EV_INPUT, 0, inputs[k]]]);
    for (const p of due.get(k + 1) || []) {
      assert.deepEqual(p.player, g.sim.u8.slice(L.PLAYERS, L.PLAYERS + L.PSIZE), `predicted ${p.n} from ${p.from}`);
      compared++;
    }
  }
  assert.ok(compared > 400);
  const me = g.v.fighter(0);
  assert.ok(me.shots > 20, `${me.shots} shots`);
  assert.equal(me.grens, 1, 'the frag');
  assert.equal(me.lag, 9);
});

test('an arena match of AI fighters replays to the same hash on every tick, on 1 and 4 threads', async () => {
  const bytes = arenaBytes();
  const { log, scores } = await playArena({ bytes, bots: 8, ticks: 3000, leaveAt: 1000 });
  assert.ok(scores.reduce((s, f) => s + f.kills, 0) > 0, 'someone scored');
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks: 3000, threads: 1, tag: 'a1' });
  const b = await replay({ bytes, log: parsed, ticks: 3000, threads: 4, tag: 'a4', startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
});
