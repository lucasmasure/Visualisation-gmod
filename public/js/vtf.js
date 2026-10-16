// Lecture des textures Valve (.vtf) -> RGBA 8 bits

const F = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, RGB565: 4, I8: 5, IA88: 6, A8: 8,
  RGB888_BLUESCREEN: 9, BGR888_BLUESCREEN: 10, ARGB8888: 11, BGRA8888: 12,
  DXT1: 13, DXT3: 14, DXT5: 15, BGRX8888: 16, BGR565: 17, BGRX5551: 18, BGRA4444: 19,
  DXT1_ONEBITALPHA: 20, BGRA5551: 21, UV88: 22, UVWQ8888: 23, RGBA16161616F: 24, RGBA16161616: 25,
};

const BPP = {
  0: 4, 1: 4, 2: 3, 3: 3, 4: 2, 5: 1, 6: 2, 8: 1, 9: 3, 10: 3, 11: 4, 12: 4,
  16: 4, 17: 2, 18: 2, 19: 2, 21: 2, 22: 2, 23: 4, 24: 8, 25: 8,
};

function imageSize(fmt, w, h) {
  if (fmt === F.DXT1 || fmt === F.DXT1_ONEBITALPHA) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 8;
  if (fmt === F.DXT3 || fmt === F.DXT5) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 16;
  const bpp = BPP[fmt];
  if (bpp === undefined) throw new Error('Format VTF non supporté : ' + fmt);
  return w * h * bpp;
}

export function parseVtf(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (!(u8[0] === 0x56 && u8[1] === 0x54 && u8[2] === 0x46 && u8[3] === 0)) throw new Error('VTF invalide');
  const major = dv.getUint32(4, true);
  const minor = dv.getUint32(8, true);
  const headerSize = dv.getUint32(12, true);
  const width = dv.getUint16(16, true);
  const height = dv.getUint16(18, true);
  const flags = dv.getUint32(20, true);
  const frames = Math.max(1, dv.getUint16(24, true));
  const firstFrame = dv.getUint16(26, true);
  const format = dv.getInt32(52, true);
  const mipCount = u8[56];
  const lowFormat = dv.getInt32(57, true);
  const lowW = u8[61], lowH = u8[62];
  const depth = major === 7 && minor >= 2 ? Math.max(1, dv.getUint16(63, true)) : 1;

  let faces = 1;
  if (flags & 0x4000) faces = minor < 5 && firstFrame === 0xFFFF ? 7 : 6;

  let offset = -1;
  if (minor >= 3) {
    const numRes = dv.getUint32(68, true);
    for (let r = 0; r < numRes; r++) {
      const o = 80 + r * 8;
      if (u8[o] === 0x30 && u8[o + 1] === 0 && u8[o + 2] === 0) offset = dv.getUint32(o + 4, true);
    }
  }
  if (offset < 0) {
    offset = headerSize;
    if (lowFormat !== -1 && lowW > 0 && lowH > 0) offset += imageSize(lowFormat, lowW, lowH);
  }

  // les mipmaps sont rangées de la plus petite à la plus grande
  for (let m = mipCount - 1; m >= 1; m--) {
    const w = Math.max(1, width >> m), h = Math.max(1, height >> m), d = Math.max(1, depth >> m);
    offset += imageSize(format, w, h) * frames * faces * d;
  }

  const size = imageSize(format, width, height);
  if (offset + size > u8.length) throw new Error('VTF tronqué');
  const data = u8.subarray(offset, offset + size);
  return { width, height, flags, format, rgba: decode(format, data, width, height) };
}

