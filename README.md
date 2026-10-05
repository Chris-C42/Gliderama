# Gliderama

Fold your own paper airplane, then fly it through a house room by room, in the spirit of Glider 4.0 and Glider PRO.
Every plane is folded from a simulated sheet of paper, and how it flies (lift, drag, stall, stability, toughness)
comes from the folded geometry through a semi-realistic aerodynamics model.

It is a PWA: it runs in the browser and installs on Android and iOS, and it works offline once loaded.

## Play

| | Touch | Keyboard |
|---|---|---|
| Throw | Drag back from the plane and let go | ↑ ↓ to aim, hold Space to charge |
| Fly left / right | Hold the left / right pad | ← → |
| Pitch | Slide the held pad up (nose up) or down (nose down) | ↑ ↓ |
| Gadget | Small button above a pad | Space |
| Hover (circle in rising air) | ↻ button by the right pad | H (gamepad Y) |
| Pause | ⏸ | Esc |

Pressing the way you are facing just lets you pitch; pressing the other way turns the plane round.
Let go of everything and the plane glides at its trim, so a badly folded plane dives or porpoises.

Blue squiggly lines show the air currents, as in the Glider games: where each vent, fan, radiator, candle or fire
blows, and exactly where its air stops (*Settings → Air currents* hides them). Air rising out of the top of a room
carries on through the opening into the room above.

Hover saves flopping back and forth over a vent: the plane circles by itself in the strongest rising air nearby (or
holds its place in still air) until you steer again. *Settings → Hover* hides the button.

Stairs work as in the original games: fly into the doorway at the top of a flight of stairs (or down into a
stairwell) and you come out at the stairs on the next floor, gliding level again.

Prefer one thumb? *Settings → Touch controls → One thumb* swaps the two pads for a floating joystick: press anywhere
on the left side of the screen (the right side when left-handed) and slide. Sideways turns, up and down pitch, and the
gadget button moves to the bottom corner on the other side. Throwing still works anywhere on the screen.

### Modes

- **Campaign**: a journey of places. *Home* (Bedtime Launch, Lights Out, Splash Zone) and *Grandma's Cottage*
  (Tea for Two, Knitting by Lamplight, Garden Door). Levels unlock folds, paper, gadgets and prints.
  *Classic Houses* holds the houses that came with Glider PRO, converted to Gliderama's rooms and all open from the
  start: find every star to finish a house, as in the original (see `docs/classic-houses.md`).
- **Paper Trail**: an endless roguelike. Clear procedurally built floors, draft one of three offers, refold at the
  workbench.
- **Daily Flight**: one seeded house per day with a twist, and a shareable result card.
- **Challenges**: ten design puzzles in the Paper Lab, with three stars each.
- **Workshop**: fold, name, share and import designs (share codes and links).
- **Test Hangar**: a sandbox with distance markers, a room builder, ghost flights and lab tests (report card, polar,
  throw sweep, compare).

## Develop

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # vitest (includes a check that every campaign level can be flown)
npm run typecheck
npm run build        # typecheck + production build into dist/
npm run icons        # re-render the PWA icons from public/icons/icon.svg
```

Dev pages served by `npm run dev`:

| Page | |
|---|---|
| `/play.html?level=cottage-1&plane=glider` | Bare play screen for any campaign level (`window.__throw(angle, power)` hook) |
| `/play.html?level=classic-demo-house&det&autopilot` | A Classic House flown by the bot pilot, planned in the page (`&room=63,-1` starts elsewhere) |
| `/room-lab.html?level=home-2&room=1,-1` | Room art and colliders (`&debug` for boxes and lights) |
| `/procgen-lab.html?seed=7&floor=2&theme=cottage` | Generated floors with their validation flights (`&stairs=1`: every change of storey a flight of stairs) |
| `/hangar-lab.html` | Flight tests and charts for every recipe |
| `/audio-lab.html` | Every sound, the loops, and a song editor |
| `/lab.html` | Fold engine and 3D geometry |

### Classic Houses

The Classic Houses are generated from the Glider PRO sources (BinHex house files, no other tools needed) into
`src/world/classic/houses/<house>.json` and `src/world/classic/catalog.json`. To convert them again, e.g. after
changing the mapping in `scripts/glider-map.mjs`:

```sh
git clone https://github.com/softdorothy/GliderPRO /tmp/GliderPRO
node scripts/convert-glider-houses.mjs /tmp/GliderPRO               # every house
node scripts/convert-glider-houses.mjs /tmp/GliderPRO "Demo House"  # one house, by name
```

`npm test` checks every house's data and flies the Demo House with the bot pilot. The full flight check of every
house takes a while and is run by hand; its findings go into `STATUS` in `scripts/glider-map.mjs`:

```sh
CLASSIC_REPORT=all npx vitest run tests/classicReport.test.ts --silent=false        # or a list of slugs
```

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` tests, builds and deploys on every push to `main` or
`claude/paper-airplane-game-huxgx3`. The build uses the base path `/Gliderama/` (set `BASE_PATH` to change it).

The deploy step needs two repository settings:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Environments → github-pages → Deployment branches**: allow `claude/paper-airplane-game-huxgx3`
   (by default only the default branch may deploy). Alternatively merge the branch into `main`.

The game is then served at `https://<owner>.github.io/Gliderama/`.

## Layout

```
src/paper      fold engine, 3D build, aero analysis, recipes, share codec
src/physics    flight model, damage, tuning constants (config.ts)
src/game       play session, collisions, room objects (vents, fans, fire, cat...), headless sim
src/world      room types, furniture art kinds, hand-built levels, procedural generator (procgen/), Classic Houses (classic/)
src/render     pixel-art room painter, lit compositor, 3D plane sprite, particles
src/modes      Paper Trail, Daily Flight, Challenges, level generation facade
src/sandbox    hangar analysis: open-air sim, glide test, throw sweep, polar, ghosts, charts
src/audio      chiptune engine, song notation, sound effects, ambient loops, soundtrack (songs/)
src/ui         screens, HUD, workshop, design system
scripts        icon renderer, screenshot tools, Glider PRO house converter (convert-glider-houses.mjs, glider-map.mjs, glider/)
docs           GAME_DESIGN.md, classic-houses.md
```

## Licence

Gliderama is free software under the GNU General Public License, version 2 (`LICENSE`). The Classic Houses are
adapted from the houses in John Calhoun's [Glider PRO](https://github.com/softdorothy/GliderPRO), released under the
same licence; see `CREDITS.md` for the house authors.
