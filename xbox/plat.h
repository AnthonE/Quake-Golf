// What the online client needs from its platform: an open stream (TCP) and
// datagram socket (UDP) to the relay, both non-blocking for receives, and a
// monotonic clock. xbox/main.c implements these over lwIP for nxdk,
// xbox/headless.c over Linux system calls (with seeded impairment).
#ifndef QG_PLAT_H
#define QG_PLAT_H
#include <stdint.h>
int plat_stream_send(const void *b, uint32_t n);   // all of it, or -1
int plat_stream_recv(void *b, uint32_t n);         // bytes read, 0 for none yet, -1 closed
int plat_datagram_send(const void *b, uint32_t n);
int plat_datagram_recv(void *b, uint32_t n);       // one datagram's bytes, or 0 for none
void plat_close(void);
double plat_now_ms(void);
#endif
