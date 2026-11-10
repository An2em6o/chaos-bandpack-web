import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { ANIMATION_STEMS, animationFrame, buildAnimationIndex, convertGif, decodePackBits, encodeAnimation, encodePackBits, parseAnimationIndex, validateAnimation } from '../src/lib/icon/dynamicIcon';
import { bgra, decode } from '../src/lib/icon/lvglIconCodec';
import { compileIconSources, prepareIconResources, sourceName } from '../src/lib/icon/iconAssets';
import { extractIconZip } from '../src/lib/icon/iconArchive';
import { buildCipk, parseCipk, icon } from '../src/lib/pack/cipk';
import { buildIconPack, patchLua } from '../src/lib/pack/packBuilders';
import { parse as parseShell, P67_VERSION } from '../src/lib/pack/shellBuilder';
import { DESKTOP } from '../src/lib/icon/iconSpec';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL('./fixtures/' + name, import.meta.url)));
const solid = (size = 96) => bgra(new Uint32Array(size * size).fill(0xff112233), size, size);
const hash = Uint8Array.from({ length: 32 }, (_, i) => i);
const reference = () => fixture('reference.dgf');

describe('DGF1 / CIA1 independent protocol fixtures', () => {
  it('matches the Python struct reference byte for byte', () => {
    const bytes = encodeAnimation([{ pixels: new Uint32Array(9216).fill(0xff112233), delay: 100 }], 3, hash);
    expect(bytes).toEqual(reference());
    expect(validateAnimation(bytes)).toMatchObject({ frameCount: 1, duration: 100, loops: 3 });
  });

  it('writes the fixed 38-bit ABI order, including bits above 31', () => {
    expect(new Set(DESKTOP.map(s => s.stem))).toEqual(new Set(ANIMATION_STEMS));
    const index = buildAnimationIndex(['activities', 'settings', 'wxpay']);
    expect(Buffer.from(index).toString('hex')).toBe('4349413160006000260000000100800020000000');
    expect(parseAnimationIndex(index)).toEqual(['activities', 'settings', 'wxpay']);
    expect(parseAnimationIndex(buildAnimationIndex([]))).toEqual([]);
  });

  it.each([0, 4, 6, 8, 10, 19])('rejects invalid CIA1 field at %i', offset => {
    const bytes = buildAnimationIndex([]); bytes[offset] ^= 0x80;
    expect(() => parseAnimationIndex(bytes)).toThrow();
  });

  it('keeps PackBits 128-byte run and literal boundaries distinct from LVGL RLE', () => {
    expect(encodePackBits(new Uint8Array(129).fill(7))).toEqual(new Uint8Array([255, 7, 0, 7]));
    const literal = Uint8Array.from({ length: 9216 }, (_, i) => i % 251);
    expect(decodePackBits(encodePackBits(literal))).toEqual(literal);
    for (const bad of [[255], [127, 1], [255, 1]]) expect(() => decodePackBits(new Uint8Array(bad))).toThrow();
  });

  it.each([
    ['width', 4, 112, 2], ['reserved', 10, 1, 2], ['frames', 8, 257, 2],
    ['duration', 12, 101, 4], ['table offset', 20, 1085, 4], ['payload', 24, 1097, 4],
    ['delay zero', 1084, 0, 4], ['delay long', 1084, 60001, 4],
    ['frame gap', 1088, 1097, 4], ['frame length', 1092, 18433, 4],
  ])('rejects corrupt %s', (_name, offset, value, size) => {
    const bytes = reference(), d = new DataView(bytes.buffer);
    if (size === 2) d.setUint16(Number(offset), Number(value), true); else d.setUint32(Number(offset), Number(value), true);
    expect(() => validateAnimation(bytes)).toThrow();
  });

  it('rejects truncated/trailing payloads and excessive frame counts without dropping frames', () => {
    expect(() => validateAnimation(reference().slice(0, -1))).toThrow();
    expect(() => validateAnimation(new Uint8Array([...reference(), 0]))).toThrow();
    expect(() => encodeAnimation(Array(257).fill({ pixels: new Uint32Array(9216), delay: 50 }), 0, hash)).toThrow();
  });
});

