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
| Pause | ⏸ | Esc |

Pressing the way you are facing just lets you pitch; pressing the other way turns the plane round.
Let go of everything and the plane glides at its trim, so a badly folded plane dives or porpoises.

Prefer one thumb? *Settings → Touch controls → One thumb* swaps the two pads for a floating joystick: press anywhere
on the left side of the screen (the right side when left-handed) and slide. Sideways turns, up and down pitch, and the
gadget button moves to the bottom corner on the other side. Throwing still works anywhere on the screen.

### Modes

- **Campaign**: a journey of places. *Home* (Bedtime Launch, Lights Out, Splash Zone) and *Grandma's Cottage*
  (Tea for Two, Knitting by Lamplight, Garden Door). Levels unlock folds, paper, gadgets and prints.
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
| `/room-lab.html?level=home-2&room=1,-1` | Room art and colliders (`&debug` for boxes and lights) |
| `/procgen-lab.html?seed=7&floor=2&theme=cottage` | Generated floors with their validation flights |
| `/hangar-lab.html` | Flight tests and charts for every recipe |
| `/audio-lab.html` | Every sound, the loops, and a song editor |
| `/lab.html` | Fold engine and 3D geometry |

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
src/world      room types, furniture art kinds, hand-built levels, procedural generator (procgen/)
src/render     pixel-art room painter, lit compositor, 3D plane sprite, particles
src/modes      Paper Trail, Daily Flight, Challenges, level generation facade
src/sandbox    hangar analysis: open-air sim, glide test, throw sweep, polar, ghosts, charts
src/audio      chiptune engine, song notation, sound effects, ambient loops, soundtrack (songs/)
src/ui         screens, HUD, workshop, design system
docs           GAME_DESIGN.md
```
