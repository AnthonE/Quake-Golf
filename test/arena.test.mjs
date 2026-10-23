import test from 'node:test';
import assert from 'node:assert/strict';
import { newArena, arenaBytes, newSim } from './helpers.mjs';
import { View, arenaWord, arenaFrame } from '../src/arena-view.mjs';
import { aimAt } from '../client/bot.mjs';
import { playArena } from '../tools/genarena.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import * as L from '../src/layout.mjs';
import { compileMap } from '../tools/map.mjs';

async function arena(seed = 7, n = 2) {
  const sim = await newArena(true);
  sim.init(seed);
  const v = new View(sim.memory.buffer);
  const dv = new DataView(sim.memory.buffer);
  const step = (recs = []) => { sim.feedPlayers(recs); sim.x.step(); };
  step(Array.from({ length: n }, (_, p) => [L.EV_JOIN, p]));
  while (v.hole().state !== L.H_PLAY) step();
  const g = { sim, v, dv, step };
  // Fiesta deals random guns: these tests start everyone on slayer's rifle and magnum
  for (let p = 0; p < n; p++) loadout(g, p, L.W_AR, L.W_MAGNUM);
  return g;
}

function loadout(g, p, w0, w1) {
  const b = L.PLAYERS + p * L.PSIZE;
  g.dv.setUint8(b + L.A_GUN, w0); g.dv.setUint8(b + L.A_GUN + 1, w1);
  g.dv.setUint8(b + L.A_MAG, L.ARMS[w0].mag); g.dv.setUint8(b + L.A_MAG + 1, L.ARMS[w1].mag);
  g.dv.setUint16(b + L.A_RES, L.ARMS[w0].res, true); g.dv.setUint16(b + L.A_RES + 2, L.ARMS[w1].res, true);
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

test('every seed lays out the map from maps/: its ground, its boxes, spawns clear of them, walls round it, no guns in Fiesta', async () => {
  const s = await newArena();
  const v = new View(s.memory.buffer);
  const want = compileMap();
  for (const seed of [1, 2, 7, 99, 0xdeadbeef]) {
    s.init(seed);
    const m = v.map();
    assert.deepEqual(m.bounds, want.bounds);
    assert.equal(m.boxes.length, want.boxes.length);
    assert.equal(m.groups.length, want.groups.length);
    assert.deepEqual(m.boxes.map((b) => b.box), want.boxes.map((b) => b.box));
    assert.equal(m.teleporters.length, 2);
    // the height image, sample for sample
    const [gx, gz] = want.origin.map((o) => o / L.SPACING);
    const h16 = new Uint16Array(s.memory.buffer, L.TERRAIN_H, L.GRID * L.GRID);
    for (let j = 0; j < want.size[1]; j += 7) for (let i = 0; i < want.size[0]; i += 5) assert.equal(h16[(gz + j) * L.GRID + gx + i], want.heights[j * want.size[0] + i]);
    const pads = v.pads();
    assert.equal(pads.length, L.FIESTA ? 0 : want.pads.length);
    const [x0, x1, z0, z1] = m.bounds;
    assert.equal(m.spawns.length, want.spawns.length);
    let roof = 0;
    for (const [x, y, z] of m.spawns) {
      assert.ok(x >= x0 && x <= x1 && z >= z0 && z <= z1, `seed ${seed}: spawn at ${x}, ${z}`);
      assert.ok(y >= v.height(x, z) - 1e-3, 'not under the ground');
      for (const { box: b } of m.boxes) assert.ok(!(x - 0.5 < b[3] && x + 0.5 > b[0] && y < b[4] && y + 1.8 > b[1] && z - 0.5 < b[5] && z + 0.5 > b[2]), `spawn ${x}, ${y}, ${z} in a box`);
      if (y > v.height(x, z) + 3) roof++;
    }
    assert.equal(roof, 4, 'two spawns on each roof');
    // past the bounds the walls stand well over the floor
    const floor = v.height(512, 512);
    for (const [x, z] of [[512, z0 - 12], [512, z1 + 12], [x0 - 12, 512], [x1 + 12, 512], [100, 100], [1000, 900]]) {
      assert.ok(v.height(x, z) > floor + 10, `seed ${seed}: wall at ${x}, ${z} only ${v.height(x, z) - floor} m up`);
    }
  }
});

// Ticks of slot p's word (the rest of the world idle); its positions after each.
function run(g, p, word, ticks) {
  const path = [];
  for (let i = 0; i < ticks; i++) { g.step([[L.EV_INPUT, p, word]]); path.push(g.v.fighter(p).pos); }
  return path;
}
const WEST = 8192, SOUTH = 12288, EAST = 0; // yaws: -x, -z, +x

test('structures: a wall stops a runner, a door lets one in, a roof stops a rise, stairs climb to the hatch and the roof', async () => {
  const g = await arena(7, 1);
  // the red base: front wall at x 401.2..402, a door at z 510.25..513.75
  put(g, 0, 410, 506);
  let path = run(g, 0, arenaWord({ yaw: WEST, move: 1 }), 200);
  assert.ok(Math.abs(path.at(-1)[0] - 402.5) < 1e-3, `stopped at ${path.at(-1)[0]}`);
  assert.ok(Math.abs(path.at(-1)[2] - 506) < 1e-3);
  put(g, 0, 410, 512);
  path = run(g, 0, arenaWord({ yaw: WEST, move: 1 }), 170);
  const [x, y] = path.at(-1);
  assert.ok(x < 400 && x > 384, `in through the door: ${x}`);
  assert.ok(Math.abs(y - 21) < 0.01, `on the floor: ${y}`);
  // thrown up inside, the head stops at the roof's underside (4 m)
  put(g, 0, 395, 506);
  g.dv.setFloat32(L.PLAYERS + L.P_VY, 25, true);
  path = run(g, 0, arenaWord({}), 100);
  const top = Math.max(...path.map((q) => q[1]));
  assert.ok(Math.abs(top - (21 + 4 - 1.8)) < 1e-3, `the head reached ${top + 1.8}`);
  // the stairs up the +z wall: twelve steps to the hatch, out onto the roof, to the back parapet
  put(g, 0, 400.6, 519.2);
  path = run(g, 0, arenaWord({ yaw: WEST, move: 1 }), 400);
  const end = path.at(-1);
  assert.ok(Math.abs(end[1] - 25.8) < 1e-3, `on the roof: ${end[1]}`);
  assert.ok(Math.abs(end[0] - 383) < 1e-3, `at the parapet: ${end[0]}`);
  for (let k = 1; k < path.length; k++) assert.ok(path[k][1] - path[k - 1][1] <= 0.5 + 1e-4, 'a step at a time');
});

test('the cave: through the ridge under its roof, and over it on top', async () => {
  const g = await arena(7, 1);
  put(g, 0, 484, 574);
  const path = run(g, 0, arenaWord({ yaw: EAST, move: 1 }), 800);
  assert.ok(path.at(-1)[0] > 540, `through: ${path.at(-1)[0]}`);
  for (const [x, y] of path) if (x > 490 && x < 535) assert.ok(y < 21.6, `under the roof at ${x}: ${y}`);
  put(g, 0, 512, 574, 29);
  const on = run(g, 0, arenaWord({ yaw: EAST, move: 1 }), 60);
  assert.ok(on.every((q) => Math.abs(q[1] - 29) < 1e-3), 'walks on the roof');
});

test('a teleporter: the pad behind the red base to the far side of the field, moving as before', async () => {
  const g = await arena(7, 1);
  const { teleporters: [tp] } = g.v.map();
  put(g, 0, tp.from[0], tp.from[2] + 3);
  const before = fxs(g.v, L.FX_TELE).length;
  const path = run(g, 0, arenaWord({ yaw: SOUTH, move: 1 }), 80);
  const k = path.findIndex((q) => Math.hypot(q[0] - tp.to[0], q[2] - tp.to[2]) < 2);
  assert.ok(k > 0, 'came out at the other end');
  assert.equal(fxs(g.v, L.FX_TELE).length, before + 1);
  assert.ok(path.at(-1)[2] < tp.to[2] - 1, 'still running');
});

test('walls stop bullets and blasts', async () => {
  const g = await arena(7, 2);
  // inside the red base, just behind its front wall; outside, a rifle and a rocket
  put(g, 0, 414, 506); put(g, 1, 400.5, 506);
  const n = fire(g, 0, 1, { max: 150, done: () => false });
  assert.equal(n, -1);
  assert.deepEqual([g.v.fighter(1).sh, g.v.fighter(1).hp], [100, 100], 'the rifle never got through');
  const ends = fxs(g.v, L.FX_TRACER).slice(-20);
  assert.ok(ends.length && ends.every((f) => f.pos[0] > 401.9 && f.pos[0] < 402.1), `the tracers end on the wall: ${ends.map((f) => f.pos[0].toFixed(2))}`);
  loadout(g, 0, L.W_ROCKET, L.W_AR);
  for (let i = 0; i < 120; i++) g.step();
  fire(g, 0, 1, { max: 1, done: () => false });
  for (let i = 0; i < 80; i++) g.step();
  const blast = fxs(g.v, L.FX_BLAST).at(-1);
  assert.ok(blast && blast.pos[0] > 401.9 && blast.pos[0] < 402.6, `the rocket went off on the wall at ${blast?.pos}`);
  assert.deepEqual([g.v.fighter(1).sh, g.v.fighter(1).hp], [100, 100], 'the blast stopped at the wall');
  // a frag thrown at the wall bounces back off it
  put(g, 0, 406, 506);
  g.step([[L.EV_INPUT, 0, arenaWord({ yaw: WEST, pitch: 540, gren: 1 })]]);
  for (let i = 0; i < L.A_FUSE + 4; i++) g.step([[L.EV_INPUT, 0, arenaWord({ yaw: WEST, pitch: 540, gren: 1 })]]);
  const frag = fxs(g.v, L.FX_BLAST).at(-1);
  assert.ok(frag !== blast && frag.pos[0] > 402, `the frag went off on this side, at ${frag.pos}`);
  assert.deepEqual([g.v.fighter(1).sh, g.v.fighter(1).hp], [100, 100]);
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
  assert.deepEqual([back.dead, back.hp, back.sh, back.grens], [false, 100, 100, 2]);
  assert.deepEqual(back.mag, back.gun.map((w) => L.ARMS[w].mag), 'two full guns');
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
  send(arenaFrame({ lag: 5, reload: 1 }), 8);
  assert.equal(g.v.fighter(0).lag, 5);
  assert.equal(g.v.fighter(0).reload, L.ARMS[L.W_AR].reload - 1);
  send(0, L.ARMS[L.W_AR].reload);
  const after = g.v.fighter(0);
  assert.equal(after.lag, 5, 'windows with no frame in them keep the lag');
  assert.equal(after.mag[0], 32);
  assert.equal(after.res[0], before.res[0] - (32 - before.mag[0]));
  // walk onto a sword's pad (laid by hand: Fiesta has none): nothing without a use, the sword with one
  g.dv.setFloat32(L.PAD, 520, true); g.dv.setFloat32(L.PAD + 4, g.v.height(520, 530), true); g.dv.setFloat32(L.PAD + 8, 530, true);
  g.dv.setUint8(L.PAD + 12, L.W_SWORD);
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

test('Fiesta: random guns at every spawn; ten minutes, no frag limit, the clock ends it, then a new match from zero', async () => {
  const g = await arena(7, 4);
  // spawns deal two different guns, full, and every gun turns up
  const seen = new Set();
  for (let k = 0; k < 60; k++) {
    for (let p = 0; p < 4; p++) g.dv.setUint8(L.PLAYERS + p * L.PSIZE + L.P_FL, L.PF_LIVE | L.PF_DEAD), g.dv.setUint16(L.PLAYERS + p * L.PSIZE + L.A_RESPAWN, 1, true);
    g.step();
    for (let p = 0; p < 4; p++) {
      const f = g.v.fighter(p);
      assert.ok(!f.dead && f.gun[0] !== f.gun[1] && f.gun.every((w) => w >= 1 && w < L.ARMS.length), `slot ${p}: ${f.gun}`);
      assert.deepEqual(f.mag, f.gun.map((w) => L.ARMS[w].mag));
      f.gun.forEach((w) => seen.add(w));
    }
  }
  assert.equal(seen.size, L.ARMS.length - 1, 'every gun dealt');
  // kills past slayer's limit don't end it
  g.dv.setUint16(L.PLAYERS + L.A_KILLS, L.FRAG_LIMIT + 5, true);
  g.dv.setUint16(L.PLAYERS + L.PSIZE + L.A_KILLS, 3, true);
  for (let i = 0; i < 10; i++) g.step();
  assert.equal(g.v.hole().state, L.H_PLAY);
  const h0 = g.v.hole();
  assert.equal(h0.until - h0.start, L.MATCH_TICKS, 'ten minutes');
  // the clock does: the scoreboard, then a new match
  g.dv.setUint32(L.HDR_UNTIL, g.v.tick + 5, true);
  for (let i = 0; i < 8; i++) g.step();
  assert.equal(g.v.hole().state, L.H_OVER);
  assert.equal(g.v.fighter(0).kills, L.FRAG_LIMIT + 5, 'the scores stand on the scoreboard');
  for (let i = 0; i < L.OVER_TICKS; i++) g.step();
  const h = g.v.hole();
  assert.deepEqual([h.state, h.hole], [L.H_COUNT, 1]);
  assert.deepEqual([g.v.fighter(0).kills, g.v.fighter(1).kills], [0, 0]);
  // no damage until play starts again
  put(g, 0, 500, 510); put(g, 1, 503, 510);
  loadout(g, 0, L.W_SWORD, L.W_AR);
  fire(g, 0, 1, { max: 100 });
  assert.equal(g.v.fighter(1).deaths, 0);
});

// Predicts slot 0 through `inputs` from every tick (1 ahead, and 6 and 30 every
// 7th) and compares each with the confirmed world when it gets there.
function predicted(g, inputs) {
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
  return compared;
}

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
  assert.ok(predicted(g, inputs) > 400);
  const me = g.v.fighter(0);
  assert.ok(me.shots > 20, `${me.shots} shots`);
  assert.equal(me.grens, 1, 'the frag');
  assert.equal(me.lag, 9);
});

test('the prediction matches the confirmed arena through the map: a wall, a door, the stairs, a jump under the roof, a teleporter', async () => {
  const g = await arena(7, 1);
  const word = (yaw, k, jump = 0) => arenaWord({ yaw, pitch: 512, move: 1, jump, serial: (arenaFrame({ lag: 3 }) >> ((g.v.tick + k) & 7)) & 1 });
  put(g, 0, 410, 506);
  assert.ok(predicted(g, Array.from({ length: 160 }, (_, k) => word(k < 80 ? WEST : 6000, k, k === 120 ? 1 : 0))) > 160);
  put(g, 0, 400.6, 519.2);
  assert.ok(predicted(g, Array.from({ length: 260 }, (_, k) => word(WEST, k, k === 30 ? 1 : 0))) > 260);
  assert.ok(Math.abs(g.v.fighter(0).pos[1] - 25.8) < 1e-3, 'up on the roof');
  const { teleporters: [tp] } = g.v.map();
  put(g, 0, tp.from[0], tp.from[2] + 3);
  const tele = fxs(g.v, L.FX_TELE).length;
  assert.ok(predicted(g, Array.from({ length: 90 }, (_, k) => word(SOUTH, k))) > 90);
  assert.equal(fxs(g.v, L.FX_TELE).length, tele + 1, 'through the teleporter');
});

test('an arena match of AI fighters replays to the same hash on every tick, on 1 and 4 threads', async () => {
  const bytes = arenaBytes();
  const { log, scores } = await playArena({ bytes, bots: 8, ticks: 6000, leaveAt: 1000 });
  assert.ok(scores.reduce((s, f) => s + f.kills, 0) > 0, 'someone scored');
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks: 6000, threads: 1, tag: 'a1' });
  const b = await replay({ bytes, log: parsed, ticks: 6000, threads: 4, tag: 'a4', startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
});
