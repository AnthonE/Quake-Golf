// One M0 client: handshake, then send seeded input words two ticks per
// datagram and read bundles, decoding its own slot's word from each tick in
// order (a slot's word is coded against its own last one, so the others'
// don't matter to it). Web APIs only, so the same code runs as a Deno
// bot and in the Chrome client page. Lead control is dilation-style: the
// predicted tick moves continuously and every tick number gets one input.
import * as W from './wire.mjs';
import { createImpair } from './impair.js';

export function b64ToBytes(b64) {
  const bin = atob(b64.trim());
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function runBot({ url, certHash, wasmPrefix, seed = 1, durationMs = 10000, impair = {}, onReady }) {
  const imp = createImpair({ ...impair, seed: seed * 7919 + 1 });
  const wt = new WebTransport(url, {
    serverCertificateHashes: [{ algorithm: 'sha-256', value: certHash }],
    congestionControl: 'low-latency',
  });
  await wt.ready;
  const tReady = performance.now();
  let closedAt = null;
  let closeInfo = null;
  wt.closed.then((info) => { closedAt = performance.now() - tReady; closeInfo = JSON.stringify(info); },
                 (err) => { closedAt = performance.now() - tReady; closeInfo = String(err); });
  const maxDatagram = wt.datagrams.maxDatagramSize;
  try { wt.datagrams.outgoingMaxAge = 2 * W.TICK_MS; } catch { /* not every runtime has it */ }

  // Handshake on a bidirectional stream.
  const bidi = await wt.createBidirectionalStream();
  const sw = bidi.writable.getWriter();
  await sw.write(W.encodeHello({ maxDatagram, wasmPrefix, nonce: seed }));
  const sr = W.bufferedReader(bidi.readable.getReader());
  const head = await sr.read(4);
  if (head[0] === W.T_REJECT) { wt.close(); return { seed, reject: head[1] }; }
  const welcomeBytes = new Uint8Array(32);
  welcomeBytes.set(head, 0);
  welcomeBytes.set(await sr.read(28), 4);
  const welcome = W.decodeWelcome(welcomeBytes);
  const tWelcome = performance.now();
  onReady?.(welcome, maxDatagram);

  // Seeded input walk: aim drifts, keys change now and then, a shot every ~2 s.
  let rs = (seed >>> 0) || 1;
  const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs; };
  let yaw = rnd() & 0x3fff;
  let pitch = 512;
  let move = 0;
  let shot = 0;
  const wordFor = new Map(); // tick -> word we sent
  const makeWord = () => {
    yaw = (yaw + (rnd() % 41) - 20) & 0x3fff;
    pitch = Math.max(0, Math.min(1023, pitch + (rnd() % 9) - 4));
    if (rnd() % 30 === 0) move = rnd() & 0xf;
    if (rnd() % 250 === 0) shot = (shot + 1) & 3;
    return W.packInput({ yaw, pitch, move, jump: rnd() % 60 === 0 ? 1 : 0, shot, weapon: 0 });
  };

  // Clock: the server's open tick, estimated from the welcome, plus a lead.
  const serverTick = (now) => welcome.serverTick + (now - tWelcome) / W.TICK_MS;
  let lead = 3;
  // Inputs go out every second tick, so the repeat of a lost input lands one
  // send interval later; the slack has to cover that, plus a tick of jitter.
  const TARGET_SLACK = (W.SEND_EVERY + 1) * W.TICK_MS;
  let nextTick = welcome.joinTick; // first tick without a word yet
  let lastBundleT = -1;
  let inAck = 0;
  let seq = 0;
  const recv = new W.Received(); // closed ticks heard, for the acks
  const parts = new W.Parts();
  const base = new W.TickBase();
  const pending = new Map(); // whole ticks waiting their turn to decode
  let nextDecode = welcome.joinTick;

  const st = {
    seed, slot: welcome.slot, joinTick: welcome.joinTick, maxDatagram, serverMaxDatagram: welcome.maxDatagram,
    sent: 0, sentBytes: 0, maxInput: 0, bundles: 0, recvBytes: 0, maxBundle: 0,
    seen: new Set(), mine: 0, mineMatched: 0, joinSeen: false,
    arrivals: [], slack: [], late: 0, leadMin: lead, leadMax: lead,
  };

  const dw = wt.datagrams.writable.getWriter();
  const send = () => {
    const now = performance.now();
    const predicted = Math.floor(serverTick(now) + lead);
    while (nextTick <= predicted) { wordFor.set(nextTick, makeWord()); nextTick++; }
    const from = Math.max(inAck, lastBundleT) + 1;
    const first = Math.max(from, welcome.joinTick, nextTick - W.MAX_INPUTS);
    const words = [];
    for (let t = first; t < nextTick; t++) words.push(wordFor.get(t));
    for (const t of wordFor.keys()) if (t < nextDecode - 8) wordFor.delete(t); else break;
    if (!words.length) return;
    const buf = W.encodeInput({ seq: seq++, firstTick: first, ...recv.ack(), words });
    st.sent++;
    st.sentBytes += buf.length;
    st.maxInput = Math.max(st.maxInput, buf.length);
    imp.send(() => dw.write(buf).catch(() => {}));
  };

  const onBundle = (buf, now) => {
    const d = W.decodeTicks(buf);
    if (!d) return;
    st.recvBytes += buf.length;
    let T = -1;
    for (const e of d.entries) {
      T = Math.max(T, e.tick);
      const whole = parts.add(e);
      if (!whole || e.tick < welcome.joinTick || !recv.add(e.tick)) continue;
      // delivery counts bundles only; a repair just lets the decoding go on
      if (d.type === W.T_BUNDLE) st.seen.add(e.tick);
      pending.set(e.tick, whole);
    }
    parts.forget(nextDecode);
    while (pending.has(nextDecode)) {
      const { events } = base.apply(pending.get(nextDecode));
      pending.delete(nextDecode);
      const sent = wordFor.get(nextDecode);
      if (sent !== undefined) { st.mine++; if (base.w[welcome.slot] === sent) st.mineMatched++; }
      for (const e of events) if (e.slot === welcome.slot && e.kind === W.EV_JOIN) st.joinSeen = true;
      nextDecode++;
    }
    if (d.type !== W.T_BUNDLE) return;
    st.maxBundle = Math.max(st.maxBundle, buf.length);
    // a bundle in several datagrams stamps the same trailer on each: take it once, with its newest tick
    if (T <= lastBundleT) return;
    st.bundles++;
    st.arrivals.push([T, now - tWelcome]);
    const b = d.trailer;
    lastBundleT = T;
    inAck = Math.max(inAck, b.inAck);
    st.slack.push(b.slack);
    st.late = b.late;
    // dilation-style lead: a small continuous nudge toward the target slack
    lead = Math.max(1, Math.min(40, lead + 0.02 * (TARGET_SLACK - b.slack) / W.TICK_MS));
    st.leadMin = Math.min(st.leadMin, lead);
    st.leadMax = Math.max(st.leadMax, lead);
  };

  const reading = (async () => {
    const dr = wt.datagrams.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await dr.read();
        if (done) break;
        imp.recv(() => onBundle(value, performance.now()));
      }
    } catch { /* session closed */ }
  })();

  const timer = setInterval(send, W.TICK_MS * W.SEND_EVERY);
  await new Promise((ok) => setTimeout(ok, durationMs));
  clearInterval(timer);
  const lastT = lastBundleT;
  const closedEarlyAt = closedAt;
  // closing the control stream is how the relay learns we left
  try { await sw.close(); } catch { /* already closed */ }
  // the server tick we should have heard by now, less a round trip of slack
  const shouldHave = Math.floor(serverTick(performance.now())) - 32;
  try { wt.close(); } catch { /* already closed */ }
  await Promise.race([reading, new Promise((ok) => setTimeout(ok, 200))]);
  // expected runs to where the server must have got to, not to the last bundle we happened to get
  const expected = Math.max(0, Math.max(lastT, shouldHave) - welcome.joinTick + 1);
  return {
    seed, slot: st.slot, joinTick: st.joinTick, lastTick: lastT, maxDatagram, serverMaxDatagram: st.serverMaxDatagram,
    sent: st.sent, sentBytes: st.sentBytes, maxInput: st.maxInput, bundles: st.bundles, recvBytes: st.recvBytes, maxBundle: st.maxBundle,
    ticksExpected: expected, ticksSeen: [...st.seen].filter((t) => t <= Math.max(lastT, shouldHave)).length,
    closedEarlyAt, closeInfo, durationMs,
    mine: st.mine, mineMatched: st.mineMatched, joinSeen: st.joinSeen, late: st.late,
    arrivals: st.arrivals, slack: st.slack, lead: { min: st.leadMin, max: st.leadMax, end: lead },
    impair: { ...imp.cfg, ...imp.stats },
  };
}
