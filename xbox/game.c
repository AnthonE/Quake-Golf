// The Xbox game core: see game.h. Freestanding C (no libc, no libm): the
// sim's own sincos for angles, sqrtss for roots, so the same file builds for
// nxdk and for the Linux test driver.
#include "game.h"
#include "qg_sim.h" // build/x86/: the translated sim
#include "layout.h"
#include "font.h"

typedef float __attribute__((may_alias)) af32;
typedef uint32_t __attribute__((may_alias)) au32;
typedef uint16_t __attribute__((may_alias)) au16;
#define F(a) (*(af32 *)(qg_mem + (a)))
#define U(a) (*(au32 *)(qg_mem + (a)))
#define H(a) (*(au16 *)(qg_mem + (a)))
#define B(a) (qg_mem[(a)])

static float fsqrt(float x) { __asm__("sqrtss %1, %0" : "=x"(x) : "x"(x)); return x; }
static float fabsf_(float x) { return x < 0 ? -x : x; }
static float clampf(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }
static int clampi(int x, int lo, int hi) { return x < lo ? lo : x > hi ? hi : x; }
// sine and cosine of u/16384 of a turn, exactly as the sim computes them
static void sc(uint32_t u, float *s, float *c) {
  uint32_t o[2];
  qg_sincos(u & 0x3fff, o);
  af32 *f = (af32 *)o;
  *s = f[0]; *c = f[1];
}
// atan2 in turns/16384 (yaw units), to a few units: aiming only, never the sim
static float atan2u(float y, float x) {
  float ax = fabsf_(x), ay = fabsf_(y);
  float a = ax > ay ? ay / (ax + 1e-20f) : ax / (ay + 1e-20f);
  float s = a * a;
  float r = ((-0.0464964749f * s + 0.15931422f) * s - 0.327622764f) * s * a + a; // radians, |err| < 1e-5
  if (ay > ax) r = 1.57079637f - r;
  if (x < 0) r = 3.14159274f - r;
  if (y < 0) r = -r;
  return r * (16384.0f / 6.28318548f);
}

// ---------------------------------------------------------------- the match

static void rec(Match *m, uint32_t *n, uint32_t kind, uint32_t slot, uint32_t word) {
  uint8_t *r = qg_mem + QG_INBOX_REC + *n * QG_REC;
  for (int k = 0; k < (int)QG_REC; k++) r[k] = 0;
  *(au32 *)r = U(QG_HDR_TICK);
  r[4] = (uint8_t)kind;
  r[5] = (uint8_t)slot;
  *(au32 *)(r + 8) = word;
  (*n)++;
  if (m->rec && m->recCount < m->recCap) {
    uint8_t *d = m->rec + m->recCount * QG_REC;
    for (int k = 0; k < (int)QG_REC; k++) d[k] = r[k];
    m->recCount++;
  }
}

void match_start(Match *m, uint32_t seed, void *(*alloc)(uint32_t)) {
  Match keep = *m; // the recorder and any buffers from an earlier match
  for (uint32_t k = 0; k < sizeof *m; k++) ((uint8_t *)m)[k] = 0;
  m->rec = keep.rec;
  m->recCap = keep.recCap;
  m->seed = seed;
  m->heights = keep.heights ? keep.heights : alloc(512 * 512 * 4);
  m->colors = keep.colors ? keep.colors : alloc(512 * 512 * 4);
  m->depthCap = 640 * 480;
  m->depth = keep.depth ? keep.depth : alloc(m->depthCap * 4);
  m->cachedHole = 0xffffffffu;
  for (int k = 0; k < LOCAL_MAX; k++) m->p[k].pitch = 512;
  qg_init(seed);
}

#define YAW_RATE 64.0f   // units a tick at full stick: 0.49 turn a second
#define PITCH_RATE 6.0f

