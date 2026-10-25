import test from 'node:test';
import assert from 'node:assert/strict';
import { newFireplace, fireplaceBytes, wasmBytes, arenaBytes, bumperBytes, partyBytes } from './helpers.mjs';
import { View } from '../src/view.mjs';
import { forcedSeed } from '../src/arena-view.mjs';
import '../src/bumper-view.mjs';
import { hash32 } from '../src/party-view.mjs';
import { playFireplace } from '../tools/genfireplace.mjs';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { prefixed } from '../tools/asm.mjs';
import * as L from '../src/layout.mjs';

const game = (v) => v.dv.getUint32(L.FP_GAME, true);
const u16 = (v, a) => v.dv.getUint16(a, true);
const rec = (p, f) => L.PLAYERS + p * L.PSIZE + f;
const FIRE = 0x46495245;
// the playlist through once and back to its first entry
const ROUND = [...L.PLAYLIST, L.PLAYLIST[0]];

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
  assert.ok(fireplaceBytes().length > wasmBytes().length + (arenaBytes().length + bumperBytes().length + partyBytes().length) / 2);
  s.init(7);
  const v = new View(s.memory.buffer);
  assert.equal(game(v), L.PLAYLIST[0]);
  assert.equal(v.hole().state, L.H_IDLE);
  assert.equal(v.dv.getFloat32(L.BH_R0, true), 16, "bumper's world, not golf's");
});

// The playlist on the debug build (a NaN traps), the room coming and going,
// from bumper balls round to bumper balls again: every round's end, and each
// game's result as it was held.
let played = null;
async function playlist() {
  if (!played) {
    const states = [], overs = [], holds = [], starts = [];
    let lastOver = '', lastStage = 0, lastGame = -1;
    played = await playFireplace({ bytes: fireplaceBytes(true), bots: 10, ticks: 300000, leaveAt: 3000, late: 20000,
      until: (games, t) => games.length > L.PLAYLIST.length && t >= games.at(-1).at + 600,
      onTick: (t, v) => {
        const g = game(v), h = v.hole(), n = u16(v, L.FP_COUNT + 2);
        if (t % 250 === 0) states.push({ t, game: g, state: h.state, live: h.live, mallows: [...Array(10)].map((_, p) => u16(v, L.FP_MALLOWS + 2 * p)) });
        if (g !== lastGame) { starts.push({ t, game: g, seed: v.dv.getUint32(L.HDR_SEED, true), live: h.live }); lastGame = g; }
        if (h.state === L.H_PLAY && g === L.G_ARENA && starts.at(-1).mode === undefined) Object.assign(starts.at(-1), { mode: v.dv.getUint32(L.AH_MODE, true), clock: h.until - h.start });
        const key = `${n} ${h.hole}`;
        if (h.state === L.H_OVER && key !== lastOver) { overs.push({ t, game: g, n }); lastOver = key; }
        const stage = v.dv.getUint32(L.FP_STAGE, true);
        if (stage === 1 && lastStage === 0) {
          holds.push({ t, game: g, n, next: v.dv.getUint32(L.FP_NEXT, true), mode: v.dv.getUint32(L.AH_MODE, true),
            players: [...Array(L.NPLAYER)].map((_, p) => ({
              live: (v.u8[rec(p, L.P_FL)] & L.PF_LIVE) !== 0, place: v.u8[L.FP_LAST + p], got: v.u8[L.FP_GOT + p],
              pts: u16(v, rec(p, L.PG_PTS)), wins: u16(v, rec(p, L.B_WINS)), rounds: u16(v, rec(p, L.B_ROUNDS)), modePlace: v.u8[L.MODE_REC + p * L.MR_SIZE + L.MR_PLACE],
            })) });
        }
        lastStage = stage;
      } });
    Object.assign(played, { states, overs, holds, starts });
  }
  return played;
}

