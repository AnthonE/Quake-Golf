// Quake Golf on the original Xbox, built with nxdk: the game core (game.c)
// over the sim translated to Pentium III code, up to four controllers through
// SDL2, a 125 Hz fixed step, and a 320x240 software frame doubled to 640x480.
#include <hal/debug.h>
#include <hal/video.h>
#include <windows.h>
#include <SDL.h>
#include <stdlib.h>
#include <string.h>
#include "game.h"
#include "qg_sim.h"
#include "layout.h"

// The sim calls out for these. One thread steps it, so nothing ever waits.
void qg_rt_trap(uint32_t code) {
  XVideoSetMode(640, 480, 32, REFRESH_DEFAULT);
  debugPrint("Quake Golf: the sim trapped (code %u) at tick %u, error %u\n", (unsigned)code,
             (unsigned)*(uint32_t *)(qg_mem + QG_HDR_TICK), (unsigned)*(uint32_t *)(qg_mem + QG_ERR_CODE));
  for (;;) Sleep(1000);
}
uint32_t qg_rt_wait32(uint32_t addr, uint32_t offset, uint32_t expected, uint32_t lo, uint32_t hi) {
  (void)addr; (void)offset; (void)expected; (void)lo; (void)hi;
  return 1;
}
uint32_t qg_rt_notify(uint32_t addr, uint32_t offset, uint32_t count) {
  (void)addr; (void)offset; (void)count;
  return 0;
}

static void *grab(uint32_t bytes) {
  void *p = malloc(bytes);
  if (!p) qg_rt_trap(100);
  return p;
}

// A stick axis with a dead zone, rescaled to [-1, 1]; up is positive.
static float axis(Sint16 v, int flip) {
  float f = (float)v / 32767.0f;
  if (flip) f = -f;
  if (f > -0.2f && f < 0.2f) return 0;
  f = (f > 0 ? f - 0.2f : f + 0.2f) / 0.8f;
  return f > 1 ? 1 : f < -1 ? -1 : f;
}

static void read_pad(SDL_GameController *c, Pad *p) {
  memset(p, 0, sizeof *p);
  if (!c) return;
  p->connected = 1;
  p->lx = axis(SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_LEFTX), 0);
  p->ly = axis(SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_LEFTY), 1);
  p->rx = axis(SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_RIGHTX), 0);
  p->ry = axis(SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_RIGHTY), 1);
  p->lt = (float)SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_TRIGGERLEFT) / 32767.0f;
  p->rt = (float)SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_TRIGGERRIGHT) / 32767.0f;
  static const struct { SDL_GameControllerButton b; uint32_t bit; } map[] = {
    { SDL_CONTROLLER_BUTTON_A, BTN_A }, { SDL_CONTROLLER_BUTTON_B, BTN_B }, { SDL_CONTROLLER_BUTTON_X, BTN_X },
    { SDL_CONTROLLER_BUTTON_Y, BTN_Y }, { SDL_CONTROLLER_BUTTON_START, BTN_START }, { SDL_CONTROLLER_BUTTON_BACK, BTN_BACK },
    { SDL_CONTROLLER_BUTTON_LEFTSTICK, BTN_LSTICK }, { SDL_CONTROLLER_BUTTON_RIGHTSTICK, BTN_RSTICK },
    { SDL_CONTROLLER_BUTTON_LEFTSHOULDER, BTN_WHITE }, { SDL_CONTROLLER_BUTTON_RIGHTSHOULDER, BTN_BLACK },
  };
  for (unsigned k = 0; k < sizeof map / sizeof map[0]; k++)
    if (SDL_GameControllerGetButton(c, map[k].b)) p->buttons |= map[k].bit;
}

#define W 320
#define H 240
static uint32_t frame[W * H];
static Match match;

int main(void) {
  XVideoSetMode(640, 480, 32, REFRESH_DEFAULT);
  if (SDL_Init(SDL_INIT_GAMECONTROLLER) != 0) {
    debugPrint("SDL_Init failed: %s\n", SDL_GetError());
    for (;;) Sleep(1000);
  }
  SDL_GameController *ports[LOCAL_MAX] = { 0 };

  LARGE_INTEGER freq, now;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&now);
  match_start(&match, (uint32_t)now.QuadPart | 1u, grab);
  const LONGLONG step = freq.QuadPart / 125;
  LONGLONG next = now.QuadPart;

  for (;;) {
    SDL_Event e;
    while (SDL_PollEvent(&e)) {
      if (e.type == SDL_CONTROLLERDEVICEADDED) {
        SDL_GameController *c = SDL_GameControllerOpen(e.cdevice.which);
        int port = c ? SDL_GameControllerGetPlayerIndex(c) : -1;
        if (port < 0 || port >= LOCAL_MAX || ports[port]) for (port = 0; port < LOCAL_MAX && ports[port]; port++) {}
        if (c && port < LOCAL_MAX) ports[port] = c;
      } else if (e.type == SDL_CONTROLLERDEVICEREMOVED) {
        SDL_GameController *c = SDL_GameControllerFromInstanceID(e.cdevice.which);
        for (int k = 0; k < LOCAL_MAX; k++) if (ports[k] == c) ports[k] = NULL;
        SDL_GameControllerClose(c);
      }
    }
    SDL_GameControllerUpdate();
    Pad pads[LOCAL_MAX];
    for (int k = 0; k < LOCAL_MAX; k++) read_pad(ports[k], &pads[k]);

    // the fixed 125 Hz step; after a long stall, drop the time instead of racing to catch up
    QueryPerformanceCounter(&now);
    int ticks = 0;
    while (now.QuadPart >= next && ticks < 8) { match_tick(&match, pads); next += step; ticks++; }
    if (ticks == 8) next = now.QuadPart + step;

    match_render(&match, frame, W, W, H);
    XVideoWaitForVBlank();
    uint32_t *fb = (uint32_t *)XVideoGetFB();
    for (int y = 0; y < H; y++) {
      const uint32_t *src = frame + y * W;
      uint32_t *a = fb + (2 * y) * 640, *b = a + 640;
      for (int x = 0; x < W; x++) a[2 * x] = a[2 * x + 1] = src[x];
      memcpy(b, a, 640 * 4);
    }
    XVideoFlushFB();
  }
}
