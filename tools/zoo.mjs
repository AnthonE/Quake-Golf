#!/usr/bin/env node
// The zoo: breeds neural golfers (client/brain.mjs) by mutation and keeps the
// fewest strokes. A training hole is played by shots alone: the golfer is set
// down where its shot is taken from, as the golf bot's private sim does, so a
// hole costs only the ticks its ball flies and rolls. Each generation, a
// parent and its children play the same few courses from a training pool and
// the best child replaces the parent only if it beat it there and again on
// fresh courses (the best of fifteen beats its parent on a few courses by
// luck alone). The genome grows by one 16-bit seed per replacement and stops
// at what fits in a tweet. Held-out courses score it at the end.
//   node tools/zoo.mjs [--gens 200] [--kids 15] [--courses 8] [--confirm 16] [--bases 32] [--workers 4] [--seed 1] [--from qg1:...] [--out logs/zoo]
//   node tools/zoo.mjs --bench [qg1:... ...]   # the test courses: a random net, a rule of thumb, the golf bot, and any genomes given
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { newMemory, instantiate, Sim } from '../harness/core.mjs';
import { View } from '../src/view.mjs';
import { GolfBot, Planner, shotGeometry } from '../client/bot.mjs';
import { Brain, features, encode, decode, MAX_MUTATIONS, NW, TWEET } from '../client/brain.mjs';
import * as L from '../src/layout.mjs';
import { isMain } from './main.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TRAIN = Array.from({ length: 200 }, (_, i) => 1000 + i);
export const TEST = Array.from({ length: 40 }, (_, i) => 1 + i);
const MAX_SHOTS = 10;
const MAX_TICKS = 2500; // ten shots stay inside the 30,000-tick hole clock

// The world at the first tick of play on `seed`, one golfer in slot 0, as a
// buffer Planner.load reads (the region at its own address).
async function startOf(module, seed) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(module, memory), memory);
  sim.init(seed);
  sim.feedPlayers([[L.EV_JOIN, 0]]);
  sim.x.step();
  const view = new View(memory.buffer);
  for (let t = 0; t < 2000 && view.hole().state !== L.H_PLAY; t++) sim.x.step();
  const start = new Uint8Array(L.REGION + L.REGION_SIZE);
  start.set(sim.u8.subarray(L.REGION, L.REGION + L.REGION_SIZE), L.REGION);
  return start;
}

// One hole by shots alone. `choose(view, ball, cup)` gives the shot's
// geometry. The score is the game's: strokes, or strokes and 2 if the ball
// is not in after MAX_SHOTS. `fit`, for selection, adds how far short it is.
export function playHole(planner, start, choose) {
  planner.load(start);
  const view = new View(planner.u8.buffer);
  const cup = view.hole().cup;
  for (let n = 1; n <= MAX_SHOTS; n++) {
    const ball = view.ball(view.player(0).ball).pos;
    const r = planner.try(0, choose(view, ball, cup), cup, MAX_TICKS);
    if (r.sunk) return { score: n, fit: n, sunk: true };
    planner.load(planner.u8);
  }
  const ball = view.ball(view.player(0).ball).pos;
  const left = Math.hypot(cup[0] - ball[0], cup[2] - ball[2]);
  return { score: MAX_SHOTS + 2, fit: MAX_SHOTS + 2 + Math.min(left, 500) / 50, sunk: false };
}

// Shot choosers by name: a genome's feel, a rule of thumb, or the golf bot's 24 tries.
export function chooser(kind, ctx) {
  if (kind === 'rule') {
    return (view, ball, cup) => {
      const d = Math.hypot(cup[0] - ball[0], cup[2] - ball[2]);
      return shotGeometry(view, ball, cup, d > 120 ? 0.5 : d > 40 ? 1.6 : d > 15 ? 3 : 4.4, 0);
    };
  }
  if (kind === 'bot') {
    const bot = new GolfBot(0, ctx.lookahead);
    return (view, ball, cup) => bot.choose(view, ball, cup).shot;
  }
  const brain = new Brain(kind);
  return (view, ball, cup) => {
    const { dh, turn } = brain.decide(features(view, ball, cup));
    return shotGeometry(view, ball, cup, dh, turn);
  };
}

