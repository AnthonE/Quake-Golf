// A worker running `count` M0 bots concurrently.
import { runBot, b64ToBytes } from '../bot.mjs';

self.onmessage = async (e) => {
  const { url, hash, count, seed, durationMs, impair, prefix } = e.data;
  try {
    const certHash = b64ToBytes(hash);
    const results = await Promise.all(Array.from({ length: count }, (_, i) =>
      runBot({ url, certHash, wasmPrefix: prefix, seed: seed + i, durationMs, impair })));
    self.postMessage({ results });
  } catch (err) {
    self.postMessage({ error: String(err?.stack || err) });
  }
};
