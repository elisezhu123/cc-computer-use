# 后台运行：不占用你的鼠标和键盘

默认的桌面模式通过 cliclick 发送**系统全局**的鼠标键盘事件，AI 操作时会移动你的光标，你没法同时使用电脑。
如果希望 AI 在后台操作、你继续做自己的事，可以用下面的方案：

| 方案 | 不占用鼠标键盘 | 能操作什么 | 状态 |
|------|----------------|------------|------|
| [浏览器模式](#浏览器模式) | ✅ 完全不占用；窗口可以被遮挡、最小化，或者不显示 | 网页、浏览器游戏（包括 canvas / WebGL） | 可用，已端到端测试 |
| [原生后台模式](#原生后台模式实验性) | ✅ 不移动光标，应用不必在最前面；屏幕上用紫色的 AI 光标显示操作位置 | 指定的一个 macOS 应用 | **实验性**：尚未在真机上验证；标准控件之外的点击能否生效取决于应用 |
| [虚拟机](#在虚拟机里运行) | ✅ 完全隔离 | 任何 macOS 软件 | 可用，不需要改代码 |

## 浏览器模式

`dist/browser.js` 通过 Chrome DevTools 协议控制一个**独立的 Chrome**。
输入事件直接送进网页本身，不经过系统鼠标键盘：

- 不移动你的光标，也不需要浏览器窗口在最前面；
- 窗口被其他窗口遮住、最小化，甚至无界面（headless）运行时，都照常工作；
- 关闭了 Chrome 的后台节流，窗口在后台时，游戏和动画仍然全速运行；
- 使用单独的浏览器配置目录，**不会带上你日常 Chrome 的登录状态和 Cookie**。

### 配置

需要安装 Google Chrome（或者用 `CU_BROWSER_PATH` 指定 Chromium）。不需要 cliclick，也不需要屏幕录制或辅助功能权限。

```bash
npm install && npm run build
claude mcp add computer-use-browser -- node /path/to/cc-computer-use/dist/browser.js
```

可选的环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CU_BROWSER_PATH` | 已安装的 Google Chrome | Chrome / Chromium 可执行文件路径 |
| `CU_BROWSER_HEADLESS` | 关 | 设为 `1` 时不显示窗口 |
| `CU_BROWSER_VIEWPORT` | `1280x800` | 网页可视区域大小（CSS 像素） |
| `CU_BROWSER_PROFILE` | `~/.cache/computer-use-mcp/browser-profile` | 浏览器配置目录，保存登录状态和 Cookie |
| `CU_BROWSER_START_URL` | `about:blank` | 启动时打开的网页 |

例如无界面运行、并直接打开某个游戏页面：

```bash
claude mcp add computer-use-browser \
  -e CU_BROWSER_HEADLESS=1 -e CU_BROWSER_START_URL=https://example.com/game \
  -- node /path/to/cc-computer-use/dist/browser.js
```

浏览器模式和桌面模式可以同时配置，两者互不影响。

### 工具

和桌面模式的名称、参数一致，另外新增了 `navigate`：

| 工具 | 说明 |
|------|------|
| `navigate` | 打开网址，或者 `back` / `forward` / `reload`；加载完成后返回截图 |
| `screenshot` `zoom` `cursor_position` | 截取的是网页可视区域，坐标规则和桌面模式相同 |
| `left_click` `double_click` `triple_click` `right_click` `middle_click` | 支持在 `text` 里指定修饰键 |
| `mouse_move` `left_click_drag` `left_mouse_down` `left_mouse_up` | |
| `type` `key` `hold_key` | 键名和桌面模式相同（`cmd+a`、`Down`、`Page_Down`…） |
| `scroll` `wait` `computer_batch` | |

没有 `request_access`、`open_application`、剪贴板和多显示器相关的工具：浏览器模式只操作它自己启动的那个浏览器。

### 用法示例

```
用浏览器模式打开 https://play2048.co ，玩到 512 为止
```

模型会调用 `navigate` 打开网页，然后在“截图 → 判断 → `key` / `computer_batch`”之间循环。

### 注意

- 每一步仍然是“截图 → 模型思考 → 执行”，一个来回需要几秒，所以适合回合制、不限时的游戏，不适合需要实时反应的游戏。
- `hold_key` 在按住期间不会像物理键盘那样自动连发，只发送一次按下和一次松开。
  需要连续触发的游戏，请用 `key` 的 `repeat` 参数。
- 配置目录会保存登录状态。如果在里面登录了账号，AI 下次也能用这个账号操作；不需要时删除该目录即可。

## 原生后台模式（实验性）

`dist/background.js` 在后台操作**一个**已授权的 macOS 应用：

- 输入事件通过 `CGEventPostToPid` 直接投递给该应用的进程，不经过系统鼠标键盘，**不会移动你的光标**；
- **AI 光标**：屏幕上会出现一个紫色箭头，滑到 AI 要操作的位置，点击时有一圈波纹。它是一个不接收鼠标的透明悬浮窗，
  你的真实光标完全不受影响，截图里也不会出现它（截图只截目标窗口）；
- **点击方式**：点到按钮、复选框、单选框、菜单项、弹出菜单、链接时，先通过辅助功能接口（AXPress）直接触发，
  后台窗口也能响应；点到输入框时先把焦点设到该输入框；其他位置发送带有目标窗口编号的鼠标事件，让系统把点击交给该窗口；
- 截图只截取该应用的窗口（`screencapture -l`），窗口被其他窗口挡住时也能截到；
- `open_application` 选择目标应用；如果应用没有运行，会在后台启动它（`open -g`），不会切到前台。

> ⚠️ **实验性功能。** AI 光标和辅助功能点击这部分 Swift 代码还没有在真机上编译和测试过。
> 标准控件通过辅助功能点击，通常可靠；画布、游戏、自绘界面等没有辅助功能信息的位置，仍然依赖发给后台窗口的鼠标事件，
> 是否响应由应用自己决定。网页请用上面的浏览器模式；要求可靠的话，请用虚拟机。

### 配置

不需要 cliclick。需要给启动服务器的应用授予**屏幕录制**和**辅助功能**权限。
首次使用时会用 `swiftc` 编译一个小工具，所以需要 Xcode Command Line Tools。

```bash
claude mcp add computer-use-background -- node /path/to/cc-computer-use/dist/background.js
```

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `CU_AGENT_CURSOR` | 开 | 设为 `0` 时不显示 AI 光标 |
| `CU_BACKGROUND_AX` | 开 | 设为 `0` 时不用辅助功能点击，一律发送鼠标事件 |
| `CU_AUTO_SCREENSHOT` | 开 | 设为 `0` 时动作后不自动附截图（所有模式通用） |

### 用法

工具和桌面模式相同，只是没有多显示器和剪贴板相关的工具。流程：

1. `request_access` 授权应用，例如 TextEdit；
2. `open_application` 选定目标应用（不会切到前台）；
3. `screenshot` 截取该应用窗口，之后的坐标都相对于这张窗口截图；
4. `type`、`key`、`left_click` 等操作都发给这个应用，结果里自动附上操作后的窗口截图。

应用白名单、系统快捷键黑名单和可选的严格分级（`CU_STRICT_APP_TIERS=1`）同样生效，检查对象是目标应用，而不是前台应用。

### 在 Mac 上验证

```bash
npm run build
node dist/background.js   # 确认能启动；首次调用工具时会编译 ~/.cache/computer-use-mcp/cubg-*
```

也可以先单独编译一次，确认 Swift 代码没有问题：

```bash
swiftc -O -o /tmp/cubg dist/native/background.swift && echo 编译成功
```

然后在 Claude Code 里：授权并选定 TextEdit，让它在后台窗口里输入一段文字、按 `cmd+a`，
再点一下工具栏或菜单里的按钮。同时你自己继续使用鼠标，确认：

1. 你的光标不受影响；
2. 屏幕上出现紫色 AI 光标，滑到点击位置并出现波纹；
3. TextEdit 收到了输入，按钮被按下（点按钮走的是辅助功能接口，结果不受窗口是否在前台影响）；
4. 每个动作的返回结果里带有操作后的窗口截图。

编译失败或行为不符合预期时，请把报错反馈回来。

## 在虚拟机里运行

想让 AI 在后台操作**任意** macOS 软件，最可靠的方式是在虚拟机里运行整个项目。
AI 操作的是虚拟机里的鼠标键盘，和你的电脑完全隔离；本项目的代码不需要任何改动。

Apple Silicon Mac 上可以用 [UTM](https://mac.getutm.app/) 或 [Tart](https://tart.run/) 创建 macOS 虚拟机：

1. 创建并启动一台 macOS 虚拟机（建议至少 8 GB 内存、60 GB 磁盘）。
2. 在虚拟机里安装 Node.js、cliclick、Xcode Command Line Tools，克隆本项目并 `npm install && npm run build`。
3. 在虚拟机里安装 Claude Code，按 [INSTALL.md](INSTALL.md) 配置 MCP 服务器，并给终端授予屏幕录制和辅助功能权限。
4. 在虚拟机里运行 Claude Code 下达任务。你可以把虚拟机窗口放在一边，继续用自己的电脑。

如果想在宿主机上的 Claude Code 里远程控制虚拟机，可以在虚拟机里运行 [HTTP Gateway](computer-use-mcp-server/GATEWAY.md)，
再通过 SSH 端口转发把端口接到宿主机（Gateway 只监听 127.0.0.1，不要直接暴露到网络上）：

```bash
# 在宿主机上执行：把虚拟机的 3100 端口转发到本机
ssh -N -L 3100:127.0.0.1:3100 user@<虚拟机 IP>
claude mcp add --transport http computer-use-vm http://127.0.0.1:3100/mcp
```

注意：macOS 的许可协议要求 macOS 虚拟机只能运行在 Apple 硬件上，同一台 Mac 最多运行两个 macOS 虚拟机。
