# Roadmap: 128 games of 128 players

The plan for what comes after Party, written so a session can pick up any
part of it. Every number here was measured on this repo; where something is
not measured yet, it says so.

## Where it is

20 games, each gated online at 256 players: golf, bumper balls, the arena's
four modes (Fiesta, Infection, gun game, Juggernaut) and Party's 14
minigames. Fireplace plays them in turn.

What a page downloads, gzipped, everything it imports included:

| Page | Files | Gzipped |
| --- | --- | --- |
| `client/party.html` | 54 | 275 KB (wasm 29 KB) |
| `client/fireplace.html` | 66 | 410 KB (wasm 80 KB, 68 KB of it Blood Gulch's height map) |
| `client/bumper.html` | 38 | 114 KB |
| `client/arena.html` | 38 | 159 KB |

No textures, models, sound files or fonts: sounds are synthesized, the font is
3x5 bitmaps, every shape is drawn on the GPU. A Party minigame adds about
10 KB of client code and 2 to 3 KB of wasm.

Cost a tick at 256 players: 0.2 to 0.4 ms of the sim's 8 ms. Cost a frame on
the main thread: 0.5 ms for 256 balls, 0.25 ms for 1,172 ice tiles, about
2 ms for 20,000 solids. Not measured: frame rate on a real GPU (headless
Chrome here is SwiftShader).

A Party minigame on the framework is about 1,200 to 1,500 lines (sim, client
module, tests) and about an hour of one agent; this 4-core machine runs two
to four at once. Twelve took four hours.

## The engine's limits

- 256 players a room; more watch through the relay tree (600 tested).
- 512 KiB of gameplay state, hashed and snapshotted. Paint Party's grid is the
  largest so far, 128 KiB.
- One u32 input word per player per tick. More bits go in frames over
  several ticks, as the arena's lag and reload bits do.
- The prediction moves your own body; whatever another player does to you
  arrives a round trip later.
- No secrets: every machine holds the whole world.
- Physics: spheres, Quake-style bodies against a heightfield and up to 512
  boxes, and whatever a minigame's ground and push hooks describe.
- 125 Hz. A lower rate (60 Hz halves CPU and bandwidth) means a per-sim tick
  length the relay reads at the hello; do it only for a game that measures
  over budget.

## Kits

A kit is a framework with hooks, as `src/party.wat` is for the ball: one
wave to build (framework, frontend, bot), then a game on it is one agent.

| Kit | Now | Target | Candidates |
| --- | --- | --- | --- |
| Party (the ball) | 14 | 60 | Mini Golf, Sumo Ring, Snowball (grow by rolling, swallow smaller balls), Full Tilt (the floor tilts on a schedule), Slime Climb, Big Fans, Roll Out, Jump Club, Gate Crash, Hoop Hop, Pinball, Stompin' Ground; with teams: Fall Ball, Egg Scramble, Tug o' War, Volleyfall |
| Arena (the fighter) | 4 | 24 | Slayer at run time, Team Slayer, CTF, Oddball, King of the Hill, Battle Royale (a zone and loot pads), Snipers, Swords, Grifball, Floor is Lava, a Tower of Hell obby, a zombie horde |
| Champion (top-down, new) | 0 | 14 | FFA ARAM (below), team ARAM 128 v 128, co-op survivors against hordes, a boss raid of telegraphed patterns, Gem Grab, Showdown, Bounty |
| Grid (2D boards, new) | 0 | 16 | Tetris 99, Puyo 99, Dr. Mario 99, Bomberman 128, Snake, Pac-Man 99; races of Minesweeper, 2048, match-3, nonograms |
| Vehicle (new) | 0 | 12 | a kart race, balloon battle, bumper cars, car soccer 64 v 64, boats, hover racing, a demolition derby |
| Golf, bumper balls | 2 | 2 | |

The grid kit is this engine's model at its plainest: your own board is
predicted exactly, the garbage and bombs others send arrive a round trip
later. A board of 10 x 20 cells is 200 B; 256 of them are 50 KB.

What doesn't fit without engine work: hidden information (poker, Among Us,
hide and seek: it needs the relay to hold secrets and reveal them as input),
1 v 1 twitch duels (a fighting game needs a rollback of the other player, not
only of your own body), physics sandboxes, open worlds.

## Engine work, in order

1. Teams: a side per record, friendly fire off, team scores; Party, the arena
   and the champion kit. It unlocks about ten games.
2. The champion, grid and vehicle kits. The champion and vehicle kits draw
   with `client/party-render.mjs` (its decals are the telegraphs of a
   top-down game); the grid kit wants a small board renderer.
3. The arena: several maps in one build chosen at run time, boxes that move
   (obbies), new maps.
4. Fireplace: a vote for the next game, then a board between games (dice,
   stars, coins) over the minigames.
5. Pipelines compiled before a Fireplace switch: on SwiftShader the first
   switch into Party held the page's GPU about 40 s while its shaders
   compiled (every hash still equal). Then a frame rate on a real laptop GPU.
6. Smaller debts: Musical Pads' ground is exact only while the prediction runs
   less than 125 ticks ahead (the host predicts up to 201); bumper's and the
   arena's pages load Party's constants through `layout.mjs`'s `MG_CONSTS`
   (26 KB gzipped).
7. People playing it. Everything so far is played by bots.

## FFA ARAM (the champion kit's first game)

