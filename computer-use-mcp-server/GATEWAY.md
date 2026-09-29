# Computer Use MCP Server - Gateway Mode

此 MCP 服务器现在支持 **Gateway 模式**，可以通过 HTTP/SSE 与 Claude Code 集成。

## 配置方式

Claude Code Gateway 支持多种传输模式，选择最适合你的：

### 方式 1：Streamable HTTP（推荐）

**最新的标准方式，推荐使用**

#### 步骤：

1. **安装依赖和编译**
   ```bash
   npm install
   npm run build
   ```

2. **在 Claude Code 设置中添加 Gateway**
   - 打开 Claude Code 设置 → MCP Gateways
   - 点击 "Add" 添加新配置
   - 填写以下信息：
     - **Name**: `computer-use`
     - **Transport**: `Streamable HTTP`
     - **Command**: `/Users/elise123/Tools/Claude/computer-use-mcp-server/start-gateway.sh`
       - 或者使用你的实际路径：`$(pwd)/start-gateway.sh`
     - **URL**: `http://localhost:3100/sse`
   - 点击 "Sign in & test" 测试连接

3. **Claude Code 会自动启动服务器**
   - 当你使用工具时，Claude Code 会自动运行 `start-gateway.sh`
   - 无需手动启动服务器

### 方式 2：SSE (legacy)

兼容旧版本的 SSE 传输方式。

配置与方式 1 相同，只需将 **Transport** 改为 `SSE (legacy)`。

### 方式 3：Local command (stdio)

**最简单的方式 - 直接启动进程，无需 HTTP 服务器**

#### 步骤：

1. **安装依赖和编译**
   ```bash
   npm install
   npm run build
   ```

2. **在 Claude Code 设置中添加 Gateway**
   - 打开 Claude Code 设置 → MCP Gateways
   - 点击 "Add" 添加新配置
   - 填写以下信息：
     - **Name**: `computer-use`
     - **Transport**: `Local command (stdio)`
     - **Command**: `node`
     - **Args**: 
       ```json
       ["/Users/elise123/Tools/Claude/computer-use-mcp-server/dist/index.js"]
       ```
       或使用完整路径：`["$(pwd)/dist/index.js"]`
   - 点击 "Sign in & test" 测试连接

3. **Claude Code 会直接运行 MCP 服务器**
   - 使用标准输入输出（stdio）通信
   - 不需要 HTTP 服务器
   - 最轻量的方式

### 配置文件参考

查看 `gateway-config.example.json` 获取完整配置示例（包含所有三种模式）

## 如何选择传输模式？

| 模式 | 优点 | 缺点 | 推荐场景 |
|------|------|------|----------|
| **Local command (stdio)** | 最简单，无需 HTTP 服务器，开销最小 | 仅限本地使用 | 个人本地开发，推荐首选 |
| **Streamable HTTP** | 现代标准，可远程访问，支持多客户端 | 需要运行 HTTP 服务器 | 需要远程访问或多客户端共享 |
| **SSE (legacy)** | 兼容旧版本 | 即将废弃 | 仅用于兼容旧版本 |

**推荐顺序**：
1. **本地使用**：优先选择 `Local command (stdio)`
2. **远程访问**：选择 `Streamable HTTP`
3. **兼容需求**：才考虑 `SSE (legacy)`

启动后，Claude Code 应该能看到以下工具：

- `computer_get_screen_info` - 获取屏幕分辨率和缩放信息
- `computer_screenshot` - 截屏
- `computer_mouse_move` - 移动鼠标
- `computer_mouse_click` - 点击鼠标
- `computer_type_text` - 输入文本
- `computer_press_key` - 按键盘按键
- `computer_get_mouse_position` - 获取鼠标位置
- `computer_run_applescript` - 运行 AppleScript

## 依赖项

确保已安装 `cliclick`（用于鼠标和键盘控制）：

```bash
brew install cliclick
```

## 权限要求

首次运行时，macOS 会请求以下权限：

- **屏幕录制** - 用于截屏功能
- **辅助功能访问** - 用于鼠标和键盘控制

## 端口配置

默认端口是 `3100`。如果需要更改：

```bash
PORT=3200 ./start-gateway.sh
```

记得同时更新 Claude Code Gateway 配置中的 URL。

## 健康检查

访问 `http://localhost:3100/health` 查看服务器状态：

```bash
curl http://localhost:3100/health
```

响应示例：
```json
{
  "status": "ok",
  "server": "computer-use-mcp-server"
}
```

## 故障排查

### 连接失败

1. 确认服务器正在运行：`curl http://localhost:3100/health`
2. 检查端口是否被占用：`lsof -i :3100`
3. 查看服务器日志输出

### 工具无法执行

1. 确认已安装 `cliclick`：`which cliclick`
2. 检查 macOS 权限设置（系统偏好设置 → 隐私与安全性）
3. 重启服务器

### Gateway 配置不生效

1. 在 Claude Code 中点击 "Sign in & test" 验证连接
2. 确认 URL 格式正确：`http://localhost:3100/sse`（注意是 `/sse` 端点）
3. 重启 Claude Code

## 开发模式

使用 `tsx` 直接运行（无需编译）：

```bash
npx tsx src/http-server.ts
```

## 标准 MCP 模式

如果你想使用标准的 stdio MCP 模式（而非 Gateway），请参考原 README.md。

## 架构说明

- `src/index.ts` - 标准 stdio MCP 服务器
- `src/http-server.ts` - Gateway HTTP/SSE 服务器
- `src/tools.ts` - 工具定义
- `src/utils.ts` - 共享工具函数

两种模式使用相同的工具实现，只是传输层不同。
