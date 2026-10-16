// Décompresseur LZMA (format "alone" .lzma) utilisé par les anciens addons du Workshop.
// Adapté de la spécification de référence LzmaSpec.

const kNumStates = 12;
const kMatchMinLen = 2;
const kEndPosModelIndex = 14;
const kNumFullDistances = 128;
const kNumAlignBits = 4;
const kNumLenToPosStates = 4;
const kNumPosBitsMax = 4;

class RangeDecoder {
  constructor(data, pos) {
    this.data = data;
    this.pos = pos;
    this.range = 0xFFFFFFFF;
    this.code = 0;
    if (data[this.pos++] !== 0) throw new Error('LZMA : flux corrompu');
    for (let i = 0; i < 4; i++) this.code = this.code * 256 + data[this.pos++];
    if (this.code === this.range) throw new Error('LZMA : flux corrompu');
  }
  normalize() {
    if (this.range < 0x1000000) {
      this.range *= 256;
      this.code = this.code * 256 + (this.data[this.pos++] | 0);
    }
  }
  bit(probs, i) {
    const p = probs[i];
    const bound = (this.range >>> 11) * p;
    let b;
    if (this.code < bound) {
      this.range = bound;
      probs[i] = p + ((2048 - p) >>> 5);
      b = 0;
    } else {
      this.range -= bound;
      this.code -= bound;
      probs[i] = p - (p >>> 5);
      b = 1;
    }
    this.normalize();
    return b;
  }
  direct(numBits) {
    let res = 0;
    for (let i = 0; i < numBits; i++) {
      this.range = this.range >>> 1;
      let b = 0;
      if (this.code >= this.range) { this.code -= this.range; b = 1; }
      res = res * 2 + b;
      this.normalize();
    }
    return res;
  }
  tree(probs, off, numBits) {
    let m = 1;
    for (let i = 0; i < numBits; i++) m = (m << 1) + this.bit(probs, off + m);
    return m - (1 << numBits);
  }
  reverseTree(probs, off, numBits) {
    let m = 1, sym = 0;
    for (let i = 0; i < numBits; i++) {
      const b = this.bit(probs, off + m);
      m = (m << 1) + b;
      sym |= b << i;
    }
    return sym;
  }
}

const newProbs = (n) => new Uint16Array(n).fill(1024);

class LenDecoder {
  constructor() {
    this.choice = newProbs(2);
    this.low = newProbs(1 << (kNumPosBitsMax + 3));
    this.mid = newProbs(1 << (kNumPosBitsMax + 3));
    this.high = newProbs(256);
  }
  decode(rc, posState) {
    if (rc.bit(this.choice, 0) === 0) return rc.tree(this.low, posState << 3, 3);
    if (rc.bit(this.choice, 1) === 0) return 8 + rc.tree(this.mid, posState << 3, 3);
    return 16 + rc.tree(this.high, 0, 8);
  }
}

export function isLzma(u8) {
  // props (lc/lp/pb) < 225 et taille du dictionnaire plausible
  return u8.length > 13 && u8[0] < 225 && !(u8[0] === 0x47 && u8[1] === 0x4D && u8[2] === 0x41 && u8[3] === 0x44);
}

