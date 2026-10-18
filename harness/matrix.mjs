#!/usr/bin/env node
// Replays one log in every runtime x V8 tier x thread count and compares
// every trace with the first.
//   node harness/matrix.mjs --ticks 100000 [--runtimes node,deno,chromium] [--flags default,liftoff-only,no-liftoff] [--threads 1,2,4]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { decodeTrace } from './core.mjs';
import { compareTraces } from '../tools/compare.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ticks = Number(opt('ticks', 20000));
const runtimes = opt('runtimes', 'node,deno,chromium').split(',');
const tiers = opt('flags', 'default,liftoff-only,no-liftoff').split(',');
const threadCounts = opt('threads', '1,2,4').split(',').map(Number);
const log = opt('log', `logs/m${ticks}.qgl`);
const wasm = opt('wasm', 'build/game.wasm');
const DENO = existsSync('.tools/deno') ? '.tools/deno' : 'deno';

mkdirSync('traces', { recursive: true });
if (!existsSync('build/game.wasm')) execFileSync(process.execPath, ['tools/asm.mjs'], { stdio: 'inherit' });
if (!existsSync(log)) execFileSync(process.execPath, ['tools/genlog.mjs', '--ticks', String(ticks), '--out', log], { stdio: 'inherit' });

function command(rt, tier, n, out) {
  const common = ['--log', log, '--wasm', wasm, '--ticks', String(ticks), '--threads', String(n), '--out', out];
  const v8 = tier === 'default' ? [] : [`--${tier}`];
  if (rt === 'node') return [process.execPath, [...v8, 'harness/run-node.mjs', ...common]];
  if (rt === 'deno') return [DENO, ['run', '-R', '-W', ...(v8.length ? [`--v8-flags=${v8[0]}`] : []), 'harness/run-deno.ts', '--flags', tier, ...common]];
  if (rt === 'chromium') return [process.execPath, ['harness/run-chromium.mjs', '--flags', tier, ...common]];
  throw new Error(`unknown runtime ${rt}`);
}

const results = [];
let ref = null;
let failed = 0;
for (const rt of runtimes) {
  for (const tier of tiers) {
    for (const n of threadCounts) {
      const out = `traces/m-${rt}-${tier}-t${n}-${ticks}.qgh`;
      const [cmd, cargs] = command(rt, tier, n, out);
      const t0 = Date.now();
      const r = spawnSync(cmd, cargs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (r.status !== 0) {
        failed++;
        results.push({ config: `${rt} ${tier} t${n}`, verdict: `RUN FAILED (exit ${r.status})`, secs });
        continue;
      }
      const stats = JSON.parse(r.stdout.trim().split('\n').at(-1));
      const trace = decodeTrace(readFileSync(out));
      let verdict = 'reference';
      if (!ref) ref = trace;
      else {
        const c = compareTraces(ref, trace);
        verdict = c.ok ? 'match' : `MISMATCH: ${c.what}`;
        if (!c.ok) failed++;
      }
      results.push({ config: `${rt} ${tier} t${n}`, verdict, msPerTick: stats.msPerTick.toFixed(3), secs });
      console.log(`${verdict.padEnd(10)} ${rt} ${tier} t${n}: ${stats.msPerTick.toFixed(3)} ms/tick, ${secs} s`);
    }
  }
}
console.log(`\n${results.length} configurations, ${ticks} ticks each, log ${log}`);
console.log(failed ? `${failed} FAILED` : `all ${results.length} agree on every tick`);
process.exit(failed ? 1 : 0);