static uint32_t word_for(Local *l, const Pad *p) {
  uint32_t edge = p->buttons & ~l->prev;
  float fine = p->lt > 0.5f || (p->buttons & BTN_B) ? 0.3f : 1.0f; // hold to line a shot up
  l->yaw += p->rx * fabsf_(p->rx) * YAW_RATE * fine;
  while (l->yaw >= 16384) l->yaw -= 16384;
  while (l->yaw < 0) l->yaw += 16384;
  l->pitch = clampf(l->pitch + p->ry * fabsf_(p->ry) * PITCH_RATE * fine, 16, 1008);
  uint32_t move = (p->ly > 0.35f ? 1 : 0) | (p->ly < -0.35f ? 2 : 0) | (p->lx < -0.35f ? 4 : 0) | (p->lx > 0.35f ? 8 : 0);
  if (p->rt > 0.6f && l->prevRt <= 0.6f) l->presses++;
  if (edge & (BTN_Y | BTN_X)) l->weapon ^= 1;
  l->prevRt = p->rt;
  l->prevLt = p->lt;
  l->prev = p->buttons;
  // the word's shot counter follows the presses a step a tick
  if (l->sent != l->presses) l->sent++;
  return ((uint32_t)(l->yaw + 0.5f) & 0x3fff) | (((uint32_t)(l->pitch + 0.5f) & 0x3ff) << 14) | (move << 24) |
         ((p->buttons & BTN_A ? 1u : 0u) << 28) | ((l->sent & 3) << 29) | (l->weapon << 31);
}

void match_tick(Match *m, const Pad pads[LOCAL_MAX]) {
  uint32_t n = 0;
  for (int k = 0; k < LOCAL_MAX; k++) {
    Local *l = &m->p[k];
    if (!l->joined && pads[k].connected && (pads[k].buttons & (BTN_START | BTN_A)) && !(l->prev & (BTN_START | BTN_A))) {
      l->joined = 1;
      // face down the hole, the way the tee spot does
      l->yaw = atan2u(F(QG_HDR_DIR + 4), F(QG_HDR_DIR));
      if (l->yaw < 0) l->yaw += 16384;
      l->pitch = 512;
      rec(m, &n, QG_EV_JOIN, (uint32_t)k, 0);
      l->prev = pads[k].buttons;
      continue;
    }
    if (l->joined) rec(m, &n, QG_EV_INPUT, (uint32_t)k, word_for(l, &pads[k]));
    else l->prev = pads[k].buttons;
  }
  U(QG_INBOX) = n;
  qg_step();
}

void match_aim_at(Match *m, int k, float x, float y, float z) {
  uint32_t pb = QG_PLAYERS + 64u * (uint32_t)k;
  float dx = x - F(pb + QG_P_PX), dz = z - F(pb + QG_P_PZ), dy = y - (F(pb + QG_P_PY) + QG_P_EYE);
  float yaw = atan2u(dz, dx);
  m->p[k].yaw = yaw < 0 ? yaw + 16384 : yaw;
  // pitch units are half a yaw unit per unit: 512 is level, 1024 straight up
  m->p[k].pitch = clampf(512 + atan2u(dy, fsqrt(dx * dx + dz * dz)) / 8, 16, 1008);
}

void match_log_header(const Match *m, uint32_t ticks, uint8_t out[32]) {
  for (int k = 0; k < 32; k++) out[k] = 0;
  out[0] = 'Q'; out[1] = 'G'; out[2] = 'E'; out[3] = 'L';
  out[4] = 1;
  out[6] = (uint8_t)QG_REC;
  *(au32 *)(out + 8) = m->seed;
  *(au32 *)(out + 16) = ticks;
  *(au32 *)(out + 20) = m->recCount;
}

// ---------------------------------------------------------------- drawing