test('the room plays the playlist by position: bumper balls, party, the arena, party, golf, bumper again, everyone moved each time', async () => {
  const { games, states, overs, starts } = await playlist();
  assert.deepEqual(games.map((g) => g.game), ROUND, games.map((g) => `${L.GAMES[g.game]} at ${g.at}`).join(', '));
  assert.deepEqual(games.map((g) => g.n), ROUND.map((_, k) => k + 1), 'FP_COUNT counts the games played');
  // each game played its matches (bumper's 2 rounds, party's 3 minigames, one match, one hole), then the next
  for (let k = 0; k < L.PLAYLIST.length; k++) {
    const g = games[k];
    assert.equal(overs.filter((o) => o.n === g.n).length, L.FP_MATCHES[g.game], `${L.GAMES[g.game]}'s matches`);
  }
  const arena = games.findIndex((g) => g.game === L.G_ARENA);
  assert.ok(games[arena + 1].at - games[arena].at <= L.COUNT_TICKS + L.FP_ARENA_TICKS + L.FP_HOLD + 10, 'the arena cut to 3 min');
  assert.equal(starts[arena].clock, L.FP_ARENA_TICKS, `${L.MODES[starts[arena].mode].name}'s clock`);
  // straight after each switch, the whole room is in the new game
  for (const g of games.slice(1)) {
    const was = states.findLast((x) => x.t < g.at).live;
    const s = states.find((x) => x.t >= g.at + 250);
    assert.ok(s.live >= was && was >= 7, `${s.live} in ${L.GAMES[g.game]}, ${was} before`);
    assert.equal(s.game, g.game);
  }
  // a party seed never forces a minigame
  for (const s of starts.filter((x) => x.game === L.G_PARTY)) assert.notEqual(s.seed >>> 24, L.FP_PARTY_FORCE);
});

test("the arena's mode comes from the room's PRNG as the game before it ends, and its seed forces it", async () => {
  const { games, holds, starts } = await playlist();
  const arena = games.findIndex((g) => g.game === L.G_ARENA);
  const before = holds.find((h) => h.n === games[arena].n - 1);
  assert.equal(before.next >>> 24, L.FORCE_MODE, 'drawn as the party before it was held');
  assert.equal(starts[arena].seed, before.next, "the arena's seed");
  assert.equal(starts[arena].mode, (before.next >>> 16) & 0xff, 'and the mode it plays');
});

test('marshmallows: 3, 2 and 1 for the top three of each game, party by its points then wins, kept from game to game, lost with the slot', async () => {
  const { games, states, holds, mallows } = await playlist();
  assert.deepEqual(holds.map((h) => h.game), L.PLAYLIST);
  const better = { [L.G_PARTY]: (a, b) => a.pts > b.pts || (a.pts === b.pts && a.wins > b.wins) };
  for (const h of holds) {
    for (const [p, x] of h.players.entries()) {
      // what each got is what its place earns
      assert.equal(x.got, x.place >= 1 && x.place <= 3 ? 4 - x.place : 0, `${L.GAMES[h.game]}: P${p + 1} came ${x.place}, got ${x.got}`);
      if (h.game === L.G_PARTY) {
        const placed = (y) => y.live && y.rounds > 0;
        const want = placed(x) ? 1 + h.players.filter((y) => placed(y) && better[L.G_PARTY](y, x)).length : 0;
        assert.equal(x.place, Math.min(want, 255), `party: P${p + 1} with ${x.pts} points, ${x.wins} wins`);
      }
      if (h.game === L.G_ARENA && h.mode) assert.equal(x.place, x.live ? x.modePlace : 0, `${L.MODES[h.mode].name}: the place it gave P${p + 1}`);
    }
    const got = h.players.map((x) => x.got).filter((n) => n > 0);
    assert.ok(got.includes(3) && got.length >= 3, `${L.GAMES[h.game]}: ${got}`);
  }
  // handed out as the result is held, FP_HOLD ticks before the switch, and kept
  const at = (t) => states.findLast((x) => x.t <= t);
  const before = at(games[1].at - L.FP_HOLD - 300).mallows, after = at(games[1].at + 10).mallows;
  assert.deepEqual(after.map((m, k) => m - before[k]), holds[0].players.slice(0, 10).map((x) => x.got), "bumper's");
  assert.deepEqual(mallows, mallows.map((_, p) => holds.reduce((n, h) => n + h.players[p].got, 0)), 'every game summed');
  // slot 1 left at tick 3000 and came back: what it had then is gone
  assert.equal(at(3100).mallows[1], 0);
});

