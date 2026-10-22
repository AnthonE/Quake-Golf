// The fork: xbox/sim/ is the Xbox's own copy of the sim, so src/ may change
// its bits freely. But one relay, referee and harness serve both sims, and
// they read memory through src/layout.mjs: every name they use must mean the
// same in the Xbox's layout, or an Xbox room would be read at the wrong place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SRC from '../src/layout.mjs';
import * as XBOX from '../xbox/sim/layout.mjs';

const SHARED = ['net/relay.ts', 'net/referee.mjs', 'net/referee-worker.mjs', 'net/inbox.mjs', 'net/wire.mjs',
  'net/replay.mjs', 'net/tiny-client.mjs', 'harness/core.mjs', 'harness/worker.mjs', 'harness/run-node.mjs', 'src/view.mjs'];

test("the shared net and harness code reads both sims' memory alike", () => {
  const names = new Set();
  for (const file of SHARED) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bL\.([A-Z][A-Z0-9_]*)\b/g)) names.add(m[1]);
    for (const m of text.matchAll(/import \{([^}]+)\} from '[./]+(?:src\/)?layout\.mjs'/g)) for (const k of m[1].split(',')) names.add(k.trim());
  }
  assert.ok(names.size > 20, `found ${names.size} layout names`);
  for (const k of names) {
    assert.ok(k in SRC, `${k} is not in src/layout.mjs`);
    assert.deepEqual(XBOX[k], SRC[k], `${k} differs between src/layout.mjs and xbox/sim/layout.mjs`);
  }
});
