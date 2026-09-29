# computer-use-mcp-server/

这个目录存放 **HTTP Gateway 模式**的启动脚本和配置示例。服务器代码在项目根目录的 `src/` 下。

| 文件 | 说明 |
|------|------|
| [`GATEWAY.md`](GATEWAY.md) | Gateway 模式说明：端点、配置、会话隔离、安全须知 |
| [`start-gateway.sh`](start-gateway.sh) | 启动 `dist/http-server.js`（必要时先构建），默认端口 3100，只监听 127.0.0.1 |
| [`gateway-config.example.json`](gateway-config.example.json) | stdio / Streamable HTTP / SSE 三种配置示例 |

大多数情况下不需要 Gateway：本机使用时直接用 stdio 模式，见根目录的 [README](../README.md) 和 [INSTALL](../INSTALL.md)。
