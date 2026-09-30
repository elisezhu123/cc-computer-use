# 架构说明（v3）

本文说明 v3 的设计思路和各模块职责。更细的实现理由写在各源文件的头部注释里，本文是它们的索引与汇总。

## 设计目标

**让模型已有的 computer-use 知识可以直接迁移过来。**

v3 的工具集、参数名、坐标约定、权限流程都对齐 Claude Code Desktop 内置的
computer-use MCP 服务器（`@ant/computer-use-mcp`）。
模型在官方环境里学会的用法（先 `request_access`，再 `screenshot`，按截图像素点击，
用 `computer_batch` 合并可预测的操作）在这里原样成立。

底层实现换成了可以独立部署的 macOS 命令行工具：

| 能力 | 官方实现 | 本项目 |
|------|----------|--------|
| 鼠标 / 键盘输入 | Rust 原生模块（enigo） | [`cliclick`](https://github.com/BlueM/cliclick)（`input.ts`） |
| 滚动、中键点击 | 原生模块 | 首次使用时编译的 Swift CGEvent helper（`scroll.ts` + `native/scroll.swift`） |
| 截图 | 原生截屏 | `screencapture` + `sharp` 缩放（`screen.ts`） |
| 剪贴板 | 原生 | `pbcopy` / `pbpaste`（`clipboard.ts`） |
| 应用枚举 / 前台应用 / 激活 | 原生 | `mdfind -attr`、`lsappinfo`、`osascript`（`apps.ts`） |
| 显示器几何 | 原生 | `system_profiler` + 实测截图尺寸（`display.ts`） |
| 权限策略 | 白名单、分级、快捷键黑名单 | 同样的概念，独立实现（`policy.ts`） |

## 模块

```
src/
├── index.ts          stdio 入口：main()
├── http-server.ts    HTTP 入口：Streamable HTTP /mcp + SSE /sse（见 computer-use-mcp-server/GATEWAY.md）
├── server.ts         会话状态、dispatch()、guard()、MCP 接线
├── tools.ts          24 个工具的 JSON Schema 与描述文字
├── policy.ts         白名单、前台应用检查、应用分级、系统快捷键黑名单
├── coords.ts         截图像素 → cliclick 逻辑点 的坐标映射
├── imageResize.ts    API 图像缩放算法的移植（决定截图尺寸）
├── screen.ts         截图与 zoom
├── display.ts        显示器检测、启动预检（权限 / cliclick）
├── input.ts          cliclick 封装：鼠标、按键、文本
├── scroll.ts         Swift helper 进程管理：滚动、中键
├── clipboard.ts      剪贴板读写与“粘贴后恢复”
├── apps.ts           已安装应用枚举、前台应用、激活、描述过滤
├── types.ts          共享类型
├── native/scroll.swift
│
│   后台模式（见 BACKGROUND.md）
├── driverServer.ts   后台模式共用层：坐标换算、zoom、批处理、结果格式
├── browser.ts        浏览器模式入口
├── browser-server.ts 浏览器驱动（Playwright / Chrome DevTools 协议）
├── browserKeys.ts    键名 → Playwright 键名
├── background.ts     原生后台模式入口（实验性）
├── background-server.ts 原生驱动：CGEventPostToPid + 窗口截图
├── nativeKeys.ts     键名 → macOS 虚拟键码与修饰键标志
├── nativeHelper.ts   background.swift 进程管理
└── native/background.swift
```

`tools.ts` 只负责 schema，`server.ts` 只负责执行，与官方包的分工一致。

## 请求流程

```
MCP 客户端
  └─ tools/call ─► dispatch(ctx, name, args)            server.ts
                      ├─ guard(ctx, kind)               每个输入动作恰好一次
                      │    ├─ getFrontmostBundleId()    apps.ts（lsappinfo，回退 osascript）
                      │    └─ assertActionAllowed()     policy.ts
                      ├─ assertChordAllowed()           key / hold_key
                      ├─ toLogical(x, y)                coords.ts
                      └─ input.* / scrollAt / capture   执行
```

所有输入动作都经过 `guard()`，**包括 `computer_batch` 里的每一个动作**。
因此前台应用检查和快捷键黑名单只有一个执行点，不会有遗漏的路径。

## 坐标映射

这是最容易“看起来能用、实际有偏差”的部分，所以单独说明（详见 `coords.ts`、`imageResize.ts`）。

三个坐标空间：

| 空间 | 使用者 | 尺寸 |
|------|--------|------|
| 逻辑点（logical points） | `cliclick` | 例如 1512×982 |
| 物理像素 | `screencapture` | 逻辑 × scaleFactor，例如 3024×1964 |
| 模型像素 | 模型看到的截图 | `targetImageSize(物理像素)`，例如 1372×891 |

要点：

1. **截图在本地就缩放到 API 的目标尺寸。**
   API 服务端会把超出 token 预算的图片再缩一次；如果本地不预先缩放，
   模型实际看到的尺寸和我们以为的尺寸不同，点击会系统性偏移。
   `imageResize.ts` 移植了服务端算法，**同时满足长边 ≤ 1568 和 token ≤ 1568 两个约束**。
   只看长边是不够的：14" MBP 上 1568×1014 = 2072 tokens，服务端会再缩到 1372×887，误差约 14%。
2. **映射公式是 `logical = model × (logicalW / targetW)`**，两个维度分别计算。
   不能写成 `1 / scaleFactor`，那样在 14" MBP 上会有约 21% 的偏差。
3. **只在最后一步取整。** 中间取整会让 Retina 屏上的逻辑点被量化成偶数，导致小目标点不中。
4. **scaleFactor 靠实测，不靠猜。** `display.ts` 对比实际截图尺寸和逻辑尺寸来推导缩放比；
   推导不出合理值（< 1 或 > 4）就拒绝启动，而不是带着偏差运行。
5. `zoom` 只是为了看清细节的放大视图，**不改变坐标基准**，之后的点击仍然以全屏截图为准。

## 权限模型

详见 `policy.ts`。

### 会话白名单

- 调用 `request_access` 之前，截图和所有输入操作都会被拒绝（`needs_access`）；
  `list_granted_applications`、`cursor_position`、`switch_display`、`wait` 这类无副作用的工具不受限制。
- `request_access` 按显示名（不区分大小写）或 bundle ID 解析应用；无法解析的会逐个列出，不会静默授予空集。
- 多次调用 `request_access` 时白名单**累加**，不会覆盖之前的授权。
- 每个输入动作执行前都会检查**当前前台应用**是否在白名单中（`not_granted`）。
  这样可以防止“一次点击打开了未授权的应用，下一步就在它上面操作”。

### 应用分级（可选，默认关闭）

默认情况下，所有已授权的应用都是 `full`：浏览器、终端、IDE 都可以查看、点击、输入和按键。
边界由白名单、前台应用检查和系统快捷键黑名单保证。

设置 `CU_STRICT_APP_TIERS=1` 后，恢复官方实现的分级：

| 分级 | 应用 | 允许 |
|------|------|------|
| `full` | 其他所有应用 | 全部操作 |
| `click` | 能执行任意命令的应用：Terminal、iTerm2、VS Code、Warp、WezTerm、Alacritty、kitty、IntelliJ、PyCharm | 点击、滚动；**禁止输入文本和按键** |
| `read` | 浏览器：Safari、Chrome、Firefox、Edge、Arc | 只在截图中可见，**禁止任何交互** |

### 额外授权

| 授权 | 作用 |
|------|------|
| `clipboardRead` | 允许 `read_clipboard` |
| `clipboardWrite` | 允许 `write_clipboard`，并允许多行 `type` 走剪贴板粘贴 |
| `systemKeyCombos` | 允许系统级快捷键：⌘Q、⇧⌘Q、⌥⌘Esc、⌘Tab、⌘Space、⌃⌘Q |

剪贴板授权不受前台应用限制，因为剪贴板本身是全局的。

### 快捷键黑名单的细节

- 修饰键别名统一归一：`cmd` / `command` / `meta` / `super` / `win` 都视为 `meta`，避免漏掉某种写法。
- 对**每个非修饰键单独检查**：`cmd+q+a` 会先按下 ⌘，再按 Q（此时 ⌘Q 已经触发），再按 A；
  只匹配整串 `meta+q+a` 会漏掉它。

### 错误码

`needs_access` · `not_granted` · `denied_tier` · `needs_flag` · `bad_request`，
与官方 `CuErrorKind` 对应，模型可以据此判断下一步该怎么做。

## computer_batch

- 按顺序执行，**遇到第一个错误即停止**，并返回已完成的动作列表。
- 整个批次的坐标都基于**批次开始前**的截图；批次中间的 `screenshot` 只影响模型下一轮的判断，
  不会中途改变本批次的坐标基准。
- `guard()` 对批次内的每个动作分别执行。

## 输入实现要点

### 按键（`input.ts`）

cliclick 有三种按键机制，用错了会静默出错：

| 类型 | 机制 | 说明 |
|------|------|------|
| 修饰键（cmd/ctrl/alt/shift/fn） | `kd:` / `ku:` | 按下与松开分开发送；`kp:cmd` 会被拒绝 |
| 命名键（return、esc、arrow-up、f1…） | `kp:` | 按下并松开 |
| 普通字符（字母、数字、标点） | `t:` | `kp:a` 会被拒绝 |

组合键按“按下修饰键 → 按键 → **逆序**松开修饰键”发送，避免修饰键卡住。
`hold_key` 在 `finally` 中松开修饰键，保证出错时也不会卡键。
模型使用的键名（`escape`、`arrowup`、`backspace`…）到 cliclick 键名的映射集中在 `KEY_MAP`。

### 文本输入

- 单行文本：`cliclick t:`。参数通过 argv 传递，从不经过 shell，文本中的任何字符都不会造成命令注入。
- 多行文本：`t:` 不会把 `\n` 转成回车，所以改为剪贴板粘贴，需要 `clipboardWrite` 授权。
  流程为：保存剪贴板 → 写入 → **回读校验** → ⌘V → 等待 100ms → 在 `finally` 中恢复原剪贴板。
- 长文本：已授予 `clipboardWrite` 时，超过 200 字符的单行文本也走同样的粘贴流程，比逐字符输入快得多。

### 鼠标

- 移动后等待 50ms（`MOVE_SETTLE_MS`）再点击，确保应用已经处理完移动事件。
  移动、等待、点击合并在**一次** cliclick 调用里完成（`m:` + `w:50` + `c:`），省掉一次进程启动。
- 拖拽使用 `dd:` + `dm:` + `du:`，中间的移动事件是大多数拖拽目标识别手势所必需的。

### 滚动与中键（`scroll.ts`）

cliclick 没有滚动和中键命令。首次使用时用 `swiftc` 把 `native/scroll.swift` 编译到
`~/.cache/computer-use-mcp/cuscroll`，之后作为常驻子进程逐行接收指令（每 tick 40px）。
helper 会回复 `ok` / `err`，静默失败会被报告为工具错误。

## 应用列表与提示注入防护（`apps.ts`）

`request_access` 的工具描述里会列出本机已安装的应用，方便模型写对名字。

- 从 `/Applications`、`/System/Applications`、`/System/Library/CoreServices`、`~/Applications` 枚举。
- 过滤 Helper / Agent / Service / Updater 等后台组件，以及全小写单词形式的守护进程名。
- 常用应用和系统应用（Finder、TextEdit…）按 bundle ID 强制保留，不受 80 个的数量上限影响。
- **应用名可以被任何人随意设置**，因此会先截断到 40 个字符，再按字符白名单过滤，
  防止有人借应用名往工具描述里注入指令。

## 性能

前台应用检查在**每个动作前**都会执行（批处理中每一步各一次），是单次操作延迟的主要来源，因此：

- 前台应用用 `lsappinfo front` + `lsappinfo info -only bundleid` 直接查询 LaunchServices，比 `osascript` 向 System Events 发 Apple Event 快得多，也不需要“自动化”权限；只有 `lsappinfo` 失败时才回退到 `osascript`。
- 点击的移动、稳定等待、点击在一次 cliclick 调用中完成。
- 启动时用 `mdfind -attr kMDItemCFBundleIdentifier` 一次取回路径和 bundle ID，只对 Spotlight 缺 ID 的应用回退到 `defaults read`（最多 16 个并发）。
- 批量操作请用 `computer_batch`：省掉的是模型往返，这比任何本地优化都显著。

## 启动预检（`display.ts`）

启动时检查，失败则给出可操作的修复提示后退出，而不是在任务进行中才报出难以理解的错误：

1. **屏幕录制权限**：`screencapture` 是否可用。
2. **辅助功能权限**：`cliclick` 能否合成输入。
3. **cliclick 是否已安装**。
4. **显示器几何**：能否测出合理的 scaleFactor。

## 传输

| 入口 | 传输 | 用途 |
|------|------|------|
| `dist/index.js` | stdio | 默认；由 MCP 客户端直接启动 |
| `dist/http-server.js` | Streamable HTTP（`/mcp`）+ SSE（`/sse`） | 只能通过 HTTP 接入的客户端 |
| `dist/browser.js` | stdio | 浏览器模式 |
| `dist/background.js` | stdio | 原生后台模式（实验性） |

## 后台模式

桌面模式发送的是系统全局事件，会占用用户的鼠标键盘。两种后台模式换了事件的投递目标，工具契约不变：

| | 浏览器模式 | 原生后台模式 |
|--|------------|--------------|
| 输入 | Playwright → Chrome DevTools 协议，事件直接进入网页 | `CGEventPostToPid`，事件直接进入目标进程 |
| 截图 | 网页可视区域 | 目标应用窗口（`screencapture -l`） |
| 坐标单位 | CSS 像素 | 窗口内的点（点击前加上窗口当前的屏幕坐标） |
| 权限 | 不需要 macOS 权限 | 屏幕录制 + 辅助功能 |

两者共用 `driverServer.ts`：每种模式只实现一个 `Driver`（截图、点击、移动、按下/松开、拖拽、输入、按键、按住、滚动这几个原语），
截图缩放、坐标换算、`zoom`、`computer_batch` 和结果格式都由共用层处理，因此两种模式的行为一致。

`background.swift` 编译为独立的二进制（`~/.cache/computer-use-mcp/cubg-<源码哈希>`），与滚动小工具分开：
它编译失败不会影响桌面模式；源码更新后会按新哈希重新编译。

两者都调用 `server.ts` 的 `createServer()`，工具和策略完全相同。
HTTP 模式下每个客户端会话有独立的会话状态；默认只监听 `127.0.0.1`，并启用 DNS rebinding 防护。

## 从 v2 保留下来的时序常量

| 常量 | 值 | 位置 | 作用 |
|------|----|------|------|
| `MOVE_SETTLE_MS` | 50ms | `input.ts` | 移动后、点击前的稳定时间 |
| 按键重复间隔 | 8ms | `input.ts` `pressChord` | 与 125Hz USB 轮询对齐 |
| 粘贴后等待 | 100ms | `clipboard.ts` | 应用读取剪贴板后再恢复 |

v2 的动画移动（ease-out-cubic）在 v3 中没有保留：官方工具契约里没有这个选项。
