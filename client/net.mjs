// The net worker: owns the WebTransport session and the clocks. Every tick of
// the predicted clock (the server's tick plus the input lead) it samples the
// input slots in shared memory into one word, kept in a ring the prediction
// reads; every second tick it sends the words the relay hasn't closed, its
// per-tick acks and the newest interval hash. Closed ticks from bundles,
// repairs and fills go to the sim worker still coded, once all their parts
// are in; keyframes go unpacked. It keeps
// the playout clock: the earliest arrival less 2 ticks and the p95 jitter of
// first arrivals, run up to 3% fast or slow to stay on that target.
// ?url= may list several relays: when the session's relay goes away, it tries
// the next, a few times a second for up to 10 s, asking for its slot back (a
// resume), which a standby relay that took the room over holds for it.
import * as W from '../net/wire.mjs';
import * as L from '../src/layout.mjs';
import { createImpair } from '../net/impair.js';
import { writeClock, readClock } from './clock.mjs';
import { arenaWord, arenaFrame, frameDue } from '../src/arena-view.mjs';

const epoch = () => performance.timeOrigin + performance.now();

let leave = () => {};
let leaving = false;
self.onmessage = (e) => {
  if (e.data.leave) { leaving = true; leave(); return; }
  connect(e.data);
};

const FAILOVER_MS = 10000;
async function connect(args) {
  const urls = args.url.split(',');
  let k = 0, back = null, lostAt = -1;
  for (;;) {
    try {
      back = await run({ ...args, url: urls[k], back, failover: urls.length > 1 });
      lostAt = epoch();
    } catch (err) {
      // a relay that's down, or not holding the room yet, mid-failover: the next
      if (!back || epoch() - lostAt > FAILOVER_MS) {
        Atomics.store(new Int32Array(args.memory.buffer), L.CL_STATE >> 2, 3);
        self.postMessage({ error: String(err?.stack || err) });
        return;
      }
    }
    if (leaving || urls.length < 2 || epoch() - lostAt > FAILOVER_MS) break;
    k = (k + 1) % urls.length;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  Atomics.store(new Int32Array(args.memory.buffer), L.CL_STATE >> 2, 3);
  self.postMessage({ closed: true });
}

// p-th fraction of a list of numbers
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// impair: { delay, jitter, loss } on this client's own datagrams, both ways (?impair=)
// watch: a spectator, with no slot and no words to send; back: { slot, room }
// of a session that went away, to resume. Returns this session's, once it ends.
// failover: a relay silent for SILENT_MS is gone (a dead one's QUIC session would idle for far longer)
const SILENT_MS = 1500;
// arena: the arena's input words (src/layout.mjs), with its frames
async function run({ url, certHash, memory, prefix, simPort, impair = {}, watch = false, back = null, failover = false, arena = false }) {
  const imp = createImpair({ ...impair, seed: (Math.random() * 2 ** 32) >>> 0 });
  const i32 = new Int32Array(memory.buffer);
  const u32 = new Uint32Array(memory.buffer);
  const f32 = new Float32Array(memory.buffer);
  const f64 = new Float64Array(memory.buffer);
  const rd = (a) => Atomics.load(i32, a >> 2);
  Atomics.store(i32, L.CL_SLOT >> 2, -1);

  const wt = new WebTransport(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: certHash }], congestionControl: 'low-latency' });
  await wt.ready;
  try { wt.datagrams.outgoingMaxAge = 2 * W.TICK_MS; } catch { /* optional */ }
  // a busy moment on this worker must not drop bundles queued for it
  try { wt.datagrams.incomingHighWaterMark = 256; } catch { /* optional */ }
  const bidi = await wt.createBidirectionalStream();
  const sw = bidi.writable.getWriter();
  const tHello = epoch();
  const resume = back && !watch ? back.slot : -1;
  await sw.write(W.encodeHello({ maxDatagram: wt.datagrams.maxDatagramSize, wasmPrefix: prefix, nonce: (Math.random() * 2 ** 32) >>> 0, watch, room: back?.room ?? 0, resume }));
  const sr = W.bufferedReader(bidi.readable.getReader());
  const head = await sr.read(4);
  if (head[0] === W.T_REJECT) throw new Error(['', 'game.wasm differs from the server\'s: reload', 'the room is full', 'protocol mismatch', 'this relay only has a room to watch', 'nothing to watch yet'][head[1]] || 'rejected');
  const wb = new Uint8Array(32);
  wb.set(head, 0);
  wb.set(await sr.read(28), 4);
  const welcome = W.decodeWelcome(wb);
  const t0 = epoch();
  // The server's tick: from the welcome (sent mid-tick, half the handshake's
  // round trip ago) until the pings refine it with their fastest round trip.
  let sBase = welcome.serverTick + 0.5 + (t0 - tHello) / 2 / W.TICK_MS, sEpoch = t0, bestRtt = t0 - tHello;
  const serverTick = (now) => sBase + (now - sEpoch) / W.TICK_MS;
  // Inputs for tick t must reach the relay before t closes, a send interval
  // early so a lost datagram's repeat still does: a one-way trip, plus margin.
  let lead = bestRtt / 2 / W.TICK_MS + W.SEND_EVERY + 1;
  const publishPred = (now) => { writeClock(i32, f64, L.CL_PRED, serverTick(now) + lead, now); f32[L.CL_LEAD >> 2] = lead; };
  Atomics.store(i32, L.CL_ROOM >> 2, welcome.roomStart);
  Atomics.store(i32, L.CL_SLOT >> 2, welcome.slot);
  Atomics.store(i32, L.CL_NEXT >> 2, welcome.joinTick);
  writeClock(i32, f64, L.CL_PLAY, welcome.serverTick - 8, t0);
  publishPred(t0);
  simPort.postMessage({ welcome });
  self.postMessage({ welcome });
  // closing the control stream is how the relay hears we left
  let left = false;
  leave = async () => {
    if (left) return;
    left = true;
    try { await sw.close(); } catch { /* gone */ }
    try { wt.close(); } catch { /* gone */ }
  };

  // Five pings at join, the countdown's clock sync: the fastest sets the server tick.
  const pings = new Map();
  for (let k = 0; k < 5; k++) setTimeout(() => { pings.set(k, epoch()); sw.write(W.encodePing(k)).catch(() => {}); }, 50 * k);
  const onPong = (m) => {
    const now = epoch();
    const rtt = now - pings.get(m.nonce);
    if (!(rtt < bestRtt)) return;
    bestRtt = rtt;
    sBase = m.serverTick + rtt / 2 / W.TICK_MS;
    sEpoch = now;
    lead = rtt / 2 / W.TICK_MS + W.SEND_EVERY + 1;
    publishPred(now);
  };

  // what this worker has seen, for the runs
  const seen = { pongs: 0, keys: 0, fills: 0, bundles: 0, repairs: 0, rtt: bestRtt, ctlError: '', holes: [], gaps: [] };
  const repairedAt = new Map(); // tick -> repair datagrams that carried it, the last 512 ticks
  const seenTimer = setInterval(() => self.postMessage({ seen: { ...seen, rtt: bestRtt, lead } }), 1000);
  // The control stream: keyframes (unpacked here), the fills after them, pongs.
  const recv = new W.Received();
  const parts = new W.Parts(); // ticks that came in parts, until each is whole
  let report = null; // the newest interval hash, sent on the next 8 datagrams
  simPort.onmessage = (e) => {
    if (e.data.sync) {
      sw.write(W.encodeSync(...e.data.sync)).catch(() => {});
      // for the runs: had this worker heard the tick the sim worker lacks?
      const t = e.data.sync[1];
      seen.holes.push({ tick: t, heard: recv.has(t), newest: recv.newest, repairsForIt: repairedAt.get(t) ?? null });
    }
    if (e.data.report) report = { ...e.data.report, hash: BigInt('0x' + e.data.report.hash), left: 8 };
  };
  (async () => {
    for (;;) {
      const m = await W.readControl(sr);
      if (!m) break;
      if (m.type === W.T_PONG) { seen.pongs++; onPong(m); }
      if (m.type === W.T_KEY) {
        seen.keys++;
        Atomics.add(i32, L.CL_RX_STREAM >> 2, 16 + m.packed.length + (m.digests ? 1032 : 0));
        const region = m.raw ? await W.unpackKey(m.packed) : null;
        simPort.postMessage({ key: { tick: m.tick, reason: m.reason, region, interval: m.interval, digests: m.digests } }, region ? [region.buffer] : []);
      }
      if (m.type === W.T_FILL) {
        seen.fills++;
        Atomics.add(i32, L.CL_RX_STREAM >> 2, 16 + m.body.length);
        const ticks = W.decodeFillBody(m.from, m.n, m.body).map((t) => ({ t: t.tick, parts: t.parts }));
        for (const t of ticks) if (recv.add(t.t)) Atomics.add(i32, L.CL_HEARD >> 2, 1);
        simPort.postMessage({ ticks, fill: true });
      }
    }
  })().catch((err) => { seen.ctlError = String(err?.message || err); });

  // Inputs: one word a tick from joinTick on, as the predicted clock passes it.
  const words = new Map();
  let nextTick = welcome.joinTick;
  let lastSent = nextTick;
  let sentPresses = rd(L.CL_PRESSES);
  Atomics.store(i32, L.CL_SENT >> 2, sentPresses);
  let inAck = 0, lastBundleT = -1, seq = 0;
  let lastMove = -1;
  // the arena's: presses sampled, a bit flipping per press; the frame, latched every 8 ticks
  const sent = { [L.CL_MELEE]: rd(L.CL_MELEE), [L.CL_GREN]: rd(L.CL_GREN), [L.CL_RELOAD]: rd(L.CL_RELOAD), [L.CL_USE]: rd(L.CL_USE) };
  let frame = 0;
  const lastFrame = {}; // the last frame sent: its lag and tick
  const take = (a) => { if (((rd(a) - sent[a]) | 0) > 0) { sent[a]++; return true; } return false; };
  const sample = (t) => {
    // an automatic held: a shot asked for every tick, so it fires as fast as it can
    if (arena && rd(L.CL_AUTO) && ((rd(L.CL_PRESSES) - sentPresses) | 0) <= 0) Atomics.store(i32, L.CL_PRESSES >> 2, sentPresses + 1);
    // a press advances the counter one step a tick, so quick clicks never merge
    if (((rd(L.CL_PRESSES) - sentPresses) | 0) > 0) sentPresses++;
    Atomics.store(i32, L.CL_SENT >> 2, sentPresses);
    const mv = rd(L.CL_MOVE);
    // the first tick with new move bits, and when they changed, for the latency figures
    if ((mv & 15) !== lastMove) { lastMove = mv & 15; f64[L.CL_MOVESEEN >> 3] = f64[L.CL_MOVEAT >> 3]; Atomics.store(i32, L.CL_MOVETICK >> 2, t); }
    if (!arena) return W.packInput({ yaw: rd(L.CL_YAW), pitch: rd(L.CL_PITCH), move: mv & 15, jump: (mv >> 4) & 1, shot: sentPresses & 3, weapon: rd(L.CL_WEAPON) });
    take(L.CL_MELEE);
    take(L.CL_GREN);
    Atomics.store(i32, L.CL_MSENT >> 2, sent[L.CL_MELEE]);
    Atomics.store(i32, L.CL_GSENT >> 2, sent[L.CL_GREN]);
    const st = t - welcome.roomStart;
    if ((st & 7) === 0) {
      // the view lag: this word's tick less the confirmed tick on screen now
      const lag = Math.round(t - readClock(i32, f64, L.CL_PLAY, epoch()) + 1);
      const reload = take(L.CL_RELOAD), use = take(L.CL_USE);
      frame = frameDue(lastFrame, st, lag, reload || use) ? arenaFrame({ lag, reload, use }) : 0;
      Atomics.store(i32, L.CL_FRAME >> 2, frame);
    }
    return arenaWord({ yaw: rd(L.CL_YAW), pitch: rd(L.CL_PITCH), move: mv & 15, jump: (mv >> 4) & 1, shot: sentPresses & 3,
      melee: sent[L.CL_MELEE] & 1, gren: sent[L.CL_GREN] & 1, slot: rd(L.CL_WEAPON), serial: (frame >> (st & 7)) & 1 });
  };
  const dw = wt.datagrams.writable.getWriter();
  const send = () => {
    const first = Math.max(inAck, lastBundleT, welcome.joinTick - 1) + 1;
    const from = Math.max(first, nextTick - W.MAX_INPUTS);
    const list = [];
    for (let t = from; t < nextTick; t++) list.push(words.get(t));
    for (const t of words.keys()) if (t < from - 8) words.delete(t); else break;
    if (!list.length) return;
    const r = report?.left > 0 ? report : null;
    if (r) r.left--;
    const buf = W.encodeInput({ seq: seq++, firstTick: from, ...recv.ack(), words: list, report: r });
    Atomics.add(i32, L.CL_TX >> 2, buf.length);
    imp.send(() => dw.write(buf).catch(() => {}));
  };
  let lastTimer = epoch();
  let heardAt = epoch();
  // a spectator's datagrams: only its acks and the newest hash, every second tick
  const sendWatch = () => {
    const r = report?.left > 0 ? report : null;
    if (r) r.left--;
    const buf = W.encodeInput({ seq: seq++, firstTick: 0, ...recv.ack(), words: [], report: r });
    Atomics.add(i32, L.CL_TX >> 2, buf.length);
    imp.send(() => dw.write(buf).catch(() => {}));
  };
  const timer = setInterval(() => {
    const now = epoch();
    // how late this 4 ms timer runs: a starved worker samples, sends and acks late
    if (now - lastTimer > 50) seen.gaps.push(Math.round(now - lastTimer));
    lastTimer = now;
    if (failover && now - heardAt > SILENT_MS) { try { wt.close(); } catch { /* gone */ } }
    if (welcome.watch) {
      const t = Math.floor(serverTick(now));
      if (t - lastSent >= W.SEND_EVERY) { lastSent = t; sendWatch(); }
      return;
    }
    const predicted = Math.floor(serverTick(now) + lead);
    if (nextTick > predicted) return;
    while (nextTick <= predicted) {
      const w = sample(nextTick);
      words.set(nextTick, w);
      u32[(L.CL_WORDS >> 2) + (nextTick & 255)] = w;
      nextTick++;
    }
    Atomics.store(i32, L.CL_NEXT >> 2, nextTick);
    if (nextTick - lastSent >= W.SEND_EVERY) { lastSent = nextTick; send(); }
  }, W.TICK_MS / 2);

  // First arrivals: how many ticks after it closed each tick reached us, the last 256.
  const offsets = new Float64Array(256);
  let nOff = 0;
  let play = { base: welcome.serverTick - 8, epoch: t0, rate: 1 };
  const slacks = [];
  const arrived = (t, now) => { offsets[nOff++ & 255] = serverTick(now) - (t + 1); };
  const steer = (now) => {
    const n = Math.min(nOff, 256);
    if (!n) return;
    const off = Array.from(offsets.subarray(0, n));
    const early = Math.min(...off);
    const jitter = pct(off, 0.95) - early;
    const delay = L.PLAY_BASE + jitter;
    const target = serverTick(now) - early - delay;
    const at = play.base + (now - play.epoch) * play.rate / W.TICK_MS;
    const err = target - at;
    // a large error (the first arrivals, a stall) snaps; otherwise re-centre within 3%
    play = Math.abs(err) > 16 || n < 16 ? { base: target, epoch: now, rate: 1 } : { base: at, epoch: now, rate: 1 + Math.max(-0.03, Math.min(0.03, err / 16)) };
    writeClock(i32, f64, L.CL_PLAY, play.base, play.epoch, play.rate);
    f32[L.CL_DELAY >> 2] = early + delay;
    f32[L.CL_JITTER >> 2] = jitter;
  };

  for await (const buf of readable(wt.datagrams.readable)) imp.recv(() => onDatagram(buf));
  clearInterval(timer);
  clearInterval(seenTimer);
  return { slot: welcome.slot, room: welcome.roomStart };

  function onDatagram(buf) {
    const now = epoch();
    heardAt = now;
    const d = W.decodeTicks(buf);
    if (!d) return;
    Atomics.add(i32, (d.type === W.T_REPAIR ? L.CL_RX_REPAIR : L.CL_RX_BUNDLE) >> 2, buf.length);
    const ticks = [];
    let newestHere = -1;
    for (const e of d.entries) {
      newestHere = Math.max(newestHere, e.tick);
      if (d.type === W.T_REPAIR) repairedAt.set(e.tick, (repairedAt.get(e.tick) || 0) + 1);
      if (e.tick < welcome.roomStart || recv.has(e.tick)) continue;
      const whole = parts.add(e);
      if (!whole || !recv.add(e.tick)) continue;
      arrived(e.tick, now);
      Atomics.add(i32, L.CL_HEARD >> 2, 1);
      ticks.push({ t: e.tick, parts: whole });
    }
    parts.forget(recv.newest - 512);
    if (d.type === W.T_REPAIR) {
      for (const t of repairedAt.keys()) if (t < recv.newest - 512) repairedAt.delete(t);
      seen.repairs++;
      if (ticks.length) { simPort.postMessage({ ticks }); Atomics.add(i32, L.CL_REPAIRS >> 2, ticks.length); }
      return;
    }
    seen.bundles++;
    if (ticks.length) simPort.postMessage({ ticks });
    steer(now);
    // a bundle that needed several datagrams stamps the same trailer on each: take it once, with its newest tick
    if (newestHere <= lastBundleT) return;
    const b = d.trailer;
    lastBundleT = newestHere;
    inAck = Math.max(inAck, b.inAck);
    // The lead: the relay's slack (how early our words land) toward its own
    // jitter plus a send interval, at most 0.02 ticks a tick (2% fast or slow).
    slacks.push(b.slack);
    if (slacks.length > 128) slacks.shift();
    const target = pct(slacks, 0.5) - pct(slacks, 0.05) + W.SEND_EVERY * W.TICK_MS + 4;
    lead = Math.max(1, Math.min(60, lead + Math.max(-0.04, Math.min(0.04, 0.0025 * (target - b.slack)))));
    publishPred(now);
    f32[L.CL_PING >> 2] = b.slack;
  }
}

async function* readable(stream) {
  const r = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await r.read();
      if (done) return;
      yield value;
    }
  } catch { /* session closed */ }
}
