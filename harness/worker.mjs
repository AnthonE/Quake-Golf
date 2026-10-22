// Sim threads 1..n-1: instantiate on the shared memory, then loop on the barrier
// inside wasm until JOB_QUIT. A trap raises JOB_ABORT so every other thread
// gives up instead of waiting forever. Works as a Node worker_thread and as a
// web Worker (net/team.mjs's helpers, in Chrome and Deno), from bytes or a module.
import { instantiate } from './core.mjs';
import { JOB_ABORT, BAR_GEN } from '../src/layout.mjs';

async function run({ bytes, module, memory, id, n }, post) {
  const exports = await instantiate(module || await WebAssembly.compile(bytes), memory);
  post({ ready: id });
  try {
    exports.worker_run(id, n);
  } catch (e) {
    const i32 = new Int32Array(memory.buffer);
    Atomics.store(i32, JOB_ABORT >> 2, 1);
    Atomics.notify(i32, BAR_GEN >> 2);
    post({ error: `thread ${id}: ${e?.message || e}` });
  } finally {
    post({ done: id });
  }
}

const isNode = typeof process !== 'undefined' && process.versions?.node && !globalThis.Deno;
if (isNode) {
  const { parentPort, workerData } = await import('node:worker_threads');
  run(workerData, (m) => parentPort.postMessage(m));
} else {
  self.onmessage = (e) => run(e.data, (m) => self.postMessage(m));
}
