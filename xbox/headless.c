// The Xbox game on Linux, without an Xbox: the game core (game.c) plays a
// scripted hole with scripted controllers, writes frames as PPM, the match's
// inbox records as a .qgl log, and a .qgh trace of every tick. The browser
// build replays the log and must land on the same hashes (test/xbox.test.mjs).
// With --online it plays on a relay instead, through online.c, the Xbox's own
// network code, and prints what it saw (net/run-x2.mjs grades it).
//
//   build/x86/xbox-headless --out traces/xbox [--players 2] [--ticks 1800] [--seed 7]
//   build/x86/xbox-headless --online 127.0.0.1:4434 --seconds 60 [--out dir] [--impair delay=60,jitter=10,loss=0.05] [--rng 1] [--flip S]
// --flip S flips bit 3 of this player's score total S seconds in, as net/run-m3.mjs
// does to a browser client: the referee must catch it and heal it with a keyframe.
#include "sys.h"
#include "qg_sim.h"
#include "layout.h"
#include "game.h"
#include "online.h"
#include "plat_linux.h"

typedef float __attribute__((may_alias)) af32;
#define F(a) (*(af32 *)(qg_mem + (a)))
#define U32(a) (*(volatile uint32_t *)(qg_mem + (a)))

void qg_rt_trap(uint32_t code) {
  Buf o = { .n = 0 };
  bs(&o, "sim trap "); bu(&o, code); bs(&o, " at tick "); bu(&o, U32(QG_HDR_TICK)); bs(&o, "\n");
  bflush(&o, 2);
  sys_exit(3);
}
uint32_t qg_rt_wait32(uint32_t a, uint32_t o, uint32_t e, uint32_t l, uint32_t h) { (void)a; (void)o; (void)e; (void)l; (void)h; return 1; }
uint32_t qg_rt_notify(uint32_t a, uint32_t o, uint32_t c) { (void)a; (void)o; (void)c; return 0; }

static uint32_t num(const char *s) { uint32_t v = 0; while (*s >= '0' && *s <= '9') v = v * 10 + (uint32_t)(*s++ - '0'); return v; }
static char *path(char *b, const char *dir, const char *name, int k) {
  char *e = b;
  while (*dir) *e++ = *dir++;
  *e++ = '/';
  while (*name) *e++ = *name++;
  if (k >= 0) { char t[8]; int n = 0; do { t[n++] = (char)('0' + k % 10); k /= 10; } while (k); while (n) *e++ = t[--n]; }
  *e = 0;
  return e;
}

#define W 320
#define H 240
static uint32_t frame[W * H];

static void ppm(const char *file) {
  static uint8_t out[32 + W * H * 3];
  uint32_t n = 0;
  const char *hdr = "P6\n320 240\n255\n";
  while (*hdr) out[n++] = (uint8_t)*hdr++;
  for (int k = 0; k < W * H; k++) { out[n++] = (uint8_t)(frame[k] >> 16); out[n++] = (uint8_t)(frame[k] >> 8); out[n++] = (uint8_t)frame[k]; }
  if (!writefile(file, out, n)) die("cannot write a frame");
}

static void *grab(uint32_t bytes) { return alloc(bytes); }

static int online_main(int argc, char **argv);

