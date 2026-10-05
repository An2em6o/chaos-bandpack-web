/**
 * 投递包的字段级规矩: 包名、显示名的口径, 包名哈希, 以及产物回读。
 *
 * 容器壳的布局与合成在 `shellBuilder.ts`; 这里只放"与容器布局无关"的那些门。
 *
 * 两个真机事故刻在这里, 不是注释里的提醒:
 *   1. 显示名只占 `0x68..0xA8` 这 64 字节。多清到 `0xA8..0x100` 会把主题表前 88 字节抹掉
 *      => 表盘在列表里还在、切过去全黑、脚本一行不执行。
 *   2. 槽的内容语义必须与主包一致(lua / ko / 图标 / 载荷)。曾经把槽 3、4 放成文本占位,
 *      结果同上: 界面能看到、切过去全黑。
 *
 * TS 移植自 Kotlin `ShellWriter.kt`，与 PC 侧 `container_shell.py` 同口径。
 */
import {
  PKG_OFF,
  PKG_LEN,
  NAME_OFF,
  NAME_MAX,
  REC_OFF,
  BLOB_HDR_LEN,
} from "./shellBuilder";
import { sha256 } from "../hash/sha256";

export { PKG_OFF, PKG_LEN, NAME_OFF, NAME_MAX };

/** 主包的包名(表盘容器的身份键): 投递包不能与它相同, 否则固件视为同一个包。 */
export const MAIN_PKG = "979820260926";

const PKG_PREFIX = "4348";

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

const asciiDec = new TextDecoder("us-ascii");
const utf8Dec = new TextDecoder("utf-8");
const utf8Enc = new TextEncoder();

export function decodeAscii(b: Uint8Array): string {
  return asciiDec.decode(b);
}

export function encodeUtf8(s: string): Uint8Array {
  return utf8Enc.encode(s);
}

export function decodeUtf8(b: Uint8Array): string {
  return utf8Dec.decode(b);
}

/** 由载荷内容推导 12 位数字包名: 同一内容幂等, 不同内容自动分开(多个包可并存) */
export function pkgFor(blob: Uint8Array): string {
  const h = sha256(blob);
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + h[i];
  return PKG_PREFIX + String(n % 100_000_000).padStart(8, "0");
}

/** 手填包名校验(用户可以覆盖自动推导的号) */
export function checkPkg(pkg: string): void {
  if (!/^[0-9]{12}$/.test(pkg)) {
    throw new PackError(`表盘 ID 必须是 12 位数字, 现在是「${pkg}」`);
  }
}

/** 与主包撞号 = 同一个包, 侧载会被判重复安装 */
export function checkPkgAgainst(pkg: string, mainPkg: string = MAIN_PKG): void {
  if (pkg === mainPkg) {
    throw new PackError(`表盘 ID 撞上了主包号 ${mainPkg}, 侧载会判重复安装`);
  }
}

export function checkName(name: string): void {
  const n = utf8Enc.encode(name).length;
  if (n === 0) throw new PackError("表盘名称不能为空");
  if (n >= NAME_MAX) throw new PackError(`表盘名称太长(${n} 字节, 上限 ${NAME_MAX - 1} 字节)`);
}

/** 读回某条槽(1 起)的路径与内容 —— 打包后的自检与测试用 */
export function readEntry(out: Uint8Array, index1: number): [string, Uint8Array] {
  const off = readU32(out, REC_OFF + index1 * 16 + 8);
  const head = readU32(out, off);
  const dlen = head & 0xffffff;
  const plen = head >>> 24;
  const path = decodeAscii(out.subarray(off + BLOB_HDR_LEN, off + BLOB_HDR_LEN + plen));
  const data = out.slice(
    off + BLOB_HDR_LEN + plen,
    off + BLOB_HDR_LEN + plen + dlen,
  );
  return [path, data];
}

// ---- 小端读写 ----

export function readU32(b: Uint8Array, o: number): number {
  return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);
}

export function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

export function u32(v: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU32(out, 0, v);
  return out;
}
