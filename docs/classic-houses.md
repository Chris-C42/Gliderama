# Classic Houses

The *Classic Houses* place of the campaign holds the 22 houses that ship with **Glider PRO** (John Calhoun,
Casady & Greene 1994; source, graphics and houses released under the GNU GPL v2 at
<https://github.com/softdorothy/GliderPRO>). They are converted from the original house files into Gliderama
levels: the rooms keep their layout and the way they connect, and each object becomes the closest thing
Gliderama has, or is left out (and listed). Every house is open from the start, and, as in Glider PRO, a house
is finished by collecting all of its stars. The authors are credited on each house's card, in its intro and in
`CREDITS.md`.

Glider PRO's own pieces are drawn the Gliderama way: its enemies and hazards (balloons, helicopters, darts,
the bouncing ball, the goldfish, cobwebs, outlets, the shredder: `src/game/objects/enemies.ts`, still parts in
`src/world/kinds/gliderpro.ts`), its appliances, furniture, clutter and fittings (`src/world/kinds/appliances.ts`,
`furnishings.ts`, `fixtures.ts`, `outdoor.ts`, `gliderpro.ts`). The few things still without art of their own are
drawn as the nearest thing Gliderama has, and listed at the end
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
status. The houses add up to about 2.5 MB of JSON (about 330 KB gzipped), so they are kept out of the PWA's
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
Blocks at a room's edge (invisible obstacles there, the walls between two openings) carry on 40 px past it, as
the room's own walls do: no slit is left between a block and the edge, and no seam where two rooms meet.

### Rooms and the ways between them

