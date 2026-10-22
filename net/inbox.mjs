// One closed tick into the sim's inbox, exactly as every client and the
// referee apply it: joins and leaves in the order the relay listed them, then
// an input record per word. d: { ev: [{ slot, kind }] with the wire's kinds,
// w: a row (Uint32Array, one word per slot) or the words that changed, [[slot, word]] }.
// The forms give the same records' effect: the sim keeps a player's word until
// a new one comes, and an input for a slot that isn't live does nothing.
import * as L from '../src/layout.mjs';
import * as W from './wire.mjs';
import { encodeLog } from '../harness/core.mjs';

const KIND = { [W.EV_JOIN]: L.EV_JOIN, [W.EV_LEAVE]: L.EV_LEAVE };

export function feedTick(u8, dv, d) {
  let n = 0;
  const put = (kind, slot, word) => {
    const o = L.INBOX_REC + n++ * L.REC;
    u8.fill(0, o, o + L.REC);
    u8[o + 4] = kind;
    u8[o + 5] = slot;
    dv.setUint32(o + 8, word >>> 0, true);
  };
  for (const e of d.ev) if (KIND[e.kind]) put(KIND[e.kind], e.slot, 0);
  if (d.w instanceof Uint32Array) for (let p = 0; p < d.w.length; p++) put(L.EV_INPUT, p, d.w[p]);
  else for (const [p, w] of d.w) put(L.EV_INPUT, p, w);
  dv.setUint32(L.INBOX, n, true);
}

// The relay's record of a room (one encoded tick, its parts, per sim tick) as
// a .qgl log the harness replays, for a desync's repro case.
export function recordLog(record, seed) {
  const recs = [];
  const base = new W.TickBase();
  record.forEach((parts, t) => {
    const { events, words } = base.apply(parts);
    for (const e of events) if (KIND[e.kind]) recs.push([t, KIND[e.kind], e.slot]);
    for (const [p, w] of words) recs.push([t, L.EV_INPUT, p, w]);
  });
  return encodeLog({ courseSeed: seed, ticks: record.length, recs });
}
