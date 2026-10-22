// The relay: one isolate owns the QUIC endpoint, the 8 ms clock and the
// bundles. Deadlines run from a fixed epoch; an input counts only if it was
// read before its tick's deadline, so a late timer adds latency, never unfairness.
// Each closed tick is coded once, as the words that changed (net/wire.mjs);
// bundles go out first, every second tick, the newest four ticks in as many
// datagrams as they need, with a per-recipient trailer. Every closed tick is
// also recorded from the room's start and handed to the referee (net/referee-worker.mjs), a Worker stepping
// the same game.wasm: it is the truth for interval hashes and keyframes. A
// joiner gets the newest keyframe and the record since; a tick a client's
// acks lack comes back in a repair datagram; a hash a client reports that
// differs from the referee's, a hole too old to repair, or a client far
// behind gets a resync from a keyframe. A room that empties starts over on a new seed.
// Spectators (a hello with the watch flag) hold no slot: they get the bundles,
// repairs and keyframes and report hashes, and send no words.
//
// With --upstream, the relay is an edge: it watches a room on another relay
// (its native door) as a spectator and serves it to spectators of its own,
// closing ticks as they come down rather than on its own clock. Its referee
// starts from the keyframe it began watching at and reports its hashes
// upstream, so each relay in a tree is checked by the one above it.
//
//   .tools/deno run --unstable-net -A net/relay.ts [--port 4433] [--native-port 4434] [--duration 70] [--cc low-latency|default] [--seed N] [--host 127.0.0.1]
//                  [--upstream host:native-port] [--watchers 4096]
// Clients are Chrome (net/run-m0.mjs hosts the bots there): Deno's WebTransport
// client always binds an IPv6 socket, which hosts without IPv6 refuse. Native
// clients (the Xbox) come in on --native-port instead: the same session over a
// TCP connection for the stream and UDP for the datagrams (net/wire.mjs).
import * as W from './wire.mjs';
import { recordLog } from './inbox.mjs';

const argv = Deno.args;
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const port = Number(opt('port', '4433'));
const durationS = Number(opt('duration', '0'));
const cc = opt('cc', 'low-latency') as 'low-latency' | 'default' | 'throughput';
// Deno timers overshoot by a millisecond or two. Precise mode arms the timer
// early, then yields through a MessageChannel until the deadline, so datagram
// reads keep flowing while it waits.
const precise = opt('precise', '1') !== '0';
// how long before a deadline the timer hands over to the yield loop; --early 8 never sleeps
const EARLY_MS = Number(opt('early', '1.5'));
const quiet = argv.includes('--quiet');
const verbose = argv.includes('--verbose');
const log = (...a: unknown[]) => { if (verbose) console.error(`[relay ${((performance.now() - E) / 1000).toFixed(2)}]`, ...a); };
// a fixed course for every room, else a random one each time a room starts
const seedArg = opt('seed', '');
const hostname = opt('host', '127.0.0.1');
const nativePort = Number(opt('native-port', '4434')); // 0: no native door
const newSeed = () => (seedArg ? Number(seedArg) >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]);
// where the run summary goes; stdout by default (V8 traces share stdout, so runners pass a file)
const summaryPath = opt('summary', '');
const upstream = opt('upstream', ''); // an edge: the relay (host:native port) whose room it serves
const MAX_WATCHERS = Number(opt('watchers', '4096'));

const cert = await Deno.readTextFile('certs/cert.pem');
const key = await Deno.readTextFile('certs/key.pem');
const wasm = await Deno.readFile('build/game.wasm');
const prefix = await W.wasmPrefix(wasm);

type Slot = {
  slot: number; joinTick: number; leaveTick: number; writer: WritableStreamDefaultWriter<Uint8Array>; ctl: WritableStreamDefaultWriter<Uint8Array>;
  maxDatagram: number; last: number; missing: number; late: number; lastSlack: number; periodSlack: number; contig: number; lastRecv: number; pendingLate: number; close: () => void;
  words: Uint32Array; wordTick: Int32Array; arrival: Float64Array;
  // ticks from fromTick on reach this client by bundle or repair (before it, by its last fill)
  fromTick: number; repairTick: Int32Array; repairAt: Float64Array;
  keys: number; syncing: boolean; lastSync: number; lastDesync: number; lastReport: number; reports: Map<number, bigint>;
  token: number; // a native session's, 0 for WebTransport
  watch: boolean; // a spectator: no slot (slot -1), no words
  leave?: (why: string) => void;
};
// How a session reaches its client: its stream (read and write) and its datagrams.
type Door = {
  sr: ReturnType<typeof W.bufferedReader>; sw: WritableStreamDefaultWriter<Uint8Array>;
  datagrams: { write(b: Uint8Array): Promise<unknown> }; close: () => void;
  maxDatagram: number; // 0: whatever the client's hello says, up to W.MAX_DATAGRAM
  token: number;
};

