/**
 * Glider PRO house parser: the data fork of a house file is the in-memory `houseType` written straight to disk
 * (Headers/GliderStructs.h), big-endian with 68k alignment (shorts on even offsets, no other padding):
 *
 *   houseType (866 bytes + 348 per room)
 *     0 version i16 (0x0200 for Glider PRO houses; < 0x0200 = Glider 4 era, another room-link encoding)
 *     2 unusedShort, 4 timeStamp i32 (bit 0 = locked), 8 flags i32 (bit 0 wardBit, bit 1 no phone,
 *       bit 2 hide the star count on the banner)
 *    12 initial Point (v, h): where the glider starts in the first room
 *    16 banner Str255 (the text on the opening banner), 272 trailer Str255 (shown when the house is finished)
 *   528 highScores (292), 820 savedGame (40), 860 hasGame, 861 unusedBoolean
 *   862 firstRoom i16 (index of the starting room), 864 nRooms i16, 866 rooms[nRooms]
 *
 *   roomType (348 bytes)
 *     0 name Str27, 28 bounds i16 (v2: custom-background bounds << 1, bit 5 = structure),
 *    30 leftStart u8, 31 rightStart u8 (glider entry heights), 32 unusedByte, 33 visited,
 *    34 background i16 (2000..2017 built in, >= 3000 a picture in the house's resource fork),
 *    36 tiles[8] i16 (which 64-px slice of the background picture fills each column),
 *    52 floor i16 (grows upward), 54 suite i16 (grows rightward; -1 = deleted room), 56 openings i16,
 *    58 numObjects i16, 60 objects[24]
 *
 *   objectType (12 bytes): what i16 + a 10-byte union whose layout depends on the object's family
 *     blower     topLeft Point, distance i16, initial u8, state u8, vector u8, tall u8
 *     furniture  bounds Rect (top, left, bottom, right), pict i16       (also clutter)
 *     bonus      topLeft Point, length i16, points i16, state u8, initial u8
 *     transport  topLeft Point, tall i16, where i16, who u8, wide u8
 *     switch     topLeft Point, delay i16, where i16, who u8, type u8
 *     light      topLeft Point, length i16, byte0 u8, byte1 u8, initial u8, state u8
 *     appliance  topLeft Point, height i16, byte0 u8, delay u8, initial u8, state u8
 *     enemy      topLeft Point, length i16, delay u8, byte0 u8, initial u8, state u8
 *
 * Links (switches, transports) name a room as `where` (v2: suite * 100 + floor + 8, see Sources/Link.c) and
 * an object slot in it as `who` (255 = not linked).
 */

import { macRoman } from './binhex.mjs';

