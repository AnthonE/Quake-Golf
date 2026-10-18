// The relay: one isolate owns the QUIC endpoint, the 8 ms clock and the
// bundles. Deadlines run from a fixed epoch; an input counts only if it was
// read before its tick's deadline, so a late timer adds latency, never unfairness.
// Bundles go out first, every second tick, four ticks deep, with a
// per-recipient trailer. Every closed tick is also recorded from the room's
// start and handed to the referee (net/referee-worker.mjs), a Worker stepping
// the same game.wasm: it is the truth for interval hashes and keyframes. A
// joiner gets the newest keyframe and the record since; a tick a client's
// acks lack comes back in a repair datagram; a hash a client reports that
// differs from the referee's, a hole too old to repair, or a client far
// behind gets a resync from a keyframe. A room that empties starts over on a new seed.
//
//   .tools/deno run --unstable-net -A net/relay.ts [--port 4433] [--native-port 4434] [--duration 70] [--cc low-latency|default] [--seed N] [--host 127.0.0.1]
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
const rows = Array.from({ length: W.RING }, () => new Uint32Array(W.NP));
let events: { slot: number; kind: number; tick: number }[] = [];
// The room: its sim began at roomStart (-1 while nobody is in it) on roomSeed,
// and record[T - roomStart] is closed tick T as a fill carries it.
let roomStart = -1;
let roomSeed = newSeed();
let record: Uint8Array[] = [];
const stats = {
  ticks: 0, closeLate: [] as number[], stallEvents: [] as number[][], sent: 0, sentBytes: 0, maxBundle: 0, oversize: 0, lateArrivals: 0,
  recv: 0, recvBytes: 0, onTime: 0, substituted: 0, sessions: 0, rejected: 0, slack: [] as number[], activeTicks: 0, activeSlotTicks: 0, silent: 0, warmup: 0,
  leaves: {} as Record<string, number>, leaveAt: [] as number[],
  serverMaxDatagram: [] as number[], clientMaxDatagram: [] as number[], cc, fills: 0, fillTicks: 0,
  repairs: 0, repairTicks: 0, pongs: 0, keys: [] as Record<string, number>[], compared: 0, agreed: 0,
  mismatches: [] as Record<string, unknown>[], dumps: [] as string[], refLagMax: 0, refErrors: [] as string[],
  refHashes: [] as [number, string][], reports: {} as Record<number, [number, string][]>,
};

