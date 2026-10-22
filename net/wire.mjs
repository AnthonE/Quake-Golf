// Wire format v4, little-endian. Shared by the relay, the bots, the browser
// client and (in C) the Xbox's. Rooms hold 256 players.
//
// Input word (32 bits): yaw b0-13 | pitch b14-23 | move b24-27 (forward, back, left, right) | jump b28 | shot counter b29-30 | weapon b31
//
// A closed tick, as everything after the relay carries it (bundles, repairs,
// fills, the relay's record, the referee): the joins and leaves, then only the
// input words that changed since the tick before, each against that slot's
// previous word (0 for a slot nobody held), bit-packed most significant bit first:
//   ne EG0 | ne x (slot 8, kind 2) | nc EG0 | nc x (gap EG0 | yaw? pitch? high? 3 x 1
//   | yaw delta zz-EG3 | pitch delta zz-EG1 | high byte 8)
// gap counts the slots skipped since the last change (the first from slot 0),
// the yaw delta wraps at 2^14, zz is the zigzag map and EGk Exp-Golomb of order
// k; each field only if its bit says it changed. The sim keeps a player's
// last word until a new one comes, so an unchanged word needs no record. A
// tick too big for one datagram is cut by slot into parts of at most PART_MAX
// bytes, each coded the same way (its first gap from slot 0 again), the events
// in part 0. Whoever applies ticks keeps the 256 words they are coded against
// (TickBase), so they apply in order, as a lockstep world steps them anyway;
// after a keyframe, the base is each live player's last input in the region.
//
// Input datagram, client to server (20 + 4n B, + 16 with a hash report):
//   0 u8 0x01 | 1 u8 n | 2 u16 seq | 4 u32 first_tick | 8 u32 ack_tick | 12 u64 ack_bits | 20 n x u32 words
//   [| u32 interval | u8 epoch | 3 B 0 | u64 hash]
//   Words only for ticks the server hasn't closed. The ack is per closed tick,
//   however it came: ack_tick is the newest, ack_bits bit k = has tick
//   ack_tick-1-k, so a hole can be repaired until it is 64 ticks old. A report is the client's hash of the interval that closed at
//   sim tick `interval`, after it had restored `epoch` keyframes (mod 256).
//
// Ticks datagrams, server to client: a bundle, every second tick, carries the
// newest NB ticks in as many datagrams as their parts need, each with the
// recipient's trailer; a repair carries ticks a client's acks lack:
//   0 u8 0x02 bundle, 0x03 repair | 1 u8 n | 2 u16 0 | 4 u32 from
//   | n x (u8 tick - from | u8 part << 4 | parts | u16 bytes | the part)
//   | a bundle's trailer: u32 in_ack | i16 slack (1/16 ms, negative = late) | u8 late | u8 flags
// A tick counts as arrived once all its parts have, from any datagrams.
//
// Handshake on a client-opened bidirectional stream, which stays open for the
// whole session; the client ending it means it has left (a native client, the
// Xbox, uses a TCP connection to the relay's native port as the stream):
//   hello   (24 B): 0x10 | proto | u16 client max datagram | u8[8] sha-256(game.wasm) prefix | u32 room | u32 nonce | u8 flags (1: watch) | 3 B 0
//   welcome (32 B): 0x11 | slot | u16 server max datagram | u32 join_tick | u32 seed | u32 server_tick | u32 tick_us | u8 send_every | u8 nb | u16 np | u32 room_start | u32 token
//   watching (32 B): 0x17, then as a welcome with slot 0: a spectator's
//   reject  (4 B):  0x1f | reason (1 wasm mismatch, 2 room full, 3 protocol, 4 spectators only, 5 nothing to watch yet) | 0 | 0
// A spectator holds no slot and sends no words: its input datagrams carry
// only its acks and hash reports, and it gets bundles, repairs and keyframes
// as a player does. An edge relay (net/relay.ts --upstream) is one, and serves
// a room it watches to spectators of its own.
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
//        u8 parts | parts x (u16 bytes | the part)
//   pong (16 B): 0x16 | 0 | 0 | 0 | u32 nonce | f64 the server's tick when it answered, fractional
//
// Native clients (net/relay.ts --native-port, TCP and UDP on one number): the
// stream above is the TCP connection; datagrams are UDP to the same port, the
// server's exactly as above, the client's each prefixed with the welcome's u32
// token (0 for WebTransport sessions), which is how the relay finds the session
// and the address to send bundles to.

import * as L from '../src/layout.mjs';

