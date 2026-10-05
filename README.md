# Chaos 制作台 · 网页版

Android 版 [chaos-bandpack](https://github.com/WenHuaYiYang/chaos-bandpack) 的纯静态网页移植：
在浏览器里给**小米手环 10 Pro**（p67，固件 3.101.043）制作字体/图标投递包 `.bin`。
全部计算在本地完成，**不上传任何文件**。

- 许可：AGPL-3.0（衍生自上游 AGPL-3.0）
- 技术：Astro（静态壳）+ TypeScript 打包链 + Vitest 金标准对拍

## 验收线

与上游同一条纪律：**逐字节一致**。

- `tests/fixtures/golden-*.bin`：PC 侧生成器造的金标准容器（自造占位数据，跟着仓库走）。
  判据：parse 拆开 → 用拆出的输入重新 build → **逐字节相同**。
- `tests/hash.test.ts`：同步 SHA-256 与 Node crypto 对拍（`pkgFor` 包名推导依赖它）。

```bash
npm install
npm test        # 金标准对拍
npm run dev     # 本地开发
npm run build   # 产物在 dist/（纯静态，可直接托管）
```

## 移植进度

| 模块 | Kotlin 原文件 | 状态 |
|---|---|---|
| ShellWriter（字段口径/包名哈希） | `data/pack/ShellWriter.kt` | ✅ 已对拍 |
| ShellBuilder（容器壳合成/parse） | `data/pack/ShellBuilder.kt` | ✅ 已对拍 |
| CIPK（图标包容器） | `data/pack/Cipk.kt` | ✅ 往返对拍 |
| TitleText / PackBuilders（两种包组装） | `data/pack/*` | ✅ 结构对拍 |
| LvglIconCodec（BGRA + I8/RLE） | `data/icon/LvglIconCodec.kt` | ✅ 往返对拍 |
| IconSpec（55 槽位表/导出/matchName） | `data/icon/IconSpec.kt` | ✅ 行为对拍 |
| IconConvert（Lanczos-3 预乘缩放） | `data/icon/IconConvert.kt` | ✅ 行为对拍 + 端到端 |
| Sfnt / FontSubset / Charset（字体子集化） | `src/lib/font/*` | ✅ 浏览器端子集化 + 回读校验 |
| PreviewFactory（预览块） | `src/lib/pack/previewFactory.ts` | ✅ Canvas/ImageData + 调色板 + 小米 RLE |
| 制作页 UI + Web Worker | `src/pages/index.astro` / `src/workers/*` | ✅ 字体包/图标包制作与 Worker 预览 |

图标链已可端到端跑通：任意图片 → `convert`（覆盖率检查 + Lanczos 缩放）→ `exportIcons`
（含 ctrl_dnd 自动补齐）→ `buildIconPack`（CIPK + 容器壳 + Lua 占位符替换）→ 拆包自检。

## 素材说明

打包需要三样设备侧素材（`chaos_sup.ko` / `chaos_icon.bin` / 两个投递 Lua），
来自 [Chaos-Module](https://github.com/WenHuaYiYang/Chaos-Module)，届时静态托管或由用户上传。
固件原图标与 MiSans 的授权约束见上游 `THIRD_PARTY_NOTICES.md`。

Android 版的这些素材不是让用户每次选择，而是构建期从设备侧仓库同步到 APK 的
`assets/pack/`：`chaos_sup.ko`、`chaos_icon.bin`、`font_pack.lua`、`icon_pack.lua`。
设备侧仓库通过 `-Pchaos.repo`、`local.properties` 的 `chaos.repo`、`CHAOS_REPO` 或默认
`../../Chaos-Module` 查找；公开仓库本身不携带这些二进制。网页端部署时把同名文件放到
`public/pack/` 即可自动使用，页面上传仅作为没有内置素材时的回退方案。
