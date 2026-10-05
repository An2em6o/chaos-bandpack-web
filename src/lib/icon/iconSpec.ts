/**
 * 图标槽位、尺寸及导出资源。
 *
 * TS 移植自 Kotlin `IconSpec.kt`。桌面 112×112(内容框 100), 系统图标 64×64。
 */
import { buildCipk, icon as mkIcon, type Icon } from "../pack/cipk";
import { decode, indexedRle, type LvglImage } from "./lvglIconCodec";

export const CANVAS = 112;
export const CONTENT = 100;
export const MARGIN = (CANVAS - CONTENT) / 2;
export const OUT_BYTES = 12 + CANVAS * CANVAS * 4;

/** 桌面画布的 LVGL 12 字节头: lvglHeader(112, 112, cf=16, flags=0, stride=448) */
export const CANVAS_HEADER: Uint8Array = (() => {
  const h = new Uint8Array(12);
  h[0] = 0x19;
  h[1] = 16;
  const dv = new DataView(h.buffer);
  dv.setUint16(4, CANVAS, true);
  dv.setUint16(6, CANVAS, true);
  dv.setUint16(8, CANVAS * 4, true);
  return h;
})();

export type GroupName = "DESKTOP" | "CONTROL" | "SETTINGS";

export const GROUP_LABEL: Record<GroupName, string> = {
  DESKTOP: "桌面",
  CONTROL: "控制中心",
  SETTINGS: "设置",
};

export interface Slot {
  stem: string;
  label: string;
  group: GroupName;
}

const s = (stem: string, label: string, group: GroupName = "DESKTOP"): Slot => ({ stem, label, group });

export const ABSENT_ON_DEVICE = new Set(["dealt", "innovation_research"]);

export const DESKTOP: Slot[] = [
  s("activities", "活力指标"),
  s("aivs", "小爱同学"),
  s("alarm", "闹钟"),
  s("alipay", "支付宝"),
  s("breath", "呼吸放松"),
  s("calendar", "日程"),
  s("perpetual_calendar", "日历"),
  s("camera", "遥控拍照"),
  s("card", "卡包"),
  s("chronograph", "秒表"),
  s("compass", "指南针"),
  s("findphone", "找手机"),
  s("flashlight", "手电筒"),
  s("heartrate", "心率"),
  s("interconnect", "多端联动"),
  s("mijia", "米家"),
  s("music", "音乐"),
  s("mute", "手机静音"),
  s("oxygen", "血氧"),
  s("pressure", "压力"),
  s("recorder", "录音机"),
  s("settings", "设置"),
  s("share", "融合设备中心"),
  s("sleep", "睡眠"),
  s("sports", "运动"),
  s("sports_course", "跑步课程"),
  s("sports_record", "运动记录"),
  s("sports_status", "训练状态"),
  s("timer", "倒计时"),
  s("todo", "待办"),
  s("tomato_clock", "番茄钟"),
  s("vitality", "元气值"),
  s("weather", "天气"),
  s("womenhealth", "女性健康"),
  s("worldclock", "世界时钟"),
  s("wxpay", "微信支付"),
];

export const CONTROL: Slot[] = [
  s("ctrl_flashlight", "手电筒", "CONTROL"),
  s("ctrl_setting", "设置", "CONTROL"),
  s("ctrl_battery", "省电", "CONTROL"),
  s("ctrl_bright", "亮度", "CONTROL"),
  s("ctrl_alarm", "闹钟", "CONTROL"),
  s("ctrl_findphone", "找手机", "CONTROL"),
  s("ctrl_disturb", "勿扰", "CONTROL"),
  s("ctrl_raise", "抬腕亮屏", "CONTROL"),
  s("ctrl_game", "游戏模式", "CONTROL"),
];

export const SETTINGS: Slot[] = [
  s("set_notify", "通知", "SETTINGS"),
  s("set_desktop", "桌面", "SETTINGS"),
  s("set_display", "显示", "SETTINGS"),
  s("set_disturb", "勿扰", "SETTINGS"),
  s("set_safe", "安全", "SETTINGS"),
  s("set_battery", "电池", "SETTINGS"),
  s("set_motion", "运动", "SETTINGS"),
  s("set_preference", "偏好", "SETTINGS"),
  s("set_mydevice", "我的设备", "SETTINGS"),
  s("set_wrist", "佩戴方式", "SETTINGS"),
];

export const SLOTS: Slot[] = [...DESKTOP, ...CONTROL, ...SETTINGS];

export function slotCanvas(slot: Slot): number {
  return slot.group === "DESKTOP" ? CANVAS : 64;
}

export function slotContent(slot: Slot): number {
  return slot.group === "DESKTOP" ? CONTENT : 64;
}

export function stemOf(stem: string): Slot | undefined {
  return SLOTS.find((it) => it.stem === stem);
}

export function slots(group: GroupName): Slot[] {
  return SLOTS.filter((it) => it.group === group);
}

/** 日历的日期由程序绘制，预览只读取它自己的底图。 */
export function previewStems(stem: string): string[] {
  return stem === "perpetual_calendar" ? ["calendar_background"] : [stem];
}

/** 精确匹配英文名或分类中文名；未注明分类的重名不匹配。 */
export function matchName(base: string): Slot | undefined {
  const name = base.trim();
  const byStem = stemOf(name.toLowerCase());
  if (byStem) return byStem;
  const hits = SLOTS.filter((slot) => {
    if (slot.label === name) return true;
    return ["_", "-", "·", " "].some((sep) => name === GROUP_LABEL[slot.group] + sep + slot.label);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

export function duplicateStems(stems: Array<string | null | undefined>): Set<string> {
  const counts = new Map<string, number>();
  for (const v of stems) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
}

/**
 * 各应用分别导出，勿扰自动补齐 160×124 I8/RLE 动画画布(ctrl_dnd)。
 * 结果按 stem 排序 —— 与 Kotlin 侧一致。
 */
export function exportIcons(picked: Map<string, Uint8Array>): Icon[] {
  const normalized = new Map<string, Uint8Array>();
  for (const [stem, bin] of picked) {
    const slot = stemOf(stem);
    if (!slot) throw new Error(`未知图标槽位: ${stem}`);
    if (normalized.has(slot.stem)) throw new Error(`图标槽位重复: ${slot.label}`);
    const decoded = decode(bin);
    if (decoded.width !== slotCanvas(slot) || decoded.height !== slotCanvas(slot)) {
      throw new Error(`${slot.label}尺寸不匹配`);
    }
    normalized.set(slot.stem, bin);
  }
  const out: Icon[] = [...normalized.entries()].map(([k, v]) => mkIcon(k, v));
  const disturb = normalized.get("ctrl_disturb");
  if (disturb) {
    const image = decode(disturb);
    const canvas = new Uint32Array(160 * 124);
    for (let y = 0; y < 64; y++) {
      canvas.set(image.pixels.subarray(y * 64, y * 64 + 64), (y + 30) * 160 + 48);
    }
    out.push(mkIcon("ctrl_dnd", indexedRle(canvas, 160, 124)));
  }
  return out.sort((a, b) => (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0));
}

export function devicePath(stem: string): string {
  return `/data/chaos/icons/${stem}.bin`;
}

export type { Icon, LvglImage };
