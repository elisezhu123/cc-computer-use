# Phases

每个 phase 一个分支，合进 `main` 后再开下一个。

## Phase 01 — 更快、更准的桌面点击

分支：`phase/01-fast-precise-clicks`
设计：[superpowers/specs/2026-11-12-fast-precise-clicks-design.md](superpowers/specs/2026-11-12-fast-precise-clicks-design.md)

### 目标

桌面模式（`dist/index.js`）每次动作的本地耗时从约 1 秒降到 0.4 秒以内，并减少密集 UI 上的点偏。

### 完成标准

- [ ] `npm test` 全部通过，新增逻辑（含负原点的坐标换算、吸附判定、画面稳定判定）有单元测试。
- [ ] 基准脚本在本机测得：一次 `left_click`（含自动截图）中位数 ≤ 400ms（改动前约 1000ms）。
- [ ] 在副屏截图上点击，光标落在该副屏的对应位置（用 `cursor_position` 核对）。
- [ ] 点击结果写明点中的控件；落在缝隙时吸附到相邻控件并写明；`CU_CLICK_SNAP=0` 时不吸附。
- [ ] `zoom` 输出来自全分辨率画面，小字可读。
- [ ] `CU_NATIVE_HELPER=0` 或 helper 编译失败时，回退到原有 `cliclick` + `screencapture` 路径，行为与改动前一致。
- [ ] `reports/ARCHITECTURE.md`、`reports/CHANGELOG.md`、`reports/TESTING.md` 已更新。
