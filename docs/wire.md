# The wire, for writing a client

Quake Golf is lockstep. Every client steps the same world from the same closed
ticks with the same `build/game.wasm`, so the relay never sends a position: it
sends who pressed what, tick by tick. A client is three jobs:

1. Send the relay an input word for each tick, a little ahead of its clock.
2. Step its own copy of the world through every closed tick, in order.
3. Report the world's hash every 128 ticks, so the relay's referee can check it.

Get those right and the relay can't tell you from Chrome, the Xbox or a bot.
Three working clients to read beside this page:

| | |
| --- | --- |
| [`net/tiny-client.mjs`](../net/tiny-client.mjs) | the smallest whole client, 128 lines of JavaScript: joins, steps, plays, reports |
| [`xbox/online.c`](../xbox/online.c) | the Xbox's, in C with no JavaScript anywhere: the same protocol from scratch |
| [`client/net.mjs`](../client/net.mjs) and [`client/sim.mjs`](../client/sim.mjs) | the browser's: steered lead, playout clock, prediction, failover |

`net/wire.mjs` is the reference encoder and decoder for everything below; the
X2 gate (`net/run-x2.mjs`) runs all three clients in one room and checks every
hash each reports. Everything is little-endian.

## Ticks and clocks

| | |
| --- | --- |
| a tick | 8 ms (`TICK_US` 8000) |
| bundles | every 2 ticks (`SEND_EVERY`), carrying the newest 4 closed ticks (`NB`) |
| players | 256 slots (`NP`) |
| a server tick | counts from the relay's start; a room's sim began at server tick `room_start`, so sim tick k is server tick `room_start + k` |

Tick T closes at the relay's deadline for it. A word for T that arrives after
that is late, and the relay repeats that player's last word instead (with the
jump bit cleared and the shot counter unchanged, so a late word never fires).
So send each tick's word a one-way trip ahead, plus a margin: the input lead.
The bundle trailer's `slack` tells you how early your words land.

## Transports

**Browser:** WebTransport (QUIC, ALPN `h3`) to the relay's port (4433 by
default), with the certificate's SHA-256 pinned. It uses one bidirectional
stream, the client's, open for the whole session, plus datagrams.

**Native:** a TCP connection to the relay's native port (4434) is the stream.
UDP datagrams go to the same port number. Each of the client's datagrams opens
with the welcome's u32 `token`; that is how the relay finds the session, and it
sends bundles back to the address the datagram came from. The relay's
datagrams carry no token.

Closing the stream is how you leave. A relay that hears no datagram from a
player for 2 s takes them as gone.

## The handshake (the stream)

| message | bytes | layout |
| --- | --- | --- |
| hello, client to relay | 24 | `0x10` · u8 proto (4) · u16 your max datagram · u8[8] the first 8 bytes of SHA-256(game.wasm) · u32 room · u32 nonce · u8 flags (1 watch, 2 resume, 4 looks) · u8 slot · 2 B 0 |
| welcome | 32 | `0x11` · u8 slot · u16 server max datagram · u32 join_tick · u32 seed · u32 server_tick · u32 tick_us · u8 send_every · u8 nb · u16 np · u32 room_start · u32 token |
| watching | 32 | `0x17`, then as a welcome with slot 0: you're a spectator |
| reject | 4 | `0x1f` · u8 reason · 2 B 0 |

Reject reasons:
1. your game.wasm differs from the relay's
2. the room is full
3. protocol mismatch
4. this relay only has spectators
5. nothing to watch yet

Your words count from `join_tick`. The relay's join event for your slot lands
on that tick. `server_tick` is the relay's tick as it wrote the welcome:
estimate its clock from it, then refine it with pings.

After the welcome, every stream message opens with 16 bytes:

