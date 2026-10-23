import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng, decodePng } from '../tools/png.mjs';
import { compileMap, dataSegment } from '../tools/map.mjs';
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
    spawns: [[492, 510]],
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
  assert.deepEqual([me.pos[0], me.pos[2]], [492, 510], 'on the one spawn point');
  // run east into the block: stopped a body's radius short of it
  for (let i = 0; i < 300; i++) { sim.feedPlayers([[L.EV_INPUT, 0, arenaWord({ yaw: 0, move: 1 })]]); sim.x.step(); }
  assert.ok(Math.abs(v.fighter(0).pos[0] - 499.5) < 1e-3, `at ${v.fighter(0).pos[0]}`);
  // south-west to the teleporter, out at the far corner
  const dv = new DataView(sim.memory.buffer);
  dv.setFloat32(L.PLAYERS + L.P_PX, 492, true); dv.setFloat32(L.PLAYERS + L.P_PZ, 492, true);
  for (let i = 0; i < 60; i++) { sim.feedPlayers([[L.EV_INPUT, 0, arenaWord({ yaw: 10240, move: 1 })]]); sim.x.step(); }
  assert.ok(Math.hypot(v.fighter(0).pos[0] - 530, v.fighter(0).pos[2] - 530) < 6, `at ${v.fighter(0).pos}`);
});
