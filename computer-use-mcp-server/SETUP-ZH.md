# Computer Use MCP Server - 配置指南

## 快速开始

### 1. 安装和编译

```bash
cd computer-use-mcp-server
npm install
npm run build
```

### 2. 选择配置方式

根据你的使用场景选择合适的配置方式：

---

## 配置方式 1：Local command (stdio) - 推荐本地使用

**最简单的方式，无需 HTTP 服务器**

### 在 Claude Code 中配置：

1. 打开 Claude Code
2. 点击左下角设置图标
3. 选择 "MCP Gateways"
4. 点击 "Add" 添加新配置
5. 填写以下信息：

| 字段 | 值 |
|------|-----|
| **Name** | `computer-use` |
| **Transport** | `Local command (stdio)` |
| **Command** | `node` |
| **Args** | 点击 "Add"，填入完整路径：<br>`/Users/elise123/Tools/Claude/computer-use-mcp-server/dist/index.js`<br>（替换为你的实际路径） |

6. 点击 "Sign in & test" 测试连接
7. 看到 ✅ 表示成功

### 或者使用配置文件：

在 `~/.claude/settings.json` 中添加：

```json
{
  "mcpGateways": {
    "computer-use": {
      "command": "node",
      "args": [
        "/Users/YOUR_USERNAME/Tools/Claude/computer-use-mcp-server/dist/index.js"
      ],
      "transport": "stdio"
    }
  }
}
```

---

## 配置方式 2：Streamable HTTP - 支持远程访问

**需要运行 HTTP 服务器，支持多客户端连接**

### 在 Claude Code 中配置：

1. 打开 Claude Code
2. 点击左下角设置图标
3. 选择 "MCP Gateways"
4. 点击 "Add" 添加新配置
5. 填写以下信息：

| 字段 | 值 |
|------|-----|
| **Name** | `computer-use` |
| **Transport** | `Streamable HTTP` |
| **Command** | `/Users/elise123/Tools/Claude/computer-use-mcp-server/start-gateway.sh`<br>（替换为你的实际路径） |
| **URL** | `http://localhost:3100/sse` |
| **OAuth** | `None` |

6. 点击 "Sign in & test" 测试连接
7. Claude Code 会自动启动服务器

### 或者使用配置文件：

在 `~/.claude/settings.json` 中添加：

```json
{
  "mcpGateways": {
    "computer-use": {
      "command": "/Users/YOUR_USERNAME/Tools/Claude/computer-use-mcp-server/start-gateway.sh",
      "transport": "streamable-http",
      "url": "http://localhost:3100/sse"
    }
  }
}
```

### 手动启动服务器（可选）：

```bash
./start-gateway.sh
# 或指定端口
PORT=3200 ./start-gateway.sh
```

---

## 配置方式 3：SSE (legacy) - 兼容旧版本

配置与方式 2 相同，只需将 **Transport** 改为 `SSE (legacy)`。

---

## 验证安装

配置完成后，在 Claude Code 中询问：

```
你有哪些工具可以用？
```

应该能看到以下工具：

- `computer_screenshot` - 截屏
- `computer_mouse_move` - 移动鼠标
- `computer_mouse_click` - 点击鼠标
- `computer_type_text` - 输入文本
- `computer_key_press` - 按键
- `computer_execute_command` - 执行命令

## 使用示例

```
帮我截个屏看看桌面
```

```
帮我打开浏览器并访问 github.com
```

```
帮我在文本编辑器中输入 Hello World
```

## 故障排查

### 问题：找不到 node 命令

确保 Node.js 已安装：
```bash
node --version  # 应该显示 v18 或更高版本
```

### 问题：找不到 dist/index.js

运行编译命令：
```bash
npm run build
```

### 问题：权限被拒绝

确保脚本有执行权限：
```bash
chmod +x start-gateway.sh
```

### 问题：端口已被占用

使用不同的端口：
```bash
PORT=3200 ./start-gateway.sh
```

并在配置中将 URL 改为 `http://localhost:3200/sse`

## 卸载

### 方式 1：从 Claude Code UI 中删除

1. 打开 Claude Code 设置
2. 进入 "MCP Gateways"
3. 找到 `computer-use` 配置
4. 点击删除按钮

### 方式 2：编辑配置文件

从 `~/.claude/settings.json` 中删除 `computer-use` 配置项。

---

## 对比表

| 特性 | stdio | Streamable HTTP | SSE (legacy) |
|------|-------|-----------------|--------------|
| 配置难度 | ⭐ 最简单 | ⭐⭐ 需要脚本 | ⭐⭐ 需要脚本 |
| 启动方式 | 自动启动 | 自动启动 | 自动启动 |
| 远程访问 | ❌ | ✅ | ✅ |
| 多客户端 | ❌ | ✅ | ✅ |
| 性能开销 | 最小 | 较小 | 较小 |
| 推荐场景 | 本地开发 | 远程访问 | 兼容旧版 |

**推荐**：个人本地使用选择 **stdio**，需要远程访问选择 **Streamable HTTP**。
