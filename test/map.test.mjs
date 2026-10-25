import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng, decodePng } from '../tools/png.mjs';
import { compileMap, dataSegment, half } from '../tools/map.mjs';
import { expand, assemble } from '../tools/asm.mjs';
import { newMemory, instantiate, Sim } from '../harness/core.mjs';
import { View, arenaWord } from '../src/arena-view.mjs';
import * as L from '../src/layout.mjs';

test('PNGs round-trip: 16-bit grey, 8-bit grey, RGB', () => {
  const grey16 = { width: 5, height: 3, channels: 1, depth: 16, data: Uint16Array.from({ length: 15 }, (_, i) => i * 4000 + 7) };
  const rgb = { width: 4, height: 2, channels: 3, depth: 8, data: Uint8Array.from({ length: 24 }, (_, i) => (i * 37) & 255) };
  const grey8 = { width: 7, height: 1, channels: 1, depth: 8, data: Uint8Array.from([0, 1, 2, 128, 200, 254, 255]) };
  for (const img of [grey16, rgb, grey8]) {
    const back = decodePng(encodePng(img));
    assert.deepEqual([back.width, back.height, back.channels, back.depth], [img.width, img.height, img.channels, img.depth]);
    assert.deepEqual([...back.data], [...img.data]);
  }
});

test('Blood Gulch compiles: two bases, one the other turned about, a cave, teleporters, spawns', () => {
  const m = compileMap();
  assert.equal(m.name, 'Blood Gulch');
  const [red, blue] = m.groups;
  assert.equal(red.count, blue.count);
  // turned half round about x = 512: the same boxes mirrored
  for (let k = 0; k < red.count; k++) {
    const a = m.boxes[red.first + k].box, b = m.boxes[blue.first + k].box;
    assert.deepEqual([1024 - a[3], a[1], 1024 - a[5], 1024 - a[0], a[4], 1024 - a[2]].map((v) => +v.toFixed(3)), b.map((v) => +v.toFixed(3)));
  }
  assert.equal(m.teleporters.length, 2);
  assert.ok(m.spawns.length >= 16 && m.pads.length === 12);
  assert.match(dataSegment(new Uint8Array([0x28, 0x21, 0x41, 0x40, 0x22, 0x3b])), /^\(data \$map "\\28\\21A\\40\\22\\3b"\)$/, 'nothing the assembler would read');
});

// Where feet at (x, z) stand on map m in sim memory v: the ground, or the
// highest box top under the body no higher than `top` (the sim's $stand).
function stand(v, m, x, z, top) {
  let floor = v.height(x, z);
  for (const { box: b } of m.boxes) if (x - 0.5 < b[3] && x + 0.5 > b[0] && z - 0.5 < b[5] && z + 0.5 > b[2] && b[4] <= top) floor = Math.max(floor, b[4]);
  return floor;
}

