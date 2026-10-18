// The native runner: harness/core.mjs's replay() for the translated sim.
// Feeds a .qgl log tick by tick, steps on one thread, hashes the whole region
// every tick and writes the same .qgh trace, so tools/compare.mjs and
// harness/matrix.mjs grade it against Node, Deno and Chrome.
//
//   build/x86/replay --log logs/m20000.qgl --ticks 20000 --out trace.qgh [--tag t]
//   qemu-i386 -cpu pentium3 build/x86/replay ...   (the Xbox CPU's instruction set)
//   --time-from N times the steps from tick N on (harness/perf.mjs times 16000-24000)
#include "sys.h"
#include "qg_sim.h"
#include "layout.h"

#define U32(a) (*(volatile uint32_t *)(qg_mem + (a)))
#define U64(a) (*(volatile uint64_t *)(qg_mem + (a)))

void qg_rt_trap(uint32_t code) {
  Buf o = { .n = 0 };
  bs(&o, "\nsim trap "); bu(&o, code);
  bs(&o, code == 1 ? " (out of bounds)" : code == 2 ? " (divide by zero)" : " (unreachable)");
  bs(&o, " at tick "); bu(&o, U32(QG_HDR_TICK)); bs(&o, ", error code "); bu(&o, U32(QG_ERR_CODE)); bs(&o, "\n");
  bflush(&o, 2);
  sys_exit(3);
}
uint32_t qg_rt_wait32(uint32_t addr, uint32_t offset, uint32_t expected, uint32_t tlo, uint32_t thi) {
  uint64_t ea = (uint64_t)addr + offset;
  if (ea + 4 > QG_MEM_SIZE) qg_rt_trap(1);
  if (U32(ea) != expected) return 1;
  uint64_t ns = ((uint64_t)thi << 32) | tlo;
  uint32_t rem;
  struct { int32_t s, ns; } ts = { (int32_t)udiv64(ns, 1000000000u, &rem), 0 };
  ts.ns = (int32_t)rem;
  long r = sys4(SYS_futex, (long)(qg_mem + ea), 128 /* WAIT | PRIVATE */, expected, thi >> 31 ? 0 : (long)&ts);
  return r == -110 ? 2 : r == -11 ? 1 : 0;
}
uint32_t qg_rt_notify(uint32_t addr, uint32_t offset, uint32_t count) {
  uint64_t ea = (uint64_t)addr + offset;
  if (ea + 4 > QG_MEM_SIZE) qg_rt_trap(1);
  long r = sys3(SYS_futex, (long)(qg_mem + ea), 129 /* WAKE | PRIVATE */, (long)count);
  return r < 0 ? 0 : (uint32_t)r;
}

static uint32_t rd32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