- The Abyss: a round arena for 256, bushes; a long bridge later for team ARAM.
- Every life four random abilities (Q W E R) and two summoner spells (Flash
  and one drawn), from a table of about 30 kept in `layout.mjs` as the arena
  keeps `ARMS`: skillshots, delayed ground blasts behind a warning ring,
  dashes, blinks, shields, heals, hooks, knock-ups, slowing fields, turrets,
  a global ultimate. A death may spend a reroll.
- Cooldowns, no mana; levels from kills; 4 s respawns; 8 minutes; most kills
  wins.
- Buffs fall from the sky as bumper's orbs do, on landing rings: Baron
  (empowered abilities), Dragon (stats), Poro snax (heal, speed), health
  relics.
- The word: yaw 14 bits, cursor distance 6, WASD 4, the ability 3 (Q W E R D
  F), a cast counter 2, 3 spare. It changes only when you aim or cast.
- Predicted: your movement, dashes and blinks, your projectiles' launch.
  Late by a round trip: hits and crowd control from others.
- Drawn with `client/party-render.mjs`: a camera at three quarters overhead,
  champions as figures, abilities as glows, beams and decals.

## Mods: what people make for it

Built: room themes (`client/themes/`, a JSON file each, local to the viewer;
`client/room.html` to make one), a minigame scaffold (`tools/new-mg.mjs`),
CONTRIBUTING.md, issue forms and a PR template, CI on pull requests from
forks, and `elo.json`, which the Elo Pros store reads: picked jobs for the
board's `fireplace` lane, where an accepted PR is paid, and a `mods` list
crediting who made what (every theme is one). Next, in order:

1. Things in the room. The mantel holds two things today (pumpkins or
   baubles, a theme's pick). A shelf of slots (the mantel, the side table,
   the wall over it) that a theme fills from a fixed set (a candle, a trophy,
   a framed picture), each a few lines of the room's shader, so a theme still
   stays data. Then the wall shows the viewer's own Elo Pros achievements: a
   plaque drawn in the 3x5 font like the TV's cards, from
   `/api/face/{wallet}` once the page knows a wallet (below).
2. Skins, as Gates does them: an `EloItem` collection for Fireplace (one
   deploy, the operator's), catalog rows in scry-forge's
   `data/items/catalogs.json` with `title: "fireplace"`, and the relay
   reading `/api/items/of/{wallet}?title=fireplace` and sending each player's
   look beside the sim (never in it: the hashed world is the same with or
   without them). A skin is a ball's stripes and a rider's cap, a few floats
   per player in party's and bumper's renderers; a theme is free, a skin is
   owned.
3. The playlist as a list (`GAMESETS`, `!pick` and `fireplace.mjs` reading N
   games), so a whole new game joins Fireplace as one entry once the kits
   below exist.

## Accounts and persistence through Elo Pros

What `AnthonE/scry-forge` has today: the wallet is the whole identity;
`sdk/js/elo-2.js` (served at `https://elopros.com/sdk/elo-2.js`) gives a
third-party game `Elo.signIn({nonce})` (Sign-In With Ethereum, or Solana's),
which the game's own server verifies with viem, with no Elo call; profiles at
`GET /api/face/{wallet}` (CORS on); friends and presence (`meter/friends.py`,
`meter/playtime.py` polling a game server's `online.json`); chat; items and
copies on chain (`/api/items/of/{wallet}`); a self-serve listing
(`meter/openlane.py`, `play_url`). It has no logins without a wallet (the
design is `docs/client/ACCOUNTS.md`), no per-game saves, stats or key-value
store, leaderboards only for Gates, no matchmaking, and no way to submit a
match result.

The wrapper, ours first:

1. List Party and Fireplace as free titles with `play_url` on these pages
   (the listing rules ask for the source to be public). Fireplace has its
   row (on the coming-soon shelf, in alpha, until people play it) and its
   board lane, `fireplace-pr`, in scry-forge since 2026-10-25; `elo.json`
   lands on the row once its steward signs it (`sign_manifest.py --game
   fireplace --seq 1`, scry-forge's `docs/store/GAME-REPO.md`).
2. Sign-in: the page calls `Elo.signIn({nonce})` with a nonce from the relay's
   hello; `net/relay.ts` verifies it and keeps the wallet as the slot's
   player. Guests still play.
3. Names, faces and skins: the relay reads `/api/face/{wallet}` and
   `/api/items/of/{wallet}` and sends them beside the sim, never in it, so the
   hashed world is the same with or without them. Skins on chain become ball
   stripes and riders' hats.
4. Presence: the relay serves `online.json` (and the operator a
   `servers.json`), so playtime and friends' join links work.
5. Results: the relay's referee steps the room itself, so its standings and
   interval hashes are the room's truth, not any client's: the "replay"
   evidence tier of `docs/store/ACHIEVEMENTS.md`.

Then, in scry-forge: an endpoint to submit a result, leaderboards for any
title, and a key-value store per wallet for what lasts (party points,
marshmallows).

## Sessions

1. Teams; the champion kit and FFA ARAM; Team Slayer, CTF, Oddball and King of
   the Hill in the arena.
2. The grid kit: Tetris 99, Bomberman 128, Snake, Puyo 99.
3. The vehicle kit and karts.
4. Then waves of 12 to 16 Party and arena games.
5. The Elo Pros wrapper, whenever: it depends on nothing above.

About seven to nine long sessions on this machine to reach 128. Each new game
keeps the repo's bar: its own test file, a recorded log equal in all 27
configurations of the matrix, and an online gate. To claim 128 games of 128
players, each game also gets a 128-bot gate, run nightly in CI (about two
hours for all of them).
