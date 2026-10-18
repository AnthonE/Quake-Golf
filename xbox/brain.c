// The neural golfer's brain, in the same ops and order as client/brain.mjs:
// clang -march=pentium3 keeps every float in SSE1, where + - * / and sqrt
// round to single as Math.fround does, and nothing here reassociates.
#include "brain.h"
#include "layout.h"

#define NIN BRAIN_NIN
#define NHID BRAIN_NHID
#define NW BRAIN_NW
#define GMAX 0x1.fefd70p8f  // fround(510.99)
#define DH_MIN 0x1.333334p-2f // fround(0.3)
#define DH_SPAN 4.5f
#define TURN 0x1.aceea0p-4f // fround(6 pi / 180)
static const float SIGMA[4] = { 0x1.99999ap-5f, 0x1.99999ap-4f, 0x1.99999ap-3f, 0x1.99999ap-2f }; // 0.05 0.1 0.2 0.4
static const float ALONG[6] = { 0.25f, 0.5f, 0.75f, 1.0f, 1.25f, 1.5f };

static float fsqrt(float x) { __asm__("sqrtss %1, %0" : "=x"(x) : "x"(x)); return x; }
static float fabsf_(float x) { return x < 0 ? -x : x; }

// splitmix32, then 24 of its bits as an exact float in [0, 1)
static float next(uint32_t *s) {
  uint32_t z = (*s += 0x9e3779b9u);
  z = (z ^ (z >> 16)) * 0x85ebca6bu;
  z = (z ^ (z >> 13)) * 0xc2b2ae35u;
  return (float)(int32_t)((z ^ (z >> 16)) >> 8) * 0x1p-24f;
}
static float noise(uint32_t *s) {
  float a = next(s);
  float b = next(s);
  float c = next(s);
  return (((a + b) + c) - 1.5f) * 2.0f;
}
static uint32_t mix(uint32_t base, uint32_t g, uint32_t s) {
  return ((base ^ 0x5bd1e995u) * 0x27d4eb2du) ^ ((g + 1) * 0x9e3779b9u) ^ ((s + 1) * 0x85ebca6bu);
}

static int b64(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '-') return 62;
  if (c == '_') return 63;
  return -1;
}

int brain_init(Brain *b, const char *g) {
  if (g[0] != 'q' || g[1] != 'g' || g[2] != '2' || g[3] != ':') return -1;
  uint8_t bytes[1024];
  uint32_t n = 0, acc = 0, bits = 0;
  for (const char *p = g + 4; *p && *p != ' ' && *p != '\r' && *p != '\n'; p++) {
    int v = b64(*p);
    if (v < 0) return -1;
    acc = (acc << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      if (n == sizeof bytes) return -1;
      bits -= 8;
      bytes[n++] = (uint8_t)(acc >> bits);
    }
  }
  if (n < 4 || (n & 1)) return -1;
  uint32_t base = bytes[0] | (uint32_t)bytes[1] << 8 | (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
  float s1 = 1.0f / fsqrt((float)(NIN + 1)), s2 = 1.0f / fsqrt((float)(NHID + 1));
  uint32_t r = base;
  for (int i = 0; i < NW; i++) b->w[i] = noise(&r) * (i < (NIN + 1) * NHID ? s1 : s2);
  for (uint32_t k = 4, gen = 0; k < n; k += 2, gen++) {
    uint32_t m = bytes[k] | (uint32_t)bytes[k + 1] << 8;
    float sig = SIGMA[m >> 14];
    r = mix(base, gen, m & 0x3fff);
    for (int i = 0; i < NW; i++) {
      float sc = i < (NIN + 1) * NHID ? s1 : s2;
      float nz = noise(&r);
      b->w[i] = b->w[i] + (sig * sc) * nz;
    }
  }
  return 0;
}

static float clampg(float v) { return v < 0 ? 0 : v > GMAX ? GMAX : v; }

float brain_ground(const uint8_t *mem, float x, float z) {
  float gx = clampg(x * 0.5f), gz = clampg(z * 0.5f);
  int ix = (int)gx, iz = (int)gz;
  float fx = gx - (float)ix, fz = gz - (float)iz;
  const uint8_t *t = mem + QG_TERRAIN_H;
#define HT(a, b) ((float)(t[2 * ((iz + (b)) * 512 + ix + (a))] | t[2 * ((iz + (b)) * 512 + ix + (a)) + 1] << 8) / 256.0f)
  float h00 = HT(0, 0), h10 = HT(1, 0), h01 = HT(0, 1), h11 = HT(1, 1);
#undef HT
  float r = h00 + (h10 - h00) * fx;
  r = r + (h01 - h00) * fz;
  return r + ((((h00 - h10) - h01) + h11) * fx) * fz;
}

static int lie(const uint8_t *mem, float x, float z) {
  int ix = (int)clampg(x * 0.5f), iz = (int)clampg(z * 0.5f);
  int s = mem[QG_TERRAIN_S + iz * 512 + ix];
  return s > 3 ? 3 : s;
}

void brain_features(const uint8_t *mem, const float ball[3], const float cup[3], float out[NIN]) {
  float dx = cup[0] - ball[0], dz = cup[2] - ball[2];
  float d = fsqrt(dx * dx + dz * dz);
  float ux = d > 0 ? dx / d : 1.0f, uz = d > 0 ? dz / d : 0.0f;
  for (int i = 0; i < NIN; i++) out[i] = 0;
  out[0] = d / 100.0f;
  out[1] = (cup[1] - ball[1]) / 10.0f;
  out[2 + lie(mem, ball[0], ball[2])] = 1;
  for (int k = 0; k < 6; k++) {
    float s = ALONG[k] * d;
    out[6 + k] = (brain_ground(mem, ball[0] + ux * s, ball[2] + uz * s) - ball[1]) / 10.0f;
  }
  out[12] = (brain_ground(mem, ball[0] + ux * 5.0f, ball[2] + uz * 5.0f) - ball[1]) / 2.0f;
  out[13] = (brain_ground(mem, ball[0] - ux * 5.0f, ball[2] - uz * 5.0f) - ball[1]) / 2.0f;
}

static float soft(float x) { return x / (1.0f + fabsf_(x)); }

void brain_decide(const Brain *b, const float x[NIN], float *dh, float *turn) {
  const float *w = b->w;
  float h[NHID], o[2];
  int k = 0;
  for (int j = 0; j < NHID; j++) {
    float s = w[k++];
    for (int i = 0; i < NIN; i++) s = s + w[k++] * x[i];
    h[j] = soft(s);
  }
  for (int j = 0; j < 2; j++) {
    float s = w[k++];
    for (int i = 0; i < NHID; i++) s = s + w[k++] * h[i];
    o[j] = soft(s);
  }
  *dh = DH_MIN + DH_SPAN * ((o[0] + 1.0f) / 2.0f);
  *turn = TURN * o[1];
}
