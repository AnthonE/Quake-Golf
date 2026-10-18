// The Xbox game, minus the Xbox: local players, controllers to input words,
// the 125 Hz step, and a software renderer, over the translated sim. The
// nxdk front end (main.c) and the Linux test driver (headless.c) share it.
#ifndef QG_XBOX_GAME_H
#define QG_XBOX_GAME_H
#include <stdint.h>

#define LOCAL_MAX 4 // controller ports

enum {
  BTN_A = 1, BTN_B = 2, BTN_X = 4, BTN_Y = 8, BTN_START = 16, BTN_BACK = 32,
  BTN_LSTICK = 64, BTN_RSTICK = 128, BTN_WHITE = 256, BTN_BLACK = 512,
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

typedef struct {
  Local p[LOCAL_MAX];        // pad k plays sim slot k
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

// The .qgl header for a recorded match of `ticks` ticks (32 bytes).
void match_log_header(const Match *m, uint32_t ticks, uint8_t out[32]);

#endif
