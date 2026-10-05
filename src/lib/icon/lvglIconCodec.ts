/**
 * LVGL 图像文件与保留透明度的 I8/RLE 编码。
 *
 * TS 移植自 Kotlin `LvglIconCodec.kt`。像素一律是 ARGB int(与 Android getPixels 同格式)。
 */
import { readU32, writeU32 } from "../pack/shellWriter";

export interface LvglImage {
  width: number;
  height: number;
  /** ARGB int 数组, 长度 = width * height */
  pixels: Uint32Array;
}

export function lvglHeader(w: number, h: number, cf: number, flags: number, stride: number): Uint8Array {
  const out = new Uint8Array(12);
  out[0] = 0x19;
  out[1] = cf & 0xff;
  const dv = new DataView(out.buffer);
  dv.setUint16(2, flags & 0xffff, true);
  dv.setUint16(4, w & 0xffff, true);
  dv.setUint16(6, h & 0xffff, true);
  dv.setUint16(8, stride & 0xffff, true);
  dv.setUint16(10, 0, true);
  return out;
}

/** ARGB 像素 -> BGRA 字节流(小端 int 直写), 前面加 12 字节头, cf=16 */
export function bgra(pixels: Uint32Array, w: number, h: number): Uint8Array {
  if (pixels.length !== w * h) throw new Error("像素数与尺寸不匹配");
  const out = new Uint8Array(12 + pixels.length * 4);
  out.set(lvglHeader(w, h, 16, 0, w * 4), 0);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < pixels.length; i++) {
    dv.setUint32(12 + i * 4, pixels[i] >>> 0, true);
  }
  return out;
}

interface ColorCount { color: number; count: number }

function channel(color: number, ch: number): number {
  return (color >>> (ch * 8)) & 255;
}

class Box {
  ranges: number[];
  splitChannel: number;
  score: number;
  constructor(public colors: ColorCount[]) {
    this.ranges = [0, 1, 2, 3].map(
      (ch) =>
        Math.max(...colors.map((c) => channel(c.color, ch))) -
        Math.min(...colors.map((c) => channel(c.color, ch))),
    );
    let best = 0;
    let bestScore = -Infinity;
    for (let ch = 0; ch < 4; ch++) {
      const s = this.ranges[ch] * (ch === 3 ? 2 : 1);
      if (ch === 0 || s > bestScore) {
        bestScore = s;
        best = ch;
      }
    }
    this.splitChannel = best;
    this.score =
      colors.length > 1
        ? this.ranges[this.splitChannel] * colors.reduce((s, c) => s + c.count, 0)
        : -1;
  }
  split(): [Box, Box] {
    const sorted = [...this.colors].sort(
      (a, b) =>
        channel(a.color, this.splitChannel) - channel(b.color, this.splitChannel) ||
        a.color - b.color,
    );
    const half = Math.floor(sorted.reduce((s, c) => s + c.count, 0) / 2);
    let sum = 0;
    let split = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      sum += sorted[i].count;
      split = i + 1;
      if (sum >= half) break;
    }
    return [new Box(sorted.slice(0, split)), new Box(sorted.slice(split))];
  }
  mean(): number {
    const total = this.colors.reduce((s, c) => s + c.count, 0);
    let result = 0;
    for (let ch = 0; ch <= 3; ch++) {
      const value = Math.floor(
        (this.colors.reduce((s, c) => s + channel(c.color, ch) * c.count, 0) + Math.floor(total / 2)) /
          total,
      );
      result |= value << (ch * 8);
    }
    return result >>> 0;
  }
}

/**
 * ARGB 像素 -> I8(256 色调色板) + RLE, cf=10 flags=8。
 * 调色板固定占 1024 字节(256 项, 不足补 0), 后接 w*h 的索引区, 整体再做 RLE。
 */
