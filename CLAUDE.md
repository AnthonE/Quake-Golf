# Quake Golf

One engine, hand-written WebAssembly (no compiler), deterministic lockstep at
125 Hz: only inputs cross the network, and every machine steps the same bits.
Three games build from `src/`: golf (`build/game.wasm`), the arena with
`ARENA` set (`build/arena/`), and bumper balls with `BUMPER` set
(`build/bumper/`). `xbox/sim/` is a frozen fork of `src/` for the original
Xbox (`build/xbox/`). README.md is the long-form doc; read the section for
whatever you touch.

## Commands

```sh
npm ci && sh tools/install-deno.sh   # once: wabt, binaryen, Deno 2.9.7 in .tools/
npm run build                        # every sim; prints each wasm's sha256
npm test                             # node --test test/*.test.mjs, about 40 s
node --test test/bumper.test.mjs     # one file
node harness/matrix.mjs --ticks 20000 --log logs/x.qgl --wasm build/<sim>/game.wasm   # Node, Deno, Chrome x JIT tiers x 1/2/4 threads
node net/play.mjs [--arena | --bumper] [--bots N]   # relay + page + bots; open the URL it prints
node net/run-arena.mjs / run-bumper.mjs / run-n1.mjs ...   # online gates: relay, bot host, headless Chrome, every hash checked
```

Logs for the matrix come from `tools/genlog.mjs`, `gengame.mjs`,
`genarena.mjs`, `genbumper.mjs`. Gates write `traces/` (screenshots
included). Headless Chrome is Playwright's preinstalled Chromium on
SwiftShader: pictures are right, frame rates mean nothing.

## The sim's rules (the build refuses some; the rest are on you)

- No `memory.grow`, relaxed SIMD, mutable globals or active data segments
  (`tools/asm.mjs` checks source and binary).
- Floats: explicit multiply then add (`(!madd a b c)`), never fused; angles
  through `$sincos` (1/16384 turn), never JS math; `f32.sqrt` is fine.
- `$rand` (the header's PRNG) only from serial code. Everything gameplay is
  serial and in slot order; only ball contacts and integration run on threads,
  and those are Jacobi so any split gives the same bits.
- All gameplay state lives in the 512 KiB region (`src/layout.mjs`), which is
  hashed in 128 slices and snapshotted whole. Scratch outside it must be
  rebuilt from the region (or be per-call), never carried tick to tick.
- Player and projectile accesses take a bank offset `d`: 0 the confirmed
  world, `PRED_D` the prediction's copy. Code the prediction runs (`$move`,
  `$b_move`, ...) writes only its own record and its bank's FX ring; anything
  that touches other players is confirmed-only (`if d == 0`).
- Debug builds (`game.debug.wasm`) trap on any NaN/infinity (`(!chk ...)`):
  test on them.
- JS that mirrors sim math (views, bots, renderers) is for drawing and
  steering only, never fed back. Mirror the sim's integer semantics, e.g. i32
  subtraction wraps (`(a - b) | 0`).

## Layout and the three games

- `src/layout.mjs` is the one memory map for the WAT (`@NAME`, `@(expr)`),
  the harness, the net code and the clients. Physics literals sit in `PHYS`
  (and `BPHYS` for bumper) as strings, inlined as `f32.const`.
- Mode code goes in its own file (`arena.wat`, `bumper.wat`); shared files keep
  their differences behind `#if ARENA` / `#if BUMPER` (nesting works, `#if !X`
  too). Changing a mode must leave the other builds bit-identical: compare the
  sha256s `npm run build` prints before and after.
- `xbox/sim/` is frozen. Net and harness code shared by both sims reads
  memory through names that must mean the same in both layouts
  (`test/fork.test.mjs`); add new names, don't move old ones.
- Inputs are one u32 word per player per tick (golf's layout in
  `src/view.mjs`; the arena's in `arena-view.mjs`; bumper reuses golf's).
  Keep fields that rarely change still: wire v4 codes deltas.

## Style

- Comments are prose, terse and concrete, saying what and why in the code's
  own terms; match the density around them. README sections follow the same
  voice, with measured numbers, not adjectives.
- No new npm dependencies; the whole stack is wabt, binaryen (measurement
  only), Node, Deno and Chrome.
- Tests use `node:test` with helpers in `test/helpers.mjs` (`newSim`,
  `newArena`, `newBumper`); a new mode gets its own test file, a recorded
  log for the matrix, a CI step in `.github/workflows/determinism.yml`, and an
  online gate.
