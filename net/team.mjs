// A sim's helper threads, for the referee and the client's sim worker: n - 1
// web Workers (harness/worker.mjs) on the sim's shared memory, each waiting
// in worker_run for its share of the next tick split across threads. A tick
// with many balls awake is split (step_mt); a quiet one steps on its own
// thread, which costs less than the barriers, and the helpers just wait on.
// Any split gives the same bits, so neither choice changes the world.
import { JOB_NA } from '../src/layout.mjs';

export const MT_MIN = 1024; // awake balls, the tick before, from which a tick is split

// n threads in all, this one included: null for one. module or bytes.
export async function startTeam({ module, bytes, memory, n }) {
  if (!(n > 1)) return null;
  const ready = [];
  for (let id = 1; id < n; id++) {
    const w = new Worker(new URL('../harness/worker.mjs', import.meta.url).href, { type: 'module' });
    ready.push(new Promise((ok, no) => {
      w.onmessage = (e) => { if (e.data.ready) ok(); if (e.data.error) console.error(e.data.error); };
      w.onerror = (e) => no(e.error || new Error(e.message));
    }));
    w.postMessage(module ? { module, memory, id, n } : { bytes, memory, id, n });
  }
  await Promise.all(ready);
  return { n };
}

// One tick: split across the team when the last one had many awake.
export function stepTeam(x, i32, team) {
  if (team && Atomics.load(i32, JOB_NA >> 2) >= MT_MIN) {
    if (x.step_mt(team.n)) throw new Error('a sim thread failed');
  } else {
    x.step();
  }
}
