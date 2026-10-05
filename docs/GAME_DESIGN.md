# Gliderama — Game Design Document

*Working title. Living document: the source of truth for design decisions.*

## 1. Vision

Fold your own paper airplane, then fly it through a house — room by room — in the spirit of
Glider 4.0 / Glider PRO. Every plane is folded from a real (simulated) sheet of paper, and how it
flies **emerges from its folded geometry** through a semi-realistic aerodynamics model. Different
designs suit different rooms and different pilots.

**Pillars**
1. **Fold it yourself.** Real folds on a real sheet. Lift, drag, stall, stability and toughness are
   computed from the geometry — never picked from a menu.
2. **Rooms are puzzles.** Single-screen rooms full of vents, fans, flames, drips and switches.
   Piloting skill *and* design skill both matter.
3. **Cozy retro, modern touch.** HD pixel art, dynamic dithered lighting, a true-3D folded plane at
   pixel scale, chiptune audio.
4. **Easy to learn, hard to master.** Forgiving early campaign; depth in later places, the
   roguelike, the daily and challenge stars. Optional assists.

Platforms: browser, Android, iOS — as an installable **PWA** (offline capable), deployed to GitHub
Pages. Landscape for flying; menus/workshop adapt to portrait.

## 2. Controls

| | Touch | Keyboard | Gamepad |
|---|---|---|---|
| Fly left / right (turn around if facing the other way) | Hold LEFT / RIGHT button | ← → / A D | Left stick X |
| Pitch (elevator) | While holding a direction button it becomes a **vertical slider**: drag up = nose up, down = nose down (neutral = touch-down point) | ↑ ↓ / W S | Left stick Y |
| Gadget (boost / rubber band / helium) | Small gadget buttons above each direction button (either thumb) | Space | A |
| Pause | ⏸ button | Esc / P | Start |
| Throw | Drag back from the hand (slingshot), release | ↑↓ aim, hold Space to charge | Stick aim, hold A |

- Releasing all inputs = **hands-off glide at the design's trim** (a badly-trimmed plane will dive
  or porpoise — the design matters).
