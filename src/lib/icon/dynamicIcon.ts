import { decompressFrame, parseGIF } from 'gifuct-js';
import { sha256 } from '../hash/sha256';
import { scaleBox } from './iconConvert';
import { quantizeArgb } from './lvglIconCodec';

export const ANIMATION_SIZE = 96;
export const FRAME_PIXELS = 96 * 96;
export const ANIMATION_MAX = 1024 * 1024;
export const FRAME_MAX = 256;
export const FRAME_ENCODED_MAX = 18432;
export const FRAME_TABLE_OFFSET = 1084;
// ABI order is fixed; it deliberately differs from the order of the UI slots.
export const ANIMATION_STEMS = [
  'activities', 'aivs', 'alarm', 'alipay', 'breath', 'calendar', 'camera', 'card',
  'chronograph', 'compass', 'dealt', 'findphone', 'flashlight', 'heartrate',
  'innovation_research', 'interconnect', 'mijia', 'music', 'mute', 'oxygen',
  'perpetual_calendar', 'pressure', 'recorder', 'settings', 'share', 'sleep',
  'sports', 'sports_course', 'sports_record', 'sports_status', 'timer', 'todo',
  'tomato_clock', 'vitality', 'weather', 'womenhealth', 'worldclock', 'wxpay',
] as const;

export interface AnimationFrame { pixels: Uint32Array; delay: number }
export interface AnimationInfo {
  frameCount: number; duration: number; loops: number; palette: Uint8Array;
  frames: Array<{ delay: number; offset: number; length: number }>;
}

function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function magic(bytes: Uint8Array): string { return String.fromCharCode(...bytes.subarray(0, 4)); }

/** DGF1 uses PackBits (count + 1), not the LVGL/preview RLE codec. */
export function encodePackBits(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  const run = (at: number) => {
    let n = 1;
    while (n < 128 && at + n < raw.length && raw[at + n] === raw[at]) n++;
    return n;
  };
  let at = 0;
  while (at < raw.length) {
    const n = run(at);
    if (n >= 3) { out.push(0x80 | (n - 1), raw[at]); at += n; }
    else {
      const start = at;
      at += n;
      while (at < raw.length && at - start < 128 && run(at) < 3) at += Math.min(run(at), 128 - (at - start));
      out.push(at - start - 1, ...raw.subarray(start, at));
    }
  }
  return Uint8Array.from(out);
}

export function decodePackBits(data: Uint8Array, size = FRAME_PIXELS): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0, dst = 0;
  while (at < data.length) {
    const tag = data[at++], n = (tag & 127) + 1;
    if (dst + n > size) throw new Error('DGF1 帧解压越界');
    if (tag & 128) {
      if (at >= data.length) throw new Error('DGF1 重复项缺少数据');
      out.fill(data[at++], dst, dst + n);
    } else {
      if (at + n > data.length) throw new Error('DGF1 字面量越界');
      out.set(data.subarray(at, at + n), dst); at += n;
    }
    dst += n;
  }
  if (dst !== size) throw new Error('DGF1 帧解压长度不符');
  return out;
}

export function validateAnimation(bytes: Uint8Array): AnimationInfo {
  if (bytes.length < FRAME_TABLE_OFFSET + 12 || bytes.length > ANIMATION_MAX || magic(bytes) !== 'DGF1') throw new Error('DGF1 动画头或文件大小不合法（上限 1 MiB）');
  const d = view(bytes), count = d.getUint16(8, true);
  if (d.getUint16(4, true) !== 96 || d.getUint16(6, true) !== 96 || count < 1 || count > FRAME_MAX || d.getUint16(10, true) !== 0) throw new Error('DGF1 必须为 96×96、1–256 帧，且保留字段为 0');
  const payload = FRAME_TABLE_OFFSET + count * 12;
  if (d.getUint32(20, true) !== FRAME_TABLE_OFFSET || d.getUint32(24, true) !== payload || payload > bytes.length) throw new Error('DGF1 帧表偏移不合法');
  const frames: AnimationInfo['frames'] = [];
  let expected = payload, duration = 0;
  for (let i = 0; i < count; i++) {
    const at = FRAME_TABLE_OFFSET + i * 12;
    const delay = d.getUint32(at, true), offset = d.getUint32(at + 4, true), length = d.getUint32(at + 8, true);
    if (delay < 1 || delay > 60000) throw new Error(`DGF1 第 ${i + 1} 帧时长必须为 1–60000 ms`);
    if (offset !== expected || length < 1 || length > FRAME_ENCODED_MAX || offset + length > bytes.length) throw new Error(`DGF1 第 ${i + 1} 帧数据边界不合法`);
    decodePackBits(bytes.subarray(offset, offset + length));
    frames.push({ delay, offset, length }); expected += length; duration += delay;
  }
  if (expected !== bytes.length || duration !== d.getUint32(12, true)) throw new Error('DGF1 总时长或文件末尾不符');
  return { frameCount: count, duration, loops: d.getUint32(16, true), palette: bytes.slice(60, FRAME_TABLE_OFFSET), frames };
}

