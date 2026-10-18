// Wire format v3, little-endian. Shared by the relay, the bots and the browser client.
//
// Input word (32 bits): yaw b0-13 | pitch b14-23 | move b24-27 (forward, back, left, right) | jump b28 | shot counter b29-30 | weapon b31
//
// Input datagram, client to server (20 + 4n B, + 16 with a hash report):
//   0 u8 0x01 | 1 u8 n | 2 u16 seq | 4 u32 first_tick | 8 u32 ack_tick | 12 u64 ack_bits | 20 n x u32 words
//   [| u32 interval | u8 epoch | 3 B 0 | u64 hash]
//   Words only for ticks the server hasn't closed. The ack is per closed tick,
//   however it came: ack_tick is the newest, ack_bits bit k = has tick
//   ack_tick-1-k, so a hole can be repaired until it is 64 ticks old. A report is the client's hash of the interval that closed at
//   sim tick `interval`, after it had restored `epoch` keyframes (mod 256).
//
// Bundle datagram, server to client, every second tick (1,040 B + 2 per event, padded to 4):
//   0 u8 0x02 | 1 u8 nb=4 | 2 u8 np=64 | 3 u8 ne | 4 u32 T | 8 nb x np x u32 (row k is tick T-k)
//   | ne x (u8 slot, u8 kind<<4 | age) | pad | trailer: u32 in_ack | i16 slack (1/16 ms, negative = late) | u8 late | u8 flags
//
// Repair datagram, server to one client, for ticks its acks lack:
//   0 u8 0x03 | 1 u8 n | 2 u16 0 | 4 u32 from | n consecutive ticks as the record keeps them (below)
//
// Handshake on a client-opened bidirectional stream, which stays open for the
// whole session; the client ending it means it has left (a native client, the
// Xbox, uses a TCP connection to the relay's native port as the stream):
//   hello   (24 B): 0x10 | proto | u16 client max datagram | u8[8] sha-256(game.wasm) prefix | u32 room | u32 nonce | u32 0
//   welcome (32 B): 0x11 | slot | u16 server max datagram | u32 join_tick | u32 seed | u32 server_tick | u32 tick_us | u8 send_every | u8 nb | u8 np | u8 0 | u32 room_start | u32 token
//   reject  (4 B):  0x1f | reason (1 wasm mismatch, 2 room full, 3 protocol) | 0 | 0
// The room's sim began at room_start with the seed; sim tick k is server tick
// room_start + k. After those, every message on the stream opens with 16 B.
// Client to server:
//   sync (16 B): 0x12 | reason (SYNC.*) | 0 | 0 | u32 have (the client's next server tick) | 8 B 0
//   ping (16 B): 0x15 | 0 | 0 | 0 | u32 nonce | 8 B 0
// Server to client, from the referee's keyframes and the relay's record:
//   key  (16 B + extra + packed): 0x14 | reason (SYNC.*) | 0 | 0 | u32 tick | u32 raw bytes | u32 packed bytes,
//        then for a desync u32 interval | u32 0 | 128 x u64 the referee's slice digests of it,
//        then the region at server tick `tick`, packed (packKey). A fill from `tick` follows.
//   fill (16 B + body): 0x13 | 0 | 0 | 0 | u32 from | u32 n | u32 body bytes, then n ticks:
//        u8 ne | ne x (u8 slot, u8 kind) | u8 nw | nw x (u8 slot, u32 word), the active slots only
//   pong (16 B): 0x16 | 0 | 0 | 0 | u32 nonce | f64 the server's tick when it answered, fractional
//
// Native clients (net/relay.ts --native-port, TCP and UDP on one number): the
// stream above is the TCP connection; datagrams are UDP to the same port, the
// server's exactly as above, the client's each prefixed with the welcome's u32
// token (0 for WebTransport sessions), which is how the relay finds the session
// and the address to send bundles to.

export const PROTO = 3;
export const T_INPUT = 0x01;
export const T_BUNDLE = 0x02;
export const T_REPAIR = 0x03;
export const T_HELLO = 0x10;
export const T_WELCOME = 0x11;
export const T_SYNC = 0x12;
export const T_FILL = 0x13;
export const T_KEY = 0x14;
export const T_PING = 0x15;
export const T_PONG = 0x16;
export const T_REJECT = 0x1f;
export const REJECT = { WASM: 1, FULL: 2, PROTO: 3 };
// why a keyframe is sent: a join, or a resync for an old hole, a client far behind, or a hash mismatch
export const SYNC = { JOIN: 0, HOLE: 1, BEHIND: 2, DESYNC: 3 };
export const EV_JOIN = 1;
export const EV_LEAVE = 2;

