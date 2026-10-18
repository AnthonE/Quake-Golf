// The net worker: owns the WebTransport session and the tick clock. Once a
// tick it samples the input slots in shared memory into one word; every second
// tick it sends every word the relay hasn't closed. Bundles and fills go to
// the sim worker as closed ticks; holes it reports come back as fill requests.
// It also keeps the playout clock in shared memory: the server tick to show
// now, PLAY_DELAY ticks behind the earliest bundle arrivals.
import * as W from '../net/wire.mjs';
import * as L from '../src/layout.mjs';
import { createImpair } from '../net/impair.js';

const epoch = () => performance.timeOrigin + performance.now();

let leave = () => {};
self.onmessage = (e) => {
  if (e.data.leave) { leave(); return; }
  run(e.data).catch((err) => {
    const i32 = new Int32Array(e.data.memory.buffer);
    Atomics.store(i32, L.CL_STATE >> 2, 3);
    self.postMessage({ error: String(err?.stack || err) });
  });
};

// impair: { delay, jitter, loss } on this client's own datagrams, both ways (?impair=)
async function run({ url, certHash, memory, prefix, simPort, impair = {} }) {
  const imp = createImpair({ ...impair, seed: (Math.random() * 2 ** 32) >>> 0 });
  const i32 = new Int32Array(memory.buffer);
  const f32 = new Float32Array(memory.buffer);
  const f64 = new Float64Array(memory.buffer);
  const rd = (a) => Atomics.load(i32, a >> 2);
  Atomics.store(i32, L.CL_SLOT >> 2, -1);

  const wt = new WebTransport(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: certHash }], congestionControl: 'low-latency' });
  await wt.ready;
  try { wt.datagrams.outgoingMaxAge = 2 * W.TICK_MS; } catch { /* optional */ }
  const bidi = await wt.createBidirectionalStream();
  const sw = bidi.writable.getWriter();
  await sw.write(W.encodeHello({ maxDatagram: wt.datagrams.maxDatagramSize, wasmPrefix: prefix, nonce: (Math.random() * 2 ** 32) >>> 0 }));
  const sr = W.bufferedReader(bidi.readable.getReader());
  const head = await sr.read(4);
  if (head[0] === W.T_REJECT) throw new Error(['', 'game.wasm differs from the server\'s: reload', 'the room is full', 'protocol mismatch'][head[1]] || 'rejected');
  const wb = new Uint8Array(32);
  wb.set(head, 0);
  wb.set(await sr.read(28), 4);
  const welcome = W.decodeWelcome(wb);
  const t0 = epoch();
  // The server's open tick, from the welcome (half a round trip stale); the
  // input lead and the playout clock are both measured against it.
  const serverTick = (now) => welcome.serverTick + (now - t0) / W.TICK_MS;
  Atomics.store(i32, L.CL_ROOM >> 2, welcome.roomStart);
  Atomics.store(i32, L.CL_SLOT >> 2, welcome.slot);
  f64[(L.CL_PLAY >> 3)] = welcome.serverTick - 8;
  f64[(L.CL_PLAY >> 3) + 1] = t0;
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

  // Control stream: fills of closed ticks the sim worker asks for, the room's history first.
  const need = (from, to) => { if (to > from) sw.write(W.encodeNeed(from, to)).catch(() => {}); };
  simPort.onmessage = (e) => { if (e.data.need) need(...e.data.need); };
  (async () => {
    for (;;) {
      const h = W.decodeFillHead(await sr.read(16));
      if (!h) break;
      const body = await sr.read(h.bytes);
      const ticks = W.decodeFillBody(h.from, h.n, body).map((t) => ({ t: t.tick, ev: t.events, w: t.words }));
      simPort.postMessage({ ticks });
    }
  })().catch(() => {});

  // Inputs: one word per tick from joinTick on, tagged lead ticks ahead.
  let lead = 3;
  const TARGET_SLACK = (W.SEND_EVERY + 1) * W.TICK_MS;
  const words = new Map();
  let nextTick = welcome.joinTick;
  let sentPresses = rd(L.CL_PRESSES);
  let inAck = 0, lastBundleT = -1, seq = 0, ackTick = -1, ackBits = 0;
  const sample = () => {
    // a press advances the counter one step a tick, so quick clicks never merge
    if (((rd(L.CL_PRESSES) - sentPresses) | 0) > 0) sentPresses++;
    const mv = rd(L.CL_MOVE);
    return W.packInput({ yaw: rd(L.CL_YAW), pitch: rd(L.CL_PITCH), move: mv & 15, jump: (mv >> 4) & 1, shot: sentPresses & 3, weapon: rd(L.CL_WEAPON) });
  };
  const dw = wt.datagrams.writable.getWriter();
  const send = () => {
    const now = epoch();
    const predicted = Math.floor(serverTick(now) + lead);
    while (nextTick <= predicted) words.set(nextTick++, sample());
    const first = Math.max(inAck, lastBundleT, welcome.joinTick - 1) + 1;
    const from = Math.max(first, nextTick - W.MAX_INPUTS);
    const list = [];
    for (let t = from; t < nextTick; t++) list.push(words.get(t));
    for (const t of words.keys()) if (t < from - 8) words.delete(t); else break;
    if (list.length) {
      const buf = W.encodeInput({ seq: seq++, firstTick: from, ackTick: Math.max(0, ackTick), ackBits, words: list });
      imp.send(() => dw.write(buf).catch(() => {}));
    }
  };
  const timer = setInterval(send, W.TICK_MS * W.SEND_EVERY);

  // Bundles: each closed tick once, to the sim worker; arrivals set the playout clock.
  const seen = new Int32Array(1024).fill(-1);
  const early = [];
  for await (const buf of readable(wt.datagrams.readable)) imp.recv(() => onBundle(buf));
  clearInterval(timer);
  Atomics.store(i32, L.CL_STATE >> 2, 3);
  self.postMessage({ closed: true });

  function onBundle(buf) {
    const b = W.decodeBundle(buf);
    if (!b) return;
    const now = epoch();
    const ticks = [];
    for (let k = 0; k < b.nb; k++) {
      const t = b.T - k;
      if (t < welcome.roomStart || seen[t & 1023] === t) continue;
      seen[t & 1023] = t;
      ticks.push({ t, ev: b.events.filter((e) => e.tick === t).map(({ slot, kind }) => ({ slot, kind })), w: b.rows[k] });
    }
    if (ticks.length) simPort.postMessage({ ticks });
    // the playout clock sits PLAY_DELAY ticks behind the earliest of the last 64 arrivals
    early.push(serverTick(now) - (b.T + 1));
    if (early.length > 64) early.shift();
    const off = Math.min(...early);
    f64[L.CL_PLAY >> 3] = welcome.serverTick - off - L.PLAY_DELAY;
    if (ackTick < 0) ackTick = b.T;
    else if (b.T > ackTick) {
      const shift = b.T - ackTick;
      ackBits = shift > 32 ? 0 : shift === 32 ? 0x80000000 : ((ackBits << shift) | (1 << (shift - 1))) >>> 0;
      ackTick = b.T;
    } else if (b.T < ackTick && ackTick - b.T <= 32) ackBits = (ackBits | (1 << (ackTick - 1 - b.T))) >>> 0;
    lastBundleT = Math.max(lastBundleT, b.T);
    inAck = Math.max(inAck, b.inAck);
    lead = Math.max(1, Math.min(40, lead + 0.02 * (TARGET_SLACK - b.slack) / W.TICK_MS));
    f32[L.CL_LEAD >> 2] = lead;
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