int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) if (seq(argv[i], "--online")) return online_main(argc, argv);
  const char *dir = "traces/xbox";
  uint32_t players = 1, ticks = 1800, seed = 7;
  for (int i = 1; i + 1 < argc; i++) {
    if (seq(argv[i], "--out")) dir = argv[++i];
    else if (seq(argv[i], "--players")) players = num(argv[++i]);
    else if (seq(argv[i], "--ticks")) ticks = num(argv[++i]);
    else if (seq(argv[i], "--seed")) seed = num(argv[++i]);
  }
  if (players < 1 || players > LOCAL_MAX) die("--players 1 to 4");

  static Match m;
  m.recCap = 8 * ticks + 64;
  m.rec = alloc(m.recCap * QG_REC);
  match_start(&m, seed, grab);
  uint64_t terrainHash = qg_terrain_hash();
  uint64_t *tickHashes = alloc(8 * ticks + 8);
  const uint32_t nInt = ticks / QG_NSLICE;
  uint64_t *intervalHashes = alloc(8 * nInt + 8);
  uint64_t *sliceDigests = alloc(8 * nInt * QG_NSLICE + 8);

  Pad pads[LOCAL_MAX];
  uint32_t playAt = 0, shotAt = 0, frames = 0;
  float ball0[LOCAL_MAX][3] = { { 0 } };
  char file[512];
  uint64_t renderNs = 0, simNs = 0;
  for (uint32_t t = 0; t < ticks; t++) {
    for (int k = 0; k < LOCAL_MAX; k++) { pads[k] = (Pad){ 0 }; pads[k].connected = k < (int)players; }
    for (uint32_t k = 0; k < players; k++) if (t == 2 + 6 * k) pads[k].buttons |= BTN_START;
    uint32_t state = U32(QG_HDR_STATE);
    if (state == QG_H_PLAY && !playAt) {
      playAt = t;
      for (uint32_t k = 0; k < players; k++) {
        uint32_t b = U32(QG_PLAYERS + 64 * k + QG_P_BALL);
        ball0[k][0] = F(QG_PX + 4 * b); ball0[k][1] = F(QG_PY + 4 * b); ball0[k][2] = F(QG_PZ + 4 * b);
      }
    }
    // look down the hole through the countdown; in its last half second line
    // up on a point just behind the ball (a rocket drive); after the shot,
    // follow the ball
    for (uint32_t k = 0; k < players; k++) {
      if (!m.p[k].joined) continue;
      uint32_t b = U32(QG_PLAYERS + 64 * k + QG_P_BALL);
      if (b >= QG_BALL_CAP) continue;
      float bx = F(QG_PX + 4 * b), by = F(QG_PY + 4 * b), bz = F(QG_PZ + 4 * b);
      uint32_t left = U32(QG_HDR_UNTIL) - U32(QG_HDR_TICK);
      if (state == QG_H_COUNT && left > 60) match_aim_at(&m, (int)k, F(QG_HDR_CUP), F(QG_HDR_CUP + 4) + 4, F(QG_HDR_CUP + 8));
      else if (!shotAt || t < shotAt + 8) {
        float dx = F(QG_HDR_DIR), dz = F(QG_HDR_DIR + 4);
        match_aim_at(&m, (int)k, bx - dx * 0.55f, by - QG_R, bz - dz * 0.55f);
      } else match_aim_at(&m, (int)k, bx, by + 1, bz);
    }
    // player 1 drives with the rocket; player 2 switches to the grenade first
    if (playAt && t == playAt + 20) shotAt = t;
    if (shotAt && t >= shotAt && t < shotAt + 3) pads[0].rt = 1;
    if (players > 1 && playAt && t == playAt + 10) pads[1].buttons |= BTN_Y;
    if (players > 1 && shotAt && t >= shotAt + 5 && t < shotAt + 8) pads[1].rt = 1;
    // then walk after it for a second and a half
    if (shotAt && t > shotAt + 200 && t < shotAt + 390) for (uint32_t k = 0; k < players; k++) pads[k].ly = 1;

    uint64_t s0 = now_ns();
    match_tick(&m, pads);
    simNs += now_ns() - s0;
    tickHashes[t] = qg_hash_region();
    if ((t + 1) % QG_NSLICE == 0) {
      uint32_t k = (t + 1) / QG_NSLICE - 1;
      intervalHashes[k] = *(volatile uint64_t *)(qg_mem + QG_INTERVAL_HASH);
      memcpy(sliceDigests + k * QG_NSLICE, qg_mem + QG_DIGESTS, QG_NSLICE * 8);
    }
    int shoot = t == 60 || t == 300 || (shotAt && (t == shotAt + 2 || t == shotAt + 40 || t == shotAt + 160 || t == shotAt + 400)) || t == ticks - 1;
    if (shoot) {
      uint64_t r0 = now_ns();
      match_render(&m, frame, W, W, H);
      renderNs += now_ns() - r0;
      path(file, dir, "frame-", (int)t);
      char *e = file; while (*e) e++;
      e[0] = '.'; e[1] = 'p'; e[2] = 'p'; e[3] = 'm'; e[4] = 0;
      ppm(file);
      frames++;
    }
  }

  // the log, and its hash through the net area the way the replay harness takes it
  uint32_t logLen = 32 + m.recCount * QG_REC;
  uint8_t *log = alloc(logLen);
  match_log_header(&m, ticks, log);
  memcpy(log + 32, m.rec, m.recCount * QG_REC);
  path(file, dir, "match.qgl", -1);
  if (!writefile(file, log, logLen)) die("cannot write the log");
  memcpy(qg_mem + QG_NET, log, logLen);
  uint64_t logHash = qg_xxh64(QG_NET, logLen, 0);

  uint32_t size = 128 + 8 * (ticks + nInt + nInt * QG_NSLICE);
  uint8_t *tr = alloc(size);
  tr[0] = 'Q'; tr[1] = 'G'; tr[2] = 'H'; tr[3] = '1';
  *(uint32_t *)(tr + 4) = ticks;
  *(uint32_t *)(tr + 8) = nInt;
  *(uint64_t *)(tr + 16) = terrainHash;
  *(uint64_t *)(tr + 24) = logHash;
  memcpy(tr + 32, "xbox game core, x86", 19);
  memcpy(tr + 128, tickHashes, 8 * ticks);
  memcpy(tr + 128 + 8 * ticks, intervalHashes, 8 * nInt);
  memcpy(tr + 128 + 8 * (ticks + nInt), sliceDigests, 8 * nInt * QG_NSLICE);
  path(file, dir, "match.qgh", -1);
  if (!writefile(file, tr, size)) die("cannot write the trace");

  Buf o = { .n = 0 };
  uint32_t r;
  bs(&o, "{\"ticks\":"); bu(&o, ticks); bs(&o, ",\"players\":"); bu(&o, players);
  bs(&o, ",\"playAt\":"); bu(&o, playAt); bs(&o, ",\"shotAt\":"); bu(&o, shotAt);
  bs(&o, ",\"records\":"); bu(&o, m.recCount); bs(&o, ",\"frames\":"); bu(&o, frames);
  bs(&o, ",\"msSimPerTick\":"); bmilli(&o, udiv64(udiv64(simNs, ticks, &r), 1000, &r));
  bs(&o, ",\"msPerFrame\":"); bmilli(&o, frames ? udiv64(udiv64(renderNs, frames, &r), 1000, &r) : 0);
  bs(&o, ",\"strokes\":[");
  for (uint32_t k = 0; k < players; k++) { if (k) bs(&o, ","); bu(&o, *(volatile uint16_t *)(qg_mem + QG_PLAYERS + 64 * k + QG_P_STROKES)); }
  bs(&o, "],\"ballMovedCm\":[");
  for (uint32_t k = 0; k < players; k++) {
    uint32_t b = U32(QG_PLAYERS + 64 * k + QG_P_BALL);
    float dx = F(QG_PX + 4 * b) - ball0[k][0], dz = F(QG_PZ + 4 * b) - ball0[k][2];
    float d2 = dx * dx + dz * dz, d;
    __asm__("sqrtss %1, %0" : "=x"(d) : "x"(d2));
    if (k) bs(&o, ",");
    bu(&o, (uint32_t)(d * 100));
  }
  bs(&o, "],\"tickHash\":\""); bx64(&o, tickHashes[ticks - 1]); bs(&o, "\"}\n");
  bflush(&o, 1);
  return 0;
}

