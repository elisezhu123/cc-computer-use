# cc-computer-use

**在 macOS 上为任意 MCP 客户端提供 Claude Code Desktop 风格的 computer use。**

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%7C%20HTTP-orange.svg)](https://modelcontextprotocol.io/)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Claude Code Desktop 内置了 computer use：先申请要控制的应用，再截图、点击、输入，并且有一整套权限保护。
这个项目把同样的交互方式做成了一个独立的 MCP 服务器，用 `cliclick` 和 macOS 自带的命令行工具实现，
可以在 Claude Code CLI、Claude Desktop 或其他任何 MCP 客户端里使用。

## 项目来源

- **交互逻辑**：工具集、参数、坐标约定和权限流程，参照 Claude Code Desktop 内置的 computer-use MCP 服务器。
  模型在官方环境中学会的用法在这里原样适用。
- **底层算法**：点击前的稳定等待、剪贴板粘贴与恢复、按键时序等，来自 Claude Code 旧版源码中的
  `utils/computerUse/executor.ts`。
- **本项目的实现**：用 cliclick 和一个 Swift 小工具替代官方的原生模块，并补上了独立运行所需的部分：
  显示器检测、截图缩放、坐标映射、启动预检、HTTP 传输等。

> 本项目是个人学习与研究项目，与 Anthropic 没有关联，也未获得其认可。
> Claude、Claude Code 是 Anthropic 的商标；Claude Code 的原始源码归 Anthropic 所有。
> 本仓库中的代码是独立实现，按 [MIT 协议](LICENSE) 发布。

## 特性

- **与官方一致的 24 个工具**：`request_access`、`screenshot`、`zoom`、`left_click`、`type`、`key`、`scroll`、`computer_batch` 等。
- **权限保护**：
  - 会话级应用白名单，每个动作执行前都检查前台应用；
  - 终端、IDE 只允许点击，浏览器只允许查看；
  - 剪贴板和系统快捷键（⌘Q、⌘Tab 等）需要单独授权。
- **点击精准**：截图在本地按 API 算法预先缩放，坐标按实测的显示器几何映射，Retina 屏和多显示器都能正确定位。
- **批处理**：`computer_batch` 一次调用执行多步操作，减少模型往返次数。
- **两种传输**：stdio（默认），以及 Streamable HTTP / SSE（[Gateway 模式](computer-use-mcp-server/GATEWAY.md)）。
- **安全调用外部命令**：统一使用 `execFile` + argv，不拼接 shell 字符串，输入的文本不会造成命令注入。

## 环境要求

- macOS
- Node.js ≥ 18
- [`cliclick`](https://github.com/BlueM/cliclick)：`brew install cliclick`
- Xcode Command Line Tools（首次滚动或中键点击时用来编译 Swift 小工具）：`xcode-select --install`

## 安装

```bash
git clone https://github.com/elisezhu123/cc-computer-use.git
cd cc-computer-use
npm install
npm run build
```

也可以运行 `./setup.sh`，它会检查并安装 cliclick，然后完成构建。

## 配置 MCP 客户端

下面的 `/path/to/cc-computer-use` 请替换成实际的克隆路径（可以用 `pwd` 查看）。

**Claude Code CLI：**

```bash
claude mcp add computer-use -- node /path/to/cc-computer-use/dist/index.js
```

**Claude Desktop**，编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "node",
      "args": ["/path/to/cc-computer-use/dist/index.js"]
    }
  }
}
```

**HTTP 客户端**：见 [GATEWAY.md](computer-use-mcp-server/GATEWAY.md)。

## 授予系统权限

打开 **系统设置 → 隐私与安全性**，给**启动这个 MCP 服务器的应用**授予以下两项权限：

- **屏幕录制**：用于截图
- **辅助功能**：用于模拟鼠标和键盘

“启动服务器的应用”指的是：在终端里用 Claude Code 时是 Terminal / iTerm2，用 Claude Desktop 时是 Claude.app。
授权后需要重启该应用。

如果缺少权限，服务器启动时会直接报出缺了哪一项、以及怎么修复。

## 使用

直接用自然语言描述任务即可，例如：

```
打开 TextEdit，新建一个文档，输入“你好，世界”并保存到桌面
```

模型通常会按以下流程操作：

1. `request_access` 申请 TextEdit（如需多行输入，同时申请 `clipboardWrite`）。你会在工具调用确认中看到申请理由。
2. `open_application` 把 TextEdit 切到前台。
3. `screenshot` 获取当前画面。之后所有坐标都以这张截图的像素为准。
4. `left_click` / `type` / `key` 完成操作，或者用 `computer_batch` 一次执行多步。

更多示例见 [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)。

## 工具列表

| 类别 | 工具 | 说明 |
|------|------|------|
| 权限 | `request_access` | 申请控制一组应用，可选 `clipboardRead` / `clipboardWrite` / `systemKeyCombos` |
| | `list_granted_applications` | 查看已授权的应用、授权标志和当前截图尺寸 |
| 屏幕 | `screenshot` | 截图；之后的所有坐标都相对于这张图 |
| | `zoom` | 放大查看截图的某个区域，不改变坐标基准 |
| | `switch_display` | 切换要截图的显示器 |
| | `cursor_position` | 当前鼠标位置（截图像素坐标） |
| 鼠标 | `left_click` `double_click` `triple_click` `right_click` `middle_click` | 点击，可附带修饰键 |
| | `mouse_move` | 移动鼠标（用于触发悬停效果） |
| | `left_click_drag` | 拖拽 |
| | `left_mouse_down` `left_mouse_up` | 分别按下、松开左键 |
| | `scroll` | 在指定位置向上/下/左/右滚动 |
| 键盘 | `type` | 输入文本；多行文本通过剪贴板粘贴 |
| | `key` | 按键或组合键，如 `cmd+s`、`ctrl+shift+tab` |
| | `hold_key` | 按住一段时间后松开 |
| 应用 | `open_application` | 把已授权的应用切到前台（未运行时会启动） |
| 剪贴板 | `read_clipboard` `write_clipboard` | 需要对应授权 |
| 其他 | `wait` | 等待界面稳定 |
| | `computer_batch` | 在一次调用中按顺序执行多个动作，遇错即停 |

## 权限模型

| 应用分级 | 应用 | 允许的操作 |
|----------|------|------------|
| full | 大多数应用 | 全部 |
| click | Terminal、iTerm2、VS Code、Warp、WezTerm、Alacritty、kitty、IntelliJ、PyCharm | 点击、滚动；不能输入和按键 |
| read | Safari、Chrome、Firefox、Edge、Arc | 只能在截图中查看 |

- 每个输入动作执行前都会检查前台应用是否在白名单中，`computer_batch` 中的每一步也会单独检查。
- ⌘Q、⇧⌘Q、⌥⌘Esc、⌘Tab、⌘Space、⌃⌘Q 需要 `systemKeyCombos` 授权。任何别名写法（`command+q`、`meta+q`）
  和夹带写法（`cmd+q+a`）都会被识别出来。

设计细节见 [reports/ARCHITECTURE.md](reports/ARCHITECTURE.md)。

## 项目结构

```
src/
├── index.ts          stdio 入口
├── http-server.ts    HTTP 入口（Streamable HTTP + SSE）
├── server.ts         会话状态与工具分发
├── tools.ts          工具 schema
├── policy.ts         白名单、应用分级、快捷键黑名单
├── coords.ts         坐标映射
├── imageResize.ts    截图目标尺寸算法
├── screen.ts         截图与 zoom
├── display.ts        显示器检测与启动预检
├── input.ts          cliclick 封装
├── scroll.ts         滚动 / 中键（Swift helper）
├── clipboard.ts      剪贴板
├── apps.ts           应用枚举、前台应用、激活
└── native/scroll.swift
```

## 开发

```bash
npm run dev            # tsx 直接运行 stdio 服务器
npm run dev:gateway    # tsx 直接运行 HTTP gateway
npm run typecheck
npm test               # 单元测试；未安装 cliclick 时会跳过 4 个依赖它的测试
node test-tools.mjs    # 真机冒烟：启动服务器并列出工具（需要 macOS 权限）
```

测试说明见 [reports/TESTING.md](reports/TESTING.md)，版本演进见 [reports/CHANGELOG.md](reports/CHANGELOG.md)。

## 常见问题

| 现象 | 解决 |
|------|------|
| 启动失败：`Screen Recording permission is not granted` | 给启动服务器的应用开启“屏幕录制”，然后重启该应用 |
| 启动失败：`Accessibility permission is not granted` | 开启“辅助功能”，然后重启 |
| 启动失败：`cliclick is not installed or not runnable` | `brew install cliclick` |
| 所有操作都返回 `not_granted`，提示无法确定前台应用 | 前台应用通过 `lsappinfo` 查询，失败时回退到 AppleScript；这时需要在“隐私与安全性 → 自动化”中允许启动服务器的应用控制 **System Events** |
| 工具返回 `needs_access` | 需要先调用 `request_access` |
| 工具返回 `not_granted` | 前台应用不在白名单里：先用 `request_access` 添加它，或把已授权的应用切到前台 |
| 工具返回 `denied_tier` | 该应用属于 click / read 分级，不允许这个操作 |
| 滚动时报 Swift 编译失败 | `xcode-select --install` |
| 点击位置有偏差 | 先重新截图（坐标以最近一次截图为准）；多显示器时确认 `switch_display` 选对了屏幕 |

更完整的安装和排查说明见 [INSTALL.md](INSTALL.md)。

## 局限

- 仅支持 macOS。
- 输入通过 cliclick 模拟，某些对合成事件做了限制的应用（例如部分游戏、安全输入框）可能不响应。
- `open_application` 通过 AppleScript 激活应用，首次使用时 macOS 可能会询问是否允许控制目标应用，需要点击允许。

## 许可

[MIT](LICENSE) © elisezhu123
