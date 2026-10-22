import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../net/wire.mjs';
import * as L from '../src/layout.mjs';

test('input words round-trip every field', () => {
  const v = { yaw: 0x3fff, pitch: 1023, move: 0b1010, jump: 1, shot: 3, weapon: 1 };
  assert.deepEqual(W.unpackInput(W.packInput(v)), v);
  assert.equal(W.packInput({}), 0);
  assert.equal(W.packInput(v) & W.JUMP_BIT, W.JUMP_BIT);
});

test('input datagrams round-trip', () => {
  const words = [1, 2, 0xffffffff, 12345];
  const d = W.decodeInput(W.encodeInput({ seq: 7, firstTick: 1000, ackTick: 998, ackBits: 0x8000000180000001n, words }));
  assert.deepEqual([...d.words], words);
  assert.equal(d.firstTick, 1000);
  assert.equal(d.ackBits, 0x8000000180000001n);
});

test('the handshake round-trips and rejects are recognised', () => {
  const h = W.decodeHello(W.encodeHello({ maxDatagram: 1200, wasmPrefix: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), room: 2, nonce: 9 }));
  assert.equal(h.maxDatagram, 1200);
  assert.deepEqual([...h.wasmPrefix], [1, 2, 3, 4, 5, 6, 7, 8]);
  const w = W.decodeWelcome(W.encodeWelcome({ slot: 3, maxDatagram: 1400, joinTick: 50, seed: 7, serverTick: 46 }));
  assert.equal(w.slot, 3);
  assert.equal(w.tickUs, 8000);
  assert.deepEqual(W.decodeWelcome(W.encodeReject(W.REJECT.WASM)), { reject: W.REJECT.WASM });
});

test('the buffered reader keeps what it over-reads', async () => {
  const chunks = [new Uint8Array([1, 2, 3, 4, 5, 6]), new Uint8Array([7, 8])];
  const r = W.bufferedReader({ read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { done: true }) });
  assert.deepEqual([...await r.read(4)], [1, 2, 3, 4]);
  assert.deepEqual([...await r.read(4)], [5, 6, 7, 8]);
});

test('compare refuses traces of different length or without a log hash', async () => {
  const { compareTraces } = await import('../tools/compare.mjs');
  const base = { terrainHash: 1n, logHash: 2n, ticks: 256, nInt: 2, tickHashes: new BigUint64Array(256), intervalHashes: new BigUint64Array(2), sliceDigests: new BigUint64Array(256) };
  assert.equal(compareTraces(base, { ...base }).ok, true);
  assert.match(compareTraces(base, { ...base, ticks: 128, nInt: 1 }).what, /lengths differ/);
  assert.match(compareTraces(base, { ...base, logHash: 0n }).what, /no log hash/);
  const other = { ...base, intervalHashes: BigUint64Array.of(0n, 9n) };
  assert.match(compareTraces(base, other).what, /interval hash 1/);
});

test('the welcome carries the room start and the room size; fills round-trip', () => {
  const w = W.decodeWelcome(W.encodeWelcome({ slot: 255, maxDatagram: 1200, joinTick: 900, seed: 0xdeadbeef, serverTick: 896, roomStart: 512 }));
  assert.equal(w.roomStart, 512);
  assert.equal(w.seed, 0xdeadbeef);
  assert.equal(w.slot, 255);
  assert.equal(w.np, 256);
  const ticks = [[Uint8Array.of(1, 2, 3)], [Uint8Array.of(4), Uint8Array.of(5, 6)], [Uint8Array.of()]];
  const buf = W.encodeFill(512, ticks);
  const head = W.decodeFillHead(buf);
  assert.deepEqual(head, { from: 512, n: 3, bytes: buf.length - 16 });
  assert.deepEqual(W.decodeFillBody(head.from, head.n, buf.subarray(16)), ticks.map((parts, k) => ({ tick: 512 + k, parts })));
});

// A room of 256 for `n` ticks: `aim(p, t)` says whether slot p moves its mouse on tick t.
function room(n, aim, seed = 7) {
  let s = seed;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  let prev = new Uint32Array(W.NP);
  const out = [];
  for (let t = 0; t < n; t++) {
    const cur = Uint32Array.from(prev, (w, p) => {
      if (!aim(p, t)) return w;
      const yaw = ((w & 0x3fff) + (r() % 61) - 30) & 0x3fff;
      const pitch = Math.max(0, Math.min(1023, ((w >>> 14) & 0x3ff) + (r() % 7) - 3));
      return (yaw | (pitch << 14) | (r() % 40 ? w & 0xff000000 : (r() & 0xff) << 24)) >>> 0;
    });
    const events = t % 37 === 0 ? [{ slot: t % 256, kind: W.EV_JOIN }, { slot: 255 - (t % 256), kind: W.EV_LEAVE }] : [];
    out.push({ events, prev, cur, parts: W.encodeTick(events, prev, cur) });
    prev = cur;
  }
  return out;
}

