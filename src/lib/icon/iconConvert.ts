/**
 * 任意图片 -> 手环桌面图标（112x112，BGRA，50188 字节）。
 *
 * 几何完全照 PC 侧 `scripts/gen_delta_icons.py`，两端口径必须一致：
 * 外接方框按 alpha > ALPHA_HIT 取，方框内 alpha > ALPHA_PLATE 的比例就是"底板覆盖率"；
 * 覆盖率过低说明是透明底裸图形（贴上桌面会比系统图标小一圈），直接拒绝并说明原因。
 * 配平方式是外沿齐平 —— 所有底板的外接方框统一缩到内容框 CONTENT，
 * 不是面积相等。这是看过对照图后定的，也符合"只等比缩放、不补底不切圆角"的纪律。
 *
 * 与 PC 侧唯一的有意差异：缩放走预乘 alpha（先乘 alpha 再插值，最后除回来）。
 * PIL 是四个通道各自独立插值的，透明像素的 RGB 会渗进边缘形成暗边；预乘能消掉这个暗边。
 *
 * TS 移植自 Kotlin `IconConvert.kt`。像素为 ARGB uint32（与 Android getPixels 同格式）。
 */
import { CANVAS, CONTENT, MARGIN, OUT_BYTES, CANVAS_HEADER, slotCanvas, slotContent, type Slot } from "./iconSpec";
import { bgra } from "./lvglIconCodec";

/** 认定"这里有内容"的 alpha 门（与 PC 侧取同一个值） */
export const ALPHA_HIT = 24;

/** 认定"这里是实心底板"的 alpha 门 */
export const ALPHA_PLATE = 200;

/** 低于此覆盖率判为透明底裸图形 */
export const PLATE_MIN_COVERAGE = 0.55;

const LANCZOS_A = 3.0;

export interface ConvertReport {
  coverage: number;
  srcBoxSide: number;
  scaled: number;
}

/** 源图全透明 */
export class BlankError extends Error {
  constructor() {
    super("这张图整幅都是透明的，没有可用的内容");
    this.name = "BlankError";
  }
}

/** 透明底裸图形：贴到桌面会比系统图标小一圈 */
export class NoPlateError extends Error {
  constructor(public coverage: number) {
    super(
      `这张图没有底板（内容只占方框的 ${Math.round(coverage * 100)}%），贴到桌面会比系统图标小一圈。` +
        "请换一张自带底色的图。",
    );
    this.name = "NoPlateError";
  }
}

export function convert(
  src: Uint32Array,
  w: number,
  h: number,
  slot: Slot,
): [Uint8Array, ConvertReport] {
  if (slot.group !== "DESKTOP") return convertSystem(src, w, h, slot);
  if (!(w > 0 && h > 0) || src.length < w * h) throw new Error("像素数组与尺寸不匹配");

  // 1. 外接方框（alpha > ALPHA_HIT）
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (src[row + x] >>> 24 > ALPHA_HIT) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new BlankError();

  // 取正方形外接框，长边贴齐画幅时向内收，避免裁到图外
  let side = Math.max(x1 - x0, y1 - y0) + 1;
  side = Math.min(side, Math.min(w, h));
  const cx = Math.floor((x0 + x1 + 1) / 2);
  const cy = Math.floor((y0 + y1 + 1) / 2);
  const bx = Math.max(0, Math.min(cx - Math.floor(side / 2), w - side));
  const by = Math.max(0, Math.min(cy - Math.floor(side / 2), h - side));

  // 2. 底板覆盖率：方框内 alpha > ALPHA_PLATE 的比例
  let opaque = 0;
  for (let y = by; y < by + side; y++) {
    const row = y * w;
    for (let x = bx; x < bx + side; x++) {
      if (src[row + x] >>> 24 > ALPHA_PLATE) opaque++;
    }
  }
  const coverage = opaque / (side * side);
  if (coverage <= PLATE_MIN_COVERAGE) throw new NoPlateError(coverage);

  // 3. 只缩放，不重画：方框 -> 内容框
  const fitted = scaleBox(src, w, bx, by, side, CONTENT);

  // 4. 居中贴到画布，透明边自然成为桌面间距
  const canvas = new Uint32Array(CANVAS * CANVAS);
  const off = MARGIN;
  for (let y = 0; y < CONTENT; y++) {
    const srcRow = y * CONTENT;
    const dstRow = (y + off) * CANVAS + off;
    canvas.set(fitted.subarray(srcRow, srcRow + CONTENT), dstRow);
  }

  return [packDesktop(canvas), { coverage, srcBoxSide: side, scaled: CONTENT }];
}

function convertSystem(
  src: Uint32Array,
  w: number,
  h: number,
  slot: Slot,
): [Uint8Array, ConvertReport] {
  if (!(w > 0 && h > 0) || src.length < w * h) throw new Error("像素数组与尺寸不匹配");
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] >>> 24 !== 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new BlankError();
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const square = new Uint32Array(side * side);
  const dx = Math.floor((side - (x1 - x0 + 1)) / 2);
  const dy = Math.floor((side - (y1 - y0 + 1)) / 2);
  for (let y = y0; y <= y1; y++) {
    square.set(
      src.subarray(y * w + x0, y * w + x0 + (x1 - x0 + 1)),
      (y - y0 + dy) * side + dx,
    );
  }
  const scaled = scaleBox(square, side, 0, 0, side, slotContent(slot));
  let opaque = 0;
  for (const p of square) if (p >>> 24 > ALPHA_PLATE) opaque++;
  const coverage = opaque / square.length;
  return [bgra(scaled, slotCanvas(slot), slotCanvas(slot)), { coverage, srcBoxSide: side, scaled: slotContent(slot) }];
}

