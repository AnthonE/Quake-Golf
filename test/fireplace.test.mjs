import test from 'node:test';
import assert from 'node:assert/strict';
import { newFireplace, fireplaceBytes, wasmBytes, arenaBytes, bumperBytes } from './helpers.mjs';
import { View } from '../src/view.mjs';
import '../src/arena-view.mjs';
import '../src/bumper-view.mjs';
import { playFireplace } from '../tools/genfireplace.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { prefixed } from '../tools/asm.mjs';
import * as L from '../src/layout.mjs';

const game = (v) => v.dv.getUint32(L.FP_GAME, true);
const u16 = (v, a) => v.dv.getUint16(a, true);

test('the prefixer: every identifier under its prefix, exports made internal, strings left alone', () => {
  const out = prefixed('(module (import "env" "mem" (memory 64 64 shared)) (func $f (export "f") (local $x i32) (call $g)) (func (export "step") (call $f)) (data $d "a$b"))', 'q');
  assert.match(out, /\(func \$q\.f \(local \$q\.x i32\) \(call \$q\.g\)\)/);
  assert.match(out, /\(func \$q\.step \(call \$q\.f\)\)/);
  assert.match(out, /\(data \$q\.d "a\$b"\)/);
  assert.doesNotMatch(out, /export|module|import/);
});

test('Fireplace is one module with every game in it, and the games on their own build as before', async () => {
  const s = await newFireplace();
  for (const name of ['init', 'step', 'step_mt', 'worker_run', 'predict', 'snapshot', 'restore', 'regrid', 'hash_region', 'tick_begin', 'tick_end', 'contacts', 'integrate']) assert.equal(typeof s.x[name], 'function', name);
  assert.ok(fireplaceBytes().length > wasmBytes().length + arenaBytes().length / 2 + bumperBytes().length / 2);
  s.init(7);
  const v = new View(s.memory.buffer);
  assert.equal(game(v), L.PLAYLIST[0]);
  assert.equal(v.hole().state, L.H_IDLE);
  assert.equal(v.dv.getFloat32(L.BH_R0, true), 16, "bumper's world, not golf's");
});

// The playlist on the debug build (a NaN traps), the room coming and going.
let played = null;
async function playlist() {
  if (!played) {
    const states = [];
    played = await playFireplace({ bytes: fireplaceBytes(true), bots: 10, ticks: 64000, leaveAt: 3000, late: 20000, onTick: (t, v) => {
      if (t % 250 === 0) states.push({ t, game: game(v), state: v.hole().state, live: v.hole().live, mallows: [...Array(10)].map((_, p) => u16(v, L.FP_MALLOWS + 2 * p)) });
    } });
    played.states = states;
  }
  return played;
}

test('the room plays the playlist through: bumper balls, the arena, golf, bumper again, everyone moved each time', async () => {
  const { games, states } = await playlist();
  assert.deepEqual(games.map((g) => g.game), [L.G_BUMPER, L.G_ARENA, L.G_GOLF, L.G_BUMPER].slice(0, games.length));
  assert.ok(games.length >= 4, `${games.length} games in 64,000 ticks`);
  const arena = games[1], golf = games[2];
  assert.ok((golf.at - arena.at) < L.B_COUNT + L.FP_ARENA_TICKS + L.FP_HOLD + 200, 'the arena cut to 3 min');
  // straight after each switch, the whole room is in the new game
  for (const g of games.slice(1)) {
    const was = states.findLast((x) => x.t < g.at).live;
    const s = states.find((x) => x.t >= g.at + 250);
    assert.ok(s.live >= was && was >= 7, `${s.live} in ${L.GAMES[g.game]}, ${was} before`);
    assert.equal(s.game, g.game);
  }
});

test('marshmallows: 3, 2 and 1 for the top three of each game, kept from game to game, lost with the slot', async () => {
  const { games, states, mallows } = await playlist();
  const at = (t) => states.findLast((x) => x.t <= t);
  // handed out as the result is held, FP_HOLD ticks before the switch
  const before = at(games[1].at - L.FP_HOLD - 300).mallows, after = at(games[1].at + 10).mallows;
  const got = after.map((m, k) => m - before[k]);
  assert.deepEqual([...got].sort((a, b) => b - a).slice(0, 3), [3, 2, 1], `bumper's: ${got}`);
  assert.equal(got.filter((x) => x > 0).length, 3);
  assert.ok(mallows.reduce((a, b) => a + b, 0) >= 12, 'two games and more handed out');
  // slot 1 left at tick 3000 and came back: what it had then is gone
  assert.equal(at(3100).mallows[1], 0);
});

test('the playlist replays to the same hash on every tick, on 1 and 4 threads', async () => {
  const bytes = fireplaceBytes();
  const { log } = await playFireplace({ bytes, bots: 8, ticks: 36000 });
  const parsed = parseLog(log);
  const a = await replay({ bytes, log: parsed, ticks: 36000, threads: 1, tag: 'f1' });
  const b = await replay({ bytes, log: parsed, ticks: 36000, threads: 4, tag: 'f4', startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
});

test("a keyframe from any game joins a world sitting in another's: the terrain and map rebuilt under it, every tick after equal", async () => {
  const bytes = fireplaceBytes(true);
  const { log, games } = await playFireplace({ bytes: fireplaceBytes(), bots: 6, ticks: 52000 });
  const parsed = parseLog(log);
  const a = await newFireplace(true);
  a.init(7);
  // keyframes at interval boundaries inside the arena, golf, and just after a switch
  const picks = [games[1].at + 3000, games[2].at + 1500, games[1].at + 1].map((t) => Math.ceil(t / L.NSLICE) * L.NSLICE);
  const keys = new Map();
  for (let t = 0; t < 52000; t++) {
    if (picks.includes(t)) keys.set(t, { region: a.regionCopy(), terrain: a.x.terrain_hash(), map: a.u8.slice(L.MAP, L.MAP_END) });
    a.feed(parsed, t);
    a.x.step();
  }
  for (const [t, k] of keys) {
    const b = await newFireplace(true);
    b.init(7);
    b.setRegion(k.region);
    assert.equal(b.x.terrain_hash(), k.terrain, `terrain at ${t}`);
    const v = new View(b.memory.buffer);
    if (game(v) === L.G_ARENA) assert.deepEqual(b.u8.slice(L.MAP, L.MAP_END), k.map, 'the map');
    // and on from there, beside a fresh run of the whole log to compare against
    const c = await newFireplace(true);
    c.init(7);
    for (let s = 0; s < t + 1500; s++) {
      c.feed(parsed, s);
      c.x.step();
      if (s >= t) {
        b.feed(parsed, s);
        b.x.step();
        assert.equal(b.x.hash_region(), c.x.hash_region(), `tick ${s} after a keyframe at ${t}`);
      }
    }
  }
});
