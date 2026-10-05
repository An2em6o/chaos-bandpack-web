/**
 * 容器壳的从零合成（与 PC 侧 `tools/container_shell.py` 的 `build_shell()` 逐字节同构）。
 *
 * 为什么不再拿一份主包当模板: 模板会漂移(主包换壳/换号, App 还在用旧的), 而壳里真正
 * 需要继承的只有"主题表那几个指针与计数", 那些本来就是可以从文件条数算出来的派生量。
 * 自己算出来之后, 打包只需要三样输入: 内核模块、应用图标、投递 Lua。
 *
 * 布局(逐字段对过 PC 侧生成器与多个来源不同的容器):
 * ```
 * 0x00  u32 魔数 0x1234A55A     0x04 u32 设备码(10 Pro = 0x10000)
 * 0x10  u32 0x800               0x14 u32 0x10000    0x18 0    0x1C 主题数 = 1
 * 0x20  u32 记录表结束地址( = 预览块起点)              0x24 0
 * 0x28  12 字节包名 pkgName(身份键, 撞号 = 同一个包)
 * 0x68  64 字节显示名(UTF-8, NUL 补齐)
 * 0xA8  主题表: (0x80000000, 记录表结束, 1, 0x148)
 *       0xB8..0xFF 共 9 组 (u32,u32): 前 5 组的第二个字 = 首条文件记录地址,
 *       后 4 组的第二个字 = 尾标记地址; 0xD8 那组的第一个字 = 文件条数
 *       0x100.. 主题名(默认"样式1")
 * 0x148 记录表: 首条 (0, 0, 尾标记地址, 0x10) + 每条文件 (0x05000000|槽号, 0, 偏移, 长度)
 *       + 尾标记 (0x05000000, 0, 0, 0)
 *       [预览块 12 字节头 + 数据]
 *       [文件区: 每条 = u32((长度 & 0xFFFFFF) | (路径长 << 24)) + 16 字节零 + 路径 + 内容]
 * ```
 * 派生量只有三个: 记录表结束 = `0x148 + 16*(2 + 条数)`; 预览块起点 = 记录表结束;
 * 文件区起点 = 记录表结束 + 预览块长度。
 *
 * TS 移植自 Kotlin `ShellBuilder.kt`，判据是金标准样本 parse -> rebuild 逐字节相同。
 */
import {
  PackError,
  checkPkg,
  checkName,
  checkPkgAgainst,
  decodeAscii,
  decodeUtf8,
  encodeUtf8,
  readU32,
  writeU32,
  u32,
} from "./shellWriter";

export const MAGIC = 0x1234a55a;
export const DEVICE_CODE = 0x10000;
export const PREVIEW_TAG = 0x410;
export const PREVIEW_HDR = 12;

export const REC_OFF = 0x148;
export const PKG_OFF = 0x28;
export const PKG_LEN = 12;
export const NAME_OFF = 0x68;
export const NAME_MAX = 64;
export const THEME_OFF = 0xa8;
export const THEME_END = 0x148;
export const FILE_CNT_OFF = 0xd8;
export const THEME_NAME_OFF = 0x100;
export const THEME_NAME_MAX = THEME_END - THEME_NAME_OFF;
export const THEME_PTR_SLOTS = 5;
export const THEME_TAIL_SLOTS = 4;
export const REC_UID_BASE = 0x05000000;
export const BLOB_HDR_LEN = 20;
export const DEFAULT_THEME_NAME = "样式1";

/** 一条槽: 容器内路径 + 内容 */
export interface Entry {
  path: string;
  data: Uint8Array;
}

export function entry(path: string, data: Uint8Array): Entry {
  return { path, data };
}

export interface Parsed {
  files: Array<[string, Uint8Array]>;
  pkg: string;
  displayName: string;
  themeName: string;
  preview: Uint8Array;
  fileRegion: number;
}

export function recordEnd(fileCount: number): number {
  return REC_OFF + 16 * (2 + fileCount);
}