const E = performance.now();
const deadline = (t: number) => E + W.TICK_MS * (t + 1);
let closed = -1;
const slots: (Slot | null)[] = new Array(W.NP).fill(null);
const watchers = new Set<Slot>();
function* everyone() { for (const s of slots) if (s) yield s; yield* watchers; }
// a session that has left (or a slot since taken by someone else)
const gone = (s: Slot) => (s.watch ? !watchers.has(s) : slots[s.slot] !== s);
// every slot's word on the newest closed tick (0 for a slot nobody holds): what the next tick is coded against
let prevWords = new Uint32Array(W.NP);
let events: { slot: number; kind: number; tick: number }[] = [];
// The room: its sim began at roomStart (-1 while nobody is in it) on roomSeed,
// and record[T - recordStart] is closed tick T, its parts as encodeTick gives
// them. recordStart is roomStart, or on an edge the keyframe it began from.
let roomStart = -1;
let recordStart = -1;
let roomSeed = newSeed();
let record: Uint8Array[][] = [];
// The room's tick now, fractional, as pongs tell it: the clock's, or on an edge the upstream's.
let serverNow = () => (performance.now() - E) / W.TICK_MS;
const stats = {
  ticks: 0, closeLate: [] as number[], stallEvents: [] as number[][], sent: 0, sentBytes: 0, maxBundle: 0, bundles: 0, bundleBytes: 0, tickBytes: 0, maxTick: 0, lateArrivals: 0,
  recv: 0, recvBytes: 0, onTime: 0, substituted: 0, sessions: 0, rejected: 0, slack: [] as number[], activeTicks: 0, activeSlotTicks: 0, silent: 0, warmup: 0,
  leaves: {} as Record<string, number>, leaveAt: [] as number[],
  serverMaxDatagram: [] as number[], clientMaxDatagram: [] as number[], cc, fills: 0, fillTicks: 0,
  repairs: 0, repairTicks: 0, pongs: 0, keys: [] as Record<string, number>[], compared: 0, agreed: 0,
  mismatches: [] as Record<string, unknown>[], dumps: [] as string[], refLagMax: 0, refErrors: [] as string[],
  refHashes: [] as [number, string][], reports: {} as Record<number, [number, string][]>,
  watchSessions: 0, watchMax: 0, watchBytes: 0, watchSeconds: 0, watchCompared: 0, watchAgreed: 0,
  upstream: null as null | Record<string, unknown>,
};

// The referee: closed ticks go to it in batches; interval hashes and packed keyframes come back.
const referee = new Worker(new URL('./referee-worker.mjs', import.meta.url).href, { type: 'module' });
referee.postMessage({ wasm });
let toReferee: Uint8Array[][] = [];
let refRoom = 0; // the referee's generation: a room's start, or an edge's restart from a keyframe
const refIntervals = new Map<number, { hash: bigint; digests: Uint8Array }>(); // sim tick -> the referee's
let keyId = 0;
const keyWaiters = new Map<number, (k: { tick: number; raw: number; packed: Uint8Array }) => void>();
referee.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.error) { stats.refErrors.push(m.error); console.error('referee: ' + m.error); return; }
  if (m.room !== refRoom) return;
  if (m.key) { keyWaiters.get(m.key.id)?.(m.key); keyWaiters.delete(m.key.id); }
  if (m.intervals) {
    for (const iv of m.intervals) {
      refIntervals.set(iv.tick, iv);
      stats.refHashes.push([iv.tick, iv.hash.toString(16)]);
      for (const s of everyone()) check(s, iv.tick);
      if (upstream) up.report = { interval: iv.tick, hash: iv.hash, left: 8 };
    }
    for (const t of refIntervals.keys()) if (t < m.at - 16 * 128) refIntervals.delete(t);
    stats.refLagMax = Math.max(stats.refLagMax, closed - roomStart - m.at);
  }
};
// The record and the referee from tick `start`: a room's first tick, or the
// keyframe an edge begins from (its region; null at the room's start).
function startRecord(start: number, region: Uint8Array | null = null) {
  recordStart = start;
  record = [];
  toReferee = [];
  refIntervals.clear();
  referee.postMessage({ reset: { room: ++refRoom, seed: roomSeed, region } });
}
function startRoom(start: number) {
  roomStart = start;
  startRecord(start);
}
// The referee's newest keyframe; if it doesn't answer in 5 s, the room's start
// (raw 0: the client inits from the seed), which only the root's record holds.
function keyframe(): Promise<{ tick: number; raw: number; packed: Uint8Array }> {
  const id = ++keyId;
  return new Promise((ok) => {
    keyWaiters.set(id, ok);
    referee.postMessage({ room: refRoom, want: id });
    if (!upstream) setTimeout(() => { if (keyWaiters.delete(id)) ok({ tick: 0, raw: 0, packed: new Uint8Array(0) }); }, 5000);
  });
}

