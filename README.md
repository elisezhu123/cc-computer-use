# cc-computer-use

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%7C%20HTTP-orange.svg)](https://modelcontextprotocol.io/)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[中文](#中文) · [English](#english)**

---

## 中文

**在 macOS 上为任意 MCP 客户端提供 Claude Code Desktop 风格的 computer use。**

Claude Code Desktop 内置了 computer use：先申请要控制的应用，再截图、点击、输入，并且有一套权限保护。
这个项目把同样的交互方式做成了一个独立的 MCP 服务器，可以在 Claude Code CLI、Claude Desktop 或其他任何 MCP 客户端里使用。
AI 可以操作 macOS 上的软件和浏览器，也可以在浏览器里玩回合制等节奏较慢的游戏。

### 项目来源

- **交互逻辑**：工具集、参数、坐标约定和权限流程，参照 Claude Code Desktop 内置的 computer-use MCP 服务器，
  模型在官方环境中学会的用法在这里原样适用。
- **底层算法**：点击前的稳定等待、剪贴板粘贴与恢复、按键时序等，来自 Claude Code 旧版源码中的 `utils/computerUse/executor.ts`。
- **本项目的实现**：用 cliclick、Playwright 和 Swift 小工具替代官方的原生模块，并补上独立运行所需的部分：
  显示器检测、截图缩放、坐标映射、启动预检、HTTP 传输、后台模式等。

> 本项目是个人学习与研究项目，与 Anthropic 没有关联，也未获得其认可。
> Claude、Claude Code 是 Anthropic 的商标；Claude Code 的原始源码归 Anthropic 所有。
> 本仓库中的代码是独立实现，按 [MIT 协议](LICENSE) 发布。

### 三种运行模式

| 模式 | 入口 | 操作对象 | 占用你的鼠标键盘 |
|------|------|----------|------------------|
| **桌面模式**（默认） | `dist/index.js` | 所有已授权的 macOS 应用 | 是 |
| **浏览器模式** | `dist/browser.js` | 一个独立的 Chrome（网页、浏览器游戏） | **否**，窗口可遮挡、最小化或无界面 |
| **原生后台模式**（实验性） | `dist/background.js` | 指定的一个 macOS 应用 | **否**；但应用可能忽略后台点击 |

后台模式的详细说明、以及在虚拟机里运行的方法，见 [BACKGROUND.md](BACKGROUND.md)。

### 特性

- **与官方一致的工具**：`request_access`、`screenshot`、`zoom`、`left_click`、`type`、`key`、`scroll`、`computer_batch` 等 24 个。
- **所有已授权的应用都能完全交互**：包括浏览器、终端和 IDE，可以查看、点击、输入和按键。
- **权限保护**：
  - 会话级应用白名单，每个动作执行前都检查前台应用；
  - 剪贴板和系统快捷键（⌘Q、⌘Tab 等）需要单独授权；
  - 可选的严格分级（`CU_STRICT_APP_TIERS=1`）。
- **点击精准**：截图在本地按 API 算法预先缩放，坐标按实测的显示器几何映射，Retina 屏和多显示器都能正确定位。
- **速度**：
  - 前台应用检查用 `lsappinfo`，不再发 AppleScript；
  - 每次点击只启动一次 cliclick；
  - 长文本改为粘贴；
  - `computer_batch` 一次调用执行多步。
- **两种传输**：stdio（默认），以及 Streamable HTTP / SSE（[Gateway](computer-use-mcp-server/GATEWAY.md)）。
- **安全调用外部命令**：统一使用 `execFile` + argv，不拼接 shell 字符串，输入的文本不会造成命令注入。

### 环境要求

- macOS、Node.js ≥ 18
- 桌面模式：[`cliclick`](https://github.com/BlueM/cliclick)（`brew install cliclick`）
- 滚动、中键和原生后台模式：Xcode Command Line Tools（`xcode-select --install`）
- 浏览器模式：Google Chrome（或用 `CU_BROWSER_PATH` 指定 Chromium）

### 安装

```bash
git clone https://github.com/elisezhu123/cc-computer-use.git
cd cc-computer-use
npm install
npm run build
```

也可以运行 `./setup.sh`，它会检查并安装 cliclick，然后完成构建。

### 配置 MCP 客户端

`/path/to/cc-computer-use` 请替换成实际的克隆路径（可以用 `pwd` 查看）。

```bash
# 桌面模式
claude mcp add computer-use -- node /path/to/cc-computer-use/dist/index.js
# 浏览器模式（可以和桌面模式同时配置）
claude mcp add computer-use-browser -- node /path/to/cc-computer-use/dist/browser.js
```

**Claude Desktop**：编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

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

### 授予系统权限（桌面模式、原生后台模式）

打开 **系统设置 → 隐私与安全性**，给**启动这个 MCP 服务器的应用**授予**屏幕录制**（截图）和**辅助功能**（模拟鼠标键盘）两项权限。
在终端里用 Claude Code 时，这个应用是 Terminal 或 iTerm2；用 Claude Desktop 时是 Claude.app。授权后需要重启该应用。
如果缺少权限，服务器启动时会直接报出缺了哪一项、以及怎么修复。浏览器模式不需要这些权限。

### 使用

直接用自然语言描述任务即可：

```
打开 TextEdit，新建一个文档，输入“你好，世界”并保存到桌面
```

模型通常会按以下流程操作：

1. `request_access` 申请 TextEdit；
2. `open_application` 把它切到前台；
3. `screenshot` 截图，之后的坐标都以这张截图的像素为准；
4. `left_click` / `type` / `key` 完成操作，或者用 `computer_batch` 一次执行多步。

更多示例见 [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)。

### 工具列表

| 类别 | 工具 | 说明 |
|------|------|------|
| 权限 | `request_access` | 申请控制一组应用，可选 `clipboardRead` / `clipboardWrite` / `systemKeyCombos` |
| | `list_granted_applications` | 查看已授权的应用、授权标志和当前截图尺寸 |
| 屏幕 | `screenshot` `zoom` | 截图、放大查看某个区域；坐标始终以全屏截图为准 |
| | `switch_display` `cursor_position` | 切换显示器、查询光标位置 |
| 鼠标 | `left_click` `double_click` `triple_click` `right_click` `middle_click` | 点击，可附带修饰键 |
| | `mouse_move` `left_click_drag` `left_mouse_down` `left_mouse_up` | 移动、拖拽、分别按下 / 松开 |
| | `scroll` | 在指定位置滚动 |
| 键盘 | `type` `key` `hold_key` | 输入文本、按键或组合键（`cmd+s`）、按住一段时间 |
| 应用 | `open_application` | 把已授权的应用切到前台（未运行时会启动） |
| 剪贴板 | `read_clipboard` `write_clipboard` | 需要对应授权 |
| 其他 | `wait` `computer_batch` | 等待、一次调用执行多个动作（遇错即停） |

浏览器模式另有 `navigate`（打开网址 / 后退 / 前进 / 刷新）。

### 权限模型

- 只能操作 `request_access` 授权过的应用；授权后的应用（包括浏览器、终端、IDE）都可以查看、点击、输入和按键。
- 每个输入动作执行前都会检查前台应用是否在白名单中，`computer_batch` 中的每一步也会单独检查。
- ⌘Q、⇧⌘Q、⌥⌘Esc、⌘Tab、⌘Space、⌃⌘Q 需要 `systemKeyCombos` 授权，任何别名写法（`command+q`）和夹带写法（`cmd+q+a`）都会被识别。
- **可选的严格分级**：设置 `CU_STRICT_APP_TIERS=1` 后恢复官方的限制：浏览器只能查看；终端和 IDE 只能点击、不能输入。
  适合不希望模型在网页上付款、提交表单，或在终端里执行命令的场景：

  ```bash
  claude mcp add computer-use -e CU_STRICT_APP_TIERS=1 -- node /path/to/cc-computer-use/dist/index.js
  ```

> ⚠️ 授权浏览器后，模型可以在网页上点击“购买”“发送”“删除”。建议使用没有登录重要账号的浏览器，
> 或者改用浏览器模式（它使用独立的配置目录，不会带上你的登录状态），并在指令里说明“付款、发消息前先问我”。

设计细节见 [reports/ARCHITECTURE.md](reports/ARCHITECTURE.md)。

### 开发

```bash
npm run dev              # 桌面模式（tsx 直接运行）
npm run dev:browser      # 浏览器模式
npm run dev:background   # 原生后台模式
npm run dev:gateway      # HTTP gateway
npm run typecheck
npm test                 # 单元测试；未安装 cliclick 时会跳过依赖它的测试
node test-tools.mjs      # 真机冒烟：启动桌面模式并列出工具（需要 macOS 权限）
```

测试说明见 [reports/TESTING.md](reports/TESTING.md)，版本演进见 [reports/CHANGELOG.md](reports/CHANGELOG.md)。

### 常见问题

| 现象 | 解决 |
|------|------|
| 启动失败：`Screen Recording permission is not granted` | 给启动服务器的应用开启“屏幕录制”，然后重启该应用 |
| 启动失败：`Accessibility permission is not granted` | 开启“辅助功能”，然后重启 |
| 启动失败：`cliclick is not installed or not runnable` | `brew install cliclick` |
| 工具返回 `needs_access` | 先调用 `request_access` |
| 工具返回 `not_granted` | 前台应用不在白名单里：用 `request_access` 添加，或把已授权的应用切到前台。若一直无法确定前台应用，在“隐私与安全性 → 自动化”中允许控制 **System Events** |
| 工具返回 `denied_tier` | 只在 `CU_STRICT_APP_TIERS=1` 时出现，去掉该变量即可 |
| 浏览器模式：`Could not launch the browser` | 安装 Google Chrome，或设置 `CU_BROWSER_PATH` |
| 滚动或后台模式报 Swift 编译失败 | `xcode-select --install` |
| 点击位置有偏差 | 重新截图（坐标以最近一次截图为准）；多显示器时确认 `switch_display` 选对了屏幕 |

更完整的安装和排查说明见 [INSTALL.md](INSTALL.md)。

### 局限

- 仅支持 macOS。
- 每一步都是“截图 → 模型思考 → 执行”，一个来回需要几秒，不适合需要实时反应的游戏。
- 桌面模式通过 cliclick 模拟输入，某些限制合成事件的应用（部分游戏、安全输入框）可能不响应。
- 原生后台模式尚未在真机上验证，且应用可能忽略发给后台窗口的点击。

### 许可

[MIT](LICENSE) © elisezhu123

---

## English

**Claude Code Desktop–style computer use on macOS, for any MCP client.**

Claude Code Desktop has built-in computer use: request the apps to control, then screenshot, click and type, all behind a permission model.
This project provides the same interaction as a standalone MCP server that works in the Claude Code CLI, Claude Desktop, or any other MCP client.
It lets an AI operate macOS apps and browsers, including slower-paced browser games such as turn-based ones.

### Origin

- **Interaction model**: tool set, parameters, coordinate conventions and permission flow follow the computer-use MCP server built into
  Claude Code Desktop, so what the model learned there applies unchanged.
- **Low-level algorithms**: the pre-click settle delay, clipboard paste-and-restore and key timing come from `utils/computerUse/executor.ts`
  in an earlier Claude Code source release.
- **This implementation**: cliclick, Playwright and small Swift helpers replace the official native modules, plus what a standalone server needs:
  display detection, screenshot sizing, coordinate mapping, startup preflight, HTTP transport and background modes.

> This is a personal learning and research project, not affiliated with or endorsed by Anthropic.
> Claude and Claude Code are trademarks of Anthropic; the original Claude Code source belongs to Anthropic.
> The code in this repository is an independent implementation released under the [MIT License](LICENSE).

### Three modes

| Mode | Entry point | Controls | Uses your mouse and keyboard |
|------|-------------|----------|------------------------------|
| **Desktop** (default) | `dist/index.js` | Any granted macOS app | Yes |
| **Browser** | `dist/browser.js` | A separate Chrome (web pages, browser games) | **No**; the window can be covered, minimized or headless |
| **Native background** (experimental) | `dist/background.js` | One chosen macOS app | **No**; but apps may ignore background clicks |

See [BACKGROUND.md](BACKGROUND.md) (Chinese) for the background modes and for running inside a virtual machine.

### Features

- **The official tool set**: 24 tools including `request_access`, `screenshot`, `zoom`, `left_click`, `type`, `key`, `scroll` and `computer_batch`.
- **Every granted app is fully interactive**, browsers, terminals and IDEs included: view, click, type and press keys.
- **Permission model**:
  - a per-session app allowlist, with the frontmost app checked before every action;
  - separate grants for the clipboard and for system shortcuts (⌘Q, ⌘Tab, …);
  - optional strict tiers (`CU_STRICT_APP_TIERS=1`).
- **Accurate clicks**: screenshots are pre-sized with the API's own algorithm, and coordinates are mapped with measured display geometry,
  so Retina and multi-monitor setups land correctly.
- **Speed**:
  - the frontmost check uses `lsappinfo` instead of AppleScript;
  - each click takes a single cliclick process;
  - long text is pasted;
  - `computer_batch` runs several steps in one call.
- **Two transports**: stdio (default), and Streamable HTTP / SSE ([gateway](computer-use-mcp-server/GATEWAY.md)).
- **Safe process calls**: everything goes through `execFile` with an argv array, never a shell string, so typed text cannot inject commands.

### Requirements

- macOS, Node.js ≥ 18
- Desktop mode: [`cliclick`](https://github.com/BlueM/cliclick) (`brew install cliclick`)
- Scrolling, middle click and native background mode: Xcode Command Line Tools (`xcode-select --install`)
- Browser mode: Google Chrome (or point `CU_BROWSER_PATH` at Chromium)

### Install

```bash
git clone https://github.com/elisezhu123/cc-computer-use.git
cd cc-computer-use
npm install
npm run build
```

`./setup.sh` does the same and installs cliclick if it is missing.

### Configure your MCP client

Replace `/path/to/cc-computer-use` with your clone's path (`pwd` shows it).

```bash
# Desktop mode
claude mcp add computer-use -- node /path/to/cc-computer-use/dist/index.js
# Browser mode (can be configured alongside desktop mode)
claude mcp add computer-use-browser -- node /path/to/cc-computer-use/dist/browser.js
```

**Claude Desktop**: edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

**HTTP clients**: see [GATEWAY.md](computer-use-mcp-server/GATEWAY.md).

### macOS permissions (desktop and native background modes)

In **System Settings → Privacy & Security**, grant **Screen Recording** (screenshots) and **Accessibility** (synthetic input)
to **the app that launches this server**: Terminal or iTerm2 when using the Claude Code CLI, Claude.app for Claude Desktop.
Restart that app afterwards. If a permission is missing, the server says which one and how to fix it at startup.
Browser mode needs neither permission.

### Usage

Describe the task in plain language:

```
Open TextEdit, create a new document, type "Hello, world" and save it to the Desktop
```

The model typically:

1. calls `request_access` for TextEdit;
2. calls `open_application` to bring it to the front;
3. takes a `screenshot`; all later coordinates are pixels of that screenshot;
4. uses `left_click` / `type` / `key`, or `computer_batch` for several steps at once.

More examples (Chinese): [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md).

### Tools

| Group | Tools | Notes |
|-------|-------|-------|
| Access | `request_access` | Request a set of apps; optional `clipboardRead` / `clipboardWrite` / `systemKeyCombos` |
| | `list_granted_applications` | Granted apps, grant flags and current screenshot size |
| Screen | `screenshot` `zoom` | Capture, or magnify a region; coordinates always refer to the full screenshot |
| | `switch_display` `cursor_position` | Choose a monitor; report the cursor position |
| Mouse | `left_click` `double_click` `triple_click` `right_click` `middle_click` | Optional modifier keys |
| | `mouse_move` `left_click_drag` `left_mouse_down` `left_mouse_up` | Move, drag, press and release separately |
| | `scroll` | Scroll at a position |
| Keyboard | `type` `key` `hold_key` | Type text, press a key or chord (`cmd+s`), hold for a duration |
| Apps | `open_application` | Bring a granted app to the front, launching it if needed |
| Clipboard | `read_clipboard` `write_clipboard` | Need the matching grant |
| Other | `wait` `computer_batch` | Wait; run several actions in one call, stopping at the first error |

Browser mode adds `navigate` (open a URL, back, forward, reload).

### Permission model

- Only apps granted through `request_access` can be operated; once granted, any app (browsers, terminals and IDEs included) can be viewed, clicked and typed into.
- The frontmost app is checked against the allowlist before every input action, including each step of `computer_batch`.
- ⌘Q, ⇧⌘Q, ⌥⌘Esc, ⌘Tab, ⌘Space and ⌃⌘Q need the `systemKeyCombos` grant; aliases (`command+q`) and embedded forms (`cmd+q+a`) are caught.
- **Optional strict tiers**: `CU_STRICT_APP_TIERS=1` restores the official restrictions: browsers are view-only; terminals and IDEs are click-only.
  Use it when the model should not pay, submit forms or run shell commands:

  ```bash
  claude mcp add computer-use -e CU_STRICT_APP_TIERS=1 -- node /path/to/cc-computer-use/dist/index.js
  ```

> ⚠️ Once a browser is granted, the model can click "Buy", "Send" or "Delete". Prefer a browser without important accounts signed in,
> or browser mode (it uses its own profile, without your logins), and tell the model to ask before paying or sending anything.

Design details (Chinese): [reports/ARCHITECTURE.md](reports/ARCHITECTURE.md).

### Development

```bash
npm run dev              # desktop mode via tsx
npm run dev:browser      # browser mode
npm run dev:background   # native background mode
npm run dev:gateway      # HTTP gateway
npm run typecheck
npm test                 # unit tests; cliclick-dependent ones are skipped without cliclick
node test-tools.mjs      # on-device smoke test: start desktop mode and list tools (needs macOS permissions)
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Startup fails: `Screen Recording permission is not granted` | Enable Screen Recording for the launching app, then restart it |
| Startup fails: `Accessibility permission is not granted` | Enable Accessibility, then restart |
| Startup fails: `cliclick is not installed or not runnable` | `brew install cliclick` |
| A tool returns `needs_access` | Call `request_access` first |
| A tool returns `not_granted` | The frontmost app is not granted: add it with `request_access` or bring a granted app forward. If the frontmost app can never be determined, allow control of **System Events** under Privacy & Security → Automation |
| A tool returns `denied_tier` | Only with `CU_STRICT_APP_TIERS=1`; unset it to lift the restriction |
| Browser mode: `Could not launch the browser` | Install Google Chrome, or set `CU_BROWSER_PATH` |
| Swift compile error when scrolling or in background mode | `xcode-select --install` |
| Clicks land off target | Take a fresh screenshot (coordinates refer to the latest one); on multiple monitors check `switch_display` |

Full setup and troubleshooting (Chinese): [INSTALL.md](INSTALL.md).

### Limitations

- macOS only.
- Each step is "screenshot → model → action", a few seconds per round trip, so real-time games are out of reach.
- Desktop mode synthesizes input with cliclick; apps that reject synthetic events (some games, secure input fields) may not respond.
- Native background mode is not yet verified on a Mac, and apps may ignore clicks sent to background windows.

### License

[MIT](LICENSE) © elisezhu123
