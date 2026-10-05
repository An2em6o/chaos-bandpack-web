/**
 * 打包要用的固定素材。全部来自设备侧那一份源码(Chaos-Module)，网页版在运行时
 * fetch 静态托管的素材或由用户上传 —— 本仓库不存第二份拷贝, 也不放任何二进制。
 *
 * TS 移植自 Kotlin `PackAssets.kt` / `PackBuilders.kt`。
 */
import {
  PackError,
  checkPkg,
  pkgFor,
  readEntry,
  encodeUtf8,
  decodeUtf8,
} from "./shellWriter";
import { build as buildShell, entry, verifyBuilt, type Entry } from "./shellBuilder";
import { buildCipk, parseCipk, type Icon } from "./cipk";
import * as TitleText from "./titleText";
import { bytesEqual } from "./shellBuilder";

export interface PackAssets {
  /** 内核模块 chaos_sup.ko(与主包同一份, 投递包靠它自己跑起来) */
  ko: Uint8Array;
  /** 应用图标 chaos_icon.bin(注册应用要用, 与主包同一份) */
  iconBin: Uint8Array;
  /** 字体投递 Lua 模板(带 __FONT_NAME__ / __PACK_LABEL__ / __PACK_TITLE__ 占位符) */
  fontLua: string;
  /** 图标投递 Lua 模板(带 __PACK_NAME__ / __PACK_TITLE__ 占位符) */
  iconLua: string;
}

const utf8Enc = new TextEncoder();

// ===== 字体包 =====

export const FONT_LABEL_BYTES = 12;
export const PH_FONT_NAME = "__FONT_NAME__";
export const PH_PACK_LABEL = "__PACK_LABEL__";
export const PH_PACK_TITLE = "__PACK_TITLE__";

export interface FontPackInputs {
  /** 清单短名(投递后清单里的名字, <= 12 字节, 可中文) */
  label: string;
  /** 表盘显示名(手环表盘列表里看到的) */
  packName: string;
  /** 表盘内那行标题("字体投递 X") */
  title: string;
  /** 12 位数字包名, 传 null 时由字体内容自动推导 */
  pkgName: string | null;
  /** 已归一化 + 子集化的字体字节(就是要写进包里的那一段) */
  font: Uint8Array;
}

export interface PackResult {
  bytes: Uint8Array;
  pkgName: string;
  packName: string;
}

export function buildFontPack(a: PackAssets, inputs: FontPackInputs, preview: Uint8Array): PackResult {
  const labelBytes = encodeUtf8(inputs.label);
  if (labelBytes.length === 0 || labelBytes.length > FONT_LABEL_BYTES) {
    throw new PackError(`字体短名要在 1..${FONT_LABEL_BYTES} 字节之间: 「${inputs.label}」`);
  }
  for (const ch of inputs.label) {
    if (ch.codePointAt(0)! < 0x20) throw new PackError("字体短名不能有控制字符");
  }
  TitleText.validate(inputs.title); // 超宽只是提醒, 不挡打包

  const lua = patchLua(a.fontLua, new Map([
    [PH_FONT_NAME, inputs.label],
    [PH_PACK_LABEL, inputs.label],
    [PH_PACK_TITLE, inputs.title],
  ]));

  const entries: Entry[] = [
    entry("_lua/fontpack/main.lua", utf8Enc.encode(lua)),
    entry("_lua/fontpack/chaos_sup.ko", a.ko),
    entry("_lua/fontpack/chaos_icon.bin", a.iconBin),
    entry("_lua/fontpack/font.ttf", inputs.font),
  ];
  if (inputs.pkgName !== null) checkPkg(inputs.pkgName);
  const pkg = inputs.pkgName ?? pkgFor(inputs.font);
  const out = buildShell(entries, pkg, inputs.packName, preview);
  verifyBuilt(out, pkg, inputs.packName, entries);
  checkPackedLua(out, 1, [PH_FONT_NAME, PH_PACK_LABEL, PH_PACK_TITLE], inputs.label);
  return { bytes: out, pkgName: pkg, packName: inputs.packName };
}

/** 打完之后回读第 1 槽, 确认占位符一个不剩(PC 侧同一道门) */
function checkPackedLua(out: Uint8Array, idx: number, placeholders: string[], label: string): void {
  const [path, data] = readEntry(out, idx);
  if (!path.endsWith("main.lua")) throw new PackError(`第 ${idx} 槽不是投递 Lua: ${path}`);
  const txt = decodeUtf8(data);
  for (const ph of placeholders) {
    if (txt.includes(ph)) throw new PackError(`投递 Lua 里还留着 ${ph} 占位符`);
  }
  if (!txt.includes(`local FONT_NAME = "${label}"`)) {
    throw new PackError(`投递 Lua 里的短名不是「${label}」`);
  }
}

// ===== 图标包 =====

