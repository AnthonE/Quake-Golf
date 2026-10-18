# Quake Golf

64 players, one course, rockets and grenades as clubs, and every ball ever hit
stays in play. The sim is **hand-written WebAssembly** (no compiler), stepped in
deterministic lockstep at 125 Hz, so only inputs cross the network: bandwidth
follows players, never balls.

Design doc and netcode review: [Quake Golf — Design Doc](https://claude.ai/artifact/QTA2QtjNiu4HLWW2115bW7).
Target: the newest Chrome; the server is Deno.

## Where it is

| Milestone | Gate | Status |
| --- | --- | --- |
| M2 · first hole | a full hole plays end to end, two players over the real server | **passed** · [results](#m2-the-first-hole) |
| M1 · determinism harness | zero hash mismatches over 1M ticks | **passed** · [results](#results) |
| M0 · net skeleton | a 64-player bundle fits one datagram | **passed** · [results](#results) |

## Play it

```sh
npm ci && sh tools/install-deno.sh   # once
node net/play.mjs                    # the relay and the page; open the URL it prints in two Chrome tabs
```

Click to play. The mouse aims, WASD runs, Space jumps, left click fires, 1/2
or right click picks the rocket or the grenade, Tab shows scores, F goes
fullscreen. Every shot is a stroke. The rocket is the club: a blast just
behind your ball drives it 200+ m with loft, one 4 m back rolls it a few
metres, and the cup is a slipgate that swallows any ball under 8 m/s. The
grenade bounces and pops after 2.5 s, for lobs. A rocket at your own feet is
a rocket jump (and a stroke). Holes last 4 minutes; not finishing costs 2.
Your own movement shows one round trip late until M3's prediction layer;
aiming is instant.

## Run it

```sh
npm ci && sh tools/install-deno.sh     # wabt, binaryen, Deno 2.9.7 into .tools/
npm run build                          # src/*.wat -> build/game.wasm
npm test                               # assembler, XXH64, sim, gameplay, splits, keyframes, threads, wire
node harness/matrix.mjs --ticks 20000  # Node, Deno, Chrome x Liftoff/TurboFan x 1/2/4 threads
node tools/gengame.mjs --bots 4 --out logs/game.qgl && node harness/matrix.mjs --ticks 20000 --log logs/game.qgl
node harness/perf.mjs                  # per-phase cost at 10,000 balls
node net/run-m0.mjs --bots 63 --duration 60 [--impair delay=40,jitter=10,loss=0.05]
node net/run-m2.mjs [--impair delay=60,jitter=15,loss=0.05]   # two bot-played Chrome clients, one hole
```

## How it fits together

- `src/*.wat` is the sim, written by hand. `tools/asm.mjs` is the macro
  assembler: it folds `@LAYOUT` constants into memory operands, expands
  `(!macros)` from `src/macros.mjs`, strips debug-only asserts from release
  builds, and refuses what the determinism rules ban (relaxed SIMD,
  `memory.grow`, data segments, mutable globals). wabt assembles the result.
- `src/layout.mjs` is the one memory map: a 512 KiB region hashed in 128
  slices, scratch outside it, terrain regenerated from the seed.
- Contacts are Jacobi: phase A reads only start-of-tick state, phase B writes
  only its own balls, so any split across threads gives the same bits. The
  tests run random splits in shuffled order and real 2- and 4-thread runs.
- `harness/` replays one event log in Node, Deno and a Chrome worker and
  records a hash of the whole region every tick. `tools/compare.mjs` names the
  first tick that differs and which slice and field it was in.
- `net/relay.ts` is the relay: one isolate owns the QUIC sessions, an 8 ms
  clock from a fixed epoch, and the bundles (four ticks every second tick, with
  a per-recipient trailer). It also records every closed tick from the room's
  start, and answers fill requests from that record on the control stream: a
  joiner's whole history (M3 replaces it with keyframes) and any tick lost on
  the way (M3 replaces it with repair datagrams). An emptied room starts over
  on a new seed.
- Gameplay is in the sim too, all serial and in index order: `players.wat`
  (Quake movement, shots on a shot-counter advance, pushes on other players'
  balls), `weapons.wat` (rockets marched in half steps, bouncing grenades,
  blasts on balls and players), `hole.wat` (the slipgate cup and the hole
  clock) and `terrain.wat`, which lays out a hole per seed: tee, fairway,
  rough, bunkers and a flattened green. Inputs, joins and leaves are inbox
  records, so a match is an ordinary event log the harness replays.
- `client/` is the browser game on three threads over one shared memory. The
  net worker owns WebTransport and the clock and samples one input word a
  tick; the sim worker steps confirmed ticks behind a 3-tick playout delay;
  the main thread reads raw mouse and keys and draws with WebGPU straight
  from shared memory: the terrain ray-marched per pixel at 320x200, bodies
  as splats, a 3x5 HUD font. `?bot=1` hands the controls to `client/bot.mjs`,
  which plans every shot on a private copy of the sim.

## Results

Measured in a 4-core cloud container on 2026-10-18, game.wasm sha256
`42a59430…`: 6,401 B, 3,200 B gzipped. Binaryen `-O3` makes it 5,923 B but
3,220 B gzipped, so the hand-written build ships as is.

**M1, determinism.** One 1M-tick log (10,000 balls, ~600 awake, a blast
every 24 ticks, a wake storm every 2,000) replayed in Node 22 (V8 12.4),
Deno 2.9.7 (V8 15.0) and Chrome 141 (V8 14.1) on 4 threads: every tick's
region hash agrees. At 100k ticks all 27 configurations agree: each runtime,
default / Liftoff only / TurboFan only, 1, 2 and 4 threads.

| Confirmed tick, 10,000 balls, ~600 awake | ms |
| --- | --- |
| one thread, Node (tick_begin 0.11, contacts 0.26, integrate 0.04, tick_end 0.01) | 0.41 |
| p99 tick (two runs) | 0.68–0.84 |
| one thread, Chrome / Deno | 0.31 / 0.34 |
| Liftoff only (Chrome) | 0.96 |
| budget | 1.5 |

At ~600 awake, threads do not help: three barriers a tick cost about what
the split saves. With ~2,900 awake (a large blast every 8 ticks) one thread
takes 1.51 ms, at the budget, while 2 threads take 0.98 ms and 4 take 0.77 ms.
`node harness/perf.mjs` prints all of this.

**M0, the relay.** 63 bots and one client, each a WebTransport session in a
Chrome worker, against the Deno relay on loopback for 60 s:

| | clean | 40 ms RTT, 10 ms jitter, 5% loss |
| --- | --- | --- |
| largest bundle (limit 1,161 B) | 1,052 B | 1,052 B |
| ticks delivered | 100%, every client | 99.745% (expected 99.75%), worst client 99.44% |
| inputs applied as sent | 99.92% | 99.40% |
| bundle jitter p50 / p95 / p99 | 0.23 / 2.6 / 6.9 ms | 2.5 / 5.4 / 9.3 ms |
| tick close lateness p50 / p99 | 0.001 / 3.8 ms | 0.002 / 3.5 ms |
| per session, down / up (payload) | 65 / 1.5 KB/s | 65 / 2.7 KB/s |
| relay CPU | 39% of a core | 41% of a core |

Chrome reports a 1,024 B `maxDatagramSize`, which only limits what it sends;
it receives the 1,052 B bundles fine. The relay's cost is per packet in Deno's
QUIC path (~8,000 packets a second per room); the referee sim is about 5% of a
core. So packets set rooms per core: about two today. BBR
(`congestionControl: "low-latency"`) and the default controller measured the
same.

The tail is this VM, not the relay. Closes ran 30-70 ms late a few times a
minute even with no clients connected. Two causes:

- V8's parallel scavenger waits on helper threads, and idle vCPUs here wake
  slowly, so a 0.3 ms scavenge took up to 69 ms. The relay runs with
  `--v8-flags=--single-threaded-gc`; a Node timer loop goes from 28 ms gaps to
  none with it.
- A thread sleeping on a timer also wakes late. Spinning instead of sleeping
  (`--early 9`) takes an idle relay from a 54 ms worst case to 18 ms, but under
  load it barely helps and costs a whole core, so the relay still sleeps.

Across seven 60 s runs the close-lateness p99 ranged from 1.0 to 3.8 ms.
