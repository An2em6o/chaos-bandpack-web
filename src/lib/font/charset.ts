import { SfntError } from './sfnt';

/** Character set policy shared by the browser maker and Android maker. */
export const ASCII_PRINTABLE = Array.from({ length: 0x7f - 0x20 }, (_, i) => i + 0x20);
export const SYMBOL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00a0, 0x00ff], [0x2000, 0x206f], [0x2190, 0x21ff],
  [0x2460, 0x24ff], [0x25a0, 0x25ff], [0x2600, 0x26ff],
  [0x3000, 0x303f], [0xfe30, 0xfe4f], [0xff00, 0xffef],
];

export function requiredCharset(): Set<number> {
  const out = new Set<number>(ASCII_PRINTABLE);
  try {
    const decoder = new TextDecoder('gb18030');
    for (let hi = 0xb0; hi <= 0xf7; hi++) for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const s = decoder.decode(Uint8Array.of(hi, lo));
      if (s.length === 1 && s.codePointAt(0)! >= 0x4e00 && s.codePointAt(0)! <= 0x9fff) out.add(s.codePointAt(0)!);
    }
  } catch { for (let c = 0x4e00; c <= 0x9fff; c++) out.add(c); }
  return out;
}

/** Builds the same practical target set without depending on platform charset tables. */
export function targetCharset(extra: Iterable<number> = [], traditional = false): Set<number> {
  const out = new Set<number>(ASCII_PRINTABLE);
  // Match Android's GB2312 scan: 72 Han rows × 94 columns, excluding the
  // five reserved cells which some GBK decoders expose as private-use codepoints.
  for (const c of requiredCharset()) out.add(c);
  for (const [a, b] of SYMBOL_RANGES) for (let c = a; c <= b; c++) out.add(c);
  if (traditional) {
    try {
      const decoder = new TextDecoder('big5');
      for (let hi = 0xa4; hi <= 0xf9; hi++) for (let lo = 0x40; lo <= 0xfe; lo++) {
        if (lo === 0x7f || (lo >= 0x80 && lo <= 0xa0)) continue;
        const s = decoder.decode(Uint8Array.of(hi, lo));
        if (s.length === 1 && s.codePointAt(0)! >= 0x4e00 && s.codePointAt(0)! <= 0x9fff) out.add(s.codePointAt(0)!);
      }
    } catch { /* Big5 is optional; browsers without it keep the simplified set. */ }
  }
  for (const c of extra) out.add(c);
  return out;
}

export function missingRequired(cmap: Map<number, number>): number[] {
  return [...requiredCharset()].filter(c => !cmap.has(c));
}

export function assertUsable(cmap: Map<number, number>): void {
  const missing = missingRequired(cmap);
  if (missing.length) throw new SfntError(`字体缺少 ${missing.length} 个必需字符，例如 ${missing.slice(0, 8).map(c => `U+${c.toString(16).toUpperCase()}`).join('、')}`);
}
