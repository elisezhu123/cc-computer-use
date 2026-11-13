# 更快、更准的桌面点击 — 设计

日期：2026-11-12
范围：桌面模式（`src/index.ts` → `src/server.ts`）。后台模式和浏览器模式不改。

> **实现后的修订（2026-11-12）**
>
> - 前台应用检查**没有**移进 helper：`NSWorkspace.frontmostApplication` 在 helper 进程里实测会过期，而它决定每个输入动作是否放行，
>   所以仍然用 `lsappinfo`。下文的 `front` 指令和 `apps.ts` 的改动不存在。
> - `shot` 不是"截全分辨率再缩小"，而是同时截目标尺寸和全分辨率两帧；稳定判定比较连续的目标尺寸帧，采样间隔 30ms。
> - 一个动作加自动截图实测约 300ms（见 `reports/ARCHITECTURE.md` 的性能一节）。

## 背景

### 慢在哪里

在 16" MBP（主屏 3456×2234 物理像素，另接两块 4K 屏）上实测，一次 `left_click`（含自动截图）本地约 1 秒：

| 环节 | 耗时 |
|---|---|
| 前台应用检查（两次 `lsappinfo`） | 约 15ms |
| 启动 `cliclick` + 50ms 稳定等待 | 约 110ms |
| 截图前固定等待（`AUTO_SCREENSHOT_SETTLE_MS`） | 250ms |
| `screencapture` 写全分辨率 PNG 到磁盘 | 约 400ms |
| `sharp` 解码、缩放、再编码 PNG | 约 260ms |

同样的工作放在一个常驻进程里用 ScreenCaptureKit 完成，实测：

| 环节 | 耗时 |
|---|---|
| 截图并缩放到 1372×887 | 约 57ms（首次约 180ms） |
| PNG 编码 | 约 20ms |
| 全分辨率截图 3456×2234 | 约 64ms |
| `AXUIElementCopyElementAtPosition` | 0–1ms（首次约 58ms） |
| `NSWorkspace.frontmostApplication` | 约 0ms |

### 不准在哪里

1. **截图缩放比大。** 主屏被缩到 1372×887，模型的 1 像素约等于 1.26 逻辑点。16pt 的图标只有约 13 像素宽，模型估偏几像素就落到相邻控件或缝隙里。截图尺寸由 API 的图像缩放规则决定，本设计不改它。
2. **副屏点击落到主屏。** `modelToLogical` 只做缩放，不加显示器原点。本机两块副屏的原点是 `(-1085, -1080)` 和 `(1728, -1080)`。此外多屏时逻辑尺寸按"物理 / 2"推算，不是实测。
3. **点完没有反馈。** 结果只有坐标，模型要看下一张截图才知道点错。
4. **`zoom` 没有新细节。** 它裁剪的是已经缩小的截图再放大。
5. **截图可能截到动画中途。** 固定等 250ms，菜单展开、页面滚动未必结束。

## 方案

新增一个常驻 Swift helper，接管桌面模式的截图、鼠标、前台检查和显示器几何。helper 不可用时回退到现有实现。

考虑过的替代方案：

- **只改参数**（`screencapture -t jpg`、降低 PNG 压缩级别）：截图环节从约 670ms 降到约 310ms，但拿不到辅助功能信息，精度问题一个也解决不了。
- **按元素编号点击的新工具**（类似 Peekaboo `see`）：对原生应用最准，但偏离官方工具契约，工作量最大。留到本阶段之后，看效果再定。

## 组件

### `src/native/desktop.swift`（新）

单文件 Swift 程序，逐行读 stdin 指令、逐行写 stdout 回复（`ok ...` / `err ...`），与 `background.swift` 的协议风格一致。编译到 `~/.cache/computer-use-mcp/cudesk-<源码哈希>`。

| 指令 | 回复 | 说明 |
|---|---|---|
| `displays` | `ok <json>` | 每块屏：displayID、名称、原点、逻辑尺寸、缩放比、是否主屏 |
| `front` | `ok <bundleId>` | 前台应用 |
| `shot <displayID> <tw> <th> <minMs> <maxMs>` | `ok <base64 png>` | 等画面稳定后截全分辨率一帧，保留在内存里，缩放到 `tw×th` 后返回 |
| `zoom <x0> <y0> <x1> <y1> <ow> <oh>` | `ok <base64 png>` | 从保留的全分辨率帧裁剪（坐标为截图像素），缩放到 `ow×oh` |
| `hit <x> <y> <radius>` | `ok <json>` | 该点的控件，以及半径内 8 个方向上探测到的其他控件 |
| `click <button> <x> <y> <count> <flags>` | `ok` | 移动、等待 50ms、按下抬起（带 clickState） |
| `move` / `down` / `up` / `drag` | `ok` | 其余鼠标原语 |

坐标一律是全局逻辑点（`zoom` 除外）。

`hit` 返回的每个控件包含：角色、标题或描述（截断到 60 字符，按现有应用名的字符白名单过滤，防止借控件标题注入指令）、外框、所属进程的 bundle ID。辅助功能调用设 150ms 超时；超时或失败时返回空结果，点击照常进行。