static uint32_t rgb(float r, float g, float b) {
  int R = clampi((int)(r * 255.0f + 0.5f), 0, 255), G = clampi((int)(g * 255.0f + 0.5f), 0, 255), Bl = clampi((int)(b * 255.0f + 0.5f), 0, 255);
  return ((uint32_t)R << 16) | ((uint32_t)G << 8) | (uint32_t)Bl;
}
static uint32_t mix(uint32_t a, uint32_t b, int t256) {
  uint32_t rb = (((a & 0xff00ff) * (uint32_t)(256 - t256) + (b & 0xff00ff) * (uint32_t)t256) >> 8) & 0xff00ff;
  uint32_t g = (((a & 0x00ff00) * (uint32_t)(256 - t256) + (b & 0x00ff00) * (uint32_t)t256) >> 8) & 0x00ff00;
  return rb | g;
}
static uint32_t hash2(uint32_t x, uint32_t z) {
  uint32_t h = x * 0x27d4eb2du ^ z * 0x165667b1u;
  h ^= h >> 15; h *= 0x85ebca6bu; h ^= h >> 13;
  return h;
}
// slot colours, as the browser's slotColor: 0.55 + 0.45 cos(2 pi (h + (0, 1/3, 2/3)))
static uint32_t slot_color(uint32_t s) {
  uint32_t h = (s * 2654435761u) >> 18; // 14 bits of a golden-ratio walk
  float c[3];
  for (int i = 0; i < 3; i++) { float sn, cs; sc(h + (uint32_t)(i * 5461), &sn, &cs); c[i] = 0.55f + 0.45f * cs; }
  return rgb(c[0], c[1], c[2]);
}

#define SKY_LO 0x9ea8bdu // (0.62, 0.66, 0.74)
#define SKY_HI 0x29386bu // (0.16, 0.22, 0.42)

// Heights and shaded surface colours for this hole, from the sim's terrain.
static void build_terrain(Match *m) {
  for (uint32_t k = 0; k < 512 * 512; k++) m->heights[k] = (float)H(QG_TERRAIN_H + 2 * k) * (1.0f / 256);
  for (int z = 0; z < 512; z++) {
    for (int x = 0; x < 512; x++) {
      uint32_t k = (uint32_t)(z * 512 + x);
      float hx = m->heights[z * 512 + clampi(x + 1, 0, 511)] - m->heights[z * 512 + clampi(x - 1, 0, 511)];
      float hz = m->heights[clampi(z + 1, 0, 511) * 512 + x] - m->heights[clampi(z - 1, 0, 511) * 512 + x];
      // n = (-hx, 4, -hz) / |.|, lit by the browser's sun (0.48, 0.74, 0.47)
      float inv = 1.0f / fsqrt(hx * hx + 16 + hz * hz);
      float lit = clampf((-hx * 0.48f + 4 * 0.74f - hz * 0.47f) * inv, 0, 1) * 0.75f + 0.35f;
      float n = (float)(hash2((uint32_t)x, (uint32_t)z) & 255) * (1.0f / 255);
      float r, g, b;
      switch (B(QG_TERRAIN_S + k)) {
        case 0: { float st = ((x + z) >> 3) & 1 ? 1.04f : 0.96f; r = 0.33f * st; g = 0.6f * st; b = 0.2f * st; break; }
        case 1: { float v = 0.85f + 0.3f * n; r = 0.2f * v; g = 0.4f * v; b = 0.13f * v; break; }
        case 2: { float v = 0.92f + 0.12f * n; r = 0.86f * v; g = 0.77f * v; b = 0.52f * v; break; }
        default: { float v = (x + z) & 1 ? 0.97f : 1.03f; r = 0.4f * v; g = 0.74f * v; b = 0.3f * v; }
      }
      m->colors[k] = rgb(r * lit, g * lit, b * lit);
    }
  }
  m->cachedHole = U(QG_HDR_HOLE);
}

static float height_at(const Match *m, float x, float z) {
  float gx = clampf(x * 0.5f, 0, 510.99f), gz = clampf(z * 0.5f, 0, 510.99f);
  int ix = (int)gx, iz = (int)gz;
  float fx = gx - (float)ix, fz = gz - (float)iz;
  const float *h = m->heights + iz * 512 + ix;
  return h[0] + (h[1] - h[0]) * fx + (h[512] - h[0]) * fz + (h[0] - h[1] - h[512] + h[513]) * fx * fz;
}

typedef struct {
  uint32_t *px; float *depth; int stride, x0, y0, w, h;
  float ex, ey, ez, fx, fz, rx, rz, focal, horizon;
} View;