// A keyframe and the record since it, on the client's stream. Ticks after the
// fill reach it by bundle or repair. Its reports from before it restores this
// one carry the old epoch and are dropped.
async function sendKey(s: Slot, reason: number, desync?: { interval: number; digests: Uint8Array }) {
  if (s.syncing) return;
  s.syncing = true;
  s.lastSync = performance.now();
  const room = roomStart;
  const gen = refRoom;
  log(`key for slot ${s.slot} asked: reason ${reason}`);
  const k = await keyframe();
  if (room !== roomStart || gen !== refRoom || gone(s)) { log(`key for slot ${s.slot} dropped: room ${room} now ${roomStart}`); s.syncing = false; return; }
  const tick = room + k.tick;
  const to = closed + 1;
  const ticks = record.slice(tick - recordStart, Math.max(tick - recordStart, to - recordStart));
  const fill = W.encodeFill(tick, ticks);
  s.fromTick = to;
  s.keys++;
  s.reports.clear();
  s.lastReport = k.tick;
  stats.fills++;
  stats.fillTicks += ticks.length;
  log(`key to slot ${s.slot}: reason ${reason}, sim tick ${k.tick}, ${k.packed.length} B, fill ${ticks.length}`);
  stats.keys.push({ slot: s.slot, reason, at: Number(((performance.now() - E) / 1000).toFixed(2)), simTick: k.tick, packed: k.packed.length, fillTicks: ticks.length });
  // three writes queued back to back, so nothing lands between them
  s.ctl.write(W.encodeKeyHead({ reason, tick, raw: k.raw, packed: k.packed.length, interval: desync?.interval, digests: desync?.digests })).catch(() => {});
  s.ctl.write(k.packed).catch(() => {});
  await s.ctl.write(fill).catch(() => {});
  s.syncing = false;
}

// A client's interval hash against the referee's, once both are in.
const RESYNC_MS = 5000;
function check(s: Slot, interval: number) {
  const ref = refIntervals.get(interval);
  const h = s.reports.get(interval);
  if (!ref || h === undefined) return;
  s.reports.delete(interval);
  stats.compared++;
  if (s.watch) stats.watchCompared++;
  if (ref.hash === h) { stats.agreed++; if (s.watch) stats.watchAgreed++; return; }
  const now = performance.now();
  stats.mismatches.push({ slot: s.slot, watch: s.watch, interval, at: Number(((now - E) / 1000).toFixed(2)), client: h.toString(16), referee: ref.hash.toString(16) });
  // (an edge's record starts at a keyframe, not the room's start: no log to replay)
  if (stats.dumps.length < 4 && recordStart === roomStart) {
    // the room's record as a log the harness replays: the desync's repro case
    const file = `traces/desync-${roomStart}-${interval}.qgl`;
    stats.dumps.push(file);
    Deno.mkdir('traces', { recursive: true }).then(() => Deno.writeFile(file, recordLog(record, roomSeed))).catch(() => {});
  }
  if (now - s.lastDesync < RESYNC_MS) return;
  s.lastDesync = now;
  sendKey(s, W.SYNC.DESYNC, { interval, digests: ref.digests });
}

// Every tick an ack shows missing, resent from the record, each at most every
// REPAIR_MS: a run of consecutive ticks per datagram, a few datagrams per ack.
const REPAIR_MS = 100;
function repair(s: Slot, ackTick: number, ackBits: bigint, now: number) {
  if (recordStart < 0 || s.fromTick > closed) return;
  const due = W.holes(ackTick, ackBits, Math.max(s.fromTick, recordStart)).filter((t: number) => {
    if (t > closed) return false;
    const i = t & (W.RING - 1);
    return s.repairTick[i] !== t || now - s.repairAt[i] >= REPAIR_MS;
  });
  if (!due.length) return;
  const list = due.map((t: number) => ({ tick: t, parts: record[t - recordStart] }));
  for (const buf of W.encodeTicks(W.T_REPAIR, list, Math.min(W.MAX_DATAGRAM, s.maxDatagram)).slice(0, 4)) {
    const ticks = new Set(W.decodeTicks(buf)!.entries.map((e: { tick: number }) => e.tick));
    for (const t of ticks) { s.repairTick[t & (W.RING - 1)] = t; s.repairAt[t & (W.RING - 1)] = now; }
    s.writer.write(buf).catch(() => {});
    stats.repairs++;
    stats.repairTicks += ticks.size;
  }
}

function freeSlot() { return slots.findIndex((s) => s === null); }

// At most 8 join/leave events per tick, so a room that fills at once fills
// over 32 ticks, and the keyframes its joiners ask for come in turn.
const EVENTS_PER_TICK = 8;
const eventsAt = new Map<number, number>();
function scheduleEvent(slot: number, kind: number, earliest: number) {
  let t = earliest;
  while ((eventsAt.get(t) || 0) >= EVENTS_PER_TICK) t++;
  eventsAt.set(t, (eventsAt.get(t) || 0) + 1);
  events.push({ slot, kind, tick: t });
  return t;
}

// No input for this long and the player has left, whatever QUIC says: this
// long of the relay running smoothly, so its own stall never looks like silence.
const SILENT_MS = 2000;
let stallEnd = -Infinity;
// The first half second after a join, while the client's lead converges (F10's cold start).
const WARMUP = 64;

