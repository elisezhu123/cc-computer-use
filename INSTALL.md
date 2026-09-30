# 安装与配置

## 1. 前置依赖

| 依赖 | 安装 | 验证 |
|------|------|------|
| macOS | — | — |
| Node.js ≥ 18 | `brew install node` 或 nvm | `node -v` |
| cliclick | `brew install cliclick` | `cliclick -V` |
| Xcode Command Line Tools | `xcode-select --install` | `swiftc --version` |

Xcode Command Line Tools 只在第一次使用 `scroll` 或 `middle_click` 时用到，
届时会把 `src/native/scroll.swift` 编译到 `~/.cache/computer-use-mcp/cuscroll`。

## 2. 构建

```bash
git clone https://github.com/elisezhu123/cc-computer-use.git
cd cc-computer-use
npm install
npm run build
```

或者一步完成：`./setup.sh`（检查并安装 cliclick，然后安装依赖并构建）。

构建产物在 `dist/`，入口是 `dist/index.js`（stdio）和 `dist/http-server.js`（HTTP）。

## 3. 配置 MCP 客户端

以下示例中的 `/path/to/cc-computer-use` 需要替换为实际路径。

### Claude Code CLI

```bash
# 仅当前项目可用（默认）
claude mcp add computer-use -- node /path/to/cc-computer-use/dist/index.js

# 所有项目都可用
claude mcp add --scope user computer-use -- node /path/to/cc-computer-use/dist/index.js

# 查看 / 删除
claude mcp list
claude mcp remove computer-use
```

也可以运行 `./configure.sh`，它会用当前克隆路径执行上面的 `claude mcp add`。

### Claude Code 项目配置文件

在项目根目录的 `.mcp.json` 中添加（可参考仓库里的 [`CONFIG-EXAMPLE.json`](CONFIG-EXAMPLE.json)）：

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

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`，内容同上，然后完全退出并重新打开 Claude Desktop。

### 只支持 HTTP 的客户端

参见 [GATEWAY.md](computer-use-mcp-server/GATEWAY.md)。

### 开发时直接运行源码

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "npx",
      "args": ["tsx", "/path/to/cc-computer-use/src/index.ts"]
    }
  }
}
```

修改源码后，需要在客户端里重新连接 MCP 服务器才能生效（tsx 不会自动重载已经运行的进程）。

## 4. 系统权限

macOS 的权限是授予**启动 MCP 服务器的那个应用**的，而不是 node 本身：

| 使用方式 | 需要授权的应用 |
|----------|----------------|
| 在 Terminal 里运行 Claude Code | Terminal |
| 在 iTerm2 里运行 Claude Code | iTerm2 |
| Claude Desktop | Claude |
| VS Code 集成终端 | Visual Studio Code |

打开 **系统设置 → 隐私与安全性**：

1. **屏幕录制**：打开上表中对应的应用。
2. **辅助功能**：打开上表中对应的应用。
3. **自动化**：`open_application` 首次激活某个应用时，macOS 可能会询问是否允许控制该应用，点击允许。

授予屏幕录制和辅助功能权限后，需要**完全退出并重新打开**该应用才会生效。

## 5. 验证

```bash
node test-tools.mjs
```

脚本会启动服务器并列出 24 个工具。如果缺少权限，它会打印具体缺哪一项以及怎么修复。

然后在客户端里试一下：

```
申请控制 TextEdit，打开它并截一张图
```

模型会依次调用 `request_access`、`open_application`、`screenshot`。

真机的完整验证步骤见 [reports/TESTING.md](reports/TESTING.md#真机冒烟测试macos)。

## 故障排查

### 启动失败

服务器启动时会先做预检，失败时输出类似：

```
computer-use MCP server failed to start: Accessibility permission is not granted - cliclick cannot synthesize input.
How to fix: System Settings > Privacy & Security > Accessibility: enable the app hosting this MCP server (Terminal / Claude), then restart it.
```

| 报错 | 处理 |
|------|------|
| `Screen Recording permission is not granted` | 开启屏幕录制权限，然后重启宿主应用 |
| `Accessibility permission is not granted` | 开启辅助功能权限，然后重启宿主应用 |
| `cliclick is not installed or not runnable` | `brew install cliclick`，然后用 `which cliclick` 确认在 PATH 中 |
| `Could not determine display resolution` | 运行 `system_profiler SPDisplaysDataType`，确认输出中有 Resolution 行 |
| `Implausible scale factor` | 显示器几何无法推导。请提交 issue，并附上 `system_profiler SPDisplaysDataType` 的输出 |

Claude Desktop 的 MCP 日志位于 `~/Library/Logs/Claude/mcp-server-computer-use.log`。

### 客户端里看不到工具

1. 确认 `dist/index.js` 存在，没有的话运行 `npm run build`。
2. 确认配置里的路径是绝对路径，并且指向 `dist/index.js`。
3. Claude Code 中运行 `claude mcp list` 查看连接状态；Claude Desktop 需要完全退出后重新打开。

### 工具返回错误码

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `needs_access` | 本会话还没有调用 `request_access` | 先调用 `request_access` |
| `not_granted` | 前台应用不在白名单中，或无法确定前台应用 | 用 `request_access` 添加该应用，或把已授权的应用切到前台；如果一直无法确定前台应用（`lsappinfo` 不可用时会回退到 AppleScript），检查“自动化”中 System Events 的授权 |
| `denied_tier` | 只在设置了 `CU_STRICT_APP_TIERS=1` 时出现：该应用属于 click（终端 / IDE）或 read（浏览器）分级 | 去掉该环境变量即可放开，见 [README 的权限模型](README.md#权限模型) |
| `needs_flag` | 需要额外授权 | 重新调用 `request_access`，带上 `clipboardRead` / `clipboardWrite` / `systemKeyCombos` |

### 点击位置不准

- 坐标总是相对于**最近一次** `screenshot`。界面变化后请重新截图。
- 多显示器时，确认 `switch_display` 选中了目标应用所在的屏幕。
- 如果误差随着离左上角越远而越大，说明缩放比推导有问题，请提交 issue 并附上
  `system_profiler SPDisplaysDataType` 的输出和截图说明中的尺寸。

### 输入中文或多行文本

- 单行文本（包括中文）直接用 `type`。
- 多行文本需要 `clipboardWrite` 授权，会通过剪贴板粘贴，完成后恢复原剪贴板内容。

### 滚动报错

`Failed to compile the Swift scroll helper`：运行 `xcode-select --install`。
如果 macOS 升级后滚动失效，删除 `~/.cache/computer-use-mcp/cuscroll`，下次使用时会重新编译。

## 卸载

```bash
claude mcp remove computer-use           # 或从 Claude Desktop 配置中删除对应条目
rm -rf ~/.cache/computer-use-mcp         # Swift helper 缓存
rm -rf /path/to/cc-computer-use
```

最后在“隐私与安全性”中撤销相应应用的屏幕录制、辅助功能和自动化权限（可选）。
