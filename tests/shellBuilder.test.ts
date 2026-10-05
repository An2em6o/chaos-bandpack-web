/**
 * 容器壳「合成器 + 解析器」的金标准对拍 —— 与 Kotlin 侧 `ShellBuilderTest` 同一组判据:
 *
 * 拿 PC 侧生成器(`tools/container_shell.py`)造的样本当金标准: 先拆开(证明两侧对同一套
 * 布局的理解一致), 再用拆出来的输入重新合成, 必须逐字节相同。
 * 样本是原仓库自造的占位数据, 不含任何第三方字节, 跟着仓库走。
 *
 * 这组测试就是 TS 移植的验收线: 通过 = 网页版打的容器壳与 Kotlin/PC 侧逐字节等价。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as SB from "../src/lib/pack/shellBuilder";
import { checkPreview } from "../src/lib/pack/shellBuilder";
import {
  PackError,
  checkPkg,
  checkPkgAgainst,
  checkName,
  readEntry,
  readU32,
} from "../src/lib/pack/shellWriter";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

interface Case { file: string; slots: number; pkg: string; display: string }
const cases: Case[] = [
  { file: "golden-one.bin", slots: 1, pkg: "434811111111", display: "字:一号" },
  { file: "golden-four.bin", slots: 4, pkg: "434822222222", display: "图标:四号" },
  { file: "golden-ten.bin", slots: 10, pkg: "434833333333", display: "字:十号" },
];

describe("PC 侧金标准容器", () => {
  it("能拆回来并逐字节重建", () => {
    for (const c of cases) {
      const golden = fixture(c.file);
      const p = SB.parse(golden);

      expect(p.files.length, `${c.file} 槽数`).toBe(c.slots);
      expect(p.pkg, `${c.file} 包名`).toBe(c.pkg);
      expect(p.displayName, `${c.file} 显示名`).toBe(c.display);
      expect(p.themeName, `${c.file} 主题名`).toBe(SB.DEFAULT_THEME_NAME);

      const recEnd = readU32(golden, 0x20);
      expect(recEnd, `${c.file} 记录表结束地址`).toBe(SB.recordEnd(c.slots));
      expect(p.fileRegion, `${c.file} 文件区起点`).toBe(recEnd + p.preview.length);

      const rebuilt = SB.build(
        p.files.map(([path, data]) => SB.entry(path, data)),
        p.pkg, p.displayName, p.preview, p.themeName,
      );
      expect(Buffer.from(rebuilt).equals(Buffer.from(golden)), `${c.file} 重建不是逐字节相同`).toBe(true);
    }
  });

  it("产物里每条槽的路径与内容都能按记录表取回", () => {
    const golden = fixture("golden-four.bin");
    const p = SB.parse(golden);
    expect(p.files.map(([path]) => path)).toEqual([
      "_lua/iconpack/main.lua", "_lua/iconpack/chaos_sup.ko",
      "_lua/iconpack/chaos_icon.bin", "_lua/iconpack/pack.bin",
    ]);
    p.files.forEach(([path, data], i) => {
      const [path2, data2] = readEntry(golden, i + 1);
      expect(path).toBe(path2);
      expect(Buffer.from(data).equals(Buffer.from(data2))).toBe(true);
    });
    expect(new TextDecoder().decode(p.files[0][1])).toContain('local PACK_NAME = "四号"');
  });
});

describe("拆包的自检门", () => {
  it("改一个字节就会被发现", () => {
    const golden = fixture("golden-four.bin");
    const bad1 = golden.slice();
    bad1[SB.REC_OFF + 16] = 0x7f;
    expect(() => SB.parse(bad1)).toThrow(PackError);

    const bad2 = golden.slice();
    bad2[SB.FILE_CNT_OFF] = 5;
    expect(() => SB.parse(bad2)).toThrow(PackError);

    const off = readU32(golden, SB.REC_OFF + 16 + 8);
    const bad3 = golden.slice();
    bad3[off + 6] = 1;
    expect(() => SB.parse(bad3)).toThrow(PackError);

    expect(() => SB.parse(concat(golden, new Uint8Array(1)))).toThrow(PackError);
  });

  it("预览块自检", () => {
    const good = SB.previewOf(fixture("golden-one.bin"));
    checkPreview(good);

    const badTag = good.slice();
    badTag[0] = 0x11;
    expect(() => checkPreview(badTag)).toThrow(PackError);

    const badLen = good.slice();
    badLen[8] = (badLen[8] + 1) & 0xff;
    expect(() => checkPreview(badLen)).toThrow(PackError);

    expect(() => checkPreview(new Uint8Array(4))).toThrow(PackError);
  });
});

describe("输入门", () => {
  const good = SB.previewOf(fixture("golden-one.bin"));
  const files = [SB.entry("a.bin", new Uint8Array(3))];

  it("空槽列表被拒绝", () => {
    expect(() => SB.build([], "434800000001", "x", good)).toThrow(PackError);
  });

  it("路径不是可打印 ASCII 被拒绝", () => {
    expect(() =>
      SB.build([SB.entry("中文.bin", new Uint8Array(3))], "434800000001", "x", good),
    ).toThrow(PackError);
  });

  it("256 条槽必须被拒, 255 条可以", () => {
    const many = Array.from({ length: 256 }, (_, i) => SB.entry(`f${i}.bin`, new Uint8Array(1)));
    expect(() => SB.build(many, "434800000001", "x", good)).toThrow(PackError);
    const max = Array.from({ length: 255 }, (_, i) => SB.entry(`f${i}.bin`, new Uint8Array(1)));
    expect(SB.parse(SB.build(max, "434800000001", "x", good)).files.length).toBe(255);
  });

  it("包名口径", () => {
    expect(() => SB.build(files, "43480000001", "x", good)).toThrow(PackError);
    expect(() => SB.build(files, "43480000000a", "x", good)).toThrow(PackError);
    expect(() => checkPkg("43482026092")).toThrow(PackError);
    expect(() => checkPkgAgainst("979820260926")).toThrow(PackError);
    expect(() => checkPkgAgainst("434800000001")).not.toThrow();
  });

  it("显示名上限 63 字节", () => {
    SB.build(files, "434800000001", "名".repeat(21), good);
    expect(() => SB.build(files, "434800000001", "名".repeat(22), good)).toThrow(PackError);
    expect(() => checkName("很".repeat(30))).toThrow(PackError);
    expect(() => SB.build(files, "434800000001", "", good)).toThrow(PackError);
  });
});

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
