#!/usr/bin/env node
// The smallest whole client, to read beside docs/wire.md: it joins a room
// through a relay's native door (a TCP connection for the stream, UDP for the
// datagrams), steps its own copy of the world from the closed ticks with
// game.wasm, plays the simplest golf there is (walk behind the ball, blast
// it at the cup), and reports its world's interval hashes, which the relay's
// referee checks against its own. Everything a real client adds is left out:
// steering the input lead, pings, prediction, drawing.
//   node net/tiny-client.mjs [127.0.0.1:4434] [--seconds 30]
// It prints a JSON summary when it leaves.
import net from 'node:net';
import dgram from 'node:dgram';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import * as W from './wire.mjs';
import * as L from '../src/layout.mjs';
import { feedTick } from './inbox.mjs';
import { View } from '../src/view.mjs';
import { aimAt } from '../client/bot.mjs';

const at = process.argv.find((a) => /^[\w.-]+:\d+$/.test(a)) || '127.0.0.1:4434';
const [host, port] = [at.split(':')[0], Number(at.split(':')[1])];
const seconds = Number(process.argv[process.argv.indexOf('--seconds') + 1] || 30);
const LEAD = 12; // ticks our words run ahead of the server's clock: a one-way trip and a margin

// The world: game.wasm on a memory of its own, read through View.
const bytes = readFileSync('build/game.wasm');
const memory = new WebAssembly.Memory({ initial: L.PAGES, maximum: L.PAGES, shared: true });
const sim = (await WebAssembly.instantiate(await WebAssembly.compile(bytes), { env: { mem: memory } })).exports;
const u8 = new Uint8Array(memory.buffer), dv = new DataView(memory.buffer), view = new View(memory.buffer);

// The handshake: a hello on the stream, a welcome (or a reject) back.
const tcp = net.connect({ host, port, noDelay: true });
await new Promise((ok, no) => { tcp.once('connect', ok); tcp.once('error', no); });
const sr = W.bufferedReader(Readable.toWeb(tcp).getReader());
tcp.write(W.encodeHello({ maxDatagram: 1400, wasmPrefix: await W.wasmPrefix(bytes) }));
const w = W.decodeWelcome(await sr.read(32));
if (!w || w.reject) throw new Error(`the relay turned us away (reason ${w?.reject})`);
sim.init(w.seed);
const t0 = performance.now();
const serverTick = () => w.serverTick + (performance.now() - t0) / W.TICK_MS;
// Our datagrams go to the same port, each opening with the welcome's token.
const udp = dgram.createSocket('udp4');
const send = (m) => { const d = new Uint8Array(4 + m.length); new DataView(d.buffer).setUint32(0, w.token, true); d.set(m, 4); udp.send(d, port, host); };

// Closed ticks come in three ways: a keyframe and the fill after it on the
// stream, then bundles (and repairs of what our acks lack) as datagrams.
const store = new Map(); // server tick -> its parts, until stepped
const base = new W.TickBase(); // the words the next tick is coded against
const recv = new W.Received(), parts = new W.Parts();
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
  const d = W.decodeTicks(buf);
  for (const e of d?.entries || []) {
    const whole = parts.add(e);
    if (whole && e.tick >= w.roomStart && recv.add(e.tick)) store.set(e.tick, whole);
  }
});

// The golf: walk to a spot behind the ball on the line from the cup, look at
// the ground a metre behind the ball, fire. (The real bots plan their shots.)
let shots = 0, lastShot = -1e9;
function play(t) {
  const me = view.player(w.slot), h = view.hole();
  if (!keys || !me.live || me.ball < 0 || me.done || h.state !== L.H_PLAY) return W.packInput({ pitch: 512, shot: shots });
  const ball = view.ball(me.ball);
  const a = Math.atan2(h.cup[2] - ball.pos[2], h.cup[0] - ball.pos[0]);
  const blast = [ball.pos[0] - Math.cos(a), ball.pos[1], ball.pos[2] - Math.sin(a)];
  const stand = [blast[0] - 1.5 * Math.cos(a), me.pos[1], blast[2] - 1.5 * Math.sin(a)];
  const eye = [me.pos[0], me.pos[1] + 1.6, me.pos[2]];
  const far = Math.hypot(stand[0] - me.pos[0], stand[2] - me.pos[2]) > 0.6;
  const still = Math.hypot(...ball.vel) < 0.05;
  // our view is a round trip old: a shot every 3 s at most, so one isn't fired twice
  if (!far && still && me.refire === 0 && t - lastShot > 375) { shots = (shots + 1) & 3; lastShot = t; }
  const { yaw, pitch } = aimAt(eye, far ? [stand[0], eye[1], stand[2]] : blast);
  return W.packInput({ yaw, pitch, move: far ? 1 : 0, shot: shots });
}

// Every 4 ms: step the ticks we have, in order, and decide a word for each
// tick the server's clock (plus the lead) has passed. Every 16 ms: send the
// newest 16 words, our acks and the newest interval hash.
const words = new Map();
let next = w.joinTick, stepped = 0, seq = 0, report = null;
const hashes = [];
const timer = setInterval(() => {
  while (keys && store.has(w.roomStart + view.tick)) {
    const t = w.roomStart + view.tick;
    const { events, words: changed } = base.apply(store.get(t));
    store.delete(t);
    feedTick(u8, dv, { ev: events, w: changed });
    sim.step();
    stepped++;
    if (dv.getInt32(L.INTERVAL_TICK, true) === view.tick) {
      const hash = dv.getBigUint64(L.INTERVAL_HASH, true);
      hashes.push([view.tick, hash.toString(16)]);
      report = { interval: view.tick, epoch: keys & 255, hash, left: 8 };
    }
  }
  for (; next <= serverTick() + LEAD; next++) words.set(next, play(next));
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

setTimeout(() => {
  clearInterval(timer);
  clearInterval(sender);
  tcp.end(); // ending the stream is how the relay hears we left
  udp.close();
  const me = view.player(w.slot);
  console.log(JSON.stringify({ slot: w.slot, joinTick: w.joinTick, stepped, keys, shots: me.shots, strokes: me.strokes, hashes }));
}, seconds * 1000);