- Pressing the direction you're facing just engages the pitch slider. Pressing the opposite
  direction performs a **turnaround** (a 3D wingover/stall-turn; duration and height loss depend on
  the design's agility, speed and damage).
- Options: invert pitch, slider sensitivity, left-handed layout, auto-trim assist, slow-mo assist.

## 3. Flight model (semi-realistic)

2D longitudinal rigid-body flight in the room plane + a scripted 3D turnaround.

- State: position, velocity, pitch θ, pitch rate q, facing (±1), turn progress.
- Air-relative velocity includes **wind fields** from room objects (vents, fans, thermals, gusts).
- Coefficients from the design analysis (§4): `CL(α)` with stall and (for low-AR sharp deltas)
  vortex lift; `CD = CD0 + K·CL² + post-stall flat-plate drag`; pitching moment via the centre of
  pressure moving aft after stall; pitch damping `Cmq`.
- Player pitch input = elevator deflection `δe` on top of the design's trim. Control authority =
  base authority + the design's elevator flaps.
- Physics uses real SI constants and runs in **slow motion** (global time scale ≈ 0.35) so a real
  4–6 m/s paper plane crosses a 5 m room in ~3–4 s. 1 m = 128 px; a room is 5.0 × 2.81 m
  (640 × 360 px). Tuning knobs live in one config file.
- Throw: drag to aim; power maps to a launch speed; the design's ideal throw speed is shown as a
  sweet spot on the power meter.

## 4. Fold workshop & design analysis

**Folding** happens on the right half of the sheet in a fixed "table" frame (mm; x = distance from
the centre line, y = distance from the nose edge). Every fold is mirrored to the left half (planes
are symmetric). The engine tracks facets (convex polygons), their source coordinates (for printed
patterns / UVs), layer order and which paper side faces up.

Workshop steps:
1. **Paper** — size (A4, Letter, Square, A5, Legal, A3), orientation, stock (tissue, newsprint,
   origami, printer, cardstock), colour and print pattern (cosmetic; two-sided origami paper shows
   white where folded).
2. **Fold** — drag a corner/vertex to a target (perpendicular-bisector fold) with snapping to
   meaningful targets (centre line, edges, vertices, crease intersections, "fold through this
   point" landing spots); or draw a free fold line. Valley/mountain toggle; undo/redo; recipe card.
3. **Fold in half + wing fold** — choose flaps inside/outside; drag the wing fold line (keel depth
   at nose and tail).
4. **Shape** — dihedral, winglets (fold line + angle), elevator flaps (depth, span, angle).
5. **Extras** — paperclips (nose weight), coating (wax = waterproof, foil = heat shield), tape
   reinforcement, gadget (battery prop, rubber bands, helium sticker).
6. **Name, save, share, test in the hangar.**

**Analysis** (rasterised planform + mass distribution) produces: mass, CG, wing area, span, aspect
ratio, sweep, MAC, aerodynamic centre/neutral point, static margin, CLα, stall angle, CD0, K, Cm0
(trim), Cmδ (control authority), Cmq, pitch inertia, roll inertia, keel area, toughness.

**Friendly stats** (0–10 bars): Glide (L/D max), Speed (trim speed), Float (inverse wing loading:
how much drafts carry you), Stability (static margin + damping), Agility (turn time + pitch
response), Toughness (layers × stock). **Engineer view**: the real numbers + polar curve, CG vs NP
diagram, warnings ("unstable: add nose weight", "dives hands-off: bend elevators up").

**Recipes** (starting points): Classic Dart, Simple Glider, Nakamura Lock, Delta, Hammerhead,
Square Glider (unlock-gated in campaign).

**Sharing**: designs encode to a compact code (`GLD1-…`) and URL (`#/import/<code>`); a
"blueprint card" image (plane render + stats) can be saved/shared.

## 5. Damage — wear & tear

Parts: nose, left wing, right wing, tail/elevator, body. Each tracks 0–100 %.
- **Bumps** crease/crumple the part hit (scaled by impact speed vs toughness): nose → drag;
  wings → lift loss, drag and asymmetry (wobble; faster turnaround one way, slower the other);
  tail → random trim change (the plane starts pitching up or down hands-off).
- **Soggy** (drips, steam, sink): heavier, less lift; wax coating prevents.
- **Burning** (touching flames): spreads damage for ~2 s unless extinguished by water; foil
  prevents ignition. Near flames (not touching) only singes slightly.
- **Torn** (shredders, scissors, fan blades): heavy damage.
- **Destroyed** when structural damage reaches 100 % or on catastrophic impact.
- **Grounded**: coming to rest on any surface (floor skims at speed can bounce = touch-and-go).
- A flight ends when grounded or destroyed → costs one **spare sheet** (lives); respawn with a fresh
  plane via a throw from the current room's entry point. Out of sheets = level failed.
- **Tape** repairs (workbench or pickups) but adds weight.

## 6. World

Single-screen rooms (640 × 360) like the original. Exits: left/right openings (doorways), ceiling
openings (stairwells, ducts up), floor openings (stairs down), ducts (teleport pairs), exit portals
(open window, mail slot, cat flap).

**Objects (first build)**
- Air: floor vent ↑, ceiling vent ↓, desk fan (switchable), ceiling fan, radiator (wide weak
  thermal), open window (periodic gusts), candle (thermal + flame), fireplace, kettle steam (wet
  thermal), A/C unit.
- Hazards: flames, drips/leaks, toaster (popping toast), balloons (drifting), the cat (swats when
  you pass), spider web (sticky), shredder (later places).
- Interactive: light switch (dark rooms!), fan/outlet switches, ducts, **workbench** (refold/repair).
- Collectibles: gold stars (score/medals), spare sheet (+1 life), tape (repair), battery cells,
  rubber bands, stamp (1 hidden per level).

## 7. Modes

### Campaign — "A journey of places"
Wordless story: a kid's paper plane trying to reach the open sky.
1. **Home** (tutorial; bedroom → upstairs → bathroom/stairs → kitchen/living room → mail slot)
2. **Grandma's Cottage** (candles, fireplace, kettle, cat, cuckoo clock, knitting)
3. School · 4. Office Tower · 5. Museum of Flight · 6. Rooftops & Sky (later builds)

Each level: 6–10 rooms, 1–2 workbench rooms (refold/repair in context — some rooms are design
puzzles: narrow duct, gale-force fan, long dark hallway). Goal: escape through the exit. Medals:
**Escape**, **All Stars**, **Pristine** (low damage), **Swift** (par time). Unlocks: folds &
recipes, paper stock, gadgets & add-ons, cosmetics.

### Endless roguelike — "Paper Trail" (draft-to-build)
Runs through procedurally generated floors (6–8 rooms + a workbench room). Start: plain printer
sheet, basic folds, 3 spare sheets. Between floors pick **1 of 3 offers**: fold techniques, paper
stock, add-ons/coatings, repairs/sheets, perks (e.g. "+20 % vent lift"). Refold at the workbench
with what you own. Difficulty ramps (more hazards, darker rooms, stronger wind, fewer vents) and
place themes rotate. Score = rooms cleared + stars. Light meta: campaign unlocks widen the offer
pool; stars earned unlock cosmetics.

### Daily Flight
Seeded by the date (no server): same procedurally generated house for everyone + a **twist**
("tissue paper only", "lights out", "max 5 folds", "windy day", "heavy nose"...). One scored
attempt, unlimited practice. Wordle-style **share card** (rooms as coloured squares, stars, time,
damage, link).

### Challenges — design puzzles
Hand-made: fixed room(s) + constraints (paper stock, fold budget, mandatory add-on) + goal (land in
the bin, thread three hoops, stay aloft 10 s, punch through the gale). Stars: complete / within fold
budget / stretch goal. Some unlock campaign items.

### Test Hangar (sandbox)
Wide hangar with camera pan. Launcher (angle/power) or manual throw. **Live flight data** (speed,
AoA, L/D, sink rate, CL, trajectory trail with time ticks). **Build-a-test-room** (place vents,
fans, walls, candles, targets; set wind). **Auto tests & charts** (glide test: distance/time
aloft/sink rate; polar curve; stall speed; report card). **Ghost comparison** (replay previous
flights / a second design side by side).

## 8. Art bible

- **HD pixel art** at an internal resolution of **640 × 360**, scaled with nearest-neighbour.
  Front-on rooms like Glider PRO with more detail: wallpaper, wainscoting, crown moulding, plank
  floors in slight perspective, furniture drawn with a slight top-down oblique.
- **Palette**: curated warm-interior palette with cool night tones. Light from the top-left;
  selective dark (not black) outlines; ordered (Bayer) dithering for gradients.
- **Dynamic lighting** shader: ambient + point lights (lamps, candles, fireplace, windows) with
  dithered banded falloff; light switches dim rooms to moonlight; emissive pixels (flames, lamp
  shades, windows, screens) stay bright.
- **The plane** is a real 3D mesh from the fold engine, flat-shaded, printed paper texture via UVs,
  two-sided paper, 1-px outline, rendered at pixel scale in a 3/4 view so wings are visible;
  banking and turnarounds show its true shape. Classic Glider **shadow** on the surface below.
- **Airflow is readable**: subtle animated wisps in vent columns, streaks from fans, heat shimmer
  above flames.
- **UI**: craft-desk aesthetic — index cards, masking-tape labels, graph paper, pixel fonts
  (Pixelify Sans / Silkscreen).

## 9. Audio — chiptune

Four-channel style synth (2 pulse, triangle, noise) via WebAudio. Tracks: title, workshop, Home,
Cottage, roguelike, daily, results jingles. SFX: throw, fold crease, crumple, bump, burn, splash,
star, extra sheet, switch, vent whoosh, fan hum, stall warning, turnaround swish, UI clicks.

## 10. Tech

TypeScript · Vite · Three.js (WebGL compositor, orthographic camera) · Preact + signals (UI
overlay) · vite-plugin-pwa (Workbox) · Vitest · Playwright (screenshot checks). Fixed 120 Hz
physics. Saves in localStorage (versioned with migrations). GitHub Actions → GitHub Pages
(`/Gliderama/`).

### Source layout
```
src/
  app/      app shell, screen routing
  core/     loop, rng, math, storage, settings
  input/    touch sliders, keyboard, gamepad, throw gesture
  audio/    synth, sequencer, sfx, songs
  paper/    fold engine, design schema, recipes, mesh, aero analysis, share codec
  physics/  flight dynamics, wind, collisions, damage
  world/    room model, objects, levels, campaign data, procgen
  render/   compositor, lighting, pixel-art toolkit, art painters, plane renderer, particles
  ui/       screens & components (Preact), styles
  modes/    campaign, roguelike, daily, challenges, sandbox
```
