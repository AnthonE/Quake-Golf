// Quake Golf on the original Xbox, built with nxdk: the game core (game.c)
// over the sim translated to Pentium III code, up to four controllers through
// SDL2, a 125 Hz fixed step, and a 320x240 software frame doubled to 640x480.
// The title screen picks local play (split screen, up to four) or online play
// (one player, on the relay's native port: online.c, net_xbox.c).
#include <hal/debug.h>
#include <hal/video.h>
#include <windows.h>
#include <SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "game.h"
#include "online.h"
#include "net_xbox.h"
#include "plat.h"
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
    { SDL_CONTROLLER_BUTTON_DPAD_UP, BTN_UP }, { SDL_CONTROLLER_BUTTON_DPAD_DOWN, BTN_DOWN },
    { SDL_CONTROLLER_BUTTON_DPAD_LEFT, BTN_LEFT }, { SDL_CONTROLLER_BUTTON_DPAD_RIGHT, BTN_RIGHT },
  };
  for (unsigned k = 0; k < sizeof map / sizeof map[0]; k++)
    if (SDL_GameControllerGetButton(c, map[k].b)) p->buttons |= map[k].bit;
}

#define W 320
#define H 240
static uint32_t frame[W * H];
static Match match;
static Online online;
static uint8_t rx[1 << 20];

