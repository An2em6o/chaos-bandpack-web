/**
 * 图标包容器(CIPK) —— 手环侧 `icon_pack.lua` 按这个格式解包, 两侧必须逐字节一致:
 *
 *   [4 字节 ASCII 'CIPK'][u32 张数]
 *   张数 次: [u32 数据长度][u8 名字长度][名字][数据]
 *
 * 名字形如 `<stem>.bin`(ASCII, `^[A-Za-z0-9_]+\.bin$`, 24 字节以内)；手环只认
 * 内核桌面表与系统资源重定向表中的 stem。
 *
 * TS 移植自 Kotlin `Cipk.kt`。
 */
import { readU32, writeU32 } from "./shellWriter";

export const CIPK_MAGIC = "CIPK";
export const NAME_MAX = 24;
export const ICON_LEN_MAX = 0x80000; // 单张上限 512KB(与 Lua 侧的门一致)
export const COUNT_MAX = 64;

const NAME_RE = /^[A-Za-z0-9_]+\.bin$/;
const enc = new TextEncoder();

export class CipkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CipkError";
  }
}

/** 一张图标: stem(不带扩展名) + 按槽位规格转换的图标 bin */
export interface Icon {
  stem: string;
  data: Uint8Array;
}

export function icon(stem: string, data: Uint8Array): Icon {
  return { stem, data };
}

export function fileNameOf(i: Icon): string {
  return `${i.stem}.bin`;
}

export function buildCipk(icons: readonly Icon[]): Uint8Array {
  if (icons.length === 0) throw new CipkError("一张图标都没有, 打不出包");
  if (icons.length > COUNT_MAX) throw new CipkError(`图标张数超过上限 ${COUNT_MAX}`);
  const seen = new Set<string>();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const head = new Uint8Array(8);
  head.set(enc.encode(CIPK_MAGIC), 0);
  writeU32(head, 4, icons.length);
  chunks.push(head);
  total += head.length;
  for (const i of icons) {
    const nb = enc.encode(fileNameOf(i));
    if (nb.length > NAME_MAX) throw new CipkError(`图标文件名太长: ${fileNameOf(i)}`);
    if (!NAME_RE.test(fileNameOf(i))) throw new CipkError(`图标文件名不合规: ${fileNameOf(i)}`);
    if (seen.has(i.stem)) throw new CipkError(`图标重复: ${i.stem}`);
    seen.add(i.stem);
    if (i.data.length === 0 || i.data.length > ICON_LEN_MAX) {
      throw new CipkError(`${fileNameOf(i)} 长度 ${i.data.length} 超出单张上限 ${ICON_LEN_MAX}`);
    }
    const piece = new Uint8Array(5 + nb.length + i.data.length);
    writeU32(piece, 0, i.data.length);
    piece[4] = nb.length;
    piece.set(nb, 5);
    piece.set(i.data, 5 + nb.length);
    chunks.push(piece);
    total += piece.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** 解回来(自检与测试用)。任何越界/坏长度直接抛。 */
export function parseCipk(blob: Uint8Array): Array<[string, Uint8Array]> {
  if (blob.length < 8 || new TextDecoder("ascii").decode(blob.subarray(0, 4)) !== CIPK_MAGIC) {
    throw new CipkError("CIPK 魔数不符");
  }
  const count = readU32(blob, 4);
  if (count < 1 || count > COUNT_MAX) throw new CipkError(`张数非法: ${count}`);
  const out: Array<[string, Uint8Array]> = [];
  let pos = 8;
  for (let idx = 0; idx < count; idx++) {
    if (pos + 5 > blob.length) throw new CipkError(`第 ${idx + 1} 张长度头越界`);
    const len = readU32(blob, pos);
    const nl = blob[pos + 4];
    pos += 5;
    if (nl < 1 || nl > NAME_MAX) throw new CipkError(`第 ${idx + 1} 张名字长度非法: ${nl}`);
    if (pos + nl > blob.length) throw new CipkError(`第 ${idx + 1} 张名字越界`);
    const name = new TextDecoder("ascii").decode(blob.subarray(pos, pos + nl));
    if (!NAME_RE.test(name)) throw new CipkError(`第 ${idx + 1} 张名字不合规: ${name}`);
    pos += nl;
    if (pos + len > blob.length) throw new CipkError(`第 ${idx + 1} 张数据越界`);
    out.push([name, blob.slice(pos, pos + len)]);
    pos += len;
  }
  if (pos !== blob.length) throw new CipkError(`容器尾部多出 ${blob.length - pos} 字节`);
  return out;
}
