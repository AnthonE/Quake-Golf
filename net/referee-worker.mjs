// The referee's Worker on the relay (net/relay.ts): closed ticks in, interval
// hashes and packed keyframes out. Messages are handled in order; packing a
// keyframe runs beside the ticks, from a copy taken when it was asked for.
//   in:  { wasm, threads } once, { reset: { room, seed, region? } }, { room, ticks: [each tick's parts] }, { room, want: id }
//   out: { room, intervals: [{ tick, hash, digests }], at }, { room, key: { id, tick, raw, packed } }
import { Referee } from './referee.mjs';
import * as W from './wire.mjs';

let ref = null;
let room = -1;
const base = new W.TickBase();
let queue = Promise.resolve();
self.onmessage = (e) => {
  queue = queue.then(() => handle(e.data)).catch((err) => self.postMessage({ error: String(err?.stack || err) }));
};

async function handle(m) {
  if (m.wasm) ref = await Referee.create(m.wasm, m.threads);
  if (m.reset) {
    room = m.reset.room;
    ref.reset(m.reset.seed, m.reset.region);
    if (m.reset.region) base.seed(m.reset.region); else base.reset();
  }
  if (m.ticks && m.room === room) {
    const intervals = [];
    for (const parts of m.ticks) {
      const { events, words } = base.apply(parts);
      const iv = ref.step({ ev: events, w: words });
      if (iv) intervals.push(iv);
    }
    if (intervals.length) self.postMessage({ room, intervals, at: ref.tick });
  }
  if (m.want !== undefined && m.room === room) {
    const r = room;
    ref.key().then((k) => self.postMessage({ room: r, key: { id: m.want, ...k } }));
  }
}
