# Quake Golf

64 players, one course, rockets and grenades as clubs, and every ball ever hit
stays in play. The sim is **hand-written WebAssembly** (no compiler), stepped in
deterministic lockstep at 125 Hz, so only inputs cross the network: bandwidth
follows players, never balls.

Design doc and netcode review: [Quake Golf — Design Doc](https://claude.ai/artifact/QTA2QtjNiu4HLWW2115bW7).
Target: the newest Chrome; the server is Deno. The same sim also runs as
Pentium III code on the original Xbox: see [X1](#x1-the-original-xbox).

## Where it is

| Milestone | Gate | Status |
| --- | --- | --- |
| X2 · Xbox online | the Xbox build plays in the browser's rooms over a lossy network: every hash equals the referee's, a late join from a keyframe on the Pentium III's instruction set, a flipped bit healed | **passed** with the Xbox's network code on Linux and under QEMU, not yet in xemu · [results](#x2-xbox-online) |
| X1 · original Xbox | the sim as Pentium III code equals V8 on every tick of 1M; an XBE builds; a match played on the Xbox build replays in V8 tick for tick | **passed** under QEMU's Pentium III, not yet on a console · [results](#x1-the-original-xbox) |
| M3 · netcode | four players at 150 ms and 10% loss: your moves show next frame, a late join from a keyframe, a flipped bit caught and healed | **passed** · [results](#m3-netcode) |
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
Your own movement, shots and rocket jumps are predicted, so they show on the
next frame; other players and every ball show a round trip late. To feel a
bad network, add `&impair=delay=150,jitter=15,loss=0.1` to the URL: a 150 ms
round trip with 10% loss each way.

## Play it on an original Xbox, or in xemu

You need the ISO and a relay. Build them from the same commit: the relay
refuses an Xbox whose sim differs from its own `game.wasm`.

**The ISO.** Every push builds it in CI: open the newest run of the
`determinism` workflow on GitHub Actions and download the `quake-golf-xbox`
artifact (`Quake Golf.iso` and `default.xbe`). Or build it yourself on Linux or
macOS:

```sh
npm ci && sh tools/install-nxdk.sh   # once: nxdk, the open-source Xbox SDK, pinned, into .tools/nxdk
make -C xbox                         # xbox/bin/default.xbe and xbox/Quake Golf.iso
make -C xbox SERVER=192.168.1.20:4434   # the same, aimed at a relay elsewhere (written to quakegolf.txt in the ISO)
```

**The relay**, on the machine that runs xemu. It needs Node 22, Deno 2.9
(`sh tools/install-deno.sh` puts it in `.tools/` on Linux; elsewhere install
it and keep `deno` on your PATH), and `sh` and `openssl` (on Windows, run it
from Git Bash):

```sh
npm ci
node net/play.mjs    # Chrome players on UDP 4433, Xbox players on TCP and UDP 4434
```

**xemu.** Open Settings, then Network: enable it and set it to NAT. Then
Machine, then Load Disc, and pick `Quake Golf.iso`. On the title screen, X
plays online. The server it shows, `10.0.2.2:4434`, is how xemu's NAT
reaches the machine running xemu, so it finds the relay with nothing to
set up. Y changes the server: the d-pad edits, White deletes, A is done. A
plays locally instead, split screen for up to four.

Online, one controller plays. The left stick runs, the right stick aims, A
jumps, the right trigger fires, Y or X switches between rocket and grenade,
and holding the left trigger or B slows the aim for lining up a shot. Back
and Start together leave. Browser players can join the same room: open the
URL `play.mjs` prints in Chrome.

**A relay elsewhere, or a real Xbox.** Start the relay with
`node net/play.mjs --host 0.0.0.0`, let TCP and UDP 4434 through its
firewall, and point the Xbox at that machine's address: `SERVER=` when you
build, or Y on the title screen. A real console takes the same ISO or XBE,
softmodded or modchipped, on its Ethernet port.

## Play it as an agent

```sh
node tools/agent.mjs --course 11 --bots 1     # a local room on http://127.0.0.1:7777/, you are slot 0
curl -s localhost:7777/                       # the rules and the commands
curl -s localhost:7777/0 -d 'wait 3; face cup; hold w 2'   # act, then see
curl -s localhost:7777/0.json                 # the same view as JSON, for scripts
```

Any agent that can make an HTTP request (or pipe text: `--stdin`) plays
through the same input word a mouse and keys make, and no more: `aim`,
`face`, `hold` keys for a time, `fire`, `weapon`, `wait`. There is no
pathfinding and no auto-shot. Every reply is the screen and HUD as text:
the clock, your strokes, where your ball and the cup are and how far, the
lie, the other players, the blasts and sinks since your last look. The help
carries what a person learns by feel: blast distance against shot length,
where to stand, how far you slide. The door is `client/agent.mjs`, shared
by any transport; the room is `tools/agent.mjs`.

The room is stepped: the world moves only while an agent's command runs, so
a slow thinker loses nothing by thinking, and the hole clock still counts
every tick it plays. Golf bots play the slots after the agents. The match
is an ordinary event log, saved after every command, and it replays in the
harness like any other.

The first agent game: Claude, from this repo's own session, on course 11
(par 4, 238 m) against one golf bot. The bot birdied it in 3. Claude took 12
strokes, ran out the clock and scored 14: the bot's drive blast, fired 3
ticks earlier and 2.6 m away, knocked its first shot about 60° off line,
then it ping-ponged across a cup that sits in a hollow, where every shot
strong enough to reach the cup ran through and up the far side. With no
private sim to try shots on, distance is a guess; the bot tries each shot on
one first. The log (30,489 ticks) replays to the same hash on every tick on 1
and 4 threads.

## The neural golfer

```sh
node tools/zoo.mjs --gens 500                     # breed; logs/zoo.genome holds the best so far
node tools/zoo.mjs --bench qg1:...                # 40 held-out courses, shots alone
node tools/zoo.mjs --real qg1:...                 # the same courses as real holes, then the golf bot on them
node tools/agent.mjs --genome qg1:...             # play against it through the agent door
```

Or play it in Chrome: run `node net/play.mjs` and add `&bot=1&genome=qg1:...`
to the URL it prints.

A 274-weight net that judges each shot by feel, where the golf bot tries 24
on a private sim first. It reads a ball at rest as fourteen numbers (the
cup's distance and height, the lie, the ground at six points along the line
and 5 m ahead of and behind the ball) and answers with the blast distance behind
the ball and a turn of up to 6°. It walks and aims on the golf bot's own
legs, so the shot choice is the only difference between the two
(`client/brain.mjs`).

Its genome stores no weights. It is a base seed and one 16-bit seed per
accepted mutation, and replaying that rebuilds the weights bit for bit (the
encoding of Such et al. 2017), using only `+ - * /` and `sqrt`, which IEEE
754 rounds the same everywhere. As `qg1:` and base64url, 101 mutations
still fit in a tweet. `tools/zoo.mjs` breeds it on worker threads: a parent
and fifteen children play eight training courses by shots alone (each shot
taken from its spot, as the bot's private sim takes them), and the best
child replaces the parent only if it beats it again on sixteen fresh
courses. Without that second test, the best of fifteen beats its parent on
eight courses most generations by luck alone.

The first run (seed 1) kept 101 children in 214 generations, filled the
tweet and stopped, in 19.5 minutes on 4 threads here. On 40 held-out courses
(seeds 1-40; training used 1000-1199):

| | shots alone (10 at most, else +2) | real holes (walking, the clock) |
| --- | --- | --- |
| a random net (no mutations) | 11.28, 10 sunk | |
| a rule of thumb (blast distance by range) | 9.95, 15 sunk | |
| **the neural golfer, 279 chars** | **5.92, 38 sunk** | **5.20, 39 sunk** |
| the golf bot, 24 tries a shot | 3.10, 40 sunk | 2.33, 40 sunk |

Foresight still wins by about three strokes a hole. The golfer's misses are
blowups, not a steady handicap: 18 and 14 on two courses, 2 to 9 on the
rest. On course 11, where Claude scored 14 through the agent door, it took 4.
With its genome at both Chrome clients' controls (`net/run-m2.mjs --genome`),
the M2 gate passes on course 7: both sunk, in 6 and 3, and all 91 interval
hashes agree. The genome:

```
qg1:hmagd9R84qfApxdNJr9m7qGTDze89_fPvOrWRvL6Ix8GBSRrnqFkzBNYMDW1pW27iDe4g69MYSkakvfQnCV_h85kL5fgcCu0M0JRF2BBg0DkgraHYTDXFtqUrky8JyF9XqY_Mvs-yZedc04dJ6t9d0D-X2CoNp-t111binHDw7T3F9Ce8lARMQ0DdbYVmIc2fy2maDwVdB3fVzlR-GNZjKd4g3e7cH29HbSaFmFhWPD2ji01gF7wWwQz3boUvDq3BABIf9OqfqCIH8492xY
```

## Run it

```sh
npm ci && sh tools/install-deno.sh     # wabt, binaryen, Deno 2.9.7 into .tools/
npm run build                          # src/*.wat -> build/game.wasm
npm test                               # assembler, XXH64, sim, gameplay, splits, keyframes, threads, wire, agent door
node harness/matrix.mjs --ticks 20000  # Node, Deno, Chrome x Liftoff/TurboFan x 1/2/4 threads
node tools/gengame.mjs --bots 4 --out logs/game.qgl && node harness/matrix.mjs --ticks 20000 --log logs/game.qgl
node harness/perf.mjs                  # per-phase cost at 10,000 balls
node net/run-m0.mjs --bots 63 --duration 60 [--impair delay=40,jitter=10,loss=0.05]
node net/run-m2.mjs [--impair delay=60,jitter=15,loss=0.05]   # two bot-played Chrome clients, one hole
node net/run-m3.mjs [--clients 4] [--impair delay=150,jitter=15,loss=0.1]   # four, a late join, a flipped bit
node tools/x86.mjs                     # game.wasm -> Pentium III assembly, the native runner, the Xbox core's test driver (clang)
node harness/matrix.mjs --ticks 20000 --runtimes node,x86,pentium3   # that code on this CPU and under qemu-i386 -cpu pentium3
node net/run-x2.mjs [--chrome 1] [--seconds 60] [--late 15] [--flip 25] [--impair delay=100,jitter=15,loss=0.05]   # Xbox clients online
build/x86/replay --log logs/perf24000.qgl --ticks 24000 --time-from 16000   # its per-tick cost, perf.mjs's window
build/x86/xbox-headless --out traces/xbox --players 2   # a scripted hole on the Xbox core: frames (.ppm), the match (.qgl, .qgh)
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
  a per-recipient trailer). It records every closed tick from the room's
  start and hands it to the referee, `net/referee.mjs` in a Worker: the same
  game.wasm stepping the room, the truth for interval hashes and keyframes.
  A joiner gets the newest keyframe and the record since it. A tick a
  client's per-tick acks lack comes back in a repair datagram. A client whose
  interval hash differs from the referee's gets the keyframe again, with the
  referee's slice digests so it can name the slice, and the room's record is
  saved as a .qgl that replays the desync. An emptied room starts over on a
  new seed.
- Gameplay is in the sim too, all serial and in index order: `players.wat`
  (Quake movement, shots on a shot-counter advance, pushes on other players'
  balls), `weapons.wat` (rockets marched in half steps, bouncing grenades,
  blasts on balls and players), `hole.wat` (the slipgate cup and the hole
  clock) and `terrain.wat`, which lays out a hole per seed: tee, fairway,
  rough, bunkers and a flattened green. Inputs, joins and leaves are inbox
  records (`net/inbox.mjs` is the one way a closed tick becomes them), so a
  match is an ordinary event log the harness replays.
- Every player and projectile access is a constant offset plus a record
  address plus a bank offset: 0 for the confirmed world, `PRED_D` for a copy.
  `predict.wat` copies the header, players and projectiles there and steps one
  player and only its projectiles through pending inputs with the same code a
  confirmed tick runs, writing nothing else. With nothing remote in the way it
  matches what the confirmed world later does, bit for bit.
- `client/` is the browser game on three threads over one shared memory. The
  net worker owns WebTransport and two clocks (`client/clock.mjs`): the
  predicted one, the server's tick plus an input lead sized from the relay's
  jitter, on which it samples one input word a tick; and the playout clock,
  2 ticks plus the p95 jitter of first arrivals behind the earliest, run up to
  3% fast or slow. It acks every tick and unpacks keyframes. The sim worker
  steps confirmed ticks to the playout clock, restores keyframes, reports
  each interval's hash and asks for a resync when a hole outlives the repair
  window or it falls 2 s behind. The main thread reads raw mouse and keys,
  rebuilds the prediction every frame on its own instance of game.wasm (the
  sampled inputs, then the tick in progress with the input as it is now),
  eases corrections in over 100 ms, and draws with WebGPU straight from
  shared memory: the terrain ray-marched per pixel at 320x200, bodies as
  splats, your own player and shots from the prediction, a 3x5 HUD font.
  `?bot=1` hands the controls to `client/bot.mjs`, which plans every shot on a
  private copy of the sim.
- `tools/w2x86.mjs` translates game.wasm into i386 assembly for the Xbox's
  Pentium III: integer ops and CMOV, SSE1 for f32 and f32x4, nothing from
  SSE2. Every op keeps wasm's bits: MXCSR pinned to round-to-nearest with no
  FTZ or DAZ; min and max from both orders of `minss`/`maxss`, so NaN comes
  out and -0 < +0; saturating truncation and unsigned conversion with their
  edges on cold paths; floor-then-truncate as truncate and step down; i64 in
  register pairs; integer SIMD lanes as scalar code; a bounds check on every
  computed address. Locals live in the frame, the operand stack is cached in
  registers within a basic block, compares feed branches, `select` and CMOV
  straight from the flags, and leaf functions up to 48 ops are inlined. Each
  export gets a cdecl wrapper that saves and sets MXCSR and the x87 control
  word, so nothing the host does to the FPU reaches the sim.
- `net/relay.ts` also has a native door, `--native-port` (4434): the same
  session with a TCP connection for the stream and UDP for the datagrams,
  each of the client's prefixed with a token from the welcome. Native and
  browser players share rooms. `xbox/online.c` is the client end, the
  browser's net and sim workers as one single-threaded loop: the server's
  clock from pings, the input lead from the relay's slack, the playout clock
  from first arrivals, per-tick acks, repairs, keyframe joins (gunzipped by
  `xbox/inflate.c`), resyncs, hash reports, and the prediction layer for your
  own player. `xbox/net_xbox.c` puts it on lwIP; `xbox/plat_linux.h` on Linux
  sockets, with the browser's impairment model.
- `harness/native/` runs that code the way `harness/` runs the wasm:
  freestanding (raw Linux syscalls, no libc), the same .qgh trace, graded by
  `matrix.mjs` as `x86` (this CPU) and `pentium3` (`qemu-i386 -cpu pentium3`,
  which faults on anything past SSE1). `test/x86.test.mjs` runs every op the
  translator knows over the values that catch a port out, against V8.
- `xbox/` is the console game. `game.c` turns controllers into input words,
  steps at 125 Hz and draws in software: Comanche-style voxel columns over the
  sim's heightfield with the browser's surface colours, fog and sky; balls,
  players, projectiles and blasts as depth-tested sprites; the browser's 3x5
  HUD font. `main.c` is the nxdk front end (SDL2 game controllers, a 320x240
  frame doubled into the 640x480 framebuffer). `headless.c` is the same core
  on Linux with scripted controllers: `test/xbox.test.mjs` plays a two-player
  hole on it and replays the recorded match in V8.

## X2, Xbox online

`node net/run-x2.mjs` starts the relay, one Chrome client with the golf bot at
the controls, and two native clients. Those run the Xbox's own network code
(`xbox/online.c`) with scripted controllers: they line up a rocket drive,
take it, follow the ball, walk and hop. One joins with the room; the other
joins 15 s late, from a keyframe, running under `qemu-i386 -cpu pentium3`.
Every datagram, both ways, has a 100 ms round trip, 15 ms jitter and 5% loss.
25 s in, the first native client flips a bit of its own score total, as M3
does to a browser client. CI runs the same without Chrome on every push.

| 60 s, 100 ms round trip, 15 ms jitter, 5% loss each way | |
| --- | --- |
| interval hashes vs the referee's | Chrome 59 of 59; native 55 of 55 (3 more fall between the flip and its heal); the late one under QEMU 43 of 43 |
| the flip | flipped at sim tick 3,109, caught at the interval closing at 3,328, healed by a desync keyframe for 3,328 |
| the late join | a keyframe at sim tick 1,920 (774 B packed, unpacked by `xbox/inflate.c`), 29 ticks to fast-forward |
| repairs | 114 ticks in 34 datagrams, for 5% loss each way |
| input lead, prediction | 11 to 12 ticks of lead; the prediction ran 24 to 26 ticks ahead of the confirmed world |
| per session | 65 KB/s down, 4.9 KB/s up |

`test/online.test.mjs` unpacks real keyframes with the C code (a fresh course,
and a pit of over 800 balls) and data that forces stored blocks and long
matches, byte for byte against what the referee packs.

In xemu, the sim and the software renderer run on QEMU's emulation of the
Pentium III, as the late client did here. On a slow host, if it falls more
than 2 s behind, it asks for a keyframe and starts again from there, the same
as a stalled browser tab.

## X1, the original Xbox

The original Xbox is a 733 MHz Pentium III (SSE1, no SSE2, 128 KiB of L2)
with 64 MB shared with an NV2A GPU. The sim reaches it as a translation of
the same game.wasm, not a port: `tools/w2x86.mjs` emits Pentium III assembly
op for op, and nxdk (open source, no Microsoft code) links it into an XBE.
A port that only matched V8 most of the time would be useless for lockstep,
so the gate is the same as M1's: equal region hashes on every tick.

| Check | Result |
| --- | --- |
| M1's 1M-tick log, native x86 vs Node | every tick's region hash equal |
| M1's 20,000-tick log and the 4-bot match, `x86` and `pentium3` (QEMU) beside Node, Deno and Chrome | all agree, in CI |
| every op on signed zeros, NaNs, denormals, saturation edges, rounding ties and 64-bit shift counts (`test/x86.test.mjs`, natively and under QEMU) | equal to V8, except NaN bits, which wasm leaves open (the sim never makes a NaN) |
| that test against translators with one lowering broken (min, floor, unsigned conversion, a 64-bit rotate, flag ordering) | each fails it |
| a scripted two-player hole on the Xbox core, replayed from its .qgl in V8 | every tick equal; under QEMU's Pentium III the rendered frames are byte-identical too |
| the XBE | builds; its disassembly has no instruction past SSE1 |

| Confirmed tick, 10,000 balls, ticks 16,000 to 24,000 (perf.mjs's window, ~127 awake) | |
| --- | --- |
| V8 TurboFan, this container (`node harness/perf.mjs`) | 0.123 ms |
| the Pentium III code, natively on this container's CPU | 0.166 ms |
| instructions per tick (callgrind), 1.88 M of them in tick_begin | 2.43 M |
| Pentium III at 733 MHz, at 1 to 1.5 cycles an instruction | 3.3 to 5.0 ms, of 8 |

The translation runs at about 1.35 times TurboFan's time on the same machine,
without registers for locals and with half of x86-64's registers. The
Pentium III figure is an estimate, not a measurement: no console was at hand,
and with 128 KiB of L2 under a working set larger than that, memory stalls
could push it past 1.5 cycles an instruction. Three quarters of the
instructions are tick_begin re-binning all 10,000 balls, asleep or not, about
190 a ball; a grid that moves only awake balls is the change that pays most
here, and in the browser too. A storm (1,359 awake) costs V8 4.6 times a
quiet tick, which would not fit a Pentium III's 8 ms. The renderer, about
3 ms a frame here at 320x240, is the next cost to measure on hardware.

Not done yet:

- **A console.** Nothing has run on an Xbox or in xemu (xemu needs the
  console's own ROM and disk dumps). QEMU checks the instruction set and the
  floating point, not the chipset, the kernel or the controllers.
- **The network** is X2, above: the relay's native door, TCP and UDP.
- **The renderer.** Voxel columns tilt by sliding the horizon, which
  distorts at steep pitch, as the browser's ray march does. The NV2A (a
  GeForce 3) should draw the heightfield as a mesh and the balls as point
  sprites.
- **Speed.** Locals live in the frame, and an inlined call passes its
  arguments and results through memory. Registers for locals, then
  hand-written assembly for tick_begin's binning loop, come after the grid
  change above.

## M3, netcode

`node net/run-m3.mjs` starts the Deno relay with its referee and four headless
Chrome 141 clients, each with the golf bot at the controls, at a 150 ms round
trip, 15 ms jitter and 10% loss each way (`--impair delay=150,jitter=15,loss=0.1`;
`delay` is the round trip, half each way). The fourth client joins 15 s late.
At 25 s the runner flips bit 3 of client 1's score total, state the scoreboard
shows and nothing changes mid-hole. The gate: every ball sunk; a change of
keys shows in the predicted player on the first frame after it (p95, every
client); the late client starts from a keyframe after sim tick 0 with under
400 ticks to fast-forward; the flip is one mismatch, on that client only,
named as the slice flipped, and healed; every other interval hash equals the
referee's; and every client is back on the playout clock within 15 s of the
scoreboard.

| 150 ms round trip, 15 ms jitter, 10% loss each way | |
| --- | --- |
| hole | seed 7, scores 2, 2, 3 and 2, every ball sunk |
| key change to the predicted player | 1 frame (p95) on every client: 6.0 to 8.5 ms median, 15.5 to 20.6 ms p95 |
| key change to the confirmed world | 281 to 345 ms median |
| late join | from the keyframe at sim tick 1,792, 70 ticks to fast-forward |
| flipped bit | 1 mismatch, on client 1, named `HDR[0..255] + PLAYERS[0..59]` (slice 0), healed by the keyframe at tick 2,304 |
| interval hashes | 315 of 316 reports equal the referee's; the other is the flip |
| repairs | 590 datagrams carried 1,552 ticks |
| keyframes | 606 to 912 B packed (the region is 512 KiB) |
| input lead, playout delay | 20 to 29 ticks and 11 to 18 ticks at the end |
| per session | 65 KB/s down, 5.8 KB/s up |

The lead plus the playout delay, the ticks between your input and the
confirmed world, came to 36 to 40 here against the design doc's 29 for a
150 ms round trip; the leads grew under this VM's stalls, and the two-client
run, with less load, sat at about 30. The prediction hides all of it for your
own player and shots. With nothing
remote in the way a prediction matches the confirmed world bit for bit
(`test/predict.test.mjs` checks a walk, a rocket jump and a lob).

Each client also resynced 2 to 5 times in the 95 s hole, for a hole too old
to repair. That is this 4-core VM running four WebGPU clients and four shot
planners: each client's net worker stalled by up to 0.8 s (its 4 ms timer,
measured), so its acks reached the relay too late for a repair, and the relay
found 18% of inputs late. A resync costs one keyframe and about 100 ticks of
fill. Of four full runs, the first and the last passed every check; the two
between missed checks since corrected (a 25 ms bar that one stalled frame
missed at 25.6 ms, and a rule that all four be steady at one instant). With
two clients, which loads the VM less, the same run passed with 2 resyncs in
all. On this VM the M0 run (63 bots, 30 s) now misses its 99.9% delivery bar
(worst client 99.868%), but the pre-M3 code run the same way just after
delivered 84.7%: the VM is busier than when M0's numbers were taken.

## M2, the first hole

`node net/run-m2.mjs` starts the Deno relay and two headless Chrome 141
clients. Each client runs WebGPU on SwiftShader with the golf bot at the
controls, and the second joins a few seconds late and replays the room's
history from a fill. The gate: both balls sunk (no time-limit penalty), every
128-tick interval hash equal across the clients, and no client left behind
the playout clock.

| | clean, loopback | 60 ms RTT, 15 ms jitter, 5% loss each way |
| --- | --- | --- |
| hole | seed 7, par 3, 168 m | seed 9, par 3, 160 m |
| scores | 2 and 2, both sunk | 3 and 2, both sunk |
| interval hashes compared | 70, all equal | 51, all equal |
| fill requests (history + holes) | 1 each, the history | 9 and 4 |

The bots act on wall-clock timing, so scores vary from run to run (an
earlier clean run scored 2 and 3); the hashes never have.

A four-bot match (`tools/gengame.mjs`, 20,000 ticks) replays to the same
region hash on every tick in all 27 runtime x JIT x thread configurations;
CI runs it next to the M1 log. In Node, the bots finish courses 7 to 10 in
2 to 5 strokes against par 3 and 4, with a 6- or 16-tick round trip.

game.wasm is now 13,503 B, 6,409 B gzipped (M1's was 3,200): players,
weapons, the hole and the course generator. The client's JS is about 28 KB
gzipped as written, unminified; fitting it all into 13,312 B is M5's job.

Headless Chrome here loses its WebGPU device as soon as a canvas presents a
frame (even a plain clear), so the gate runs the client with `present=0`. It
draws only when a screenshot is asked for, renders into a texture and reads
the pixels back. The screenshots land in `traces/m2-*.png`.

## Results

Measured in a 4-core cloud container on 2026-10-18. At M1, game.wasm (sha256
`42a59430…`) was 6,401 B, 3,200 B gzipped; Binaryen `-O3` makes it 5,923 B
but 3,220 B gzipped, so the hand-written build ships as is.

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

Those are M1's numbers. M2's golf rolling (a fixed slowdown per surface, and
rough wherever there is no hole) settles balls sooner, so the same log now
keeps ~127 awake: a tick takes 0.18 ms on one thread (p99 0.40), and the
storm keeps 1,359 awake at 0.71 / 0.55 / 0.51 ms on 1 / 2 / 4 threads. The
M1 matrix still agrees in all 27 configurations. M4's worst case, a grenade
into a 10,000-ball pit, replaces this log as the benchmark.

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