function onInput(s: Slot, buf: Uint8Array, now: number) {
  s.lastRecv = now;
  stats.recv++;
  stats.recvBytes += buf.length;
  const m = W.decodeInput(buf);
  if (!m) return;
  repair(s, m.ackTick, m.ackBits, now);
  const r = m.report;
  // each interval once (a client repeats its report), and only from the current keyframe on
  if (r && r.interval > s.lastReport && r.epoch === (s.keys & 255)) {
    s.lastReport = r.interval;
    s.reports.set(r.interval, r.hash);
    if (!s.watch) (stats.reports[s.slot] ||= []).push([r.interval, r.hash.toString(16)]);
    for (const t of s.reports.keys()) if (t < r.interval - 16 * 128) s.reports.delete(t);
    check(s, r.interval);
  }
  for (let k = 0; k < m.words.length; k++) {
    const t = m.firstTick + k;
    if (t < s.joinTick || t > closed + W.RING - 8) continue;
    const i = t & (W.RING - 1);
    if (t <= closed) {
      // Too late for its tick. Still feed it back, as negative slack, so the
      // client's lead controller sees the lateness and grows its lead.
      // Count each late tick once. A slot only moves forward: tick t shares it
      // with t + 256, which may already be in, and must not be overwritten.
      if (s.wordTick[i] < t) {
        s.periodSlack = Math.min(s.periodSlack, deadline(t) - now);
        stats.lateArrivals++;
        s.wordTick[i] = t;
        s.arrival[i] = now;
      }
      continue;
    }
    if (s.wordTick[i] !== t) { s.wordTick[i] = t; s.words[i] = m.words[k]; s.arrival[i] = now; }
  }
  // A player still sending after missed deadlines was late, not gone.
  stats.substituted += s.pendingLate;
  s.pendingLate = 0;
  // in_ack: closed ticks are settled either way; then whatever has arrived beyond them
  s.contig = Math.max(s.contig, closed);
  while (s.wordTick[(s.contig + 1) & (W.RING - 1)] === s.contig + 1) s.contig++;
}

function closeTick(T: number, now: number) {
  stats.ticks++;
  stats.closeLate.push(now - deadline(T));
  const row = new Uint32Array(W.NP);
  const dl = deadline(T);
  let active = 0;
  for (let p = 0; p < W.NP; p++) {
    const s = slots[p];
    if (!s || T < s.joinTick) continue;
    if (T >= s.leaveTick) { stats.silent += s.pendingLate; slots[p] = null; continue; }
    if (s.leaveTick === Infinity && now - Math.max(s.lastRecv, stallEnd) > SILENT_MS) {
      stats.leaves.silent = (stats.leaves.silent || 0) + 1;
      stats.leaveAt.push(Number(((now - E) / 1000).toFixed(2)));
      s.leaveTick = scheduleEvent(p, W.EV_LEAVE, Math.max(T + 1, s.joinTick));
      try { s.close(); } catch { /* already gone */ }
    }
    active++;
    const i = T & (W.RING - 1);
    if (s.wordTick[i] === T && s.arrival[i] <= dl) {
      row[p] = s.words[i];
      s.last = row[p];
      s.missing = 0;
      s.lastSlack = dl - s.arrival[i];
      s.periodSlack = Math.min(s.periodSlack, s.lastSlack);
      if (T >= s.joinTick + WARMUP) { stats.slack.push(s.lastSlack); stats.onTime++; }
    } else {
      // repeat the last real input, jump cleared, shot counter unchanged (so no
      // shot fires); after ~30 missing ticks the keys decay to idle
      s.missing++;
      s.late++;
      // booked as late once any later datagram arrives from this player (onInput);
      // the ticks after a player's last packet are a departure, not lateness
      if (T < s.joinTick + WARMUP) stats.warmup++;
      else s.pendingLate++;
      row[p] = s.missing > 30 ? (s.last & ~(W.MOVE_BITS | W.JUMP_BIT)) >>> 0 : (s.last & ~W.JUMP_BIT) >>> 0;
      // read after its deadline but before this (delayed) close: late too
      if (s.wordTick[i] === T) { s.periodSlack = Math.min(s.periodSlack, dl - s.arrival[i]); stats.lateArrivals++; }
    }
  }
  if (active) { stats.activeTicks++; stats.activeSlotTicks += active; }
  const parts = W.encodeTick(events.filter((e) => e.tick === T).map(({ slot, kind }) => ({ slot, kind })), prevWords, row);
  prevWords = row;
  if (roomStart >= 0 && T >= roomStart) {
    const bytes = parts.reduce((a: number, p: Uint8Array) => a + p.length, 0);
    stats.tickBytes += bytes;
    stats.maxTick = Math.max(stats.maxTick, bytes);
    record.push(parts);
    toReferee.push(parts);
    // the last one out: the next joiner starts a new room, and its spectators go
    if (!slots.some((x) => x)) {
      roomStart = recordStart = -1; record = []; toReferee = []; roomSeed = newSeed();
      for (const w of [...watchers]) w.leave?.('room-ended');
    }
  }
  closed = T;
  if (T % W.SEND_EVERY === W.SEND_EVERY - 1) broadcast(T);
}