describe('GIF composition and timing', () => {
  it('matches Pillow for transparent partial frames with disposal 1, 2 and 3', () => {
    const source = fixture('disposal.gif'), result = convertGif(source);
    const expected = JSON.parse(readFileSync(new URL('./fixtures/disposal.json', import.meta.url), 'utf8'));
    expect(result.info.frameCount).toBe(4); expect(result.info.loops).toBe(3);
    expect(result.animation.slice(28, 60)).toEqual(new Uint8Array(createHash('sha256').update(source).digest()));
    result.info.frames.forEach((frame, i) => {
      expect(frame.delay).toBe(expected[i].delay);
      const pixels = animationFrame(result.animation, result.info, i), rgba = new Uint8Array(pixels.length * 4);
      pixels.forEach((p, n) => { rgba[n * 4] = p >>> 16 & 255; rgba[n * 4 + 1] = p >>> 8 & 255; rgba[n * 4 + 2] = p & 255; rgba[n * 4 + 3] = p >>> 24; });
      expect(createHash('sha256').update(rgba).digest('hex')).toBe(expected[i].sha256);
    });
  });

  it('distinguishes one playback from infinite looping and rejects zero delay', () => {
    expect(convertGif(fixture('once.gif')).info.loops).toBe(1);
    expect(convertGif(fixture('forever.gif')).info.loops).toBe(0);
    expect(() => convertGif(fixture('zero-delay.gif'))).toThrow(/时长/);
  });
});

