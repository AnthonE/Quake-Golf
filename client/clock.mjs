// A clock in shared memory, one writer and any readers: in server ticks,
// tick(now) = base + (now - epoch) * rate / TICK_MS, now in epoch ms. A
// sequence word, odd mid-write, keeps a reader from mixing two writes.
import { TICK_MS } from '../net/wire.mjs';

export function writeClock(i32, f64, addr, base, epoch, rate = 1) {
  Atomics.add(i32, addr >> 2, 1);
  f64[(addr >> 3) + 1] = base;
  f64[(addr >> 3) + 2] = epoch;
  f64[(addr >> 3) + 3] = rate;
  Atomics.add(i32, addr >> 2, 1);
}

export function readClock(i32, f64, addr, now) {
  for (;;) {
    const s = Atomics.load(i32, addr >> 2);
    const base = f64[(addr >> 3) + 1], epoch = f64[(addr >> 3) + 2], rate = f64[(addr >> 3) + 3];
    if (!(s & 1) && Atomics.load(i32, addr >> 2) === s) return base + (now - epoch) * rate / TICK_MS;
  }
}