test('a tick codes only the words that changed, and decodes to every word exactly', () => {
  const base = new W.TickBase();
  for (const t of room(300, (p, t) => (p + t) % 3 === 0)) {
    const d = base.apply(t.parts);
    assert.deepEqual(base.w, t.cur);
    assert.deepEqual(d.events, t.events);
    assert.deepEqual(d.words.map(([p]) => p), [...t.cur.keys()].filter((p) => t.cur[p] !== t.prev[p]));
  }
  // nothing changed: one byte, and the base stays
  const still = W.encodeTick([], base.w, base.w);
  assert.deepEqual(still, [Uint8Array.of(0xc0)]);
  const before = base.w.slice();
  assert.deepEqual(base.apply(still), { events: [], words: [] });
  assert.deepEqual(base.w, before);
});

test('256 players aiming every tick cost under 600 B a tick; a quarter of them, under 200', () => {
  const size = (ticks) => Math.max(...ticks.map((t) => t.parts.reduce((a, p) => a + p.length, 0)));
  assert.ok(size(room(200, () => true)) < 600, `${size(room(200, () => true))} B`);
  assert.ok(size(room(200, (p) => p % 4 === 0)) < 200, `${size(room(200, (p) => p % 4 === 0))} B`);
});

test('a tick too big for a datagram comes in parts, and the parts come back together from any datagrams', () => {
  let s = 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const prev = Uint32Array.from({ length: W.NP }, r), cur = Uint32Array.from({ length: W.NP }, r);
  const parts = W.encodeTick([{ slot: 9, kind: W.EV_JOIN }], prev, cur);
  assert.ok(parts.length >= 2, `${parts.length} parts`);
  for (const p of parts) assert.ok(p.length <= W.PART_MAX);
  const ticks = [{ tick: 4000, parts }, { tick: 4001, parts: [Uint8Array.of(0xc0)] }];
  const dgs = W.encodeTicks(W.T_BUNDLE, ticks, W.MAX_DATAGRAM);
  assert.ok(dgs.length >= 2);
  const got = new W.Parts();
  const whole = new Map();
  for (const dg of dgs.reverse()) {
    assert.ok(dg.length <= W.MAX_DATAGRAM);
    const d = W.decodeTicks(dg);
    assert.equal(d.type, W.T_BUNDLE);
    for (const e of d.entries) { const w = got.add(e); if (w) whole.set(e.tick, w); }
  }
  assert.deepEqual(whole.get(4000), parts);
  const base = new W.TickBase();
  base.w.set(prev);
  assert.deepEqual(base.apply(whole.get(4000)).events, [{ slot: 9, kind: W.EV_JOIN }]);
  assert.deepEqual(base.w, cur);
});

test('a bundle datagram is shared; each recipient gets a copy with its own trailer', () => {
  const [dg] = W.encodeTicks(W.T_BUNDLE, room(4, (p) => p < 8).map((t, k) => ({ tick: 100 + k, parts: t.parts })));
  const mine = W.decodeTicks(W.stampTrailer(dg.slice(), { inAck: 99, slack: -2.25, late: 7 }));
  assert.deepEqual(mine.trailer, { inAck: 99, slack: -2.25, late: 7, flags: 0 });
  assert.deepEqual(mine.entries.map((e) => e.tick), [100, 101, 102, 103]);
  assert.equal(W.decodeTicks(dg).trailer.inAck, 0, 'the shared datagram is untouched');
});

test('the base for the tick after a keyframe is each live player\'s last input in the region', () => {
  const region = new Uint8Array(L.REGION_SIZE);
  const dv = new DataView(region.buffer);
  for (const [p, live, word] of [[0, 1, 0x12345678], [7, 0, 0xffffffff], [255, 1, 42]]) {
    const o = L.PLAYERS - L.REGION + p * L.PSIZE;
    region[o + L.P_FL] = live ? L.PF_LIVE : 0;
    dv.setUint32(o + L.P_IN, word, true);
  }
  const base = new W.TickBase().seed(region);
  assert.deepEqual([base.w[0], base.w[7], base.w[255], base.w[1]], [0x12345678, 0, 42, 0]);
});

