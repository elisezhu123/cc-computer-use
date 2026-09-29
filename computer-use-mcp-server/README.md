# Computer Use MCP Server

让 Claude Code 可以控制你的电脑 —— 截屏、移动鼠标、点击、输入文本、按键、执行命令。

基于 Anthropic 的 [Computer Use](https://docs.anthropic.com/en/docs/build-with-claude/computer-use) 功能，适配为 Claude Code 的 MCP Gateway。

## 快速开始

### 1. 安装依赖

```bash
npm install
npm run build
```

### 2. 配置 Claude Code

**推荐：Local command (stdio) 模式**（最简单）

在 Claude Code 设置中添加：
- **Name**: `computer-use`
- **Transport**: `Local command (stdio)`
- **Command**: `node`
- **Args**: `/你的路径/computer-use-mcp-server/dist/index.js`

详细配置指南：**[SETUP-ZH.md](SETUP-ZH.md)** ⭐

## 支持的工具

- 🖥️ `computer_screenshot` - 截屏
- 🖱️ `computer_mouse_move` - 移动鼠标
- 🖱️ `computer_mouse_click` - 点击鼠标
- ⌨️ `computer_type_text` - 输入文本
- ⌨️ `computer_key_press` - 按键（支持组合键）
- 💻 `computer_execute_command` - 执行 shell 命令

## 配置方式对比

| 模式 | 难度 | 特点 | 适用场景 |
|------|------|------|----------|
| **stdio** | ⭐ 最简单 | 无需 HTTP 服务器 | 本地开发（推荐） |
| **Streamable HTTP** | ⭐⭐ 需要脚本 | 支持远程访问 | 多客户端/远程 |
| **SSE (legacy)** | ⭐⭐ 需要脚本 | 兼容旧版本 | 仅用于兼容 |

## 使用示例

```
帮我截个屏看看桌面
```

```
打开浏览器并访问 github.com
```

```
在当前窗口输入 Hello World
```

```
按下 Command+Space 打开 Spotlight
```

## 文档

- **[SETUP-ZH.md](SETUP-ZH.md)** - 详细配置指南（中文）
- **[GATEWAY.md](GATEWAY.md)** - Gateway 模式技术文档
- **[gateway-config.example.json](gateway-config.example.json)** - 配置文件示例

## 架构

```
Claude Code
    ↓
MCP Gateway (stdio / HTTP)
    ↓
Computer Use MCP Server
    ↓
系统 API (鼠标/键盘/截屏/Shell)
```

## 技术栈

- **Node.js** - 运行环境
- **TypeScript** - 开发语言
- **@modelcontextprotocol/sdk** - MCP 协议实现
- **robotjs** - 鼠标/键盘控制
- **screenshot-desktop** - 截屏
- **sharp** - 图片处理
- **Express** - HTTP 服务器（Gateway 模式）

## 安全提示

⚠️ **此工具可以完全控制你的电脑**

- Claude 在执行操作前会请求你的确认
- 建议在测试环境中先试用
- 不要在重要工作进行时让 Claude 控制电脑
- 敏感操作建议手动执行

## 开发

```bash
# 安装依赖
npm install

# 开发模式（TypeScript 直接运行）
npm run dev

# 编译
npm run build

# 测试 stdio 模式
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/index.js

# 测试 HTTP 模式
./start-gateway.sh
curl http://localhost:3100/sse
```

## 故障排查

查看 [SETUP-ZH.md](SETUP-ZH.md) 的"故障排查"章节。

## License

MIT

## 致谢

基于 Anthropic 的 Computer Use 功能实现。