function broadcast(T: number) {
  if (toReferee.length) { referee.postMessage({ room: refRoom, ticks: toReferee }); toReferee = []; }
  events = events.filter((e) => e.tick > T - W.NB - 4);
  for (const t of eventsAt.keys()) if (t <= T - W.NB) eventsAt.delete(t);
  if (recordStart < 0) return;
  const ticks = [];
  for (let t = Math.max(recordStart, T - W.NB + 1); t <= T; t++) ticks.push({ tick: t, parts: record[t - recordStart] });
  const now = performance.now();
  stats.watchSeconds += watchers.size * W.SEND_EVERY * W.TICK_MS / 1000;
  // the datagrams are the same for everyone with the same size limit: encode
  // them once per limit, then copy and stamp each recipient's trailer
  const byMax = new Map<number, Uint8Array[]>();
  for (const s of everyone()) {
    // a spectator that has stopped acking has gone, whatever its connection says
    if (s.watch && now - Math.max(s.lastRecv, stallEnd) > SILENT_MS) { s.leave?.('silent'); continue; }
    const max = Math.min(W.MAX_DATAGRAM, s.maxDatagram);
    let dgs = byMax.get(max);
    if (!dgs) byMax.set(max, dgs = W.encodeTicks(W.T_BUNDLE, ticks, max));
    // the worst slack since the last bundle, late arrivals included, so the
    // client's lead controller reacts to lateness it would otherwise never see
    const slack = s.watch ? 0 : Number.isFinite(s.periodSlack) ? s.periodSlack : s.lastSlack;
    s.periodSlack = Infinity;
    stats.bundles++;
    for (const d of dgs) {
      const buf = W.stampTrailer(d.slice(), { inAck: s.watch ? closed : s.contig, slack, late: s.late });
      stats.maxBundle = Math.max(stats.maxBundle, buf.length);
      stats.sent++;
      if (s.watch) stats.watchBytes += buf.length;
      else stats.sentBytes += buf.length;
      stats.bundleBytes += buf.length;
      s.writer.write(buf).catch(() => { /* Deno resolves datagram writes; failures show up as closes */ });
    }
  }
}

const channel = new MessageChannel();
channel.port1.onmessage = () => pump();
function pump() {
  const now = performance.now();
  // a wakeup more than a tick late: [ms since start, ms behind], for lining up with --trace-gc
  const behind = now - deadline(closed + 1);
  if (behind > W.TICK_MS && stats.stallEvents.length < 1000) stats.stallEvents.push([Number(now.toFixed(1)), Number(behind.toFixed(1))]);
  // datagrams that came in during a stall are still unread
  if (behind > 4 * W.TICK_MS) stallEnd = now;
  while (deadline(closed + 1) <= now) closeTick(closed + 1, now);
  const wait = deadline(closed + 1) - performance.now();
  if (!precise) setTimeout(pump, Math.max(0, wait));
  else if (wait > EARLY_MS) setTimeout(pump, wait - EARLY_MS);
  else channel.port2.postMessage(0);
}

// A session from its hello on: the slot, the welcome, the join's keyframe,
// then the stream's requests (pings, and resyncs for a hole too old to repair
// or a client far behind, at most one a second) until it ends. Returns the
// slot, with a leave(why) that schedules the leave, or null if it was refused.
async function admit(d: Door) {
  const hello = W.decodeHello(await d.sr.read(24));
  const watch = !!hello?.watch;
  const p = watch ? -1 : freeSlot();
  let reason = 0;
  if (!hello || hello.proto !== W.PROTO) reason = W.REJECT.PROTO;
  else if (hello.wasmPrefix.some((b: number, i: number) => b !== prefix[i])) reason = W.REJECT.WASM;
  else if (upstream && !watch) reason = W.REJECT.WATCH_ONLY;
  else if (watch && recordStart < 0) reason = W.REJECT.EMPTY;
  else if (watch ? watchers.size >= MAX_WATCHERS : p < 0) reason = W.REJECT.FULL;
  if (reason) {
    stats.rejected++;
    await d.sw.write(W.encodeReject(reason)).catch(() => {});
    await d.sw.close().catch(() => {});
    return null;
  }
  const maxDatagram = d.maxDatagram || Math.min(W.MAX_DATAGRAM, hello!.maxDatagram);
  stats.serverMaxDatagram.push(maxDatagram);
  stats.clientMaxDatagram.push(hello!.maxDatagram);
  const joinTick = watch ? closed + 1 : scheduleEvent(p, W.EV_JOIN, closed + 1 + 4);
  if (roomStart < 0) startRoom(joinTick);
  const s: Slot = {
    slot: p, joinTick, leaveTick: Infinity, writer: d.datagrams as WritableStreamDefaultWriter<Uint8Array>, ctl: d.sw, maxDatagram,
    last: 0, missing: 0, late: 0, lastSlack: 0, periodSlack: Infinity, contig: joinTick - 1, lastRecv: performance.now(), pendingLate: 0, close: d.close,
    words: new Uint32Array(W.RING), wordTick: new Int32Array(W.RING).fill(-1), arrival: new Float64Array(W.RING),
    fromTick: Infinity, repairTick: new Int32Array(W.RING).fill(-1), repairAt: new Float64Array(W.RING),
    keys: 0, syncing: false, lastSync: -1e9, lastDesync: -1e9, lastReport: -1, reports: new Map(), token: d.token, watch,
  };
  if (watch) {
    watchers.add(s);
    stats.watchSessions++;
    stats.watchMax = Math.max(stats.watchMax, watchers.size);
  } else {
    slots[p] = s;
    stats.sessions++;
  }
  await d.sw.write(W.encodeWelcome({ slot: p, maxDatagram, joinTick, seed: roomSeed, serverTick: Math.floor(serverNow()) + 1, roomStart, token: d.token, watch }));
  log(`${watch ? 'a spectator' : `slot ${p}`} joins at ${joinTick}, room ${roomStart}${d.token ? ' (native)' : ''}`);
  sendKey(s, W.SYNC.JOIN);
  const leave = (why: string) => {
    if (watch) {
      if (!watchers.delete(s)) return;
      if (s.token) natives.delete(s.token);
      try { s.close(); } catch { /* already closed */ }
      return;
    }
    if (s.leaveTick !== Infinity) return;
    stats.leaves[why] = (stats.leaves[why] || 0) + 1;
    stats.leaveAt.push(Number(((performance.now() - E) / 1000).toFixed(2)));
    s.leaveTick = scheduleEvent(p, W.EV_LEAVE, Math.max(closed + 1, s.joinTick));
    if (s.token) natives.delete(s.token);
    // the slot is gone at leaveTick, so end the session too rather than leave it open and silent
    try { s.close(); } catch { /* already closed */ }
  };
  (async () => {
    for (;;) {
      const buf = await d.sr.read(16);
      if (buf.length < 16) break;
      const m = W.decodeClient(buf);
      if (m?.type === W.T_PING) { stats.pongs++; s.ctl.write(W.encodePong(m.nonce, serverNow())).catch(() => {}); }
      if (m?.type === W.T_SYNC && performance.now() - s.lastSync > 1000) sendKey(s, m.reason);
    }
  })().then(() => leave('stream-end'), () => leave('stream-error'));
  s.leave = leave;
  return { s, leave };
}

