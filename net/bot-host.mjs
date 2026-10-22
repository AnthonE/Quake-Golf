#!/usr/bin/env node
// The bot host: one process plays many slots of a room through the relay's
// native door (net/relay.ts --native-port), each slot its own session, a TCP
// connection for the stream and a UDP socket for the datagrams, as an Xbox's
// would be. Every client of a room computes the same world, so the bots share
// one copy of it, stepped from the ticks any of their sessions hears, and
// each is a neural golfer (client/brain.mjs) on the golf bot's legs. Each
// session still acks, gets its own repairs, keeps its own input lead and
// reports the shared world's interval hashes, so the relay sees as many
// ordinary clients as there are bots. With --watch they are spectators
// instead: no slot, no words, but the same acks, repairs and hash reports.
// Given several relays, a session whose relay goes away tries the next, a few
// times a second for up to 10 s, asking for its slot back (a resume): a
// standby relay that has taken the room over holds it (net/relay.ts --standby).
//   node net/bot-host.mjs [--relay 127.0.0.1:4434[,host:port...]] [--bots 250] [--seconds 0] [--rate 50] [--genome qg2:...]
//                         [--impair delay=60,jitter=10,loss=0.02] [--out traces/bot-host.json] [--watch]
// --seconds 0 plays until Ctrl-C; --rate: sessions opened a second. The summary
// (--out, else stdout) holds every session's delivery and inputs, and the
// shared world's interval hashes.
import net from 'node:net';
import dgram from 'node:dgram';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from './wire.mjs';
import * as L from '../src/layout.mjs';
import { createImpair, parseImpair } from './impair.js';
import { feedTick } from './inbox.mjs';
import { newMemory, instantiate, Sim } from '../harness/core.mjs';
import { View } from '../src/view.mjs';
import { BrainBot } from '../client/brain.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const relays = opt('relay', '127.0.0.1:4434').split(',').map((a) => { const [host, port] = a.split(':'); return { host, port: Number(port) }; });
const FAILOVER_MS = 10000;
const SILENT_MS = 1500; // a relay this quiet is gone, whatever TCP says
const nBots = Number(opt('bots', 250));
const seconds = Number(opt('seconds', 0));
const rate = Number(opt('rate', 50));
const impair = parseImpair(opt('impair', ''));
const outPath = opt('out', '');
const watch = argv.includes('--watch');
const genome = opt('genome', readFileSync(join(ROOT, 'xbox/golfer.h'), 'utf8').match(/GOLFER_DEFAULT "(qg2:[A-Za-z0-9_-]+)"/)[1]);
const HOLE_TICKS = 56; // client/sim.mjs: a repair can come until a hole is 64 ticks old
const TARGET_SLACK = (W.SEND_EVERY + 1) * W.TICK_MS; // net/bot.mjs: a lost input's repeat must still land

const bytes = readFileSync(join(ROOT, 'build/game.wasm'));
const prefix = await W.wasmPrefix(bytes);
const t0 = performance.now();
const cpu0 = process.cpuUsage();

// The shared world: the room's confirmed state, one sim for every bot.
const world = {
  sim: null, view: null, base: new W.TickBase(), store: new Map(), newest: -1,
  roomStart: -1, seed: 0, started: false, starting: false, filling: null, syncAt: -1e9,
  sBase: 0, sEpoch: 0, bestRtt: Infinity, // the server's clock, from the first session's welcome and pings
  hashes: [], keys: [], stepped: 0, stepMs: 0, worstStepMs: 0, syncs: 0,
};
const memory = newMemory();
world.sim = new Sim(await instantiate(await WebAssembly.compile(bytes), memory), memory);
world.view = new View(memory.buffer);
const at = () => world.roomStart + world.sim.tick; // the next server tick to step
const serverTick = (now) => world.sBase + (now - world.sEpoch) / W.TICK_MS;

function offer(t, parts) {
  if (!world.started || t < at() || world.store.has(t)) return;
  world.store.set(t, parts);
  if (t > world.newest) world.newest = t;
}

