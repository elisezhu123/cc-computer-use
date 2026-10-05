# 版本演进

## 未发布

### 新增
- **AI 光标**（原生后台模式）：屏幕上用一个橘色箭头（Claude 的品牌色）显示 AI 正在操作的位置，点击时有波纹；它是不接收鼠标的悬浮窗，
  不移动你的真实光标，也不会出现在截图里。`CU_AGENT_CURSOR=0` 关闭。
- **动作后自动截图**（所有模式）：点击、输入、按键、滚动、拖拽、`open_application`、`computer_batch` 的结果里直接附上新截图，
  模型不用每一步再单独调用 `screenshot`，每一步少一次模型来回。`CU_AUTO_SCREENSHOT=0` 关闭。

### 变更
- 原生后台模式的点击：按钮、复选框、菜单项、链接等标准控件改为通过辅助功能接口（AXPress）触发，后台窗口也能响应；
  点到输入框时先设置焦点；其他位置的鼠标事件带上目标窗口编号（字段 91/92），让系统把点击交给该窗口。`CU_BACKGROUND_AX=0` 关闭辅助功能点击。
- 每次点击只向 Swift 小工具发一条请求（原来是移动、按下、松开分别发送）。

## v3.1.0 — 浏览器模式、后台模式、更快的动作

### 新增
- **浏览器模式**（`dist/browser.js`）：通过 Chrome DevTools 协议控制一个独立的 Chrome，不占用系统鼠标键盘；窗口被遮挡、最小化或无界面时照常工作，后台不节流。新增 `navigate` 工具。
- **原生后台模式**（`dist/background.js`，实验性）：用 `CGEventPostToPid` 把输入直接发给指定应用、只截取该应用窗口，不移动光标。
- 新增 [BACKGROUND.md](../BACKGROUND.md)，介绍上述两种模式和在虚拟机里运行的方法。

### 性能
- 前台应用检查改用 `lsappinfo`，不再每个动作都向 System Events 发 Apple Event；同时不再需要 System Events 的自动化授权（`osascript` 仅作回退）。
- 点击的移动、稳定等待、点击合并为一次 cliclick 调用。
- 已授予 `clipboardWrite` 时，超过 200 字符的单行文本改为粘贴。
- 启动时的应用枚举改用 `mdfind -attr` 一次取回 bundle ID，不再对每个应用串行执行 `defaults read`。

### 变更
- **所有已授权的应用默认都可以完全交互。** 此前浏览器（Safari、Chrome、Firefox、Edge、Arc）被写死为只读，任何点击都返回 `denied_tier`；终端和 IDE 只能点击，不能输入；而且没有任何开关可以改。代码注释还写着“只读级可以点击”，与实际行为不符。
  现在默认全部放开，白名单、前台应用检查和系统快捷键黑名单保持不变；设置 `CU_STRICT_APP_TIERS=1` 可恢复原来的分级。

### 修复
- **补齐缺失的源文件。** 网页上传受 GitHub 单次 100 个文件的限制，`src/index.ts`、`server.ts`、`tools.ts`、
  `coords.ts`、`screen.ts`、`policy.truth.test.ts` 当时没有传上来，已补齐；`dist/` 不再纳入版本控制。
- **HTTP Gateway 重写为 v3 的传输层。** 旧版 `http-server.js` / `utils.js` 是 v1 时代的独立实现，存在以下问题：
  - 工具集与 v3 不一致，并且绕过了全部权限策略；
  - 监听所有网卡且没有认证，同时暴露 `computer_run_applescript`，等于可以远程执行任意代码；
  - 用 shell 字符串拼接调用 `cliclick` / `osascript`，存在命令注入；
  - `/message` 没有把消息转交给传输层，工具调用实际上无法送达。

  新的 `src/http-server.ts` 复用 `server.ts`，提供 Streamable HTTP（`/mcp`）和 SSE（`/sse`）两种传输，
  每个客户端会话独立，默认只监听 `127.0.0.1` 并启用 DNS rebinding 防护。
- `start-gateway.sh` 原先在自身所在的子目录里找 `dist/`，现改为切到项目根目录。
- 启动预检失败时，同时打印 `PreflightError` 附带的修复方法（之前只打印了错误信息）。
- 按键支持 xdotool 风格的键名（`Down`、`Page_Down`、`Prior`、`super` 等），
  这正是官方 computer-use 使用的写法；之前 `key "Down"` 会被 cliclick 拒绝。
