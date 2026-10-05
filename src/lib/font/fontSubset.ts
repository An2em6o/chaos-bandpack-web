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
  collectionIndex?: number;
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
  const source = isTtc(src) ? extractTtcFace(src, options.collectionIndex) : src;
  const sfnt = new Sfnt(source);
  const cmap = sfnt.cmap();
  const wanted = [...targetCharset(options.codePoints, options.traditional ?? false)];
  const available = wanted.filter(c => cmap.has(c));
  if (!available.some(c => c >= 0x20 && c <= 0x7e)) throw new SfntError('字体没有可用的 ASCII 字形');
  let font;
  try {
    font = createFont(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), {
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

function isTtc(b: Uint8Array): boolean { return b.length >= 4 && String.fromCharCode(...b.slice(0, 4)) === 'ttcf'; }

function extractTtcFace(b: Uint8Array, requested?: number): Uint8Array {
  if (b.length < 16) throw new SfntError('TTC 文件太短');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getUint32(8, false);
  if (!count || count > 256 || 12 + count * 4 > b.length) throw new SfntError('TTC 字体目录异常');
  const indices = requested == null ? [...Array(count).keys()] : [requested];
  if (requested != null && (requested < 0 || requested >= count)) throw new SfntError(`TTC 字体索引超出范围: ${requested}/${count}`);
  let lastError: unknown;
  for (const index of indices) {
    try {
      const base = dv.getUint32(12 + index * 4, false);
      if (base + 12 > b.length) throw new SfntError('TTC 字体面目录越界');
      const version = dv.getUint32(base, false), n = dv.getUint16(base + 4, false);
      if (version !== 0x00010000 && version !== 0x74727565 && version !== 0x4f54544f) throw new SfntError('TTC 字体面不是 sfnt');
      if (!n || n > 512 || base + 12 + n * 16 > b.length) throw new SfntError('TTC 字体表目录异常');
      const entries: Array<{ tag: string; checksum: number; off: number; len: number }> = [];
      for (let i = 0; i < n; i++) {
        const p = base + 12 + i * 16, off = dv.getUint32(p + 8, false), len = dv.getUint32(p + 12, false);
        if (off + len > b.length) throw new SfntError(`TTC 表越界: ${String.fromCharCode(...b.slice(p, p + 4))}`);
        entries.push({ tag: String.fromCharCode(...b.slice(p, p + 4)), checksum: dv.getUint32(p + 4, false), off, len });
      }
      if (!entries.some(e => e.tag === 'cmap')) throw new SfntError('字体面缺少 cmap 表');
      const dir = 12 + n * 16;
      const total = dir + entries.reduce((sum, e) => sum + ((e.len + 3) & ~3), 0);
      const out = new Uint8Array(total), od = new DataView(out.buffer);
      od.setUint32(0, version, false); od.setUint16(4, n, false); od.setUint16(6, dv.getUint16(base + 6, false), false);
      let p = dir;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i], q = 12 + i * 16;
        out.set(b.slice(base + 12 + i * 16, base + 12 + i * 16 + 4), q);
        od.setUint32(q + 4, e.checksum, false); od.setUint32(q + 8, p, false); od.setUint32(q + 12, e.len, false);
        out.set(b.slice(e.off, e.off + e.len), p); p += (e.len + 3) & ~3;
      }
      // 重新用本地解析器确认拆出来的面确实有可用 Unicode cmap。
      new Sfnt(out).cmap();
      return out;
    } catch (error) { lastError = error; if (requested != null) throw error; }
  }
  throw (lastError instanceof Error ? lastError : new SfntError('TTC 中没有可用字体面'));
}