async function session(incoming: Deno.QuicIncoming) {
  const conn = await incoming.accept();
  const wt = await Deno.upgradeWebTransport(conn);
  await wt.ready;
  const { value: stream } = await wt.incomingBidirectionalStreams.getReader().read();
  if (!stream) return;
  // A bundle stale by a few ticks still carries ticks its client needs (after a
  // stall here, the catch-up burst is paced out): drop only what a repair would beat.
  try { (wt.datagrams as unknown as { outgoingMaxAge: number }).outgoingMaxAge = 8 * W.TICK_MS; } catch { /* optional */ }
  try { (wt.datagrams as unknown as { incomingHighWaterMark: number }).incomingHighWaterMark = 256; } catch { /* optional */ }
  const joined = await admit({
    sr: W.bufferedReader(stream.readable.getReader()), sw: stream.writable.getWriter(), datagrams: wt.datagrams.writable.getWriter(),
    close: () => wt.close(), maxDatagram: wt.datagrams.maxDatagramSize, token: 0,
  });
  if (!joined) return;
  const { s, leave } = joined;
  // Deno doesn't settle wt.closed when Chrome closes the session, but the
  // stream ends: the client closes it on the way out.
  wt.closed.then((i) => leave('closed:' + JSON.stringify(i)), (e) => leave('closed-error:' + String(e)));
  const dr = wt.datagrams.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await dr.read();
      if (done) break;
      onInput(s, value, performance.now());
    }
  } catch (e) { leave('read-error:' + String(e)); }
  leave('read-end');
}

// The native door: a TCP connection per session for the stream, one UDP socket
// for every session's datagrams. A client's datagram carries its token; the
// address it came from is where that session's bundles go.
const natives = new Map<number, { s: Slot | null; addr: Deno.NetAddr | null }>();
let udp: Deno.DatagramConn | null = null;
async function nativeSession(conn: Deno.TcpConn) {
  conn.setNoDelay(true);
  let token = 0;
  while (!token || natives.has(token)) token = crypto.getRandomValues(new Uint32Array(1))[0];
  const route: { s: Slot | null; addr: Deno.NetAddr | null } = { s: null, addr: null };
  natives.set(token, route);
  const joined = await admit({
    sr: W.bufferedReader(conn.readable.getReader()), sw: conn.writable.getWriter(),
    datagrams: { write: (b: Uint8Array) => (route.addr && udp ? udp.send(b, route.addr) : Promise.resolve(0)) },
    close: () => { try { conn.close(); } catch { /* gone */ } }, maxDatagram: 0, token,
  }).catch(() => null);
  if (!joined) { natives.delete(token); try { conn.close(); } catch { /* gone */ } return; }
  route.s = joined.s;
}
async function nativeDatagrams(sock: Deno.DatagramConn) {
  for (;;) {
    let got: [Uint8Array, Deno.Addr];
    try { got = await sock.receive(); } catch { return; }
    const [buf, addr] = got;
    if (buf.length < 4) continue;
    const n = natives.get(new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true));
    if (!n?.s || gone(n.s)) continue;
    n.addr = addr as Deno.NetAddr;
    onInput(n.s, buf.subarray(4), performance.now());
  }
}

