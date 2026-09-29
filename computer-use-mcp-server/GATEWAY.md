# HTTP Gateway 模式

默认情况下，服务器通过 **stdio** 与 Claude Code 通信（`dist/index.js`），这也是推荐方式。
如果客户端只能通过 HTTP 接入 MCP，可以改用 Gateway 模式（`dist/http-server.js`）。

两种模式共用 `src/server.ts` 里的同一套实现：工具列表、应用白名单、前台应用检查、
系统快捷键黑名单、坐标映射都完全一致，**只有传输层不同**。

## 启动

```bash
npm install
npm run build
./computer-use-mcp-server/start-gateway.sh      # 或：npm run start:gateway
```

启动后的端点：

| 端点 | 传输方式 | 说明 |
|------|----------|------|
| `http://127.0.0.1:3100/mcp` | Streamable HTTP | 当前 MCP 标准传输，推荐 |
| `http://127.0.0.1:3100/sse` | SSE (legacy) | 旧版传输，消息 POST 到 `/messages?sessionId=…` |
| `http://127.0.0.1:3100/health` | — | 健康检查，返回当前会话数 |

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3100` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |

## 在 Claude Code 中配置

打开 Claude Code 设置 → MCP Gateways → Add：

| 字段 | Streamable HTTP | SSE (legacy) |
|------|-----------------|--------------|
| Name | `computer-use` | `computer-use` |
| Transport | `Streamable HTTP` | `SSE (legacy)` |
| Command | `/path/to/cc-computer-use/computer-use-mcp-server/start-gateway.sh` | 同左 |
| URL | `http://127.0.0.1:3100/mcp` | `http://127.0.0.1:3100/sse` |

点击 "Sign in & test" 验证连接。完整示例见 [`gateway-config.example.json`](gateway-config.example.json)。

如果只是本机使用，直接选 **Local command (stdio)**，Command 填 `node`，Args 填
`/path/to/cc-computer-use/dist/index.js` 即可，无需启动 HTTP 服务。

## 会话隔离

每个 HTTP 客户端会话都有独立的 MCP Server 实例和会话状态：
一个客户端通过 `request_access` 获得的应用授权、剪贴板授权和截图坐标基准，
不会被另一个客户端继承。显示器几何信息和已安装应用列表在启动时测量一次，所有会话共享。

## 安全须知

- **默认只监听 `127.0.0.1`**，并启用 MCP SDK 的 DNS rebinding 防护（`Host` 头不是本机地址的请求会被拒绝，返回 403）。
- **Gateway 没有身份认证。** 任何能访问该端口的程序都可以控制这台 Mac 的鼠标和键盘。
  不要把 `HOST` 设为 `0.0.0.0` 或公网地址；确实需要远程访问时，请在前面加一层带认证的反向代理或 SSH 隧道。
- 所有输入操作仍然受 `request_access` 白名单、前台应用检查和系统快捷键黑名单约束，与 stdio 模式相同。

## 故障排查

| 现象 | 排查 |
|------|------|
| 连接失败 | `curl http://127.0.0.1:3100/health`；`lsof -i :3100` 检查端口占用 |
| 启动即退出，提示 preflight | 缺少“屏幕录制”或“辅助功能”权限，或未安装 `cliclick`（`brew install cliclick`），按提示修复后重启 |
| 返回 403 | 请求的 `Host` 不是 `127.0.0.1` / `localhost`，请用本机地址访问 |
| 返回 400 “Unknown or missing session” | 客户端需先发送 `initialize`；Streamable HTTP 的 URL 必须是 `/mcp`，不是 `/sse` |

## 开发

```bash
npm run dev:gateway    # tsx 直接运行 src/http-server.ts，无需编译
```

## 与旧版 Gateway 的区别

旧版 `http-server.ts` / `utils.ts` 是 v1 时代的独立实现，已被本版本取代。旧版的问题包括：

- 工具集与 v3 不同（`computer_screenshot`、`computer_run_applescript` 等），并且绕过了全部权限策略；
- 监听所有网卡且无认证，可通过 `computer_run_applescript` 远程执行任意代码；
- 通过 shell 字符串拼接调用 `cliclick` / `osascript`，存在命令注入；
- `/message` 端点没有把消息转交给传输层，工具调用实际上无法送达。