int main(int argc, char **argv) {
  const char *logPath = "logs/short.qgl", *outPath = 0, *tag = "x86 pentium3 t1";
  uint32_t ticks = 20000, timeFrom = 0;
  for (int i = 1; i + 1 < argc; i++) {
    if (seq(argv[i], "--log")) logPath = argv[++i];
    else if (seq(argv[i], "--out")) outPath = argv[++i];
    else if (seq(argv[i], "--tag")) tag = argv[++i];
    else if (seq(argv[i], "--ticks")) { ticks = 0; for (const char *s = argv[++i]; *s; s++) ticks = ticks * 10 + (uint32_t)(*s - '0'); }
    else if (seq(argv[i], "--time-from")) { timeFrom = 0; for (const char *s = argv[++i]; *s; s++) timeFrom = timeFrom * 10 + (uint32_t)(*s - '0'); }
    else if (seq(argv[i], "--threads")) { if (!seq(argv[++i], "1")) die("the native runner steps on one thread"); }
    else i++; // --wasm, --flags: the module is compiled in
  }

  uint32_t logLen;
  uint8_t *log = readfile(logPath, &logLen);
  if (!log) die("cannot read the log");
  if (logLen < 32 || log[0] != 'Q' || log[1] != 'G' || log[2] != 'E' || log[3] != 'L') die("not a .qgl log");
  uint32_t courseSeed = rd32(log + 8), logTicks = rd32(log + 16), count = rd32(log + 20);
  if (ticks > logTicks) die("asked for more ticks than the log has");

  qg_init(courseSeed);
  uint64_t terrainHash = qg_terrain_hash();
  // the log's hash, with the module's own XXH64, chained through the net area
  const uint32_t room = QG_PAGES * 65536u - QG_NET;
  uint64_t logHash = 0;
  for (uint32_t off = 0; off < logLen; off += room) {
    uint32_t n = logLen - off < room ? logLen - off : room;
    memcpy(qg_mem + QG_NET, log + off, n);
    logHash = qg_xxh64(QG_NET, n, logHash);
  }
  memset(qg_mem + QG_NET, 0, logLen < room ? logLen : room);

  const uint32_t nInt = ticks / QG_NSLICE;
  uint64_t *tickHashes = alloc(8 * ticks + 8);
  uint64_t *intervalHashes = alloc(8 * nInt + 8);
  uint64_t *sliceDigests = alloc(8 * nInt * QG_NSLICE + 8);
  uint64_t awakeSum = 0, stepNs = 0;
  uint32_t rec = 0;
  uint64_t t0 = now_ns();
  for (uint32_t t = 0; t < ticks; t++) {
    uint64_t s0 = now_ns();
    while (rec < count && rd32(log + 32 + rec * QG_REC) < t) rec++;
    uint32_t n = 0;
    while (rec < count && rd32(log + 32 + rec * QG_REC) == t) {
      if (n == QG_INBOX_MAX) die("too many events in one tick");
      memcpy(qg_mem + QG_INBOX_REC + n * QG_REC, log + 32 + rec * QG_REC, QG_REC);
      n++; rec++;
    }
    U32(QG_INBOX) = n;
    qg_step();
    if (t >= timeFrom) stepNs += now_ns() - s0;
    awakeSum += U32(QG_JOB_NA);
    tickHashes[t] = qg_hash_region();
    if ((t + 1) % QG_NSLICE == 0) {
      uint32_t k = (t + 1) / QG_NSLICE - 1;
      if (U32(QG_INTERVAL_TICK) != t + 1) die("an interval did not close on time");
      intervalHashes[k] = U64(QG_INTERVAL_HASH);
      memcpy(sliceDigests + k * QG_NSLICE, qg_mem + QG_DIGESTS, QG_NSLICE * 8);
    }
    if ((t + 1) % 10000 == 0) {
      Buf o = { .n = 0 };
      bs(&o, "\r"); bs(&o, tag); bs(&o, ": "); bu(&o, t + 1); bs(&o, " ticks, ");
      bu(&o, U32(QG_HDR_NBALLS)); bs(&o, " balls, "); bu(&o, U32(QG_JOB_NA)); bs(&o, " awake   ");
      bflush(&o, 2);
    }
  }
  uint64_t ns = now_ns() - t0;
  out(2, "\n", 1);

  if (outPath) {
    uint32_t size = 128 + 8 * (ticks + nInt + nInt * QG_NSLICE);
    uint8_t *tr = alloc(size);
    tr[0] = 'Q'; tr[1] = 'G'; tr[2] = 'H'; tr[3] = '1';
    *(uint32_t *)(tr + 4) = ticks;
    *(uint32_t *)(tr + 8) = nInt;
    *(uint64_t *)(tr + 16) = terrainHash;
    *(uint64_t *)(tr + 24) = logHash;
    uint32_t tl = slen(tag);
    memcpy(tr + 32, tag, tl < 96 ? tl : 96);
    memcpy(tr + 128, tickHashes, 8 * ticks);
    memcpy(tr + 128 + 8 * ticks, intervalHashes, 8 * nInt);
    memcpy(tr + 128 + 8 * (ticks + nInt), sliceDigests, 8 * nInt * QG_NSLICE);
    if (!writefile(outPath, tr, size)) die("cannot write the trace");
  }

  // the same stats line as the other runners; msStepPerTick leaves out the
  // harness's whole-region hash, which a game never takes
  Buf o = { .n = 0 };
  uint32_t r;
  bs(&o, "{\"tag\":\""); bs(&o, tag); bs(&o, "\",\"ticks\":"); bu(&o, ticks);
  bs(&o, ",\"ms\":"); bmilli(&o, udiv64(ns, 1000, &r));
  bs(&o, ",\"msPerTick\":"); bmilli(&o, udiv64(udiv64(ns, ticks, &r), 1000, &r));
  bs(&o, ",\"msStepPerTick\":"); bmilli(&o, udiv64(udiv64(stepNs, ticks > timeFrom ? ticks - timeFrom : 1, &r), 1000, &r));
  bs(&o, ",\"nballs\":"); bu(&o, U32(QG_HDR_NBALLS));
  bs(&o, ",\"meanAwake\":"); bmilli(&o, udiv64(awakeSum * 1000, ticks, &r));
  bs(&o, ",\"terrainHash\":\""); bx64(&o, terrainHash); bs(&o, "\"}\n");
  bflush(&o, 1);
  return 0;
}