export const SHORT_BYTES = 12;
export const PH_PACK_NAME = "__PACK_NAME__";
// PH_PACK_TITLE 已在上方字体包段声明(两侧都是 "__PACK_TITLE__")

export interface IconPackInputs {
  /** 包短名(清单里的名字, 可打印 ASCII, <= 12 字节) */
  short: string;
  packName: string;
  title: string;
  pkgName: string | null;
  /** 要打进包的图标(未选的槽位不进包, 手环就保持系统原图标) */
  icons: Icon[];
}

export interface IconPackResult extends PackResult {
  iconCount: number;
}

export function buildIconPack(a: PackAssets, inputs: IconPackInputs, preview: Uint8Array): IconPackResult {
  const sb = utf8Enc.encode(inputs.short);
  if (sb.length === 0 || sb.length > SHORT_BYTES) {
    throw new PackError(`图标包短名要在 1..${SHORT_BYTES} 字节之间`);
  }
  for (const ch of inputs.short) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20 || c >= 0x7f) {
      throw new PackError(`图标包短名只能是可打印 ASCII: 「${inputs.short}」`);
    }
  }

  const cipk = buildCipk(inputs.icons);
  const lua = patchLua(a.iconLua, new Map([
    [PH_PACK_NAME, inputs.short],
    [PH_PACK_TITLE, inputs.title],
  ]));

  const entries: Entry[] = [
    entry("_lua/iconpack/main.lua", utf8Enc.encode(lua)),
    entry("_lua/iconpack/chaos_sup.ko", a.ko),
    entry("_lua/iconpack/chaos_icon.bin", a.iconBin),
    entry("_lua/iconpack/pack.bin", cipk),
  ];
  if (inputs.pkgName !== null) checkPkg(inputs.pkgName);
  const pkg = inputs.pkgName ?? pkgFor(cipk);
  const out = buildShell(entries, pkg, inputs.packName, preview);
  verifyBuilt(out, pkg, inputs.packName, entries);

  // 回读: 第 1 槽的短名替换干净, 第 4 槽的 CIPK 逐字节等于本次生成
  const [luaPath, luaData] = readEntry(out, 1);
  if (!luaPath.endsWith("main.lua")) throw new PackError("第 1 槽不是投递 Lua");
  const txt = decodeUtf8(luaData);
  for (const ph of [PH_PACK_NAME, PH_PACK_TITLE]) {
    if (txt.includes(ph)) throw new PackError(`投递 Lua 里还留着 ${ph} 占位符`);
  }
  if (!txt.includes(inputs.short)) throw new PackError(`投递 Lua 里没找到短名「${inputs.short}」`);
  const [packPath, packData] = readEntry(out, 4);
  if (!packPath.endsWith("pack.bin")) throw new PackError(`第 4 槽不是 CIPK: ${packPath}`);
  if (!bytesEqual(packData, cipk)) throw new PackError("pack.bin 与本次生成的容器不一致");
  const back = parseCipk(packData);
  if (back.length !== inputs.icons.length) throw new PackError("CIPK 解回来张数不对");
  back.forEach(([name, data], i) => {
    const ic = inputs.icons[i];
    if (name !== `${ic.stem}.bin`) throw new PackError(`第 ${i + 1} 张名字对不上: ${name}`);
    if (!bytesEqual(data, ic.data)) throw new PackError(`${name} 内容不一致`);
  });
  return { bytes: out, pkgName: pkg, packName: inputs.packName, iconCount: back.length };
}

/**
 * 把占位符换成本次的取值。map 里每个键都必须恰好出现一次 —— 与 PC 侧同一条纪律。
 *
 * 另外先把换行归一成 LF: 设备侧仓库里的 Lua 是 CRLF, 而 PC 侧打包器用文本模式读
 * (Python 会把 CRLF 折成 LF), 于是同一个模板两端产出的字节数会差"行数"那么多 ——
 * 逐字节对照测试就是靠这个差异发现的。归一只做一次。
 */
export function patchLua(src: string, map: Map<string, string>): string {
  const norm = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const [ph] of map) {
    const n = countOccurrences(norm, ph);
    if (n !== 1) throw new PackError(`投递 Lua 里 ${ph} 应恰好出现 1 次, 实际 ${n} 次`);
  }
  let out = norm;
  for (const [ph, v] of map) out = out.replace(ph, luaQuote(v));
  return out;
}

function countOccurrences(s: string, sub: string): number {
  let n = 0;
  let i = s.indexOf(sub);
  while (i >= 0) {
    n++;
    i = s.indexOf(sub, i + sub.length);
  }
  return n;
}

/**
 * 写成 Lua 双引号字面量。取值来自用户输入, 引号/反斜杠漏进去会在表盘的构建期
 * 抛错 => 整棵 UI 树不提交 => 切过去全黑(首版黑屏就是这一类)。
 */
export function luaQuote(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === "\\") out += "\\" + ch;
    else if (c < 0x20) out += "\\" + c;
    else out += ch;
  }
  return out;
}

