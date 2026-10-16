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
    fetch: async () => {}, // tout est déjà en mémoire
    get(path) {
      const f = files.get(normPath(path));
      return f ? u8.subarray(f.offset, f.offset + f.size) : null;
    },
  };
}

/**
 * Addon resté sur le serveur en ligne : seuls les fichiers demandés sont téléchargés.
 * Même interface que parseGma (files, has, get) avec fetch(paths) à appeler avant get().
 */
export class RemoteGma {
  constructor(base, id, list, name) {
    this.base = base;
    this.id = id;
    this.name = name || '';
    this.files = new Map(list.map(([p, size]) => [normPath(p), { name: p, size }]));
    this.cache = new Map();
    this.pending = new Map();
  }

  has(path) { return this.files.has(normPath(path)); }

  get(path) { return this.cache.get(normPath(path)) || null; }

  async fetch(paths, onProgress) {
    const need = [...new Set(paths.map(normPath))].filter((p) => this.files.has(p) && !this.cache.has(p));
    let done = 0;
    const one = (p) => {
      if (!this.pending.has(p)) {
        const url = `${this.base}/api/file?id=${this.id}&path=${encodeURIComponent(p)}`;
        this.pending.set(p, fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(r.status === 404 ? 'expired' : `HTTP ${r.status}`);
          this.cache.set(p, new Uint8Array(await r.arrayBuffer()));
        }).finally(() => this.pending.delete(p)));
      }
      return this.pending.get(p).then(() => onProgress?.(++done, need.length));
    };
    // 6 téléchargements en parallèle
    const queue = [...need];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length) await one(queue.shift());
    });
    await Promise.all(workers);
  }
}
