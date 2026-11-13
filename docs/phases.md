# Phases

每个 phase 一个分支，合进 `main` 后再开下一个。

## Phase 01 — 更快、更准的桌面点击

分支：`phase/01-fast-precise-clicks`
设计：[superpowers/specs/2026-11-12-fast-precise-clicks-design.md](superpowers/specs/2026-11-12-fast-precise-clicks-design.md)

### 目标

桌面模式（`dist/index.js`）每次动作的本地耗时从约 1 秒降到 0.4 秒以内，并减少密集 UI 上的点偏。

### 完成标准

- [x] `npm test` 全部通过（146/146），新增逻辑（含负原点的坐标换算、吸附判定）有单元测试；画面稳定判定在 Swift 里，由集成测试覆盖。
- [x] 基准脚本在本机测得：一个动作（含自动截图）中位数 ≤ 400ms —— 实测 296ms，改动前的路径 921ms（`node scripts/bench.mjs`）。
- [x] 在副屏截图上点击，光标落在该副屏的对应位置 —— 真机实测三块外接屏，移动到截图中心后 `cursor_position` 误差 0 像素，逻辑坐标落在各自屏幕范围内。
- [x] 点击结果写明点中的控件；落在缝隙时吸附并写明；`CU_CLICK_SNAP=0` 时不吸附 —— 真机在 TextEdit 工具栏实测：`Hit: AXCheckBox "bold"`；缝隙点击吸附到 `AXComboBox "font size"`；关闭吸附后同一点报告 `Hit: AXGroup "Formatting"` 且无控件变化。
- [x] `zoom` 输出来自全分辨率画面（与旧路径同一区域对比，文字边缘更清晰）。
- [x] `CU_NATIVE_HELPER=0` 时回退到原有路径：`CU_NATIVE_HELPER=0 npm test` 139 通过、7 跳过；基准脚本的回退列正常。
- [x] `reports/ARCHITECTURE.md`、`reports/CHANGELOG.md`、`reports/TESTING.md` 已更新。

### 真机验证记录（2026-11-12）

在 TextEdit 临时文档上用真实输入验证，全部通过：小控件点击、缝隙吸附与关闭吸附、双击选词、shift 点击扩展选区、
option 点击、拖选、三块外接屏的落点、切换前台应用后的闸门（`not_granted`）、`CU_NATIVE_HELPER=0` 在主屏上的点击、
Electron 窗口里的元素被标记为网页内容。

验证中发现并修复的两个问题：

- **带修饰键的点击会让修饰键粘住。** 只在鼠标事件上带标志位时，一次 shift 点击之后 shift 一直处于按下状态，后面的点击和拖拽都变成扩展选区。
  改为像 cliclick 一样在点击前后发真实的修饰键按下和抬起；复测 shift、option 点击后修饰键状态均为空。
- **没有 helper 时，副屏截图上的点击落到主屏**（回退路径不知道副屏原点，原有问题）。现在直接报错，不发出点击。

实测耗时：helper 路径上一次真实点击（含自动截图）约 560–800ms，回退路径约 1260–1430ms。
比基准的 300ms 长，是因为点击后界面有焦点环、光标闪烁等变化，等待画面稳定用掉了更多时间（上限 600ms）。

没有用真实输入验证的：

- 拔掉副屏后的下一次点击（应要求重新截图；逻辑有单元测试）；
- cmd 点击（与 shift、option 走同一段代码）；
- 拖拽文件到 Finder；
- 在 Electron 应用里真正点击靠近小按钮的位置（只读确认了这些元素被标记为网页内容）。

### 与设计的出入

- 前台应用检查没有移进 helper（实测结果会过期），仍用 `lsappinfo`。详见设计文档开头的修订说明。
