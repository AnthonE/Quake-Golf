# Quake Golf

One engine, hand-written WebAssembly (no compiler), deterministic lockstep at
125 Hz: only inputs cross the network, and every machine steps the same bits.
Four games build from `src/`: golf (`build/game.wasm`), the arena with
`ARENA` set (`build/arena/`), bumper balls with `BUMPER` set
(`build/bumper/`), and party, a minigame a round, with `BUMPER` and `PARTY`
(`build/party/`). **Fireplace** (`build/fireplace/`) is the party game made
of them: all four in one module, a playlist the room plays through, a living
room for a menu (`client/fireplace.html`). `xbox/sim/` is a frozen fork of
`src/` for the original Xbox (`build/xbox/`). README.md is the long-form doc;
read the section for whatever you touch. `docs/roadmap.md` is the plan for
what comes next.

## Commands

```sh
npm ci && sh tools/install-deno.sh   # once: wabt, binaryen, Deno 2.9.7 in .tools/
npm run build                        # every sim; prints each wasm's sha256
npm test                             # node --test test/*.test.mjs, 429 tests, about 6 min
node --test test/bumper.test.mjs     # one file
node harness/matrix.mjs --ticks 20000 --log logs/x.qgl --wasm build/<sim>/game.wasm   # Node, Deno, Chrome x JIT tiers x 1/2/4 threads
node net/play.mjs [--arena [--mode k] | --bumper | --party [--mg k] | --fireplace] [--bots N]   # relay + page + bots; open the URL it prints
node net/run-arena.mjs / run-bumper.mjs / run-party.mjs / run-fireplace.mjs / run-n1.mjs ...   # online gates: relay, bot host, headless Chrome, every hash checked
```

Logs for the matrix come from `tools/genlog.mjs`, `gengame.mjs`,
`genarena.mjs`, `genbumper.mjs`, `genparty.mjs`, `genfireplace.mjs`. Gates write `traces/`
(screenshots included). Headless Chrome is Playwright's preinstalled Chromium
on SwiftShader: pictures are right, frame rates mean nothing, and drawing to an
on-screen canvas destroys the GPU device, so gate pages run with `?present=0`
(renderers then draw only into capture textures). Don't `pkill -f <name>` in a
shell whose own command line contains the name: it kills that shell.

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

## Layout and the games

- `src/layout.mjs` is the one memory map for the WAT (`@NAME`, `@(expr)`),
  the harness, the net code and the clients. Physics literals sit in `PHYS`
  (and `BPHYS` for bumper) as strings, inlined as `f32.const`.
- Mode code goes in its own file (`arena.wat`, `bumper.wat`); shared files keep
  their differences behind `#if ARENA` / `#if BUMPER` (nesting works, `#if !X`
  too). Changing a mode must leave the other builds bit-identical: compare the
  sha256s `npm run build` prints before and after.