**画面稳定判定**：`shot` 每隔约 50ms 截一张低分辨率小图，与上一张比较；变化像素比例低于阈值即视为稳定。至少等 `minMs`（默认 80ms），至多等 `maxMs`（默认 600ms，闪烁光标或视频会一直不稳定，到上限就截）。直接调用 `screenshot` 工具时 `minMs = maxMs = 0`，不等待。

### `src/desktopHelper.ts`（新）

helper 的进程管理与类型化封装：编译、启动、逐行请求、关闭。结构参照 `nativeHelper.ts`。`CU_NATIVE_HELPER=0` 或编译/启动失败时 `available` 为 false，并在 stderr 说明一次原因。

### `src/snap.ts`（新，纯函数）

```ts
chooseClickPoint(point, hit, neighbours, { frontmostBundleId, radius }) →
  { point, snapped: boolean, element: HitElement | null }
```

规则：

- 点中的控件可点击（按钮、复选框、单选、弹出按钮、菜单项、链接、文本框、滑块等）→ 不动，报告该控件。
- 点中的是容器或空白（窗口、分组、工具栏、滚动区、分栏）且半径内有可点击控件 → 取最近的一个，落点移到它外框内离原点最近的位置再向内收 2 点；报告为吸附。
- 其他情况（网页内容、静态文本、图片、画布、查询失败）→ 不动。
- 候选控件不属于当前前台应用 → 不吸附。前台应用检查不能被吸附绕过。
- `CU_CLICK_SNAP=0` → 从不吸附，只报告。

半径默认 6 个截图像素，换算成逻辑点后传给 helper。拖拽、`mouse_move`、`left_mouse_down/up` 不吸附。

### 修改

- **`coords.ts`**：`DisplayGeometry` 增加 `originX` / `originY`；`modelToLogical` 和 `logicalToModel` 加减原点。原点缺省为 0，回退路径行为不变。
- **`display.ts`**：helper 可用时用 `displays` 的实测值；否则走现有的 `system_profiler` 逻辑。
- **`screen.ts`**：`capture` 和 `zoomRegion` 优先走 helper；回退路径保留现有代码。
- **`input.ts`**：点击、移动、拖拽、按下、抬起优先走 helper。键盘与文本输入仍用 `cliclick`。
- **`apps.ts`**：`getFrontmostBundleId` 优先走 helper。
- **`server.ts`**：`doClick` 和批处理里的点击在换算坐标后调用 `hit` + `chooseClickPoint`，结果文字写明点中的控件和是否吸附；`guard()` 仍是每个动作一次。
- **`autoScreenshot.ts`**：helper 可用时不再 JS 侧 sleep，把等待交给 `shot` 的稳定判定。
- **`scroll.ts`**：不动。

点击结果示例：

```
Clicked left at screenshot (412, 38) = logical (519, 48). Hit: AXButton "Device".
Clicked left at screenshot (430, 38): snapped to (424, 38), nearest control AXButton "Device".
```

## 数据流

```
left_click [x, y]
  └─ guard()                 helper: front            约 0ms
  └─ toLogical()             原点 + 缩放
  └─ hit + chooseClickPoint  helper: hit              约 1ms
  └─ click                   helper: click            约 55ms（含 50ms 稳定等待）
  └─ 自动截图                 helper: shot             稳定判定 80–600ms + 约 80ms
```

预期一次点击约 250–300ms，以实现后的基准脚本为准。

## 错误处理

- helper 中途崩溃：当前请求报错，下一次请求重启 helper；连续失败两次后本次会话改走回退路径。
- helper 回复 `err`：作为工具错误返回，不静默吞掉（与 `scroll.ts` 一致）。
- 辅助功能查询失败或超时：点击照常执行，结果里不写控件信息。
- 屏幕录制权限缺失：`shot` 返回 `err`，沿用现有的权限提示文字。

## 测试

- 单元测试（纯函数）：带负原点的坐标换算与往返；`chooseClickPoint` 的各条规则，包括跨应用不吸附和开关关闭。
- helper 集成测试：`displays`、`front`、`shot` 尺寸正确、`zoom` 尺寸正确；`shot` 在 `maxMs` 加余量内返回（稳定判定在 Swift 里，只做集成测试）；没有 `swiftc` 或没有权限时跳过，方式同现有的 cliclick 测试。
- 回退测试：`CU_NATIVE_HELPER=0` 下现有测试全部通过。
- 基准脚本 `scripts/bench.mjs`：对比 helper 路径和回退路径的截图、点击耗时。
- 实机验证：在 TextEdit 等已授权应用里点击小控件，核对结果里的控件名；在副屏截图上点击后用 `cursor_position` 核对落点。

## 不在范围内

- 后台模式、浏览器模式。
- 键盘和文本输入的实现。
- 按元素编号点击的新工具。
- 截图目标尺寸（`imageResize.ts`）。
