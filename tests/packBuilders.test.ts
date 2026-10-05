/**
 * 打包链第二批次对拍 —— 与 Kotlin 侧 `PackWriterTest` "跟着仓库走的那一组"同判据:
 * 用合成的 Lua 模板与占位载荷把两种包打出来, 再拆回来核对结构。
 */
import { describe, it, expect } from "vitest";
import { PackError, checkName, pkgFor, readEntry } from "../src/lib/pack/shellWriter";
import { parse as parseShell, verifyBuilt, build as buildShell } from "../src/lib/pack/shellBuilder";
import {
  buildFontPack,
  buildIconPack,
  luaQuote,
  patchLua,
  PH_PACK_NAME,
  PH_PACK_TITLE,
  PH_FONT_NAME,
  type PackAssets,
} from "../src/lib/pack/packBuilders";
import * as TitleText from "../src/lib/pack/titleText";
import { buildCipk, parseCipk, CipkError, icon } from "../src/lib/pack/cipk";

/** 合成模板: 占位符各出现一次, 打包器的门就是照这个口径立的 */
const fakeAssets: PackAssets = {
  ko: Uint8Array.from({ length: 64 }, (_, i) => i & 0xff),
  iconBin: Uint8Array.from({ length: 48 }, (_, i) => (i * 3) & 0xff),
  fontLua:
    'local FONT_NAME = "__FONT_NAME__"\n' +
    'local PACK_LABEL = "__PACK_LABEL__"\n' +
    'local PACK_TITLE = "__PACK_TITLE__"\n',
  iconLua:
    'local PACK_NAME = "__PACK_NAME__"\n' +
    'local PACK_TITLE = "__PACK_TITLE__"\n',
};

/** 一块合法的预览(头 + 任意载荷): 打包器只校验头与长度自洽 */
function fakePreview(size = 512): Uint8Array {
  const payload = Uint8Array.from({ length: size }, (_, i) => (i * 31) % 251);
  const head = new Uint8Array(12);
  head[0] = 0x10;
  head[1] = 0x04;
  head[4] = 0x50;
  head[5] = 0x01;
  head[6] = 0xe0;
  head[7] = 0x01;
  head[8] = size & 0xff;
  head[9] = (size >> 8) & 0xff;
  head[10] = (size >> 16) & 0xff;
  const out = new Uint8Array(12 + size);
  out.set(head, 0);
  out.set(payload, 12);
  return out;
}

describe("字体包结构", () => {
  it("四槽结构正确且记录表与预览块自洽", () => {
    const font = Uint8Array.from({ length: 1024 }, (_, i) => i % 251);
    const preview = fakePreview(5000);
    const res = buildFontPack(fakeAssets, {
      label: "文楷", packName: "字:文楷", title: "字体投递 文楷", pkgName: null, font,
    }, preview);

    const p = parseShell(res.bytes);
    expect(p.files.length).toBe(4);
    expect(p.files.map(([path]) => path)).toEqual([
      "_lua/fontpack/main.lua", "_lua/fontpack/chaos_sup.ko",
      "_lua/fontpack/chaos_icon.bin", "_lua/fontpack/font.ttf",
    ]);
    expect(res.pkgName).toBe(pkgFor(font));
    expect(p.displayName).toBe("字:文楷");
    expect(Buffer.from(p.preview).equals(Buffer.from(preview))).toBe(true);
    expect(Buffer.from(p.files[1][1]).equals(Buffer.from(fakeAssets.ko))).toBe(true);
    expect(Buffer.from(p.files[2][1]).equals(Buffer.from(fakeAssets.iconBin))).toBe(true);
    expect(Buffer.from(p.files[3][1]).equals(Buffer.from(font))).toBe(true);
    const lua = new TextDecoder().decode(p.files[0][1]);
    for (const ph of [PH_FONT_NAME, "__PACK_LABEL__", PH_PACK_TITLE]) {
      expect(lua.includes(ph)).toBe(false);
    }
    expect(lua).toContain('local PACK_TITLE = "字体投递 文楷"');
    expect(lua).toContain('local FONT_NAME = "文楷"');
    expect(res.pkgName).not.toBe("979820260926");
  });

  it("手动指定包名时撞主包号会被拒绝", () => {
    expect(() =>
      buildFontPack(fakeAssets, {
        label: "x", packName: "字:x", title: "字体投递 x",
        pkgName: "979820260926", font: new Uint8Array(16),
      }, fakePreview(64)),
    ).toThrow(PackError);
  });

  it("非法输入被明确拒绝", () => {
    expect(() =>
      buildFontPack(fakeAssets, {
        label: "这是一个很长的名字", packName: "字:x", title: "字体投递 x",
        pkgName: null, font: new Uint8Array(16),
      }, fakePreview(64)),
    ).toThrow(PackError);
    expect(() => checkName("很".repeat(30))).toThrow(PackError);
  });

  it("标题里的引号会被转义, 不破坏 Lua", () => {
    const res = buildFontPack(fakeAssets, {
      label: "x", packName: "字:x", title: '标题"带\\引号', pkgName: null, font: new Uint8Array(32),
    }, fakePreview(64));
    const lua = new TextDecoder().decode(parseShell(res.bytes).files[0][1]);
    expect(lua).toContain('local PACK_TITLE = "标题\\"带\\\\引号"');
  });
});

