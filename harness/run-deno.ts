// .tools/deno run -R -W [--v8-flags=--liftoff-only] harness/run-deno.ts --log L --ticks N --threads T --out trace.qgh
import { replay, parseLog } from './core.mjs';
import { args, DEFAULTS } from './cli.mjs';

async function startWorkers({ bytes, memory, n }: { bytes: Uint8Array; memory: WebAssembly.Memory; n: number }) {
  const workers: Worker[] = [];
  const ready: Promise<void>[] = [];
  const done: Promise<void>[] = [];
  const errors: string[] = [];
  for (let id = 1; id < n; id++) {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    w.addEventListener('message', (e) => { const d = (e as MessageEvent).data; if (d.error) errors.push(d.error); });
    ready.push(new Promise((res, rej) => {
      w.addEventListener('message', (e) => (e as MessageEvent).data.ready && res());
      w.addEventListener('error', (e) => rej(e));
    }));
    done.push(new Promise((res) => w.addEventListener('message', (e) => (e as MessageEvent).data.done && res())));
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

const a = args(Deno.args, DEFAULTS);
const flags = a.flags || 'default';
const tag = a.tag || `deno ${Deno.version.v8} ${flags} t${a.threads}${a.salt ? ` s${a.salt}` : ''}`;
const { trace, stats } = await replay({
  bytes: await Deno.readFile(a.wasm),
  log: parseLog(await Deno.readFile(a.log)),
  ticks: a.ticks,
  threads: a.threads,
  salt: a.salt,
  tag,
  startWorkers,
  onProgress: (t: number, sim: { nballs: number; awake: number }) =>
    Deno.stderr.writeSync(new TextEncoder().encode(`\r${tag}: ${t} ticks, ${sim.nballs} balls, ${sim.awake} awake   `)),
});
Deno.stderr.writeSync(new TextEncoder().encode('\n'));
if (a.out) await Deno.writeFile(a.out, trace);
console.log(JSON.stringify({ tag, ...stats }));
