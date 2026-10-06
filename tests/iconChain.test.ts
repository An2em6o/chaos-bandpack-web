/**
 * LVGL 编解码往返 + IconConvert 行为校验（无外部素材，合成像素）。
 * 预览像素各端各自渲染不比字节，但编解码与几何口径必须与 Kotlin 侧一致。
 */
import { describe, it, expect } from "vitest";
import { bgra, decode, indexedRle, lvglHeader } from "../src/lib/icon/lvglIconCodec";
import { convert, BlankError, NoPlateError } from "../src/lib/icon/iconConvert";
import { CANVAS, CONTENT, MARGIN, OUT_BYTES, DESKTOP, CONTROL, SLOTS, matchName, exportIcons, slotCanvas } from "../src/lib/icon/iconSpec";
import { buildIconPack } from "../src/lib/pack/packBuilders";
import { parse as parseShell } from "../src/lib/pack/shellBuilder";
import { parseCipk } from "../src/lib/pack/cipk";

/** 合成一张带底板的圆角方块图: side×side, 底板 alpha=255, 内容透明区 alpha=0 */
function makePlateImage(size: number): { pixels: Uint32Array; w: number; h: number } {
  const w = size;
  const h = size;
  const pixels = new Uint32Array(w * h).fill(0x00000000);
  const r = Math.floor(size * 0.15);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角判断
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      if (dx < r && dy < r && (r - dx) * (r - dx) + (r - dy) * (r - dy) > r * r) continue;
      // 中间画一个蓝色圆点当内容
      const cx = size / 2;
      const cy = size / 2;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < size * 0.2) pixels[y * w + x] = 0xffe07020; // BGRA int 里按 ARGB 存: A=FF R=E0 G=70 B=20
      else pixels[y * w + x] = 0xff202020; // 深灰底板
    }
  }
  return { pixels, w, h };
}

describe("LVGL 编解码", () => {
  it("header 字段", () => {
    const h = lvglHeader(112, 112, 16, 0, 448);
    expect(h[0]).toBe(0x19);
    expect(h[1]).toBe(16);
    const dv = new DataView(h.buffer);
    expect(dv.getUint16(4, true)).toBe(112);
    expect(dv.getUint16(8, true)).toBe(448);
  });

  it("BGRA 往返一致", () => {
    const w = 8, h = 8;
    const pixels = new Uint32Array(w * h).map((_, i) => (0xff000000 | (i * 7)) >>> 0);
    const bin = bgra(pixels, w, h);
    expect(bin.length).toBe(12 + w * h * 4);
    const img = decode(bin);
    expect(img.width).toBe(w);
    expect(img.height).toBe(h);
    expect(Array.from(img.pixels)).toEqual(Array.from(pixels));
  });

  it("I8/RLE 往返一致(透明保留)", () => {
    const w = 16, h = 16;
    const pixels = new Uint32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      pixels[i] = i % 3 === 0 ? 0x00000000 : (0xff000000 | ((i * 11) & 0xffffff)) >>> 0;
    }
    const bin = indexedRle(pixels, w, h);
    expect(bin.length).toBeLessThanOrEqual(1024 + w * h);
    const img = decode(bin);
    expect(img.width).toBe(w);
    // 透明像素必须仍是透明; 非透明像素经调色板量化后 alpha 保留
    for (let i = 0; i < w * h; i++) {
      if (pixels[i] >>> 24 === 0) expect(img.pixels[i] >>> 24).toBe(0);
      else expect(img.pixels[i] >>> 24).toBe(0xff);
    }
  });

  it("超过 255 色走中位切分量化", () => {
    const w = 32, h = 32;
    const pixels = new Uint32Array(w * h);
    let seed = 1;
    for (let i = 0; i < w * h; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pixels[i] = (0xff000000 | (seed & 0xffffff)) >>> 0;
    }
    const bin = indexedRle(pixels, w, h);
    const img = decode(bin);
    expect(img.width).toBe(w);
    expect(img.height).toBe(h);
  });
});

describe("IconConvert", () => {
  it("桌面图标: 尺寸 50188 字节, 头正确, decode 回来 112×112", () => {
    const { pixels, w, h } = makePlateImage(300);
    const [bin, report] = convert(pixels, w, h, DESKTOP[2] /* alarm */);
    expect(bin.length).toBe(OUT_BYTES);
    expect(bin[0]).toBe(0x19);
    expect(report.scaled).toBe(CONTENT);
    const img = decode(bin);
    expect(img.width).toBe(CANVAS);
    expect(img.height).toBe(CANVAS);
    // 边缘 6px 是 MARGIN 透明带; 中心是底板(不透明)
    expect(img.pixels[0] >>> 24).toBe(0);
    expect(img.pixels[56 * CANVAS + 56] >>> 24).toBe(0xff);
  });

  it("透明底裸图形被拒", () => {
    const w = 100, h = 100;
    const pixels = new Uint32Array(w * h).fill(0x00000000);
    // alpha=100: 高于 ALPHA_HIT(算内容) 但低于 ALPHA_PLATE(不算底板)
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) pixels[y * w + x] = 0x64202020;
    expect(() => convert(pixels, w, h, DESKTOP[2])).toThrow(NoPlateError);
  });

  it("全透明被拒", () => {
    expect(() => convert(new Uint32Array(50 * 50), 50, 50, DESKTOP[2])).toThrow(BlankError);
  });

  it("系统图标(64×64, 保留透明边缘)", () => {
    const w = 200, h = 200;
    const pixels = new Uint32Array(w * h).fill(0x00000000);
    for (let y = 30; y < 170; y++) {
      for (let x = 30; x < 170; x++) {
        pixels[y * w + x] = (0xff000000 | ((x * 3) << 8) | 0x8020) >>> 0;
      }
    }
    const slot = CONTROL[6] /* ctrl_disturb */;
    const [bin, report] = convert(pixels, w, h, slot);
    expect(report.scaled).toBe(slotCanvas(slot));
    const img = decode(bin);
    expect(img.width).toBe(64);
    expect(img.height).toBe(64);
    // 外接框被实心内容填满 -> 缩放后四角也是不透明的
    expect(img.pixels[0] >>> 24).toBe(0xff);
  });
});

