/**
 * 表盘标题的宽度口径。
 *
 * 手环上那行标题是 40 号字、整屏居中(屏宽 390px 上下), 实测"字体投递 花朝粗"
 * (7 个汉字 + 1 个空格 = 16 半角)正好占满一行而不折行/不截断 —— 这就是上限的来历。
 * 超过这个宽度, 手环上会折成两行或直接截断, 所以界面上必须提前提醒。
 *
 * TS 移植自 Kotlin `TitleText.kt`。
 */

/** 一行能放的半角字符数(全角算 2) */
export const MAX_HALF = 16;

/** 标题宽度(半角为单位) */
export function width(s: string): number {
  let w = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    w += isWide(cp) ? 2 : 1;
    i += cp > 0xffff ? 2 : 1;
  }
  return w;
}

/** 超宽返回提示文案, 合法返回 null */
export function validate(s: string): string | null {
  const t = s.trim();
  if (t.length === 0) return "标题不能为空";
  const w = width(t);
  if (w > MAX_HALF) {
    return (
      `标题太宽: 当前 ${w} 个半角, 手环上最多 ${MAX_HALF} 个半角(一个汉字算 2 个),` +
      "超出的部分会折行或被截断"
    );
  }
  return null;
}

/**
 * 是否按全角算宽。取的是 Unicode East Asian Width 里我们真会遇到的几段
 * (CJK 汉字/假名/谚文/全角标点与全角字母), 不追求 EAW 全表。
 */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  );
}
