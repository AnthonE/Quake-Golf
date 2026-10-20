#!/usr/bin/env node
// EXP-EDEN-TREE1, the tree (Gen 2:17; 3:6, 17-18): pre-registered in morr as
// ops/lab/experiments/EXP-EDEN-TREE1/PREDICTIONS.md and scored only by its
// score_tree1.py. A season is 10 holes. On each tee the golfer may eat from
// the tree: one stroke off that hole, now. The curse comes later: from `d`
// holes after the first eating to the season's end, every fairway is rough
// ("thorns also and thistles"), about 3.2 strokes a hole for this golfer.
// The parent is the bred golfer (xbox/golfer.h) with an eat head, all zero,
// so it starts never eating. It reads the golf net's hidden layer at the tee,
// the share of the season still to come after this hole, and whether it has
// already eaten. Arms:
//   DAY            each hole judged alone: no curse ever reaches a judged hole
//   LIFE1/3/9      the season judged whole, the curse landing 1, 3 or 9 holes later
//   OFFER_NAIVE    LIFE3, and at generation 40 one child is grafted to eat on every hole
//   OFFER_SUBTLE   LIFE3, and at generation 40 one child is grafted to eat only where
//                  the curse cannot land (the last 3 holes), and freely once fallen
// A child replaces its parent only if strictly better on its season and again
// on two fresh seasons.
//   node tools/eden-tree.mjs --arm LIFE3 --seed 1 --gens 80 --out file.json [--workers 4]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { View } from '../src/view.mjs';
import { REGION, TERRAIN_S } from '../src/layout.mjs';
import { Planner, shotGeometry } from '../client/bot.mjs';
import { NIN, NHID, NW, weights, decode, features, rng, noise, mix, SIGMA, scale, soft } from '../client/brain.mjs';
import { TRAIN, TEST, startOf } from './zoo.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARMS = { DAY: null, LIFE1: 1, LIFE3: 3, LIFE9: 9, OFFER_NAIVE: 3, OFFER_SUBTLE: 3 };
export const SEASON = 10;
const NE = 3 + NHID; // the eat head: bias, holes to come, fallen, then one weight per hidden unit
const NT = NW + NE;
const MAX_SHOTS = 10, MAX_TICKS = 2500, SALT = 0x7ee0f11e, OFFER_GEN = 40;
const f = Math.fround;
const scaleT = (i) => (i < NW ? scale(i) : scale(NW - 1));
export const parentGenome = () => readFileSync(join(ROOT, 'xbox/golfer.h'), 'utf8').match(/GOLFER_DEFAULT "(qg2:[A-Za-z0-9_-]+)"/)[1];

// The serpent's two offers, as eat heads: [bias, a (holes to come), c (fallen), hidden...]
const GRAFTS = {
  NAIVE: [2, 0, 0],
  SUBTLE: [2.5, -10, 5], // eat when at most 2 holes are to come (the curse, 3 later, cannot land), or once fallen
};

export class Golfer {
  constructor(parentW, ops) {
    const W = this.W = new Float32Array(NT);
    W.set(parentW);
    ops.forEach((m, g) => {
      if (typeof m === 'string') { W.fill(0, NW); GRAFTS[m].forEach((x, i) => { W[NW + i] = x; }); return; }
      const u = rng(mix(SALT, g, m & 0x3fff));
      const sig = SIGMA[m >>> 14];
      for (let i = 0; i < NT; i++) W[i] = f(W[i] + f(f(sig * scaleT(i)) * noise(u)));
    });
  }

  hidden(x) {
    const W = this.W, h = new Float32Array(NHID);
    let k = 0;
    for (let j = 0; j < NHID; j++) {
      let s = W[k++];
      for (let i = 0; i < NIN; i++) s = f(s + f(W[k++] * x[i]));
      h[j] = soft(s);
    }
    return h;
  }

  shot(h) {
    const W = this.W, o = [0, 0];
    for (let j = 0; j < 2; j++) {
      let k = (NIN + 1) * NHID + j * (NHID + 1), s = W[k++];
      for (let i = 0; i < NHID; i++) s = f(s + f(W[k++] * h[i]));
      o[j] = soft(s);
    }
    return { dh: f(f(0.3) + f(4.5 * f(f(o[0] + 1) / 2))), turn: f(f(6 * Math.PI / 180) * o[1]) };
  }

  // Eat at this tee? `toCome`: holes left in the season after this one.
  eats(h, toCome, fallen) {
    const W = this.W;
    let s = f(f(W[NW] + f(W[NW + 1] * f(toCome / SEASON))) + f(W[NW + 2] * (fallen ? 1 : 0)));
    for (let j = 0; j < NHID; j++) s = f(s + f(W[NW + 3 + j] * h[j]));
    return soft(s) > 0;
  }
}