- Party (`src/party.wat`) is bumper's ball with bumper.wat's cheese and round
  behind `#if !PARTY`. Each minigame is `src/mg/<key>.wat` (nine hooks under
  its prefix, called through `(!mg)`), its constants in `src/mg/<key>.mjs`
  (literal numbers, no imports; the WAT sees them through layout.mjs's
  `MG_CONSTS`, JS imports the file itself), its client module
  `client/mg/<key>.mjs`, its tests `test/mg-<key>.test.mjs`. State only in
  `PG_H` (header, in the prediction's copy), `PG_S`, `PG_BIG` and the record's
  party fields. `begin` (a ball's own start), `ground` and `push` run on the
  prediction's bank too: they read bank d's header, confirmed state fixed at
  least as far ahead as the prediction runs (the host's 201 ticks), and bank
  d's FX ring (what its own ball did this run: Thin Ice's own cracks), and
  write only that ball's record and that ring. A seed whose top byte is 0xA7
  forces a minigame (`--mg k`). `node tools/new-mg.mjs <key> <prefix> NAME`
  writes a new one and appends it to every list that names them
  (`test/new-mg.test.mjs` holds its anchors).
- The arena's match modes (`M_*`: Fiesta, Infection, gun game, Juggernaut,
  and the team modes Team Slayer, Capture the Flag, Oddball, King of the
  Hill) are picked per match at run time, not built: `AH_MODE` to `AH_END`
  at `REGION + 0x48..0x74` (the team modes' scores, target and winner
  included), a side in `P_FL` (`PF_ZOMBIE`, `PF_JUGG`, `PF_BLUE`, and
  `PF_CARRY` for a flag's or the skull's carrier), per-fighter state at
  `MODE_REC`, a team mode's objective in `AO` (`REGION + 0xcc00`, 1 KiB).
  A Fiesta must leave all of it 0, so its region stays what it was;
  `forcedSeed(m)` (`arena-view.mjs`) makes a room play one mode. The team
  modes are a kit: the core in `arena.wat` (sides, spawns, scores, the end,
  carrying), each mode `src/am/<key>.wat` (four hooks under its prefix,
  `start`, `tick`, `kill`, `bar`, called through `(!am)`, all on the
  confirmed world), its constants and AO fields in `src/am/<key>.mjs`
  (literal numbers; gathered into `AM_CONSTS` for the assembler as
  `MG_CONSTS` is, and read in JS from `src/am/consts.mjs`), its
  client module `client/am/<key>.mjs` (drawing, HUD, news, board, the AI
  fighter's goal), its tests `test/arena-<key>.test.mjs`. The map's
  objectives (flags, skull, hills) are `MAP_OBJ`, from `map.json`.
- `xbox/sim/` is frozen. Net and harness code shared by both sims reads
  memory through names that must mean the same in both layouts
  (`test/fork.test.mjs`); add new names, don't move old ones.
- Fireplace (`src/fireplace.wat`): each game is its own build under a prefix
  (`tools/asm.mjs` `prefixed()`, `GAMESETS`), so a change to a game changes
  Fireplace too. The playlist's state is the header's last 16 bytes
  (`FP_GAME`...) and `REGION + 0xe000` (8 KiB no game uses: marshmallows,
  `FP_NEXT`, `FP_MODE`): keep games out of both. `PLAYLIST` goes by position
  (games played mod its length), so a game may come twice; the next seed is
  drawn as a game ends (the arena's forces a mode, party's never a minigame).
  A game's static world (terrain, map) is rebuilt by `regrid` when a keyframe
  from another game arrives (`FP_WORLD`, `FP_STASH` at `0x360000`).
- Inputs are one u32 word per player per tick (golf's layout in
  `src/view.mjs`; the arena's in `arena-view.mjs`; bumper and party reuse golf's).
  Keep fields that rarely change still: wire v4 codes deltas.

## Clients

- `client/host.mjs` owns what a page shares (memory, net and sim workers, the
  prediction's instance, sound, one GPU device); each game's frontend
  (`client/<game>-game.mjs`) exports `mount(host, opts)` returning
  `{ frame(now, target), unmount(), capture(), state() }`, with every listener
  on an AbortController. `bumper.html` and `arena.html` mount one alone;
  Fireplace mounts each in turn. Golf's own page, `client/main.mjs`, is
  separate (the CI gates drive its `window.__qg` hooks); `golf-game.mjs` is
  the lean frontend for Fireplace.
- Renderers take `{ device }` to share the page's GPU device, and draw into
  `target` (a texture) when given one: that is how the TV shows a game.
- The room's look is a theme (`client/themes/<id>.json`, `client/themes.mjs`):
  data only the room's shader reads, local to the viewer, never the sim.
  Grandma's writes out every default. A new colour goes in `COLORS`, the
  shader and CONTRIBUTING.md's table (`test/themes.test.mjs` checks all
  three); `elo.json`'s mods are written from the themes (`node tools/elo.mjs`).
- `elo.json` is Fireplace's manifest for its Elo Pros store row (jobs, mods);
  CONTRIBUTING.md is the outside contributor's guide, pay included.

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
