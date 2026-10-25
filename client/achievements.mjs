// Fireplace's achievements: what a player has done in the room, kept in this
// browser (localStorage, like the room's theme and the look). Each one is a
// test over a tally of results, and a result is what the confirmed world
// holds while a game's end is on screen (FP_STAGE 1): the game, where this
// slot came (FP_LAST), the marshmallows it got (FP_GOT) and how many were in
// it. So the tests read the same bits on every machine; this page only keeps
// its own slot's. Some open a look (client/looks.mjs `unlock`).
//
// The list is append-only and an id never changes: a browser keeps ids.
import * as L from '../src/layout.mjs';

const ALL4 = (1 << L.G_GOLF) | (1 << L.G_ARENA) | (1 << L.G_BUMPER) | (1 << L.G_PARTY);
const bits = (m) => { let n = 0; for (; m; m &= m - 1) n++; return n; };

// test(t): is it earned on this tally; have(t): how far along, for the list
export const ACHIEVEMENTS = [
  { id: 'chair', name: 'PULL UP A CHAIR', about: 'PLAY A GAME IN THE ROOM', test: (t) => t.games >= 1 },
  { id: 'toasted', name: 'TOASTED', about: 'FINISH IN THE TOP THREE', test: (t) => t.mallows >= 1 },
  { id: 'golden', name: 'GOLDEN BROWN', about: 'WIN A GAME', test: (t) => t.wins >= 1 },
  { id: 'roll', name: 'ON A ROLL', about: 'WIN TWO GAMES IN A ROW', test: (t) => t.best >= 2 },
  { id: 'hattrick', name: 'HAT TRICK', about: 'WIN THREE GAMES IN A ROW', test: (t) => t.best >= 3 },
  { id: 'podium', name: 'EVERY STEP', about: 'FINISH FIRST, SECOND AND THIRD', test: (t) => t.places === 7, have: (t) => [bits(t.places), 3] },
  { id: 'bag', name: 'A BAG OF THEM', about: '25 MARSHMALLOWS IN ALL', test: (t) => t.mallows >= 25, have: (t) => [t.mallows, 25] },
  { id: 'campfire', name: 'CAMPFIRE', about: '100 MARSHMALLOWS IN ALL', test: (t) => t.mallows >= 100, have: (t) => [t.mallows, 100] },
  { id: 'regular', name: 'A REGULAR', about: 'PLAY 25 GAMES', test: (t) => t.games >= 25, have: (t) => [t.games, 25] },
  { id: 'playlist', name: 'THE WHOLE PLAYLIST', about: 'PLAY GOLF, THE ARENA, BUMPER BALLS AND PARTY', test: (t) => (t.played & ALL4) === ALL4, have: (t) => [bits(t.played & ALL4), 4] },
  { id: 'allround', name: 'ALL-ROUNDER', about: 'WIN GOLF, THE ARENA, BUMPER BALLS AND PARTY', test: (t) => (t.won & ALL4) === ALL4, have: (t) => [bits(t.won & ALL4), 4] },
  { id: 'crowd', name: 'A FULL HOUSE', about: 'PLAY A GAME WITH 32 OR MORE IN IT', test: (t) => t.crowd >= 32 },
];
export const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export const emptyTally = () => ({ v: 1, games: 0, mallows: 0, wins: 0, streak: 0, best: 0, played: 0, won: 0, places: 0, crowd: 0, got: {}, last: '' });

// A game's result for one slot, read from the confirmed world while it is
// held: { key, game, place (0: not in it), got, field }. key names the game
// in its room, so a keyframe that shows the same end twice counts it once.
export function readResult(view, slot, room) {
  const dv = view.dv;
  let field = 0;
  for (let p = 0; p < L.NPLAYER; p++) if (view.u8[L.FP_LAST + p]) field++;
  const game = dv.getUint32(L.FP_GAME, true);
  return { key: `${room >>> 0}:${dv.getUint16(L.FP_COUNT + 2, true)}:${game}`, game, place: view.u8[L.FP_LAST + slot], got: view.u8[L.FP_GOT + slot], field };
}

// The tally after one result, and the achievements it opened (in list order).
// A result this tally has already counted, or one this slot wasn't in, changes nothing.
export function record(tally, r, now = Date.now()) {
  const t = { ...tally, got: { ...tally.got } };
  if (!r.place || r.key === t.last) return { tally: tally, opened: [] };
  t.last = r.key;
  t.games++;
  t.mallows += r.got;
  t.played |= 1 << r.game;
  t.crowd = Math.max(t.crowd, r.field);
  if (r.place <= 3) t.places |= 1 << (r.place - 1);
  if (r.place === 1) { t.wins++; t.won |= 1 << r.game; t.streak++; t.best = Math.max(t.best, t.streak); } else t.streak = 0;
  const opened = [];
  for (const a of ACHIEVEMENTS) if (!t.got[a.id] && a.test(t)) { t.got[a.id] = Math.floor(now / 1000); opened.push(a.id); }
  return { tally: t, opened };
}

export const gotSet = (t) => new Set(Object.keys(t.got));

const KEY = 'fireplace.achievements';
export function loadTally() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (t && t.v === 1) return { ...emptyTally(), ...t, got: { ...t.got } };
  } catch { /* none, or not readable */ }
  return emptyTally();
}
export function saveTally(t) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private window: this visit only */ }
}