- 未安装 `cliclick` 时，`input.test.ts` 中依赖真实 cliclick 的测试改为明确跳过，
  不再出现“空跑通过”或误报失败。

### 其他
- 新增 `LICENSE`（MIT）并完善 `.gitignore`。
- `@types/express` 移到 devDependencies；`@modelcontextprotocol/sdk` 最低版本提升到 1.30.0
  （`createMcpExpressApp` 需要）。
- 重写 README 和文档，`reports/` 合并为 ARCHITECTURE / CHANGELOG / TESTING 三份，旧文档移到 `reports/archive/`。

## v3.0.0 — 对齐官方 computer-use 契约

整体重写。目标从“提供一组 macOS 自动化工具”变为“复现 Claude Code Desktop 内置 computer-use
MCP 服务器的行为”，让模型已有的 computer-use 用法可以直接迁移。

### 新增
- **24 个工具**，名称和参数与官方一致：`request_access`、`list_granted_applications`、`screenshot`、`zoom`、
  `switch_display`、`cursor_position`、`left_click` / `double_click` / `triple_click` / `right_click` / `middle_click`、
  `mouse_move`、`left_click_drag`、`left_mouse_down` / `left_mouse_up`、`type`、`key`、`hold_key`、`scroll`、
  `open_application`、`read_clipboard`、`write_clipboard`、`wait`、`computer_batch`。
- **权限策略**（`policy.ts`）：会话白名单、每个动作前的前台应用检查、应用分级（full / click / read）、
  剪贴板与系统快捷键的独立授权、快捷键黑名单。
- **`computer_batch`**：一次调用执行多个动作，遇错即停，坐标基于批次开始前的截图。
- **多显示器支持**：按显示器编号截图，可用 `switch_display` 切换。
- **`zoom`**：放大查看截图的某个区域，不改变坐标基准。
- **滚动和中键点击**：通过首次使用时编译的 Swift CGEvent helper 实现（cliclick 本身不支持）。
- **启动预检**：缺少屏幕录制 / 辅助功能权限、未安装 cliclick、无法测出显示器几何时，给出修复提示后退出。
- 单元测试：坐标映射、图像尺寸算法、按键解析、权限策略真值表、应用列表过滤。

### 修复（相对 v2）
- **点击坐标偏移。** 截图在本地按 API 算法预先缩放，并按 `logical = model × logicalW / targetW` 映射；
  v2 没有这一层，Retina 屏和截图缩放都会导致点击位置偏差。
- **组合键失效。** 旧实现把修饰键也用 `kp:` 发送（例如 `kp:cmd`），cliclick 会拒绝。
  现在修饰键用 `kd:` / `ku:`，普通字符用 `t:`，命名键用 `kp:`。
- **命令注入。** 所有外部命令都改用 `execFile` + argv 调用，不再拼接 shell 字符串。

### 移除
- `computer_run_applescript`、`computer_get_screen_info`、动画移动等 v1/v2 专有工具和选项。

## v2.0.0 — Enhanced（2026-09-20）

在 v1 的基础上，移植 Claude Code 旧版源码（CC-Source）`utils/computerUse/executor.ts` 中的交互算法。

- 动画移动：ease-out-cubic，60fps，2000px/s，最长 0.5s。
- Move-and-settle：移动后等待 50ms 再点击。
- 剪贴板输入：保存 → 写入 → 校验 → ⌘V → 等待 100ms → 恢复。
- 按键重复间隔 8ms（与 125Hz USB 轮询对齐）。
- 新增 `computer_drag`、`computer_scroll`，共 10 个工具。

## v1.0.0 — 初版（2026-09-19）

基于 cliclick + AppleScript 的 8 个工具：`computer_screenshot`、`computer_get_screen_info`、`computer_mouse_move`、
`computer_mouse_click`、`computer_type_text`、`computer_press_key`、`computer_get_mouse_position`、`computer_run_applescript`。

- 修复：`computer_get_screen_info` 从 System Events 改为 `system_profiler`，失败时再用 Finder bounds 兜底。
- 修复：按键名映射（例如 `escape` → `esc`）。