export function indexedRle(pixels: Uint32Array, w: number, h: number): Uint8Array {
  if (!(w > 0 && h > 0) || pixels.length !== w * h) throw new Error("像素数与尺寸不匹配");
  const histogram = new Map<number, number>();
  for (const p of pixels) {
    if (p >>> 24 !== 0) histogram.set(p, (histogram.get(p) ?? 0) + 1);
  }
  let palette: number[];
  if (histogram.size <= 255) {
    palette = [...histogram.keys()].sort((a, b) => a - b);
  } else {
    const boxes: Box[] = [new Box([...histogram.entries()].map(([color, count]) => ({ color, count })))];
    while (boxes.length < 255) {
      let index = -1;
      let best = -Infinity;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].score > best) {
          best = boxes[i].score;
          index = i;
        }
      }
      if (index < 0 || boxes[index].score < 0) break;
      const [a, b] = boxes[index].split();
      boxes.splice(index, 1, a, b);
    }
    palette = boxes.map((b) => b.mean());
  }
  const lookup = new Map<number, number>();
  for (const color of histogram.keys()) {
    let bestIdx = 0;
    let bestErr = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const candidate = palette[i];
      const alpha = channel(color, 3);
      const ca = channel(candidate, 3);
      let error = (alpha - ca) * (alpha - ca) * 2;
      for (let ch = 0; ch <= 2; ch++) {
        const delta = Math.trunc(
          (channel(color, ch) * alpha - channel(candidate, ch) * ca) / 255,
        );
        error += delta * delta;
      }
      if (error < bestErr) {
        bestErr = error;
        bestIdx = i;
      }
    }
    lookup.set(color, bestIdx + 1);
  }
  const raw = new Uint8Array(1024 + pixels.length);
  const rdv = new DataView(raw.buffer);
  rdv.setUint32(0, 0, true);
  for (let i = 0; i < 255; i++) {
    rdv.setUint32(4 + i * 4, i < palette.length ? palette[i] >>> 0 : 0, true);
  }
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    raw[1024 + i] = p >>> 24 === 0 ? 0 : lookup.get(p)!;
  }
  const compressed = rle(raw);
  const out = new Uint8Array(12 + 12 + compressed.length);
  out.set(lvglHeader(w, h, 10, 8, w), 0);
  const odv = new DataView(out.buffer, 12);
  odv.setUint32(0, 1, true);
  odv.setUint32(4, compressed.length, true);
  odv.setUint32(8, raw.length, true);
  out.set(compressed, 24);
  return out;
}

function rle(raw: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let at = 0;
  const run = (start: number): number => {
    let n = 1;
    while (n < 127 && start + n < raw.length && raw[start + n] === raw[start]) n++;
    return n;
  };
  while (at < raw.length) {
    const count = run(at);
    if (count >= 3) {
      const piece = new Uint8Array(2);
      piece[0] = count;
      piece[1] = raw[at];
      chunks.push(piece);
      total += 2;
      at += count;
    } else {
      const begin = at;
      at += count;
      while (at < raw.length && at - begin < 127 && run(at) < 3) {
        at += Math.min(run(at), 127 - (at - begin));
      }
      const n = at - begin;
      const piece = new Uint8Array(1 + n);
      piece[0] = 0x80 | n;
      piece.set(raw.subarray(begin, at), 1);
      chunks.push(piece);
      total += 1 + n;
    }
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** 解码 cf=16 与 cf=10 flags=8 两种格式(自检与预览用) */
export function decode(bin: Uint8Array): LvglImage {
  if (bin.length < 12 || (bin[0] & 255) !== 0x19) throw new Error("图像头不合法");
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const cf = bin[1] & 255;
  const flags = dv.getUint16(2, true);
  const w = dv.getUint16(4, true);
  const h = dv.getUint16(6, true);
  const stride = dv.getUint16(8, true);
  if (!(w >= 1 && w <= 512 && h >= 1 && h <= 512)) throw new Error("尺寸越界");
  if (cf === 16 && flags === 0) {
    if (!(stride >= w * 4 && bin.length === 12 + stride * h)) throw new Error("BGRA 长度不符");
    const pixels = new Uint32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      pixels[i] = dv.getUint32(12 + Math.floor(i / w) * stride + (i % w) * 4, true) >>> 0;
    }
    return { width: w, height: h, pixels };
  }
  if (!(cf === 10 && flags === 8 && stride >= w && bin.length >= 24)) throw new Error("图像编码不支持");
  if (!(dv.getUint32(12, true) === 1 && dv.getUint32(16, true) === bin.length - 24 && dv.getUint32(20, true) === 1024 + stride * h)) {
    throw new Error("I8/RLE 头长度字段不符");
  }
  const raw = new Uint8Array(dv.getUint32(20, true));
  let at = 24;
  let dst = 0;
  while (at < bin.length) {
    const tag = bin[at++];
    const count = tag & 127;
    if (!(count > 0 && dst + count <= raw.length)) throw new Error("RLE 计数越界");
    if ((tag & 128) !== 0) {
      if (at + count > bin.length) throw new Error("RLE 字面量越界");
      raw.set(bin.subarray(at, at + count), dst);
      at += count;
    } else {
      if (at >= bin.length) throw new Error("RLE 重复项缺失");
      raw.fill(bin[at++], dst, dst + count);
    }
    dst += count;
  }
  if (dst !== raw.length) throw new Error("RLE 解压长度不符");
  const pdv = new DataView(raw.buffer);
  const pixels = new Uint32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = raw[1024 + Math.floor(i / w) * stride + (i % w)];
    pixels[i] = pdv.getUint32(idx * 4, true) >>> 0;
  }
  return { width: w, height: h, pixels };
}
