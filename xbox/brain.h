// The neural golfer's brain for the Xbox (client/brain.mjs is the same net in
// JS): a qg2 genome replayed into 274 f32 weights, the fourteen features a
// ball at rest shows, and the shot they decide. Every float op is an SSE1
// single op in the order the JS's Math.fround chain takes, so the weights,
// features and decisions are V8's, bit for bit (test/brain.test.mjs).
#ifndef QG_XBOX_BRAIN_H
#define QG_XBOX_BRAIN_H
#include <stdint.h>

#define BRAIN_NIN 14
#define BRAIN_NHID 16
#define BRAIN_NW ((BRAIN_NIN + 1) * BRAIN_NHID + (BRAIN_NHID + 1) * 2)

typedef struct { float w[BRAIN_NW]; } Brain;

// 0, or -1 if `genome` (ended by a NUL, a space or a line break) is no qg2 genome.
int brain_init(Brain *b, const char *genome);
// The ground under (x, z), bilinear over the sim's heightfield in `mem`.
float brain_ground(const uint8_t *mem, float x, float z);
void brain_features(const uint8_t *mem, const float ball[3], const float cup[3], float out[BRAIN_NIN]);
// dh: metres behind the ball for the blast; turn: radians off the line to the cup.
void brain_decide(const Brain *b, const float x[BRAIN_NIN], float *dh, float *turn);

#endif