| message | layout |
| --- | --- |
| sync, client to relay | `0x12` · u8 reason · 2 B 0 · u32 have (your next server tick) · 8 B 0 |
| ping, client to relay | `0x15` · 3 B 0 · u32 nonce · 8 B 0 |
| key | `0x14` · u8 reason · 2 B 0 · u32 tick · u32 raw bytes · u32 packed bytes; for a desync, then u32 interval · u32 0 · 128 x u64 the referee's slice digests; then the packed region |
| fill | `0x13` · 3 B 0 · u32 from · u32 n · u32 body bytes, then n ticks: u8 parts · parts x (u16 bytes · the part) |
| pong | `0x16` · 3 B 0 · u32 nonce · f64 the relay's tick when it answered (fractional) |
| look, client to relay | `0x18` · 3 B 0 · u32 your look word · 8 B 0 |
| looks | `0x18` · u8 0 · u16 n · 12 B 0, then n x (u16 slot · u16 0 · u32 look word) |

Looks are optional. A client that sets hello flag 4 gets every slot's look
after its welcome, then the ones that changed, and may send its own; a client
that doesn't never sees a looks message, so a client written from this page
without them needs nothing more. A look word is the ball in its low byte and
the hat in the next (`client/looks.mjs`; 0 is the house look). It is drawing
only: no tick, keyframe, record or hash carries it, and a slot that empties
goes back to 0.