export const TICK_US = 8000;
export const TICK_MS = TICK_US / 1000;
export const SEND_EVERY = 2;
export const NB = 4;
export const NP = 64;
export const MAX_DATAGRAM = 1161; // quinn's worst case on a 1,200-byte path, minus the session prefix
export const MAX_INPUTS = 64;
export const RING = 256; // ticks of history kept per player; a power of two

export function packInput({ yaw = 0, pitch = 0, move = 0, jump = 0, shot = 0, weapon = 0 }) {
  return ((yaw & 0x3fff) | ((pitch & 0x3ff) << 14) | ((move & 0xf) << 24) | ((jump & 1) << 28) | ((shot & 3) << 29) | ((weapon & 1) << 31)) >>> 0;
}

export function unpackInput(w) {
  return { yaw: w & 0x3fff, pitch: (w >>> 14) & 0x3ff, move: (w >>> 24) & 0xf, jump: (w >>> 28) & 1, shot: (w >>> 29) & 3, weapon: w >>> 31 };
}

export const JUMP_BIT = 1 << 28;
export const MOVE_BITS = 0xf << 24;

// report: { interval, epoch, hash (a u64 BigInt) }, or null. ackBits: a u64 BigInt.
export function encodeInput({ seq, firstTick, ackTick, ackBits, words, report = null }) {
  const n = Math.min(words.length, MAX_INPUTS);
  const buf = new Uint8Array(20 + 4 * n + (report ? 16 : 0));
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_INPUT);
  dv.setUint8(1, n);
  dv.setUint16(2, seq & 0xffff, true);
  dv.setUint32(4, firstTick >>> 0, true);
  dv.setUint32(8, ackTick >>> 0, true);
  dv.setBigUint64(12, BigInt.asUintN(64, BigInt(ackBits)), true);
  for (let i = 0; i < n; i++) dv.setUint32(20 + 4 * i, words[i] >>> 0, true);
  if (report) {
    dv.setUint32(20 + 4 * n, report.interval >>> 0, true);
    dv.setUint8(24 + 4 * n, report.epoch & 255);
    dv.setBigUint64(28 + 4 * n, BigInt.asUintN(64, report.hash), true);
  }
  return buf;
}

export function decodeInput(buf) {
  if (buf.length < 20 || buf[0] !== T_INPUT) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint8(1);
  if (buf.length < 20 + 4 * n) return null;
  const words = new Uint32Array(n);
  for (let i = 0; i < n; i++) words[i] = dv.getUint32(20 + 4 * i, true);
  const report = buf.length >= 36 + 4 * n
    ? { interval: dv.getUint32(20 + 4 * n, true), epoch: dv.getUint8(24 + 4 * n), hash: dv.getBigUint64(28 + 4 * n, true) } : null;
  return { seq: dv.getUint16(2, true), firstTick: dv.getUint32(4, true), ackTick: dv.getUint32(8, true), ackBits: dv.getBigUint64(12, true), words, report };
}

// The receive side of the acks: which of the last 1,024 closed ticks arrived,
// by bundle, repair or fill alike.
export class Received {
  constructor() { this.seen = new Int32Array(1024).fill(-1); this.newest = -1; }
  has(t) { return t >= 0 && this.seen[t & 1023] === t; }
  // true if t is new
  add(t) {
    if (t < 0 || this.has(t) || t <= this.newest - 1024) return false;
    this.seen[t & 1023] = t;
    if (t > this.newest) this.newest = t;
    return true;
  }
  ack() {
    let lo = 0, hi = 0;
    for (let k = 0; k < 32; k++) {
      if (this.has(this.newest - 1 - k)) lo |= 1 << k;
      if (this.has(this.newest - 33 - k)) hi |= 1 << k;
    }
    return { ackTick: Math.max(0, this.newest), ackBits: (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0) };
  }
}