// The referee: closed ticks go to it in batches; interval hashes and packed keyframes come back.
const referee = new Worker(new URL('./referee-worker.mjs', import.meta.url).href, { type: 'module' });
referee.postMessage({ wasm });
let toReferee: Uint8Array[] = [];
const refIntervals = new Map<number, { hash: bigint; digests: Uint8Array }>(); // sim tick -> the referee's
let keyId = 0;
const keyWaiters = new Map<number, (k: { tick: number; raw: number; packed: Uint8Array }) => void>();
referee.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.error) { stats.refErrors.push(m.error); console.error('referee: ' + m.error); return; }
  if (m.room !== roomStart) return;
  if (m.key) { keyWaiters.get(m.key.id)?.(m.key); keyWaiters.delete(m.key.id); }
  if (m.intervals) {
    for (const iv of m.intervals) {
      refIntervals.set(iv.tick, iv);
      stats.refHashes.push([iv.tick, iv.hash.toString(16)]);
      for (const s of slots) if (s) check(s, iv.tick);
    }
    for (const t of refIntervals.keys()) if (t < m.at - 16 * 128) refIntervals.delete(t);
    stats.refLagMax = Math.max(stats.refLagMax, closed - roomStart - m.at);
  }
};
function startRoom(start: number) {
  roomStart = start;
  record = [];
  toReferee = [];
  refIntervals.clear();
  referee.postMessage({ reset: { room: start, seed: roomSeed } });
}
// The referee's newest keyframe; if it doesn't answer in 5 s, the room's start (raw 0: the client inits from the seed).
function keyframe(): Promise<{ tick: number; raw: number; packed: Uint8Array }> {
  const id = ++keyId;
  return new Promise((ok) => {
    keyWaiters.set(id, ok);
    referee.postMessage({ room: roomStart, want: id });
    setTimeout(() => { if (keyWaiters.delete(id)) ok({ tick: 0, raw: 0, packed: new Uint8Array(0) }); }, 5000);
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
  log(`key for slot ${s.slot} asked: reason ${reason}`);
  const k = await keyframe();
  if (room !== roomStart || slots[s.slot] !== s) { log(`key for slot ${s.slot} dropped: room ${room} now ${roomStart}`); s.syncing = false; return; }
  const tick = room + k.tick;
  const to = closed + 1;
  const ticks = record.slice(k.tick, Math.max(k.tick, to - room));
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
  if (ref.hash === h) { stats.agreed++; return; }
  const now = performance.now();
  stats.mismatches.push({ slot: s.slot, interval, at: Number(((now - E) / 1000).toFixed(2)), client: h.toString(16), referee: ref.hash.toString(16) });
  if (stats.dumps.length < 4) {
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
  if (roomStart < 0 || s.fromTick > closed) return;
  const due = W.holes(ackTick, ackBits, Math.max(s.fromTick, roomStart)).filter((t: number) => {
    if (t > closed) return false;
    const i = t & (W.RING - 1);
    return s.repairTick[i] !== t || now - s.repairAt[i] >= REPAIR_MS;
  });
  let sent = 0;
  for (let k = 0; k < due.length && sent < 4;) {
    let e = k + 1;
    while (e < due.length && due[e] === due[e - 1] + 1) e++;
    const from = due[k];
    const { buf, n } = W.encodeRepair(from, record.slice(from - roomStart, due[e - 1] + 1 - roomStart), Math.min(W.MAX_DATAGRAM, s.maxDatagram));
    if (!n) break;
    for (let t = from; t < from + n; t++) { s.repairTick[t & (W.RING - 1)] = t; s.repairAt[t & (W.RING - 1)] = now; }
    s.writer.write(buf).catch(() => {});
    stats.repairs++;
    stats.repairTicks += n;
    sent++;
    k += n;
  }
}

function freeSlot() { return slots.findIndex((s) => s === null); }

// At most 8 join/leave events per tick, so four ticks of events (+64 B) keep
// a bundle inside the 1,161 B budget even when a whole room joins at once.
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
    (stats.reports[s.slot] ||= []).push([r.interval, r.hash.toString(16)]);
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
  const row = rows[T & (W.RING - 1)];
  row.fill(0);
  const dl = deadline(T);
  let active = 0;
  const words: [number, number][] = [];
  for (let p = 0; p < W.NP; p++) {
    const s = slots[p];
    if (!s || T < s.joinTick) continue;
    if (T >= s.leaveTick) { stats.silent += s.pendingLate; slots[p] = null; continue; }
    words.push([p, 0]);
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
  for (const w of words) w[1] = row[w[0]];
  if (roomStart >= 0 && T >= roomStart) {
    const tick = W.encodeTick(events.filter((e) => e.tick === T), words);
    record.push(tick);
    toReferee.push(tick);
    // the last one out: the next joiner starts a new room
    if (!slots.some((x) => x)) { roomStart = -1; record = []; toReferee = []; roomSeed = newSeed(); }
  }
  closed = T;
  if (T % W.SEND_EVERY === W.SEND_EVERY - 1) broadcast(T);
}

function broadcast(T: number) {
  if (toReferee.length) { referee.postMessage({ room: roomStart, ticks: toReferee }); toReferee = []; }
  const r = [0, 1, 2, 3].map((k) => rows[(T - k) & (W.RING - 1)]);
  events = events.filter((e) => e.tick > T - W.NB - 4);
  for (const t of eventsAt.keys()) if (t <= T - W.NB) eventsAt.delete(t);
  const evs = events.filter((e) => e.tick <= T && e.tick > T - W.NB);
  // the body is the same for everyone: encode it once, then copy and stamp each trailer
  const body = W.encodeBundle({ T, rows: r, events: evs, inAck: 0, slack: 0, late: 0 });
  for (const s of slots) {
    if (!s) continue;
    // the worst slack since the last bundle, late arrivals included, so the
    // client's lead controller reacts to lateness it would otherwise never see
    const slack = Number.isFinite(s.periodSlack) ? s.periodSlack : s.lastSlack;
    s.periodSlack = Infinity;
    const buf = W.stampTrailer(body.slice(), { inAck: s.contig, slack, late: s.late });
    if (buf.length > Math.min(W.MAX_DATAGRAM, s.maxDatagram)) { stats.oversize++; continue; }
    stats.maxBundle = Math.max(stats.maxBundle, buf.length);
    stats.sent++;
    stats.sentBytes += buf.length;
    s.writer.write(buf).catch(() => { /* Deno resolves datagram writes; failures show up as closes */ });
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
  const p = freeSlot();
  let reason = 0;
  if (!hello || hello.proto !== W.PROTO) reason = W.REJECT.PROTO;
  else if (hello.wasmPrefix.some((b: number, i: number) => b !== prefix[i])) reason = W.REJECT.WASM;
  else if (p < 0) reason = W.REJECT.FULL;
  if (reason) {
    stats.rejected++;
    await d.sw.write(W.encodeReject(reason)).catch(() => {});
    await d.sw.close().catch(() => {});
    return null;
  }
  const maxDatagram = d.maxDatagram || Math.min(W.MAX_DATAGRAM, hello!.maxDatagram);
  stats.serverMaxDatagram.push(maxDatagram);
  stats.clientMaxDatagram.push(hello!.maxDatagram);
  const joinTick = scheduleEvent(p, W.EV_JOIN, closed + 1 + 4);
  if (roomStart < 0) startRoom(joinTick);
  const s: Slot = {
    slot: p, joinTick, leaveTick: Infinity, writer: d.datagrams as WritableStreamDefaultWriter<Uint8Array>, ctl: d.sw, maxDatagram,
    last: 0, missing: 0, late: 0, lastSlack: 0, periodSlack: Infinity, contig: joinTick - 1, lastRecv: performance.now(), pendingLate: 0, close: d.close,
    words: new Uint32Array(W.RING), wordTick: new Int32Array(W.RING).fill(-1), arrival: new Float64Array(W.RING),
    fromTick: Infinity, repairTick: new Int32Array(W.RING).fill(-1), repairAt: new Float64Array(W.RING),
    keys: 0, syncing: false, lastSync: -1e9, lastDesync: -1e9, lastReport: -1, reports: new Map(), token: d.token,
  };
  slots[p] = s;
  stats.sessions++;
  await d.sw.write(W.encodeWelcome({ slot: p, maxDatagram, joinTick, seed: roomSeed, serverTick: closed + 1, roomStart, token: d.token }));
  log(`slot ${p} joins at ${joinTick}, room ${roomStart}${d.token ? ' (native)' : ''}`);
  sendKey(s, W.SYNC.JOIN);
  const leave = (why: string) => {
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
      if (m?.type === W.T_PING) { stats.pongs++; s.ctl.write(W.encodePong(m.nonce, (performance.now() - E) / W.TICK_MS)).catch(() => {}); }
      if (m?.type === W.T_SYNC && performance.now() - s.lastSync > 1000) sendKey(s, m.reason);
    }
  })().then(() => leave('stream-end'), () => leave('stream-error'));
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
    if (!n?.s || slots[n.s.slot] !== n.s) continue;
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
    bundlesSent: stats.sent, maxBundle: stats.maxBundle, oversize: stats.oversize, lateArrivals: stats.lateArrivals,
    fills: stats.fills, fillTicks: stats.fillTicks, repairs: stats.repairs, repairTicks: stats.repairTicks, pongs: stats.pongs,
    keys: stats.keys, compared: stats.compared, agreed: stats.agreed, mismatches: stats.mismatches, dumps: stats.dumps,
    refLagMax: stats.refLagMax, refErrors: stats.refErrors, refHashes: stats.refHashes, reports: stats.reports,
    downKBpsPerSession: slotSecs ? Number((stats.sentBytes / slotSecs / 1000).toFixed(2)) : 0,
    upKBpsPerSession: slotSecs ? Number((stats.recvBytes / slotSecs / 1000).toFixed(2)) : 0,
    serverMaxDatagram: { min: Math.min(...stats.serverMaxDatagram), max: Math.max(...stats.serverMaxDatagram) },
    clientMaxDatagram: { min: Math.min(...stats.clientMaxDatagram), max: Math.max(...stats.clientMaxDatagram) },
  };
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
pump();
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