describe("IconSpec", () => {
  it("137 个槽位: 桌面 36 + 控制中心 9 + 设置 10 + 卡包 82", () => {
    expect(SLOTS.length).toBe(137);
    expect(SLOTS.filter((s) => s.group === "DESKTOP").length).toBe(36);
    expect(SLOTS.filter((s) => s.group === "CONTROL").length).toBe(9);
    expect(SLOTS.filter((s) => s.group === "SETTINGS").length).toBe(10);
    expect(SLOTS.filter((s) => s.group === "CARD").length).toBe(82);
  });

  it("精确匹配英文名或分类中文名; 未注明分类的重名不匹配", () => {
    expect(matchName("alarm")?.stem).toBe("alarm");
    expect(matchName("heartrate")?.stem).toBe("heartrate");
    // "闹钟" 在桌面与控制中心都有 -> singleOrNull 为空, 与 Kotlin 一致
    expect(matchName("闹钟")).toBeUndefined();
    expect(matchName("ctrl_disturb")?.stem).toBe("ctrl_disturb");
    expect(matchName("控制中心_勿扰")?.stem).toBe("ctrl_disturb");
    expect(matchName("设置_勿扰")?.stem).toBe("set_disturb");
    // "勿扰" 在控制中心与设置都有 -> singleOrNull 为空
    expect(matchName("勿扰")).toBeUndefined();
    // 手电筒同理(桌面+控制中心)
    expect(matchName("手电筒")).toBeUndefined();
  });

  it("export: ctrl_disturb 自动补 ctrl_dnd 且按 stem 排序", () => {
    const alarm = bgra(new Uint32Array(112 * 112).fill(0xff202020), 112, 112);
    const disturb = bgra(new Uint32Array(64 * 64).fill(0xff202020), 64, 64);
    const out = exportIcons(new Map([["alarm", alarm], ["ctrl_disturb", disturb]]));
    // 字典序: ctrl_disturb < ctrl_dnd("i" < "n"), 与 Kotlin sortedBy 一致
    expect(out.map((i) => i.stem)).toEqual(["alarm", "ctrl_disturb", "ctrl_dnd"]);
    const dnd = decode(out[2].data);
    expect(dnd.width).toBe(160);
    expect(dnd.height).toBe(124);
  });

  it("端到端: 图片 -> convert -> export -> buildIconPack -> 拆回", () => {
    const picked = new Map<string, Uint8Array>();
    // 桌面 alarm: 带底板图
    const plate = makePlateImage(300);
    const [alarmBin] = convert(plate.pixels, plate.w, plate.h, DESKTOP[2]);
    picked.set("alarm", alarmBin);
    // 控制 ctrl_disturb: 实心图
    const solid = new Uint32Array(200 * 200).fill(0xff334455);
    const [disturbBin] = convert(solid, 200, 200, CONTROL[6]);
    picked.set("ctrl_disturb", disturbBin);

    const icons = exportIcons(picked);
    const assets = {
      ko: Uint8Array.from({ length: 32 }, (_, i) => i & 0xff),
      iconBin: Uint8Array.from({ length: 24 }, (_, i) => (i * 5) & 0xff),
      fontLua: 'local FONT_NAME = "__FONT_NAME__"\n',
      iconLua: 'local PACK_NAME = "__PACK_NAME__"\nlocal PACK_TITLE = "__PACK_TITLE__"\n',
    };
    const res = buildIconPack(assets, {
      short: "E2E", packName: "图标:E2E", title: "图标投递 E2E", pkgName: null, icons,
    }, fakePreview(1024));

    const p = parseShell(res.bytes);
    expect(p.files.map(([path]) => path)).toEqual([
      "_lua/iconpack/main.lua", "_lua/iconpack/chaos_sup.ko",
      "_lua/iconpack/chaos_icon.bin", "_lua/iconpack/pack.bin",
    ]);
    const cipkBack = parseCipk(p.files[3][1]);
    expect(cipkBack.map(([name]) => name)).toEqual(["alarm.bin", "ctrl_disturb.bin", "ctrl_dnd.bin"]);
    // 包名由 CIPK 哈希推导
    expect(res.pkgName).toMatch(/^4348[0-9]{8}$/);
  });
});

function fakePreview(size: number): Uint8Array {
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