function summary() {
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
  const cl = sorted(stats.closeLate);
  const sl = sorted(stats.slack);
  const pct = (a: number[], p: number) => { const v = W.percentile(a, p); return v === null ? null : Number(v.toFixed(3)); };
  const slotSecs = stats.activeSlotTicks * W.TICK_MS / 1000;
  return {
    cc: stats.cc, precise, ticks: stats.ticks, activeTicks: stats.activeTicks, sessions: stats.sessions, rejected: stats.rejected,
    leaves: stats.leaves, leaveAtS: { first: Math.min(...stats.leaveAt), last: Math.max(...stats.leaveAt) },
    closeLateMs: { p50: pct(cl, 0.5), p95: pct(cl, 0.95), p99: pct(cl, 0.99), max: pct(cl, 1) },
    // closes more than a whole tick late: the event loop stalled
    stalls: cl.filter((v) => v > W.TICK_MS).length,
    stallEvents: stats.stallEvents,
    inputSlackMs: { p5: pct(sl, 0.05), p50: pct(sl, 0.5) },
    onTime: stats.onTime, substituted: stats.substituted, warmupSubstituted: stats.warmup, silentTicks: stats.silent,
    substitutedPct: stats.onTime + stats.substituted ? Number((100 * stats.substituted / (stats.onTime + stats.substituted)).toFixed(3)) : 0,
    bundlesSent: stats.bundles, bundleDatagrams: stats.sent, maxDatagramSent: stats.maxBundle, lateArrivals: stats.lateArrivals,
    bytesPerBundle: stats.bundles ? Math.round(stats.bundleBytes / stats.bundles) : 0,
    tickBytes: { mean: stats.activeTicks ? Number((stats.tickBytes / stats.activeTicks).toFixed(1)) : 0, max: stats.maxTick },
    fills: stats.fills, fillTicks: stats.fillTicks, repairs: stats.repairs, repairTicks: stats.repairTicks, pongs: stats.pongs,
    keys: stats.keys, compared: stats.compared, agreed: stats.agreed, mismatches: stats.mismatches, dumps: stats.dumps,
    refLagMax: stats.refLagMax, refErrors: stats.refErrors, refHashes: stats.refHashes, reports: stats.reports,
    downKBpsPerSession: slotSecs ? Number((stats.sentBytes / slotSecs / 1000).toFixed(2)) : 0,
    watchers: { sessions: stats.watchSessions, max: stats.watchMax, compared: stats.watchCompared, agreed: stats.watchAgreed,
      downKBpsEach: stats.watchSeconds ? Number((stats.watchBytes / stats.watchSeconds / 1000).toFixed(2)) : 0 },
    upstream: upstream ? { from: upstream, keys: up.stats.keys, bundles: up.stats.bundles, repairs: up.stats.repairs, ticks: up.stats.ticks, syncs: up.stats.syncs,
      bytes: up.stats.bytes, recordStart, rttMs: Number(up.bestRtt.toFixed(2)) } : null,
    upKBpsPerSession: slotSecs ? Number((stats.recvBytes / slotSecs / 1000).toFixed(2)) : 0,
    serverMaxDatagram: { min: Math.min(...stats.serverMaxDatagram), max: Math.max(...stats.serverMaxDatagram) },
    clientMaxDatagram: { min: Math.min(...stats.clientMaxDatagram), max: Math.max(...stats.clientMaxDatagram) },
  };
}