export function animationFrame(bytes: Uint8Array, info: AnimationInfo, index: number): Uint32Array {
  const frame = info.frames[index];
  const indices = decodePackBits(bytes.subarray(frame.offset, frame.offset + frame.length));
  const palette = view(info.palette);
  return Uint32Array.from(indices, n => palette.getUint32(n * 4, true));
}

export function encodeAnimation(frames: AnimationFrame[], loops: number, sourceHash: Uint8Array): Uint8Array {
  if (!frames.length || frames.length > FRAME_MAX || sourceHash.length !== 32 || !Number.isInteger(loops) || loops < 0 || loops > 0xffffffff) throw new Error('动画帧数、循环次数或 SHA-256 不合法');
  const pixels = new Uint32Array(frames.length * FRAME_PIXELS);
  frames.forEach((f, i) => {
    if (f.pixels.length !== FRAME_PIXELS || !Number.isInteger(f.delay) || f.delay < 1 || f.delay > 60000) throw new Error(`第 ${i + 1} 帧需为 96×96、1–60000 ms`);
    pixels.set(f.pixels, i * FRAME_PIXELS);
  });
  // Bound the shared histogram for large GIFs; retain exact colors for small palettes.
  const colors = new Set<number>();
  for (const p of pixels) { colors.add(p); if (colors.size > 255) break; }
  if (colors.size > 255) {
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i]; let q = 0;
      for (let c = 0; c < 4; c++) q |= Math.round(((p >>> (c * 8)) & 255) / 17) * 17 << (c * 8);
      pixels[i] = q >>> 0;
    }
  }
  const { palette, indices } = quantizeArgb(pixels);
  const encoded = frames.map((_, i) => encodePackBits(indices.subarray(i * FRAME_PIXELS, (i + 1) * FRAME_PIXELS)));
  const payload = FRAME_TABLE_OFFSET + frames.length * 12;
  const length = payload + encoded.reduce((n, f) => n + f.length, 0);
  if (length > ANIMATION_MAX) throw new Error('转换后的动画超过 1 MiB，请减少帧数或画面复杂度');
  const out = new Uint8Array(length), d = view(out);
  out.set(new TextEncoder().encode('DGF1'));
  d.setUint16(4, 96, true); d.setUint16(6, 96, true); d.setUint16(8, frames.length, true);
  d.setUint32(12, frames.reduce((n, f) => n + f.delay, 0), true); d.setUint32(16, loops, true);
  d.setUint32(20, FRAME_TABLE_OFFSET, true); d.setUint32(24, payload, true);
  out.set(sourceHash, 28); out.set(palette, 60);
  let offset = payload;
  frames.forEach((frame, i) => {
    const at = FRAME_TABLE_OFFSET + i * 12;
    d.setUint32(at, frame.delay, true); d.setUint32(at + 4, offset, true); d.setUint32(at + 8, encoded[i].length, true);
    out.set(encoded[i], offset); offset += encoded[i].length;
  });
  validateAnimation(out);
  return out;
}

export function buildAnimationIndex(stems: Iterable<string>): Uint8Array {
  let mask = 0n;
  for (const stem of stems) {
    const i = ANIMATION_STEMS.indexOf(stem as typeof ANIMATION_STEMS[number]);
    if (i < 0) throw new Error(`仅桌面图标支持动画: ${stem}`);
    mask |= 1n << BigInt(i);
  }
  const out = new Uint8Array(20), d = view(out);
  out.set(new TextEncoder().encode('CIA1')); d.setUint16(4, 96, true); d.setUint16(6, 96, true); d.setUint16(8, 38, true); d.setBigUint64(12, mask, true);
  return out;
}

