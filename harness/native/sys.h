// Freestanding Linux i386: the syscalls and the little libc the native runner
// needs, so it builds with clang -m32 and no 32-bit libc installed. 64-bit
// division is done here too (no compiler runtime to call).
#ifndef QG_SYS_H
#define QG_SYS_H
#include <stdint.h>

static inline long sys1(long n, long a) {
  long r; __asm__ volatile("int $0x80" : "=a"(r) : "a"(n), "b"(a) : "memory"); return r;
}
static inline long sys3(long n, long a, long b, long c) {
  long r; __asm__ volatile("int $0x80" : "=a"(r) : "a"(n), "b"(a), "c"(b), "d"(c) : "memory"); return r;
}
static inline long sys4(long n, long a, long b, long c, long d) {
  long r; __asm__ volatile("int $0x80" : "=a"(r) : "a"(n), "b"(a), "c"(b), "d"(c), "S"(d) : "memory"); return r;
}

enum { SYS_exit_group = 252, SYS_read = 3, SYS_write = 4, SYS_open = 5, SYS_close = 6, SYS_lseek = 19,
       SYS_mmap = 90, SYS_futex = 240, SYS_clock_gettime = 265 };

__attribute__((noreturn)) static void sys_exit(int code) { sys1(SYS_exit_group, code); for (;;) {} }

void *memcpy(void *d, const void *s, uint32_t n) {
  void *r = d;
  __asm__ volatile("rep movsb" : "+D"(d), "+S"(s), "+c"(n) : : "memory");
  return r;
}
void *memset(void *d, int v, uint32_t n) {
  void *r = d;
  __asm__ volatile("rep stosb" : "+D"(d), "+c"(n) : "a"(v) : "memory");
  return r;
}
static uint32_t slen(const char *s) { uint32_t n = 0; while (s[n]) n++; return n; }
static int seq(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }

static void out(int fd, const char *s, uint32_t n) {
  while (n) { long w = sys3(SYS_write, fd, (long)s, n); if (w <= 0) return; s += w; n -= (uint32_t)w; }
}

// A small text buffer for one line of output.
typedef struct { char b[1024]; uint32_t n; } Buf;
static void bs(Buf *o, const char *s) { while (*s && o->n < sizeof o->b) o->b[o->n++] = *s++; }
static void bu(Buf *o, uint32_t v) {
  char t[12]; int k = 0;
  do { t[k++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (k && o->n < sizeof o->b) o->b[o->n++] = t[--k];
}
static void bx64(Buf *o, uint64_t v) {
  char t[17]; int k = 0;
  do { t[k++] = "0123456789abcdef"[v & 15]; v >>= 4; } while (v);
  while (k && o->n < sizeof o->b) o->b[o->n++] = t[--k];
}
// v / d for a 32-bit d, by shift and subtract.
static uint64_t udiv64(uint64_t v, uint32_t d, uint32_t *rem) {
  uint64_t q = 0, r = 0;
  for (int i = 63; i >= 0; i--) {
    r = (r << 1) | ((v >> i) & 1);
    if (r >= d) { r -= d; q |= (uint64_t)1 << i; }
  }
  if (rem) *rem = (uint32_t)r;
  return q;
}
// A thousandths value as "int.frac".
static void bmilli(Buf *o, uint64_t m) {
  uint32_t r;
  uint64_t q = udiv64(m, 1000, &r);
  bu(o, (uint32_t)q);
  bs(o, ".");
  o->b[o->n++] = (char)('0' + r / 100);
  o->b[o->n++] = (char)('0' + r / 10 % 10);
  o->b[o->n++] = (char)('0' + r % 10);
}
static void bflush(Buf *o, int fd) { out(fd, o->b, o->n); o->n = 0; }

__attribute__((noreturn)) static void die(const char *msg) {
  Buf o = { .n = 0 }; bs(&o, msg); bs(&o, "\n"); bflush(&o, 2); sys_exit(1);
}

static void *alloc(uint32_t n) {
  struct { uint32_t addr, len, prot, flags, fd, off; } a = { 0, (n + 4095) & ~4095u, 3, 0x22, (uint32_t)-1, 0 };
  long p = sys1(SYS_mmap, (long)&a);
  if (p < 0 && p > -4096) die("out of memory");
  return (void *)p;
}

static uint8_t *readfile(const char *path, uint32_t *len) {
  long fd = sys3(SYS_open, (long)path, 0, 0);
  if (fd < 0) return 0;
  long n = sys3(SYS_lseek, fd, 0, 2);
  sys3(SYS_lseek, fd, 0, 0);
  uint8_t *b = alloc((uint32_t)n + 1);
  uint32_t got = 0;
  while (got < (uint32_t)n) { long r = sys3(SYS_read, fd, (long)(b + got), (uint32_t)n - got); if (r <= 0) break; got += (uint32_t)r; }
  sys1(SYS_close, fd);
  *len = got;
  return b;
}

static int writefile(const char *path, const uint8_t *b, uint32_t n) {
  long fd = sys3(SYS_open, (long)path, 0x241, 0644); // O_WRONLY | O_CREAT | O_TRUNC
  if (fd < 0) return 0;
  out((int)fd, (const char *)b, n);
  sys1(SYS_close, fd);
  return 1;
}

// Monotonic nanoseconds.
static uint64_t now_ns(void) {
  struct { int32_t s, ns; } ts;
  sys3(SYS_clock_gettime, 1, (long)&ts, 0);
  return (uint64_t)(uint32_t)ts.s * 1000000000u + (uint32_t)ts.ns;
}

// The process entry: argc and argv from the initial stack.
int main(int argc, char **argv);
__attribute__((used)) void qg_entry(uint32_t *sp) { sys_exit(main((int)sp[0], (char **)(sp + 1))); }
__asm__(".text\n.globl _start\n_start:\n  xor %ebp, %ebp\n  mov %esp, %eax\n  and $-16, %esp\n  sub $12, %esp\n  push %eax\n  call qg_entry\n  hlt\n");

#endif
