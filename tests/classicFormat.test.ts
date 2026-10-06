/**
 * The Glider PRO house pipeline (scripts/): BinHex 4.0 decoding with its CRCs, the house data fork parser, and
 * the converter, which must reproduce the committed Demo House exactly (so the data is never stale).
 * Fixtures from the Glider PRO release (GPL v2): Sampler.binhex as shipped, the Demo House's data fork, its 'bnds'
 * resources and the summary of its pictures (the resource fork itself is 650 KB of pictures and sounds), and one
 * small picture of its own, "Soup Can". `node scripts/convert-glider-houses.mjs <GliderPRO> "Demo House" --fixtures`
 * writes the Demo House ones again.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BinHexError, crc16, decodeBinHex, parseResourceFork } from '../scripts/glider/binhex.mjs';
import { extractFloorSuite, parseHouse, type GPObject } from '../scripts/glider/house.mjs';
import { flipped, merge, obstacleWalls, subtract } from '../scripts/glider-map.mjs';
import { colourStats, decodePict } from '../scripts/glider/pict.mjs';
import { parseRez } from '../scripts/glider/rez.mjs';
import { convertHouse } from '../scripts/convert-glider-houses.mjs';

const FIX = path.join(__dirname, 'fixtures/glider');
const sampler = () => fs.readFileSync(path.join(FIX, 'Sampler.binhex'), 'latin1');
const demoData = () => new Uint8Array(fs.readFileSync(path.join(FIX, 'demo-house.dat')));

describe('BinHex 4.0', () => {
  it('computes CRC-16/XMODEM, as BinHex does', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x31c3);
    expect(crc16(new Uint8Array(0))).toBe(0);
  });

  it('decodes a house file: header, forks and their CRCs', () => {
    const f = decodeBinHex(sampler());
    expect(f.name).toBe('Sampler');
    expect(f.type).toBe('gliH');
    expect(f.creator).toBe('ozm5');
    expect(f.data.length).toBe(1564);
    expect(f.rsrc.length).toBe(286);
    expect(f.crcOk).toEqual({ header: true, data: true, rsrc: true });
    // a Glider PRO house: version 2.0, two rooms of 348 bytes after the 866-byte header
    expect((f.data[0] << 8) | f.data[1]).toBe(0x0200);
    const h = parseHouse(f.data);
    expect(h.nRooms).toBe(2);
    expect(h.banner).toBe("Welcome to Omid's Happy Home.");
    expect(f.data.length).toBeGreaterThanOrEqual(866 + 2 * 348);
    expect(parseResourceFork(f.rsrc)).toBeTypeOf('object');
  });

  it('rejects a damaged file', () => {
    const text = sampler();
    const at = text.indexOf(':') + 200;
    // swap one data character for another valid BinHex digit
    const bad = text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1);
    expect(() => decodeBinHex(bad)).toThrow(BinHexError);
    expect(decodeBinHex(bad, { lenient: true }).crcOk.data && decodeBinHex(bad, { lenient: true }).crcOk.header).toBe(false);
    expect(() => decodeBinHex('no colons here')).toThrow(BinHexError);
  });
});

describe('house data fork', () => {
  it('reads the Demo House header', () => {
    const h = parseHouse(demoData());
    expect(h.version).toBe(0x0200);
    expect(h.nRooms).toBe(45);
    expect(h.rooms.filter((r) => !r.deleted).length).toBe(45);
    expect(h.firstRoom).toBe(0);
    expect(h.initial).toEqual({ v: 107, h: 49 });
    expect(h.banner.startsWith('Welcome to the Demo House!\r')).toBe(true);
    expect(h.banner).toContain('(house by Kim Money)');
    expect(h.trailer.startsWith('Excellent!')).toBe(true);
  });

  it("reads a room and its objects (the Demo House's first room)", () => {
    const r = parseHouse(demoData()).rooms[0];
    expect(r.name).toBe('Air Vents');
    expect({ floor: r.floor, suite: r.suite, background: r.background }).toEqual({ floor: 1, suite: 63, background: 3000 });
    expect(r.tiles).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(r.numObjects).toBe(10);
    expect(r.objects.map((o) => o.type)).toEqual([
      'floorVent',
      'dresser',
      'redClock',
      'floorVent',
      'wallWindow',
      'floorVent',
      'vase2',
      'flower',
      'ceilingLight',
      'customPict',
    ]);
    expect(r.objects[0]).toMatchObject({ slot: 0, family: 'blower', topLeft: { v: 305, h: 171 }, distance: 269, initial: true });
    expect(r.objects[1]).toMatchObject({ family: 'furniture', bounds: { top: 154, left: 217, bottom: 293, right: 341 } });
  });

  it('reads the star, the stairs and the links', () => {
    const h = parseHouse(demoData());
    const stars = h.rooms.flatMap((r) => r.objects.filter((o) => o.type === 'star').map((o) => ({ room: r.name, ...o.topLeft })));
    expect(stars).toEqual([{ room: 'Grande Recompense', v: 159, h: 244 }]);
    const where = h.rooms.find((r) => r.name === 'Where To Go?')!;
    expect(where.objects.find((o) => o.type === 'upStairs')?.topLeft).toEqual({ v: 28, h: 322 });
    // a switch names its room as suite * 100 + floor + 8 (Sources/Link.c)
    const sw = h.rooms.find((r) => r.name === 'Switches & Candles')!.objects.find((o) => o.type === 'machineSwitch')!;
    expect(sw.where).toBe(6509);
    expect(extractFloorSuite(sw.where!, h.version)).toEqual({ suite: 65, floor: 1 });
    expect(extractFloorSuite(-1, h.version)).toBeNull();
  });
});

describe('pictures', () => {
  it('decodes a PICT (version 2, packed 8-bit pixel map)', () => {
    const img = decodePict(new Uint8Array(fs.readFileSync(path.join(FIX, 'soup-can.pict'))))!;
    expect({ width: img.width, height: img.height }).toEqual({ width: 19, height: 27 });
    const st = colourStats(img, 0, 0, 19, 27);
    // a grey can with a red label, on black
    expect(st.colours[0].share).toBeGreaterThan(0.2);
    expect(st.colours.some((c) => c.rgb[0] > 150 && c.rgb[1] < 90 && c.rgb[2] < 90)).toBe(true);
  });

  it('reads resources from Rez source (how Glider PRO keeps its own pictures)', () => {
    const rez = parseRez(`data 'PICT' (2000, "Simple Room") {\n\t$"0001 0203"            /* .... */\n\t$"04"\n};\n\ndata 'snd ' (1) {\n\t$"FF"\n};\n`, [
      'PICT',
    ]);
    expect(rez.PICT).toEqual([{ id: 2000, name: 'Simple Room', data: new Uint8Array([0, 1, 2, 3, 4]) }]);
    expect(rez['snd ']).toBeUndefined();
  });
});

describe('mapping', () => {
  const ob = (o: Partial<GPObject>): GPObject => ({ slot: 0, what: 0, type: 'x', family: 'unknown', ...o });
  /** Intervals from their ends: iv(0, 10, 20, 30) = [[0, 10], [20, 30]]. */
  const iv = (...ends: number[]): [number, number][] => ends.flatMap((e, i) => (i % 2 ? [] : [[e, ends[i + 1]] as [number, number]]));

  it('takes walls out of openings, keeping the gaps a glider fits through', () => {
    expect(merge(iv(50, 60, 0, 20, 10, 30))).toEqual(iv(0, 30, 50, 60));
    expect(subtract(iv(0, 322), iv(0, 100, 150, 160), 28)).toEqual(iv(100, 150, 160, 322));
    expect(subtract(iv(0, 322), iv(0, 100, 150, 160), 60)).toEqual(iv(160, 322));
    expect(subtract(iv(16, 340), iv(0, 400), 28)).toEqual([]);
  });

  it('finds the walls a house builds of invisible obstacles along the edges', () => {
    const wall = ob({ type: 'invisObstacle', bounds: { top: 0, left: 0, bottom: 322, right: 16 } });
    const ground = ob({ type: 'invisBounce', bounds: { top: 300, left: 100, bottom: 322, right: 300 } });
    const ledge = ob({ type: 'invisObstacle', bounds: { top: 150, left: 200, bottom: 160, right: 300 } });
    expect(obstacleWalls({ objects: [wall, ground, ledge] })).toEqual({ left: iv(0, 322), right: [], up: iv(0, 16), down: iv(0, 16, 100, 300) });
  });

  it('follows a trigger to the switch it fires', () => {
    const blower = ob({ slot: 3, type: 'invisBlower', family: 'blower' });
    const guitar = ob({ slot: 4, type: 'guitar', family: 'appliance' });
    const sw = ob({ slot: 1, type: 'invisSwitch', family: 'switch', who: 3 });
    const links: Record<number, GPObject> = { 1: sw, 3: blower, 4: guitar };
    const link = (o: GPObject) => (typeof o.who === 'number' && links[o.who] ? { room: null, key: '0,0', target: links[o.who] } : null);
    expect(flipped(sw, link)?.target).toBe(blower);
    expect(flipped(ob({ type: 'trigger', family: 'switch', who: 1 }), link)?.target).toBe(blower);
    // a trigger linked to anything but a switch sets it off (here it goes off by itself): it flips nothing
    expect(flipped(ob({ type: 'lgTrigger', family: 'switch', who: 4 }), link)).toBeNull();
    expect(flipped(ob({ type: 'lightSwitch', family: 'switch' }), link)).toBeNull();
  });
});

describe('converter', () => {
  it('reproduces the committed Demo House', async () => {
    const bnds = JSON.parse(fs.readFileSync(path.join(FIX, 'demo-house-bnds.json'), 'utf8')) as { id: number; data: number[] }[];
    const pictures = JSON.parse(fs.readFileSync(path.join(FIX, 'demo-house-pictures.json'), 'utf8'));
    const level = convertHouse('Demo House', parseHouse(demoData()), { bnds }, 'Houses/Demo House.binhex', pictures);
    const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/world/classic/houses/demo-house.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify(level))).toEqual(committed);
  });
});
