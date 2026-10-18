#ifndef QG_NET_XBOX_H
#define QG_NET_XBOX_H
// Brings the network up once, then connects to "host:port". Null on success,
// else a line to show.
const char *net_connect(const char *server);
#endif
