import { SLOTS, GROUP_LABEL, slotSize, type GroupName } from './lib/icon/iconSpec';
import { decode } from './lib/icon/lvglIconCodec';
import { validateAnimation } from './lib/icon/dynamicIcon';
import { sourceName, type IconSource, type CompiledIcons } from './lib/icon/iconAssets';
import { extractIconZip } from './lib/icon/iconArchive';
import { buildCipk } from './lib/pack/cipk';
import { buildIconPack } from './lib/pack/packBuilders';
import { imageDataPreview } from './lib/pack/previewFactory';

const query = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const grid = query<HTMLDivElement>('#grid'), status = query<HTMLDivElement>('#status');
const fileInput = query<HTMLInputElement>('#files');
let group: GroupName = 'DESKTOP', sources: IconSource[] = [], compiled: CompiledIcons | null = null, busy = false;
const previewUrls = new Map<string, string>();

function save(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function coverUrl(bytes: Uint8Array): string {
  const image = decode(bytes), canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const rgba = new Uint8ClampedArray(image.pixels.length * 4);
  image.pixels.forEach((p, i) => { rgba[i * 4] = p >>> 16 & 255; rgba[i * 4 + 1] = p >>> 8 & 255; rgba[i * 4 + 2] = p & 255; rgba[i * 4 + 3] = p >>> 24; });
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function rebuildPreviews() {
  for (const url of previewUrls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  previewUrls.clear();
  for (const selection of compiled?.selections ?? []) {
    const gif = sources.find(s => s.name === selection.stem + '.gif');
    previewUrls.set(selection.stem, gif ? URL.createObjectURL(new Blob([gif.data.slice().buffer], { type: 'image/gif' })) : coverUrl(selection.cover));
  }
}

function updateControls() {
  const selected = compiled?.selections ?? [];
  query('#count').textContent = String(selected.length);
  query('#total').textContent = String(SLOTS.length);
  query<HTMLButtonElement>('#export').disabled = busy || !selected.length;
  query<HTMLButtonElement>('#raw-export').disabled = busy || !selected.length;
  fileInput.disabled = busy;
  query<HTMLButtonElement>('#clear').disabled = busy;
  if (compiled) {
    const animations = selected.filter(s => s.animation).length, bytes = buildCipk(compiled.icons).length;
    query('#pack-summary').textContent = `${selected.length} 个图标（${animations} 个动态）· ${compiled.icons.length} 个资源文件（含索引）· 内部包 ${(bytes / 1024).toFixed(1)} KiB`;
  } else query('#pack-summary').textContent = '选择图标后这里会显示资源数量与内部包体积。';
}

function render() {
  grid.replaceChildren();
  query('#group-help').textContent = group === 'DESKTOP'
    ? 'PNG / GIF 自动适配 96×96，保留透明度；原生静态 BIN 保留原尺寸。GIF 与同名 PNG / BIN 可组合自定义封面。'
    : '系统 UI 仅支持静态 PNG / BIN。PNG 使用槽位原尺寸，原生 BIN 保留原尺寸。';
  for (const slot of SLOTS.filter(s => s.group === group)) {
    const selected = compiled?.selections.find(s => s.stem === slot.stem);
    const el = document.createElement('div'); el.className = 'slot' + (selected ? ' selected' : ''); el.dataset.stem = slot.stem;
    const img = document.createElement('img');
    const previewStem = ['perpetual_calendar', 'cal_background'].includes(slot.stem) ? 'calendar_background' : slot.stem;
    img.src = previewUrls.get(slot.stem) ?? `/stock_icons/${previewStem}.png`; img.alt = slot.label; img.loading = 'lazy';
    img.onerror = () => { img.hidden = true; };
    const row = document.createElement('div'); row.className = 'slot-row';
    const label = document.createElement('small'); label.textContent = slot.label; label.title = slot.stem;
    const stem = document.createElement('small'); stem.textContent = slot.stem;
    const info = document.createElement('small');
    if (selected?.animation) {
      const animation = validateAnimation(selected.animation);
      info.textContent = `动态 · ${animation.frameCount} 帧 · ${animation.duration} ms · ${animation.loops ? animation.loops + ' 轮' : '无限循环'}`;
    } else info.textContent = slot.group === 'DESKTOP' ? '静态 / GIF 动态' : slotSize(slot).join('×') + ' · 静态';
    const actions = document.createElement('div'); actions.className = 'slot-actions';
    const replace = document.createElement('button'); replace.className = 'slot-action'; replace.textContent = selected ? '替换素材 / 封面' : '选择替换素材'; replace.disabled = busy;
    replace.onclick = () => chooseReplacement(slot.stem);
    const restore = document.createElement('button'); restore.className = 'slot-action'; restore.textContent = '复原官方图标'; restore.disabled = busy || !selected;
    restore.onclick = () => commitSources(sources.filter(s => sourceName(s.name).stem !== slot.stem));
    actions.append(replace, restore);
    if (selected?.animation) {
      const still = document.createElement('button'); still.className = 'slot-action'; still.textContent = '仅保留静态封面'; still.disabled = busy;
      still.onclick = () => commitSources([...sources.filter(s => sourceName(s.name).stem !== slot.stem), { name: slot.stem + '.bin', data: selected.cover }]);
      actions.append(still);
    }
    row.append(label, stem, info, actions); el.append(img, row); grid.append(el);
  }
  updateControls();
}

async function commitSources(next: IconSource[]) {
  if (busy) return;
  busy = true; render(); status.textContent = '正在转换并校验素材…';
  try {
    let result: CompiledIcons | null = null;
    if (next.length) {
      const worker = new Worker(new URL('./workers/icons.worker.ts', import.meta.url), { type: 'module' });
      try {
        result = await new Promise<CompiledIcons>((resolve, reject) => {
          worker.onmessage = event => event.data.ok ? resolve(event.data.compiled) : reject(new Error(event.data.error));
          worker.onerror = event => reject(new Error(event.message || '素材转换失败'));
          worker.postMessage({ sources: next });
        });
        buildCipk(result.icons);
      } finally { worker.terminate(); }
    }
    sources = next; compiled = result; rebuildPreviews();
    status.textContent = `已更新 ${result?.selections.length ?? 0} 个图标，未提供的图标沿用系统图标。`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  finally { busy = false; render(); }
}

async function importFiles(files: File[], targetStem?: string) {
  if (busy) return;
  try {
    const incoming: IconSource[] = [];
    for (const file of files) {
      if (file.size > (/\.zip$/i.test(file.name) ? 32 : 16) * 1024 * 1024) throw new Error(`${file.name} 文件过大`);
      const data = new Uint8Array(await file.arrayBuffer());
      if (/\.zip$/i.test(file.name) && !targetStem) incoming.push(...extractIconZip(data));
      else {
        const suffix = /_anim\.bin$/i.test(file.name) ? '_anim.bin' : '.' + file.name.split('.').pop()!.toLowerCase();
        const name = sourceName(targetStem ? targetStem + suffix : file.name).name;
        incoming.push({ name, data });
      }
    }
    const roles = new Set<string>();
    for (const source of incoming) {
      const { stem, kind } = sourceName(source.name), role = stem + ':' + (['png', 'bin'].includes(kind) ? 'cover' : 'animation');
      if (roles.has(role)) throw new Error(`${stem} 有重复封面或动画素材，请勿同时提供 PNG / BIN 或 GIF / _anim.bin`);
      roles.add(role);
    }
    const next = sources.filter(source => {
      const { stem, kind } = sourceName(source.name);
      return !roles.has(stem + ':' + (['png', 'bin'].includes(kind) ? 'cover' : 'animation'));
    });
    await commitSources([...next, ...incoming]);
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
}

function chooseReplacement(stem: string) {
  if (busy) return;
  const input = document.createElement('input'); input.type = 'file';
  input.accept = SLOTS.find(s => s.stem === stem)!.group === 'DESKTOP' ? '.png,.gif,.bin,image/png,image/gif' : '.png,.bin,image/png';
  input.onchange = () => { if (input.files?.length) void importFiles([...input.files], stem); };
  input.click();
}

fileInput.onchange = async () => { const files = [...fileInput.files ?? []]; fileInput.value = ''; await importFiles(files); };
for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) tab.onclick = () => {
  document.querySelector('.tab.active')?.classList.remove('active'); tab.classList.add('active'); group = tab.dataset.group as GroupName; render();
};
query<HTMLButtonElement>('#clear').onclick = () => {
  if (!busy && confirm(`确定清空当前“${GROUP_LABEL[group]}”页面的替换素材并恢复官方图标吗？`)) {
    const stems = new Set(SLOTS.filter(s => s.group === group).map(s => s.stem));
    void commitSources(sources.filter(s => !stems.has(sourceName(s.name).stem)));
  }
};
query<HTMLButtonElement>('#random-id').onclick = () => {
  query<HTMLInputElement>('#pkg').value = [...crypto.getRandomValues(new Uint8Array(12))].map(n => n % 10).join('');
};
const shortInput = query<HTMLInputElement>('#short');
const updateShortHint = () => { query('#short-hint').textContent = `${shortInput.value.length}/12 · 字母、数字、下划线、连字符`; };
shortInput.oninput = updateShortHint; updateShortHint();

query<HTMLButtonElement>('#raw-export').onclick = () => { if (compiled && !busy) save(buildCipk(compiled.icons), `${shortInput.value || 'MyIcons'}-pack.bin`); };
query<HTMLButtonElement>('#export').onclick = async () => {
  if (!compiled || busy) return;
  busy = true; render(); status.textContent = '正在生成投递包…';
  try {
    const response = await fetch(new URL('/pack/icon_pack.lua', location.origin));
    if (!response.ok) throw new Error(`投递脚本加载失败（HTTP ${response.status}），请检查部署素材`);
    const canvas = document.createElement('canvas'); canvas.width = 336; canvas.height = 480;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#1c1c1e'; ctx.fillRect(0, 0, 336, 480);
    ctx.fillStyle = '#f2f2f2'; ctx.font = '30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(query<HTMLInputElement>('#title').value, 168, 90, 310);
    ctx.font = '24px sans-serif'; ctx.fillText(`${compiled.selections.length} 个图标`, 168, 230);
    const preview = imageDataPreview(ctx.getImageData(0, 0, 336, 480));
    const result = buildIconPack({ ko: new Uint8Array(), iconBin: new Uint8Array(), fontLua: '', iconLua: await response.text() }, {
      short: shortInput.value, packName: query<HTMLInputElement>('#packname').value, title: query<HTMLInputElement>('#title').value,
      pkgName: query<HTMLInputElement>('#pkg').value || null, icons: compiled.icons,
    }, preview);
    save(result.bytes, result.pkgName + '.bin');
    status.textContent = `已生成 ${result.iconCount} 个图标（${result.animationCount} 个动态），包名 ${result.pkgName} · ${(result.bytes.length / 1024).toFixed(1)} KiB`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  finally { busy = false; render(); }
};
render();