export const PROTO = 4;
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
export const T_WATCHING = 0x17;
export const T_REJECT = 0x1f;
export const REJECT = { WASM: 1, FULL: 2, PROTO: 3, WATCH_ONLY: 4, EMPTY: 5 };
export const HELLO_WATCH = 1;
// why a keyframe is sent: a join, or a resync for an old hole, a client far behind, or a hash mismatch
export const SYNC = { JOIN: 0, HOLE: 1, BEHIND: 2, DESYNC: 3 };
export const EV_JOIN = 1;
export const EV_LEAVE = 2;

export const TICK_US = 8000;
export const TICK_MS = TICK_US / 1000;
export const SEND_EVERY = 2;
export const NB = 4;
export const NP = 256;
export const PART_MAX = 1000; // bytes of one part of a tick: one fits any datagram with its headers and a trailer
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
/** @param {{ seq: number, firstTick: number, ackTick: number, ackBits: bigint, words: ArrayLike<number>, report?: { interval: number, epoch: number, hash: bigint } | null }} m */
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

// Bits, most significant first, for the tick code.
class BitWriter {
  constructor(bytes) { this.buf = new Uint8Array(bytes); this.pos = 0; }
  put(v, n) {
    for (let i = n - 1; i >= 0; i--) {
      if ((v >>> i) & 1) this.buf[this.pos >> 3] |= 0x80 >> (this.pos & 7);
      this.pos++;
    }
  }
  // Exp-Golomb of order k, v >= 0
  eg(v, k) {
    const x = v + (1 << k);
    const nb = 32 - Math.clz32(x);
    this.pos += nb - 1 - k;
    this.put(x, nb);
  }
  bytes() { return this.buf.slice(0, (this.pos + 7) >> 3); }
}

class BitReader {
  constructor(bytes) { this.b = bytes; this.pos = 0; this.end = bytes.length * 8; }
  get(n) {
    if (this.pos + n > this.end) throw new Error('a tick ran past its bytes');
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) v = (v << 1) | ((this.b[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
    return v >>> 0;
  }
  eg(k) {
    let z = 0;
    while (this.get(1) === 0) if (++z > 24) throw new Error('a tick holds a bad code');
    return ((1 << (z + k)) >>> 0) + this.get(z + k) - (1 << k);
  }
}

const egBits = (v, k) => 2 * (32 - Math.clz32(v + (1 << k))) - 1 - k;
const zz = (v) => (v >= 0 ? 2 * v : -2 * v - 1);
const unzz = (u) => ((u >>> 1) ^ -(u & 1));
// a word against the slot's previous one: [yaw delta, pitch delta, high byte changed]
function delta(prev, cur) {
  let dy = (cur - prev) & 0x3fff;
  if (dy >= 0x2000) dy -= 0x4000;
  return [dy, ((cur >>> 14) & 0x3ff) - ((prev >>> 14) & 0x3ff), (cur >>> 24) !== (prev >>> 24)];
}
function changeBits(gap, d) {
  return egBits(gap, 0) + 3 + (d[0] ? egBits(zz(d[0]), 3) : 0) + (d[1] ? egBits(zz(d[1]), 1) : 0) + (d[2] ? 8 : 0);
}

// One closed tick: events [{ slot, kind }] and the words of every slot this
// tick (cur) and the tick before (prev), Uint32Array(NP) each, 0 for a slot
// nobody holds. Returns its parts, each at most `max` bytes.
export function encodeTick(events, prev, cur, max = PART_MAX) {
  const changed = [];
  for (let p = 0; p < NP; p++) if (cur[p] !== prev[p]) changed.push(p);
  const parts = [];
  let i = 0;
  do {
    const w = new BitWriter(max);
    const evs = parts.length ? [] : events;
    w.eg(evs.length, 0);
    for (const e of evs) { w.put(e.slot, 8); w.put(e.kind, 2); }
    // as many of the changes left as fit, nc's own code (at most 17 bits) included
    const budget = 8 * max - w.pos - 17;
    let n = 0, bits = 0, last = -1;
    while (i + n < changed.length) {
      const p = changed[i + n];
      const c = changeBits(p - last - 1, delta(prev[p], cur[p]));
      if (bits + c > budget) break;
      bits += c;
      last = p;
      n++;
    }
    w.eg(n, 0);
    last = -1;
    for (let k = 0; k < n; k++) {
      const p = changed[i + k];
      const [dy, dp, dh] = delta(prev[p], cur[p]);
      w.eg(p - last - 1, 0);
      w.put(dy ? 1 : 0, 1); w.put(dp ? 1 : 0, 1); w.put(dh ? 1 : 0, 1);
      if (dy) w.eg(zz(dy), 3);
      if (dp) w.eg(zz(dp), 1);
      if (dh) w.put(cur[p] >>> 24, 8);
      last = p;
    }
    i += n;
    parts.push(w.bytes());
  } while (i < changed.length);
  return parts;
}

// The words ticks are coded against, one per slot, for a receiver that applies
// them in order: each apply() moves it on a tick.
export class TickBase {
  constructor() { this.w = new Uint32Array(NP); }
  reset() { this.w.fill(0); return this; }
  // From a region (u8, which holds the region at `at`): each live player's last
  // input, the base the tick after a keyframe is coded against.
  seed(u8, at = L.REGION) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let p = 0; p < NP; p++) {
      const o = L.PLAYERS - at + p * L.PSIZE;
      this.w[p] = u8[o + L.P_FL] & L.PF_LIVE ? dv.getUint32(o + L.P_IN, true) : 0;
    }
    return this;
  }
  // One tick's parts: { events: [{ slot, kind }], words: [[slot, word]] }, the words that changed.
  apply(parts) {
    const events = [], words = [];
    for (const bytes of parts) {
      const r = new BitReader(bytes);
      for (let ne = r.eg(0); ne > 0; ne--) events.push({ slot: r.get(8), kind: r.get(2) });
      let p = -1;
      for (let nc = r.eg(0); nc > 0; nc--) {
        p += r.eg(0) + 1;
        if (p >= NP) throw new Error('a tick names a slot past the room');
        const fy = r.get(1), fp = r.get(1), fh = r.get(1);
        const prev = this.w[p];
        const yaw = fy ? (prev + unzz(r.eg(3))) & 0x3fff : prev & 0x3fff;
        const pitch = fp ? (((prev >>> 14) & 0x3ff) + unzz(r.eg(1))) & 0x3ff : (prev >>> 14) & 0x3ff;
        const high = fh ? r.get(8) : prev >>> 24;
        const word = (yaw | (pitch << 14) | (high << 24)) >>> 0;
        this.w[p] = word;
        words.push([p, word]);
      }
    }
    return { events, words };
  }
}