// A sim at the end of bumper balls' last round with the playlist's entry k
// next: the result about to be held, the next seed about to be drawn. One
// sim, three in its room, its region put back each time.
let room = null;
async function atTheEnd(k, poke = () => {}) {
  if (!room) {
    const s = await newFireplace(true);
    s.init(7);
    s.feedPlayers([[L.EV_JOIN, 0], [L.EV_JOIN, 1], [L.EV_JOIN, 2]]);
    for (let t = 0; t < 50; t++) { s.feedPlayers([]); s.x.step(); }
    room = { s, v: new View(s.memory.buffer), region: s.regionCopy() };
  }
  const { s, v, region } = room;
  s.setRegion(region);
  const dv = v.dv;
  dv.setUint8(L.FP_COUNT, L.FP_MATCHES[L.G_BUMPER] - 1);
  dv.setUint16(L.FP_COUNT + 2, k, true);
  dv.setUint32(L.HDR_STATE, L.H_OVER, true);
  dv.setUint32(L.HDR_UNTIL, v.tick + 5000, true);
  poke(dv);
  const rng = dv.getUint32(L.HDR_RNG, true);
  s.feedPlayers([]);
  s.x.step();
  const run = (n) => { for (let t = 0; t < n; t++) { s.feedPlayers([]); s.x.step(); } };
  return { s, v, dv, rng, run };
}

test("the arena's mode: one of ARENA_MODES, never the last one played, forced by its seed and cut to 3 min, placed by the mode", async () => {
  const k = L.PLAYLIST.indexOf(L.G_ARENA);
  // 100 draws each way see all seven others (a mirror of $rand: rand % 7 first
  // gives the last residue at draw 47)
  for (let last = 0; last <= L.ARENA_MODES.length; last++) {
    const seen = new Set();
    for (let r = 1; r <= 100; r++) {
      const { dv, rng } = await atTheEnd(k, (dv) => { dv.setUint8(L.FP_MODE, last); dv.setUint32(L.HDR_RNG, r * 0x9e3779b1, true); });
      const next = dv.getUint32(L.FP_NEXT, true);
      assert.equal(dv.getUint32(L.FP_STAGE, true), 1);
      assert.equal(next >>> 24, L.FORCE_MODE);
      assert.equal(next & 0xffff, hash32(rng, k, FIRE) & 0xffff, 'the rest of the seed is the hash of the PRNG and the games played');
      const m = (next >>> 16) & 0xff;
      assert.equal(dv.getUint8(L.FP_MODE), L.ARENA_MODES.indexOf(m) + 1);
      seen.add(m);
    }
    assert.deepEqual([...seen].sort(), L.ARENA_MODES.filter((_, i) => i !== last - 1).sort(), `after ${last ? L.MODES[L.ARENA_MODES[last - 1]].name : 'none'}`);
  }
  // each mode, as the switch hands it to the arena
  for (const m of L.ARENA_MODES) {
    const { v, dv, run } = await atTheEnd(k);
    dv.setUint32(L.FP_NEXT, forcedSeed(m, 99), true);
    run(L.FP_HOLD + 1);
    assert.equal(game(v), L.G_ARENA);
    assert.equal(dv.getUint32(L.HDR_SEED, true), forcedSeed(m, 99));
    assert.equal(dv.getUint32(L.AH_MODE, true), m);
    assert.equal(v.hole().live, 3);
    run(L.COUNT_TICKS + 2);
    const h = v.hole();
    assert.equal(h.state, L.H_PLAY);
    assert.equal(h.until - h.start, Math.min(L.MODE_TICKS[m], L.FP_ARENA_TICKS), `${L.MODES[m].name}'s clock`);
    assert.equal(h.until - h.start, L.FP_ARENA_TICKS);
    // the match ends (a team match through the clock, as the cut ends one: a
    // draw at 0 to 0): placed as its mode places, and the next seed drawn
    dv.setUint32(L.HDR_UNTIL, v.tick + 3, true);
    run(5);
    assert.equal(dv.getUint32(L.FP_STAGE, true), 1);
    assert.equal(dv.getUint32(L.AH_TEAMWIN, true), (1 << m) & L.TEAMED ? 3 : 0, `${L.MODES[m].name}: who won`);
    for (let p = 0; p < 3; p++) assert.equal(v.u8[L.FP_LAST + p], m ? v.u8[L.MODE_REC + p * L.MR_SIZE + L.MR_PLACE] : 1, `${L.MODES[m].name}: P${p + 1}`);
    assert.ok(v.u8[L.MODE_REC + L.MR_PLACE] || !m);
  }
});

