import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../net/wire.mjs';

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

test('bundles round-trip and their size matches the formula', () => {
  const rows = [0, 1, 2, 3].map((k) => Uint32Array.from({ length: W.NP }, (_, p) => k * 1000 + p));
  const events = [{ slot: 5, kind: W.EV_JOIN, tick: 99 }, { slot: 9, kind: W.EV_LEAVE, tick: 100 }];
  const buf = W.encodeBundle({ T: 100, rows, events, inAck: 98, slack: -1.5, late: 3 });
  assert.equal(buf.length, W.bundleSize(2));
  const b = W.decodeBundle(buf);
  assert.equal(b.T, 100);
  assert.deepEqual([...b.rows[3]], [...rows[3]]);
  assert.deepEqual(b.events, events);
  assert.equal(b.slack, -1.5);
  assert.equal(b.inAck, 98);
});

test('a 64-player bundle fits the worst-case datagram, even with 32 events', () => {
  assert.equal(W.bundleSize(0), 1040);
  assert.ok(W.bundleSize(32) <= W.MAX_DATAGRAM, `${W.bundleSize(32)} B`);
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

test('a stamped copy of a shared body equals a bundle encoded for that recipient', () => {
  const rows = [0, 1, 2, 3].map((k) => Uint32Array.from({ length: W.NP }, (_, p) => k * 7 + p));
  const events = [{ slot: 2, kind: W.EV_JOIN, tick: 40 }];
  const body = W.encodeBundle({ T: 41, rows, events, inAck: 0, slack: 0, late: 0 });
  const stamped = W.stampTrailer(body.slice(), { inAck: 39, slack: -2.25, late: 7 });
  assert.deepEqual([...stamped], [...W.encodeBundle({ T: 41, rows, events, inAck: 39, slack: -2.25, late: 7 })]);
  assert.equal(body[body.length - 2], 0, 'the shared body is untouched');
});

test('the welcome carries the room start; fills round-trip', () => {
  const w = W.decodeWelcome(W.encodeWelcome({ slot: 1, maxDatagram: 1200, joinTick: 900, seed: 0xdeadbeef, serverTick: 896, roomStart: 512 }));
  assert.equal(w.roomStart, 512);
  assert.equal(w.seed, 0xdeadbeef);
  const ticks = [
    W.encodeTick([{ slot: 0, kind: W.EV_JOIN }], [[0, 0xffffffff]]),
    W.encodeTick([], [[0, 7], [5, 0]]),
    W.encodeTick([{ slot: 5, kind: W.EV_LEAVE }], []),
  ];
  const buf = W.encodeFill(512, ticks);
  const head = W.decodeFillHead(buf);
  assert.deepEqual(head, { from: 512, n: 3, bytes: buf.length - 16 });
  assert.deepEqual(W.decodeFillBody(head.from, head.n, buf.subarray(16)), [
    { tick: 512, events: [{ slot: 0, kind: W.EV_JOIN }], words: [[0, 0xffffffff]] },
    { tick: 513, events: [], words: [[0, 7], [5, 0]] },
    { tick: 514, events: [{ slot: 5, kind: W.EV_LEAVE }], words: [] },
  ]);
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

test('a repair carries as many consecutive ticks as fit, and decodes like a fill', () => {
  const ticks = Array.from({ length: 10 }, (_, k) => W.encodeTick(k === 0 ? [{ slot: 3, kind: W.EV_JOIN }] : [], Array.from({ length: 64 }, (_, p) => [p, k * 100 + p])));
  const { buf, n } = W.encodeRepair(700, ticks);
  assert.ok(buf.length <= W.MAX_DATAGRAM);
  assert.equal(n, 3, '322-byte ticks: three fit');
  const back = W.decodeRepair(buf);
  assert.equal(back.length, 3);
  assert.equal(back[0].tick, 700);
  assert.deepEqual(back[0].events, [{ slot: 3, kind: W.EV_JOIN }]);
  assert.deepEqual(back[2].words[63], [63, 263]);
  assert.equal(W.decodeTick(ticks[1]).words[5][1], 105);
});

test('the control stream: sync, ping, pong, keyframes with and without digests, fills', async () => {
  assert.deepEqual(W.decodeClient(W.encodeSync(W.SYNC.HOLE, 4242)), { type: W.T_SYNC, reason: W.SYNC.HOLE, have: 4242 });
  assert.deepEqual(W.decodeClient(W.encodePing(77)), { type: W.T_PING, nonce: 77 });
  const region = new Uint8Array(1 << 19);
  new Float32Array(region.buffer, 0x10000, 4096).set(Array.from({ length: 4096 }, (_, i) => 100 + i * 0.25));
  const packed = await W.packKey(region);
  assert.ok(packed.length < 20000, `packed ${packed.length} B`);
  const digests = Uint8Array.from({ length: 1024 }, (_, i) => i & 255);
  const fill = W.encodeFill(900, [W.encodeTick([], [[1, 5]])]);
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
  assert.deepEqual(W.decodeFillBody(f.from, f.n, f.body), [{ tick: 900, events: [], words: [[1, 5]] }]);
  const d = await W.readControl(sr);
  assert.deepEqual([d.reason, d.tick, d.interval], [W.SYNC.DESYNC, 1024, 896]);
  assert.deepEqual(d.digests, digests);
  assert.equal(await W.readControl(sr), null);
});
