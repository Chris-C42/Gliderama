# Classic Houses

The *Classic Houses* place of the campaign holds the 22 houses that ship with **Glider PRO** (John Calhoun,
Casady & Greene 1994; source, graphics and houses released under the GNU GPL v2 at
<https://github.com/softdorothy/GliderPRO>). They are converted from the original house files into Gliderama
levels: the rooms keep their layout and the way they connect, and each object becomes the closest thing
Gliderama has, or is left out (and listed). Every house is open from the start, and, as in Glider PRO, a house
is finished by collecting all of its stars. The authors are credited on each house's card, in its intro and in
`CREDITS.md`.

No new art was drawn: what Gliderama has no picture for is approximated or dropped, and listed at the end
([missing art](#glider-pro-objects-without-gliderama-art)).

## Pipeline

| File | |
|---|---|
| `scripts/convert-glider-houses.mjs` | The converter (CLI). Reads `Houses/*.binhex` (and `Glider PRO.r` for the game's own backgrounds) from a Glider PRO checkout, writes `src/world/classic/houses/<house>.json` and `src/world/classic/catalog.json` |
| `scripts/glider/binhex.mjs` | BinHex 4.0 decoder with its CRC checks; classic resource fork reader |
| `scripts/glider/house.mjs` | The house data fork (`houseType`, `roomType`, `objectType` of `Headers/GliderStructs.h`) |
| `scripts/glider/pict.mjs`, `rez.mjs` | Just enough QuickDraw PICT to read the backgrounds' colours; resources from Rez source |
| `scripts/glider-map.mjs` | **Every mapping decision**: geometry, openings, air tuning, looks, the object table, credits, per-room fixes, the flight check's findings |
| `src/world/classic/` | The catalog (always loaded) and the houses (one chunk each, loaded when played) |
| `tests/classicFormat.test.ts` | Decoder (CRC, a known header), parser (the Demo House), PICT/Rez readers, and the converter reproducing the committed Demo House |
| `tests/classicHouses.test.ts` | Every house: rooms connect back to back, items inside their rooms, every kind known, stars reachable; the bot pilot flies the Demo House |
| `tests/classicReport.test.ts` | The flight check of every house (run by hand: `CLASSIC_REPORT=all`) |
| `tests/helpers/houseSolver.ts` | The bot pilot for whole houses |

```sh
git clone https://github.com/softdorothy/GliderPRO /tmp/GliderPRO
node scripts/convert-glider-houses.mjs /tmp/GliderPRO                 # every house
node scripts/convert-glider-houses.mjs /tmp/GliderPRO "Demo House"    # one house
node scripts/convert-glider-houses.mjs /tmp/GliderPRO "Demo House" --fixtures   # and the test fixtures
CLASSIC_REPORT=all npx vitest run tests/classicReport.test.ts --silent=false     # the flight check
```

Each house JSON is a `LevelDef` plus `meta`: the original name and file, authors and credit, rooms, objects
mapped and dropped (by type and reason), approximations, the missing art, conversion notes and the flight check's
status. The houses add up to about 2.4 MB of JSON (about 300 KB gzipped), so they are kept out of the PWA's
precache: the build puts each in `assets/houses/`, and the service worker caches a house the first time it is
played (`vite.config.ts`). The catalog that the campaign card needs is part of the app.

## The format, briefly

**BinHex 4.0** (`.binhex`): the classic Mac file (name, type `gliH`, creator `ozm5`, data fork, resource fork)
as 7-bit text: 6-bit digits between colons, run-length compressed with `0x90`, each part followed by its
CRC-16/XMODEM. The decoder checks all three CRCs (every house in the release passes).

**Data fork** = the `houseType` record as it was in memory (big-endian, 68k alignment):
version (`0x0200`), flags, the glider's starting point, banner and trailer texts (Str255), high scores, a saved
game, the first room, the room count, then `roomType` × n (348 bytes: name, bounds code, background id, the 8
background tiles, floor, suite, and 24 `objectType`s of 12 bytes: a type id and a 10-byte union whose layout
depends on the object's family). Rooms sit on a grid: `suite` grows rightward, `floor` upward. Switches and
transports name another room as `suite × 100 + floor + 8` and an object in it by slot. See the header of
`scripts/glider/house.mjs` for the offsets.

**Resource fork**: `bnds` (which walls of a custom background are open), `PICT` (custom backgrounds, ids
3000+, and pictures placed in rooms, the `customPict` objects), `snd `, icons, and a `vers` that sometimes says
who made the house. The game's own backgrounds (ids 2000–2017) are in `Glider PRO.r`, the application's
resources as Rez source. All the pictures are version 2 PICTs: one or more packed pixel maps (8-bit indexed,
a few 16/32-bit).

## Mapping

### Geometry

A Glider PRO room is 512 × 322 px, the floor line at y 312 and the ceiling at 8; a Gliderama room is 640 × 360
with the plane's floor at 340 and ceiling at 16. x scales by 1.25; y maps floor line to floor line and ceiling
to ceiling (× 1.066), so every height in the original has its height here. Furniture whose bottom is within
28 px of the floor stands on Gliderama's floor. Room keys are `"suite,-floor"` (Gliderama's y grows downward).

### Rooms and the ways between them

| Glider PRO | Gliderama |
|---|---|
| Room walls: tiles 0 / 7 of the built-in rooms, the `bnds` code of custom backgrounds; garden, field, stratosphere, stars open both sides | Side exits (one span per side). Either room's open wall lets the plane through, as in the original (`CheckEscapeLeft/Right`), so one-way doorways are two-way here |
| Doors and windows (`doorIn/Ex`, `windowIn/Ex`) | Openings in the side wall at their hot spots (240 px of a door, 44 px of a window, in the original's pixels) |
| Open floors: sky backgrounds, dirt tunnels (tiles 2–3 down, 5–6 up), manholes | Floor / ceiling exits over those x ranges |
| Two openings in one wall or floor | One exit spanning both, the wall between them a block |
| Stairs (`upStairs`, `downStairs`) | Gliderama's stairs (fly into the doorway at the top-left of the flight, or down the stairwell) |
| Transports (`floorTrans`, `ceilingTrans`, `mailboxLf/Rt`, `invisTrans`, `deluxeTrans`) | `transport`: fly into the original's trigger area, come out where the original puts the glider, gliding level (a new checkpoint); for 0.6 s after, no transport takes the plane (linked ones often face each other). Ducts draw a vent grille; mail slots and invisible transports shimmer faintly. The far end of a transport is drawn too. Deluxe transports follow their switch |
| Roofs (built-in roof background) | Red blocks under the roof's surface line, sloped parts as 16-px steps |
| The glider's start (first room, starting point) | `start`, facing right |

### Looks

The built-in backgrounds have a look each, after the game's own pictures:

| Background | Wall | Floor |
|---|---|---|
| Simple room | plain cream | oak planks |
| Paneled room | plain grey, walnut wainscot | oak planks |
| Basement | dark brick | concrete |
| Child's room | sky-blue with paper planes | navy carpet |
| Asian room | cream with leaves | moss carpet |
| Unfinished room | pine boards | pine planks |
| Swinger's room | red flock | red carpet |
| Bathroom | white tiles | stone and navy checks |
| Library | oak boards (shelves), walnut wainscot | navy carpet |
| Skywalk | sky-blue (windows) over oak | oak planks |
| Dirt | plain walnut | walnut stone |
| Garden, meadow, field | outdoors: sky with hills, grass | |
| Roof, sky | outdoors: open sky | |
| Stratosphere, stars | outdoors: night sky | |

A house's own backgrounds get the look closest to the picture (`pictureLook`): the picture is composed as the
game draws the room (the tiles' slices of the background, the room's pictures on top) and measured. A sky
behind (bright blue in the upper part) makes the room outdoors (open sky when its floor is open, else sky over
hills and grass); black with stars makes a night sky; otherwise the wallpaper takes the main colour (the more
colourful of two when a pattern has two, as flock), a lower wall of another colour becomes a wainscot, the floor
strip the floor. Colours go to the nearest Gliderama ramp by hue first (Gliderama paints walls in light shades,
so a deep red wall becomes a light red one); greys stay grey.

Rooms without a window, a doorway or a light that starts switched on are dark, as in Glider PRO
(`GetNumberOfLights`; the built-in outdoor backgrounds are always lit).

### Air

Glider PRO's air is all or nothing: inside a column the glider rises at a steady 6 px a frame, and it can hang
still by letting go. A paper plane can't stop, so it climbs by weaving through a plume: the columns are made wide
and strong enough for that, and their tops stay where the original's end. All in `AIR` in `glider-map.mjs`:

| Glider PRO | Gliderama |
|---|---|
| Floor vent, floor blower, sewer grate, Greco vent, sewer blower (on the floor) | `floorVent`, power 3.2 + distance / 260 m/s (≤ 4.6), spread 0.12, reach = the column's top |
| The same standing on furniture | invisible rising `current` from its grille |
| A column that reaches the ceiling under an opening | carries on into the room above (reach −40 / to the top edge) |
| Ceiling vent, ceiling blower | `ceilingVent`, 2.6 m/s down to the column's end |
| Left / right fan | `fan`, 3.4 m/s, reach = the original's distance |
| Candle, taper, stubby candle, tiki torch, barbecue | `candle` (the flame burns) and, where the original's heat column is 64 px or more, rising air above the flame's deadly part |
| Invisible blower (up / down / left / right) | invisible `current`: columns 140 px wide (the original's are 4 px, but the glider is 48 wide), bands 46 px high |
| Lift area | invisible `current` over its rectangle (at least 140 px wide, or 46 px high for sideways air); rising air up to the ceiling carries on through an opening there |
| Blowers that start off | off until their switch is flipped (switch group `!g`); ones no switch turns on are left out |

### Objects

Counts are over all 22 houses.

| Glider PRO object | Count | Gliderama |
|---|---:|---|
| Floor vent / floor blower / sewer grate / Greco vent / sewer blower | 1458 / 83 / 507 / 116 / 191 | floor vent (see Air) |
| Ceiling vent / ceiling blower | 28 / 12 | ceiling vent |
| Left fan / right fan | 45 / 54 | fan |
| Taper / candle / stubby / tiki / barbecue | 90 / 180 / 127 / 58 / 43 | candle (+ rising air) |
| Invisible blower / lift area | 2336 / 716 | invisible current |
| Table / deck table / stool | 170 / 30 / 91 | side table, its top where the original's is |
| Shelf | 389 | shelf |
| Cabinet | 457 | dresser (standing) or bookshelf (on the wall) |
| Filing cabinet / counter / dresser | 107 / 287 / 122 | dresser |
| Waste basket / milk crate / trunk | 103 / 252 / 101 | toy box |
| Books | 210 | stacks of books |
| Invisible obstacle / invisible bounce | 666 / 1670 | solid block, drawn in the colour the original picture has there (they stood for walls, pipes and ledges drawn in it) |
| Manhole | 40 | opening in the floor |
| Cinder block | 43 | stone block |
| Star | 69 | goal star (all of them finish the house) |
| Red / blue / yellow clock, cuckoo clock, invisible bonus | 140 / 163 / 330 / 100 / 327 | star (points; the All Stars medal counts them) |
| Paper | 283 | sheet (an extra throw) |
| Battery / helium balloon | 119 / 50 | battery |
| Rubber bands | 150 | bands |
| Foil | 83 | tape |
| Grease (left / right), sparkle, slider | 143 / 195 / 486 / 354 | dropped |
| Up / down stairs | 163 / 163 | stairs |
| Doors, windows (inside / outside, left / right) | 167 | openings |
| Mailbox (left / right), floor / ceiling transport, invisible transport, deluxe transport | 44 / 34 / 244 / 465 / 385 / 61 | transport (unlinked ones are the far ends, or dropped when nothing leads to them) |
| Light switch, machine switch, thermostat, power switch, knife switch | 113 / 79 / 108 / 78 / 230 | switch: a light's switch works that room's lights (any room), a blower's or a deluxe transport's switches it; switches for things Gliderama doesn't have are a switch plate (drawn, nothing to switch) |
| Invisible switch, trigger, large trigger | 635 / 239 / 81 | invisible switch where it switches something here; else dropped |
| Sound trigger | 122 | dropped |
| Ceiling light, fluorescent, track light / light bulb / table lamp | 160, 115, 81 / 252 / 70 | pendant lamp / pendant on a cord / desk lamp |
| Hip lamp, deco lamp (floor lamps) | 26 / 62 | no art: they only light the room |
| Invisible light | 1764 | lights the room |
| Toaster | 140 | toaster |
| Drip | 477 | drip |
| Fireplace | 33 | fireplace |
| Wall window | 195 | window |
| Mirror, Ozma picture / calendar, bulletin board | 667, 77 / 58, 38 | picture frame / poster |
| Flower, vase, flower box | 547, 158, 35 | plant (a flower in a vase is part of the vase's plant) |
| Rug | 81 | rug |
| Shredder, Mac Plus, guitar, TV, coffee maker, outlet, VCR, stereo, microwave, CD rack | 50, 74, 29, 80, 38, 100, 26, 36, 56, 63 | dropped (no art) |
| Balloon, helicopters, darts, ball, fish, cobweb | 500, 414, 268, 212, 120, 86 | dropped (enemies; no art) |
| Mouse hole, teddy bear, cloud, faucet, wind chimes | 174, 169, 1860, 28, 54 | dropped (no art; outdoor rooms draw their own clouds) |
| Custom picture (`customPict`) | 4782 | dropped (the house's own pictures; they colour the obstacles drawn where they were) |

### Prizes and the goal

As in Glider PRO, a house is finished by collecting every star (`goal: 'stars'`; the stars carry explicit ids
and the session completes the level on the last one). The other prizes become Gliderama's pickups. The Fun
House has no stars (it could not be finished in Glider PRO either): it is free flight (`goal: 'none'`).

### Start, sheets, par, texts

The plane starts where the glider does, facing right. A house gives a sheet per dozen rooms (6 to 25), but at
least half as many again as the bot pilot lost on its way, and a few; paper prizes add more. Par (the Swift
medal) is the bot pilot's time with a few seconds per throw and 30 % to spare. The intro is the house's
banner, the goal and the credit; the end card shows the house's trailer.

## Per-house status

<!-- status table: generated from the flight check -->

## Glider PRO objects without Gliderama art

<!-- missing art table: generated from the houses' meta.missingArt -->

## Approximations and known differences

- **Air** is weaker and wider than the original's columns, and a paper plane can't hover: some climbs that
  took patience in Glider PRO take skill here, and the original's narrow shafts are as wide as the invisible
  columns allow.
- **One opening per wall**: where a wall or floor had two openings, they become one spanning both, the wall
  between them a block. One-way doorways (open on one side only) are two-way.
- **Obstacles are visible**: Glider PRO's invisible obstacles stood for things drawn in the room's picture;
  without the picture they are drawn as plain blocks in its colour there.
- **Looks** come from the pictures' colours; the pictures themselves (and the rooms' own pictures,
  `customPict`) are not shown.
- **Enemies and appliances** are left out: balloons, helicopters, darts, balls, fish, the shredder, toasters
  that pop, outlets, the microwave... (the toaster is kept as a plain toaster). So are grease, sparkles, the
  slider and sound triggers. Switches that only worked those are switch plates.
- **Clocks and the invisible bonus** are stars that count for points (the All Stars medal), not the goal.
- **Transports** put the plane down gliding level where the original puts the glider; deluxe transports keep
  their on/off state and switch.
- **Lights**: a switch can work another room's lights; darkness follows the original's rule, but rooms are
  lit or dark as a whole.
- **Roofs** are stepped blocks, not slopes.
- **Fireplaces** add Gliderama's fire and its updraft.

## Overrides

`OVERRIDES` in `scripts/glider-map.mjs` takes per-room fixes (add / remove items, scale a room's air, change
exits), each with a note that ends up in the house's `meta.notes`. None are needed at present: every fix so far
has been a global one.
