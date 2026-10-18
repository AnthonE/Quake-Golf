// The M0 relay: one isolate owns the QUIC endpoint, the 8 ms clock and the
// bundles. Deadlines run from a fixed epoch; an input counts only if it was
// read before its tick's deadline, so a late timer adds latency, never unfairness.
// Bundles go out first, every second tick, four ticks deep, with a
// per-recipient trailer.
//
//   .tools/deno run --unstable-net -A net/relay.ts [--port 4433] [--duration 70] [--cc low-latency|default]
// Clients are Chrome (net/run-m0.mjs hosts the bots there): Deno's WebTransport
// client always binds an IPv6 socket, which hosts without IPv6 refuse.
import * as W from './wire.mjs';

const argv = Deno.args;
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const port = Number(opt('port', '4433'));
const durationS = Number(opt('duration', '0'));
const cc = opt('cc', 'low-latency') as 'low-latency' | 'default' | 'throughput';
// Deno timers overshoot by a millisecond or two. Precise mode arms the timer
// early, then yields through a MessageChannel until the deadline, so datagram
// reads keep flowing while it waits.
const precise = opt('precise', '1') !== '0';
const EARLY_MS = 1.5;
const quiet = argv.includes('--quiet');

const cert = await Deno.readTextFile('certs/cert.pem');
const key = await Deno.readTextFile('certs/key.pem');
const prefix = await W.wasmPrefix(await Deno.readFile('build/game.wasm'));

type Slot = {
  slot: number; joinTick: number; leaveTick: number; writer: WritableStreamDefaultWriter<Uint8Array>;
  maxDatagram: number; last: number; missing: number; late: number; lastSlack: number; periodSlack: number; contig: number; lastRecv: number; pendingLate: number; close: () => void;
  words: Uint32Array; wordTick: Int32Array; arrival: Float64Array;
};

const E = performance.now();
const deadline = (t: number) => E + W.TICK_MS * (t + 1);
let closed = -1;
const slots: (Slot | null)[] = new Array(W.NP).fill(null);
const rows = Array.from({ length: W.RING }, () => new Uint32Array(W.NP));
let events: { slot: number; kind: number; tick: number }[] = [];
const stats = {
  ticks: 0, closeLate: [] as number[], sent: 0, sentBytes: 0, maxBundle: 0, oversize: 0, lateArrivals: 0,
  recv: 0, recvBytes: 0, onTime: 0, substituted: 0, sessions: 0, rejected: 0, slack: [] as number[], activeTicks: 0, activeSlotTicks: 0, silent: 0, warmup: 0,
  leaves: {} as Record<string, number>, leaveAt: [] as number[],
  serverMaxDatagram: [] as number[], clientMaxDatagram: [] as number[], cc,
};

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

// No input for this long and the player has left, whatever QUIC says.
const SILENT_MS = 2000;
// The first half second after a join, while the client's lead converges (F10's cold start).
const WARMUP = 64;