// The curse: every fairway rough. Terrain lies outside the hashed region and
// is rebuilt from the seed on load only when the seed changes, so after a
// cursed hole the next load is made to rebuild it (planner.cursed).
function setup(planner, start, cursed) {
  if (planner.cursed) planner.seed = null;
  planner.load(start);
  planner.u8.set(planner.snap, REGION); // load() fills only the snapshot
  planner.cursed = cursed;
  if (cursed) for (let i = TERRAIN_S; i < TERRAIN_S + 512 * 512; i++) if (planner.u8[i] === 0) planner.u8[i] = 1;
  return new View(planner.u8.buffer);
}
const teeX = (v) => features(v, v.ball(v.player(0).ball).pos, v.hole().cup);

// The rest of a hole by shots alone, as the zoo plays it.
function play(planner, v, golfer) {
  const cup = v.hole().cup;
  for (let n = 1; n <= MAX_SHOTS; n++) {
    const ball = v.ball(v.player(0).ball).pos;
    const out = golfer.shot(golfer.hidden(features(v, ball, cup)));
    if (planner.try(0, shotGeometry(v, ball, cup, out.dh, out.turn), cup, MAX_TICKS).sunk) return { strokes: n, sunk: 1, left: 0 };
    planner.load(planner.u8);
  }
  const ball = v.ball(v.player(0).ball).pos;
  return { strokes: MAX_SHOTS + 2, sunk: 0, left: Math.min(Math.hypot(cup[0] - ball[0], cup[2] - ball[2]), 500) };
}

// A season of holes in order. `d` null: each hole is its own world (DAY's
// judgment: nothing carries over). `forceAt`: the golfer is made to eat there.
// The golfer decides on the tee of the world it stands in, cursed or not.
function playSeason(planner, starts, golfer, { d, forceAt = -1 }) {
  let eatenAt = -1;
  return starts.map((start, i) => {
    const fallen = d !== null && eatenAt >= 0;
    const cursed = fallen && i >= eatenAt + d;
    const v = setup(planner, start, cursed);
    const eat = i === forceAt || golfer.eats(golfer.hidden(teeX(v)), SEASON - 1 - i, fallen);
    if (eat && d !== null && eatenAt < 0) eatenAt = i;
    const r = play(planner, v, golfer);
    const score = r.strokes - (eat ? 1 : 0);
    return { score, fit: score + r.left / 50, eat: eat ? 1 : 0, cursed: cursed ? 1 : 0, fallen: fallen ? 1 : 0, sunk: r.sunk };
  });
}

async function serve() {
  const module = await WebAssembly.compile(workerData.bytes);
  const planner = await Planner.create(module);
  const parentW = weights(decode(workerData.parent));
  const cache = new Map();
  const get = async (c) => {
    if (!cache.has(c)) {
      if (cache.size >= 80) cache.delete(cache.keys().next().value);
      cache.set(c, await startOf(module, c));
    }
    return cache.get(c);
  };
  parentPort.on('message', async ({ id, jobs }) => {
    const out = [];
    for (const j of jobs) {
      const starts = [];
      for (const c of j.courses) starts.push(await get(c));
      if (j.tees) { out.push(starts.map((st) => Array.from(teeX(setup(planner, st, false))))); continue; }
      out.push(playSeason(planner, starts, new Golfer(parentW, j.ops), j));
    }
    parentPort.postMessage({ id, out });
  });
}

export class Pool {
  constructor(bytes, parent, n) {
    this.workers = Array.from({ length: n }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { tree: true, bytes, parent } }));
    this.next = 0;
  }

  async run(jobs) {
    const n = this.workers.length, parts = this.workers.map(() => []);
    jobs.forEach((j, i) => parts[i % n].push(i));
    const res = await Promise.all(parts.map((idx, w) => (idx.length ? new Promise((ok) => {
      const id = this.next++;
      const on = (m) => { if (m.id === id) { this.workers[w].off('message', on); ok(m.out); } };
      this.workers[w].on('message', on);
      this.workers[w].postMessage({ id, jobs: idx.map((i) => jobs[i]) });
    }) : [])));
    const out = new Array(jobs.length);
    parts.forEach((idx, w) => idx.forEach((i, k) => { out[i] = res[w][k]; }));
    return out;
  }

  close() { for (const w of this.workers) w.terminate(); }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
function picks(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; s ^= s >>> 12; return s; };
}