// A keyframe: the first one starts the shared world; later joins' are only theirs.
async function keyframe(k, s) {
  if ((world.started || world.starting) && k.reason === W.SYNC.JOIN) return;
  world.starting = true;
  const region = k.raw ? await W.unpackKey(k.packed) : null;
  if (region) { world.sim.setRegion(region); world.base.seed(region); } else { world.sim.init(world.seed); world.base.reset(); }
  if (at() !== k.tick) throw new Error(`keyframe for tick ${k.tick} restored tick ${at()}`);
  for (const t of world.store.keys()) if (t < k.tick) world.store.delete(t);
  world.started = true;
  world.filling = s;
  world.keys.push({ session: s.k, reason: k.reason, simTick: k.tick - world.roomStart, raw: !!region });
}

// Steps every tick it has, in order; each closed interval's hash goes out on every session.
function step() {
  if (!world.started) return;
  const t1 = performance.now();
  const sim = world.sim;
  while (world.store.has(at()) && performance.now() - t1 < 20) {
    const t = at();
    const { events, words } = world.base.apply(world.store.get(t));
    world.store.delete(t);
    feedTick(sim.u8, new DataView(memory.buffer), { ev: events, w: words });
    const a = performance.now();
    sim.x.step();
    const ms = performance.now() - a;
    world.stepMs += ms;
    world.worstStepMs = Math.max(world.worstStepMs, ms);
    world.stepped++;
    // inputs applied as sent: each session's word for t against the tick's own
    for (const s of sessions) {
      if (!s.joined || s.watch || t < s.joinTick0) continue;
      const sent = s.words.get(t);
      if (sent === undefined) continue;
      s.mine++;
      if (world.base.w[s.slot] === sent) s.matched++;
    }
    const k = sim.tick;
    if (sim.i32[L.INTERVAL_TICK >> 2] === k) {
      const hash = new DataView(memory.buffer).getBigUint64(L.INTERVAL_HASH, true);
      world.hashes.push([k, hash.toString(16)]);
      for (const s of sessions) if (s.joined) s.report = { interval: k, hash, left: 8 };
    }
  }
  // a hole repairs couldn't fill: the first session asks for a keyframe
  const now = performance.now();
  if (!world.filling && now - world.syncAt > 1500 && !world.store.has(at()) && world.newest - at() >= HOLE_TICKS) {
    world.syncAt = now;
    world.syncs++;
    sessions.find((s) => s.joined)?.stream(W.encodeSync(W.SYNC.HOLE, at()));
  }
}

class Session {
  constructor(k) {
    this.k = k;
    this.slot = -1;
    this.joined = false;
    this.watch = watch;
    this.reject = null;
    this.imp = createImpair({ ...impair, seed: 1000 + k });
    this.rx = Buffer.alloc(0);
    this.queue = Promise.resolve();
    this.recv = new W.Received();
    this.parts = new W.Parts();
    this.words = new Map(); // server tick -> the word sent for it
    this.lead = 3;
    this.lastBundleT = -1;
    this.inAck = 0;
    this.seq = 0;
    this.keys = 0;
    this.report = null;
    this.stats = { up: 0, down: 0, bundles: 0, bundleTicks: 0, repairTicks: 0, fills: 0, pongs: 0 };
    this.mine = 0;
    this.matched = 0;
    this.closed = false;
    this.leaving = false;
    this.relay = 0; // which of relays
    this.lostAt = -1; // when the relay went away, until another has us
    this.failovers = [];
  }

  open() {
    this.udp = dgram.createSocket('udp4');
    this.udp.on('message', (buf) => this.imp.recv(() => this.onDatagram(buf)));
    this.udp.on('error', () => {});
    this.connect();
  }

  connect() {
    const { host, port } = relays[this.relay];
    const tcp = this.tcp = net.connect({ host, port, noDelay: true });
    tcp.on('error', () => {});
    tcp.on('close', () => { if (tcp === this.tcp) this.lost(); });
    tcp.on('data', (d) => { this.rx = this.rx.length ? Buffer.concat([this.rx, d]) : d; this.parse(); });
    // back after a failover: the same slot in the same room
    const resume = this.lostAt >= 0 && !watch ? this.slot : -1;
    tcp.on('connect', () => this.stream(W.encodeHello({ maxDatagram: 1400, wasmPrefix: prefix, nonce: this.k, watch, room: resume >= 0 ? this.roomStart : 0, resume })));
  }

