// The Xbox game, minus the Xbox: local players, controllers to input words,
// the 125 Hz step, and a software renderer, over the translated sim. The
// nxdk front end (main.c) and the Linux test driver (headless.c) share it.
#ifndef QG_XBOX_GAME_H
#define QG_XBOX_GAME_H
#include <stdint.h>
#include "brain.h"

#define LOCAL_MAX 4 // controller ports

enum {
  BTN_A = 1, BTN_B = 2, BTN_X = 4, BTN_Y = 8, BTN_START = 16, BTN_BACK = 32,
  BTN_LSTICK = 64, BTN_RSTICK = 128, BTN_WHITE = 256, BTN_BLACK = 512,
  BTN_UP = 1024, BTN_DOWN = 2048, BTN_LEFT = 4096, BTN_RIGHT = 8192,
};

// One controller this tick: sticks in [-1, 1] (up and right positive),
// triggers in [0, 1].
typedef struct {
  int connected;
  float lx, ly, rx, ry, lt, rt;
  uint32_t buttons;
} Pad;

typedef struct {
  int joined;
  float yaw, pitch;          // input units: 1/16384 turn, 512 level
  uint32_t presses, sent;    // shots asked for, shots sampled into words
  uint32_t weapon;           // 0 rocket, 1 grenade
  uint32_t prev;             // last tick's buttons, for edges
  float prevRt, prevLt;
} Local;

// A neural golfer at a local slot (xbox/brain.c): the brain picks each shot
// and these legs walk to it and fire, as client/bot.mjs's GolfBot does.
typedef struct {
  int on;
  Brain brain;
  int planned;               // a shot is chosen: where the blast lands, where to stand
  float from[3], bp[3], stand[3];
  uint32_t firedAt, tapAt, aimTicks;
} Cpu;

typedef struct {
  Local p[LOCAL_MAX];        // pad k plays sim slot k (locally; online, pad 0 plays netSlot)
  Cpu cpu[LOCAL_MAX];        // local play: a neural golfer at slot k instead of pad k
  int netSlot;               // online: the slot the relay gave us, or -1 for local play
  int netPred;               // online: the prediction layer holds this frame's player
  const char *status;        // a line for the top of the screen, or null
  uint32_t seed;
  // every inbox record the match applied, in order, when rec is set: a .qgl body
  uint8_t *rec;
  uint32_t recCount, recCap;
  // the renderer's per-hole terrain, rebuilt when the hole count changes
  uint32_t cachedHole;
  float *heights;            // 512 x 512, metres
  uint32_t *colors;          // 512 x 512, XRGB, slope-shaded
  float *depth;              // the frame's depth, one float per pixel
  uint32_t depthCap;
} Match;

// The host gives the memory: about 2 MiB for the terrain caches, plus the depth buffer.
void match_start(Match *m, uint32_t seed, void *(*alloc)(uint32_t bytes));
// One 8 ms tick: joins, input words, the inbox, qg_step.
void match_tick(Match *m, const Pad pads[LOCAL_MAX]);
// Every joined player's view (split screen past one), with the HUD, into a
// w x h XRGB buffer (the host scales it to the screen).
void match_render(Match *m, uint32_t *px, int stride, int w, int h);
// For scripts and bots: point local player k's aim straight at a world point.
void match_aim_at(Match *m, int k, float x, float y, float z);
// The same for local player k standing in sim slot `slot` (online).
void match_aim_from(Match *m, int k, uint32_t slot, float x, float y, float z);
// Local play: seat a neural golfer with this qg2 genome at slot k; it joins on
// the next tick. 0, or -1 for a genome brain_init refuses.
int match_add_cpu(Match *m, int k, const char *genome);

// One tick's input word from a controller (net/wire.mjs packInput's layout).
// commit 1 samples it: the aim turns, a trigger pull becomes a press, the shot
// counter steps toward the presses. commit 0 only looks, for the prediction's
// tick in progress (a pending press counted as the next shot).
uint32_t pad_word(Local *l, const Pad *p, int commit);
// Turn to face down the hole, level.
void pad_face(Local *l);

// Text in the HUD's 3x5 font, with a shadow, into a w x h XRGB buffer.
void draw_text(uint32_t *px, int stride, int w, int h, int x, int y, const char *s, int scale, uint32_t color);
int text_width(const char *s, int scale);

// The .qgl header for a recorded match of `ticks` ticks (32 bytes).
void match_log_header(const Match *m, uint32_t ticks, uint8_t out[32]);

#endif