describe('mixed icon assets', () => {
  const unusedPng = async () => { throw new Error('unexpected PNG decode'); };
  it('builds GIF animation with a custom native cover and a legacy static icon', async () => {
    const result = await compileIconSources([
      { name: 'activities.gif', data: fixture('disposal.gif') },
      { name: 'activities.bin', data: solid() },
      { name: 'alarm.bin', data: solid(112) },
    ], unusedPng);
    expect(result.icons.map(i => i.stem)).toEqual(['activities', 'alarm', 'activities_anim', 'animations']);
    expect(result.selections[0].cover).toEqual(solid());
    expect(decode(result.selections[1].cover).width).toBe(112);
    expect(parseAnimationIndex(result.icons.at(-1)!.data)).toEqual(['activities']);
  });

  it('fits transparent desktop PNG to 96×96 without the former plate-coverage restriction', async () => {
    const pixels = new Uint32Array(32 * 16); pixels[0] = 0x80887766;
    const result = await compileIconSources([{ name: 'alarm.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }], async () => ({ pixels, width: 32, height: 16 }));
    const image = decode(result.selections[0].cover);
    expect([image.width, image.height]).toEqual([96, 96]);
    expect(image.pixels[95 * 96 + 95]).toBe(0);
    expect(parseAnimationIndex(result.icons.at(-1)!.data)).toEqual([]);
  });

  it('preserves original system UI BIN dimensions and accepts the complete mapping', () => {
    const resources = prepareIconResources([icon('ctrl_phone_conn', solid(32)), icon('set_hr', solid(48)), icon('cal_background', solid(112))]);
    expect(resources).toHaveLength(4);
    expect(decode(resources.find(i => i.stem === 'ctrl_phone_conn')!.data).width).toBe(32);
  });

  it('requires a 96×96 cover for raw animation and validates index consistency', () => {
    expect(() => prepareIconResources([icon('alarm_anim', reference())])).toThrow(/静态图标|封面/);
    expect(() => prepareIconResources([icon('alarm', solid(112)), icon('alarm_anim', reference())])).toThrow(/96/);
    expect(() => prepareIconResources([icon('alarm', solid()), icon('alarm_anim', reference()), icon('animations', buildAnimationIndex([]))])).toThrow(/索引/);
    expect(prepareIconResources([icon('alarm', solid()), icon('alarm_anim', reference())])).toHaveLength(3);
  });

  it.each([
    ['alarm.png', 'alarm.bin'], ['alarm.gif', 'alarm_anim.bin'], ['alarm.bin', 'alarm.bin'],
  ])('rejects conflicting assets %s and %s', async (a, b) => {
    await expect(compileIconSources([{ name: a, data: solid() }, { name: b, data: solid() }], unusedPng)).rejects.toThrow(/重复|同时/);
  });

  it.each(['../alarm.bin', 'icons/alarm.gif', 'icons\\alarm.png', 'unknown.bin', 'ctrl_setting.gif'])('rejects unsafe or unsupported names: %s', name => {
    expect(() => sourceName(name)).toThrow();
  });

  it('extracts flat ZIPs and rejects nested resource paths', () => {
    const good = zipSync({ 'alarm.bin': solid(), 'activities.gif': fixture('disposal.gif') });
    expect(extractIconZip(good).map(s => s.name)).toEqual(['alarm.bin', 'activities.gif']);
    expect(() => extractIconZip(zipSync({ '../alarm.bin': solid() }))).toThrow();
    expect(() => extractIconZip(zipSync({ 'icons/alarm.bin': solid() }))).toThrow();
    expect(() => extractIconZip(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe('container limits and p67 envelope', () => {
  it('matches the upstream Python p67_pack.py envelope byte for byte', () => {
    const preview = new Uint8Array(16), d = new DataView(preview.buffer); d.setUint32(0, 0x410, true); d.setUint32(8, 4, true);
    const result = buildIconPack({ ko: new Uint8Array(), iconBin: new Uint8Array(), fontLua: '', iconLua: 'local PACK_NAME = "__PACK_NAME__"\nlocal PACK_TITLE = "__PACK_TITLE__"\n' }, {
      short: 'Ref', packName: 'Reference', title: 'Icons', pkgName: '434800000001',
      icons: [icon('activities', solid()), icon('activities_anim', reference())],
    }, preview);
    expect(result.bytes).toEqual(fixture('reference-p67.bin'));
  });

  it('allows animation over 512 KiB, while keeping static files at 512 KiB', () => {
    const animation = new Uint8Array(700000);
    expect(parseCipk(buildCipk([icon('alarm_anim', animation)]))[0][1]).toHaveLength(700000);
    expect(() => buildCipk([icon('alarm', animation)])).toThrow();
    expect(() => buildCipk([icon('alarm_anim', new Uint8Array(1048577))])).toThrow();
    expect(() => buildCipk(Array.from({ length: 16 }, (_, i) => icon('test' + i + '_anim', new Uint8Array(1048576))))).toThrow(/16777215/);
    expect(() => buildCipk(Array.from({ length: 257 }, (_, i) => icon('test' + i, new Uint8Array(1))))).toThrow(/256/);
  });

  it('rejects duplicate names and zero-size records while parsing CIPK', () => {
    const once = buildCipk([icon('alarm', new Uint8Array(1))]);
    const twice = new Uint8Array([...once, ...once.subarray(8)]); new DataView(twice.buffer).setUint32(4, 2, true);
    expect(() => parseCipk(twice)).toThrow(/重复/);
    new DataView(once.buffer).setUint32(8, 0, true);
    expect(() => parseCipk(once)).toThrow(/长度/);
  });

  it('uses the documented two-resource p67 envelope, Lua escaping, and the actual installer', () => {
    const preview = new Uint8Array(16), d = new DataView(preview.buffer); d.setUint32(0, 0x410, true); d.setUint32(8, 4, true);
    const lua = readFileSync(new URL('../public/pack/icon_pack.lua', import.meta.url), 'utf8');
    const result = buildIconPack({ ko: new Uint8Array(), iconBin: new Uint8Array(), fontLua: '', iconLua: lua }, {
      short: 'Mix_1-2', packName: '混合图标', title: '标题"\\$&', pkgName: null,
      icons: [icon('activities', solid()), icon('activities_anim', reference())],
    }, preview);
    const parsed = parseShell(result.bytes);
    expect(new DataView(result.bytes.buffer).getUint32(4, true)).toBe(P67_VERSION);
    expect(parsed.files.map(([name]) => name)).toEqual(['_lua/xiaomi-band-10-pro/main.lua', '_lua/xiaomi-band-10-pro/pack.bin']);
    expect(result).toMatchObject({ iconCount: 1, animationCount: 1, resourceCount: 3 });
    expect(new TextDecoder().decode(parsed.files[0][1])).toContain('local PACK_TITLE = "标题\\"\\\\$&"');
    expect(() => buildIconPack({ ko: new Uint8Array(), iconBin: new Uint8Array(), fontLua: '', iconLua: lua }, {
      short: 'bad.name', packName: 'Bad', title: 'Bad', pkgName: null, icons: [icon('alarm', solid())],
    }, preview)).toThrow(/ASCII/);
    expect(patchLua('"__TITLE__"', new Map([['__TITLE__', '$&\u00071']]))).toBe('"$&\\0071"');
  });
});
