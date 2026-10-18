#ifndef QG_INFLATE_H
#define QG_INFLATE_H
#include <stdint.h>
// One gzip member into out (at most cap bytes): the bytes written, or -1.
int32_t gunzip(const uint8_t *in, uint32_t n, uint8_t *out, uint32_t cap);
#endif