test("party's seed keeps its top byte off FP_PARTY_FORCE: its rounds are the rotation's", async () => {
  const k = L.PLAYLIST.indexOf(L.G_PARTY);
  let r = 1;
  while (hash32(r, k, FIRE) >>> 24 !== L.FP_PARTY_FORCE) r++;
  const { v, dv, run } = await atTheEnd(k, (dv) => dv.setUint32(L.HDR_RNG, r, true));
  assert.equal(dv.getUint32(L.FP_NEXT, true), (hash32(r, k, FIRE) ^ 0x01000000) >>> 0);
  run(L.FP_HOLD + 1);
  assert.equal(game(v), L.G_PARTY);
  assert.equal(dv.getUint32(L.PG_FORCE, true), 0);
  assert.equal(v.hole().state, L.H_COUNT, 'one round laid out, everyone in it');
  assert.equal(dv.getUint32(L.BH_N0, true), 3);
  assert.equal(v.hole().live, 3);
});

// One release run of the playlist into golf, shared: replayed on 1 and 4
// threads, and the keyframes taken from it.
let rel = null;
async function released() {
  rel ??= await playFireplace({ bytes: fireplaceBytes(), bots: 8, ticks: 300000, until: (games, t) => games.length >= L.PLAYLIST.length && t >= games.at(-1).at + 3500 });
  return rel;
}

// Through bumper balls and the switch into party's first round (every tick's
// whole region hashed: a 4-thread tick here is 0.45 ms); the matrix replays
// the playlist round on 1, 2 and 4 threads.
test('the playlist replays to the same hash on every tick, on 1 and 4 threads', async () => {
  const bytes = fireplaceBytes();
  const { log, games } = await released();
  assert.deepEqual(games.map((g) => g.game), L.PLAYLIST);
  const parsed = parseLog(log);
  const ticks = games[1].at + L.P_COUNT + 3000;
  const a = await replay({ bytes, log: parsed, ticks, threads: 1, tag: 'f1' });
  const b = await replay({ bytes, log: parsed, ticks, threads: 4, tag: 'f4', startWorkers });
  assert.deepEqual([...decodeTrace(a.trace).tickHashes], [...decodeTrace(b.trace).tickHashes]);
});

test("a keyframe from any game joins a world sitting in another's: the terrain and map rebuilt under it, every tick after equal", async () => {
  const { log, ticks, games } = await released();
  const parsed = parseLog(log);
  const a = await newFireplace(true);
  a.init(7);
  const on = (g) => games.find((x) => x.game === g).at;
  // keyframes at interval boundaries just into party, mid-party, mid-arena and mid-golf
  const picks = [on(L.G_PARTY) + 1, on(L.G_PARTY) + 4000, on(L.G_ARENA) + 3000, on(L.G_GOLF) + 1500].map((t) => Math.ceil(t / L.NSLICE) * L.NSLICE);
  assert.ok(picks.at(-1) + 1500 <= ticks);
  const keys = new Map();
  const after = new Map(); // tick -> the region's hash on a run that never left
  for (let t = 0; t < picks.at(-1) + 1500; t++) {
    if (picks.includes(t)) keys.set(t, { region: a.regionCopy(), terrain: a.x.terrain_hash(), map: a.u8.slice(L.MAP, L.MAP_END), game: game(new View(a.memory.buffer)) });
    a.feed(parsed, t);
    a.x.step();
    if (picks.some((k) => t >= k && t < k + 1500)) after.set(t, a.x.hash_region());
  }
  assert.deepEqual([...keys.values()].map((k) => k.game), [L.G_PARTY, L.G_PARTY, L.G_ARENA, L.G_GOLF]);
  for (const [t, k] of keys) {
    // into a sim sitting in bumper balls' world
    const b = await newFireplace(true);
    b.init(7);
    b.setRegion(k.region);
    assert.equal(b.x.terrain_hash(), k.terrain, `terrain at ${t}`);
    if (k.game === L.G_ARENA) assert.deepEqual(b.u8.slice(L.MAP, L.MAP_END), k.map, 'the map');
    for (let s = t; s < t + 1500; s++) {
      b.feed(parsed, s);
      b.x.step();
      assert.equal(b.x.hash_region(), after.get(s), `tick ${s} after a keyframe at ${t} in ${L.GAMES[k.game]}`);
    }
  }
});