| Glider PRO | Gliderama |
|---|---|
| Room walls: tiles 0 / 7 of the built-in rooms, the `bnds` code of custom backgrounds; garden, field, stratosphere, stars open both sides | Side exits (one span per side). Either room's open wall lets the plane through, as in the original (`CheckEscapeLeft/Right`), so one-way doorways are two-way here |
| Doors and windows (`doorIn/Ex`, `windowIn/Ex`) | Openings in the side wall at their hot spots (240 px of a door, 44 px of a window, in the original's pixels) |
| Open floors: sky backgrounds, dirt tunnels (tiles 2–3 down, 5–6 up), manholes | Floor / ceiling exits over those x ranges |
| Two openings in one wall or floor | One exit spanning both, the wall between them a block |
| Invisible obstacles along an open edge (houses wall off their sky rooms with them) | The opening is closed there: what is left of it (a gap the glider fits through) is the exit, or there is none |
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
| The same standing on furniture | its grille there (`grille`), invisible rising `current` from it |
| A column that reaches the ceiling under an opening | carries on into the room above (a vent's reach is −40; an invisible column starts 40 px above the room, so it is at full strength up to the opening) |
| Ceiling vent, ceiling blower | `ceilingVent`, 2.6 m/s down to the column's end |
| Left / right fan | `fan`, 3.4 m/s, reach = the original's distance |
| Candle, taper, stubby candle, tiki torch, barbecue | `candle`, `tiki`, `bbq` (each burns with a candle's flame) and, where the original's heat column is 64 px or more, rising air above the flame's deadly part |
| Invisible blower (up / down / left / right) | invisible `current`: columns 140 px wide (the original's are 4 px, but the glider is 48 wide), bands 46 px high, centred where the original's are (a column at a wall reaches past it) |
| Lift area | invisible `current` over its rectangle (at least 140 px wide, or 46 px high for sideways air); rising air up to the ceiling carries on through an opening there |
| Blowers that start off | off until their switch is flipped (switch group `!g`); ones no switch turns on are left out |

### Objects

Counts are over all 22 houses. Things of a fixed size stand where the original's stand, on the floor line when
the original stands on the floor; furniture and clutter are drawn over the original's rectangle.

| Glider PRO object | Count | Gliderama |
|---|---:|---|
| Floor vent / floor blower / sewer grate / Greco vent / sewer blower | 1458 / 83 / 507 / 116 / 191 | floor vent with the original's kind of grille (a register, a blower unit, an iron grate, a brass Greco register); see Air |
| Ceiling vent / ceiling blower | 28 / 12 | ceiling vent (the blower has no art of its own) |
| Left fan / right fan | 45 / 54 | fan |
| Taper / candle / stubby | 90 / 180 / 127 | candle (+ rising air) |
| Tiki torch / barbecue | 58 / 43 | bamboo torch, its pole down to the ground / kettle barbecue, each with a candle's flame (+ rising air) |
| Invisible blower / lift area | 2336 / 716 | invisible current |
| Table / deck table / stool | 170 / 30 / 91 | pedestal table (a slatted top for the deck table) / stool: the original's rectangle is the top, the pedestal goes down to the floor as it does there |
| Shelf / books | 389 / 210 | shelf / stacks of books |
| Cabinet / filing cabinet / counter / dresser | 457 / 107 / 287 / 122 | cupboard / steel filing cabinet / kitchen counter / dresser |
| Waste basket / milk crate / trunk | 103 / 252 / 101 | waste basket / milk crate / steamer trunk |
| Invisible obstacle / invisible bounce | 666 / 1670 | solid block, drawn in the colour the original picture has there (they stood for walls, pipes and ledges drawn in it) |
| Manhole | 40 | opening in the floor |
| Star | 69 | goal star (all of them finish the house) |
| Red / blue / yellow clock, cuckoo clock | 140 / 163 / 330 / 100 | alarm clocks in the three colours and a cuckoo clock, collected like stars (points; the All Stars medal counts them) |
| Invisible bonus | 327 | star (points) |
| Paper | 283 | sheet (an extra throw) |
| Battery / helium balloon | 119 / 50 | battery (the helium balloon has no art of its own) |
| Rubber bands | 150 | bands |
| Foil | 83 | tape (no art of its own) |
| Grease (left / right) | 143 / 195 | grease can that tips over when clipped and spills a slick its original length (harmless), or when a switch or trigger wired to it goes; the 104 that start spilt in the original lie spilt |
| Sparkle | 486 | a glint that twinkles every second or two |
| Slider | 354 | dropped (an invisible slippery surface) |
| Up / down stairs | 163 / 163 | stairs |
| Doors, windows (inside / outside, left / right) | 167 | openings |
| Mailbox (left / right) | 44 / 34 | a mailbox on its post, its door open on the side it faces, and the transport in it |
| Floor / ceiling transport, invisible transport, deluxe transport | 244 / 465 / 385 / 61 | transport (unlinked ones are the far ends, or dropped when nothing leads to them) |
| Light switch, machine switch, thermostat, power switch, knife switch | 113 / 79 / 108 / 78 / 230 | switch, drawn as the original (toggle, rocker, dial, button, knife switch). It works a room's lights (any room's), a blower, a deluxe transport, an enemy, an outlet or a shredder, and spills a grease can; a switch for anything else flips but does nothing here |
| Invisible switch | 635 | invisible switch, where it works one of those; else dropped |
| Trigger, large trigger | 239 / 81 | a trigger fires what it is linked to after its delay (a tenth of a second a step: Nemo's Market's "8 Second Shopping Spree" gives the glider 8 s in the room before it is whisked away), if the plane is still in the room then; set off again each time the plane comes through. Linked to a switch: an invisible switch that does that switch's job after the delay; linked to a grease can, one that spills it. Linked to an enemy, an outlet, a guitar, a toaster or a drip: dropped (they go off by themselves here) |
| Sound trigger | 122 | dropped |
| Ceiling light / light bulb / table lamp | 160 / 252 / 70 | pendant lamp / pendant on a cord / desk lamp |
| Fluorescent / track light | 115 / 81 | fluorescent tube / track of spotlights under the ceiling |
| Hip lamp / deco lamp | 26 / 62 | floor lamp: a torchiere / a fringed shade (on the room's light switch, like every lamp) |
| Invisible light | 1764 | lights the room |
| Toaster | 140 | toaster (its toast does not pop) |
| Mac Plus / TV / microwave / VCR / stereo / coffee maker / CD rack | 74 / 80 / 56 / 26 / 36 / 38 / 63 | computer / television (their screens lit when the original's start on) / microwave / VCR / stereo / coffee maker / CD rack, solid |
| Cinder block / flower box | 43 / 35 | cinder block / window box of flowers |
| Shredder | 50 | paper shredder: flying low over its slot while it is on shreds the plane; as in Glider PRO it is nothing to bump into (switched off, the plane flies through it: Land of Illusion's shaft of four) |
| Outlet | 100 | wall outlet sparking for a second every `delay`: it hurts |
| Guitar / wind chimes | 29 / 54 | guitar that strums, wind chimes that ring when the plane brushes them; as in Glider PRO, the plane flies through a guitar (Slumberland's way on goes past one) |
| Balloon | 500 | balloon rising from the floor to the ceiling, again after `delay` |
| Helicopter (left / right) | 259 / 155 | toy helicopter flying down across the room from under the ceiling |
| Dart (left / right) | 151 / 117 | paper dart sailing across from the wall behind it at the original's height |
| Ball | 212 | ball bouncing as high as the original's |
| Fish | 120 | goldfish in its bowl, leaping as high as the original's every `delay` |
| Cobweb | 86 | cobweb that catches the plane and holds it a moment |
| Drip | 477 | drip |
| Fireplace / wall window / rug | 33 / 195 / 81 | fireplace / window / rug |
| Mirror / Ozma picture | 667 / 77 | wall mirror / a picture frame (the Ozma picture has no art of its own) |
| Calendar / bulletin board | 58 / 38 | wall calendar / cork board with notes |
| Mouse hole / teddy bear / cloud / faucet | 174 / 169 / 1860 / 28 | mouse hole in the skirting / teddy bear / cloud / tap |
| Flower, vase | 547, 158 | plant (no art of their own; a flower in a vase is part of the vase's plant) |
| *Scenery* | | the lamps, pictures, plants, windows, the teddy bear and the fireplace are nothing to bump into, as in Glider PRO (it gives them nothing the glider touches): the Gliderama kinds that are solid in its own rooms are marked `solid: false` |
| Custom picture (`customPict`) | 4782 | dropped (the house's own pictures; they colour the obstacles drawn where they were) |

**What moves or sparks** (balloons, helicopters, darts, balls, fish, outlets) starts where Glider PRO's does, at
its speed (`Sources/Dynamics*.c` scaled to Gliderama's rooms) and after its delay (the original counts tenths of a
second), from the moment the plane comes into the room. Touching one crumples the plane (a second knock is
usually the end of it); a rubber band brings a balloon, a helicopter or a dart down. As with the blowers, a thing
that starts switched off follows its switch; balloons, helicopters, darts and drips that start off and that no
switch turns on are left out (ball, fish, outlet and shredder stay, idle).

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

The flight check (`tests/classicReport.test.ts`) flies every house with the bot pilot
(`tests/helpers/houseSolver.ts`) in the Simple Glider: a beam search over stick input, towards the nearest star
still to find. It plans its way on the parts of the rooms a plane can fly between (each room's free space on an
8 px grid: a shelf across a room, the walls of a maze or the wall between two shafts split it; switched shredders
filling a passage make a way through that opens once they are all off), and inside a part it steers round what is
in the way. When the way to a star is shut or needs air that is switched off (a switched transport, a climb out
through a ceiling, a star high up over a switched blower), it plans the switches on the way (the cheapest route over
rooms and switch states, up to four switches deep; failing that, the nearest switch for something that shuts the
way) and flies to the first of them; a switch it went for stays as it left it (a flight that flips it back is
given up), and a star with no way on from it to the others (a room with no way out) is left for last. A house it
does not finish that way it flies again trying each star itself first, the switches only once the stars got
nowhere; the better of the two counts. It throws as a player can: level, up, or steeply down (aiming with the
mouse), and where things move about it may wait a second or two to time a throw past them. The menagerie flies
alongside, from the moment the plane comes into its room (the game makes a room's things afresh then; the play lab's
autopilot makes the room afresh before each throw, and waits as long as the plan does, as the plans assume), and
touching anything that hurts ends a flight; a star touched as the plane is lost still counts, as in the game.
*Finished* means the bot collected every star, so a player with the same controls can. A house it does not finish
may well be flyable: Glider PRO's tricks (hanging still in a column, quick switch timing, long detours for a switch)
are hard for a paper plane and harder for a search; where it got stuck is given. The bot finishes 20 of the 21
houses that have stars (the Fun House has none); Land of Illusion's last star is out of reach here (see **Helium**
below). The play lab's autopilot also flew, in the real game in the browser, the stretches the bot once got stuck
on in Castle o' the Air (Castletop), Davis Station (the silo), Rainbow's End (the way to its second star), Land of
Illusion (the dollhouse) and Slumberland (the way to its third star), and SpacePods, the Demo House and The
Asylum Pro from start to finish.

| House | Authors | Rooms | Objects mapped / dropped | Stars | Flight check (bot pilot) | Par |
|---|---|---:|---:|---:|---|---:|
| Demo House | John Calhoun & Kim Money | 45 | 129 / 9 | 1 | **finished**: the star, through 13 rooms; 36 s of flying, no sheet lost | 60 s |
| Sampler | — | 2 | 11 / 0 | 1 | **finished**: the star, through 1 room; 2 s of flying, no sheet lost | 15 s |
| California or Bust! | — | 16 | 222 / 86 | 1 | **finished**: the star, through 14 rooms; 55 s of flying, no sheet lost | 80 s |
| Fun House | — | 43 | 348 / 58 | 0 | no stars to find (free flight); the house has no stars, as in Glider PRO | — |
| Castle o' the Air | John Calhoun | 85 | 612 / 8 | 4 | **finished**: all 4 stars, through 31 rooms; 189 s of flying, 3 sheets lost | 280 s |
| Empty House | — | 35 | 78 / 0 | 1 | **finished**: the star, through 12 rooms; 38 s of flying, no sheet lost | 60 s |
| Davis Station | Jonathan Chin (alias Paul Finn) & John Calhoun | 65 | 511 / 80 | 4 | **finished**: all 4 stars, through 43 rooms; 232 s of flying, 12 sheets lost | 405 s |
| In The Mirror | Jonathan Chin (alias Paul Finn) | 97 | 729 / 66 | 1 | **finished**: the star, through 24 rooms; 82 s of flying, 1 sheet lost | 125 s |
| Art Museum | — | 109 | 476 / 93 | 6 | **finished**: all 6 stars, through 48 rooms; 224 s of flying, 4 sheets lost | 330 s |
| Nemo's Market | Ward Hartenstein | 124 | 456 / 380 | 5 | **finished**: all 5 stars, through 32 rooms; 219 s of flying, 8 sheets lost | 355 s |
| Metropolis | Jonathan Chin (alias Paul Finn) & John Calhoun | 127 | 730 / 79 | 4 | **finished**: all 4 stars, through 39 rooms; 202 s of flying, 6 sheets lost | 320 s |
| The Asylum Pro | Steve Sullivan | 140 | 1023 / 73 | 1 | **finished**: the star, through 15 rooms; 60 s of flying, 1 sheet lost | 95 s |
| Grand Prix | Jonathan Chin (alias Paul Finn) | 175 | 1232 / 49 | 3 | **finished**: all 3 stars, through 49 rooms; 219 s of flying, 2 sheets lost | 310 s |
| CD Demo House | John Calhoun & Kim Money | 206 | 866 / 667 | 9 | **finished**: all 9 stars, through 51 rooms; 689 s of flying, 36 sheets lost | 1185 s |
| Titanic | Jonathan Chin (alias Paul Finn) & John Calhoun | 208 | 1259 / 115 | 1 | **finished**: the star, through 21 rooms; 80 s of flying, 6 sheets lost | 160 s |
| Rainbow's End | Ward Hartenstein | 223 | 1595 / 78 | 5 | **finished**: all 5 stars, through 63 rooms; 400 s of flying, 8 sheets lost | 590 s |
| ImagineHouse PRO II | Jonathan Chin (alias Paul Finn) | 279 | 1758 / 56 | 3 | **finished**: all 3 stars, through 39 rooms; 146 s of flying, 7 sheets lost | 255 s |
| Land of Illusion | Ward Hartenstein | 303 | 1627 / 189 | 5 | 4 of 5 stars, through 65 rooms; stuck in "Transformation" (62,-9), 7 rooms from the next star; 638 s of flying, 24 sheets lost; the last star is seven rooms up, a climb made on helium in Glider PRO, with no rising air here | — |
| Slumberland | John Calhoun (first house and top of fourth house), Jonathan Chin (second house), Steve Sullivan (third house), Ward Hartenstein (bottom of fourth house) | 383 | 2954 / 42 | 6 | **finished**: all 6 stars, through 124 rooms; 626 s of flying, 33 sheets lost | 1080 s |
| SpacePods | Ward Hartenstein | 402 | 2962 / 2878 | 1 | **finished**: the star, through 11 rooms; 61 s of flying, 5 sheets lost | 130 s |
| Leviathan | Jonathan Chin (alias Paul Finn) | 472 | 3163 / 172 | 6 | **finished**: all 6 stars, through 150 rooms; 963 s of flying, 27 sheets lost | 1470 s |
| Teddy World | Shawn Brenneman | 531 | 2958 / 563 | 1 | **finished**: the star, through 7 rooms; 23 s of flying, no sheet lost | 40 s |

## Glider PRO objects without Gliderama art

Everything else Glider PRO places in its rooms has Gliderama art of its own (or is invisible: invisible obstacles,
blowers, switches, lights, bonuses). These are still drawn as something else, over all 22 houses (from each
house's `meta.missingArt`):

| Glider PRO object | Count | Here | Houses (count) |
|---|---:|---|---|
| `flower` | 547 | drawn as plant (455); in a vase: part of the vase plant (92) | Rainbow's End 117, Slumberland 86, Teddy World 75, Davis Station 55, CD Demo House 34, Leviathan 33, California or Bust! 25, The Asylum Pro 24, ImagineHouse PRO II 19, Demo House 16, Art Museum 15, Land of Illusion 14, Titanic 12, In The Mirror 7, Grand Prix 7, Castle o' the Air 4, Metropolis 4 |
| `vase2` | 86 | drawn as plant | Leviathan 18, The Asylum Pro 10, Rainbow's End 10, ImagineHouse PRO II 10, Slumberland 9, Teddy World 8, Titanic 4, California or Bust! 3, Art Museum 3, Davis Station 2, Metropolis 2, Grand Prix 2, CD Demo House 2, Demo House 1, Castle o' the Air 1, In The Mirror 1 |
| `foil` | 83 | drawn as tape | In The Mirror 37, Slumberland 8, Leviathan 8, Teddy World 7, ImagineHouse PRO II 6, Art Museum 4, Titanic 3, Fun House 2, Nemo's Market 2, Rainbow's End 2, California or Bust! 1, Castle o' the Air 1, Metropolis 1, The Asylum Pro 1 |
| `ozma` | 77 | drawn as frame | Slumberland 17, Teddy World 16, Leviathan 12, ImagineHouse PRO II 9, CD Demo House 5, Land of Illusion 4, Fun House 3, The Asylum Pro 3, California or Bust! 2, In The Mirror 2, Titanic 2, Davis Station 1, Art Museum 1 |
| `vase1` | 72 | drawn as plant | Leviathan 15, Rainbow's End 14, Teddy World 13, Titanic 6, Slumberland 6, In The Mirror 4, Fun House 2, Davis Station 2, Art Museum 2, ImagineHouse PRO II 2, Demo House 1, California or Bust! 1, Castle o' the Air 1, The Asylum Pro 1, Grand Prix 1, CD Demo House 1 |
| `helium` | 50 | drawn as battery | Land of Illusion 14, Leviathan 6, In The Mirror 5, ImagineHouse PRO II 5, Metropolis 4, SpacePods 4, Grand Prix 3, CD Demo House 2, Titanic 2, Rainbow's End 2, Davis Station 1, Art Museum 1, Nemo's Market 1 |
| `ceilingBlower` | 12 | drawn as a ceiling vent | Leviathan 3, Grand Prix 2, ImagineHouse PRO II 2, In The Mirror 1, Metropolis 1, CD Demo House 1, Rainbow's End 1, Slumberland 1 |

Not drawn at all: the houses' own pictures (`customPict`, 4782 of them), which Gliderama does not show.

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
- **Enemies and hazards** move as in the original and hurt the Gliderama way (a knock crumples the plane, the
  shredder shreds it, a cobweb holds it a moment). Triggers set off only switches and grease: what else they were
  linked to goes off on its own timer. The toaster's toast doesn't pop, the microwave doesn't take gadgets away,
  and switches for appliances (TV, stereo, microwave, toaster...) flip without effect. Bonuses that an invisible
  switch took away in the original stay. The slider and sound triggers are left out.
- **Switches** flip once each time the plane goes through them (as the original's).
- **Clocks and the invisible bonus** are stars that count for points (the All Stars medal), not the goal.
- **Helium**: in Glider PRO a helium canister lets the glider float straight up while the battery key is held
  (5 s a canister, 4 px a frame); here it is drawn as a battery and gives a boost charge, for planes with the
  battery gadget. Land of Illusion's last seven rooms ("Transformation" up to "Final Reward"), climbed on four
  canisters in the original, have no rising air at all, so its last star can't be reached here.
- **Transports** put the plane down gliding level where the original puts the glider; deluxe transports keep
  their on/off state and switch.
- **Lights**: a switch can work another room's lights; darkness follows the original's rule, but rooms are
  lit or dark as a whole (every lamp in a room is on its light switch).
- **Roofs** are stepped blocks, not slopes.
- **Fireplaces** add Gliderama's fire and its updraft (the fireplace itself is scenery: a plane can fly into its
  hearth, as Leviathan's way on does, through a transport there).

## Overrides

`OVERRIDES` in `scripts/glider-map.mjs` takes per-room fixes (add / remove items, scale a room's air, change
exits), each with a note that ends up in the house's `meta.notes`. None are needed at present: every fix so far
has been a global one.