Sync reasons, which are also a key's reason:
- 0: join
- 1: hole (a tick you lack that repairs can no longer bring)
- 2: behind (you've fallen far behind)
- 3: desync (your hash differed)

## The input word

32 bits:

| bits | field |
| --- | --- |
| 0 to 13 | yaw, 1/16384 of a turn |
| 14 to 23 | pitch, 512 level |
| 24 to 27 | move: forward, back, left, right |
| 28 | jump |
| 29 to 30 | shot counter |
| 31 | weapon (0 rocket, 1 grenade) |

A shot fires when the counter moves on by one. The sim keeps a player's last
word until a new one comes.

## Input datagram, client to relay

`0x01` · u8 n · u16 seq · u32 first_tick · u32 ack_tick · u64 ack_bits · n x u32 words · [u32 interval · u8 epoch · 3 B 0 · u64 hash]

That is 20 + 4n bytes, plus 16 with a hash report.

- **Words:** the words for ticks `first_tick` on. Send each a few times
  (every datagram carries the ones the relay hasn't closed), at most 64.
- **Acks:** they cover closed ticks however they reached you. `ack_tick` is
  the newest tick you have; bit k of `ack_bits` is tick `ack_tick - 1 - k`.
  The relay resends what they show missing, until a tick is 64 old.
- **Report:** the interval hash, below. Repeat it on the next few datagrams.
- **Spectators:** they send this datagram with no words, for the acks and the report.

## Closed ticks

A closed tick carries the joins and leaves, then only the input words that
changed since the tick before. Each changed word is coded against that slot's
previous word (0 for a slot nobody held), bit-packed most significant bit
first:

```
ne EG0 | ne x (slot 8, kind 2) | nc EG0 | nc x (gap EG0 | yaw? pitch? high? 3 x 1 | yaw delta zz-EG3 | pitch delta zz-EG1 | high byte 8)
```

| term | meaning |
| --- | --- |
| kind | 1 join, 2 leave |
| gap | slots skipped since the last change (the first counts from slot 0) |
| the yaw delta | wraps at 2^14 |
| zz | zigzag: 0, -1, 1, -2, ... to 0, 1, 2, 3, ... |
| EGk | Exp-Golomb of order k |
| each field | present only if its bit says it changed |

A tick too big for one datagram is cut by slot into parts of at most 1,000
bytes. Each part is coded the same way, its first gap counting from slot 0
again, and the events go in part 0.

Keep the 256 words the next tick is coded against, and apply ticks strictly in
order (lockstep does anyway). After a keyframe, those words are each live
player's last input in the keyframe's region.

## Ticks datagrams, relay to client

`0x02` bundle or `0x03` repair · u8 n · u16 0 · u32 from · n x (u8 tick - from · u8 part << 4 | parts · u16 bytes · the part) · [bundle trailer]

The bundle trailer is: u32 in_ack · i16 slack (1/16 ms; negative means your words were late) · u8 late · u8 flags.

- **Arrival:** a tick has arrived once all its parts have, from any datagrams.
- **Bundles:** a bundle may span several datagrams, each with the same trailer.
- **in_ack:** the newest tick through which the relay has all your words.

## Into the world

`game.wasm` imports one shared memory as `env.mem`: 64 pages, which never
grows. Call `init(seed)` with the welcome's seed. To step a closed tick:

1. Write its inbox:
   - for each join or leave, in order, a 16-byte record at `0x1010 + 16i`: byte 4 kind (5 join, 6 leave), byte 5 slot, the rest 0;
   - then an input record per changed word: kind 4, the slot, the word as u32 at byte 8;
   - the record count, as u32, at `0x1000`.
2. Call `step()`.

`net/inbox.mjs` `feedTick` does exactly this. The sim tick is the u32 at
`0x10000`.

## Keyframes

A keyframe is the region, the 512 KiB at `0x10000` that is the whole world,
at server tick `tick`. Its packed form groups the bytes of the f32 arrays by
significance (`wire.mjs` `shuffle`), then gzips them.

To restore one:
1. Unpack it and copy it to `0x10000`.
2. Call `regrid()`.
3. Seed your coded-against words from it. Player p's record is at
   `0x10100 + 64p`: the flags byte at +28 (its lowest bit: live), the input word at +24.

A key with raw bytes 0 means the room's start: `init(seed)` again. Then the
fill brings every closed tick from `tick` on, and bundles and repairs bring the
rest.

You'll get keys for:
- **join:** when you join;
- **hole:** when you ask for one because a tick has outlived the repair window;
- **behind:** when you ask because you've fallen far behind;
- **desync:** when your hash differed. It carries the referee's 128 slice
  digests of the interval, so you can name the slice your world got wrong.

## Hashes and the referee

Every 128 sim ticks the sim closes an interval. It writes the interval's sim
tick to `0x308` and its u64 hash, over the whole region, to `0x300`. Report it
(interval, hash) with `epoch` set to the number of keyframes you've restored,
mod 256. Reports from before your newest keyframe are dropped.

The relay's referee steps the same ticks with the same `game.wasm`. A report
that differs from the referee's gets a desync keyframe. Nothing else is
trusted, and nothing else needs to be.

## Spectators

- **Watching:** a hello with flag 1 gets `watching` in place of a welcome.
  There is no slot and no words. You get the bundles, repairs and keyframes,
  and the relay checks your reports.
- **Edge relays:** an edge relay (`net/relay.ts --upstream`) is a spectator of
  another relay that serves the room on to spectators of its own, so rooms
  fan out as trees.
- **Turned away:** at an edge, a player is refused with reason 4.

## Resume and failover

A relay started with `--standby` watches the room like an edge. If its
upstream goes away, it takes the room over:
- It closes the ticks from the newest it has, on the old clock's timeline.
- It holds every live player's slot for 8 s, repeating their last word.

To get your slot back, send a hello with flag 2. Set `slot` to your slot and
`room` to the room's `room_start`. You get a welcome with no join event, then
a keyframe. If nobody is holding that slot any more, a resume is an ordinary
join.

Clients that know several relays try the next one when theirs goes quiet.
They treat 1.5 s without a datagram as gone; a dead QUIC peer would otherwise
idle for far longer. `net/run-n4.mjs` kills the root mid-match and checks that
everyone keeps their slot.

## Replays

A relay started with `--replays dir` writes each room's record to a `.qgr`
file when the room ends. Layout:

1. Header, 40 B: `QGR1` · u8[8] game.wasm prefix · u32 seed · u32 room_start · u32 from · u32 n ticks · u32 hashes · u32 key bytes · u32 body bytes
2. The referee's interval hashes: hashes x (u32 sim tick · u32 0 · u64 hash)
3. The packed region at `from`, if the record starts from a keyframe
4. The n ticks as a fill body carries them, gzipped

A file is the same closed ticks a client steps, so playing one is being a
client with the network taken away. Every interval checks against the
referee's hashes on the way:
- `node tools/replay.mjs file.qgr` checks one;
- `client/?replay=<url>` plays one.
