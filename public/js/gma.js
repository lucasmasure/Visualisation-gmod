// Lecture des archives d'addon Garry's Mod (.gma)

const utf8 = new TextDecoder('utf-8');

export const normPath = (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').toLowerCase();

export function isGma(u8) {
  return u8[0] === 0x47 && u8[1] === 0x4D && u8[2] === 0x41 && u8[3] === 0x44; // "GMAD"
}

export function parseGma(u8) {
  if (!isGma(u8)) throw new Error("Ce fichier n'est pas une archive GMA");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 4;

  const readStr = () => {
    const start = p;
    while (u8[p] !== 0) p++;
    const s = utf8.decode(u8.subarray(start, p));
    p++;
    return s;
  };

  const version = u8[p++];
  p += 16; // steamid + timestamp
  if (version > 1) while (readStr() !== '');

  const name = readStr();
  const description = readStr();
  const author = readStr();
  p += 4; // version de l'addon

  const entries = [];
  for (;;) {
    const num = dv.getUint32(p, true); p += 4;
    if (num === 0) break;
    const fileName = readStr();
    const size = Number(dv.getBigInt64(p, true)); p += 8;
    p += 4; // crc
    entries.push({ name: fileName, size });
  }

  const files = new Map();
  let offset = p;
  for (const e of entries) {
    files.set(normPath(e.name), { name: e.name, offset, size: e.size });
    offset += e.size;
  }

  return {
    name,
    description,
    author,
    files,
    has: (path) => files.has(normPath(path)),
    get(path) {
      const f = files.get(normPath(path));
      return f ? u8.subarray(f.offset, f.offset + f.size) : null;
    },
  };
}