// ---------------------------------------------------------------- online

// "delay=60,jitter=10,loss=0.05" (loss as a fraction, to three places)
static void parse_impair(const char *s) {
  while (*s) {
    const char *k = s;
    while (*s && *s != '=') s++;
    if (!*s) return;
    s++;
    double v = 0, scale = 0;
    for (; (*s >= '0' && *s <= '9') || *s == '.'; s++) {
      if (*s == '.') { scale = 1; continue; }
      v = v * 10 + (*s - '0');
      if (scale) scale *= 10;
    }
    if (scale) v /= scale;
    if (k[0] == 'd') imp.delay = v;
    else if (k[0] == 'j') imp.jitter = v;
    else if (k[0] == 'l') imp.loss = v;
    if (*s == ',') s++;
  }
}

static void hex64(Buf *o, uint64_t v) { bs(o, "\"0x"); bx64(o, v); bs(o, "\""); }

static int online_main(int argc, char **argv) {
  const char *server = 0, *dir = 0;
  uint32_t seconds = 60, flipAt = 0, flipTick = 0;
  for (int i = 1; i + 1 < argc; i++) {
    if (seq(argv[i], "--flip")) flipAt = num(argv[++i]);
    else if (seq(argv[i], "--online")) server = argv[++i];
    else if (seq(argv[i], "--seconds")) seconds = num(argv[++i]);
    else if (seq(argv[i], "--out")) dir = argv[++i];
    else if (seq(argv[i], "--impair")) parse_impair(argv[++i]);
    else if (seq(argv[i], "--rng")) imp.rng = num(argv[++i]) | 1;
  }
  if (!server || !plat_connect(server)) die("cannot reach the relay (--online a.b.c.d:port)");
  static Match m;
  static Online o;
  static uint8_t rx[1 << 20];
  match_start(&m, 1, grab);
  online_start(&o, qg_wasm_prefix, rx, sizeof rx);
  Local *l = &m.p[0];
  double t0 = plat_now_ms(), playAt = 0, shotAt = 0, framesAt = 0;
  uint32_t frames = 0, predicted = 0, predictions = 0;
  char file[512];
  while (plat_now_ms() - t0 < seconds * 1000.0) {
    double now = plat_now_ms();
    Pad pad = { 0 };
    pad.connected = 1;
    uint32_t state = U32(QG_HDR_STATE);
    int live = o.slot >= 0 && o.state == ON_PLAYING && (qg_mem[QG_PLAYERS + 64u * (uint32_t)o.slot + QG_P_FL] & QG_PF_LIVE);
    if (live) {
      uint32_t pb = QG_PLAYERS + 64u * (uint32_t)o.slot;
      uint32_t b = U32(pb + QG_P_BALL);
      if (state == QG_H_PLAY && !playAt) playAt = now;
      if (state != QG_H_PLAY) { playAt = 0; shotAt = 0; }
      if (b < QG_BALL_CAP) {
        float bx = F(QG_PX + 4 * b), by = F(QG_PY + 4 * b), bz = F(QG_PZ + 4 * b);
        float dx = F(QG_HDR_DIR), dz = F(QG_HDR_DIR + 4);
        // line up a rocket drive, take it a beat into play, then follow the ball and walk after it
        if (!shotAt) match_aim_from(&m, 0, (uint32_t)o.slot, bx - dx * 0.55f, by - QG_R, bz - dz * 0.55f);
        else match_aim_from(&m, 0, (uint32_t)o.slot, bx, by + 1, bz);
        if (playAt && !shotAt && now - playAt > 300) shotAt = now;
        if (shotAt && now - shotAt < 40) pad.rt = 1;
        if (shotAt && now - shotAt > 2500 && now - shotAt < 6000) pad.ly = 1;
        // then hop about: inputs that change every second, jumps included
        if (shotAt && now - shotAt > 6000) {
          uint32_t sec = (uint32_t)((now - shotAt) / 1000);
          pad.lx = sec & 1 ? 1 : -1;
          if (sec % 3 == 0) pad.buttons |= BTN_A;
        }
      }
    }
    if (flipAt && !flipTick && now - t0 > flipAt * 1000.0 && live && state == QG_H_PLAY) {
      qg_mem[QG_PLAYERS + 64u * (uint32_t)o.slot + QG_P_TOTAL] ^= 8;
      flipTick = U32(QG_HDR_TICK);
    }
    online_poll(&o, l, &pad, 12);
    if (o.state == ON_FAILED) break;
    m.netSlot = o.slot;
    int n = online_predict(&o, l, &pad);
    m.netPred = n > 0;
    if (n > 0) { predictions++; predicted += (uint32_t)n; }
    if (dir && now - framesAt > 5000 && o.state == ON_PLAYING) {
      framesAt = now;
      match_render(&m, frame, W, W, H);
      char name[24] = "online-s";
      char *e = name + 8;
      uint32_t s = (uint32_t)o.slot;
      if (s >= 10) *e++ = (char)('0' + s / 10);
      *e++ = (char)('0' + s % 10);
      *e++ = '-';
      *e = 0;
      path(file, dir, name, (int)((now - t0) / 1000));
      e = file; while (*e) e++;
      e[0] = '.'; e[1] = 'p'; e[2] = 'p'; e[3] = 'm'; e[4] = 0;
      ppm(file);
      frames++;
    }
    plat_sleep_ms(1);
  }
  online_leave(&o);

  Buf out = { .n = 0 };
  uint32_t r;
  bs(&out, "{\"slot\":"); bu(&out, (uint32_t)(o.slot < 0 ? 999 : o.slot));
  bs(&out, ",\"state\":"); bu(&out, (uint32_t)o.state);
  bs(&out, ",\"error\":\""); bs(&out, o.state == ON_FAILED && o.error && !seq(o.error, "left") ? o.error : ""); bs(&out, "\"");
  bs(&out, ",\"roomStart\":"); bu(&out, o.roomStart); bs(&out, ",\"joinTick\":"); bu(&out, o.joinTick); bs(&out, ",\"seed\":"); bu(&out, o.seed);
  bs(&out, ",\"keys\":[");
  for (int k = 0; k < o.keys && k < 16; k++) { if (k) bs(&out, ","); bs(&out, "["); bu(&out, o.keyReason[k]); bs(&out, ","); bu(&out, o.keyTick[k]); bs(&out, "]"); }
  bs(&out, "],\"fills\":"); bu(&out, o.fills); bs(&out, ",\"fillTicks\":"); bu(&out, o.fillTicks);
  bs(&out, ",\"bundles\":"); bu(&out, o.bundles); bs(&out, ",\"repairs\":"); bu(&out, o.repairs); bs(&out, ",\"repairTicks\":"); bu(&out, o.repairTicks);
  bs(&out, ",\"syncs\":"); bu(&out, o.syncs); bs(&out, ",\"desyncs\":"); bu(&out, o.desyncs); bs(&out, ",\"pongs\":"); bu(&out, o.pongs);
  bs(&out, ",\"stepped\":"); bu(&out, o.stepped); bs(&out, ",\"simTick\":"); bu(&out, U32(QG_HDR_TICK));
  bs(&out, ",\"rttMs\":"); bu(&out, (uint32_t)o.bestRtt); bs(&out, ",\"leadX10\":"); bu(&out, (uint32_t)(o.lead * 10));
  bs(&out, ",\"predictions\":"); bu(&out, predictions); bs(&out, ",\"meanPredicted\":"); bu(&out, predictions ? predicted / predictions : 0);
  bs(&out, ",\"strokes\":"); bu(&out, o.slot >= 0 ? *(volatile uint16_t *)(qg_mem + QG_PLAYERS + 64 * (uint32_t)o.slot + QG_P_STROKES) : 0);
  bs(&out, ",\"frames\":"); bu(&out, frames);
  bs(&out, ",\"flipTick\":"); bu(&out, flipTick);
  bs(&out, ",\"impair\":{\"sent\":"); bu(&out, impSent); bs(&out, ",\"dropped\":"); bu(&out, impDropped);
  bs(&out, ",\"received\":"); bu(&out, impRecv); bs(&out, ",\"droppedIn\":"); bu(&out, impDroppedIn); bs(&out, "}");
  bs(&out, ",\"hashes\":[");
  bflush(&out, 1);
  uint32_t first = o.nHash > ON_KEEP ? o.nHash - ON_KEEP : 0;
  for (uint32_t k = first; k < o.nHash; k++) {
    if (k > first) bs(&out, ",");
    bs(&out, "["); bu(&out, o.hashTick[k % ON_KEEP]); bs(&out, ","); hex64(&out, o.hash[k % ON_KEEP]); bs(&out, "]");
    if (out.n > 900) bflush(&out, 1);
  }
  bs(&out, "]}\n");
  bflush(&out, 1);
  (void)r;
  return o.state == ON_FAILED && o.error && !seq(o.error, "left") ? 2 : 0;
}
