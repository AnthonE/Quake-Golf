// The online client: see online.h. Every rule here is the browser client's,
// cited by its file: the wire (net/wire.mjs), the input lead and the playout
// clock (client/net.mjs), the confirmed world, resyncs and hash reports
// (client/sim.mjs), one closed tick into the inbox (net/inbox.mjs).
#include "online.h"
#include "plat.h"
#include "inflate.h"
#include "qg_sim.h"
#include "layout.h"

typedef uint32_t __attribute__((may_alias)) au32;
typedef uint64_t __attribute__((may_alias)) au64;
#define U(a) (*(au32 *)(qg_mem + (a)))

// net/wire.mjs
enum { T_INPUT = 0x01, T_BUNDLE = 0x02, T_REPAIR = 0x03, T_HELLO = 0x10, T_WELCOME = 0x11, T_SYNC = 0x12, T_FILL = 0x13,
       T_KEY = 0x14, T_PING = 0x15, T_PONG = 0x16, T_REJECT = 0x1f };
enum { SYNC_JOIN = 0, SYNC_HOLE = 1, SYNC_BEHIND = 2, SYNC_DESYNC = 3 };
enum { PROTO = 3, SEND_EVERY = 2, NB = 4, NP = 64, MAX_INPUTS = 64, MAX_DATAGRAM = 1400 };
#define TICK_MS 8.0
// client/sim.mjs
#define HOLE_TICKS 56
#define BEHIND_TICKS 250