// The closed ticks an ack shows missing, oldest first: those in the 64 before
// ack_tick without their bit, at least `grace` older than it (so both bundles
// that carried one were sent before the bundle acked), and none before `from`.
export function holes(ackTick, ackBits, from = 0, grace = 4) {
  const lo = Number(BigInt.asUintN(32, ackBits));
  const hi = Number(BigInt.asUintN(64, ackBits) >> 32n);
  const out = [];
  for (let k = 63; k >= grace - 1; k--) {
    const t = ackTick - 1 - k;
    const bit = k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1;
    if (t >= from && t >= 0 && !bit) out.push(t);
  }
  return out;
}

export function bundleSize(ne) {
  return 8 + NB * NP * 4 + ((2 * ne + 3) & ~3) + 8;
}

// rows: NB Uint32Array(NP), row k = tick T-k. events: [{ slot, kind, tick }].
export function encodeBundle({ T, rows, events, inAck, slack, late, flags = 0 }) {
  const ne = events.length;
  const buf = new Uint8Array(bundleSize(ne));
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_BUNDLE);
  dv.setUint8(1, NB);
  dv.setUint8(2, NP);
  dv.setUint8(3, ne);
  dv.setUint32(4, T >>> 0, true);
  for (let k = 0; k < NB; k++) {
    const row = rows[k];
    for (let p = 0; p < NP; p++) dv.setUint32(8 + 4 * (k * NP + p), row ? row[p] : 0, true);
  }
  let o = 8 + NB * NP * 4;
  for (const e of events) {
    dv.setUint8(o++, e.slot);
    dv.setUint8(o++, (e.kind << 4) | ((T - e.tick) & 0xf));
  }
  o = buf.length - 8;
  dv.setUint32(o, inAck >>> 0, true);
  dv.setInt16(o + 4, Math.max(-32768, Math.min(32767, Math.round(slack * 16))), true);
  dv.setUint8(o + 6, late & 0xff);
  dv.setUint8(o + 7, flags);
  return buf;
}

// The per-recipient trailer, stamped onto a copy of a shared bundle body.
export function stampTrailer(buf, { inAck, slack, late, flags = 0 }) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const o = buf.length - 8;
  dv.setUint32(o, inAck >>> 0, true);
  dv.setInt16(o + 4, Math.max(-32768, Math.min(32767, Math.round(slack * 16))), true);
  dv.setUint8(o + 6, late & 0xff);
  dv.setUint8(o + 7, flags);
  return buf;
}

export function decodeBundle(buf) {
  if (buf.length < 16 || buf[0] !== T_BUNDLE) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nb = dv.getUint8(1);
  const np = dv.getUint8(2);
  const ne = dv.getUint8(3);
  const T = dv.getUint32(4, true);
  if (buf.length < 8 + nb * np * 4 + 2 * ne + 8) return null;
  const rows = [];
  for (let k = 0; k < nb; k++) {
    const row = new Uint32Array(np);
    for (let p = 0; p < np; p++) row[p] = dv.getUint32(8 + 4 * (k * np + p), true);
    rows.push(row);
  }
  const events = [];
  let o = 8 + nb * np * 4;
  for (let i = 0; i < ne; i++) {
    const slot = dv.getUint8(o++);
    const b = dv.getUint8(o++);
    events.push({ slot, kind: b >> 4, tick: T - (b & 0xf) });
  }
  o = buf.length - 8;
  return { T, nb, np, rows, events, inAck: dv.getUint32(o, true), slack: dv.getInt16(o + 4, true) / 16, late: dv.getUint8(o + 6), flags: dv.getUint8(o + 7) };
}

export function encodeHello({ maxDatagram, wasmPrefix, room = 0, nonce = 0 }) {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_HELLO);
  dv.setUint8(1, PROTO);
  dv.setUint16(2, maxDatagram, true);
  buf.set(wasmPrefix.subarray(0, 8), 4);
  dv.setUint32(12, room, true);
  dv.setUint32(16, nonce >>> 0, true);
  return buf;
}

export function decodeHello(buf) {
  if (buf.length < 24 || buf[0] !== T_HELLO) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { proto: dv.getUint8(1), maxDatagram: dv.getUint16(2, true), wasmPrefix: buf.slice(4, 12), room: dv.getUint32(12, true), nonce: dv.getUint32(16, true) };
}

