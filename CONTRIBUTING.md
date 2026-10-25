# Contributing to Fireplace

Fireplace is a living room with a TV that plays a playlist of games: golf,
bumper balls, the arena and Party's minigames. It is on the Elo Pros store as
Fireplace, and this repo is its source (CC0). Anyone can change it, people and
agents alike, and an accepted pull request is paid.

Three ways in, from no code to the engine:

- **A theme**: a reskin of the living room, one JSON file. No code.
- **A Party minigame**: a new round for Party, and so for Fireplace. A tool
  writes one that already plays; you make it yours.
- **Anything else**: bots, the renderers, the netcode, fixes. Read CLAUDE.md
  and the README's section for what you touch.

## Getting paid

Any pull request merged into this repo pays the Elo Pros board's posted price.
The board posts it in dollars and pays it in ELO at the pool's price on the
day it pays. Read the price and what's open with
`curl -s https://elopros.com/api/munus?game=fireplace`.

1. Put the wallet you want paid in the PR's description: `Wallet: 0x…`. If an
   agent made the change, fill in the `Agent:` line with its harness and
   model.
2. Put it on the record: sign this text with that wallet, then
   `POST https://elopros.com/api/munus/fireplace-pr/submit` with
   `{"wallet": "0x…", "url": "<the PR's url>", "signature": "0x…"}`.

   ```
   elo play
   action: submit
   wallet: <your address, lowercase>
   day: <today, UTC, YYYY-MM-DD>
   detail: fireplace-pr <first 16 hex of sha256(url)> #<your deliveries to fireplace-pr so far, from 0>
   ```

   `GET https://elopros.com/api/play/message?action=submit&wallet=…&detail=…`
   returns the same text. [elopros.com/build.html](https://elopros.com/build.html)
   lists the open work.

No wallet is fine: a PR is merged and credited the same, it just isn't paid.
Merging is a person's call. By opening a pull request you dedicate your work
to the public domain under this repo's licence (CC0), so it must be yours:
no other game's names, characters, art or sounds.

## A theme

A theme changes what the living room looks like on the screen of whoever
picks it, and nothing else: the sim never sees it, so it can't desync a room.
Grandma's (`client/themes/grandma.json`) is the room as it has always been
drawn, and every other theme changes some of it.

```sh
npm ci && npm run build                                  # once
node tools/themes.mjs new <id> <your-github-login>       # client/themes/<id>.json, every field at Grandma's
node tools/serve.mjs                                     # then open http://127.0.0.1:8080/client/room.html?theme=<id>
```

`room.html` reads the file again every second, so the room changes as you
save. A mistake shows at the bottom and the room keeps the last good one. T or
a click goes to the next theme. In Fireplace itself, `?theme=<id>` picks one
and T cycles them while the room is in view; each viewer's pick is their own.

The file:

| field | what it is |
|---|---|
| `theme` | `1`, the format |
| `name` | what the TV calls it: 24 characters, plain ASCII |
| `by` | your GitHub login, credited on the store |
| `about` | one line, 200 characters at most |
| `window` | `snow`, `rain` or `clear` (stars and the moon) |
| `mantel` | `pumpkins`, `baubles` or `none` |
| `colors` | any of the colours below; one you leave out stays Grandma's |

A colour is `"#rrggbb"` (what a colour picker shows) or `[r, g, b]` from 0
to 1. The lights (`lampGlow`, `fire`, `night`, `moon`, `flakes`, `outdoor`,
`ambient`) are colours too: a darker one is a dimmer light.

| colour | what it paints |
|---|---|
| `brick`, `mortar` | the chimney breast and the firebox, and between the bricks |
| `mantel` | the mantel shelf |
| `hearth` | the hearth stone in front of the fire |
| `wood` | the TV's cabinet and the side table |
| `couch` | the couch you sit on |
| `trim` | the window's frame |
| `ceiling` | the ceiling |
| `floor` | the floorboards |
| `wallpaper` | two colours: the stripes |
| `baseboard`, `cornice` | the band along the floor, and the one along the ceiling |
| `rug` | three colours: the braided rug's yarns |
| `rugEdge` | the rug's edge |
| `lamp`, `lampGlow` | the lamp's shade, and its light |
| `fire` | the flames, the embers and the firelight on everything |
| `paintSky` | two colours: the painting's sky at the horizon and at the top |
| `paintGround`, `paintHouse`, `paintFrame` | the painting's ground, its cabin, its frame |
| `night` | two colours: the sky through the window, low and high |
| `moon` | the moon, and the stars on a clear night |
| `flakes` | snowflakes or raindrops |
| `sill` | the ledge outside the window |
| `outdoor` | the light the window lets in |
| `ambient` | the light that bounces round the room: how dark the shadows are |
| `props` | two colours: the two things on the mantel |
| `propCap` | a pumpkin's stalk, a bauble's cap |

Before the PR:

```sh
node tools/themes.mjs                          # checks every theme
node tools/elo.mjs                             # credits it in elo.json, which the store reads
node --test test/themes.test.mjs
node tools/theme-shots.mjs --themes <id>       # traces/themes/<id>.png: put it in the PR
```

CI draws every theme the same way and keeps the pictures as an artifact.

## A Party minigame

A minigame is four files: its rules in WebAssembly text (`src/mg/<key>.wat`,
nine hooks the framework calls), its constants (`src/mg/<key>.mjs`), how it
looks and how the bots play it (`client/mg/<key>.mjs`), and its tests
(`test/mg-<key>.test.mjs`). The tool writes all four for a sumo ring (a round
platform over the sea; bump the others off, the last ball on wins) and wires
it into the lists that name every minigame:

```sh
node tools/new-mg.mjs <key> <prefix> "<NAME>"     # e.g. node tools/new-mg.mjs snowball sb "SNOWBALL"
npm run build && node --test test/mg-<key>.test.mjs test/party.test.mjs
node net/play.mjs --party --mg <id> --bots 7      # play it: open the URL it prints
```

Then make it yours. The twenty-six others in `src/mg/` are worked examples, and
the top of `src/party.wat` and `client/party-game.mjs` says what each hook is
given and may do. The rules every machine must agree on are CLAUDE.md's "The
sim's rules", and the build refuses some of them outright. The ones that bite
a minigame:

- `ground` and `push` also run in the prediction, on bank `d`: they write only
  their own ball's record and bank `d`'s FX ring, and read bank `d`'s header.
- State lives only in `PG_H`, `PG_S`, `PG_BIG` and the record's `PG_M` and
  `PG_SCORE`. Nothing carries over in a local.
- Floats: `(!madd a b c)` for `a * b + c`, never fused; angles through
  `$sincos`. `$rand` never in `begin`, `ground` or `push`, which the
  prediction runs too.
- The bots have to play it (`brain` in the client module): every gate is
  played by bots.

Ideas are in `docs/roadmap.md`'s kits table. The bar (CI runs the tests and
Party's rotation on your PR; run the two with `--mg` yourself, and say in the
PR that they passed):

```sh
npm test                                                   # its tests, and every other
node tools/genparty.mjs --mg <id> --out logs/mg.qgl        # a recorded match of it...
node harness/matrix.mjs --log logs/mg.qgl --wasm build/party/game.wasm   # ...equal in all 27 configurations
node net/run-party.mjs --mg <id>                           # online: a relay, bots and Chrome, every hash checked
```

Matrix and online runs need Deno (`sh tools/install-deno.sh`) and Chrome
(Playwright's).

A minigame changes the party and Fireplace builds; golf, the arena and bumper
balls must stay bit-identical (compare the sha256s `npm run build` prints
before and after).

## Anything else

Read CLAUDE.md first: its rules are what keeps every machine on the same bits.
Then the README's section for what you touch. `npm test` before the PR; CI
runs everything else on it.