// fog toward SKY_LO: 1 - exp(-z / 380), by the metre
static uint8_t FOG[1100];
static void fog_table(void) {
  float e = 1, step = 0.99737187f; // exp(-1/380)
  for (int k = 0; k < 1100; k++) { FOG[k] = (uint8_t)clampi((int)((1 - e) * 256), 0, 255); e *= step; }
}

static void draw_terrain(Match *m, View *v) {
  for (int c = 0; c < v->w; c++) {
    float t = ((float)c + 0.5f - (float)v->w * 0.5f) / v->focal;
    float dx = v->fx + v->rx * t, dz = v->fz + v->rz * t;
    int ybuf = v->h;
    float z = 0.4f;
    uint32_t *col = v->px + v->y0 * v->stride + v->x0 + c;
    float *dcol = v->depth + v->y0 * v->stride + v->x0 + c;
    while (z < 1000 && ybuf > 0) {
      float wx = v->ex + dx * z, wz = v->ez + dz * z;
      float h = height_at(m, wx, wz);
      int sy = (int)(v->horizon - (h - v->ey) * v->focal / z);
      if (sy < ybuf) {
        int ix = clampi((int)(wx * 0.5f), 0, 511), iz = clampi((int)(wz * 0.5f), 0, 511);
        uint32_t color = mix(m->colors[iz * 512 + ix], SKY_LO, FOG[(int)z]);
        for (int y = sy < 0 ? 0 : sy; y < ybuf; y++) { col[y * v->stride] = color; dcol[y * v->stride] = z; }
        ybuf = sy < 0 ? 0 : sy;
      }
      z += 0.02f + z * 0.012f;
    }
    for (int y = 0; y < ybuf; y++) {
      float up = clampf((v->horizon - (float)y) / ((float)v->h * 0.8f), 0, 1);
      col[y * v->stride] = mix(SKY_LO, SKY_HI, (int)(up * 256));
      dcol[y * v->stride] = 1e9f;
    }
  }
}

// A world point to the screen; 0 if behind the eye.
static int project(const View *v, float x, float y, float z, float *sx, float *sy, float *d) {
  float qx = x - v->ex, qy = y - v->ey, qz = z - v->ez;
  float depth = qx * v->fx + qz * v->fz;
  if (depth < 0.2f) return 0;
  float side = qx * v->rx + qz * v->rz;
  *sx = (float)v->w * 0.5f + side * v->focal / depth;
  *sy = v->horizon - qy * v->focal / depth;
  *d = depth;
  return 1;
}

static void disc(View *v, float cx, float cy, float r, float d, uint32_t color) {
  if (r < 0.5f) r = 0.5f;
  int x0 = clampi((int)(cx - r), 0, v->w - 1), x1 = clampi((int)(cx + r), 0, v->w - 1);
  int y0 = clampi((int)(cy - r), 0, v->h - 1), y1 = clampi((int)(cy + r), 0, v->h - 1);
  if (cx + r < 0 || cx - r >= v->w || cy + r < 0 || cy - r >= v->h) return;
  float r2 = r * r;
  uint32_t fogged = mix(color, SKY_LO, FOG[clampi((int)d, 0, 1099)]);
  for (int y = y0; y <= y1; y++) {
    float yy = ((float)y + 0.5f - cy) * ((float)y + 0.5f - cy);
    for (int x = x0; x <= x1; x++) {
      float xx = ((float)x + 0.5f - cx) * ((float)x + 0.5f - cx);
      if (xx + yy > r2 && r > 0.7f) continue;
      int o = (v->y0 + y) * v->stride + v->x0 + x;
      if (d < v->depth[o]) { v->px[o] = fogged; v->depth[o] = d; }
    }
  }
}

