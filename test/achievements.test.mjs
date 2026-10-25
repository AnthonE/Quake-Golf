// Fireplace's achievements (client/achievements.mjs): tests over a tally of
// game results, each result read from the confirmed world while a game's
// end is held, counted once.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/layout.mjs';
import { View } from '../src/view.mjs';
import { ACHIEVEMENTS, emptyTally, record, readResult } from '../client/achievements.mjs';

const inFont = (s) => [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 95);
let n = 0;
const res = (o) => ({ key: `1:${++n}:${o.game ?? L.G_BUMPER}`, game: L.G_BUMPER, place: 5, got: 0, field: 8, ...o });
const play = (results, t = emptyTally()) => {
  const opened = [];
  for (const r of results) { const x = record(t, r, 1e12); t = x.tally; opened.push(...x.opened); }
  return { t, opened };
};

test('ids unique, names and lines in the font and short enough for the TV', () => {
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(inFont(a.name) && a.name.length <= 18, a.name);
    assert.ok(inFont(a.about) && a.about.length <= 46, a.about);
  }
});

test('a first game, a marshmallow, a win, then two and three in a row', () => {
  assert.deepEqual(play([res({})]).opened, ['chair']);
  assert.deepEqual(play([res({ place: 3, got: 1 })]).opened, ['chair', 'toasted']);
  assert.deepEqual(play([res({ place: 1, got: 3 })]).opened, ['chair', 'toasted', 'golden']);
  const { t, opened } = play([res({ place: 1, got: 3 }), res({ place: 1, got: 3 })]);
  assert.ok(opened.includes('roll') && !opened.includes('hattrick'));
  assert.ok(play([res({ place: 1, got: 3 })], t).opened.includes('hattrick'));
  // a loss between them breaks the run; a game this slot sat out does not
  const broke = play([res({ place: 1 }), res({ place: 2 }), res({ place: 1 })]);
  assert.equal(broke.t.best, 1);
  const sat = play([res({ place: 1 }), res({ place: 0 }), res({ place: 1 })]);
  assert.equal(sat.t.best, 2);
});

test('a result is counted once, and one this slot was not in is not counted', () => {
  const r = res({ place: 1, got: 3 });
  const once = play([r, r, { ...r }]);
  assert.equal(once.t.games, 1);
  assert.equal(once.t.mallows, 3);
  assert.equal(play([res({ place: 0, got: 0 })]).t.games, 0);
});

test('the long ones: every game played and won, every step, a full house, 25 and 100 marshmallows, 25 games', () => {
  const four = [L.G_GOLF, L.G_ARENA, L.G_BUMPER, L.G_PARTY];
  let x = play(four.slice(0, 3).map((game) => res({ game, place: 4 })));
  assert.ok(!x.opened.includes('playlist'));
  x = play([res({ game: L.G_PARTY, place: 4 })], x.t);
  assert.deepEqual(x.opened, ['playlist']);
  assert.ok(play(four.map((game) => res({ game, place: 1, got: 3 }))).opened.includes('allround'));
  assert.ok(play([1, 2, 3].map((place) => res({ place }))).opened.includes('podium'));
  assert.ok(!play([1, 2].map((place) => res({ place }))).opened.includes('podium'));
  assert.ok(play([res({ field: 32 })]).opened.includes('crowd'));
  assert.ok(!play([res({ field: 31 })]).opened.includes('crowd'));
  const many = play(Array.from({ length: 34 }, () => res({ place: 1, got: 3 })));
  assert.ok(many.opened.includes('bag') && many.opened.includes('campfire') && many.opened.includes('regular'));
  assert.equal(many.t.mallows, 102);
  const all = ACHIEVEMENTS.map((a) => a.id);
  assert.deepEqual(Object.keys(play([...four.map((game) => res({ game, place: 1, got: 3, field: 40 })), res({ place: 2 }), res({ place: 3 }), ...Array.from({ length: 34 }, () => res({ place: 1, got: 3 }))]).t.got).sort(), [...all].sort());
});

test('a result is read from the world as it is held: the game, the place, the marshmallows, who was in it', () => {
  const buf = new SharedArrayBuffer(L.PAGES * 65536);
  const v = new View(buf);
  v.dv.setUint32(L.FP_GAME, L.G_ARENA, true);
  v.dv.setUint16(L.FP_COUNT + 2, 6, true);
  [[3, 1, 3], [9, 2, 2], [40, 3, 1], [41, 4, 0]].forEach(([p, place, got]) => { v.u8[L.FP_LAST + p] = place; v.u8[L.FP_GOT + p] = got; });
  assert.deepEqual(readResult(v, 9, 123456), { key: '123456:6:1', game: L.G_ARENA, place: 2, got: 2, field: 4 });
  assert.equal(readResult(v, 5, 123456).place, 0);
});