static void present(void) {
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

// The server, from D:\quakegolf.txt beside the XBE (the Makefile writes it,
// SERVER=host:port), else xemu's NAT address for the machine running it.
static char server[64] = "10.0.2.2:4434";
static void load_server(void) {
  FILE *f = fopen("D:\\quakegolf.txt", "r");
  if (!f) return;
  char line[64] = { 0 };
  if (fgets(line, sizeof line, f)) {
    size_t n = strlen(line);
    while (n && (line[n - 1] == '\n' || line[n - 1] == '\r' || line[n - 1] == ' ')) line[--n] = 0;
    if (n) strcpy(server, line);
  }
  fclose(f);
}

// The d-pad editor for the server: left and right pick a character, up and
// down change it, A or B is done.
static const char CHARS[] = "0123456789.:abcdefghijklmnopqrstuvwxyz-";
static void edit_server(uint32_t edge, int *cursor) {
  size_t n = strlen(server);
  if (edge & BTN_LEFT && *cursor > 0) (*cursor)--;
  if (edge & BTN_RIGHT && *cursor < (int)n) (*cursor)++;
  if (*cursor == (int)n && (edge & (BTN_UP | BTN_DOWN)) && n < sizeof server - 1) { server[n] = '0'; server[n + 1] = 0; }
  char *c = &server[*cursor];
  if (edge & (BTN_UP | BTN_DOWN)) {
    const char *at = strchr(CHARS, *c);
    int i = at ? (int)(at - CHARS) : 0, len = (int)strlen(CHARS);
    *c = CHARS[(i + (edge & BTN_UP ? 1 : len - 1)) % len];
  }
  if (edge & BTN_WHITE && n) { memmove(c, c + 1, strlen(c)); if (*cursor > (int)strlen(server)) (*cursor)--; } // delete
}

enum { TITLE, EDIT, LOCAL, CONNECTING, ONLINE };

int main(void) {
  XVideoSetMode(640, 480, 32, REFRESH_DEFAULT);
  if (SDL_Init(SDL_INIT_GAMECONTROLLER) != 0) {
    debugPrint("SDL_Init failed: %s\n", SDL_GetError());
    for (;;) Sleep(1000);
  }
  SDL_GameController *ports[LOCAL_MAX] = { 0 };
  load_server();

  LARGE_INTEGER freq, now;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&now);
  match_start(&match, (uint32_t)now.QuadPart | 1u, grab);
  const LONGLONG step = freq.QuadPart / 125;
  LONGLONG next = now.QuadPart;
  int mode = TITLE, cursor = 0, me = 0; // me: the controller that plays online
  uint32_t prev = 0;
  const char *error = 0;
  char status[96];

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
    uint32_t any = 0;
    for (int k = 0; k < LOCAL_MAX; k++) { read_pad(ports[k], &pads[k]); any |= pads[k].buttons; }
    uint32_t edge = any & ~prev;
    prev = any;
    QueryPerformanceCounter(&now);

    if (mode == TITLE || mode == EDIT) {
      // the course turns behind the menu
      int ticks = 0;
      Pad idle[LOCAL_MAX];
      memset(idle, 0, sizeof idle);
      while (now.QuadPart >= next && ticks < 8) { match_tick(&match, idle); next += step; ticks++; }
      if (ticks == 8) next = now.QuadPart + step;
      match.status = 0;
      match_render(&match, frame, W, W, H);
      // over the spectator view's own lines
      for (int y = 100; y < 200; y++) for (int x = 40; x < 280; x++) frame[y * W + x] = (frame[y * W + x] >> 1) & 0x7f7f7f;
      draw_text(frame, W, W, H, 60, 108, "A  PLAY HERE (UP TO 4)", 2, 0xffffff);
      draw_text(frame, W, W, H, 60, 128, "X  PLAY ONLINE", 2, 0xffffff);
      draw_text(frame, W, W, H, 84, 146, server, 2, mode == EDIT ? 0xffe066 : 0x9ec8ff);
      draw_text(frame, W, W, H, 60, 164, mode == EDIT ? "D-PAD EDITS, WHITE DELETES, A DONE" : "Y  CHANGE SERVER", 1, 0xbbbbbb);
      if (mode == EDIT) {
        int x = 84 + text_width(server, 2) * cursor / (int)(strlen(server) ? strlen(server) : 1);
        for (int k = 0; k < 6; k++) frame[(158) * W + x + k] = 0xffe066;
      }
      if (error) draw_text(frame, W, W, H, 160 - text_width(error, 1) / 2, 186, error, 1, 0xff6050);
      present();
      if (mode == EDIT) {
        edit_server(edge, &cursor);
        if (edge & (BTN_A | BTN_B | BTN_START)) mode = TITLE;
      } else if (edge & BTN_Y) { mode = EDIT; cursor = (int)strlen(server); }
      else if (edge & (BTN_A | BTN_START)) { mode = LOCAL; error = 0; prev |= BTN_A | BTN_START; }
      else if (edge & BTN_X) {
        for (me = 0; me < LOCAL_MAX - 1 && !(pads[me].buttons & BTN_X); me++) {}
        mode = CONNECTING;
        error = 0;
      }
      continue;
    }

    if (mode == CONNECTING) {
      snprintf(status, sizeof status, "CONNECTING TO %s", server);
      match.status = status;
      match_render(&match, frame, W, W, H);
      present();
      error = net_connect(server);
      if (error) { mode = TITLE; continue; }
      online_start(&online, qg_wasm_prefix, rx, sizeof rx);
      match.netSlot = -1;
      for (int k = 0; k < LOCAL_MAX; k++) match.p[k].joined = 0;
      mode = ONLINE;
      continue;
    }

    if (mode == ONLINE) {
      // Back and Start together leave
      if ((pads[me].buttons & (BTN_BACK | BTN_START)) == (BTN_BACK | BTN_START) || online.state == ON_FAILED) {
        error = online.state == ON_FAILED ? online.error : 0;
        online_leave(&online);
        match_start(&match, (uint32_t)now.QuadPart | 1u, grab);
        next = now.QuadPart;
        mode = TITLE;
        continue;
      }
      // twice a frame: datagrams, the stream, inputs, then the confirmed world
      online_poll(&online, &match.p[0], &pads[me], 6);
      match.netSlot = online.slot;
      int n = online_predict(&online, &match.p[0], &pads[me]);
      match.netPred = n > 0;
      if (online.state == ON_PLAYING) match.status = 0;
      else {
        snprintf(status, sizeof status, online.state == ON_CATCHING_UP ? "CATCHING UP" : "JOINING %s", server);
        match.status = status;
      }
      match_render(&match, frame, W, W, H);
      online_poll(&online, &match.p[0], &pads[me], 6);
      present();
      continue;
    }

    // local: the fixed 125 Hz step; after a long stall, drop the time instead of racing to catch up
    int ticks = 0;
    while (now.QuadPart >= next && ticks < 8) { match_tick(&match, pads); next += step; ticks++; }
    if (ticks == 8) next = now.QuadPart + step;
    match.status = 0;
    match_render(&match, frame, W, W, H);
    present();
    // Back and Start together, on any controller, back to the title
    for (int k = 0; k < LOCAL_MAX; k++) {
      if ((pads[k].buttons & (BTN_BACK | BTN_START)) != (BTN_BACK | BTN_START)) continue;
      match_start(&match, (uint32_t)now.QuadPart | 1u, grab);
      mode = TITLE;
      break;
    }
  }
}