export function encodeWelcome({ slot, maxDatagram, joinTick, seed, serverTick, roomStart = 0, token = 0 }) {
  const buf = new Uint8Array(32);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_WELCOME);
  dv.setUint8(1, slot);
  dv.setUint16(2, maxDatagram, true);
  dv.setUint32(4, joinTick, true);
  dv.setUint32(8, seed, true);
  dv.setUint32(12, serverTick, true);
  dv.setUint32(16, TICK_US, true);
  dv.setUint8(20, SEND_EVERY);
  dv.setUint8(21, NB);
  dv.setUint8(22, NP);
  dv.setUint32(24, roomStart, true);
  dv.setUint32(28, token >>> 0, true);
  return buf;
}

export function decodeWelcome(buf) {
  if (buf.length >= 4 && buf[0] === T_REJECT) return { reject: buf[1] };
  if (buf.length < 32 || buf[0] !== T_WELCOME) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    slot: dv.getUint8(1), maxDatagram: dv.getUint16(2, true), joinTick: dv.getUint32(4, true), seed: dv.getUint32(8, true),
    serverTick: dv.getUint32(12, true), tickUs: dv.getUint32(16, true), sendEvery: dv.getUint8(20), nb: dv.getUint8(21), np: dv.getUint8(22),
    roomStart: dv.getUint32(24, true), token: dv.getUint32(28, true),
  };
}

// The client's 16-byte stream messages: sync and ping.
export function encodeSync(reason, have) {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_SYNC);
  dv.setUint8(1, reason);
  dv.setUint32(4, have >>> 0, true);
  return buf;
}

export function encodePing(nonce) {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_PING);
  dv.setUint32(4, nonce >>> 0, true);
  return buf;
}

export function decodeClient(buf) {
  if (buf.length < 16) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf[0] === T_SYNC) return { type: T_SYNC, reason: buf[1], have: dv.getUint32(4, true) };
  if (buf[0] === T_PING) return { type: T_PING, nonce: dv.getUint32(4, true) };
  return null;
}

export function encodePong(nonce, serverTick) {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_PONG);
  dv.setUint32(4, nonce >>> 0, true);
  dv.setFloat64(8, serverTick, true);
  return buf;
}

// A keyframe's head: 16 B, plus the bad interval and the referee's 128 slice
// digests for a desync. digests: a 1,024-byte Uint8Array.
/** @param {{ reason: number, tick: number, raw: number, packed: number, interval?: number, digests?: Uint8Array | null }} k */
export function encodeKeyHead({ reason, tick, raw, packed, interval = 0, digests = null }) {
  const desync = reason === SYNC.DESYNC;
  const buf = new Uint8Array(16 + (desync ? 8 + 1024 : 0));
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_KEY);
  dv.setUint8(1, reason);
  dv.setUint32(4, tick >>> 0, true);
  dv.setUint32(8, raw, true);
  dv.setUint32(12, packed, true);
  if (desync) { dv.setUint32(16, interval >>> 0, true); buf.set(digests.subarray(0, 1024), 24); }
  return buf;
}

// The server's stream messages after the welcome, read whole:
// { type, from, n, body } for a fill; { type, reason, tick, raw, interval, digests, packed } for a key; { type, nonce, serverTick } for a pong.
export async function readControl(sr) {
  const head = await sr.read(16);
  if (head.length < 16) return null;
  const dv = new DataView(head.buffer, head.byteOffset, 16);
  if (head[0] === T_FILL) {
    const h = decodeFillHead(head);
    return { type: T_FILL, from: h.from, n: h.n, body: (await sr.read(h.bytes)).slice() };
  }
  if (head[0] === T_KEY) {
    const m = { type: T_KEY, reason: head[1], tick: dv.getUint32(4, true), raw: dv.getUint32(8, true), interval: -1, digests: null };
    if (m.reason === SYNC.DESYNC) {
      const extra = await sr.read(8 + 1024);
      m.interval = new DataView(extra.buffer, extra.byteOffset, 8).getUint32(0, true);
      m.digests = extra.slice(8);
    }
    m.packed = (await sr.read(dv.getUint32(12, true))).slice();
    return m;
  }
  if (head[0] === T_PONG) return { type: T_PONG, nonce: dv.getUint32(4, true), serverTick: dv.getFloat64(8, true) };
  throw new Error(`unknown control message 0x${head[0].toString(16)}`);
}

