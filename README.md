# Quake Golf

256 players in one room, one course, rockets and grenades as clubs, and every
ball ever hit stays in play. The sim is **hand-written WebAssembly** (no compiler), stepped in
deterministic lockstep at 125 Hz, so only inputs cross the network: bandwidth
follows players, never balls.

Design doc and netcode review: [Quake Golf — Design Doc](https://claude.ai/artifact/QTA2QtjNiu4HLWW2115bW7).
Target: the newest Chrome; the server is Deno. The same sim also runs as
Pentium III code on the original Xbox: see [X1](#x1-the-original-xbox).

## Where it is

| Milestone | Gate | Status |
| --- | --- | --- |
| N4 · failover and replays | the room's relay killed mid-match: a standby takes the room over from its own record, all 65 players keep their slots, every hash equal before and after; the room's replay, spanning the takeover, checks out interval by interval in Node and in Chrome | **passed** · [results](#n4-failover-and-replays) |
| N3 · spectators | one room served through a tree of relays, two deep, to 600 spectators on lossy links: every edge's referee hashes the room as the root's does, every spectator's world too, Chrome watching two relays down, a player turned away at an edge | **passed** · [results](#n3-spectators) |
| N1 · 256 players | one room filled to 256 over a lossy network (Chrome, the Xbox's network code, and a host of 252 AI golfers): every hash equals the referee's, the 257th turned away, a late join from a keyframe of the full room, a flipped bit healed, every bundle one datagram | **passed** · [results](#n1-256-players) |
| M4 · the pit | 10,000 balls heaped in one pit and a grenade into it: every tick equal in every configuration, and the confirmed tick within its 1.5 ms through the blast | **in progress**: a grid that moves only what moved, bit for bit with the old one (a quiet tick 3.3 times faster, a fifth of the Pentium III's instructions); a contact walk 1.2 to 1.4 times faster, bit for bit again; the blast still costs 3.0 ms a tick on one thread, and the heap never sleeps · [results](#m4-the-pit) |
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
fullscreen, M mutes the music. Every shot is a stroke. The rocket is the club: a blast just
behind your ball drives it 200+ m with loft, one 4 m back rolls it a few
metres, and the cup is a slipgate that swallows any ball under 8 m/s. The
grenade bounces and pops after 2.5 s, for lobs. A rocket at your own feet is
a rocket jump (and a stroke). Holes last 4 minutes; not finishing costs 2.
Your own movement, shots and rocket jumps are predicted, so they show on the
next frame; other players and every ball show a round trip late. The net graph
in the top right (N hides it) shows the last 9.6 s of the netcode: bytes down
by kind (bundles green, repairs orange, keyframes and fills purple) and up
(the cyan line); the share of ticks that needed a repair and the lag from an
input to the confirmed world; the input lead (yellow) and the playout delay
(cyan), in ticks; and the sync, a green tick for each interval hash sent to
the relay and a bar for each keyframe (blue a join, purple a resync, red a
desync). To feel a
bad network, add `&impair=delay=150,jitter=15,loss=0.1` to the URL: a 150 ms
round trip with 10% loss each way. Each hole has its own tune, in
bytebeat: one line of arithmetic per sample, 8000 samples a second, 8 bits,
its notes picked by the room's seed and the hole number ([`client/sound.mjs`](client/sound.mjs));
`&music=0` starts with it off.

To play among 250 AI golfers, start the bot host beside it; it fills the room
through the relay's native door, every golfer its own session:

```sh
node net/bot-host.mjs --bots 250     # neural golfers (below) sharing one copy of the world, until Ctrl-C
```

To watch instead of play, open the page with `?watch=1`: no slot, no inputs,
a camera riding with a player (→, Space or a click the next one, ← the one before).
A room can be watched through edge relays, each a spectator of the one above
it serving the room on to its own spectators, so one room reaches any number
of them:

```sh
.tools/deno run --unstable-net -A net/relay.ts --port 4443 --native-port 4444 --upstream 127.0.0.1:4434
# then open the page with ?watch=1&url=https://127.0.0.1:4443/
node net/bot-host.mjs --relay 127.0.0.1:4444 --bots 200 --watch   # or 200 spectators that check every hash
```

Every room `net/play.mjs` runs is saved when it ends, as a replay in
`replays/`. It is the room's closed ticks and the referee's hashes, a few
kilobytes a minute. Open one with `?replay=../replays/<file>`. K pauses,
J and L go back and on 10 s, [ and ] halve and double the speed, and every
interval is checked against the relay's hashes as it plays.
`node tools/replay.mjs <file>` checks one without a browser.

A standby relay keeps a room alive if its relay dies. Give the page both
addresses (`?url=https://127.0.0.1:4433/,https://127.0.0.1:4443/`) and start
the standby:

```sh
.tools/deno run --unstable-net -A net/relay.ts --port 4443 --native-port 4444 --upstream 127.0.0.1:4434 --standby
```

Kill the first relay and the game goes on: the standby takes the room over
and everyone comes back to their own slot.

To write your own client, in any language, [docs/wire.md](docs/wire.md) is
the protocol, and `net/tiny-client.mjs` is a whole client in 128 lines.

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
plays locally instead, split screen for up to four; there, Black adds a
neural golfer (below).

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
node tools/zoo.mjs --bench qg2:...                # 40 held-out courses, shots alone
node tools/zoo.mjs --real qg2:...                 # the same courses as real holes, then the golf bot on them
node tools/agent.mjs --genome qg2:...             # play against it through the agent door
```

Or play it in Chrome: run `node net/play.mjs` and add `&bot=1&genome=qg2:...`
to the URL it prints. On the Xbox, Black seats it (below).

A 274-weight net that judges each shot by feel, where the golf bot tries 24
on a private sim first. It reads a ball at rest as fourteen numbers (the
cup's distance and height, the lie, the ground at six points along the line
and 5 m ahead of and behind the ball) and answers with the blast distance
behind the ball and a turn of up to 6°. It walks and aims on the golf bot's
own legs, so the shot choice is the only difference between the two
(`client/brain.mjs`).

Its genome stores no weights. It is a base seed and one 16-bit seed per
accepted mutation, and replaying that rebuilds the weights bit for bit (the
encoding of Such et al. 2017). All of it is f32, as the sim is: every `+ -
* /` and `sqrt` rounds to single, which V8, any browser and the Pentium
III's SSE1 do alike. As `qg2:` and base64url, 101 mutations still fit in a
tweet. `tools/zoo.mjs` breeds it on worker threads: a parent and fifteen
children play eight training courses by shots alone (each shot taken from
its spot, as the bot's private sim takes them), and the best child replaces
the parent only if it beats it again on sixteen fresh courses. Without that
second test, the best of fifteen beats its parent on eight courses most
generations by luck alone.

The run (seed 1) kept 101 children in 260 generations, filled the tweet and
stopped, in 22 minutes on 4 threads here. On 40 held-out courses (seeds
1-40; training used 1000-1199):

| | shots alone (10 at most, else +2) | real holes (walking, the clock) |
| --- | --- | --- |
| a random net (no mutations) | 10.93, 12 sunk | |
| a rule of thumb (blast distance by range) | 9.43, 18 sunk | |
| **the neural golfer, 279 chars** | **4.35, 40 sunk** | **4.80, 40 sunk; 4.33 on the Xbox core** |
| the golf bot, 24 tries a shot | 2.10, 40 sunk | 2.33, 40 sunk |

Foresight still wins, by two to two and a half strokes a hole. The golfer
scores 1 to 10, with a hole in one on course 17; on course 11, where Claude
scored 14 through the agent door, it takes 5. On the Xbox core it plays on
its own C legs (below), whose inputs land on the tick they are made rather
than after the room's 6-tick delay, and it scores a little better. With its genome at both Chrome
clients' controls (`net/run-m2.mjs --genome`), the M2 gate passes on course
7: both sunk, in 3 and 4, and all 63 interval hashes agree. (An earlier f64
brain, `qg1`, scored 5.92 by shots alone (with the stale first shot, below)
and 5.20 on real holes, with two blowups; it could not run on the Xbox bit
for bit, and its genomes are refused now.)

Erratum, 2026-10-19: until then, a hole by shots alone chose its first shot
from stale memory (`Planner.load` fills only the private snapshot, which
`try` copies in), so every such hole wasted its first stroke, about one a
hole for a competent player. The column above is re-measured with the fix;
real holes were never affected. Both golfers were bred under the old
harness, which cost each a stroke a hole uniformly while selection ran. The genome:

```
qg2:hmagd9R84qfApxdNJr9m7qGTDze89_fPq7m5K7Gg4TBr9-wiiN8Tiqpy9rhz87tTGlgTODs5cCu2UdcWhViGXH8RVInqWkYmcrwtHw4C9zsnqwW3L8AWtxiGGsuGwhqyLVwpIJgdM6caBm8Yw2yh7gta75ETI5-KXT6HmFE1fE2PDb7cFD-YB1EBB9fnFRLjEJOeoff8YgIYlPKoDkolOitC6S8nfhIb3aXZanA9x_kkbIjcal84QfZwPn_sTt8bfpm1N3AM-f9Krj8pbFw
```

### On the original Xbox

In local play, Black on any controller seats the neural golfer at the first
port with no controller, in its own split-screen view. Its genome is
`D:\golfer.txt` beside the XBE, which `make -C xbox GOLFER=qg2:...` writes,
else the one above, built in (`xbox/golfer.h`).

`xbox/brain.c` is the brain in C, the same ops in the same order as the JS
in plain floats, which clang keeps in SSE1 for a Pentium III; the golf
bot's legs (wait for the ball, walk, tap, aim at the blast point, fire)
are in `game.c`. `test/xbox.test.mjs` holds it to V8, natively and under
qemu's pentium3 where present:

| Check | Result |
| --- | --- |
| a fixed genome's weights, FNV-1a over their bytes | `ffac99fb`, as in V8 |
| the fourteen features and the shot from four tees, as bits | all equal to V8's |
| the built-in golfer on course 7, alone on the Xbox core | sunk, and V8 replays the match on every tick |
| the XBE's brain and legs (`llvm-objdump`) | SSE1 single ops; no SSE2, and x87 only to return a float |

Not done: the golfer has not run on a console or in xemu, for the reasons
above, and it plays only in local play (online, it would need its own
connection).

## Run it

```sh
npm ci && sh tools/install-deno.sh     # wabt, binaryen, Deno 2.9.7 into .tools/
npm run build                          # src/*.wat -> build/game.wasm
npm test                               # assembler, XXH64, sim, gameplay, splits, keyframes, threads, wire, agent door
node harness/matrix.mjs --ticks 20000  # Node, Deno, Chrome x Liftoff/TurboFan x 1/2/4 threads
node tools/gengame.mjs --bots 4 --out logs/game.qgl && node harness/matrix.mjs --ticks 20000 --log logs/game.qgl
node harness/perf.mjs                  # per-phase cost at 10,000 balls, the storm, and M4's pit stage by stage
node tools/genlog.mjs --pit --out logs/pit.qgl && node harness/matrix.mjs --ticks 9000 --log logs/pit.qgl   # the pit everywhere
node net/run-m0.mjs --bots 63 --duration 60 [--impair delay=40,jitter=10,loss=0.05]
node net/run-m2.mjs [--impair delay=60,jitter=15,loss=0.05]   # two bot-played Chrome clients, one hole
node net/run-m3.mjs [--clients 4] [--impair delay=150,jitter=15,loss=0.1]   # four, a late join, a flipped bit
node tools/x86.mjs                     # game.wasm -> Pentium III assembly, the native runner, the Xbox core's test driver (clang)
node harness/matrix.mjs --ticks 20000 --runtimes node,x86,pentium3   # that code on this CPU and under qemu-i386 -cpu pentium3
node net/run-x2.mjs [--chrome 1] [--seconds 60] [--late 15] [--flip 25] [--impair delay=100,jitter=15,loss=0.05]   # Xbox clients online
node net/run-n1.mjs [--chrome 2] [--seconds 90] [--late 30] [--flip 45]   # 256 players: Chrome, Xbox clients and 252 AI golfers
node net/run-n3.mjs [--chrome 1] [--golfers 128] [--watchers 200]   # spectators through a tree of relays
node net/run-n4.mjs [--chrome 1] [--kill 25] [--golfers 64]   # the root killed mid-match, a standby takes over; the replay checked
node net/bot-host.mjs --relay 127.0.0.1:4434 --bots 250 [--seconds 0] [--impair ...]   # fill a running room with neural golfers
node net/tiny-client.mjs 127.0.0.1:4434 --seconds 30   # the smallest whole client (docs/wire.md)
node tools/replay.mjs replays/<file>.qgr   # step a replay and check its every interval hash
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
- Balls find each other through a 64 x 8 x 64 grid of 0.4 m cells that wraps,
  kept outside the region from tick to tick: each bucket is a list of its
  balls in ascending index, and only the balls that moved change bucket, at
  the end of the tick that moved them. The lists are a function of the
  region alone, however they were reached, so the sim rebuilds them whole
  whenever the region came from somewhere else (`init`, `restore`, a tick or
  ball count it was not kept for, or the `regrid` export, which anything that
  writes the region from outside calls).
- `harness/` replays one event log in Node, Deno and a Chrome worker and
  records a hash of the whole region every tick. `tools/compare.mjs` names the
  first tick that differs and which slice and field it was in.
- `net/relay.ts` is the relay: one isolate owns the QUIC sessions, an 8 ms
  clock from a fixed epoch, and the bundles (the newest four ticks every second
  tick, with a per-recipient trailer). Each closed tick is coded once, as the
  input words that changed since the tick before, each a delta from that
  player's last word, bit-packed (`net/wire.mjs`, wire v4); bundles, repairs,
  fills and the record all carry ticks in that form. It records every closed tick from the room's
  start and hands it to the referee, `net/referee.mjs` in a Worker: the same
  game.wasm stepping the room, the truth for interval hashes and keyframes.
  A joiner gets the newest keyframe and the record since it. A tick a
  client's per-tick acks lack comes back in a repair datagram. A client whose
  interval hash differs from the referee's gets the keyframe again, with the
  referee's slice digests so it can name the slice, and the room's record is
  saved as a .qgl that replays the desync. An emptied room starts over on a
  new seed.
- The record does two more jobs. A replay (`net/replay.mjs`) is the record
  written out with the referee's hashes, and playing one is being a client
  with the network taken away (`client/replay.mjs` stands in for the net
  worker). An edge relay keeps a record and a referee of its own, so one
  started with `--standby` can take the room over when its upstream dies:
  it closes the next ticks on the old clock's timeline, and holds each
  player's slot with a ghost that repeats their last word until they come
  back with a resume.
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

## N1, 256 players

`node net/run-n1.mjs` fills one room to all 256 slots: two Chrome clients (the
golf bot at one's controls, the neural golfer at the other's); the Xbox's
network code (`xbox/online.c`), one native client from the start and one that
joins last, from a keyframe, under `qemu-i386 -cpu pentium3`; and the bot host
(`net/bot-host.mjs`) with the other 252, each a neural golfer on its own
session over the relay's native door. Every datagram both ways has a 100 ms
round trip, 15 ms jitter and 5% loss. 45 s in, the first native client flips a
bit of its own state. Once the room is full, one more player knocks.

Wire v4 is what makes it fit. A tick no longer carries a word for every slot:
the sim keeps a player's last word until a new one comes, so a tick carries
only the words that changed, each coded against that player's previous word
(a yaw and a pitch delta in Exp-Golomb codes, and the button byte only if it
changed), and the slots between them as gaps. A tick too big for one datagram
(256 players' worth of random noise is about 1.6 KB) is cut by slot into
parts, each decodable on its own. Each tick is coded against the one before,
which costs a lockstep client nothing, since it can't step past a missing
tick anyway; a joiner's base is each live player's last input in the
keyframe's region, so keyframes didn't change. The relay codes each tick once,
whoever receives it.

The bot host shows the other half: every client of a room computes the same
world, so one process can play 252 slots from a single copy of it. It steps
the room from whatever ticks any of its sessions hears, and its golfers read
that one world. Each session still acks, gets its own repairs, keeps its own
input lead and reports the world's interval hashes, so to the relay they are
252 ordinary clients.

| 256 players, 90 s, 100 ms round trip, 15 ms jitter, 5% loss each way | |
| --- | --- |
| the room | 256 sessions at once; the 257th turned away as full |
| interval hashes vs the referee's | 20,738 of 20,739 reports equal; the other is the flip. Chrome 89 of 89 each, the bot host's world 83 of 83, the natives 83 (3 more between the flip and its heal) and 59 |
| the flip | caught at the interval closing at sim tick 5,760 and healed by its desync keyframe |
| the late join | slot 255, under QEMU's Pentium III, from a keyframe of the full room at sim tick 3,712, 86 ticks to fast-forward |
| a tick, coded | 26 B on average, 151 B at most |
| a bundle | 145 B on average, always one datagram (the largest 348 B) |
| per session | 9.0 KB/s down, 4.9 KB/s up |
| ticks heard by bundle | 99.75% (two bundles a tick at 5% loss give 99.75%), the worst session 99.54%; repairs brought 12,607 ticks in 5,226 datagrams |
| inputs applied as sent | 99.34% (1.5% of words late, repeated) |
| the relay | 54% of a core: 256 sessions, about 16,000 bundles and 16,000 input datagrams a second |
| the bot host | 55% of a core for 252 golfers: one sim, 0.18 ms a tick; 725 strokes in 90 s |

What a bundle costs, the same runs before and since:

| | wire v3: a word for each of 64 slots, every tick | wire v4: the words that changed |
| --- | --- | --- |
| 3 players (X2) | 1,052 B, 65 KB/s each | 41 B, 2.6 KB/s |
| 64 bots that move their aim every tick (M0) | 1,052 B, 65 KB/s | 513 B, 32 KB/s |
| 256 players (N1) | could not: 64 slots | 145 B, 9.0 KB/s |

CI runs the gate without Chrome (254 golfers and the two Xbox clients) on every push.

![The first hole with the room full, from a Chrome client](docs/n1-crowd.png)
![Its scoreboard: 256 players](docs/n1-scores.png)

Not done:

- **Rooms per machine.** One relay runs one room; several across isolates
  come next. (Failover, the other half, is [N4](#n4-failover-and-replays).)

## N3, spectators

A room's ticks are the same for everyone, so a spectator is a client that
holds no slot: it says so in its hello (a flag byte), the relay welcomes it as
watching (`T_WATCHING`) and sends it what it sends a player, the bundles,
repairs and keyframes, and checks the interval hashes it reports. It sends no
words, so it costs the room nothing: no slot, no input in any tick.

An edge relay (`net/relay.ts --upstream host:port`) is a spectator of another
relay's room that serves it on to spectators of its own. It closes each tick
as it comes down rather than on its own clock, so its bundles and repairs are
its own. Its referee starts from the keyframe it began watching at (the record
is change-coded, so it seeds the tick base from that keyframe's region) and
reports its interval hashes upstream like any spectator: each relay in a tree
is checked by the one above it, and a relay that drifts is resynced by it. An
edge takes no players; one that asks is turned away (`REJECT.WATCH_ONLY`).

`node net/run-n3.mjs` builds the tree: the root relay holds the room and the
bot host's 128 golfers play it; edges A and B watch the root and C watches A,
two levels down. Each edge serves 200 spectators from a bot host in `--watch`
mode, each its own session, and C a Chrome tab too (`?watch=1`). Every
spectator's link has a 100 ms round trip, 15 ms jitter and 5% loss; the links
between relays have none. At the end, a player knocks at an edge.

| 60 s, 128 golfers, 3 edges, 601 spectators, 100 ms round trip, 15 ms jitter, 5% loss | |
| --- | --- |
| the root | 128 players and 2 spectators (edges A and B); 9,462 of 9,462 hash reports equal its referee's; 59% of a core |
| the edges' referees vs the one above | A 70 of 70, B 70 of 70, C (two down) 67 of 67; no resync, no repair upstream |
| each edge | 200 spectators (A also serves C); every report equal (9,600, 9,508, 9,579); 47% of a core |
| the spectators | 600 joined from their edge's keyframe, none turned away; each host's world hashed as the root's, 49 of 49 |
| the Chrome spectator on C | watching P1 two relays from the room; 59 of 59 interval hashes equal |
| per spectator | 5.3 KB/s down; 99.6% of ticks heard by bundle (two bundles a tick at 5% loss give 99.75%) |
| a player at an edge | turned away: spectators only |
| the hosts | 24% of a core for 200 spectators, one shared world |

CI runs a smaller tree without Chrome (64 golfers, 100 spectators an edge) on every push.

![Watching P1 from Chrome, through edge C, two relays from the room](docs/n3-watch.png)

## N4, failover and replays

A room lives in one relay's record, and an edge relay keeps a copy of that
record with a referee of its own. So an edge can take the room over. Start one
with `--standby`, and if its upstream dies it closes the next ticks itself,
from the newest it has, on the old clock's timeline. Every tick number and
every client's clock stay as they were.

Each player in the world keeps their slot. A ghost holds it, repeating their
last word as the relay does for a player whose inputs are late, until they
reconnect with a resume (a hello flag, their slot and the room). They get the
slot back with no join, then a keyframe.

Clients given several relays try the next when theirs goes quiet: Chrome, the
bot host and edge relays. 1.5 s without a datagram counts as quiet, since a
dead QUIC peer would idle for far longer. An edge given several upstreams
follows the next one in the same way.

The same record is the replay. A relay started with `--replays` writes each
room to a file when it ends: the closed ticks as the wire codes them, plus the
referee's interval hashes. A file plays in the page (`?replay=`) and in
`tools/replay.mjs`, and both check every interval against the referee's as
they go. A replay is proof as well as a recording: change one tick and every
interval after it says so.

`node net/run-n4.mjs` sets it up:
- **The relays:** the root holds the room; a standby watches it; edge B
  watches the root, or failing that the standby, and serves 64 spectators.
- **The players:** 64 golfers from the bot host and a Chrome client with the
  golf bot, all of them told about the root and the standby.
- **The kill:** 25 s in, the root gets SIGKILL, so it says no goodbye.
- **The replay:** when everyone has left, the standby writes the replay. The
  gate checks it, then plays it in Chrome at 8x.

| 60 s, 65 players, the root killed at 25 s, 100 ms round trip, 15 ms jitter, 5% loss | |
| --- | --- |
| the takeover | at sim tick 2,949, 3 ticks behind the dead root's clock, with 65 slots held |
| the players | all 65 back in their own slots, none joined again; the slowest golfer back in 278 ms, Chrome within its 1.5 s of silence |
| hash reports at the standby | 2,015 of 2,015 equal its referee's; the golfers' world 54 of 54 and Chrome 51 of 51 through the takeover |
| edge B | followed the standby; its referee 54 of 54 equal to the standby's, its 64 spectators' reports all equal |
| the replay | 37 KB for 56 s of 65 players, from sim tick 0 to the end, across both relays; 54 of 54 intervals equal, in Node and in Chrome |

The first runs found a race. When the root's stream ended, the standby closed
its socket at once and lost the root's last bundle, which the players had
already received. It then closed those ticks again in its own way. Now an
edge reads its socket for 100 ms more before it takes over. A failed-over
client also restores the new relay's keyframe, so even a tick the standby
never got can't split it from the room.

CI runs a smaller room (32 golfers, the kill at 15 s) on every push.

![A replay in Chrome at 8x: 33 of 54 intervals in and all equal so far](docs/n4-replay.png)

Not done:

- **The Xbox client doesn't fail over.** `xbox/online.c` takes one relay
  and doesn't send a resume yet.
- **Trusting a resume.** A standby gives a held slot to whoever asks for it
  first, as a relay already gives a free slot to whoever joins. A ticket the
  relays share would bind a slot to its player.

## M4, the pit

`node tools/genlog.mjs --pit` writes M4's worst case, a grenade into a pit:
10,000 balls dropped 64 at a time within 3 m of course 7's tee, where they
spread into a heap 26 m across and 1.6 m high, then at tick 6,000 a
grenade's blast (strength 20, radius 4 m) at the top of the heap, and 3,000
ticks to settle. `node harness/perf.mjs` times it stage by stage.

The first change is the grid. Every tick used to sort all 10,000 balls into
a 32 x 16 x 32 grid of buckets, asleep or not: a counting sort and a prefix
sum over 16,384 buckets, three quarters of a quiet tick's instructions on the
Pentium III. Now the grid lasts from tick to tick. Each bucket is a list of
its balls in ascending index, the order the sort gave, and only the balls
that moved change bucket, at the end of the tick that moved them: the awake
list, a spawn, a new ball on the tee, a sink. It is 64 x 8 x 64 buckets, so
the pit no longer wraps onto itself: the old grid's 12.8 m period folded the
26 m heap, and contacts scanned 57 candidates a ball where a grid with no
wrap scans 30.

A neighbour is met in the same order whatever the grid's shape (by its
cell's offset from the ball's, then by index), so the physics is untouched,
and that is what makes it checkable:

| Check | Result |
| --- | --- |
| every tick's region hash against the build before, on the pit, M1's 20,000-tick log and the 4-bot match | all equal |
| the same on the debug build under random splits, which checks the whole grid every tick | all equal |
| a 3-bot match played on each build (the bots plan every shot on a private sim) | the same log, byte for byte |
| `harness/matrix.mjs` on the pit, M1's log and the match: Node, Deno, Chrome x 3 tiers x 1, 2, 4 threads, `x86`, `pentium3` | all 29 agree on every tick, on each log |
| a region copied in at the same tick with `regrid`; without it (`test/sim.test.mjs`) | continues tick for tick; the debug build traps, naming the stale ball |

Node, one thread unless stated, the build before against this one, run back to back:

| | before | now |
| --- | --- | --- |
| a quiet tick (M1's log, ticks 16,000 to 24,000, 127 awake) | 0.162 ms | 0.049 ms |
| of which tick_begin | 0.107 ms | 0.006 ms |
| the storm (1,359 awake), 1 and 4 threads | 0.70 and 0.44 ms | 0.44 and 0.26 ms |
| the pit filling (3,806 awake on average) | 2.36 ms | 2.10 ms |
| the heap, before the grenade (1,286 awake) | 1.26 ms | 0.99 ms |
| **the grenade's first 4 s (6,043 awake)**, 1 and 4 threads | 4.58 and 1.63 ms | **3.95 and 1.14 ms** |
| settling again (128 awake) | 0.19 ms | 0.07 ms |
| Pentium III instructions a step (callgrind), quiet and in the storm | 2.43 M and 6.00 M | 0.50 M and 3.47 M |

The second change is the contact walk's code, not its order. V8 did not
inline `$cell` or `$bucket`, so each of the 27 bucket lookups was a call, with
the ball's running sums spilled to the stack around it. `contacts` now does
that arithmetic itself, unrolls the 9 rows and the 3 buckets in each (the
`!unroll` macro), so each short walk has branches of its own for the
predictor, and loads a row's three list heads before walking any of them.
The neighbours are met in the same order, so the sums are the same bits:

| Check | Result |
| --- | --- |
| every tick's region hash against the build before, on the pit, M1's 20,000-tick log and the 4-bot match, 1 and 4 threads, and the debug build | all equal |
| `harness/matrix.mjs` on the pit: Node and Chrome x 3 tiers x 1, 2, 4 threads, and `x86` | all 19 agree on every tick |
| the same on M1's log and the match, Node 1 and 4 threads and `x86` | all agree |

Node, one thread unless stated, the build before against this one, run back to back:

| | before | now |
| --- | --- | --- |
| a quiet tick (M1's log, ticks 16,000 to 24,000) | 0.053 ms | 0.038 ms |
| the storm (1,359 awake), 1 and 4 threads | 0.56 and 0.35 ms | 0.39 and 0.28 ms |
| the pit filling | 2.34 to 2.39 ms | 1.83 to 1.94 ms |
| the heap, before the grenade | 1.00 to 1.04 ms | 0.82 to 0.90 ms |
| **the grenade's first 4 s**, 1 and 4 threads | 3.5 to 4.1 and 1.45 to 1.64 ms | **2.95 and 1.12 to 1.31 ms** |
| of which contacts, 1 thread | 3.15 to 3.74 ms | 2.62 ms |
| the Pentium III code natively, the whole pit | 2.45 to 2.50 ms | 2.09 to 2.10 ms |

Three more were tried and left out, each as exact and none faster. Skipping
the edge and corner cells a contact can't reach (about a quarter of the
candidates) cost more in tests than it saved in walking. A packed copy of
each ball's position and next link, one cache line a candidate instead of
four, gained 3%. And the approach test as a select instead of a branch
changed nothing.

Not done:

- **The grenade on one thread.** 2.95 ms a tick against 1.5. Four threads
  bring it to 1.1 to 1.3 ms, but the client's sim worker and the referee
  step on one. Per awake ball, a walk of the 27 buckets alone costs about
  three quarters of contacts and the 7 contacts the rest. Sorting the awake
  list by bucket, so that neighbours come one after another, changed
  nothing, and neither did the packed copy above: the walk is not waiting on
  memory, it is short lists (mostly one or two balls) of unpredictable length.
- **A heap never sleeps.** Before the grenade, 1,286 balls stay awake for as
  long as the pit stands, about 1 ms a tick. The bottom balls are squeezed
  out sideways from under the ones above (balls have no friction on each
  other), the upper ones drop, and their hits wake their neighbours: 7,762
  sleeps and wakes in 400 ticks. A heap on a bunker by the green keeps 2,000
  awake; one on the green, which spreads into a single layer fast, about
  100. Three changes to the contacts were tried on all three: friction
  between balls (8,000 awake at 0.3 and 0.6: in Jacobi each contact cancels
  the whole sliding speed, so several overshoot together); that friction and
  the stopping of approach averaged over a ball's contacts (800 to 1,300 on
  the bunker, but 700 to 1,500 on the tee and 150 to 590 on the green); and
  the push out of an overlap halved against a sleeping ball as against an
  awake one (3,000 on the tee and the bunker), against about 1,200, 2,100
  and 110 as it is. The physics stays as it was until a change helps
  everywhere.
- **The Pentium III.** The grenade's first 4 s cost 20.7 M instructions a
  step (callgrind), 16.8 M of them contacts, about 2,800 an awake ball: 28
  to 42 ms at 733 MHz, against 8. An Xbox in that room would fall behind and
  resync from keyframes, as a stalled tab does, until the heap calmed.

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

| Confirmed tick, 10,000 balls, ticks 16,000 to 24,000 (perf.mjs's window, ~127 awake) | at X1 | since M4's grid |
| --- | --- | --- |
| V8, this container (`node harness/perf.mjs`) | 0.162 ms | 0.049 ms |
| the Pentium III code, natively on this container's CPU | 0.262 ms | 0.082 ms |
| instructions per tick (callgrind) | 2.43 M, 1.88 M in tick_begin | 0.50 M, 0.11 M in tick_begin |
| Pentium III at 733 MHz, at 1 to 1.5 cycles an instruction | 3.3 to 5.0 ms, of 8 | 0.7 to 1.0 ms, of 8 |

The translation runs at about 1.6 times V8's time on the same machine,
without registers for locals and with half of x86-64's registers. The
Pentium III figure is an estimate, not a measurement: no console was at hand,
and with 128 KiB of L2 under a working set larger than that, memory stalls
could push it past 1.5 cycles an instruction. At X1, three quarters of the
instructions were tick_begin re-binning all 10,000 balls, asleep or not,
about 190 a ball; [M4](#m4-the-pit)'s grid moves only the balls that moved.
A storm (1,359 awake) was 6.0 M instructions a step, 8.2 to 12.3 ms, past the
8; it is 3.5 M now, 4.7 to 7.1 ms. M4's pit is far past it, at 20.7 M a step
through the grenade. The renderer, about 3 ms a frame here at 320x240, is the
next cost to measure on hardware.

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
  arguments and results through memory. With the grid change done, contacts
  are the largest part of a tick; registers for locals come next.

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
into a 10,000-ball pit, is the benchmark now: see [M4](#m4-the-pit).

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
it receives the 1,052 B bundles fine. (Those were wire v3's bundles: since
[N1](#n1-256-players), the same 64 bots' bundles are 513 B.) The relay's cost is per packet in Deno's
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