// An edge's way in: it watches the room on `upstream` (its native door) as a
// spectator would, a lockstep client with no sim of its own beyond the
// referee. Ticks join the record in order as they come down, and every second
// tick a bundle goes out; acks and the referee's hashes go up every 16 ms; a
// hole repairs can't fill asks upstream for a keyframe, and any keyframe after
// the first starts the record and the referee again and resyncs our spectators.
const HOLE_TICKS = 56;
// the stream's messages as readControl gives them, and the welcome
type Ctl = { type: number; reason: number; tick: number; raw: number; packed: Uint8Array; from: number; n: number; body: Uint8Array; nonce: number; serverTick: number };
type Welcome = { roomStart: number; seed: number; token: number; serverTick: number };
const up = {
  token: 0, keys: 0, seq: 0, recv: new W.Received(), parts: new W.Parts(), pending: new Map<number, Uint8Array[]>(),
  sBase: 0, sEpoch: 0, bestRtt: Infinity, pingAt: [] as number[], filling: false, syncAt: -1e9,
  report: null as null | { interval: number; hash: bigint; left: number },
  stats: { keys: [] as Record<string, number>[], bundles: 0, repairs: 0, ticks: 0, syncs: 0, bytes: 0 },
};
function offerUp(t: number, parts: Uint8Array[]) {
  if (recordStart < 0 || t < recordStart + record.length) return;
  up.pending.set(t, parts);
  for (let next = recordStart + record.length; up.pending.has(next); next++) {
    record.push(up.pending.get(next)!);
    toReferee.push(up.pending.get(next)!);
    up.pending.delete(next);
    up.stats.ticks++;
    closed = next;
    if (next % W.SEND_EVERY === W.SEND_EVERY - 1) broadcast(next);
  }
}
async function watchUpstream() {
  const [host, port] = upstream.split(':');
  const conn = await Deno.connect({ hostname: host, port: Number(port), transport: 'tcp' });
  conn.setNoDelay(true);
  const sock = Deno.listenDatagram({ hostname: '0.0.0.0', port: 0, transport: 'udp' });
  const to: Deno.NetAddr = { transport: 'udp', hostname: host, port: Number(port) };
  const sw = conn.writable.getWriter();
  const sr = W.bufferedReader(conn.readable.getReader());
  await sw.write(W.encodeHello({ maxDatagram: 1400, wasmPrefix: prefix, watch: true }));
  const head = await sr.read(4);
  if (head[0] === W.T_REJECT) throw new Error(`upstream refused us: reason ${head[1]}`);
  const wb = new Uint8Array(32);
  wb.set(head, 0);
  wb.set(await sr.read(28), 4);
  const w = W.decodeWelcome(wb) as Welcome;
  roomStart = w.roomStart;
  roomSeed = w.seed;
  up.token = w.token;
  up.sBase = w.serverTick + 0.5;
  up.sEpoch = performance.now();
  serverNow = () => up.sBase + (performance.now() - up.sEpoch) / W.TICK_MS;
  const send = (m: Uint8Array) => {
    const d = new Uint8Array(4 + m.length);
    new DataView(d.buffer).setUint32(0, up.token >>> 0, true);
    d.set(m, 4);
    sock.send(d, to).catch(() => {});
  };
  send(W.encodeInput({ seq: up.seq++, firstTick: 0, ackTick: 0, ackBits: 0n, words: [] }));
  for (let k = 0; k < 5; k++) setTimeout(() => { up.pingAt[k] = performance.now(); sw.write(W.encodePing(k)).catch(() => {}); }, 50 * k);
  setInterval(() => {
    const r = up.report && up.report.left > 0 ? up.report : null;
    if (r) r.left--;
    send(W.encodeInput({ seq: up.seq++, firstTick: 0, ...up.recv.ack(), words: [], report: r ? { interval: r.interval, epoch: up.keys, hash: r.hash } : null }));
    const next = recordStart + record.length, now = performance.now();
    if (recordStart >= 0 && !up.filling && !up.pending.has(next) && up.recv.newest - next >= HOLE_TICKS && now - up.syncAt > 1500) {
      up.syncAt = now;
      up.stats.syncs++;
      sw.write(W.encodeSync(W.SYNC.HOLE, next)).catch(() => {});
    }
  }, 16);
  (async () => {
    for (;;) {
      let buf: Uint8Array;
      try { [buf] = await sock.receive(); } catch { return; }
      const d = W.decodeTicks(buf);
      if (!d) continue;
      up.stats.bytes += buf.length;
      if (d.type === W.T_BUNDLE) up.stats.bundles++; else up.stats.repairs++;
      for (const e of d.entries) {
        const whole = up.parts.add(e);
        if (!whole || !up.recv.add(e.tick)) continue;
        offerUp(e.tick, whole);
      }
      up.parts.forget(up.recv.newest - 512);
    }
  })();
  for (;;) {
    const m = (await W.readControl(sr)) as Ctl | null;
    if (!m) break;
    if (m.type === W.T_PONG) {
      const rtt = performance.now() - up.pingAt[m.nonce];
      if (rtt < up.bestRtt) { up.bestRtt = rtt; up.sBase = m.serverTick + rtt / 2 / W.TICK_MS; up.sEpoch = performance.now(); }
    }
    if (m.type === W.T_KEY) {
      up.keys++;
      const region = m.raw ? await W.unpackKey(m.packed) : null;
      up.stats.keys.push({ reason: m.reason, simTick: m.tick - roomStart, raw: m.raw ? 1 : 0 });
      log(`upstream keyframe: reason ${m.reason}, tick ${m.tick}`);
      const again = recordStart >= 0;
      up.pending.clear();
      closed = m.tick - 1;
      startRecord(m.tick, region);
      up.filling = true;
      // our spectators' ticks start over too
      if (again) for (const s of watchers) { s.syncing = false; s.fromTick = Infinity; sendKey(s, W.SYNC.HOLE); }
    }
    if (m.type === W.T_FILL) {
      for (const t of W.decodeFillBody(m.from, m.n, m.body)) { up.recv.add(t.tick); offerUp(t.tick, t.parts); }
      up.filling = false;
    }
  }
  console.error('relay: the upstream relay closed the connection');
  await finish();
}

const endpoint = new Deno.QuicEndpoint({ hostname, port });
const listener = endpoint.listen({ cert, key, alpnProtocols: ['h3'], congestionControl: cc });
(async () => { for await (const incoming of listener) session(incoming).catch(() => {}); })();
if (nativePort) {
  udp = Deno.listenDatagram({ hostname, port: nativePort, transport: 'udp' });
  nativeDatagrams(udp);
  const tcp = Deno.listen({ hostname, port: nativePort, transport: 'tcp' });
  (async () => { for await (const conn of tcp) nativeSession(conn).catch(() => {}); })();
}
if (upstream) watchUpstream().catch((e) => { console.error('relay: upstream: ' + (e?.message || e)); Deno.exit(1); });
else pump();
if (!quiet) console.error(`relay listening on https://${hostname}:${port}/ (${cc})${nativePort ? `, native clients on ${hostname}:${nativePort} (TCP and UDP)` : ''}, tick ${W.TICK_MS} ms`);

async function finish() {
  const text = JSON.stringify(summary());
  if (summaryPath) await Deno.writeTextFile(summaryPath, text + '\n');
  else console.log(text);
  Deno.exit(0);
}
// a runner that stops the relay early still gets the summary
if (summaryPath) Deno.addSignalListener('SIGTERM', finish);
if (durationS > 0) {
  await new Promise((ok) => setTimeout(ok, durationS * 1000));
  await finish();
}
