#!/usr/bin/env node
// node [--liftoff-only | --no-liftoff] harness/run-node.mjs --log L --ticks N --threads T --salt S --out trace.qgh
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { replay, parseLog } from './core.mjs';
import { args, DEFAULTS } from './cli.mjs';

export async function startWorkers({ bytes, memory, n }) {
  const workers = [];
  const ready = [];
  const done = [];
  for (let id = 1; id < n; id++) {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { bytes, memory, id, n } });
    ready.push(new Promise((res, rej) => { w.on('message', (m) => m.ready && res()); w.on('error', rej); }));
    done.push(new Promise((res) => w.on('message', (m) => m.done && res())));
    workers.push(w);
  }
  await Promise.all(ready);
  return { stop: async () => { await Promise.all(done); await Promise.all(workers.map((w) => w.terminate())); } };
}

async function main() {
  const a = args(process.argv.slice(2), DEFAULTS);
  const flags = process.execArgv.filter((f) => f.includes('liftoff')).join(' ') || 'default';
  const tag = a.tag || `node ${process.versions.v8} ${flags} t${a.threads}${a.salt ? ` s${a.salt}` : ''}`;
  const { trace, stats } = await replay({
    bytes: readFileSync(a.wasm),
    log: parseLog(readFileSync(a.log)),
    ticks: a.ticks,
    threads: a.threads,
    salt: a.salt,
    tag,
    startWorkers,
    onProgress: (t, sim) => process.stderr.write(`\r${tag}: ${t} ticks, ${sim.nballs} balls, ${sim.awake} awake   `),
  });
  process.stderr.write('\n');
  if (a.out) {
    mkdirSync(dirname(a.out), { recursive: true });
    writeFileSync(a.out, trace);
  }
  console.log(JSON.stringify({ tag, ...stats }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