// Ticks datagrams: ticks [{ tick, parts }], consecutive or not, packed in order
// into as few datagrams of at most `max` bytes as hold them, each opening with
// the first tick it carries. A bundle's leave room for the 8-byte trailer.
export function encodeTicks(type, ticks, max = MAX_DATAGRAM) {
  const room = max - (type === T_BUNDLE ? 8 : 0);
  const out = [];
  let cur = [], bytes = 8;
  const flush = () => {
    if (!cur.length) return;
    const buf = new Uint8Array(bytes + (type === T_BUNDLE ? 8 : 0));
    const dv = new DataView(buf.buffer);
    const from = cur[0].tick;
    buf[0] = type;
    buf[1] = cur.length;
    dv.setUint32(4, from >>> 0, true);
    let o = 8;
    for (const e of cur) {
      buf[o] = e.tick - from;
      buf[o + 1] = (e.part << 4) | e.parts;
      dv.setUint16(o + 2, e.bytes.length, true);
      buf.set(e.bytes, o + 4);
      o += 4 + e.bytes.length;
    }
    out.push(buf);
    cur = [];
    bytes = 8;
  };
  for (const t of ticks) {
    t.parts.forEach((part, k) => {
      const e = { tick: t.tick, part: k, parts: t.parts.length, bytes: part };
      if (cur.length && (bytes + 4 + part.length > room || cur.length === 255 || t.tick - cur[0].tick > 255)) flush();
      cur.push(e);
      bytes += 4 + part.length;
    });
  }
  flush();
  return out;
}

// { type, entries: [{ tick, part, parts, bytes }], trailer: { inAck, slack, late, flags } or null }
export function decodeTicks(buf) {
  if (buf.length < 8 || (buf[0] !== T_BUNDLE && buf[0] !== T_REPAIR)) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - (buf[0] === T_BUNDLE ? 8 : 0);
  const from = dv.getUint32(4, true);
  const entries = [];
  let o = 8;
  for (let k = 0; k < buf[1]; k++) {
    if (o + 4 > end) return null;
    const n = dv.getUint16(o + 2, true);
    if (o + 4 + n > end) return null;
    entries.push({ tick: from + buf[o], part: buf[o + 1] >> 4, parts: buf[o + 1] & 15, bytes: buf.subarray(o + 4, o + 4 + n) });
    o += 4 + n;
  }
  const trailer = buf[0] === T_BUNDLE
    ? { inAck: dv.getUint32(end, true), slack: dv.getInt16(end + 4, true) / 16, late: dv.getUint8(end + 6), flags: dv.getUint8(end + 7) } : null;
  return { type: buf[0], entries, trailer };
}

