#!/usr/bin/env node
// Per-phase cost of a confirmed tick at 10,000 balls, single thread, plus
// the 2- and 4-thread step, then the same under a sustained wake storm, then
// M4's pit (tools/genlog.mjs --pit) through each stage of the heap's life.
//   node harness/perf.mjs [--from 16000] [--to 24000] [--wasm build/game.wasm] [--pit-only]
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { newMemory, instantiate, Sim, parseLog } from './core.mjs';
import { startWorkers } from './run-node.mjs';
import { generate, generatePit } from '../tools/genlog.mjs';
import * as L from '../src/layout.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const wasm = argv.includes('--wasm') ? argv[argv.indexOf('--wasm') + 1] : 'build/game.wasm';
const from = opt('from', 16000);
const to = opt('to', 24000);
const logPath = `logs/perf${to}.qgl`;
if (!existsSync(wasm)) execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
if (!existsSync(logPath)) execFileSync(process.execPath, ['tools/genlog.mjs', '--ticks', String(to), '--out', logPath], { stdio: 'inherit' });
const log = parseLog(readFileSync(logPath));
const bytes = readFileSync(wasm);
const module = await WebAssembly.compile(bytes);

async function single(log, from, to) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(module, memory), memory);
  sim.init(log.courseSeed);
  for (let t = 0; t < from; t++) { sim.feed(log, t); sim.x.step(); }
  const sum = { begin: 0, contacts: 0, integrate: 0, end: 0, hash: 0, awake: 0 };
  let worst = { ms: 0, tick: 0, awake: 0 };
  const times = [];
  const now = () => performance.now();
  for (let t = from; t < to; t++) {
    sim.feed(log, t);
    const a = now(); sim.x.tick_begin();
    const b = now(); sim.x.contacts(0, sim.i32[L.JOB_NA >> 2]);
    const c = now(); sim.x.integrate(0, sim.i32[L.JOB_NB >> 2]);
    const d = now(); sim.x.tick_end();
    const e = now(); sim.x.hash_region();
    const f = now();
    sum.begin += b - a; sum.contacts += c - b; sum.integrate += d - c; sum.end += e - d; sum.hash += f - e;
    sum.awake += sim.awake;
    times.push(e - a);
    if (e - a > worst.ms) worst = { ms: e - a, tick: t, awake: sim.awake };
  }
  const n = to - from;
  times.sort((x, y) => x - y);
  const p99 = times[Math.floor(0.99 * n)];
  return { n, balls: sim.nballs, ...Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / n])), worst, p99 };
}

async function threaded(threads, log, from, to) {
  const memory = newMemory();
  const sim = new Sim(await instantiate(module, memory), memory);
  sim.init(log.courseSeed);
  for (let t = 0; t < from; t++) { sim.feed(log, t); sim.x.step(); }
  const workers = await startWorkers({ bytes, memory, n: threads });
  let awake = 0;
  const t0 = performance.now();
  for (let t = from; t < to; t++) { sim.feed(log, t); threads > 1 ? sim.x.step_mt(threads) : sim.x.step(); awake += sim.awake; }
  const ms = (performance.now() - t0) / (to - from);
  Atomics.store(sim.i32, L.JOB_QUIT >> 2, 1);
  sim.x.barrier(threads);
  await workers.stop();
  return { ms, awake: awake / (to - from) };
}

const f = (x) => x.toFixed(3);
if (!argv.includes('--pit-only')) {
  const s = await single(log, from, to);
  const tick = s.begin + s.contacts + s.integrate + s.end;
  console.log(`Node ${process.versions.v8}, ${s.balls} balls, ticks ${from}-${to}, mean ${Math.round(s.awake)} awake`);
  console.log(`  tick_begin (events, players, lists) ${f(s.begin)} ms`);
  console.log(`  contacts (phase A)                ${f(s.contacts)} ms`);
  console.log(`  integrate (phase B)               ${f(s.integrate)} ms`);
  console.log(`  tick_end (wakes, grid, hash slice) ${f(s.end)} ms`);
  console.log(`  confirmed tick, 1 thread          ${f(tick)} ms   (budget 1.5 ms)`);
  console.log(`  p99 tick                          ${f(s.p99)} ms`);
  console.log(`  worst tick                        ${f(s.worst.ms)} ms at tick ${s.worst.tick}, ${s.worst.awake} awake (one sample: may be the OS)`);
  console.log(`  full-region hash (harness only)   ${f(s.hash)} ms`);
  for (const n of [2, 4]) console.log(`  confirmed tick, ${n} threads         ${f((await threaded(n, log, from, to)).ms)} ms`);

  // A sustained storm: a large blast every 8 ticks keeps thousands awake.
  const storm = parseLog(generate({ ticks: 16000, blastEvery: 8, blastR: 16 }));
  for (const n of [1, 2, 4]) {
    const r = await threaded(n, storm, 14000, 16000);
    console.log(`  storm, ${Math.round(r.awake)} awake, ${n} thread${n > 1 ? 's' : ' '}       ${f(r.ms)} ms`);
  }
}

// M4: 10,000 balls heaped in one pit, then a grenade into it. Each stage is
// stepped to from the start, then timed on its own ticks.
const pit = parseLog(generatePit());
const stages = [['filling, 64 balls every 20 ticks', 0, 3200], ['the heap, before the grenade', 4000, 6000],
  ['the grenade, its first 4 s', 6000, 6500], ['settling again', 6500, 9000]];
console.log(`M4 pit (tools/genlog.mjs --pit), ${pit.ticks} ticks:`);
for (const [name, a, b] of stages) {
  const r = await single(pit, a, b);
  const one = r.begin + r.contacts + r.integrate + r.end;
  const mt = [];
  for (const n of [2, 4]) mt.push((await threaded(n, pit, a, b)).ms);
  console.log(`  ${name.padEnd(34)} ${String(Math.round(r.awake)).padStart(5)} awake  1 thread ${f(one)} ms (contacts ${f(r.contacts)}, the rest ${f(one - r.contacts)}), p99 ${f(r.p99)}, worst ${f(r.worst.ms)}; 2 threads ${f(mt[0])}, 4 threads ${f(mt[1])}`);
}