// ===== 缩放 =====

/**
 * 从 src 里取出 side×side 的方框（左上角 bx,by），等比缩放到 dst×dst。
 * Lanczos-3，可分离（先横后竖），预乘 alpha。
 * 用 Math.fround 模拟 Kotlin FloatArray 的 float32 存储，保证与 Android 侧同结果。
 */
function scaleBox(
  src: Uint32Array,
  srcW: number,
  bx: number,
  by: number,
  side: number,
  dst: number,
): Uint32Array {
  if (side === dst) {
    const out = new Uint32Array(dst * dst);
    for (let y = 0; y < dst; y++) {
      out.set(src.subarray((by + y) * srcW + bx, (by + y) * srcW + bx + dst), y * dst);
    }
    return out;
  }

  const k = weights(side, dst);

  // 横pass：预乘成 4 个浮点通道(r,g,b 已乘 alpha, a 原样)
  const horiz = new Float32Array(dst * side * 4);
  for (let y = 0; y < side; y++) {
    const row = (by + y) * srcW + bx;
    for (let x = 0; x < dst; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const base = x * k.n;
      for (let j = 0; j < k.n; j++) {
        const wgt = k.wgt[base + j];
        if (wgt === 0) continue;
        const p = src[row + k.idx[base + j]];
        const pa = (p >>> 24) & 0xff;
        const f = wgt * pa;
        r += ((p >>> 16) & 0xff) * f;
        g += ((p >>> 8) & 0xff) * f;
        b += (p & 0xff) * f;
        a += f;
      }
      const o = (y * dst + x) * 4;
      horiz[o] = fround(r);
      horiz[o + 1] = fround(g);
      horiz[o + 2] = fround(b);
      horiz[o + 3] = fround(a);
    }
  }

  // 竖pass
  const out = new Uint32Array(dst * dst);
  for (let x = 0; x < dst; x++) {
    for (let y = 0; y < dst; y++) {
      let r = 0, g = 0, b = 0, a = 0;
      const base = y * k.n;
      for (let j = 0; j < k.n; j++) {
        const wgt = k.wgt[base + j];
        if (wgt === 0) continue;
        const o = (k.idx[base + j] * dst + x) * 4;
        r += horiz[o] * wgt;
        g += horiz[o + 1] * wgt;
        b += horiz[o + 2] * wgt;
        a += horiz[o + 3] * wgt;
      }
      // 除回来：r/g/b 累加时已经乘过 alpha(0..255)，直接除以 alpha 累加值
      // 就得到 alpha 加权平均色，再取整成 0..255
      const inv = a > 1e-6 ? 1 / a : 0;
      out[y * dst + x] = ((clamp255(a) << 24) | (clamp255(r * inv) << 16) | (clamp255(g * inv) << 8) | clamp255(b * inv)) >>> 0;
    }
  }
  return out;
}

const fround = (v: number): number => Math.fround(v);

function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(v + 0.5);
}

/** 一维重采样权重表：dst 个输出点，每个固定取 n 个源点（不足的补 0 权重） */
interface Weights { idx: Int32Array; wgt: Float32Array; n: number }

/**
 * 标准抗锯齿重采样：输出点 ox 对应源坐标 c = (ox+0.5)*scale-0.5，
 * 核宽随缩放比放大 —— 下采样时它是低通滤波，不放大就会采样不足出现摩尔纹。
 *
 * 权重按"权重和"归一化；越界的源点按边缘像素钳制（相当于复制边界），
 * 归一化用的是钳制前的原始权重和，所以边缘不会变暗。
 */
function weights(size: number, dst: number): Weights {
  const scale = size / dst;
  const filterScale = Math.max(1.0, scale);
  const support = LANCZOS_A * filterScale;
  const n = Math.floor(2 * support) + 3;
  const idx = new Int32Array(dst * n);
  const wgt = new Float32Array(dst * n);
  for (let ox = 0; ox < dst; ox++) {
    const c = (ox + 0.5) * scale - 0.5;
    const lo = Math.ceil(c - support);
    const hi = Math.floor(c + support);
    let sum = 0;
    let j = 0;
    for (let i = lo; i <= hi; i++) {
      if (j >= n) break;
      const w = lanczos((i - c) / filterScale);
      idx[ox * n + j] = Math.max(0, Math.min(i, size - 1));
      wgt[ox * n + j] = fround(w);
      sum += w;
      j++;
    }
    if (sum !== 0 && sum !== 1) {
      const inv = 1 / sum;
      for (let q = 0; q < j; q++) wgt[ox * n + q] = fround(wgt[ox * n + q] * inv);
    }
  }
  return { idx, wgt, n };
}

/** Lanczos-3 核 */
function lanczos(x: number): number {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= LANCZOS_A) return 0;
  const px = Math.PI * x;
  return (LANCZOS_A * Math.sin(px) * Math.sin(px / LANCZOS_A)) / (px * px);
}

// ===== 打包 =====

/** ARGB -> 固件要的 BGRA 字节流（前面加 12 字节头），固定 50188 字节 */
function packDesktop(argb: Uint32Array): Uint8Array {
  const out = new Uint8Array(OUT_BYTES);
  out.set(CANVAS_HEADER, 0);
  const dv = new DataView(out.buffer);
  let o = CANVAS_HEADER.length;
  for (const p of argb) {
    dv.setUint32(o, p >>> 0, true); // 小端 int 直写 => 字节序 B,G,R,A
    o += 4;
  }
  return out;
}