test('Blood Gulch\'s objectives: a flag on each base\'s floor, the skull mid-field, six hills by turns either side, each standing where it should', async () => {
  const m = compileMap();
  const G = -1000;
  assert.deepEqual(m.flags, [[392, 512, G], [632, 512, G]]);
  assert.deepEqual(m.ball, [512, 512, G]);
  assert.deepEqual(m.hills, [[512, 512, G, 8], [392, 512, 26.3, 6], [568.5, 570.5, 24, 4], [512, 574, 23, 4], [632, 512, 26.3, 6], [454.5, 453.5, 24, 4]]);
  // the sim's copy, as init lays it out
  const bytes = await assemble(expand('src/game.wat', { ARENA: true, map: m }));
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(7);
  const v = new View(sim.memory.buffer);
  const f = (a) => v.dv.getFloat32(a, true);
  const quad = (a) => [f(a), f(a + 4), f(a + 8), f(a + 12)];
  assert.equal(v.dv.getUint32(L.MAP_NHILL, true), 6);
  assert.deepEqual([quad(L.MAP_FLAGS), quad(L.MAP_FLAGS + 16), quad(L.MAP_BALL)], [[392, 512, G, 0], [632, 512, G, 0], [512, 512, G, 0]]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((k) => quad(L.MAP_HILLS + 16 * k)), m.hills.map((h) => h.map(Math.fround)));
  assert.ok(sim.u8.slice(L.MAP_HILLS + 16 * 6, L.MAP_END).every((b) => b === 0));
  // where each stands: the rooms' floors (not their roofs), the field, the roofs, the rocks' tops, the cave's floor (not the ridge)
  const at = ([x, z, top]) => +stand(v, v.map(), x, z, top).toFixed(2);
  assert.deepEqual(m.flags.map(at), [21, 21]);
  assert.equal(at(m.ball), 19.69);
  assert.deepEqual(m.hills.map(at), [19.69, 25.8, 23.4, 21, 25.8, 23.4]);
  // each half's spawns: the bases' own (0-7 red's, 8-15 blue's), the field's split by the nearer flag, ties blue's
  const halves = m.spawns.map((s) => half(s.x, s.z, m.flags));
  assert.deepEqual(halves.slice(0, 16), [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(m.sides, [14, 18]);
  assert.equal(m.spawns.filter((s) => Math.abs(s.x - 392) === Math.abs(s.x - 632)).length, 2, 'two on the middle line');
});

// A map directory of its own: a flat 64 x 64 m floor, 8-bit, and what's given.
function tinyMap(spec = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qg-map-'));
  const W = 32, H = 32;
  writeFileSync(join(dir, 'height.png'), encodePng({ width: W, height: H, channels: 1, depth: 8, data: new Uint8Array(W * H).fill(40) }));
  writeFileSync(join(dir, 'map.json'), JSON.stringify({
    name: 'Tiny', bounds: [484, 540, 484, 540],
    terrain: { origin: [480, 480], height: 'height.png', scale: 0.5, base: 0 },
    structures: [{ name: 'block', boxes: [[500, 20, 500, 504, 23, 520, 'red']] }],
    teleporters: [{ from: [490, 20, 490], to: [530, 20.5, 530] }],
    spawns: [[492, 510], [532, 510]],
    ...spec,
  }));
  return dir;
}

test('a bad map says what is wrong with it', () => {
  const cases = [
    [{ structures: [{ name: 'oops', boxes: [[5, 0, 5, 4, 1, 6]] }] }, /inside out/],
    [{ spawns: [[100, 100]] }, /spawn 0 at 100, 100 is out of bounds/],
    [{ spawns: [] }, /spawn points/],
    [{ structures: [{ name: 'x', boxes: [[0, 0, 0, 1, 1, 1, 'gold']] }] }, /no material "gold"/],
    [{ pads: [{ weapon: 'bfg', at: [500, 500] }] }, /no weapon "bfg"/],
    [{ terrain: { origin: [481, 480], height: 'height.png' } }, /multiples of 2/],
    [{ flags: [{ team: 'red', at: [490, 512] }] }, /flags: exactly two/],
    [{ flags: [{ team: 'red', at: [490, 512] }, { team: 'red', at: [530, 512] }] }, /no blue flag/],
    [{ flags: [{ team: 'red', at: [490, 512] }, { team: 'blue', at: [560, 512] }] }, /blue's flag at 560, 512 is out of bounds/],
    [{ ball: { at: [600, 500] } }, /the ball at 600, 500 is out of bounds/],
    [{ hills: [] }, /0 hills: 1 to 8/],
    [{ hills: Array.from({ length: 9 }, () => ({ at: [512, 512], radius: 4 })) }, /9 hills: 1 to 8/],
    [{ hills: [{ at: [512, 512], radius: 0 }] }, /hill 0: a radius over 0/],
    [{ hills: [{ at: [512, 512], radius: 31 }] }, /hill 0: a radius over 0, at most 30/],
    [{ hills: [{ at: [512], radius: 4 }] }, /hill 0: "at" is/],
    [{ spawns: [[492, 510], [500, 530]] }, /no spawn on blue's half/],
    [{ flags: [{ team: 'red', at: [530, 500] }, { team: 'blue', at: [490, 500] }], spawns: [[536, 510]] }, /no spawn on blue's half/],
  ];
  for (const [spec, err] of cases) {
    const dir = tinyMap(spec);
    try { assert.throws(() => compileMap(dir), err); } finally { rmSync(dir, { recursive: true }); }
  }
});

test('a map of your own builds into the arena and plays: its ground, its box, its teleporter', async () => {
  const dir = tinyMap();
  let sim;
  try {
    const map = compileMap(dir);
    const bytes = await assemble(expand('src/game.wat', { ARENA: true, map }));
    const memory = newMemory();
    sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  } finally { rmSync(dir, { recursive: true }); }
  sim.init(3);
  const v = new View(sim.memory.buffer);
  assert.equal(v.height(500, 530), 20, 'the image: level 40 at half a metre a level');
  assert.ok(v.height(400, 400) > 30, 'mountains past it');
  assert.deepEqual(v.map().boxes.map((b) => [b.box, b.material]), [[[500, 20, 500, 504, 23, 520], 3]]);
  sim.feedPlayers([[L.EV_JOIN, 0]]);
  sim.x.step();
  while (v.hole().state !== L.H_PLAY) sim.x.step();
  const me = v.fighter(0);
  assert.ok([[492, 510], [532, 510]].some(([x, z]) => me.pos[0] === x && me.pos[2] === z), 'on one of its spawn points');
  // run east into the block: stopped a body's radius short of it
  const dv = new DataView(sim.memory.buffer);
  dv.setFloat32(L.PLAYERS + L.P_PX, 492, true); dv.setFloat32(L.PLAYERS + L.P_PZ, 510, true);
  for (let i = 0; i < 300; i++) { sim.feedPlayers([[L.EV_INPUT, 0, arenaWord({ yaw: 0, move: 1 })]]); sim.x.step(); }
  assert.ok(Math.abs(v.fighter(0).pos[0] - 499.5) < 1e-3, `at ${v.fighter(0).pos[0]}`);
  // south-west to the teleporter, out at the far corner
  dv.setFloat32(L.PLAYERS + L.P_PX, 492, true); dv.setFloat32(L.PLAYERS + L.P_PZ, 492, true);
  for (let i = 0; i < 60; i++) { sim.feedPlayers([[L.EV_INPUT, 0, arenaWord({ yaw: 10240, move: 1 })]]); sim.x.step(); }
  assert.ok(Math.hypot(v.fighter(0).pos[0] - 530, v.fighter(0).pos[2] - 530) < 6, `at ${v.fighter(0).pos}`);
});

test('a map that leaves its objectives out gets them: flags an eighth in from the ends of its longer side, the skull and a hill in the middle, a hill halfway to each flag', () => {
  const cases = [
    [{}, [[491, 512, -1000], [533, 512, -1000]], [[512, 512, -1000, 5.6], [501.5, 512, -1000, 5.6], [522.5, 512, -1000, 5.6]]],
    [{ bounds: [500, 524, 440, 584], spawns: [[512, 450], [512, 580]], teleporters: [] }, [[512, 458, -1000], [512, 566, -1000]], [[512, 512, -1000, 3], [512, 485, -1000, 3], [512, 539, -1000, 3]]],
  ];
  for (const [spec, flags, hills] of cases) {
    const dir = tinyMap(spec);
    try {
      const m = compileMap(dir);
      assert.deepEqual([m.flags, m.hills, m.sides], [flags, hills, [1, 1]]);
      assert.deepEqual(m.ball, [512, 512, -1000]);
      // the bytes: MAP_OBJ's block, the segment's last part
      const obj = new DataView(m.bytes.buffer, m.consts.MAPSEG_OBJ, L.MAP_OBJ_SIZE);
      assert.equal(m.consts.MAPSEG_OBJ + L.MAP_OBJ_SIZE, m.bytes.length);
      assert.equal(obj.getUint32(L.MAP_NHILL - L.MAP_OBJ, true), 3);
      const at = (a, k, i) => obj.getFloat32(a - L.MAP_OBJ + 16 * k + 4 * i, true);
      assert.deepEqual([0, 1].map((k) => [0, 1, 2].map((i) => at(L.MAP_FLAGS, k, i))), flags);
      assert.deepEqual([0, 1, 2].map((k) => [0, 1, 2, 3].map((i) => at(L.MAP_HILLS, k, i))), hills.map((h) => h.map(Math.fround)));
    } finally { rmSync(dir, { recursive: true }); }
  }
  // the halves as the sim reckons them, in f32: strictly nearer red's flag is red's, a tie blue's
  const fl = [[491, 512], [533, 512]];
  assert.deepEqual([half(511.9, 0, fl), half(512, 0, fl), half(512.1, 900, fl), half(400, 512, fl), half(600, 512, fl)], [0, 1, 1, 0, 1]);
});