function onInput(s: Slot, buf: Uint8Array, now: number) {
  s.lastRecv = now;
  stats.recv++;
  stats.recvBytes += buf.length;
  const m = W.decodeInput(buf);
  if (!m) return;
  for (let k = 0; k < m.words.length; k++) {
    const t = m.firstTick + k;
    if (t < s.joinTick || t > closed + W.RING - 8) continue;
    const i = t & (W.RING - 1);
    if (t <= closed) {
      // Too late for its tick. Still feed it back, as negative slack, so the
      // client's lead controller sees the lateness and grows its lead.
      if (s.wordTick[i] !== t) { s.periodSlack = Math.min(s.periodSlack, deadline(t) - now); stats.lateArrivals++; }
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
  for (let p = 0; p < W.NP; p++) {
    const s = slots[p];
    if (!s || T < s.joinTick) continue;
    if (T >= s.leaveTick) { stats.silent += s.pendingLate; slots[p] = null; continue; }
    if (s.leaveTick === Infinity && now - s.lastRecv > SILENT_MS) {
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
      if (s.wordTick[i] === T) s.periodSlack = Math.min(s.periodSlack, dl - s.arrival[i]);
    }
  }
  if (active) { stats.activeTicks++; stats.activeSlotTicks += active; }
  closed = T;
  if (T % W.SEND_EVERY === W.SEND_EVERY - 1) broadcast(T);
}

function broadcast(T: number) {
  const r = [0, 1, 2, 3].map((k) => rows[(T - k) & (W.RING - 1)]);
  events = events.filter((e) => e.tick > T - W.NB - 4);
  for (const t of eventsAt.keys()) if (t <= T - W.NB) eventsAt.delete(t);
  const evs = events.filter((e) => e.tick <= T && e.tick > T - W.NB);
  for (const s of slots) {
    if (!s) continue;
    // the worst slack since the last bundle, late arrivals included, so the
    // client's lead controller reacts to lateness it would otherwise never see
    const slack = Number.isFinite(s.periodSlack) ? s.periodSlack : s.lastSlack;
    s.periodSlack = Infinity;
    const buf = W.encodeBundle({ T, rows: r, events: evs, inAck: s.contig, slack, late: s.late });
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
  while (deadline(closed + 1) <= now) closeTick(closed + 1, now);
  const wait = deadline(closed + 1) - performance.now();
  if (!precise) setTimeout(pump, Math.max(0, wait));
  else if (wait > EARLY_MS) setTimeout(pump, wait - EARLY_MS);
  else channel.port2.postMessage(0);
}

async function session(incoming: Deno.QuicIncoming) {
  const conn = await incoming.accept();
  const wt = await Deno.upgradeWebTransport(conn);
  await wt.ready;
  const { value: stream } = await wt.incomingBidirectionalStreams.getReader().read();
  if (!stream) return;
  const sr = W.bufferedReader(stream.readable.getReader());
  const sw = stream.writable.getWriter();
  const hello = W.decodeHello(await sr.read(24));
  const p = freeSlot();
  let reason = 0;
  if (!hello || hello.proto !== W.PROTO) reason = W.REJECT.PROTO;
  else if (hello.wasmPrefix.some((b: number, i: number) => b !== prefix[i])) reason = W.REJECT.WASM;
  else if (p < 0) reason = W.REJECT.FULL;
  if (reason) {
    stats.rejected++;
    await sw.write(W.encodeReject(reason));
    await sw.close();
    return;
  }
  const maxDatagram = wt.datagrams.maxDatagramSize;
  try { (wt.datagrams as unknown as { outgoingMaxAge: number }).outgoingMaxAge = 2 * W.TICK_MS; } catch { /* optional */ }
  stats.serverMaxDatagram.push(maxDatagram);
  stats.clientMaxDatagram.push(hello!.maxDatagram);
  const joinTick = scheduleEvent(p, W.EV_JOIN, closed + 1 + 4);
  const s: Slot = {
    slot: p, joinTick, leaveTick: Infinity, writer: wt.datagrams.writable.getWriter(), maxDatagram,
    last: 0, missing: 0, late: 0, lastSlack: 0, periodSlack: Infinity, contig: joinTick - 1, lastRecv: performance.now(), pendingLate: 0, close: () => wt.close(),
    words: new Uint32Array(W.RING), wordTick: new Int32Array(W.RING).fill(-1), arrival: new Float64Array(W.RING),
  };
  slots[p] = s;
  stats.sessions++;
  await sw.write(W.encodeWelcome({ slot: p, maxDatagram, joinTick, seed: 7, serverTick: closed + 1 }));
  const leave = (why: string) => {
    if (s.leaveTick !== Infinity) return;
    stats.leaves[why] = (stats.leaves[why] || 0) + 1;
    stats.leaveAt.push(Number(((performance.now() - E) / 1000).toFixed(2)));
    s.leaveTick = scheduleEvent(p, W.EV_LEAVE, Math.max(closed + 1, s.joinTick));
  };
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
    inputSlackMs: { p5: pct(sl, 0.05), p50: pct(sl, 0.5) },
    onTime: stats.onTime, substituted: stats.substituted, warmupSubstituted: stats.warmup, silentTicks: stats.silent,
    substitutedPct: stats.onTime + stats.substituted ? Number((100 * stats.substituted / (stats.onTime + stats.substituted)).toFixed(3)) : 0,
    bundlesSent: stats.sent, maxBundle: stats.maxBundle, oversize: stats.oversize, lateArrivals: stats.lateArrivals,
    downKBpsPerSession: slotSecs ? Number((stats.sentBytes / slotSecs / 1000).toFixed(2)) : 0,
    upKBpsPerSession: slotSecs ? Number((stats.recvBytes / slotSecs / 1000).toFixed(2)) : 0,
    serverMaxDatagram: { min: Math.min(...stats.serverMaxDatagram), max: Math.max(...stats.serverMaxDatagram) },
    clientMaxDatagram: { min: Math.min(...stats.clientMaxDatagram), max: Math.max(...stats.clientMaxDatagram) },
  };
}

const endpoint = new Deno.QuicEndpoint({ hostname: '127.0.0.1', port });
const listener = endpoint.listen({ cert, key, alpnProtocols: ['h3'], congestionControl: cc });
(async () => { for await (const incoming of listener) session(incoming).catch(() => {}); })();
pump();
if (!quiet) console.error(`relay listening on https://127.0.0.1:${port}/ (${cc}), tick ${W.TICK_MS} ms`);

if (durationS > 0) {
  await new Promise((ok) => setTimeout(ok, durationS * 1000));
  console.log(JSON.stringify(summary()));
  Deno.exit(0);
}
