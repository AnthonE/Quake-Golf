// plat.h on Linux i386, freestanding: sockets through socketcall, and seeded
// impairment on the datagrams both ways, net/impair.js's model (delay is the
// round trip, half each way; jitter spreads it; loss drops either way). For
// xbox/headless.c only, which includes harness/native/sys.h before this.
#ifndef QG_PLAT_LINUX_H
#define QG_PLAT_LINUX_H
#include "plat.h"

enum { SC_SOCKET = 1, SC_CONNECT = 3, SC_SEND = 9, SC_RECV = 10, SC_SETSOCKOPT = 14 };
static long sockcall(int call, long *args) { return sys3(102, call, (long)args, 0); }

static int tcpFd = -1, udpFd = -1;
static struct { double delay, jitter, loss; uint32_t rng; } imp = { 0, 0, 0, 1 };

typedef struct { double due; uint32_t n; uint8_t b[1500]; } Pkt;
#define QMAX 512
static Pkt outq[QMAX], inq[QMAX];
static uint32_t nOut, nIn;
static uint32_t impSent, impDropped, impRecv, impDroppedIn;

static double rnd(void) {
  uint32_t s = imp.rng;
  s ^= s << 13; s ^= s >> 17; s ^= s << 5;
  imp.rng = s;
  return (double)s / 4294967296.0;
}
static double one_way(void) { return imp.delay / 2 + (imp.jitter > 0 ? (rnd() * 2 - 1) * imp.jitter / 2 : 0); }

double plat_now_ms(void) { return (double)now_ns() / 1e6; }

// "a.b.c.d:port" into network-order address and port
static int parse_addr(const char *s, uint32_t *ip, uint16_t *port) {
  uint32_t parts[4] = { 0 }, k = 0, p = 0;
  for (; *s && *s != ':'; s++) {
    if (*s == '.') { if (++k > 3) return 0; }
    else if (*s >= '0' && *s <= '9') parts[k] = parts[k] * 10 + (uint32_t)(*s - '0');
    else return 0;
  }
  if (k != 3 || *s != ':') return 0;
  for (s++; *s >= '0' && *s <= '9'; s++) p = p * 10 + (uint32_t)(*s - '0');
  *ip = parts[0] | (parts[1] << 8) | (parts[2] << 16) | (parts[3] << 24);
  *port = (uint16_t)(((p & 255) << 8) | (p >> 8));
  return 1;
}

static int open_sock(int type, uint32_t ip, uint16_t port) {
  long a[3] = { 2, type, 0 };
  long fd = sockcall(SC_SOCKET, a);
  if (fd < 0) return -1;
  struct { uint16_t family, port; uint32_t addr; uint8_t zero[8]; } sa = { 2, port, ip, { 0 } };
  long c[3] = { fd, (long)&sa, 16 };
  if (sockcall(SC_CONNECT, c) < 0) { sys1(SYS_close, fd); return -1; }
  if (type == 1) { int on = 1; long o[5] = { fd, 6, 1, (long)&on, 4 }; sockcall(SC_SETSOCKOPT, o); } // TCP_NODELAY
  return (int)fd;
}

// Both sockets to the relay's native port.
static int plat_connect(const char *addr) {
  uint32_t ip;
  uint16_t port;
  if (!parse_addr(addr, &ip, &port)) return 0;
  tcpFd = open_sock(1, ip, port);
  udpFd = open_sock(2, ip, port);
  return tcpFd >= 0 && udpFd >= 0;
}

int plat_stream_send(const void *b, uint32_t n) {
  const uint8_t *p = b;
  while (n) {
    long s[4] = { tcpFd, (long)p, (long)n, 0x4000 }; // MSG_NOSIGNAL
    long r = sockcall(SC_SEND, s);
    if (r == -11 || r == -4) continue;
    if (r <= 0) return -1;
    p += r;
    n -= (uint32_t)r;
  }
  return 0;
}
int plat_stream_recv(void *b, uint32_t n) {
  long s[4] = { tcpFd, (long)b, (long)n, 0x40 }; // MSG_DONTWAIT
  long r = sockcall(SC_RECV, s);
  if (r == -11 || r == -4) return 0;
  return r > 0 ? (int)r : -1;
}

static void flush_out(double now) {
  for (uint32_t k = 0; k < nOut;) {
    if (outq[k].due > now) { k++; continue; }
    long s[4] = { udpFd, (long)outq[k].b, (long)outq[k].n, 0x40 };
    sockcall(SC_SEND, s);
    outq[k] = outq[--nOut];
  }
}
int plat_datagram_send(const void *b, uint32_t n) {
  double now = plat_now_ms();
  flush_out(now);
  if (imp.loss > 0 && rnd() < imp.loss) { impDropped++; return 0; }
  impSent++;
  double ms = one_way();
  if (ms <= 0 || nOut == QMAX || n > 1500) {
    long s[4] = { udpFd, (long)b, (long)n, 0x40 };
    sockcall(SC_SEND, s);
    return 0;
  }
  outq[nOut].due = now + ms;
  outq[nOut].n = n;
  memcpy(outq[nOut].b, b, n);
  nOut++;
  return 0;
}
int plat_datagram_recv(void *b, uint32_t n) {
  double now = plat_now_ms();
  flush_out(now);
  // everything the socket has goes through the impairment first
  for (;;) {
    if (nIn == QMAX) break;
    long s[4] = { udpFd, (long)inq[nIn].b, 1500, 0x40 };
    long r = sockcall(SC_RECV, s);
    if (r <= 0) break;
    if (imp.loss > 0 && rnd() < imp.loss) { impDroppedIn++; continue; }
    impRecv++;
    inq[nIn].due = now + one_way();
    inq[nIn].n = (uint32_t)r;
    nIn++;
  }
  // the earliest due, so jitter reorders as it would on the wire
  int best = -1;
  for (uint32_t k = 0; k < nIn; k++) if (inq[k].due <= now && (best < 0 || inq[k].due < inq[best].due)) best = (int)k;
  if (best < 0) return 0;
  uint32_t m = inq[best].n < n ? inq[best].n : n;
  memcpy(b, inq[best].b, m);
  inq[best] = inq[--nIn];
  return (int)m;
}
void plat_close(void) {
  if (tcpFd >= 0) sys1(SYS_close, tcpFd);
  tcpFd = -1;
}
static void plat_sleep_ms(uint32_t ms) {
  struct { int32_t s, ns; } ts = { 0, (int32_t)(ms * 1000000) };
  sys3(162, (long)&ts, 0, 0); // nanosleep
}

#endif