function decode(fmt, src, w, h) {
  const n = w * h;
  const out = new Uint8Array(n * 4);
  const px = (k, r, g, b, a) => { out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = a; };
  switch (fmt) {
    case F.DXT1: case F.DXT1_ONEBITALPHA: dxt(src, w, h, out, 1); break;
    case F.DXT3: dxt(src, w, h, out, 3); break;
    case F.DXT5: dxt(src, w, h, out, 5); break;
    case F.RGBA8888: out.set(src.subarray(0, n * 4)); break;
    case F.ABGR8888: for (let k = 0; k < n; k++) px(k, src[k * 4 + 3], src[k * 4 + 2], src[k * 4 + 1], src[k * 4]); break;
    case F.ARGB8888: for (let k = 0; k < n; k++) px(k, src[k * 4 + 1], src[k * 4 + 2], src[k * 4 + 3], src[k * 4]); break;
    case F.BGRA8888: for (let k = 0; k < n; k++) px(k, src[k * 4 + 2], src[k * 4 + 1], src[k * 4], src[k * 4 + 3]); break;
    case F.BGRX8888: for (let k = 0; k < n; k++) px(k, src[k * 4 + 2], src[k * 4 + 1], src[k * 4], 255); break;
    case F.UVWQ8888: for (let k = 0; k < n; k++) px(k, src[k * 4], src[k * 4 + 1], src[k * 4 + 2], src[k * 4 + 3]); break;
    case F.RGB888: case F.RGB888_BLUESCREEN: for (let k = 0; k < n; k++) px(k, src[k * 3], src[k * 3 + 1], src[k * 3 + 2], 255); break;
    case F.BGR888: case F.BGR888_BLUESCREEN: for (let k = 0; k < n; k++) px(k, src[k * 3 + 2], src[k * 3 + 1], src[k * 3], 255); break;
    case F.I8: for (let k = 0; k < n; k++) px(k, src[k], src[k], src[k], 255); break;
    case F.IA88: for (let k = 0; k < n; k++) px(k, src[k * 2], src[k * 2], src[k * 2], src[k * 2 + 1]); break;
    case F.A8: for (let k = 0; k < n; k++) px(k, 255, 255, 255, src[k]); break;
    case F.UV88: for (let k = 0; k < n; k++) px(k, src[k * 2], src[k * 2 + 1], 255, 255); break;
    case F.RGB565: case F.BGR565: {
      for (let k = 0; k < n; k++) {
        const v = src[k * 2] | (src[k * 2 + 1] << 8);
        const a = ((v >> 11) & 31) * 255 / 31, b = ((v >> 5) & 63) * 255 / 63, c = (v & 31) * 255 / 31;
        if (fmt === F.RGB565) px(k, c, b, a, 255); else px(k, a, b, c, 255);
      }
      break;
    }
    case F.BGRA4444: {
      for (let k = 0; k < n; k++) {
        const v = src[k * 2] | (src[k * 2 + 1] << 8);
        px(k, ((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17, ((v >> 12) & 15) * 17);
      }
      break;
    }
    case F.BGRX5551: case F.BGRA5551: {
      for (let k = 0; k < n; k++) {
        const v = src[k * 2] | (src[k * 2 + 1] << 8);
        const a = fmt === F.BGRA5551 ? ((v >> 15) & 1) * 255 : 255;
        px(k, ((v >> 10) & 31) * 255 / 31, ((v >> 5) & 31) * 255 / 31, (v & 31) * 255 / 31, a);
      }
      break;
    }
    case F.RGBA16161616F: {
      const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
      for (let k = 0; k < n * 4; k++) out[k] = Math.max(0, Math.min(255, half(dv.getUint16(k * 2, true)) * 255));
      break;
    }
    case F.RGBA16161616: {
      const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
      for (let k = 0; k < n * 4; k++) out[k] = dv.getUint16(k * 2, true) >> 8;
      break;
    }
    default: throw new Error('Format VTF non supporté : ' + fmt);
  }
  return out;
}

function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

function dxt(src, w, h, out, type) {
  const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
  const blockSize = type === 1 ? 8 : 16;
  const colors = new Uint8Array(16);
  const alphas = new Uint8Array(8);
  let o = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, o += blockSize) {
      const co = type === 1 ? o : o + 8;
      const c0 = src[co] | (src[co + 1] << 8);
      const c1 = src[co + 2] | (src[co + 3] << 8);
      rgb565(c0, colors, 0);
      rgb565(c1, colors, 4);
      colors[3] = colors[7] = 255;
      if (c0 > c1 || type !== 1) {
        for (let k = 0; k < 3; k++) {
          colors[8 + k] = (2 * colors[k] + colors[4 + k]) / 3;
          colors[12 + k] = (colors[k] + 2 * colors[4 + k]) / 3;
        }
        colors[11] = colors[15] = 255;
      } else {
        for (let k = 0; k < 3; k++) { colors[8 + k] = (colors[k] + colors[4 + k]) / 2; colors[12 + k] = 0; }
        colors[11] = 255;
        colors[15] = 0;
      }
      const bits = src[co + 4] | (src[co + 5] << 8) | (src[co + 6] << 16) | (src[co + 7] * 16777216);

      if (type === 5) {
        const a0 = src[o], a1 = src[o + 1];
        alphas[0] = a0; alphas[1] = a1;
        if (a0 > a1) for (let k = 1; k < 7; k++) alphas[k + 1] = ((7 - k) * a0 + k * a1) / 7;
        else { for (let k = 1; k < 5; k++) alphas[k + 1] = ((5 - k) * a0 + k * a1) / 5; alphas[6] = 0; alphas[7] = 255; }
      }

      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= h) break;
        for (let pxl = 0; pxl < 4; pxl++) {
          const x = bx * 4 + pxl;
          if (x >= w) continue;
          const t = py * 4 + pxl;
          const ci = (Math.floor(bits / Math.pow(2, t * 2)) & 3) * 4;
          const d = (y * w + x) * 4;
          out[d] = colors[ci]; out[d + 1] = colors[ci + 1]; out[d + 2] = colors[ci + 2];
          let a = colors[ci + 3];
          if (type === 3) {
            const byte = src[o + (t >> 1)];
            a = ((t & 1) ? byte >> 4 : byte & 15) * 17;
          } else if (type === 5) {
            const bit = t * 3;
            const byteIdx = o + 2 + (bit >> 3);
            const val = (src[byteIdx] | (src[byteIdx + 1] << 8)) >> (bit & 7);
            a = alphas[val & 7];
          }
          out[d + 3] = a;
        }
      }
    }
  }
}

function rgb565(c, out, o) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  out[o] = (r << 3) | (r >> 2);
  out[o + 1] = (g << 2) | (g >> 4);
  out[o + 2] = (b << 3) | (b >> 2);
}