// A worker: one playing sim, one more for the bot's lookahead, and the
// course starts it has built.
async function serve() {
  const module = await WebAssembly.compile(workerData.bytes);
  const planner = await Planner.create(module);
  const lookahead = await Planner.create(module);
  const starts = new Map();
  parentPort.on('message', async ({ id, kinds, courses }) => {
    const out = kinds.map(() => []);
    for (const seed of courses) {
      if (!starts.has(seed)) {
        if (starts.size >= 64) starts.delete(starts.keys().next().value);
        starts.set(seed, await startOf(module, seed));
      }
      kinds.forEach((k, i) => out[i].push(playHole(planner, starts.get(seed), chooser(k, { lookahead }))));
    }
    parentPort.postMessage({ id, out });
  });
}

export class Pool {
  constructor(bytes, n) {
    this.workers = Array.from({ length: n }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { zoo: true, bytes } }));
    this.next = 0;
  }

  // Every kind on every course: out[kind][course] = { score, fit, sunk }.
  async run(kinds, courses) {
    const n = this.workers.length;
    const parts = this.workers.map(() => []);
    kinds.forEach((k, i) => parts[i % n].push(i));
    const res = await Promise.all(parts.map((idx, w) => idx.length ? new Promise((ok) => {
      const id = this.next++;
      const on = (m) => { if (m.id === id) { this.workers[w].off('message', on); ok(m.out); } };
      this.workers[w].on('message', on);
      this.workers[w].postMessage({ id, kinds: idx.map((i) => kinds[i]), courses });
    }) : []));
    const out = new Array(kinds.length);
    parts.forEach((idx, w) => idx.forEach((i, j) => { out[i] = res[w][j]; }));
    return out;
  }

  close() { for (const w of this.workers) w.terminate(); }
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
// A small integer stream for the run's own choices (bases, kids' seeds, batches).
function picks(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; s ^= s >>> 12; return s; };
}

// Selection batches come from the first half of the training pool and
// confirmations from the second, so a child is never confirmed on the
// courses that picked it.
export async function breed({ pool, gens = 200, kids = 15, courses = 8, confirm = 16, bases = 32, seed = 1, from = null, log = () => {} }) {
  const pick = picks(seed);
  const half = TRAIN.length / 2;
  const batch = (g) => Array.from({ length: courses }, (_, j) => TRAIN[(g * courses + j) % half]);
  const check = (g) => Array.from({ length: confirm }, (_, j) => TRAIN[half + (g * confirm + j) % half]);
  let parent;
  if (from) parent = decode(from);
  else {
    // a random search over base seeds first: the start of the climb matters
    const cands = Array.from({ length: bases }, () => ({ base: pick(), muts: [] }));
    const res = await pool.run(cands.map(encode), batch(0));
    const fits = res.map((r) => mean(r.map((x) => x.fit)));
    parent = cands[fits.indexOf(Math.min(...fits))];
    log({ gen: -1, bases, best: Math.min(...fits), genome: encode(parent) });
  }
  for (let g = 0; g < gens && parent.muts.length < MAX_MUTATIONS; g++) {
    const fam = [parent, ...Array.from({ length: kids }, () => ({ base: parent.base, muts: [...parent.muts, pick() & 0xffff] }))];
    const res = await pool.run(fam.map(encode), batch(g + 1));
    const fits = res.map((r) => mean(r.map((x) => x.fit)));
    const scores = res.map((r) => mean(r.map((x) => x.score)));
    let best = 1;
    for (let i = 2; i < fam.length; i++) if (fits[i] < fits[best]) best = i;
    let took = false, again = null;
    if (fits[best] < fits[0]) {
      const r2 = await pool.run([encode(parent), encode(fam[best])], check(g));
      again = r2.map((r) => mean(r.map((x) => x.fit)));
      took = again[1] < again[0];
    }
    if (took) parent = fam[best];
    log({ gen: g, parent: scores[0], child: scores[best], again, took, muts: parent.muts.length, genome: encode(parent) });
  }
  return encode(parent);
}

