// Thread 0 of the browser harness. Params come from the page URL.
import { replay, parseLog } from '../core.mjs';

const p = new URL(self.location.href).searchParams;
const get = (k, d) => p.get(k) ?? d;

async function startWorkers({ bytes, memory, n }) {
  const workers = [];
  const ready = [];
  const done = [];
  const errors = [];
  for (let id = 1; id < n; id++) {
    const w = new Worker(new URL('../worker.mjs', import.meta.url), { type: 'module' });
    w.addEventListener('message', (e) => { const d = e.data; if (d.error) errors.push(d.error); });
    ready.push(new Promise((res, rej) => {
      w.addEventListener('message', (e) => e.data.ready && res());
      w.addEventListener('error', (e) => rej(e));
    }));
    done.push(new Promise((res) => w.addEventListener('message', (e) => e.data.done && res())));
    w.postMessage({ bytes, memory, id, n });
    workers.push(w);
  }
  await Promise.all(ready);
  // up to 5 s for the workers to leave their loop, then terminate; report any error
  return {
    stop: async () => {
      await Promise.race([Promise.all(done), new Promise((ok) => setTimeout(ok, 5000))]);
      workers.forEach((w) => w.terminate());
      if (errors.length) throw new Error(errors.join('; '));
    },
  };
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
  if (out) {
    const res = await fetch('/out/' + out, { method: 'PUT', body: trace });
    if (!res.ok) throw new Error(`trace upload failed: HTTP ${res.status}`);
  }
  self.postMessage({ result: { tag, ...stats } });
} catch (e) {
  self.postMessage({ error: String(e?.stack || e) });
}