  // The relay went away (or wouldn't have us yet): the next one, in a quarter
  // second, with this session's view of the room's ticks begun again.
  lost() {
    const now = performance.now();
    if (this.leaving || this.slot === -1 && !watch || relays.length < 2) { this.closed = true; return; }
    if (this.lostAt < 0) this.lostAt = now;
    if (now - this.lostAt > FAILOVER_MS) { this.closed = true; return; }
    Object.assign(this, { joined: false, rx: Buffer.alloc(0), recv: new W.Received(), parts: new W.Parts(), lastBundleT: -1, inAck: 0, keys: 0 });
    if (world.filling === this) world.filling = null;
    this.relay = (this.relay + 1) % relays.length;
    setTimeout(() => this.connect(), 250);
  }

  stream(b) { if (!this.closed && this.tcp && !this.tcp.destroyed) this.tcp.write(b); }

  datagram(m) {
    const d = new Uint8Array(4 + m.length);
    new DataView(d.buffer).setUint32(0, this.token >>> 0, true);
    d.set(m, 4);
    this.stats.up += d.length;
    const { host, port } = relays[this.relay];
    this.imp.send(() => { if (!this.closed) this.udp.send(d, port, host); }); // a delayed send can land after leave()
  }

  // net/wire.mjs readControl, on bytes as they come
  parse() {
    for (;;) {
      const b = this.rx;
      if (!this.joined) {
        if (b.length >= 4 && b[0] === W.T_REJECT) {
          // mid-failover, a relay that isn't holding the room yet: try again
          if (this.lostAt >= 0 && (b[1] === W.REJECT.WATCH_ONLY || b[1] === W.REJECT.EMPTY)) {
            const tcp = this.tcp;
            this.tcp = null; // its close isn't news
            tcp.destroy();
            this.relay = (this.relay + relays.length - 1) % relays.length;
            this.lost();
            return;
          }
          this.reject = b[1];
          this.leave();
          return;
        }
        if (b.length < 32) return;
        this.welcome(W.decodeWelcome(b.subarray(0, 32)));
        this.rx = b.subarray(32);
        continue;
      }
      if (b.length < 16) return;
      const dv = new DataView(b.buffer, b.byteOffset, b.length);
      let need = 16;
      if (b[0] === W.T_FILL) need += dv.getUint32(12, true);
      if (b[0] === W.T_KEY) need += (b[1] === W.SYNC.DESYNC ? 8 + 1024 : 0) + dv.getUint32(12, true);
      if (b.length < need) return;
      const m = Buffer.from(b.subarray(0, need));
      this.rx = b.subarray(need);
      this.queue = this.queue.then(() => this.control(m)).catch((e) => { this.error = String(e?.message || e); });
    }
  }

  welcome(w) {
    if (this.lostAt >= 0) {
      this.failovers.push({ ms: Math.round(performance.now() - this.lostAt), to: this.relay, slot: w.slot, kept: w.slot === this.slot });
      this.lostAt = -1;
      this.heardAt = performance.now();
      // the words already decided for ticks past the new join go as they are
      Object.assign(this, { joined: true, joinTick: w.joinTick, token: w.token, nextTick: Math.max(this.nextTick, w.joinTick), lastSent: Math.max(this.lastSent, w.joinTick) });
      if (!w.watch && w.slot !== this.slot) { this.slot = w.slot; this.bot = new BrainBot(w.slot, genome, { lag: 8 }); }
      this.datagram(W.encodeInput({ seq: this.seq++, firstTick: w.joinTick, ackTick: 0, ackBits: 0n, words: [] }));
      return;
    }
    this.heardAt = performance.now();
    Object.assign(this, { joined: true, slot: w.slot, joinTick: w.joinTick, joinTick0: w.joinTick, token: w.token, roomStart: w.roomStart, nextTick: w.joinTick, lastSent: w.joinTick });
    if (!w.watch) this.bot = new BrainBot(w.slot, genome, { lag: 8 });
    const now = performance.now();
    if (world.roomStart < 0) {
      world.roomStart = w.roomStart;
      world.seed = w.seed;
      world.sim.init(w.seed);
      world.sBase = w.serverTick + 0.5;
      world.sEpoch = now;
      // five pings on this session set the clock
      for (let k = 0; k < 5; k++) setTimeout(() => { this.pingAt = this.pingAt || []; this.pingAt[k] = performance.now(); this.stream(W.encodePing(k)); }, 50 * k);
    }
    // the first datagram tells the relay where this session's bundles go
    this.datagram(W.encodeInput({ seq: this.seq++, firstTick: w.joinTick, ackTick: 0, ackBits: 0n, words: [] }));
  }