export async function bench(pool, kinds, courses = TEST) {
  const res = await pool.run(kinds, courses);
  return kinds.map((k, i) => ({
    kind: k, score: mean(res[i].map((x) => x.score)), sunk: res[i].filter((x) => x.sunk).length, holes: courses.length, scores: res[i].map((x) => x.score),
  }));
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

if (!isMainThread && workerData?.zoo) serve();
else if (isMain(import.meta.url)) {
  const bytes = readFileSync(join(ROOT, 'build/game.wasm'));
  const pool = new Pool(bytes, Number(arg('workers', Math.min(4, cpus().length))));
  const t0 = performance.now();
  const secs = () => ((performance.now() - t0) / 1000).toFixed(0);
  if (process.argv.includes('--bench')) {
    const given = process.argv.slice(process.argv.indexOf('--bench') + 1).filter((a) => a.startsWith('qg1:'));
    const rows = await bench(pool, [encode({ base: 1, muts: [] }), 'rule', 'bot', ...given]);
    console.log(`${TEST.length} held-out courses (seeds ${TEST[0]}-${TEST.at(-1)}), shots alone, ${MAX_SHOTS} shots at most (else strokes + 2):`);
    for (const r of rows) {
      const name = r.kind === 'rule' ? 'rule of thumb' : r.kind === 'bot' ? 'golf bot (24 tries a shot)' : `genome ${r.kind.length} chars`;
      console.log(`  ${name.padEnd(28)} mean ${r.score.toFixed(2)}, sunk ${r.sunk}/${r.holes}`);
    }
    console.log(`${secs()} s`);
  } else {
    const out = arg('out', 'logs/zoo');
    mkdirSync(dirname(`${out}.jsonl`), { recursive: true });
    writeFileSync(`${out}.jsonl`, '');
    let last = null;
    const log = async (e) => {
      appendFileSync(`${out}.jsonl`, `${JSON.stringify({ ...e, s: Number(secs()) })}\n`);
      if (e.gen < 0) console.log(`bases: best of ${e.bases} ${e.best.toFixed(2)} (${secs()} s)`);
      else if (e.took || e.gen % 10 === 0) {
        const again = e.again ? `; again ${e.again[0].toFixed(2)} vs ${e.again[1].toFixed(2)}` : '';
        console.log(`gen ${e.gen}: parent ${e.parent.toFixed(2)}, best child ${e.child.toFixed(2)}${again}${e.took ? ', took it' : ''}; ${e.muts} mutations, ${e.genome.length} chars (${secs()} s)`);
      }
      writeFileSync(`${out}.genome`, `${e.genome}\n`);
      last = e.genome;
    };
    const genome = await breed({
      pool, log, gens: Number(arg('gens', 200)), kids: Number(arg('kids', 15)), courses: Number(arg('courses', 8)), confirm: Number(arg('confirm', 16)),
      bases: Number(arg('bases', 32)), seed: Number(arg('seed', 1)), from: arg('from', null),
    });
    const [r] = await bench(pool, [genome]);
    console.log(`held out (${TEST.length} courses): mean ${r.score.toFixed(2)}, sunk ${r.sunk}/${r.holes}; ${NW} weights from ${genome.length} chars (a tweet is ${TWEET})\n${genome}`);
    appendFileSync(`${out}.jsonl`, `${JSON.stringify({ heldOut: r.score, sunk: r.sunk, genome, last, s: Number(secs()) })}\n`);
  }
  pool.close();
}
