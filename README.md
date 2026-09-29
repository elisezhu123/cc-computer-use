# Enhanced Computer Use MCP Server

<div align="center">

**🎯 Claude Code 的 Computer Use 功能 - 独立 MCP 实现**

基于 CC-Source 最佳实践 + 独立架构 + 新增功能

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.6.1-orange.svg)](https://modelcontextprotocol.io/)
[![macOS](https://img.shields.io/badge/macOS-only-lightgrey.svg)](https://www.apple.com/macos/)

</div>

---

## ✨ 特性亮点

### 🎯 核心算法 100% 对齐 CC-Source

- ✅ **动画移动** - ease-out-cubic, 60fps, 2000px/s
- ✅ **Move-and-Settle** - 点击前 50ms 稳定时间
- ✅ **剪贴板输入** - 保存/验证/恢复流程
- ✅ **按键时序** - 8ms 间隔，125Hz USB polling

### 🆕 新增实用工具

- ✅ **computer_drag** - 动画拖拽（窗口/滚动条/选择）
- ✅ **computer_scroll** - 精确滚动控制

### 🚀 独立架构优势

- ✅ 标准 MCP 协议，任何 MCP 客户端可用
- ✅ 零内部依赖，仅使用 cliclick + macOS 工具
- ✅ 易于扩展，清晰的代码结构
- ✅ 完整文档，开箱即用

---

## 🚀 快速开始

### 1. 安装依赖

```bash
# 安装 cliclick
brew install cliclick

# 安装 Node.js 依赖
npm install

# 编译
npm run build
```

### 2. 配置 Claude Desktop

编辑 `~/.claude/settings.json`：

```json
{
  "mcpServers": {
    "computer-use-enhanced": {
      "command": "node",
      "args": [
        "/Users/你的用户名/path/to/computer-use-mcp-server/dist/index-enhanced.js"
      ]
    }
  }
}
```

### 3. 授予权限

**系统设置 → 隐私与安全性 → 辅助功能**
- 添加 `Claude.app`

### 4. 重启 Claude Desktop

### 5. 测试

在 Claude Desktop 中：
```
请截图保存到 /tmp/test.png
```

---

## 🛠️ 可用工具

| 工具 | 功能 | 特性 |
|-----|------|------|
| **computer_screenshot** | 截屏 | 支持调整大小 |
| **computer_get_screen_info** | 屏幕信息 | 分辨率、缩放比例 |
| **computer_mouse_move** | 移动鼠标 | **+ animated 选项** |
| **computer_mouse_click** | 点击 | **+ modifiers 支持** |
| **computer_type_text** | 输入文本 | **+ via_clipboard 选项** |
| **computer_press_key** | 按键 | **+ "cmd+c" 语法** |
| **computer_get_mouse_position** | 鼠标位置 | 实时坐标 |
| **computer_run_applescript** | AppleScript | 高级控制 |
| **computer_drag** 🆕 | 拖拽 | 窗口/滚动条/选择 |
| **computer_scroll** 🆕 | 滚动 | dx/dy 精确控制 |

---

## 💡 使用示例

### 动画移动
```json
{
  "tool": "computer_mouse_move",
  "arguments": {
    "x": 500,
    "y": 300,
    "animated": true
  }
}
```

### 剪贴板输入（推荐：长文本/中文）
```json
{
  "tool": "computer_type_text",
  "arguments": {
    "text": "这是一段很长的中文文本 🎉",
    "via_clipboard": true
  }
}
```

### 快捷键（新语法）
```json
{
  "tool": "computer_press_key",
  "arguments": {
    "key": "cmd+c"
  }
}
```

### 拖拽窗口
```json
{
  "tool": "computer_drag",
  "arguments": {
    "from_x": 100,
    "from_y": 50,
    "to_x": 500,
    "to_y": 300,
    "animated": true
  }
}
```

### 滚动页面
```json
{
  "tool": "computer_scroll",
  "arguments": {
    "x": 700,
    "y": 400,
    "dy": 5,
    "dx": 0
  }
}
```

更多示例请查看 [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)

---

## 📊 与 CC-Source 对比

| 特性 | CC-Source | Enhanced MCP |
|-----|-----------|--------------|
| 动画移动 | ✅ | ✅ 算法一致 |
| Move-and-Settle | ✅ | ✅ 常量一致 |
| 剪贴板输入 | ✅ | ✅ 流程一致 |
| 按键时序 | ✅ | ✅ 间隔一致 |
| 拖拽 | ❌ | ✅ **新增** |
| 滚动 | ❌ | ✅ **新增** |
| 独立部署 | ❌ | ✅ **优势** |

详细对比请查看 [COMPARISON.md](COMPARISON.md)

---

## 📖 文档

- **[README-ENHANCED.md](README-ENHANCED.md)** ⭐⭐⭐ - 详细功能介绍
- **[INSTALL.md](INSTALL.md)** ⭐⭐ - 完整安装指南 + 故障排查
- **[USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)** ⭐⭐ - 30+ 使用示例
- **[COMPARISON.md](COMPARISON.md)** ⭐ - 技术深度对比
- **[FINAL-HANDOFF.md](FINAL-HANDOFF.md)** - 项目交接文档

---

## 🔧 开发

### 编译
```bash
npm run build
```

### 清理
```bash
npm run clean
```

### 开发模式
```bash
npm run dev
```

---

## 🎓 技术细节

### 动画算法
```typescript
const distance = Math.hypot(deltaX, deltaY);
const durationSec = Math.min(distance / 2000, 0.5);
const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
```

### Move-and-Settle
```typescript
await moveMouse(x, y);
await sleep(50); // MOVE_SETTLE_MS
```

### 剪贴板流程
```
pbpaste → save → pbcopy ← text → pbpaste → verify → Cmd+V → sleep(100ms) → pbcopy ← restore
```

---

## ⚠️ 限制

- 仅支持 macOS（需要 cliclick）
- 需要辅助功能权限
- 依赖外部命令（性能有限）

---

## 🚀 未来扩展

- [ ] 窗口管理工具
- [ ] 应用控制工具
- [ ] OCR 集成
- [ ] Computer Vision
- [ ] Linux/Windows 支持

---

## 📄 许可

MIT

---

## 🙏 致谢

- Claude Code 的 computer-use 实现
- CC-Source/src/utils/computerUse/executor.ts
- Anthropic 的计算机使用最佳实践

---

<div align="center">

**现在开始使用你的 Enhanced Computer Use MCP Server！** 🎉

[安装指南](INSTALL.md) • [使用示例](USAGE-EXAMPLES.md) • [技术对比](COMPARISON.md)

</div>
