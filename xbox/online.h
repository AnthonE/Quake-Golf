// Online play for native clients: the browser's net worker and sim worker
// (client/net.mjs, client/sim.mjs) in one single-threaded C state machine.
// The host opens the connection (a TCP stream and a UDP socket to the relay's
// native port) and provides plat.h; online_poll does everything else: the
// handshake, the clocks, input words, acks, bundles, repairs, keyframes,
// resyncs, hash reports, and stepping the confirmed world.
#ifndef QG_ONLINE_H
#define QG_ONLINE_H
#include <stdint.h>
#include "game.h"

enum { ON_HELLO, ON_JOINING, ON_CATCHING_UP, ON_PLAYING, ON_FAILED };

#define ON_STORE 1024   // closed ticks held ahead of the confirmed world
#define ON_KEEP 512     // interval hashes kept for the host's reports
#define ON_PARTS 3      // parts a tick may come in (net/wire.mjs: 256 words of noise take 2)
#define ON_PART_MAX 1000 // net/wire.mjs PART_MAX

// A closed tick as it came, still coded (net/wire.mjs): its parts, whole once all have come.
typedef struct {
  int32_t tick;   // server tick, -1 for an empty slot
  uint8_t parts, have, whole;
  uint16_t len[ON_PARTS];
  uint8_t data[ON_PARTS][ON_PART_MAX];
} OnTick;

typedef struct {
  int state;
  const char *error;
  // the welcome
  int slot;
  uint32_t joinTick, seed, roomStart, token;
  // clocks, in ms and server ticks: the server's tick, the input lead, the playout clock
  double tHello, sBase, sEpoch, bestRtt, lead;
  double playBase, playEpoch, playRate;
  double offsets[256];
  uint32_t nOff;
  double slacks[128];
  uint32_t nSlack;
  double pingAt[5];
  int pings;
  // inputs: one word a tick, by server tick & 255
  uint32_t words[256];
  uint32_t nextTick, lastSent;
  uint32_t inAck;
  int32_t lastBundleT;
  uint16_t seq;
  // which closed ticks arrived (by bundle, repair or fill), the last 1,024
  int32_t seen[1024];
  int32_t newest;
  // closed ticks waiting for the playout clock, by server tick & (ON_STORE - 1)
  OnTick store[ON_STORE];
  int32_t storeNewest;
  // the words the next tick to step is coded against, one per slot (net/wire.mjs TickBase)
  uint32_t base[256];
  int started, filling, keys;
  double syncAt;
  // the newest interval hash, sent on the next 8 input datagrams
  uint32_t repInterval;
  uint64_t repHash;
  int repLeft;
  uint32_t faced; // the hole the camera last turned to face
  // the stream's bytes not yet parsed
  uint8_t *rx;
  uint32_t rxLen, rxCap;
  // counts, for the HUD and the runs
  uint32_t bundles, repairs, repairTicks, fills, fillTicks, pongs, syncs, desyncs, stepped;
  uint32_t nHash;
  uint32_t hashTick[ON_KEEP];
  uint64_t hash[ON_KEEP];
  uint32_t keyReason[16], keyTick[16];
} Online;

// The host's buffers: rx for the stream (a keyframe arrives whole: 1 MiB is
// plenty), and scratch for unpacking one (the region's size).
void online_start(Online *o, const uint8_t wasmPrefix[8], uint8_t *rx, uint32_t rxCap);
// One pass. pad and l: the player's controller and aim, sampled into words as
// the predicted clock passes each tick. Steps the confirmed world for at most
// budgetMs.
void online_poll(Online *o, Local *l, const Pad *pad, double budgetMs);
// The prediction layer for a frame: the newest confirmed tick, every input
// sampled since and the tick in progress, stepped at PRED. The ticks
// predicted, or -1 for none (render the confirmed world).
int online_predict(Online *o, Local *l, const Pad *pad);
// The playout clock's fraction past the newest stepped tick, for drawing.
double online_server_tick(const Online *o, double now);
void online_leave(Online *o);

#endif