/** Object ids (GliderDefines.h) with their union family. */
export const OBJECT_TYPES = {
  0x01: ['floorVent', 'blower'],
  0x02: ['ceilingVent', 'blower'],
  0x03: ['floorBlower', 'blower'],
  0x04: ['ceilingBlower', 'blower'],
  0x05: ['sewerGrate', 'blower'],
  0x06: ['leftFan', 'blower'],
  0x07: ['rightFan', 'blower'],
  0x08: ['taper', 'blower'],
  0x09: ['candle', 'blower'],
  0x0a: ['stubby', 'blower'],
  0x0b: ['tiki', 'blower'],
  0x0c: ['bbq', 'blower'],
  0x0d: ['invisBlower', 'blower'],
  0x0e: ['grecoVent', 'blower'],
  0x0f: ['sewerBlower', 'blower'],
  0x10: ['liftArea', 'blower'],
  0x11: ['table', 'furniture'],
  0x12: ['shelf', 'furniture'],
  0x13: ['cabinet', 'furniture'],
  0x14: ['filingCabinet', 'furniture'],
  0x15: ['wasteBasket', 'furniture'],
  0x16: ['milkCrate', 'furniture'],
  0x17: ['counter', 'furniture'],
  0x18: ['dresser', 'furniture'],
  0x19: ['deckTable', 'furniture'],
  0x1a: ['stool', 'furniture'],
  0x1b: ['trunk', 'furniture'],
  0x1c: ['invisObstacle', 'furniture'],
  0x1d: ['manhole', 'furniture'],
  0x1e: ['books', 'furniture'],
  0x1f: ['invisBounce', 'furniture'],
  0x21: ['redClock', 'bonus'],
  0x22: ['blueClock', 'bonus'],
  0x23: ['yellowClock', 'bonus'],
  0x24: ['cuckoo', 'bonus'],
  0x25: ['paper', 'bonus'],
  0x26: ['battery', 'bonus'],
  0x27: ['bands', 'bonus'],
  0x28: ['greaseRt', 'bonus'],
  0x29: ['greaseLf', 'bonus'],
  0x2a: ['foil', 'bonus'],
  0x2b: ['invisBonus', 'bonus'],
  0x2c: ['star', 'bonus'],
  0x2d: ['sparkle', 'bonus'],
  0x2e: ['helium', 'bonus'],
  0x2f: ['slider', 'bonus'],
  0x31: ['upStairs', 'transport'],
  0x32: ['downStairs', 'transport'],
  0x33: ['mailboxLf', 'transport'],
  0x34: ['mailboxRt', 'transport'],
  0x35: ['floorTrans', 'transport'],
  0x36: ['ceilingTrans', 'transport'],
  0x37: ['doorInLf', 'transport'],
  0x38: ['doorInRt', 'transport'],
  0x39: ['doorExRt', 'transport'],
  0x3a: ['doorExLf', 'transport'],
  0x3b: ['windowInLf', 'transport'],
  0x3c: ['windowInRt', 'transport'],
  0x3d: ['windowExRt', 'transport'],
  0x3e: ['windowExLf', 'transport'],
  0x3f: ['invisTrans', 'transport'],
  0x40: ['deluxeTrans', 'transport'],
  0x41: ['lightSwitch', 'switch'],
  0x42: ['machineSwitch', 'switch'],
  0x43: ['thermostat', 'switch'],
  0x44: ['powerSwitch', 'switch'],
  0x45: ['knifeSwitch', 'switch'],
  0x46: ['invisSwitch', 'switch'],
  0x47: ['trigger', 'switch'],
  0x48: ['lgTrigger', 'switch'],
  0x49: ['soundTrigger', 'switch'],
  0x51: ['ceilingLight', 'light'],
  0x52: ['lightBulb', 'light'],
  0x53: ['tableLamp', 'light'],
  0x54: ['hipLamp', 'light'],
  0x55: ['decoLamp', 'light'],
  0x56: ['flourescent', 'light'],
  0x57: ['trackLight', 'light'],
  0x58: ['invisLight', 'light'],
  0x61: ['shredder', 'appliance'],
  0x62: ['toaster', 'appliance'],
  0x63: ['macPlus', 'appliance'],
  0x64: ['guitar', 'appliance'],
  0x65: ['tv', 'appliance'],
  0x66: ['coffee', 'appliance'],
  0x67: ['outlet', 'appliance'],
  0x68: ['vcr', 'appliance'],
  0x69: ['stereo', 'appliance'],
  0x6a: ['microwave', 'appliance'],
  0x6b: ['cinderBlock', 'appliance'],
  0x6c: ['flowerBox', 'appliance'],
  0x6d: ['cds', 'appliance'],
  0x6e: ['customPict', 'appliance'],
  0x71: ['balloon', 'enemy'],
  0x72: ['copterLf', 'enemy'],
  0x73: ['copterRt', 'enemy'],
  0x74: ['dartLf', 'enemy'],
  0x75: ['dartRt', 'enemy'],
  0x76: ['ball', 'enemy'],
  0x77: ['drip', 'enemy'],
  0x78: ['fish', 'enemy'],
  0x79: ['cobweb', 'enemy'],
  0x81: ['ozma', 'clutter'],
  0x82: ['mirror', 'clutter'],
  0x83: ['mousehole', 'clutter'],
  0x84: ['fireplace', 'clutter'],
  0x85: ['flower', 'clutter'],
  0x86: ['wallWindow', 'clutter'],
  0x87: ['bear', 'clutter'],
  0x88: ['calendar', 'clutter'],
  0x89: ['vase1', 'clutter'],
  0x8a: ['vase2', 'clutter'],
  0x8b: ['bulletin', 'clutter'],
  0x8c: ['cloud', 'clutter'],
  0x8d: ['faucet', 'clutter'],
  0x8e: ['rug', 'clutter'],
  0x8f: ['chimes', 'clutter'],
};

/** Built-in backgrounds (kBaseBackgroundID + n). */
export const BACKGROUNDS = {
  2000: 'simpleRoom',
  2001: 'paneledRoom',
  2002: 'basement',
  2003: 'childsRoom',
  2004: 'asianRoom',
  2005: 'unfinishedRoom',
  2006: 'swingersRoom',
  2007: 'bathroom',
  2008: 'library',
  2009: 'garden',
  2010: 'skywalk',
  2011: 'dirt',
  2012: 'meadow',
  2013: 'field',
  2014: 'roof',
  2015: 'sky',
  2016: 'stratosphere',
  2017: 'stars',
};

export const HOUSE_HEADER = 866;
export const ROOM_SIZE = 348;
export const MAX_ROOM_OBJECTS = 24;