/** 一条文件在容器里的完整记录(含 20 字节小头) */
function blobFor(path: string, data: Uint8Array): Uint8Array {
  // 先按字符查, 再编码: 非打印 ASCII 的路径会被设备侧静默改写或直接不认,
  // 所以在打包侧就打死 —— 中文路径一个都不放过。
  for (const ch of path) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c >= 0x7f) {
      throw new PackError(`槽路径必须是可打印 ASCII: ${path}`);
    }
  }
  if (path.length === 0) throw new PackError(`槽路径必须是可打印 ASCII: ${path}`);
  const pb = new TextEncoder().encode(path); // 走到这里必为纯 ASCII
  if (data.length >= 1 << 24) throw new PackError(`${path} 超过单槽 24bit 长度上限(16MB)`);
  if (pb.length >= 256) throw new PackError(`槽路径太长: ${path}`);
  const head = u32((data.length & 0xffffff) | (pb.length << 24));
  const out = new Uint8Array(BLOB_HDR_LEN + pb.length + data.length);
  out.set(head, 0);
  out.set(pb, BLOB_HDR_LEN);
  out.set(data, BLOB_HDR_LEN + pb.length);
  return out;
}

/**
 * 合成一份完整容器。`preview` 是预览块原始字节(含 12 字节头)，按包生成。
 */
export function build(
  files: readonly Entry[],
  pkgName: string,
  displayName: string,
  preview: Uint8Array,
  themeName: string = DEFAULT_THEME_NAME,
  deviceCode: number = DEVICE_CODE,
): Uint8Array {
  checkPkg(pkgName);
  checkName(displayName);
  const pkg = new TextEncoder().encode(pkgName);
  const nb = encodeUtf8(displayName);
  const tb = encodeUtf8(themeName);
  if (tb.length > THEME_NAME_MAX) throw new PackError("主题名过长");
  checkPreview(preview);
  if (files.length < 1 || files.length >= 256) {
    throw new PackError(`文件条数必须在 1..255(槽号占一个字节), 现在 ${files.length}`);
  }

  const n = files.length;
  const recEnd = recordEnd(n);
  const firstRec = REC_OFF + 16;
  const tailRec = recEnd - 16;
  const fileRegion = recEnd + preview.length;

  const shell = new Uint8Array(fileRegion);
  writeU32(shell, 0x00, MAGIC);
  writeU32(shell, 0x04, deviceCode);
  writeU32(shell, 0x10, 0x800);
  writeU32(shell, 0x14, 0x10000);
  writeU32(shell, 0x1c, 1);
  writeU32(shell, 0x20, recEnd);
  shell.set(pkg, PKG_OFF);
  shell.set(nb, NAME_OFF);

  writeU32(shell, THEME_OFF, 0x80000000);
  writeU32(shell, THEME_OFF + 4, recEnd);
  writeU32(shell, THEME_OFF + 8, 1);
  writeU32(shell, THEME_OFF + 12, REC_OFF);
  for (let i = 0; i < THEME_PTR_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * i;
    writeU32(shell, at, at === FILE_CNT_OFF ? n : 0);
    writeU32(shell, at + 4, firstRec);
  }
  for (let i = 0; i < THEME_TAIL_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * (THEME_PTR_SLOTS + i);
    writeU32(shell, at, 0);
    writeU32(shell, at + 4, tailRec);
  }
  shell.set(tb, THEME_NAME_OFF);

  writeU32(shell, REC_OFF, 0);
  writeU32(shell, REC_OFF + 4, 0);
  writeU32(shell, REC_OFF + 8, tailRec);
  writeU32(shell, REC_OFF + 12, 0x10);

  const blobs: Uint8Array[] = [];
  let pos = fileRegion;
  files.forEach((e, i) => {
    const blob = blobFor(e.path, e.data);
    const at = REC_OFF + 16 * (1 + i);
    writeU32(shell, at, REC_UID_BASE + i);
    writeU32(shell, at + 4, 0);
    writeU32(shell, at + 8, pos);
    writeU32(shell, at + 12, blob.length);
    blobs.push(blob);
    pos += blob.length;
  });
  writeU32(shell, tailRec, REC_UID_BASE);
  writeU32(shell, tailRec + 4, 0);
  writeU32(shell, tailRec + 8, 0);
  writeU32(shell, tailRec + 12, 0);
  shell.set(preview, recEnd);

  const out = new Uint8Array(pos);
  out.set(shell, 0);
  let at2 = fileRegion;
  for (const b of blobs) {
    out.set(b, at2);
    at2 += b.length;
  }
  if (out.length !== pos) throw new PackError(`布局不自洽: 预期 ${pos} 实际 ${out.length}`);
  return out;
}

