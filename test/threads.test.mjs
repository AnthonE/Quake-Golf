import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, parseLog, decodeTrace, newMemory, instantiate, Sim } from '../harness/core.mjs';
import { startWorkers } from '../harness/run-node.mjs';
import { VX, FLAGS, F_AWAKE, JOB_ABORT, BAR_GEN } from '../src/layout.mjs';
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

test('a trap on one thread fails the run instead of hanging it', async () => {
  const bytes = wasmBytes(true);
  const memory = newMemory();
  const sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
  sim.init(log.courseSeed);
  for (let t = 0; t < 300; t++) { sim.feed(log, t); sim.x.step(); }
  const workers = await startWorkers({ bytes, memory, n: 4 });
  // poison every ball, awake, so whichever thread integrates it traps
  const f32 = new Float32Array(memory.buffer);
  for (let i = 0; i < sim.nballs; i++) { f32[(VX >> 2) + i] = NaN; sim.u8[FLAGS + i] |= F_AWAKE; }
  const t0 = performance.now();
  assert.throws(() => { sim.feed(log, 300); sim.x.step_mt(4); }, WebAssembly.RuntimeError);
  Atomics.store(sim.i32, JOB_ABORT >> 2, 1);
  Atomics.notify(sim.i32, BAR_GEN >> 2);
  await assert.rejects(workers.stop(), /thread/);
  assert.ok(performance.now() - t0 < 4000, 'workers took too long to give up');
});

test('replay refuses to run past the end of its log', async () => {
  await assert.rejects(replay({ bytes: wasmBytes(), log, ticks: log.ticks + 1 }), /log has/);
});