  async control(m) {
    const dv = new DataView(m.buffer, m.byteOffset, m.length);
    if (m[0] === W.T_PONG) {
      this.stats.pongs++;
      const rtt = performance.now() - this.pingAt[dv.getUint32(4, true)];
      if (rtt < world.bestRtt) { world.bestRtt = rtt; world.sBase = dv.getFloat64(8, true) + rtt / 2 / W.TICK_MS; world.sEpoch = performance.now(); }
      return;
    }
    if (m[0] === W.T_KEY) {
      this.keys++;
      const extra = m[1] === W.SYNC.DESYNC ? 8 + 1024 : 0;
      await keyframe({ reason: m[1], tick: dv.getUint32(4, true), raw: dv.getUint32(8, true), packed: m.subarray(16 + extra) }, this);
      return;
    }
    if (m[0] === W.T_FILL) {
      this.stats.fills++;
      const h = W.decodeFillHead(m);
      for (const t of W.decodeFillBody(h.from, h.n, m.subarray(16))) { this.recv.add(t.tick); offer(t.tick, t.parts); }
      if (world.filling === this) world.filling = null;
    }
  }

  onDatagram(buf) {
    this.heardAt = performance.now();
    const d = W.decodeTicks(buf);
    if (!d) return;
    this.stats.down += buf.length;
    let newest = -1;
    for (const e of d.entries) {
      newest = Math.max(newest, e.tick);
      const whole = this.parts.add(e);
      if (!whole || e.tick < this.roomStart || !this.recv.add(e.tick)) continue;
      if (e.tick >= this.joinTick) { if (d.type === W.T_BUNDLE) this.stats.bundleTicks++; else this.stats.repairTicks++; }
      offer(e.tick, whole);
    }
    this.parts.forget(this.recv.newest - 512);
    if (d.type !== W.T_BUNDLE || newest <= this.lastBundleT) return;
    // a bundle in several datagrams carries one trailer on each: once, with its newest tick
    this.stats.bundles++;
    this.lastBundleT = newest;
    this.inAck = Math.max(this.inAck, d.trailer.inAck);
    // net/bot.mjs: a small continuous nudge of the lead toward the target slack
    this.lead = Math.max(1, Math.min(40, this.lead + 0.02 * (TARGET_SLACK - d.trailer.slack) / W.TICK_MS));
  }

  // One word a tick as the predicted clock passes it, the bot looking at the shared
  // world; every second tick, the words the relay hasn't closed, the acks, the newest hash.
  tick(now) {
    if (!this.joined || this.closed) return;
    if (relays.length > 1 && now - this.heardAt > SILENT_MS) { const tcp = this.tcp; this.tcp = null; tcp?.destroy(); this.lost(); return; }
    if (this.watch) {
      // a spectator: its acks and the newest hash, every second tick of the server's clock
      const t = Math.floor(serverTick(now));
      if (t - this.lastSent < W.SEND_EVERY) return;
      this.lastSent = t;
      const r = this.report?.left > 0 ? this.report : null;
      if (r) r.left--;
      this.datagram(W.encodeInput({ seq: this.seq++, firstTick: 0, ...this.recv.ack(), words: [], report: r && { interval: r.interval, epoch: this.keys, hash: r.hash } }));
      return;
    }
    const predicted = Math.floor(serverTick(now) + this.lead);
    if (this.nextTick > predicted) return;
    // ticks between deciding an input and seeing what it did, in the shared world
    this.bot.lag = Math.max(2, this.nextTick - at());
    while (this.nextTick <= predicted) {
      this.words.set(this.nextTick, world.started ? this.bot.think(world.view) : 0);
      this.nextTick++;
    }
    for (const t of this.words.keys()) if (t < at() - 64) this.words.delete(t); else break;
    if (this.nextTick - this.lastSent < W.SEND_EVERY) return;
    this.lastSent = this.nextTick;
    const first = Math.max(this.inAck, this.lastBundleT, this.joinTick - 1) + 1;
    const from = Math.max(first, this.nextTick - W.MAX_INPUTS);
    const list = [];
    for (let t = from; t < this.nextTick; t++) list.push(this.words.get(t) ?? 0);
    if (!list.length) return;
    const r = this.report?.left > 0 ? this.report : null;
    if (r) r.left--;
    this.datagram(W.encodeInput({ seq: this.seq++, firstTick: from, ...this.recv.ack(), words: list, report: r && { interval: r.interval, epoch: this.keys, hash: r.hash } }));
  }