const i16 = (b, o) => {
  const v = (b[o] << 8) | b[o + 1];
  return v >= 0x8000 ? v - 0x10000 : v;
};
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3] | 0;
const pstr = (b, o, max) => macRoman(b.subarray(o + 1, o + 1 + Math.min(b[o], max)));
const point = (b, o) => ({ v: i16(b, o), h: i16(b, o + 2) });
const rect = (b, o) => ({ top: i16(b, o), left: i16(b, o + 2), bottom: i16(b, o + 4), right: i16(b, o + 6) });

/** Decode one 12-byte objectType. Returns null for an empty slot (what = -1 or 0). */
export function parseObject(b, o) {
  const what = i16(b, o);
  if (what <= 0) return null;
  const [type, family] = OBJECT_TYPES[what] ?? [`unknown${what}`, 'unknown'];
  const d = o + 2;
  const base = { what, type, family };
  switch (family) {
    case 'blower':
      return { ...base, topLeft: point(b, d), distance: i16(b, d + 4), initial: !!b[d + 6], state: !!b[d + 7], vector: b[d + 8], tall: b[d + 9] };
    case 'furniture':
    case 'clutter':
      return { ...base, bounds: rect(b, d), pict: i16(b, d + 8) };
    case 'bonus':
      return { ...base, topLeft: point(b, d), length: i16(b, d + 4), points: i16(b, d + 6), state: !!b[d + 8], initial: !!b[d + 9] };
    case 'transport':
      return { ...base, topLeft: point(b, d), tall: i16(b, d + 4), where: i16(b, d + 6), who: b[d + 8], wide: b[d + 9] };
    case 'switch':
      return { ...base, topLeft: point(b, d), delay: i16(b, d + 4), where: i16(b, d + 6), who: b[d + 8], switchType: b[d + 9] };
    case 'light':
      return { ...base, topLeft: point(b, d), length: i16(b, d + 4), byte0: b[d + 6], byte1: b[d + 7], initial: !!b[d + 8], state: !!b[d + 9] };
    case 'appliance':
      return { ...base, topLeft: point(b, d), height: i16(b, d + 4), byte0: b[d + 6], delay: b[d + 7], initial: !!b[d + 8], state: !!b[d + 9] };
    case 'enemy':
      return { ...base, topLeft: point(b, d), length: i16(b, d + 4), delay: b[d + 6], byte0: b[d + 7], initial: !!b[d + 8], state: !!b[d + 9] };
    default:
      return { ...base, raw: Array.from(b.subarray(d, d + 10)) };
  }
}

/** Decode a room-link `where` into { floor, suite } (Sources/Link.c ExtractFloorSuite), or null if unlinked. */
export function extractFloorSuite(where, houseVersion) {
  if (where === -1) return null;
  if (houseVersion < 0x0200) return { floor: Math.trunc(where / 100) - 8, suite: where % 100 };
  return { suite: Math.trunc(where / 100), floor: (where % 100) - 8 };
}

/** Parse a house data fork. Deleted rooms (suite = -1) are kept with `deleted: true` so object/room indices stay valid. */
export function parseHouse(data) {
  if (data.length < HOUSE_HEADER) throw new Error(`house data is too short (${data.length} bytes)`);
  const nRooms = i16(data, 864);
  if (data.length < HOUSE_HEADER + nRooms * ROOM_SIZE)
    throw new Error(`house data holds ${data.length} bytes, ${nRooms} rooms need ${HOUSE_HEADER + nRooms * ROOM_SIZE}`);
  const house = {
    version: i16(data, 0),
    timeStamp: i32(data, 4),
    flags: i32(data, 8),
    initial: point(data, 12),
    banner: pstr(data, 16, 255),
    trailer: pstr(data, 272, 255),
    hasGame: !!data[860],
    firstRoom: i16(data, 862),
    nRooms,
    rooms: [],
  };
  for (let r = 0; r < nRooms; r++) {
    const o = HOUSE_HEADER + r * ROOM_SIZE;
    const room = {
      index: r,
      name: pstr(data, o, 27),
      bounds: i16(data, o + 28),
      leftStart: data[o + 30],
      rightStart: data[o + 31],
      background: i16(data, o + 34),
      tiles: Array.from({ length: 8 }, (_, k) => i16(data, o + 36 + k * 2)),
      floor: i16(data, o + 52),
      suite: i16(data, o + 54),
      openings: i16(data, o + 56),
      numObjects: i16(data, o + 58),
      objects: [],
      deleted: false,
    };
    room.deleted = room.suite === -1;
    for (let k = 0; k < MAX_ROOM_OBJECTS; k++) {
      const ob = parseObject(data, o + 60 + k * 12);
      // keep the slot number: switches and transports link to objects by slot
      if (ob) room.objects.push({ slot: k, ...ob });
    }
    house.rooms.push(room);
  }
  return house;
}
