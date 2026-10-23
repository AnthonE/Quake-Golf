#!/usr/bin/env node
// AI fighters for an arena room, each its own session through a relay's
// native door (as net/tiny-client.mjs, docs/wire.md): it steps its own copy
// of the world from the closed ticks on the arena's sim, decides a word a
// tick with client/arena-bot.mjs, says how old its view is in its frames
// (so its shots are checked where it saw its targets, as a person's are),
// and reports its interval hashes for the referee to check. Until Ctrl-C,
// or --seconds.
//   node net/arena-bots.mjs [127.0.0.1:4434] [--bots 7] [--seconds 0] [--skill 0.6] [--wasm build/arena/game.wasm]
import net from 'node:net';
import dgram from 'node:dgram';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import * as W from './wire.mjs';
import * as L from '../src/layout.mjs';
import { feedTick } from './inbox.mjs';
import { View } from '../src/arena-view.mjs';
import { Fighter } from '../client/arena-bot.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const at = argv.find((a) => /^[\w.-]+:\d+$/.test(a)) || '127.0.0.1:4434';
const [host, port] = [at.split(':')[0], Number(at.split(':')[1])];
const N = Number(opt('bots', 7));
const seconds = Number(opt('seconds', 0));
const skill = Number(opt('skill', 0.6));
const bytes = readFileSync(opt('wasm', 'build/arena/game.wasm'));
const module = await WebAssembly.compile(bytes);
const prefix = await W.wasmPrefix(bytes);
const LEAD = 12;

async function bot(k) {
  const memory = new WebAssembly.Memory({ initial: L.PAGES, maximum: L.PAGES, shared: true });
  const sim = (await WebAssembly.instantiate(module, { env: { mem: memory } })).exports;
  const u8 = new Uint8Array(memory.buffer), dv = new DataView(memory.buffer), view = new View(memory.buffer);
  const tcp = net.connect({ host, port, noDelay: true });
  await new Promise((ok, no) => { tcp.once('connect', ok); tcp.once('error', no); });
  const sr = W.bufferedReader(Readable.toWeb(tcp).getReader());
  tcp.write(W.encodeHello({ maxDatagram: 1400, wasmPrefix: prefix, nonce: (Math.random() * 2 ** 32) >>> 0 }));
  const w = W.decodeWelcome(await sr.read(32));
  if (!w || w.reject) throw new Error(`bot ${k}: the relay turned us away (reason ${w?.reject}; is it on build/arena/game.wasm?)`);
  sim.init(w.seed);
  const brain = new Fighter(w.slot, (Math.random() * 1e9) | 0, Math.max(0.1, Math.min(1, skill + (Math.random() - 0.5) * 0.4)));
  const t0 = performance.now();
  const serverTick = () => w.serverTick + (performance.now() - t0) / W.TICK_MS;
  const udp = dgram.createSocket('udp4');
  const send = (m) => { const d = new Uint8Array(4 + m.length); new DataView(d.buffer).setUint32(0, w.token, true); d.set(m, 4); udp.send(d, port, host); };
  const store = new Map(), base = new W.TickBase(), recv = new W.Received(), parts = new W.Parts();
  let keys = 0;
  (async () => {
    for (let m; (m = await W.readControl(sr));) {
      if (m.type === W.T_KEY) {
        keys++;
        if (m.raw) { const region = await W.unpackKey(m.packed); u8.set(region, L.REGION); sim.regrid(); base.seed(region); } else { sim.init(w.seed); base.reset(); }
        for (const t of store.keys()) if (t < m.tick) store.delete(t);
      }
      if (m.type === W.T_FILL) for (const t of W.decodeFillBody(m.from, m.n, m.body)) if (recv.add(t.tick) || !store.has(t.tick)) store.set(t.tick, t.parts);
    }
  })().catch(() => {});
  udp.on('message', (buf) => {
    for (const e of W.decodeTicks(buf)?.entries || []) {
      const whole = parts.add(e);
      if (whole && e.tick >= w.roomStart && recv.add(e.tick)) store.set(e.tick, whole);
    }
  });
  const words = new Map();
  let next = w.joinTick, seq = 0, report = null;
  const timer = setInterval(() => {
    while (keys && store.has(w.roomStart + view.tick)) {
      const t = w.roomStart + view.tick;
      const { events, words: changed } = base.apply(store.get(t));
      store.delete(t);
      feedTick(u8, dv, { ev: events, w: changed });
      sim.step();
      if (dv.getInt32(L.INTERVAL_TICK, true) === view.tick) report = { interval: view.tick, epoch: keys & 255, hash: dv.getBigUint64(L.INTERVAL_HASH, true), left: 8 };
    }
    // a word for each tick the server's clock (plus the lead) has passed, from a view that old
    for (; next <= serverTick() + LEAD; next++) words.set(next, keys ? brain.think(view, next - w.roomStart, next - (w.roomStart + view.tick) + 1) : 0);
  }, W.TICK_MS / 2);
  const sender = setInterval(() => {
    const from = Math.max(w.joinTick, next - 16);
    const list = [];
    for (let t = from; t < next; t++) list.push(words.get(t));
    for (const t of words.keys()) if (t < from) words.delete(t); else break;
    const r = report?.left > 0 ? report : null;
    if (r) r.left--;
    send(W.encodeInput({ seq: seq++, firstTick: from, ...recv.ack(), words: list, report: r }));
  }, W.SEND_EVERY * W.TICK_MS);
  return {
    slot: w.slot, view,
    stop() { clearInterval(timer); clearInterval(sender); tcp.end(); udp.close(); },
  };
}

const bots = [];
for (let k = 0; k < N; k++) {
  bots.push(await bot(k));
  await new Promise((ok) => setTimeout(ok, 120));
}
console.log(`${N} fighters in the arena: slots ${bots.map((b) => b.slot).join(' ')}`);
const status = setInterval(() => {
  const v = bots[0]?.view;
  if (!v) return;
  const s = bots.map((b) => { const f = v.fighter(b.slot); return `P${b.slot + 1} ${f.kills}/${f.deaths}`; }).join('  ');
  console.log(`match ${v.hole().hole + 1}: ${s}`);
}, 15000);
const quit = () => { clearInterval(status); for (const b of bots) b.stop(); setTimeout(() => process.exit(0), 100); };
process.on('SIGINT', quit);
if (seconds) setTimeout(quit, seconds * 1000);
