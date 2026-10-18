// Thread 0 of the browser harness. Params come from the page URL.
import { replay, parseLog } from '../core.mjs';

const p = new URL(self.location.href).searchParams;
const get = (k, d) => p.get(k) ?? d;

async function startWorkers({ bytes, memory, n }) {
  const workers = [];
  const ready = [];
  const done = [];
  for (let id = 1; id < n; id++) {
    const w = new Worker(new URL('../worker.mjs', import.meta.url), { type: 'module' });
    ready.push(new Promise((res, rej) => { w.addEventListener('message', (e) => e.data.ready && res()); w.onerror = rej; }));
    done.push(new Promise((res) => w.addEventListener('message', (e) => e.data.done && res())));
    w.postMessage({ bytes, memory, id, n });
    workers.push(w);
  }
  await Promise.all(ready);
  return { stop: async () => { await Promise.all(done); workers.forEach((w) => w.terminate()); } };
}

try {
  const fetchBytes = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const threads = Number(get('threads', 1));
  const tag = `chrome ${get('v8', '?')} ${get('flags', 'default')} t${threads}`;
  const { trace, stats } = await replay({
    bytes: await fetchBytes('/' + get('wasm', 'build/game.wasm')),
    log: parseLog(await fetchBytes('/' + get('log', 'logs/short.qgl'))),
    ticks: Number(get('ticks', 20000)),
    threads,
    salt: Number(get('salt', 0)),
    tag,
    startWorkers,
    onProgress: (t, sim) => self.postMessage({ progress: `${tag}: ${t} ticks, ${sim.nballs} balls, ${sim.awake} awake` }),
  });
  const out = get('out', '');
  if (out) await fetch('/out/' + out, { method: 'PUT', body: trace });
  self.postMessage({ result: { tag, ...stats } });
} catch (e) {
  self.postMessage({ error: String(e?.stack || e) });
}
