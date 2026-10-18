// plat.h on the Xbox: lwIP's BSD sockets over the nForce NIC (nxdk's
// NXDK_NET), and the kernel's performance counter. Kept apart from main.c so
// lwIP's socket names never meet windows.h.
#include <errno.h>
#include <string.h>
#include <lwip/netdb.h>
#include <lwip/sockets.h>
#include <nxdk/net.h>
#include <xboxkrnl/xboxkrnl.h>
#include "plat.h"
#include "net_xbox.h"

static int tcpS = -1, udpS = -1;
static int netUp;

double plat_now_ms(void) {
  static ULONGLONG freq;
  if (!freq) freq = KeQueryPerformanceFrequency();
  return (double)KeQueryPerformanceCounter() * 1000.0 / (double)freq;
}

// "host:port": the network (once: DHCP, or the dashboard's settings), then a
// TCP connection for the stream and a UDP socket for the datagrams.
const char *net_connect(const char *server) {
  char host[128];
  unsigned port = 0, k = 0;
  while (server[k] && server[k] != ':' && k < sizeof host - 1) { host[k] = server[k]; k++; }
  host[k] = 0;
  if (server[k] != ':') return "the server needs a port: host:port";
  for (const char *p = server + k + 1; *p >= '0' && *p <= '9'; p++) port = port * 10 + (unsigned)(*p - '0');
  if (!port || port > 65535) return "bad port";
  if (!netUp) {
    int r = nxNetInit(NULL);
    if (r == -2) return "no address from DHCP (is the network cable, or xemu's NAT, on?)";
    if (r < 0) return "the network did not start";
    netUp = 1;
  }
  struct sockaddr_in sa;
  memset(&sa, 0, sizeof sa);
  sa.sin_family = AF_INET;
  sa.sin_port = htons((u16_t)port);
  if (!inet_aton(host, &sa.sin_addr)) {
    struct hostent *he = gethostbyname(host);
    if (!he || !he->h_addr_list[0]) return "cannot find that server name";
    memcpy(&sa.sin_addr, he->h_addr_list[0], sizeof sa.sin_addr);
  }
  tcpS = socket(AF_INET, SOCK_STREAM, 0);
  if (tcpS < 0) return "no socket";
  if (connect(tcpS, (struct sockaddr *)&sa, sizeof sa) < 0) { closesocket(tcpS); tcpS = -1; return "the server did not answer (is net/play.mjs running?)"; }
  int on = 1;
  setsockopt(tcpS, IPPROTO_TCP, TCP_NODELAY, &on, sizeof on);
  udpS = socket(AF_INET, SOCK_DGRAM, 0);
  if (udpS < 0 || connect(udpS, (struct sockaddr *)&sa, sizeof sa) < 0) { closesocket(tcpS); tcpS = -1; return "no UDP socket"; }
  return 0;
}

int plat_stream_send(const void *b, uint32_t n) {
  const char *p = b;
  while (n) {
    int r = send(tcpS, p, n, 0);
    if (r < 0 && (errno == EWOULDBLOCK || errno == EAGAIN || errno == EINTR)) continue;
    if (r <= 0) return -1;
    p += r;
    n -= (uint32_t)r;
  }
  return 0;
}
int plat_stream_recv(void *b, uint32_t n) {
  int r = recv(tcpS, b, n, MSG_DONTWAIT);
  if (r < 0) return errno == EWOULDBLOCK || errno == EAGAIN || errno == EINTR ? 0 : -1;
  return r > 0 ? r : -1;
}
int plat_datagram_send(const void *b, uint32_t n) { return send(udpS, b, n, 0) < 0 ? -1 : 0; }
int plat_datagram_recv(void *b, uint32_t n) {
  int r = recv(udpS, b, n, MSG_DONTWAIT);
  return r > 0 ? r : 0;
}
void plat_close(void) {
  if (tcpS >= 0) closesocket(tcpS);
  if (udpS >= 0) closesocket(udpS);
  tcpS = udpS = -1;
}