static void column(View *v, float x, float yb, float yt, float z, float r, uint32_t color) {
  float sx, sb, st, d;
  if (!project(v, x, yb, z, &sx, &sb, &d) || !project(v, x, yt, z, &sx, &st, &d)) return;
  float half = r * v->focal / d;
  if (half < 0.5f) half = 0.5f;
  int x0 = clampi((int)(sx - half), 0, v->w - 1), x1 = clampi((int)(sx + half), 0, v->w - 1);
  int y0 = clampi((int)st, 0, v->h - 1), y1 = clampi((int)sb, 0, v->h - 1);
  if (sx + half < 0 || sx - half >= v->w) return;
  uint32_t fogged = mix(color, SKY_LO, FOG[clampi((int)d, 0, 1099)]);
  for (int y = y0; y <= y1; y++)
    for (int x = x0; x <= x1; x++) {
      int o = (v->y0 + y) * v->stride + v->x0 + x;
      if (d < v->depth[o]) { v->px[o] = fogged; v->depth[o] = d; }
    }
}

static void draw_world(Match *m, View *v, int viewer) {
  uint32_t tick = U(QG_HDR_TICK);
  // the cup: a slipgate disc, and a flag to find it by
  float cx = F(QG_HDR_CUP), cy = F(QG_HDR_CUP + 4), cz = F(QG_HDR_CUP + 8);
  column(v, cx, cy, cy + 3.0f, cz, 0.03f, 0xf2f2f2);
  column(v, cx + 0.35f * v->rx, cy + 2.4f, cy + 3.0f, cz + 0.35f * v->rz, 0.35f, 0xd23c3c);
  float sx, sy, d;
  if (project(v, cx, cy + 0.05f, cz, &sx, &sy, &d)) disc(v, sx, sy, 0.62f * v->focal / d, d - 0.3f, 0x7326b3);
  // balls
  uint32_t n = U(QG_HDR_NBALLS);
  for (uint32_t i = 0; i < n && i < QG_BALL_CAP; i++) {
    uint8_t fl = B(QG_FLAGS + i);
    if (!(fl & QG_F_LIVE)) continue;
    if (!project(v, F(QG_PX + 4 * i), F(QG_PY + 4 * i), F(QG_PZ + 4 * i), &sx, &sy, &d) || d > 400) continue;
    uint32_t owner = H(QG_OWNER + 2 * i);
    disc(v, sx, sy, QG_R * v->focal / d, d, mix(0xffffff, slot_color(owner), owner < LOCAL_MAX ? 140 : 40));
  }
  // players
  for (uint32_t p = 0; p < QG_NPLAYER; p++) {
    uint32_t pb = QG_PLAYERS + 64 * p;
    if (!(B(pb + QG_P_FL) & QG_PF_LIVE) || (int)p == viewer) continue;
    float px = F(pb + QG_P_PX), py = F(pb + QG_P_PY), pz = F(pb + QG_P_PZ);
    column(v, px, py, py + QG_P_TOP, pz, QG_P_R * 0.8f, slot_color(p));
  }
  // projectiles
  for (uint32_t j = 0; j < QG_NPROJ; j++) {
    uint32_t jb = QG_PROJ + 32 * j;
    uint8_t kind = B(jb + QG_J_KIND);
    if (!kind) continue;
    if (!project(v, F(jb + QG_J_PX), F(jb + QG_J_PY), F(jb + QG_J_PZ), &sx, &sy, &d)) continue;
    disc(v, sx, sy, (kind == QG_K_ROCKET ? 0.18f : 0.14f) * v->focal / d, d, kind == QG_K_ROCKET ? 0xff9a2e : 0x3c7a2a);
  }
  // blasts from the FX ring, for a third of a second
  uint32_t fxn = U(QG_FX);
  for (uint32_t k = fxn > QG_FX_MAX ? fxn - QG_FX_MAX : 0; k < fxn; k++) {
    uint32_t r = QG_FX_REC + 32 * (k & (QG_FX_MAX - 1));
    if (B(r + 4) != QG_FX_BLAST) continue;
    uint32_t age = tick - U(r);
    if (age > 40) continue;
    if (!project(v, F(r + 8), F(r + 12), F(r + 16), &sx, &sy, &d)) continue;
    float grow = 0.3f + (float)age / 40.0f;
    disc(v, sx, sy, F(r + 20) * 0.5f * grow * v->focal / d, d, age < 12 ? 0xfff2b0 : 0xff8a20);
  }
}