test('acks are per tick, and the holes they show are the ones a few ticks old', () => {
  const r = new W.Received();
  for (let t = 60; t <= 140; t++) if (![70, 80, 120, 121, 138].includes(t)) r.add(t);
  assert.equal(r.add(130), false, 'a tick twice is not new');
  const { ackTick, ackBits } = r.ack();
  assert.equal(ackTick, 140);
  assert.equal((ackBits >> BigInt(140 - 1 - 120)) & 1n, 0n);
  assert.equal((ackBits >> BigInt(140 - 1 - 119)) & 1n, 1n);
  // 138 is too recent to call lost, 80 is in the high word, 70 is past the field; nothing before `from` is asked for
  assert.deepEqual(W.holes(ackTick, ackBits), [80, 120, 121]);
  assert.deepEqual(W.holes(ackTick, ackBits, 121), [121]);
  assert.deepEqual(W.holes(ackTick, ackBits, 0, 2), [80, 120, 121, 138]);
  // a lone first tick: nothing older is a hole
  const one = new W.Received();
  one.add(5);
  assert.deepEqual(W.holes(one.ack().ackTick, one.ack().ackBits, 5), []);
});

test('input datagrams carry an interval hash report when there is one', () => {
  const words = [1, 2, 3];
  const plain = W.decodeInput(W.encodeInput({ seq: 1, firstTick: 9, ackTick: 8, ackBits: 3n, words }));
  assert.equal(plain.report, null);
  const hash = 0xfedcba9876543210n;
  const m = W.decodeInput(W.encodeInput({ seq: 1, firstTick: 9, ackTick: 8, ackBits: 3n, words, report: { interval: 1280, epoch: 258, hash } }));
  assert.deepEqual([...m.words], words);
  assert.deepEqual(m.report, { interval: 1280, epoch: 2, hash });
});

test('a repair carries as many ticks as fit, each whole', () => {
  const ticks = room(10, () => true).map((t, k) => ({ tick: 700 + 3 * k, parts: t.parts }));
  const dgs = W.encodeTicks(W.T_REPAIR, ticks, W.MAX_DATAGRAM);
  assert.ok(dgs.length > 1);
  const back = dgs.map(W.decodeTicks);
  for (const [k, d] of back.entries()) {
    assert.equal(d.type, W.T_REPAIR);
    assert.equal(d.trailer, null);
    assert.ok(dgs[k].length <= W.MAX_DATAGRAM);
  }
  assert.deepEqual(back.flatMap((d) => d.entries.map((e) => e.tick)), ticks.map((t) => t.tick));
});

test('the control stream: sync, ping, pong, keyframes with and without digests, fills', async () => {
  assert.deepEqual(W.decodeClient(W.encodeSync(W.SYNC.HOLE, 4242)), { type: W.T_SYNC, reason: W.SYNC.HOLE, have: 4242 });
  assert.deepEqual(W.decodeClient(W.encodePing(77)), { type: W.T_PING, nonce: 77 });
  const region = new Uint8Array(1 << 19);
  new Float32Array(region.buffer, 0x10000, 4096).set(Array.from({ length: 4096 }, (_, i) => 100 + i * 0.25));
  const packed = await W.packKey(region);
  assert.ok(packed.length < 20000, `packed ${packed.length} B`);
  const digests = Uint8Array.from({ length: 1024 }, (_, i) => i & 255);
  const tick = W.encodeTick([], new Uint32Array(W.NP), Uint32Array.from({ length: W.NP }, (_, p) => (p === 1 ? 5 : 0)));
  const fill = W.encodeFill(900, [tick]);
  const parts = [
    W.encodePong(77, 1234.5),
    W.encodeKeyHead({ reason: W.SYNC.JOIN, tick: 896, raw: region.length, packed: packed.length }), packed, fill,
    W.encodeKeyHead({ reason: W.SYNC.DESYNC, tick: 1024, raw: region.length, packed: packed.length, interval: 896, digests }), packed,
  ];
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
  // delivered in 100-byte pieces, as a stream may
  let off = 0;
  const reader = { read: async () => (off >= all.length ? { done: true } : { value: all.slice(off, (off += 100)), done: false }) };
  const sr = W.bufferedReader(reader);
  assert.deepEqual(await W.readControl(sr), { type: W.T_PONG, nonce: 77, serverTick: 1234.5 });
  const k = await W.readControl(sr);
  assert.deepEqual([k.type, k.reason, k.tick, k.raw, k.interval, k.digests], [W.T_KEY, W.SYNC.JOIN, 896, region.length, -1, null]);
  assert.deepEqual(await W.unpackKey(k.packed), region);
  const f = await W.readControl(sr);
  const [t900] = W.decodeFillBody(f.from, f.n, f.body);
  assert.equal(t900.tick, 900);
  assert.deepEqual(new W.TickBase().apply(t900.parts), { events: [], words: [[1, 5]] });
  const d = await W.readControl(sr);
  assert.deepEqual([d.reason, d.tick, d.interval], [W.SYNC.DESYNC, 1024, 896]);
  assert.deepEqual(d.digests, digests);
  assert.equal(await W.readControl(sr), null);
});