// The receive side of parts: a tick is whole once all of its have come.
export class Parts {
  constructor() { this.open = new Map(); }
  // the tick's parts once this entry completes it, else null
  add(e) {
    if (e.parts <= 1) return [e.bytes.slice()];
    let got = this.open.get(e.tick);
    if (!got || got.length !== e.parts) this.open.set(e.tick, got = new Array(e.parts).fill(null));
    got[e.part] = e.bytes.slice();
    if (got.some((x) => !x)) return null;
    this.open.delete(e.tick);
    return got;
  }
  forget(before) { for (const t of this.open.keys()) if (t < before) this.open.delete(t); }
}

// The per-recipient trailer, stamped onto a copy of a shared bundle datagram.
export function stampTrailer(buf, { inAck, slack, late, flags = 0 }) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const o = buf.length - 8;
  dv.setUint32(o, inAck >>> 0, true);
  dv.setInt16(o + 4, Math.max(-32768, Math.min(32767, Math.round(slack * 16))), true);
  dv.setUint8(o + 6, late & 0xff);
  dv.setUint8(o + 7, flags);
  return buf;
}

export function encodeHello({ maxDatagram, wasmPrefix, room = 0, nonce = 0, watch = false }) {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_HELLO);
  dv.setUint8(1, PROTO);
  dv.setUint16(2, maxDatagram, true);
  buf.set(wasmPrefix.subarray(0, 8), 4);
  dv.setUint32(12, room, true);
  dv.setUint32(16, nonce >>> 0, true);
  buf[20] = watch ? HELLO_WATCH : 0;
  return buf;
}

export function decodeHello(buf) {
  if (buf.length < 24 || buf[0] !== T_HELLO) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { proto: dv.getUint8(1), maxDatagram: dv.getUint16(2, true), wasmPrefix: buf.slice(4, 12), room: dv.getUint32(12, true), nonce: dv.getUint32(16, true), watch: !!(buf[20] & HELLO_WATCH) };
}

export function encodeWelcome({ slot, maxDatagram, joinTick, seed, serverTick, roomStart = 0, token = 0, watch = false }) {
  const buf = new Uint8Array(32);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, watch ? T_WATCHING : T_WELCOME);
  dv.setUint8(1, watch ? 0 : slot);
  dv.setUint16(2, maxDatagram, true);
  dv.setUint32(4, joinTick, true);
  dv.setUint32(8, seed, true);
  dv.setUint32(12, serverTick, true);
  dv.setUint32(16, TICK_US, true);
  dv.setUint8(20, SEND_EVERY);
  dv.setUint8(21, NB);
  dv.setUint16(22, NP, true);
  dv.setUint32(24, roomStart, true);
  dv.setUint32(28, token >>> 0, true);
  return buf;
}

export function decodeWelcome(buf) {
  if (buf.length >= 4 && buf[0] === T_REJECT) return { reject: buf[1] };
  if (buf.length < 32 || (buf[0] !== T_WELCOME && buf[0] !== T_WATCHING)) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const watch = buf[0] === T_WATCHING;
  return {
    watch, slot: watch ? -1 : dv.getUint8(1), maxDatagram: dv.getUint16(2, true), joinTick: dv.getUint32(4, true), seed: dv.getUint32(8, true),
    serverTick: dv.getUint32(12, true), tickUs: dv.getUint32(16, true), sendEvery: dv.getUint8(20), nb: dv.getUint8(21), np: dv.getUint16(22, true),
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

// A fill: consecutive ticks from `from`, each its parts (as encodeTick gives them).
export function encodeFill(from, ticks) {
  const bytes = ticks.reduce((a, parts) => a + 1 + parts.reduce((b, p) => b + 2 + p.length, 0), 0);
  const buf = new Uint8Array(16 + bytes);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, T_FILL);
  dv.setUint32(4, from >>> 0, true);
  dv.setUint32(8, ticks.length, true);
  dv.setUint32(12, bytes, true);
  let o = 16;
  for (const parts of ticks) {
    buf[o++] = parts.length;
    for (const p of parts) { dv.setUint16(o, p.length, true); buf.set(p, o + 2); o += 2 + p.length; }
  }
  return buf;
}

export function decodeFillHead(buf) {
  if (buf.length < 16 || buf[0] !== T_FILL) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { from: dv.getUint32(4, true), n: dv.getUint32(8, true), bytes: dv.getUint32(12, true) };
}

// The ticks of a fill body: [{ tick, parts }].
export function decodeFillBody(from, n, body) {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const out = [];
  let o = 0;
  for (let k = 0; k < n && o < body.length; k++) {
    const parts = [];
    for (let m = body[o++]; m > 0; m--) {
      const len = dv.getUint16(o, true);
      parts.push(body.slice(o + 2, o + 2 + len));
      o += 2 + len;
    }
    out.push({ tick: from + k, parts });
  }
  return out;
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
