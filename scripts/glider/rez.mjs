/**
 * Read resources from a Rez source file (the text form of a Mac resource fork, like Glider PRO.r, which holds the
 * game's own pictures): data 'TYPE' (id, "name") { $"0123 4567 ..." };  Plain Node, no dependencies.
 */

/** Resources of the given types: { [type]: [{ id, name, data }] }. */
export function parseRez(text, types = null) {
  const out = {};
  const head = /^data '(.{4})' \((-?\d+)(?:, "((?:[^"\\]|\\.)*)")?[^)]*\) \{$/gm;
  let m;
  while ((m = head.exec(text))) {
    const [, type, id, name] = m;
    const end = text.indexOf('\n};', head.lastIndex);
    if (end < 0) break;
    if (!types || types.includes(type)) {
      const body = text.slice(head.lastIndex, end);
      const hex = [];
      for (const line of body.matchAll(/\$"([0-9A-Fa-f ]*)"/g)) hex.push(line[1].replace(/ /g, ''));
      const s = hex.join('');
      const data = new Uint8Array(s.length / 2);
      for (let i = 0; i < data.length; i++) data[i] = parseInt(s.substr(i * 2, 2), 16);
      (out[type] ??= []).push({ id: Number(id), name: name ?? null, data });
    }
    head.lastIndex = end + 3;
  }
  return out;
}