// ---------------------------------------------------------------- the HUD

static void glyph(View *v, int x, int y, char ch, int s, uint32_t color) {
  if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 32);
  if (ch < 32 || ch > 95) ch = '?';
  uint16_t g = QG_FONT[ch - 32];
  for (int row = 0; row < 5; row++)
    for (int c = 0; c < 3; c++) {
      if (!(g & (1u << (14 - row * 3 - c)))) continue;
      for (int dy = 0; dy < s; dy++)
        for (int dx = 0; dx < s; dx++) {
          int px = x + c * s + dx, py = y + row * s + dy;
          if (px < 0 || py < 0 || px >= v->w || py >= v->h) continue;
          v->px[(v->y0 + py) * v->stride + v->x0 + px] = color;
        }
    }
}
static int text(View *v, int x, int y, const char *s, int scale, uint32_t color) {
  for (; *s; s++, x += 4 * scale) { glyph(v, x + scale / 2 + 1, y + scale / 2 + 1, *s, scale, 0x000000); glyph(v, x, y, *s, scale, color); }
  return x;
}
static int textlen(const char *s, int scale) { int n = 0; while (s[n]) n++; return n * 4 * scale; }
static char *num(char *b, uint32_t v) {
  char t[12]; int k = 0;
  do { t[k++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (k) *b++ = t[--k];
  *b = 0;
  return b;
}
static char *cat(char *b, const char *s) { while (*s) *b++ = *s++; *b = 0; return b; }

static void hud(Match *m, View *v, int k) {
  char b[64], *e;
  uint32_t pb = QG_PLAYERS + 64u * (uint32_t)k;
  uint32_t state = U(QG_HDR_STATE), tick = U(QG_HDR_TICK), until = U(QG_HDR_UNTIL);
  int s = v->w >= 300 ? 2 : 1;
  e = cat(b, "HOLE "); e = num(e, U(QG_HDR_HOLE)); e = cat(e, "  PAR "); e = num(e, U(QG_HDR_PAR));
  e = cat(e, "  STROKES "); num(e, H(pb + QG_P_STROKES));
  text(v, 4, 4, b, s, 0xffffff);
  if (state == QG_H_PLAY && until > tick) {
    uint32_t secs = (until - tick + 124) / 125;
    e = num(b, secs / 60); e = cat(e, secs % 60 < 10 ? ":0" : ":"); num(e, secs % 60);
    text(v, v->w - textlen(b, s) - 4, 4, b, s, secs < 30 ? 0xff6050 : 0xffffff);
  }
  if (state == QG_H_COUNT && until > tick) {
    num(b, (until - tick + 124) / 125);
    text(v, v->w / 2 - textlen(b, s * 3) / 2, v->h / 3, b, s * 3, 0xffe066);
  }
  if (state == QG_H_OVER) {
    text(v, v->w / 2 - textlen("HOLE OVER", s * 2) / 2, v->h / 4, "HOLE OVER", s * 2, 0xffe066);
    int y = v->h / 4 + 14 * s;
    for (int p = 0; p < LOCAL_MAX; p++) {
      if (!m->p[p].joined) continue;
      uint32_t q = QG_PLAYERS + 64u * (uint32_t)p;
      e = cat(b, "P"); e = num(e, (uint32_t)p + 1); e = cat(e, "  "); e = num(e, H(q + QG_P_SCORE)); e = cat(e, "  TOTAL "); num(e, U(q + QG_P_TOTAL));
      text(v, v->w / 2 - textlen(b, s) / 2, y, b, s, slot_color((uint32_t)p));
      y += 8 * s;
    }
  }
  // weapon and the ball's distance to the cup
  e = cat(b, m->p[k].weapon ? "GRENADE" : "ROCKET");
  int32_t ball = (int32_t)U(pb + QG_P_BALL);
  if (ball >= 0 && (uint32_t)ball < QG_BALL_CAP) {
    float dx = F(QG_PX + 4 * (uint32_t)ball) - F(QG_HDR_CUP), dz = F(QG_PZ + 4 * (uint32_t)ball) - F(QG_HDR_CUP + 8);
    e = cat(e, "   BALL "); e = num(e, (uint32_t)fsqrt(dx * dx + dz * dz)); cat(e, " M");
  }
  if (B(pb + QG_P_FL) & QG_PF_DONE) cat(b, "   IN!");
  text(v, 4, v->h - 6 * s - 4, b, s, 0xffffff);
  // crosshair
  for (int d = -3; d <= 3; d++) {
    int cx = v->w / 2, cy = v->h / 2;
    if (d == 0) continue;
    v->px[(v->y0 + cy) * v->stride + v->x0 + cx + d] = 0xffffff;
    v->px[(v->y0 + cy + d) * v->stride + v->x0 + cx] = 0xffffff;
  }
}

void match_render(Match *m, uint32_t *px, int stride, int w, int h) {
  if (!FOG[1099]) fog_table();
  if (m->cachedHole != U(QG_HDR_HOLE)) build_terrain(m);
  if ((uint32_t)(stride * h) > m->depthCap) return;
  int ids[LOCAL_MAX], n = 0;
  for (int k = 0; k < LOCAL_MAX; k++) if (m->p[k].joined) ids[n++] = k;
  int views = n ? n : 1;
  for (int i = 0; i < views; i++) {
    View v = { .px = px, .depth = m->depth, .stride = stride };
    // one: the screen; two: top and bottom; three or four: quarters
    if (views == 1) { v.x0 = 0; v.y0 = 0; v.w = w; v.h = h; }
    else if (views == 2) { v.x0 = 0; v.y0 = i * (h / 2); v.w = w; v.h = h / 2; }
    else { v.x0 = (i & 1) * (w / 2); v.y0 = (i >> 1) * (h / 2); v.w = w / 2; v.h = h / 2; }
    float yaw, pitch, ex, ey, ez;
    int viewer = -1;
    if (n) {
      int k = ids[i];
      uint32_t pb = QG_PLAYERS + 64u * (uint32_t)k;
      viewer = k;
      yaw = m->p[k].yaw; pitch = m->p[k].pitch;
      ex = F(pb + QG_P_PX); ey = F(pb + QG_P_PY) + QG_P_EYE; ez = F(pb + QG_P_PZ);
    } else {
      // nobody in yet: circle the tee, looking down the hole
      float tx = F(QG_HDR_TEE), tz = F(QG_HDR_TEE + 8), dxh = F(QG_HDR_DIR), dzh = F(QG_HDR_DIR + 4);
      yaw = atan2u(dzh, dxh) + (float)(U(QG_HDR_TICK) % 4000) * (16384.0f / 4000) * 0.04f;
      ex = tx - dxh * 20; ez = tz - dzh * 20; ey = height_at(m, ex, ez) + 8; pitch = 470;
    }
    float s, c;
    sc((uint32_t)(yaw + 0.5f), &s, &c);
    v.fx = c; v.fz = s; v.rx = -s; v.rz = c;
    v.ex = ex; v.ey = ey; v.ez = ez;
    v.focal = (float)v.w * 0.75f;
    float ps, pc;
    sc((uint32_t)(((int32_t)(pitch + 0.5f) - 512) * 8) & 0x3fff, &ps, &pc);
    v.horizon = (float)v.h * 0.5f + clampf(ps / pc, -4.4f, 4.4f) * v.focal;
    draw_terrain(m, &v);
    draw_world(m, &v, viewer);
    if (n) hud(m, &v, viewer);
    else {
      View full = v;
      const char *msg = "PRESS START";
      int sc2 = v.w >= 300 ? 3 : 2;
      text(&full, v.w / 2 - textlen(msg, sc2) / 2, v.h / 2, msg, sc2, 0xffe066);
      text(&full, 4, 4, "QUAKE GOLF", 2, 0xffffff);
    }
  }
}
