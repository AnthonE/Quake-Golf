// Seeded network impairment on the client side, both directions: delay,
// jitter, loss. The future chaos slider; in M0 it shapes the bot runs.
//   const imp = createImpair({ delay: 40, jitter: 10, loss: 0.05, seed: 1 });
//   imp.send(() => writer.write(buf)); imp.recv(() => onBundle(buf));
export function createImpair(opts = {}) {
  let s = (opts.seed >>> 0) || 1;
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const cfg = { delay: 0, jitter: 0, loss: 0, ...opts };
  const stats = { sent: 0, dropped: 0, received: 0, droppedIn: 0 };
  const shape = (fn, inbound) => {
    if (cfg.loss > 0 && rand() < cfg.loss) {
      inbound ? stats.droppedIn++ : stats.dropped++;
      return;
    }
    inbound ? stats.received++ : stats.sent++;
    // half the round-trip delay each way
    const ms = cfg.delay / 2 + (cfg.jitter > 0 ? (rand() * 2 - 1) * cfg.jitter / 2 : 0);
    if (ms <= 0) fn();
    else setTimeout(fn, ms);
  };
  return {
    cfg,
    stats,
    set: (o) => Object.assign(cfg, o),
    send: (fn) => shape(fn, false),
    recv: (fn) => shape(fn, true),
  };
}

export function parseImpair(str) {
  const out = {};
  for (const part of (str || '').split(',').filter(Boolean)) {
    const [k, v] = part.split('=');
    out[k] = Number(v);
  }
  return out;
}