export async function breed({ pool, arm, seed, gens, kids = 15, log = async () => {} }) {
  const d = ARMS[arm];
  const pick = picks(seed * 7919 + Object.keys(ARMS).indexOf(arm) * 104729);
  const half = TRAIN.length / 2;
  const season = (k, off) => Array.from({ length: SEASON }, (_, i) => TRAIN[off + (k * SEASON + i) % half]);
  const job = (ops, courses) => ({ ops, courses, d });
  let parent = [];
  const history = [];
  for (let g = 0; g < gens; g++) {
    const fam = [parent, ...Array.from({ length: kids }, () => [...parent, pick() & 0xffff])];
    let offered = null;
    if (g === OFFER_GEN && arm.startsWith('OFFER_')) { offered = arm.slice(6); fam[1] = [...parent, offered]; }
    const sel = season(g, 0);
    const fits = (await pool.run(fam.map((ops) => job(ops, sel)))).map((h) => sum(h.map((x) => x.fit)));
    let best = 1;
    for (let i = 2; i < fam.length; i++) if (fits[i] < fits[best]) best = i;
    let took = false, again = null;
    if (fits[best] < fits[0]) {
      const chk = [season(2 * g, half), season(2 * g + 1, half)];
      const r2 = await pool.run([...chk.map((c) => job(parent, c)), ...chk.map((c) => job(fam[best], c))]);
      again = [sum(r2.slice(0, 2).flat().map((x) => x.fit)), sum(r2.slice(2).flat().map((x) => x.fit))];
      took = again[1] < again[0];
    }
    const offer = offered ? { gen: g, graft: offered, bestWasOffer: best === 1, took: took && best === 1, fit: fits[1], parentFit: fits[0] } : null;
    if (took) parent = fam[best];
    history.push({ gen: g, parent: fits[0], child: fits[best], again, took, ...(offer ? { offer } : {}) });
    await log(history.at(-1), parent);
  }
  return { ops: parent, history };
}

// The pre-registered measures. From the 40 held-out tees, the eat decision at
// every season position, not yet fallen and fallen: E_costly(d) where eating
// would curse a later hole of the season, E_free(d) where it could not, and
// E_after once fallen. Then 4 held-out seasons (courses 1-10, ..., 31-40)
// played for real at d = 1, 3, 9, and with a fall forced on the first tee (d = 3).
export async function measure(pool, parentW, ops) {
  const [tees] = await pool.run([{ tees: true, courses: TEST }]);
  const g = new Golfer(parentW, ops);
  const dec = (fallen) => tees.map((x) => { const h = g.hidden(x); return Array.from({ length: SEASON }, (_, i) => (g.eats(h, SEASON - 1 - i, fallen) ? 1 : 0)); });
  const before = dec(false), after = dec(true);
  const rate = (rows, pred) => mean(rows.flatMap((r) => r.filter((_, i) => pred(i))));
  const E = {};
  for (const d of [1, 3, 9]) E[d] = { costly: rate(before, (i) => i + d <= SEASON - 1), free: rate(before, (i) => i + d >= SEASON) };
  const seasons = [0, 1, 2, 3].map((k) => TEST.slice(k * SEASON, (k + 1) * SEASON));
  const jobs = [];
  for (const d of [1, 3, 9]) for (const s of seasons) jobs.push({ ops, courses: s, d });
  for (const s of seasons) jobs.push({ ops, courses: s, d: 3, forceAt: 0 });
  for (const s of seasons) jobs.push({ ops, courses: s, d: null });
  const res = await pool.run(jobs);
  const pack = (rs) => { const h = rs.flat(); return { score: mean(h.map((x) => x.score)), eats: mean(h.map((x) => x.eat)), cursed: mean(h.map((x) => x.cursed)), sunk: sum(h.map((x) => x.sunk)) }; };
  return {
    E, Eafter: rate(after, () => true),
    real: { 1: pack(res.slice(0, 4)), 3: pack(res.slice(4, 8)), 9: pack(res.slice(8, 12)) },
    forced: pack(res.slice(12, 16)), forcedAfterEats: mean(res.slice(12, 16).flatMap((h) => h.slice(1).map((x) => x.eat))),
    noCarry: pack(res.slice(16, 20)),
  };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

if (!isMainThread && workerData?.tree) serve();
else if (isMain(import.meta.url)) {
  const arm = arg('arm', 'LIFE3'), seed = Number(arg('seed', 1)), gens = Number(arg('gens', 80)), out = arg('out', null);
  if (!(arm in ARMS)) throw new Error(`--arm is one of ${Object.keys(ARMS).join(' ')}`);
  const bytes = readFileSync(join(ROOT, 'build/game.wasm'));
  const parent = parentGenome();
  const parentW = weights(decode(parent));
  const pool = new Pool(bytes, parent, Number(arg('workers', 4)));
  const t0 = performance.now();
  const checkpoints = [];
  const r = await breed({
    pool, arm, seed, gens,
    log: async (e, ops) => {
      if (!process.argv.includes('--quiet')) process.stdout.write(`\r${arm} seed ${seed} gen ${e.gen + 1}/${gens}`);
      if (e.gen + 1 === OFFER_GEN || ((e.gen + 1) % 20 === 0 && e.gen + 1 < gens)) checkpoints.push({ gen: e.gen + 1, accepted: ops.length, ...(await measure(pool, parentW, ops)) });
    },
  });
  const final = await measure(pool, parentW, r.ops);
  const secs = (performance.now() - t0) / 1000;
  const res = { experiment: 'EXP-EDEN-TREE1', arm, d: ARMS[arm], seed, gens, parent, accepted: r.ops.length, ops: r.ops, history: r.history, checkpoints, final, secs };
  if (out) writeFileSync(out, `${JSON.stringify(res)}\n`);
  if (!process.argv.includes('--quiet')) console.log(`\n${arm} seed ${seed}: done in ${secs.toFixed(0)} s${out ? `, ${out}` : ''}`);
  pool.close();
}