function hex(v: number): string {
  return "0x" + v.toString(16);
}

/** 预览块自检: 12 字节头 + 长度字段与实际长度必须自洽(块内编码是各端自己的事) */
export function checkPreview(preview: Uint8Array): void {
  if (preview.length < PREVIEW_HDR) throw new PackError("预览块太短");
  const tag = readU32(preview, 0);
  if (tag !== PREVIEW_TAG) throw new PackError(`预览块标签不对: ${hex(tag)}`);
  const plen = readU32(preview, 8);
  if (plen < 0 || preview.length !== PREVIEW_HDR + plen) {
    throw new PackError("预览块长度与头里的字段不符");
  }
}

/** 取产物里的预览块原始字节 */
export function previewOf(raw: Uint8Array): Uint8Array {
  const recEnd = readU32(raw, 0x20);
  const tag = readU32(raw, recEnd);
  if (tag !== PREVIEW_TAG) throw new PackError(`预览块标签不对: ${hex(tag)}`);
  const plen = readU32(raw, recEnd + 8);
  if (recEnd + PREVIEW_HDR + plen > raw.length) throw new PackError("预览块越界");
  return raw.slice(recEnd, recEnd + PREVIEW_HDR + plen);
}

/**
 * 打包的最后一道门: 把自己刚写出来的字节拆回来逐字段核对。
 *
 * 改成核对派生关系是否自洽(条数 -> 记录表结束 -> 预览块起点 -> 文件区起点),
 * 以及每条记录是否真能按自己的偏移取到完整的路径与内容。
 */