  leave() {
    this.leaving = true;
    if (this.closed) return;
    this.closed = true;
    try { this.tcp?.end(); } catch { /* gone */ }
    try { this.udp.close(); } catch { /* gone */ }
  }
}

const sessions = [];
for (let k = 0; k < nBots; k++) setTimeout(() => { const s = new Session(k); sessions.push(s); s.open(); }, (1000 * k) / rate);
const timer = setInterval(() => {
  const now = performance.now();
  step();
  for (const s of sessions) s.tick(now);
}, W.TICK_MS / 2);
let last = 0;
const progress = setInterval(() => {
  const live = sessions.filter((s) => s.joined && !s.closed).length;
  const sim = world.sim.tick;
  if (!argv.includes('--quiet')) process.stderr.write(`\r[bot-host] ${((performance.now() - t0) / 1000).toFixed(0)} s, ${live} sessions, world at sim tick ${sim} (+${sim - last}), ${world.store.size} queued   `);
  last = sim;
}, 1000);
await new Promise((ok) => { if (seconds > 0) setTimeout(ok, seconds * 1000); process.once('SIGINT', ok); process.once('SIGTERM', ok); });
clearInterval(timer);
clearInterval(progress);
for (const s of sessions) s.leave();
if (!argv.includes('--quiet')) process.stderr.write('\n');

const cpu = process.cpuUsage(cpu0);
const wall = (performance.now() - t0) / 1000;
const v = world.view;
const players = sessions.filter((s) => s.joined && !s.watch).map((s) => {
  const p = v.player(s.slot);
  return { slot: s.slot, strokes: p.strokes, holes: p.holes, total: p.total, done: p.done };
});
const per = sessions.map((s) => {
  const end = s.lastBundleT;
  const expected = s.joined && end >= s.joinTick0 ? end - s.joinTick0 + 1 : 0;
  return {
    k: s.k, joined: s.joined, slot: s.slot, reject: s.reject, error: s.error || null, joinTick: s.joinTick0 ?? null, keys: s.keys, failovers: s.failovers,
    expected, bundleTicks: s.stats.bundleTicks, repairTicks: s.stats.repairTicks, bundles: s.stats.bundles,
    downKB: Number((s.stats.down / 1000).toFixed(1)), upKB: Number((s.stats.up / 1000).toFixed(1)), mine: s.mine, matched: s.matched,
  };
});
const summary = {
  bots: nBots, seconds, impair, genome,
  watch, joined: per.filter((p) => p.joined).length, rejected: per.filter((p) => p.reject !== null).length,
  errors: per.filter((p) => p.error).map((p) => ({ k: p.k, error: p.error })),
  cpuPctOfOneCore: Number((100 * (cpu.user + cpu.system) / 1e6 / wall).toFixed(1)),
  world: {
    roomStart: world.roomStart, seed: world.seed, stepped: world.stepped, simTick: world.sim.tick, keys: world.keys, syncs: world.syncs,
    meanStepMs: world.stepped ? Number((world.stepMs / world.stepped).toFixed(3)) : 0, worstStepMs: Number(world.worstStepMs.toFixed(2)),
    hashes: world.hashes, players,
  },
  sessions: per,
};
const text = JSON.stringify(summary);
if (outPath) writeFileSync(outPath, text + '\n');
else console.log(text);
setTimeout(() => process.exit(0), 200);
