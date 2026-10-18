import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, parseLog, decodeTrace } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { generate } from '../tools/genlog.mjs';
import { compareTraces } from '../tools/compare.mjs';
import { wasmBytes } from './helpers.mjs';

const log = parseLog(generate({ ticks: 1500, target: 1500 }));

async function trace(threads, salt = 0) {
  const { trace } = await replay({ bytes: wasmBytes(), log, ticks: 1500, threads, salt, tag: `t${threads}`, startWorkers });
  return decodeTrace(trace);
}

test('2 and 4 worker threads match one thread on every tick', async () => {
  const one = await trace(1);
  for (const n of [2, 4]) {
    const r = compareTraces(one, await trace(n));
    assert.ok(r.ok, `${n} threads: ${r.what}`);
  }
});

test('the harness splitter matches one thread too', async () => {
  const r = compareTraces(await trace(1), await trace(1, 12345));
  assert.ok(r.ok, r.what);
});