static uint32_t rd16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static uint32_t rd32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint64_t rd64(const uint8_t *p) { return rd32(p) | ((uint64_t)rd32(p + 4) << 32); }
static void wr16(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void wr32(uint8_t *p, uint32_t v) { for (int k = 0; k < 4; k++) p[k] = (uint8_t)(v >> (8 * k)); }
static void wr64(uint8_t *p, uint64_t v) { wr32(p, (uint32_t)v); wr32(p + 4, (uint32_t)(v >> 32)); }
static double rdf64(const uint8_t *p) { union { uint64_t u; double d; } x = { rd64(p) }; return x.d; }
static void zero(void *p, uint32_t n) { uint8_t *b = p; while (n--) *b++ = 0; }
static void copy(void *d, const void *s, uint32_t n) { uint8_t *a = d; const uint8_t *b = s; while (n--) *a++ = *b++; }
static double clampd(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }
static double fabsd(double x) { return x < 0 ? -x : x; }
static int32_t ifloor(double x) { int32_t i = (int32_t)x; return (double)i > x ? i - 1 : i; }

static double server_tick(const Online *o, double now) { return o->sBase + (now - o->sEpoch) / TICK_MS; }
double online_server_tick(const Online *o, double now) { return server_tick(o, now); }
static double play_tick(const Online *o, double now) { return o->playBase + (now - o->playEpoch) * o->playRate / TICK_MS; }
// the next sim tick to step, as a server tick
#define AT(o) ((int32_t)((o)->roomStart + U(QG_HDR_TICK)))

static void stream(Online *o, const uint8_t *b, uint32_t n) {
  if (plat_stream_send(b, n) < 0 && o->state != ON_FAILED) { o->state = ON_FAILED; o->error = "the server closed the connection"; }
}

void online_start(Online *o, const uint8_t prefix[8], uint8_t *rx, uint32_t rxCap) {
  zero(o, sizeof *o);
  o->rx = rx;
  o->rxCap = rxCap;
  o->slot = -1;
  o->newest = -1;
  o->storeNewest = -1;
  o->lastBundleT = -1;
  o->syncAt = -1e9;
  for (int k = 0; k < 1024; k++) o->seen[k] = -1;
  for (int k = 0; k < ON_STORE; k++) o->store[k].tick = -1;
  uint8_t hello[24];
  zero(hello, sizeof hello);
  hello[0] = T_HELLO;
  hello[1] = PROTO;
  wr16(hello + 2, MAX_DATAGRAM);
  copy(hello + 4, prefix, 8);
  wr32(hello + 16, (uint32_t)plat_now_ms());
  o->tHello = plat_now_ms();
  o->state = ON_HELLO;
  stream(o, hello, sizeof hello);
}

void online_leave(Online *o) {
  plat_close();
  if (o->state != ON_FAILED) { o->state = ON_FAILED; o->error = "left"; }
}

// ---------------------------------------------------------------- receiving

// net/wire.mjs Received
static int has(const Online *o, int32_t t) { return t >= 0 && o->seen[t & 1023] == t; }
static int heard(Online *o, int32_t t) {
  if (t < 0 || has(o, t) || t <= o->newest - 1024) return 0;
  o->seen[t & 1023] = t;
  if (t > o->newest) o->newest = t;
  return 1;
}

static void keep(Online *o, const OnTick *d) {
  if (d->tick < AT(o)) return;
  OnTick *s = &o->store[d->tick & (ON_STORE - 1)];
  // a slot still holding a tick to step is not overwritten (that tick is 1,024 ahead: a hole, then a resync)
  if (s->tick == d->tick || (s->tick >= AT(o) && s->tick != d->tick)) return;
  *s = *d;
  if (d->tick > o->storeNewest) o->storeNewest = d->tick;
}

// first arrivals, for the playout clock: how long after it closed each tick reached us
static void arrived(Online *o, int32_t t, double now) { o->offsets[o->nOff++ & 255] = server_tick(o, now) - (t + 1); }

static double pct(const double *a, uint32_t n, double p) {
  double s[256];
  for (uint32_t i = 0; i < n; i++) {
    double v = a[i];
    uint32_t j = i;
    while (j && s[j - 1] > v) { s[j] = s[j - 1]; j--; }
    s[j] = v;
  }
  uint32_t k = (uint32_t)(p * n);
  return s[k < n ? k : n - 1];
}

// client/net.mjs steer: the earliest arrival less 2 ticks and the p95 jitter,
// run up to 3% fast or slow; a large error snaps
static void steer(Online *o, double now) {
  uint32_t n = o->nOff < 256 ? o->nOff : 256;
  if (!n) return;
  double early = 1e9;
  for (uint32_t i = 0; i < n; i++) if (o->offsets[i] < early) early = o->offsets[i];
  double jitter = pct(o->offsets, n, 0.95) - early;
  double target = server_tick(o, now) - early - (QG_PLAY_BASE + jitter);
  double atp = play_tick(o, now);
  double err = target - atp;
  if (fabsd(err) > 16 || n < 16) { o->playBase = target; o->playEpoch = now; o->playRate = 1; }
  else { o->playBase = atp; o->playEpoch = now; o->playRate = 1 + clampd(err / 16, -0.03, 0.03); }
}

// a tick as the record keeps it (fills and repairs): u8 ne | ne x (slot, kind) | u8 nw | nw x (slot, u32 word)
static uint32_t sparse(const uint8_t *b, uint32_t n, int32_t tick, OnTick *d) {
  uint32_t o = 0;
  d->tick = tick;
  d->dense = 0;
  if (o >= n) return 0;
  uint32_t ne = b[o++];
  d->ne = 0;
  for (uint32_t i = 0; i < ne && o + 2 <= n; i++, o += 2) if (d->ne < 16) { d->ev[d->ne][0] = b[o]; d->ev[d->ne][1] = b[o + 1]; d->ne++; }
  if (o >= n) return 0;
  uint32_t nw = b[o++];
  d->nw = 0;
  for (uint32_t i = 0; i < nw && o + 5 <= n; i++, o += 5) if (d->nw < 64) { d->slot[d->nw] = b[o]; d->word[d->nw] = rd32(b + o + 1); d->nw++; }
  return o;
}

static void on_datagram(Online *o, const uint8_t *b, uint32_t n, double now) {
  OnTick d;
  if (n >= 8 && b[0] == T_REPAIR) {
    uint32_t count = b[1], from = rd32(b + 4), off = 8;
    o->repairs++;
    for (uint32_t k = 0; k < count && off < n; k++) {
      uint32_t used = sparse(b + off, n - off, (int32_t)(from + k), &d);
      if (!used) break;
      off += used;
      if (d.tick >= (int32_t)o->roomStart && heard(o, d.tick)) { keep(o, &d); arrived(o, d.tick, now); o->repairTicks++; }
    }
    return;
  }
  if (n < 16 || b[0] != T_BUNDLE) return;
  uint32_t nb = b[1], np = b[2], ne = b[3];
  int32_t T = (int32_t)rd32(b + 4);
  if (np > 64 || n < 8 + nb * np * 4 + 2 * ne + 8) return;
  o->bundles++;
  const uint8_t *ev = b + 8 + nb * np * 4;
  for (uint32_t k = 0; k < nb; k++) {
    int32_t t = T - (int32_t)k;
    if (t < (int32_t)o->roomStart || !heard(o, t)) continue;
    arrived(o, t, now);
    d.tick = t;
    d.dense = 1;
    d.ne = 0;
    for (uint32_t e = 0; e < ne; e++) if (T - (ev[2 * e + 1] & 15) == t && d.ne < 16) { d.ev[d.ne][0] = ev[2 * e]; d.ev[d.ne][1] = ev[2 * e + 1] >> 4; d.ne++; }
    d.nw = (uint8_t)np;
    for (uint32_t p = 0; p < np; p++) { d.slot[p] = (uint8_t)p; d.word[p] = rd32(b + 8 + 4 * (k * np + p)); }
    keep(o, &d);
  }
  steer(o, now);
  if (T > o->lastBundleT) o->lastBundleT = T;
  const uint8_t *tr = b + n - 8;
  uint32_t inAck = rd32(tr);
  if (inAck > o->inAck) o->inAck = inAck;
  // client/net.mjs: the lead, toward the relay's own jitter plus a send interval, 2% a tick at most
  double slack = (double)(int16_t)rd16(tr + 4) / 16;
  o->slacks[o->nSlack++ & 127] = slack;
  uint32_t ns = o->nSlack < 128 ? o->nSlack : 128;
  double target = pct(o->slacks, ns, 0.5) - pct(o->slacks, ns, 0.05) + SEND_EVERY * TICK_MS + 4;
  o->lead = clampd(o->lead + clampd(0.0025 * (target - slack), -0.04, 0.04), 1, 60);
}

// The region of a keyframe, after gunzip: the f32 arrays' bytes come grouped
// by significance (net/wire.mjs shuffle); put them back.
static uint8_t unpacked[QG_REGION_SIZE];
static void unshuffle(uint8_t *dst, const uint8_t *src) {
  const uint32_t lo = 0x10000, hi = 0x70000, n = (hi - lo) >> 2;
  copy(dst, src, lo);
  copy(dst + hi, src + hi, QG_REGION_SIZE - hi);
  for (uint32_t i = 0; i < n; i++)
    for (uint32_t b = 0; b < 4; b++) dst[lo + 4 * i + b] = src[lo + b * n + i];
}

// client/sim.mjs restore: the region at server tick `tick` (or the room's start), then the fill
static void restore(Online *o, uint32_t reason, uint32_t tick, uint32_t raw, const uint8_t *packed, uint32_t n) {
  if (raw) {
    int32_t got = gunzip(packed, n, unpacked, sizeof unpacked);
    if (got != (int32_t)QG_REGION_SIZE) { o->state = ON_FAILED; o->error = "a keyframe did not unpack"; return; }
    unshuffle(qg_mem + QG_REGION, unpacked);
    qg_regrid();
  } else qg_init(o->seed);
  if ((uint32_t)AT(o) != tick) { o->state = ON_FAILED; o->error = "a keyframe restored the wrong tick"; return; }
  for (int k = 0; k < ON_STORE; k++) if (o->store[k].tick >= 0 && o->store[k].tick < (int32_t)tick) o->store[k].tick = -1;
  if (o->keys < 16) { o->keyReason[o->keys] = reason; o->keyTick[o->keys] = tick - o->roomStart; }
  o->keys++;
  if (reason == SYNC_DESYNC) o->desyncs++;
  o->filling = 1;
  o->started = 1;
  o->repLeft = 0;
}

static void welcome(Online *o, const uint8_t *b, double now) {
  o->slot = b[1];
  o->joinTick = rd32(b + 4);
  o->seed = rd32(b + 8);
  uint32_t serverTick = rd32(b + 12);
  o->roomStart = rd32(b + 24);
  o->token = rd32(b + 28);
  // client/net.mjs: the server's tick from the welcome, refined by the pings' fastest round trip
  o->sBase = serverTick + 0.5 + (now - o->tHello) / 2 / TICK_MS;
  o->sEpoch = now;
  o->bestRtt = now - o->tHello;
  o->lead = o->bestRtt / 2 / TICK_MS + SEND_EVERY + 1;
  o->playBase = serverTick - 8.0;
  o->playEpoch = now;
  o->playRate = 1;
  o->nextTick = o->joinTick;
  o->lastSent = o->joinTick;
  for (int k = 0; k < 5; k++) o->pingAt[k] = now + 50.0 * k;
  qg_init(o->seed);
  o->state = ON_JOINING;
  // the first datagram tells the relay where to send bundles
  uint8_t d[24];
  zero(d, sizeof d);
  wr32(d, o->token);
  d[4] = T_INPUT;
  wr32(d + 8, o->joinTick);
  plat_datagram_send(d, sizeof d);
}

// Whole messages off the stream (net/wire.mjs readControl).
static void parse(Online *o, double now) {
  for (;;) {
    uint32_t used = 0;
    const uint8_t *b = o->rx;
    if (o->state == ON_HELLO) {
      if (o->rxLen >= 4 && b[0] == T_REJECT) {
        o->state = ON_FAILED;
        o->error = b[1] == 1 ? "this build's sim differs from the server's" : b[1] == 2 ? "the room is full" : "protocol mismatch";
        return;
      }
      if (o->rxLen < 32) return;
      if (b[0] != T_WELCOME) { o->state = ON_FAILED; o->error = "not a Quake Golf relay"; return; }
      welcome(o, b, now);
      used = 32;
    } else {
      if (o->rxLen < 16) return;
      if (b[0] == T_PONG) {
        o->pongs++;
        uint32_t k = rd32(b + 4);
        if (k < 5) {
          double rtt = now - o->pingAt[k];
          if (rtt < o->bestRtt) {
            o->bestRtt = rtt;
            o->sBase = rdf64(b + 8) + rtt / 2 / TICK_MS;
            o->sEpoch = now;
            o->lead = rtt / 2 / TICK_MS + SEND_EVERY + 1;
          }
        }
        used = 16;
      } else if (b[0] == T_FILL) {
        uint32_t from = rd32(b + 4), count = rd32(b + 8), bytes = rd32(b + 12);
        if (16 + bytes > o->rxCap) { o->state = ON_FAILED; o->error = "a fill too big for the buffer"; return; }
        if (o->rxLen < 16 + bytes) return;
        uint32_t off = 16;
        OnTick d;
        for (uint32_t k = 0; k < count && off < 16 + bytes; k++) {
          uint32_t u = sparse(b + off, 16 + bytes - off, (int32_t)(from + k), &d);
          if (!u) break;
          off += u;
          heard(o, d.tick);
          keep(o, &d);
        }
        o->fills++;
        o->fillTicks += count;
        o->filling = 0;
        used = 16 + bytes;
      } else if (b[0] == T_KEY) {
        uint32_t reason = b[1], tick = rd32(b + 4), raw = rd32(b + 8), packed = rd32(b + 12);
        uint32_t extra = reason == SYNC_DESYNC ? 8 + 1024 : 0;
        if (16 + extra + packed > o->rxCap) { o->state = ON_FAILED; o->error = "a keyframe too big for the buffer"; return; }
        if (o->rxLen < 16 + extra + packed) return;
        restore(o, reason, tick, raw, b + 16 + extra, packed);
        if (o->state == ON_FAILED) return;
        used = 16 + extra + packed;
      } else {
        o->state = ON_FAILED;
        o->error = "an unknown message from the server";
        return;
      }
    }
    // keep the rest
    for (uint32_t k = used; k < o->rxLen; k++) o->rx[k - used] = o->rx[k];
    o->rxLen -= used;
  }
}

// ---------------------------------------------------------------- sending

// client/net.mjs send: the words the relay hasn't closed, the acks, the newest report
static void send_inputs(Online *o) {
  int32_t first = (int32_t)o->inAck;
  if (o->lastBundleT > first) first = o->lastBundleT;
  if ((int32_t)o->joinTick - 1 > first) first = (int32_t)o->joinTick - 1;
  first++;
  int32_t from = first > (int32_t)o->nextTick - MAX_INPUTS ? first : (int32_t)o->nextTick - MAX_INPUTS;
  int32_t n = (int32_t)o->nextTick - from;
  if (n <= 0) return;
  uint8_t d[4 + 20 + 4 * MAX_INPUTS + 16];
  zero(d, 24);
  wr32(d, o->token);
  uint8_t *m = d + 4;
  m[0] = T_INPUT;
  m[1] = (uint8_t)n;
  wr16(m + 2, o->seq++);
  wr32(m + 4, (uint32_t)from);
  // acks: ack_tick the newest closed tick heard, bit k ack_tick-1-k
  uint32_t lo = 0, hi = 0;
  for (int k = 0; k < 32; k++) {
    if (has(o, o->newest - 1 - k)) lo |= 1u << k;
    if (has(o, o->newest - 33 - k)) hi |= 1u << k;
  }
  wr32(m + 8, o->newest > 0 ? (uint32_t)o->newest : 0);
  wr32(m + 12, lo);
  wr32(m + 16, hi);
  for (int32_t k = 0; k < n; k++) wr32(m + 20 + 4 * k, o->words[(from + k) & 255]);
  uint32_t len = 24 + 4 * (uint32_t)n;
  if (o->repLeft > 0) {
    o->repLeft--;
    wr32(d + len, o->repInterval);
    d[len + 4] = (uint8_t)o->keys;
    d[len + 5] = d[len + 6] = d[len + 7] = 0;
    wr64(d + len + 8, o->repHash);
    len += 16;
  }
  plat_datagram_send(d, len);
}

static void sync_request(Online *o, uint32_t reason, uint32_t have) {
  uint8_t m[16];
  zero(m, sizeof m);
  m[0] = T_SYNC;
  m[1] = (uint8_t)reason;
  wr32(m + 4, have);
  stream(o, m, sizeof m);
  o->syncs++;
}

// ---------------------------------------------------------------- the confirmed world

// net/inbox.mjs feedTick: joins and leaves as listed, then an input record per word
static void feed(const OnTick *d) {
  uint32_t n = 0;
  uint8_t *r;
  for (uint32_t e = 0; e < d->ne; e++) {
    uint32_t kind = d->ev[e][1] == 1 ? QG_EV_JOIN : d->ev[e][1] == 2 ? QG_EV_LEAVE : 0;
    if (!kind) continue;
    r = qg_mem + QG_INBOX_REC + n++ * QG_REC;
    zero(r, QG_REC);
    r[4] = (uint8_t)kind;
    r[5] = d->ev[e][0];
  }
  for (uint32_t w = 0; w < d->nw; w++) {
    r = qg_mem + QG_INBOX_REC + n++ * QG_REC;
    zero(r, QG_REC);
    r[4] = QG_EV_INPUT;
    r[5] = d->slot[w];
    wr32(r + 8, d->word[w]);
  }
  U(QG_INBOX) = n;
}

static void step(Online *o, double now, double budget) {
  int32_t target = ifloor(play_tick(o, now)) - (int32_t)o->roomStart;
  int32_t k = (int32_t)U(QG_HDR_TICK);
  double t1 = plat_now_ms();
  while (k < target && plat_now_ms() - t1 < budget) {
    OnTick *d = &o->store[(o->roomStart + (uint32_t)k) & (ON_STORE - 1)];
    if (d->tick != (int32_t)o->roomStart + k) break;
    feed(d);
    d->tick = -1;
    qg_step();
    o->stepped++;
    k++;
    if ((int32_t)U(QG_INTERVAL_TICK) == k) {
      o->repInterval = (uint32_t)k;
      o->repHash = *(au64 *)(qg_mem + QG_INTERVAL_HASH);
      o->repLeft = 8;
      o->hashTick[o->nHash % ON_KEEP] = (uint32_t)k;
      o->hash[o->nHash % ON_KEEP] = o->repHash;
      o->nHash++;
    }
  }
  // a hole repairs couldn't fill, or a world too far behind: start again from a keyframe
  int32_t next = (int32_t)o->roomStart + k;
  if (!o->filling && now - o->syncAt > 1500) {
    int why = -1;
    if (o->store[next & (ON_STORE - 1)].tick != next && o->storeNewest - next >= HOLE_TICKS) why = SYNC_HOLE;
    else if (target - k > BEHIND_TICKS) why = SYNC_BEHIND;
    if (why >= 0) { sync_request(o, (uint32_t)why, (uint32_t)next); o->syncAt = now; }
  }
  o->state = target - k > 16 ? ON_CATCHING_UP : ON_PLAYING;
}

// ---------------------------------------------------------------- the loop

void online_poll(Online *o, Local *l, const Pad *pad, double budget) {
  if (o->state == ON_FAILED) return;
  double now = plat_now_ms();
  static uint8_t dg[2048];
  int n;
  while ((n = plat_datagram_recv(dg, sizeof dg)) > 0) if (o->state != ON_HELLO) on_datagram(o, dg, (uint32_t)n, now);
  while (o->rxLen < o->rxCap && (n = plat_stream_recv(o->rx + o->rxLen, o->rxCap - o->rxLen)) != 0) {
    if (n < 0) { o->state = ON_FAILED; o->error = "the server closed the connection"; return; }
    o->rxLen += (uint32_t)n;
    parse(o, now);
    if (o->state == ON_FAILED) return;
  }
  if (o->state == ON_HELLO) return;
  // five pings at join: the clock sync
  for (; o->pings < 5 && now >= o->pingAt[o->pings]; o->pings++) {
    uint8_t m[16];
    zero(m, sizeof m);
    m[0] = T_PING;
    wr32(m + 4, (uint32_t)o->pings);
    o->pingAt[o->pings] = now;
    stream(o, m, sizeof m);
  }
  // inputs: one word a tick as the predicted clock passes it, sent every second tick
  int32_t predicted = ifloor(server_tick(o, now) + o->lead);
  if ((int32_t)o->nextTick <= predicted) {
    // face the cup on a new hole, as the browser does
    uint32_t pb = QG_PLAYERS + 64u * (uint32_t)o->slot;
    if (o->started && (qg_mem[pb + QG_P_FL] & QG_PF_LIVE) && o->faced != U(QG_HDR_HOLE) + 1) {
      o->faced = U(QG_HDR_HOLE) + 1;
      pad_face(l);
    }
    while ((int32_t)o->nextTick <= predicted) { o->words[o->nextTick & 255] = pad_word(l, pad, 1); o->nextTick++; }
    if (o->nextTick - o->lastSent >= SEND_EVERY) { o->lastSent = o->nextTick; send_inputs(o); }
  }
  if (o->started) step(o, now, budget);
}

int online_predict(Online *o, Local *l, const Pad *pad) {
  if (o->state != ON_PLAYING || o->slot < 0) return -1;
  uint32_t pb = QG_PLAYERS + 64u * (uint32_t)o->slot;
  if (!(qg_mem[pb + QG_P_FL] & QG_PF_LIVE)) return -1;
  int32_t from = AT(o);
  int32_t n = (int32_t)o->nextTick - from;
  if (n < 0 || n > 200) return -1;
  for (int32_t i = 0; i < n; i++) U(QG_PWORDS + 4 * (uint32_t)i) = o->words[(from + i) & 255];
  U(QG_PWORDS + 4 * (uint32_t)n) = pad_word(l, pad, 0);
  qg_predict((uint32_t)o->slot, (uint32_t)n + 1);
  return n + 1;
}
