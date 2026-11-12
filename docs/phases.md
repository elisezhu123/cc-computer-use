# Phases

每个 phase 一个分支，合进 `main` 后再开下一个。

## Phase 01 — 更快、更准的桌面点击

分支：`phase/01-fast-precise-clicks`
设计：[superpowers/specs/2026-11-12-fast-precise-clicks-design.md](superpowers/specs/2026-11-12-fast-precise-clicks-design.md)

### 目标

桌面模式（`dist/index.js`）每次动作的本地耗时从约 1 秒降到 0.4 秒以内，并减少密集 UI 上的点偏。

### 完成标准

- [x] `npm test` 全部通过（134/134），新增逻辑（含负原点的坐标换算、吸附判定）有单元测试；画面稳定判定在 Swift 里，由集成测试覆盖。
- [x] 基准脚本在本机测得：一个动作（含自动截图）中位数 ≤ 400ms —— 实测 304ms，改动前的路径 879ms（`node scripts/bench.mjs`）。
- [ ] 在副屏截图上点击，光标落在该副屏的对应位置 —— 换算有单元测试，三块屏的截图尺寸和原点已实测；**尚未在真机上移动光标核对**。
- [ ] 点击结果写明点中的控件；落在缝隙时吸附并写明；`CU_CLICK_SNAP=0` 时不吸附 —— 用模拟 helper 的测试全部通过，真实的控件查询与截图上的菜单名一致；**尚未在真实应用里实际点击**。
- [x] `zoom` 输出来自全分辨率画面（与旧路径同一区域对比，文字边缘更清晰）。
- [x] `CU_NATIVE_HELPER=0` 时回退到原有路径：`CU_NATIVE_HELPER=0 npm test` 127 通过、7 跳过；基准脚本的回退列正常。
- [x] `reports/ARCHITECTURE.md`、`reports/CHANGELOG.md`、`reports/TESTING.md` 已更新。

两项未勾选的都需要占用屏幕做真实点击（步骤见 `reports/TESTING.md` 的真机冒烟测试第 4 条）。做完并勾选后再合并进 `main`。

### 与设计的出入

- 前台应用检查没有移进 helper（实测结果会过期），仍用 `lsappinfo`。详见设计文档开头的修订说明。
