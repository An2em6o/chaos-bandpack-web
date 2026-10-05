import { createFont } from 'fonteditor-core';
import { Sfnt, SfntError } from './sfnt';
import { targetCharset } from './charset';

export interface FontSubsetOptions {
  /** Additional code points used by a custom watch face. */
  codePoints?: Iterable<number>;
  /** Keep hinting instructions when possible. Android drops layout tables. */
  hinting?: boolean;
  traditional?: boolean;
  normalizeMetrics?: boolean;
}

export interface FontSubsetReport {
  srcBytes: number;
  outBytes: number;
  srcGlyphs: number;
  outGlyphs: number;
  cmapChars: number;
  keptChars: number;
  droppedTables: string[];
}

/**
 * TrueType subsetter used by the web maker. fonteditor-core performs the
 * binary glyf/loca/hmtx/cmap rebuild and composite-glyph closure; this wrapper
 * supplies the same character policy and validates the generated sfnt again.
 */
export function subsetFont(src: Uint8Array, options: FontSubsetOptions = {}): [Uint8Array, FontSubsetReport] {
  const sfnt = new Sfnt(src);
  const cmap = sfnt.cmap();
  const wanted = [...targetCharset(options.codePoints, options.traditional ?? false)];
  const available = wanted.filter(c => cmap.has(c));
  if (!available.some(c => c >= 0x20 && c <= 0x7e)) throw new SfntError('字体没有可用的 ASCII 字形');
  let font;
  try {
    font = createFont(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength), {
      type: 'ttf', subset: available, hinting: options.hinting ?? false,
      kerning: false, compound2simple: false,
    });
  } catch (error) {
    throw new SfntError(`字体子集化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.normalizeMetrics) {
    const model = font.get() as any;
    const upm = model.head?.unitsPerE || 1000;
    const scale = (v: number) => Math.round(v * upm / 1000);
    if (model.hhea) { model.hhea.ascent = scale(1044); model.hhea.descent = scale(-282); model.hhea.lineGap = 0; }
    if (model['OS/2']) {
      const os2 = model['OS/2']; os2.typoAscent = scale(890); os2.typoDescent = scale(-110); os2.typoGap = scale(326);
      os2.winAscent = scale(1044); os2.winDescent = scale(282); os2.fsSelection = (os2.fsSelection || 0) & ~0x80;
    }
  }
  const raw = font.write({ type: 'ttf', hinting: options.hinting ?? false, kerning: false });
  const out = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const check = new Sfnt(out);
  const outCmap = check.cmap();
  for (const cp of available) if (!outCmap.has(cp)) throw new SfntError(`子集回读缺少 U+${cp.toString(16).toUpperCase()}`);
  const kept = new Set(available);
  const keptTags = new Set(check.tables.keys());
  const droppedTables = [...sfnt.tables.keys()].filter(tag => !keptTags.has(tag)).sort();
  return [out, { srcBytes: src.byteLength, outBytes: out.byteLength, srcGlyphs: sfnt.numGlyphs(), outGlyphs: check.numGlyphs(), cmapChars: outCmap.size, keptChars: kept.size, droppedTables }];
}