// One closed tick as the record keeps it: events [{ slot, kind }], words [[slot, word]].
export function encodeTick(events, words) {
  const buf = new Uint8Array(2 + 2 * events.length + 5 * words.length);
  const dv = new DataView(buf.buffer);
  let o = 0;
  buf[o++] = events.length;
  for (const e of events) { buf[o++] = e.slot; buf[o++] = e.kind; }
  buf[o++] = words.length;
  for (const [slot, w] of words) { buf[o++] = slot; dv.setUint32(o, w >>> 0, true); o += 4; }
  return buf;
}

export function encodeFill(from, ticks) {
  const bytes = ticks.reduce((a, t) => a + t.length, 0);
  const buf = new Uint8Array(16 + bytes);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_FILL);
  dv.setUint32(4, from >>> 0, true);
  dv.setUint32(8, ticks.length, true);
  dv.setUint32(12, bytes, true);
  let o = 16;
  for (const t of ticks) { buf.set(t, o); o += t.length; }
  return buf;
}

export function decodeFillHead(buf) {
  if (buf.length < 16 || buf[0] !== T_FILL) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { from: dv.getUint32(4, true), n: dv.getUint32(8, true), bytes: dv.getUint32(12, true) };
}

// The ticks of a fill body: [{ tick, events: [{ slot, kind }], words: [[slot, word]] }].
export function decodeFillBody(from, n, body) {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const out = [];
  let o = 0;
  for (let k = 0; k < n && o < body.length; k++) {
    const events = [];
    const words = [];
    const ne = body[o++];
    for (let i = 0; i < ne; i++) { events.push({ slot: body[o], kind: body[o + 1] }); o += 2; }
    const nw = body[o++];
    for (let i = 0; i < nw; i++) { words.push([body[o], dv.getUint32(o + 1, true)]); o += 5; }
    out.push({ tick: from + k, events, words });
  }
  return out;
}

// One closed tick from the record: { events, words }.
export const decodeTick = (bytes) => decodeFillBody(0, 1, bytes)[0];

// A repair: as many of `ticks` (consecutive, from `from`, as the record keeps
// them) as fit in `max` bytes. Returns { buf, n }.
export function encodeRepair(from, ticks, max = MAX_DATAGRAM) {
  let n = 0;
  let bytes = 8;
  while (n < ticks.length && n < 255 && bytes + ticks[n].length <= max) bytes += ticks[n++].length;
  const buf = new Uint8Array(bytes);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_REPAIR);
  dv.setUint8(1, n);
  dv.setUint32(4, from >>> 0, true);
  let o = 8;
  for (let k = 0; k < n; k++) { buf.set(ticks[k], o); o += ticks[k].length; }
  return { buf, n };
}

export function decodeRepair(buf) {
  if (buf.length < 8 || buf[0] !== T_REPAIR) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return decodeFillBody(dv.getUint32(4, true), buf[1], buf.subarray(8));
}

// Keyframes: the region with the bytes of its f32 arrays (PX to VZ) grouped by
// significance, since nearby floats share their high bytes, then gzipped.
const SHUF_LO = 0x10000; // PX - REGION
const SHUF_HI = 0x70000; // FLAGS - REGION
export function shuffle(region, back = false) {
  const out = region.slice();
  const n = (SHUF_HI - SHUF_LO) >> 2;
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < 4; b++) {
      const word = SHUF_LO + 4 * i + b;
      const plane = SHUF_LO + b * n + i;
      if (back) out[word] = region[plane];
      else out[plane] = region[word];
    }
  }
  return out;
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export const packKey = (region) => pipe(shuffle(region), new CompressionStream('gzip'));
export const unpackKey = async (packed) => shuffle(await pipe(packed, new DecompressionStream('gzip')), true);

export const encodeReject = (reason) => new Uint8Array([T_REJECT, reason, 0, 0]);

// A stream reader that keeps what it over-reads, since handshake messages
// may arrive split or glued together.
export function bufferedReader(reader) {
  let buf = new Uint8Array(0);
  return {
    async read(n) {
      while (buf.length < n) {
        const { value, done } = await reader.read();
        if (done) break;
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf, 0);
        next.set(value, buf.length);
        buf = next;
      }
      const out = buf.subarray(0, Math.min(n, buf.length));
      buf = buf.subarray(out.length);
      return out;
    },
    // reads and discards until the stream ends
    async drain() {
      for (;;) {
        const { done } = await reader.read();
        if (done) return;
      }
    },
  };
}

export async function wasmPrefix(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).subarray(0, 8);
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