export function parseAnimationIndex(bytes: Uint8Array): string[] {
  if (bytes.length !== 20 || magic(bytes) !== 'CIA1') throw new Error('CIA1 索引必须恰好 20 字节');
  const d = view(bytes), mask = d.getBigUint64(12, true);
  if (d.getUint16(4, true) !== 96 || d.getUint16(6, true) !== 96 || d.getUint16(8, true) !== 38 || d.getUint16(10, true) !== 0 || (mask >> 38n) !== 0n) throw new Error('CIA1 尺寸、槽位数、保留位或高位不合法');
  return ANIMATION_STEMS.filter((_, i) => (mask & (1n << BigInt(i))) !== 0n);
}

/** Fit the full source canvas, retaining transparency and a stable position across frames. */
export function resizeDesktop(pixels: Uint32Array, width: number, height: number): Uint32Array {
  if (width < 1 || height < 1 || width * height !== pixels.length || Math.max(width, height) > 4096) throw new Error('源图片尺寸不合法或超过 4096 像素');
  const side = Math.max(width, height), square = new Uint32Array(side * side);
  const x = Math.floor((side - width) / 2), y = Math.floor((side - height) / 2);
  for (let row = 0; row < height; row++) square.set(pixels.subarray(row * width, (row + 1) * width), (row + y) * side + x);
  return scaleBox(square, side, 0, 0, side, 96);
}

export function convertGif(bytes: Uint8Array): { cover: Uint32Array; animation: Uint8Array; info: AnimationInfo } {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (!['GIF87a', 'GIF89a'].includes(signature) || bytes[bytes.length - 1] !== 0x3b) throw new Error('GIF 文件头或结束标记不合法');
  const gif = parseGIF(bytes.slice().buffer);
  const { width, height, backgroundColorIndex } = gif.lsd;
  if (!width || !height || Math.max(width, height) > 4096) throw new Error('GIF 画布不能超过 4096 像素');
  const sourceFrames = gif.frames.filter((f): f is Extract<typeof f, { image: unknown }> => 'image' in f);
  if (!sourceFrames.length || sourceFrames.length > FRAME_MAX) throw new Error('GIF 必须为 1–256 帧，不会自动抽帧');
  let loops = 1;
  for (const f of gif.frames) {
    if ('application' in f && ['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(f.application.id)) {
      const b = f.application.blocks;
      if (b.length !== 3 || b[0] !== 1) throw new Error('GIF 循环扩展不合法');
      const repeat = b[1] | (b[2] << 8); loops = repeat === 0 ? 0 : repeat + 1;
    }
  }
  const bg = gif.gct?.[backgroundColorIndex] ?? [0, 0, 0];
  const opaqueBackground = (0xff000000 | (bg[0] << 16) | (bg[1] << 8) | bg[2]) >>> 0;
  const canvas = new Uint32Array(width * height);
  if (!sourceFrames[0].gce?.extras.transparentColorGiven) canvas.fill(opaqueBackground);
  const frames: AnimationFrame[] = [];
  for (const raw of sourceFrames) {
    const descriptor = raw.image.descriptor;
    if (!descriptor.width || !descriptor.height || descriptor.left + descriptor.width > width || descriptor.top + descriptor.height > height) throw new Error('GIF 局部帧超出画布');
    const delay = raw.gce ? raw.gce.delay * 10 : 100;
    if (delay < 1 || delay > 60000) throw new Error(`GIF 第 ${frames.length + 1} 帧时长必须为 1–60000 ms`);
    const disposal = raw.gce?.extras.disposal ?? 0;
    if (disposal > 3) throw new Error('GIF disposal 方式不支持');
    const saved = disposal === 3 ? canvas.slice() : null;
    const frame = decompressFrame(raw, gif.gct, true);
    for (let y = 0; y < descriptor.height; y++) for (let x = 0; x < descriptor.width; x++) {
      const at = (y * descriptor.width + x) * 4;
      if (frame.patch[at + 3]) canvas[(y + descriptor.top) * width + x + descriptor.left] = (0xff000000 | frame.patch[at] << 16 | frame.patch[at + 1] << 8 | frame.patch[at + 2]) >>> 0;
    }
    frames.push({ pixels: resizeDesktop(canvas, width, height), delay });
    if (saved) canvas.set(saved);
    else if (disposal === 2) {
      const background = raw.gce?.extras.transparentColorGiven ? 0 : opaqueBackground;
      for (let y = 0; y < descriptor.height; y++) canvas.fill(background, (y + descriptor.top) * width + descriptor.left, (y + descriptor.top) * width + descriptor.left + descriptor.width);
    }
  }
  const animation = encodeAnimation(frames, loops, sha256(bytes));
  return { cover: frames[0].pixels, animation, info: validateAnimation(animation) };
}
