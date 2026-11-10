import { icon, type Icon } from '../pack/cipk';
import { ANIMATION_STEMS, buildAnimationIndex, convertGif, parseAnimationIndex, resizeDesktop, validateAnimation } from './dynamicIcon';
import { bgra, decode, type LvglImage } from './lvglIconCodec';
import { exportIcons, matchName, slotSize, stemOf } from './iconSpec';

export interface IconSource { name: string; data: Uint8Array }
export interface IconSelection { stem: string; cover: Uint8Array; animation?: Uint8Array }
export interface CompiledIcons { selections: IconSelection[]; icons: Icon[] }

export function sourceName(name: string): { stem: string; kind: 'png' | 'gif' | 'bin' | 'anim'; name: string } {
  if (/[\\/]/.test(name) || name.includes('..')) throw new Error(`素材必须使用扁平文件名: ${name}`);
  const match = /^(.*)\.(png|gif|bin)$/i.exec(name);
  if (!match) throw new Error(`仅支持 PNG、GIF 或 BIN: ${name}`);
  let kind = match[2].toLowerCase() as 'png' | 'gif' | 'bin' | 'anim';
  let base = match[1];
  if (kind === 'bin' && base.endsWith('_anim')) { base = base.slice(0, -5); kind = 'anim'; }
  const slot = matchName(base);
  if (!slot) throw new Error(`未知图标名称: ${name}`);
  if ((kind === 'gif' || kind === 'anim') && slot.group !== 'DESKTOP') throw new Error(`${slot.label} 是系统 UI 图标，仅支持静态素材`);
  return { stem: slot.stem, kind, name: `${slot.stem}${kind === 'anim' ? '_anim.bin' : '.' + kind}` };
}

/** Also used at the final pack boundary so direct library callers get the same checks. */
export function prepareIconResources(input: readonly Icon[]): Icon[] {
  const covers = new Map<string, Uint8Array>(), animations = new Map<string, Uint8Array>();
  let suppliedIndex: Uint8Array | undefined;
  const seen = new Set<string>();
  for (const item of input) {
    if (seen.has(item.stem)) throw new Error(`资源重复: ${item.stem}.bin`);
    seen.add(item.stem);
    if (item.stem === 'animations') { suppliedIndex = item.data; continue; }
    if (item.stem.endsWith('_anim')) {
      const stem = item.stem.slice(0, -5);
      if (!ANIMATION_STEMS.includes(stem as typeof ANIMATION_STEMS[number])) throw new Error(`未知桌面动画: ${stem}`);
      validateAnimation(item.data); animations.set(stem, item.data); continue;
    }
    const slot = stemOf(item.stem);
    if (!slot) throw new Error(`未知图标槽位: ${item.stem}`);
    decode(item.data); // Preserve dimensions of preconverted native resources, including legacy 112×112.
    if (!item.data.length || item.data.length > 512 * 1024) throw new Error(`${item.stem}.bin 超过 512 KiB`);
    covers.set(item.stem, item.data);
  }
  if (!covers.size) throw new Error('请至少提供一个静态图标或 GIF');
  for (const stem of animations.keys()) {
    const cover = covers.get(stem);
    if (!cover) throw new Error(`${stem}_anim.bin 缺少对应静态封面`);
    const image = decode(cover);
    if (image.width !== 96 || image.height !== 96) throw new Error(`${stem} 的动态封面必须为 96×96`);
  }
  if (suppliedIndex) {
    const indexed = parseAnimationIndex(suppliedIndex);
    if (indexed.length !== animations.size || indexed.some(stem => !animations.has(stem))) throw new Error('CIA1 索引与实际动画文件不一致');
  }
  // Generate ctrl_dnd only when it has not been provided explicitly.
  if (covers.has('ctrl_disturb') && !covers.has('ctrl_dnd')) {
    const disturb = decode(covers.get('ctrl_disturb')!);
    if (disturb.width === 64 && disturb.height === 64) {
      const generated = exportIcons(new Map([['ctrl_disturb', covers.get('ctrl_disturb')!]]));
      covers.set('ctrl_dnd', generated.find(i => i.stem === 'ctrl_dnd')!.data);
    }
  }
  return [
    ...[...covers].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([stem, data]) => icon(stem, data)),
    ...[...animations].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([stem, data]) => icon(stem + '_anim', data)),
    icon('animations', buildAnimationIndex(animations.keys())),
  ];
}

export async function compileIconSources(sources: IconSource[], decodePng: (source: IconSource) => Promise<LvglImage>): Promise<CompiledIcons> {
  const groups = new Map<string, Map<string, IconSource>>();
  for (const source of sources) {
    const { stem, kind } = sourceName(source.name);
    const files = groups.get(stem) ?? new Map<string, IconSource>();
    if (files.has(kind)) throw new Error(`${stem} 有重复 ${kind.toUpperCase()} 素材`);
    files.set(kind, source); groups.set(stem, files);
  }
  const selections: IconSelection[] = [];
  for (const [stem, files] of groups) {
    if (files.has('png') && files.has('bin')) throw new Error(`${stem} 同时提供了 PNG 和 BIN 封面`);
    if (files.has('gif') && files.has('anim')) throw new Error(`${stem} 同时提供了 GIF 和 _anim.bin`);
    let cover: Uint8Array | undefined, animation: Uint8Array | undefined;
    const slot = stemOf(stem)!;
    if (files.has('gif')) {
      const gif = convertGif(files.get('gif')!.data);
      cover = bgra(gif.cover, 96, 96); animation = gif.animation;
    }
    if (files.has('anim')) { animation = files.get('anim')!.data; validateAnimation(animation); }
    if (files.has('bin')) cover = files.get('bin')!.data;
    if (files.has('png')) {
      const source = files.get('png')!;
      if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => source.data[i] === v)) throw new Error(`${source.name} 不是 PNG 文件`);
      const image = await decodePng(source);
      if (slot.group === 'DESKTOP') cover = bgra(resizeDesktop(image.pixels, image.width, image.height), 96, 96);
      else {
        const [width, height] = slotSize(slot);
        if (image.width !== width || image.height !== height) throw new Error(`${source.name} 需要 ${width}×${height} PNG；原生 BIN 保留原尺寸`);
        cover = bgra(image.pixels, width, height);
      }
    }
    if (!cover) throw new Error(`${stem}_anim.bin 需要同时提供对应 PNG 或 BIN 封面`);
    selections.push({ stem, cover, animation });
  }
  const resources = selections.flatMap(item => [icon(item.stem, item.cover), ...(item.animation ? [icon(item.stem + '_anim', item.animation)] : [])]);
  return { selections, icons: prepareIconResources(resources) };
}