export function lzmaDecompress(data) {
  let d = data[0];
  const lc = d % 9; d = (d / 9) | 0;
  const lp = d % 5;
  const pb = (d / 5) | 0;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sizeLo = dv.getUint32(5, true);
  const sizeHi = dv.getUint32(9, true);
  const sizeKnown = !(sizeLo === 0xFFFFFFFF && sizeHi === 0xFFFFFFFF);
  let unpackSize = sizeKnown ? sizeHi * 4294967296 + sizeLo : 0;

  let out = new Uint8Array(sizeKnown ? unpackSize : Math.max(1 << 20, data.length * 4));
  let outPos = 0;
  const ensure = (n) => {
    if (outPos + n <= out.length) return;
    let size = out.length * 2;
    while (size < outPos + n) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out);
    out = bigger;
  };

  const rc = new RangeDecoder(data, 13);
  const literalProbs = newProbs(0x300 << (lc + lp));
  const posSlot = newProbs(kNumLenToPosStates << 6);
  const posDecoders = newProbs(1 + kNumFullDistances - kEndPosModelIndex);
  const align = newProbs(1 << kNumAlignBits);
  const isMatch = newProbs(kNumStates << kNumPosBitsMax);
  const isRep = newProbs(kNumStates);
  const isRepG0 = newProbs(kNumStates);
  const isRepG1 = newProbs(kNumStates);
  const isRepG2 = newProbs(kNumStates);
  const isRep0Long = newProbs(kNumStates << kNumPosBitsMax);
  const lenDecoder = new LenDecoder();
  const repLenDecoder = new LenDecoder();

  const pbMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;
  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;

  const decodeDistance = (len) => {
    const lenState = Math.min(len, kNumLenToPosStates - 1);
    const slot = rc.tree(posSlot, lenState << 6, 6);
    if (slot < 4) return slot;
    const numDirectBits = (slot >>> 1) - 1;
    let dist = (2 | (slot & 1)) * Math.pow(2, numDirectBits);
    if (slot < kEndPosModelIndex) {
      dist += rc.reverseTree(posDecoders, dist - slot, numDirectBits);
    } else {
      dist += rc.direct(numDirectBits - kNumAlignBits) * 16;
      dist += rc.reverseTree(align, 0, kNumAlignBits);
    }
    return dist;
  };

  while (!sizeKnown || outPos < unpackSize) {
    const posState = outPos & pbMask;

    if (rc.bit(isMatch, (state << kNumPosBitsMax) + posState) === 0) {
      // littéral
      ensure(1);
      const prev = outPos > 0 ? out[outPos - 1] : 0;
      const litState = ((outPos & lpMask) << lc) + (prev >>> (8 - lc));
      const base = 0x300 * litState;
      let symbol = 1;
      if (state >= 7) {
        let matchByte = out[outPos - rep0 - 1];
        do {
          const matchBit = (matchByte >>> 7) & 1;
          matchByte <<= 1;
          const b = rc.bit(literalProbs, base + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | b;
          if (matchBit !== b) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(literalProbs, base + symbol);
      out[outPos++] = symbol - 0x100;
      state = state < 4 ? 0 : (state < 10 ? state - 3 : state - 6);
      continue;
    }

    let len;
    if (rc.bit(isRep, state) !== 0) {
      if (outPos === 0) throw new Error('LZMA : flux corrompu');
      if (rc.bit(isRepG0, state) === 0) {
        if (rc.bit(isRep0Long, (state << kNumPosBitsMax) + posState) === 0) {
          state = state < 7 ? 9 : 11;
          ensure(1);
          out[outPos] = out[outPos - rep0 - 1];
          outPos++;
          continue;
        }
      } else {
        let dist;
        if (rc.bit(isRepG1, state) === 0) {
          dist = rep1;
        } else {
          if (rc.bit(isRepG2, state) === 0) {
            dist = rep2;
          } else {
            dist = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = repLenDecoder.decode(rc, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2; rep2 = rep1; rep1 = rep0;
      len = lenDecoder.decode(rc, posState);
      state = state < 7 ? 7 : 10;
      rep0 = decodeDistance(len);
      if (rep0 === 0xFFFFFFFF) break; // marqueur de fin
      if (rep0 >= outPos) throw new Error('LZMA : flux corrompu');
    }

    len += kMatchMinLen;
    if (sizeKnown && outPos + len > unpackSize) len = unpackSize - outPos;
    ensure(len);
    let src = outPos - rep0 - 1;
    for (let i = 0; i < len; i++) out[outPos++] = out[src++];
  }

  return outPos === out.length ? out : out.subarray(0, outPos);
}
