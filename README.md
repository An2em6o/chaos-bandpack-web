# Chaos 制作台 · 网页版

Android 版 [chaos-bandpack](https://github.com/WenHuaYiYang/chaos-bandpack) 的纯静态网页移植：
在浏览器里给**小米手环 10 Pro**（p67，固件 3.101.043）制作字体/图标投递包 `.bin`。
全部计算在本地完成，**不上传任何文件**。

- 许可：AGPL-3.0（衍生自上游 AGPL-3.0）
- 技术：Astro（静态壳）+ TypeScript 打包链 + Vitest 金标准对拍

## 静态 / 动态图标适配

图标页支持 PNG、GIF、原生 BIN 及扁平 ZIP，面向 p67 / 3.101.043。
桌面 PNG / GIF 自动适配 96×96，保留透明背景；GIF 会生成静态封面与 DGF1 动画，
保留逐帧合成、disposal、时长及循环次数。同名 PNG 或 BIN 可以覆盖 GIF 默认封面。
GIF 与 `_anim.bin` 不可同时提供；PNG 与静态 BIN 不可同时提供。
直接导入 `<stem>_anim.bin` 时必须同时提供对应的 96×96 静态封面。
旧的 112×112 等静态原生 BIN 可直接复用；控制中心、设置、日历磁贴和卡包的 BIN 保留原尺寸。

桌面槽位补齐为固定 ABI 的 38 个；加上系统 UI 槽位，页面共 144 项。
系统 UI 的 PNG 必须符合槽位尺寸，GIF 仅用于桌面图标。
素材文件名使用页面显示的英文 stem，ZIP 内不允许嵌套素材目录。
GIF / PNG 源画布最长边最多 4096 像素；GIF 支持 1–256 帧、每帧 1–60000 ms。
不会静默抽帧或降低输出分辨率。转换在 Web Worker 中进行，不上传素材。

每个静态资源最多 512 KiB，动画最多 1 MiB；CIPK 最多 256 个文件，总长最多 16777215 字节。
所有新包（含纯静态包）末尾均带有 20 字节 CIA1 `animations.bin`，位顺序与模块的 38 个桌面 stem 一致。
外层采用 p67 容器（版本字段 `0x00010107`），资源路径为
`_lua/xiaomi-band-10-pro/main.lua` 和 `_lua/xiaomi-band-10-pro/pack.bin`。
图标投递包不再携带旧版的 ko / 应用图标；字体包的结构保持不变。
投递 Lua 按 64 KiB 分块写入及回读比对，确认所有资源完成后，再通过临时文件、回读与 rename 提交 128 字节清单。

侧载请使用「导出投递包 .bin」；「下载内部 CIPK」仅用于检查，不能直接安装。
动态效果需要支持 DGF1 的新版 Chaos 模块，旧模块只能使用静态封面。
首次升级主模块后需要重启；覆盖同名包前先切回系统原图标，投递后重新选择。
包清单最多 8 包，满槽需先删除。设备帧率、功耗及低内存行为仍需真机验证。

推荐使用与 CI 一致的 pnpm：

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Vitest 包含独立 Python struct 生成的 DGF1 / p67 二进制金标准，以及 Pillow 生成的 GIF disposal 对拍素材。
可另外执行真实 Lua 投递脚本的内存文件系统回归（无需手环）：

```bash
python3 -m venv .venv-tests
.venv-tests/bin/pip install -r tests/requirements-lua.txt
.venv-tests/bin/python tests/iconInstaller.test.py
```

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
| IconSpec（144 槽位表/导出/matchName） | `data/icon/IconSpec.kt` + p67 映射 | ✅ 行为对拍 |
| DGF1 / CIA1 / GIF 合成 | `src/lib/icon/dynamicIcon.ts` | ✅ 二进制金标准、时序与 disposal 对拍 |
| IconConvert（Lanczos-3 预乘缩放） | `data/icon/IconConvert.kt` | ✅ 行为对拍 + 端到端 |
| Sfnt / FontSubset / Charset（字体子集化） | `src/lib/font/*` | ✅ 浏览器端子集化 + 回读校验 |
| PreviewFactory（预览块） | `src/lib/pack/previewFactory.ts` | ✅ Canvas/ImageData + 调色板 + 小米 RLE |
| 制作页 UI + Web Worker | `src/pages/index.astro` / `src/workers/*` | ✅ 字体包/图标包制作与 Worker 预览 |

图标链已可端到端跑通：任意图片 → `convert`（覆盖率检查 + Lanczos 缩放）→ `exportIcons`
（含 ctrl_dnd 自动补齐）→ `buildIconPack`（CIPK + 容器壳 + Lua 占位符替换）→ 拆包自检。

## 素材说明

字体打包使用设备侧素材（`chaos_sup.ko` / `chaos_icon.bin` / `font_pack.lua`），图标打包使用已适配的 `icon_pack.lua`。
来自 [Chaos-Module](https://github.com/WenHuaYiYang/Chaos-Module)，届时静态托管或由用户上传。
固件原图标与 MiSans 的授权约束见上游 `THIRD_PARTY_NOTICES.md`。

Android 版的这些素材不是让用户每次选择，而是构建期从设备侧仓库同步到 APK 的
`assets/pack/`：`chaos_sup.ko`、`chaos_icon.bin`、`font_pack.lua`、`icon_pack.lua`。
设备侧仓库通过 `-Pchaos.repo`、`local.properties` 的 `chaos.repo`、`CHAOS_REPO` 或默认
`../../Chaos-Module` 查找；公开仓库本身不携带这些二进制。网页端部署时把同名文件放到
`public/pack/` 即可自动使用，页面上传仅作为没有内置素材时的回退方案。
