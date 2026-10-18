// gunzip for keyframes: one gzip member (RFC 1952) holding raw deflate
// (RFC 1951), decoded bit by bit through canonical Huffman tables, the way
// zlib's puff.c does it. Small and slow, which is fine for a keyframe or two
// a session. Freestanding: no allocation, no libc.
#include "inflate.h"

typedef struct {
  const uint8_t *in;
  uint32_t n, pos;
  uint32_t bitbuf, bitcnt;
  uint8_t *out;
  uint32_t cap, len;
  int err;
} St;

typedef struct { short count[16]; short symbol[288]; } Huff;

static uint32_t bits(St *s, uint32_t need) {
  uint32_t val = s->bitbuf;
  while (s->bitcnt < need) {
    if (s->pos >= s->n) { s->err = 1; return 0; }
    val |= (uint32_t)s->in[s->pos++] << s->bitcnt;
    s->bitcnt += 8;
  }
  s->bitbuf = need < 32 ? val >> need : 0;
  s->bitcnt -= need;
  return need < 32 ? val & ((1u << need) - 1) : val;
}

static int stored(St *s) {
  s->bitbuf = 0;
  s->bitcnt = 0;
  if (s->pos + 4 > s->n) return -2;
  uint32_t len = s->in[s->pos] | (s->in[s->pos + 1] << 8);
  uint32_t inv = s->in[s->pos + 2] | (s->in[s->pos + 3] << 8);
  s->pos += 4;
  if (len != (~inv & 0xffff)) return -2;
  if (s->pos + len > s->n) return -2;
  if (s->len + len > s->cap) return 1;
  while (len--) s->out[s->len++] = s->in[s->pos++];
  return 0;
}

static int decode(St *s, const Huff *h) {
  int code = 0, first = 0, index = 0;
  for (int len = 1; len <= 15; len++) {
    code |= (int)bits(s, 1);
    int count = h->count[len];
    if (code - count < first) return h->symbol[index + (code - first)];
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  return -10;
}

// 0 for a complete code, > 0 for an incomplete one, < 0 for an over-subscribed one
static int construct(Huff *h, const short *length, int n) {
  short offs[16];
  for (int len = 0; len < 16; len++) h->count[len] = 0;
  for (int sym = 0; sym < n; sym++) h->count[length[sym]]++;
  if (h->count[0] == n) return 0;
  int left = 1;
  for (int len = 1; len < 16; len++) {
    left <<= 1;
    left -= h->count[len];
    if (left < 0) return left;
  }
  offs[1] = 0;
  for (int len = 1; len < 15; len++) offs[len + 1] = (short)(offs[len] + h->count[len]);
  for (int sym = 0; sym < n; sym++) if (length[sym]) h->symbol[offs[length[sym]]++] = (short)sym;
  return left;
}

static const short LBASE[29] = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 };
static const short LEXT[29] = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 };
static const unsigned short DBASE[30] = { 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577 };
static const short DEXT[30] = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 };

static int codes(St *s, const Huff *lc, const Huff *dc) {
  for (;;) {
    int sym = decode(s, lc);
    if (s->err) return -2;
    if (sym < 0) return sym;
    if (sym < 256) {
      if (s->len == s->cap) return 1;
      s->out[s->len++] = (uint8_t)sym;
    } else if (sym == 256) {
      return 0;
    } else {
      sym -= 257;
      if (sym >= 29) return -10;
      uint32_t len = (uint32_t)LBASE[sym] + bits(s, (uint32_t)LEXT[sym]);
      int ds = decode(s, dc);
      if (s->err) return -2;
      if (ds < 0 || ds >= 30) return -10;
      uint32_t dist = DBASE[ds] + bits(s, (uint32_t)DEXT[ds]);
      if (dist > s->len) return -11;
      if (s->len + len > s->cap) return 1;
      while (len--) { s->out[s->len] = s->out[s->len - dist]; s->len++; }
    }
  }
}

static int fixed(St *s) {
  static Huff lc, dc;
  static int built;
  if (!built) {
    short lengths[288];
    int sym = 0;
    for (; sym < 144; sym++) lengths[sym] = 8;
    for (; sym < 256; sym++) lengths[sym] = 9;
    for (; sym < 280; sym++) lengths[sym] = 7;
    for (; sym < 288; sym++) lengths[sym] = 8;
    construct(&lc, lengths, 288);
    for (sym = 0; sym < 30; sym++) lengths[sym] = 5;
    construct(&dc, lengths, 30);
    built = 1;
  }
  return codes(s, &lc, &dc);
}

static int dynamic(St *s) {
  static const short ORDER[19] = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 };
  short lengths[320];
  Huff lc, dc;
  int nlen = (int)bits(s, 5) + 257, ndist = (int)bits(s, 5) + 1, ncode = (int)bits(s, 4) + 4;
  if (s->err || nlen > 286 || ndist > 30) return -3;
  int index = 0;
  for (; index < ncode; index++) lengths[ORDER[index]] = (short)bits(s, 3);
  for (; index < 19; index++) lengths[ORDER[index]] = 0;
  if (construct(&lc, lengths, 19) != 0) return -4;
  index = 0;
  while (index < nlen + ndist) {
    int sym = decode(s, &lc);
    if (s->err) return -2;
    if (sym < 0) return sym;
    if (sym < 16) { lengths[index++] = (short)sym; continue; }
    short len = 0;
    int rep;
    if (sym == 16) {
      if (index == 0) return -5;
      len = lengths[index - 1];
      rep = 3 + (int)bits(s, 2);
    } else if (sym == 17) rep = 3 + (int)bits(s, 3);
    else rep = 11 + (int)bits(s, 7);
    if (index + rep > nlen + ndist) return -6;
    while (rep--) lengths[index++] = len;
  }
  if (lengths[256] == 0) return -9;
  int err = construct(&lc, lengths, nlen);
  if (err < 0 || (err > 0 && nlen - lc.count[0] != 1)) return -7;
  err = construct(&dc, lengths + nlen, ndist);
  if (err < 0 || (err > 0 && ndist - dc.count[0] != 1)) return -8;
  return codes(s, &lc, &dc);
}

int32_t gunzip(const uint8_t *in, uint32_t n, uint8_t *out, uint32_t cap) {
  if (n < 18 || in[0] != 0x1f || in[1] != 0x8b || in[2] != 8) return -1;
  uint8_t flags = in[3];
  uint32_t p = 10;
  if (flags & 4) { if (p + 2 > n) return -1; p += 2 + (in[p] | (in[p + 1] << 8)); }
  if (flags & 8) { while (p < n && in[p]) p++; p++; }
  if (flags & 16) { while (p < n && in[p]) p++; p++; }
  if (flags & 2) p += 2;
  if (p + 8 > n) return -1;
  St s = { .in = in, .n = n - 8, .pos = p, .out = out, .cap = cap };
  int last;
  do {
    last = (int)bits(&s, 1);
    uint32_t type = bits(&s, 2);
    if (s.err) return -1;
    int err = type == 0 ? stored(&s) : type == 1 ? fixed(&s) : type == 2 ? dynamic(&s) : -1;
    if (err != 0) return -1;
  } while (!last);
  uint32_t isize = in[n - 4] | (in[n - 3] << 8) | (in[n - 2] << 16) | ((uint32_t)in[n - 1] << 24);
  return isize == s.len ? (int32_t)s.len : -1;
}