describe("图标包结构", () => {
  it("四槽结构正确且 CIPK 往返一致", () => {
    const icons = [icon("alarm", new Uint8Array(120).fill(7)), icon("heartrate", new Uint8Array(90).fill(9))];
    const res = buildIconPack(fakeAssets, {
      short: "Demo", packName: "图标:Demo", title: "图标投递 Demo", pkgName: null, icons,
    }, fakePreview(800));

    const p = parseShell(res.bytes);
    expect(p.files.length).toBe(4);
    expect(res.iconCount).toBe(2);
    expect(p.files.map(([path]) => path)).toEqual([
      "_lua/iconpack/main.lua", "_lua/iconpack/chaos_sup.ko",
      "_lua/iconpack/chaos_icon.bin", "_lua/iconpack/pack.bin",
    ]);
    const cipk = p.files[3][1];
    expect(res.pkgName).toBe(pkgFor(cipk));
    const back = parseCipk(cipk);
    expect(back.length).toBe(2);
    expect(back[0][0]).toBe("alarm.bin");
    expect(Buffer.from(back[0][1]).equals(Buffer.from(icons[0].data))).toBe(true);
    const lua = new TextDecoder().decode(p.files[0][1]);
    expect(lua).toContain('local PACK_NAME = "Demo"');
  });

  it("图标包短名只能是可打印 ASCII", () => {
    expect(() =>
      buildIconPack(fakeAssets, {
        short: "中文", packName: "图标:中文", title: "图标投递 中文",
        pkgName: null, icons: [icon("alarm", new Uint8Array(8))],
      }, fakePreview(64)),
    ).toThrow(PackError);
  });
});

describe("模板占位符纪律", () => {
  it("CRLF 归一成 LF", () => {
    const crlf: PackAssets = {
      ko: new Uint8Array(4), iconBin: new Uint8Array(4),
      fontLua: 'local FONT_NAME = "__FONT_NAME__"\r\nlocal PACK_TITLE = "__PACK_TITLE__"\r\n',
      iconLua: 'local PACK_NAME = "__PACK_NAME__"\r\nlocal PACK_TITLE = "__PACK_TITLE__"\r\n',
    };
    const out = patchLua(crlf.fontLua, new Map([[PH_FONT_NAME, "a"], [PH_PACK_TITLE, "b"]]));
    expect(out.includes("\r")).toBe(false);
  });

  it("占位符出现两次或少于一次都打死", () => {
    const twice = 'local FONT_NAME = "__FONT_NAME__"\nlocal X = "__FONT_NAME__"\n';
    expect(() => patchLua(twice, new Map([[PH_FONT_NAME, "a"]]))).toThrow(PackError);
    expect(() => patchLua("local A = 1\n", new Map([[PH_FONT_NAME, "a"]]))).toThrow(PackError);
  });

  it("控制字符走十进制转义", () => {
    expect(luaQuote("a\u0007b")).toBe("a\\7b");
  });
});

describe("TitleText 宽度口径", () => {
  it("与 Kotlin 侧同一组用例", () => {
    expect(TitleText.width("字体投递 花朝粗")).toBe(15);
    expect(TitleText.validate("字体投递 花朝粗")).toBeNull();
    expect(TitleText.width("字体投递花朝粗体")).toBe(16);
    expect(TitleText.validate("字体投递花朝粗体")).toBeNull();
    const msg = TitleText.validate("字体投递花朝粗字体");
    expect(msg).toContain("16");
    expect(TitleText.width("Font Deluxe")).toBe(11);
    expect(TitleText.validate("Font Deluxe Pack")).toBeNull();
    expect(TitleText.validate("   ")).not.toBeNull();
  });
});

describe("CIPK 往返与边界", () => {
  it("往返一致", () => {
    const icons = [icon("alarm", Uint8Array.from({ length: 100 }, () => 1)), icon("sports_record", Uint8Array.from({ length: 50 }, () => 2))];
    const blob = buildCipk(icons);
    const back = parseCipk(blob);
    expect(back.length).toBe(2);
    expect(back[0][0]).toBe("alarm.bin");
    expect(Buffer.from(back[0][1]).equals(Buffer.from(icons[0].data))).toBe(true);
    expect(back[1][0]).toBe("sports_record.bin");
  });

  it("空列表 / 重复 stem / 非法名字 / 尾部多字节", () => {
    const icons = [icon("alarm", new Uint8Array(100))];
    expect(() => buildCipk([])).toThrow(CipkError);
    expect(() => buildCipk([icons[0], icons[0]])).toThrow(CipkError);
    expect(() => buildCipk([icon("bad-name", new Uint8Array(4))])).toThrow(CipkError);
    const blob = buildCipk(icons);
    expect(() => parseCipk(new Uint8Array([...blob, 0, 0, 0]))).toThrow(CipkError);
  });
});

describe("verifyBuilt 独立回读", () => {
  it("拆回来的容器与输入一致", () => {
    const preview = fakePreview(64);
    const entries = [
      { path: "a.bin", data: new Uint8Array(3).fill(1) },
      { path: "b.bin", data: new Uint8Array(5).fill(2) },
    ];
    const out = buildShell(entries, "434800000001", "测试", preview);
    expect(() => verifyBuilt(out, "434800000001", "测试", entries)).not.toThrow();
    const [, data] = readEntry(out, 2);
    expect(Buffer.from(data).equals(Buffer.from(entries[1].data))).toBe(true);
  });
});
