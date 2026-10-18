// Sim threads 1..n-1: instantiate on the shared memory, then loop on the barrier
// inside wasm until JOB_QUIT. Works as a Node worker_thread and as a web Worker.
import { instantiate } from './core.mjs';

async function run({ bytes, memory, id, n }, post) {
  const exports = await instantiate(await WebAssembly.compile(bytes), memory);
  post({ ready: id });
  exports.worker_run(id, n);
  post({ done: id });
}

const isNode = typeof process !== 'undefined' && process.versions?.node && !globalThis.Deno;
if (isNode) {
  const { parentPort, workerData } = await import('node:worker_threads');
  run(workerData, (m) => parentPort.postMessage(m));
} else {
  self.onmessage = (e) => run(e.data, (m) => self.postMessage(m));
}