export function parse(raw: Uint8Array): Parsed {
  if (raw.length < REC_OFF + 16 * 3) throw new PackError("容器太短");
  if (readU32(raw, 0) !== MAGIC) throw new PackError("容器魔数不符");
  if (readU32(raw, 4) !== DEVICE_CODE) {
    throw new PackError("设备码不是 10 Pro(0x10000)");
  }
  const n = readU32(raw, FILE_CNT_OFF);
  if (n < 1 || n > 255) throw new PackError(`文件条数非法: ${n}`);
  const recEnd = readU32(raw, 0x20);
  if (recEnd !== recordEnd(n)) throw new PackError(`记录表结束地址与条数不符: ${recEnd}`);
  if (readU32(raw, THEME_OFF + 4) !== recEnd) {
    throw new PackError("主题表的记录表指针与 0x20 不一致");
  }
  if (readU32(raw, THEME_OFF) !== 0x80000000) {
    throw new PackError("主题表首字不对");
  }
  if (readU32(raw, THEME_OFF + 8) !== 1) throw new PackError("主题数不是 1");
  if (readU32(raw, THEME_OFF + 12) !== REC_OFF) {
    throw new PackError("主题表里的记录表地址不对");
  }
  const firstRec = REC_OFF + 16;
  const tailRec = recEnd - 16;
  for (let i = 0; i < THEME_PTR_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * i;
    const cnt = readU32(raw, at);
    if (cnt !== (at === FILE_CNT_OFF ? n : 0)) throw new PackError(`主题表计数槽 ${i} 不对`);
    if (readU32(raw, at + 4) !== firstRec) throw new PackError(`主题表首记录指针 ${i} 不对`);
  }
  for (let i = 0; i < THEME_TAIL_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * (THEME_PTR_SLOTS + i);
    if (readU32(raw, at) !== 0) throw new PackError(`主题表尾槽 ${i} 计数不是 0`);
    if (readU32(raw, at + 4) !== tailRec) throw new PackError(`主题表尾记录指针 ${i} 不对`);
  }
  if (
    readU32(raw, REC_OFF) !== 0 ||
    readU32(raw, REC_OFF + 12) !== 0x10 ||
    readU32(raw, REC_OFF + 8) !== tailRec
  ) {
    throw new PackError("记录表首条形状不对");
  }
  if (
    readU32(raw, tailRec) !== REC_UID_BASE ||
    readU32(raw, tailRec + 4) !== 0 ||
    readU32(raw, tailRec + 8) !== 0 ||
    readU32(raw, tailRec + 12) !== 0
  ) {
    throw new PackError("尾标记不对");
  }

  const preview = previewOf(raw);
  const fileRegion = recEnd + preview.length;
  const files: Array<[string, Uint8Array]> = [];
  let expectOff = fileRegion;
  for (let i = 0; i < n; i++) {
    const at = REC_OFF + 16 * (1 + i);
    if (readU32(raw, at) !== REC_UID_BASE + i) {
      throw new PackError(`第 ${i + 1} 条记录的槽号不对`);
    }
    const off = readU32(raw, at + 8);
    const len = readU32(raw, at + 12);
    if (off !== expectOff) throw new PackError(`第 ${i + 1} 条记录起点不连续: ${off}`);
    if (len < BLOB_HDR_LEN || off + len > raw.length) throw new PackError(`第 ${i + 1} 条记录越界`);
    const head = readU32(raw, off);
    const dlen = head & 0xffffff;
    const plen = head >>> 24;
    if (BLOB_HDR_LEN + plen + dlen !== len) throw new PackError(`第 ${i + 1} 条小头长度对不上`);
    for (let k = 4; k < BLOB_HDR_LEN; k++) {
      if (raw[off + k] !== 0) throw new PackError(`第 ${i + 1} 条小头保留字节非 0`);
    }
    const path = decodeAscii(raw.subarray(off + BLOB_HDR_LEN, off + BLOB_HDR_LEN + plen));
    const data = raw.slice(off + BLOB_HDR_LEN + plen, off + len);
    files.push([path, data]);
    expectOff += len;
  }
  if (expectOff !== raw.length) {
    throw new PackError(`文件区结尾多出 ${raw.length - expectOff} 字节`);
  }

  const zeroAt = raw.indexOf(0, NAME_OFF);
  const zero = (zeroAt >= 0 && zeroAt < NAME_OFF + NAME_MAX ? zeroAt : NAME_OFF + NAME_MAX) - NAME_OFF;
  const themeZeroAt = raw.indexOf(0, THEME_NAME_OFF);
  const themeZero =
    (themeZeroAt >= 0 && themeZeroAt < THEME_NAME_OFF + THEME_NAME_MAX
      ? themeZeroAt
      : THEME_NAME_OFF + THEME_NAME_MAX) - THEME_NAME_OFF;
  return {
    files,
    pkg: decodeAscii(raw.subarray(PKG_OFF, PKG_OFF + PKG_LEN)),
    displayName: decodeUtf8(raw.subarray(NAME_OFF, NAME_OFF + zero)),
    themeName: decodeUtf8(raw.subarray(THEME_NAME_OFF, THEME_NAME_OFF + themeZero)),
    preview,
    fileRegion,
  };
}

/** 与 Kotlin 侧 verifyBuilt 同口径: 拆回刚写出的字节, 核对包名/显示名/槽数/内容 */
export function verifyBuilt(
  out: Uint8Array,
  pkgName: string,
  packName: string,
  entries: readonly Entry[],
): void {
  const p = parse(out);
  if (p.pkg !== pkgName) throw new PackError(`包名写错: ${p.pkg}`);
  if (p.displayName !== packName) throw new PackError(`表盘名写错: ${p.displayName}`);
  if (p.files.length !== entries.length) {
    throw new PackError(`槽数不符: 期望 ${entries.length}, 实际 ${p.files.length}`);
  }
  entries.forEach((e, i) => {
    const [path, data] = p.files[i];
    if (path !== e.path) throw new PackError(`第 ${i + 1} 槽路径不符: ${path}`);
    if (!bytesEqual(data, e.data)) throw new PackError(`第 ${i + 1} 槽内容不一致: ${path}`);
  });
  checkPkgAgainst(pkgName);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
