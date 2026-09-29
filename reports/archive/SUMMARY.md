# Computer Use MCP Server

✅ **完成！已成功创建一个功能完整的 Computer Use MCP Server**

## 📦 已实现功能

### 核心功能
- ✅ 屏幕截图（支持调整大小）
- ✅ 鼠标控制（移动、点击、双击）
- ✅ 键盘控制（输入文本、按键组合）
- ✅ 屏幕信息获取
- ✅ 鼠标位置获取
- ✅ AppleScript 执行

### 8 个 MCP 工具
1. `computer_screenshot` - 截屏
2. `computer_get_screen_info` - 获取屏幕信息
3. `computer_mouse_move` - 移动鼠标
4. `computer_mouse_click` - 点击鼠标
5. `computer_type_text` - 输入文本
6. `computer_press_key` - 按键（支持组合键）
7. `computer_get_mouse_position` - 获取鼠标位置
8. `computer_run_applescript` - 执行 AppleScript

## 🚀 快速开始

### 1. 已完成的设置
```bash
✅ 依赖已安装（@modelcontextprotocol/sdk, zod, sharp）
✅ cliclick 已安装（通过 Homebrew）
✅ TypeScript 编译成功
✅ 服务器测试通过
```

### 2. 配置 Claude Desktop

编辑 `~/.claude/settings.json`，添加：

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "node",
      "args": [
        "$HOME/Tools/Claude/computer-use-mcp-server/dist/index.js"
      ]
    }
  }
}
```

### 3. 重启 Claude Desktop

### 4. 测试命令
```
取个屏幕截图保存到 /tmp/test.png
移动鼠标到 (500, 300) 并点击
输入文本 "Hello World"
按 Command+S 保存
```

## 📁 项目结构

```
computer-use-mcp-server/
├── src/
│   ├── index.ts       # 主服务器（8个工具定义）
│   ├── types.ts       # TypeScript 类型定义
│   └── utils.ts       # 工具函数（AppleScript、cliclick封装）
├── dist/              # 编译后的 JavaScript
├── package.json       # 项目配置
├── tsconfig.json      # TypeScript 配置
├── setup.sh           # 一键安装脚本
├── test.js            # 测试脚本
├── README.md          # 完整文档
├── CONFIGURATION.md   # 配置指南
└── computer-use.skill.md  # Skill 文档（可选）
```

## 🔧 技术实现

### 基础技术栈
- **语言**: TypeScript
- **框架**: MCP SDK v1.6.1
- **传输**: stdio（本地通信）
- **平台**: macOS only

### 依赖工具
- `screencapture` - macOS 内置截图
- `cliclick` - 鼠标/键盘控制（已安装）
- `osascript` - AppleScript 执行（内置）
- `sharp` - 图片处理（调整大小）

## 🎯 设计特点

1. **与 ios-simulator-mcp-server 风格一致**
   - 相同的项目结构
   - 相同的错误处理模式
   - 相同的工具注册方式

2. **类型安全**
   - 完整的 TypeScript 类型定义
   - Zod schema 验证

3. **用户友好**
   - 清晰的工具描述
   - 详细的参数说明
   - Emoji 提示符

4. **安全性**
   - `destructiveHint` 标记危险操作
   - 需要系统辅助功能权限
   - 操作日志记录

## 📝 使用示例

### 截屏
```typescript
computer_screenshot({
  output_path: "/tmp/screen.png",
  width: 800,  // 可选：调整大小
  height: 600
})
```

### 鼠标操作
```typescript
// 移动
computer_mouse_move({ x: 500, y: 300 })

// 点击
computer_mouse_click({ 
  x: 500, 
  y: 300, 
  button: "left",
  double: false 
})
```

### 键盘操作
```typescript
// 输入文本
computer_type_text({ text: "Hello World" })

// 按键组合（Command+S）
computer_press_key({ 
  key: "s", 
  modifiers: ["command"] 
})
```

### AppleScript
```typescript
computer_run_applescript({
  script: 'tell application "Safari" to activate'
})
```

## 🔐 权限配置

运行前需要授予辅助功能权限：

1. **系统设置** → **隐私与安全性** → **辅助功能**
2. 添加 **Claude.app**
3. 重启 Claude Desktop

## 🐛 故障排除

### cliclick not found
```bash
brew install cliclick
```

### 权限被拒绝
在系统设置中授予辅助功能权限

### 截图为空白
某些系统对话框无法被截取（macOS 安全特性）

## 🎉 总结

你现在拥有了一个**功能完整的 Computer Use MCP Server**，它：

- ✅ 基于你现有的 `ios-simulator-mcp-server` 代码风格
- ✅ 遵循 MCP 最佳实践
- ✅ 提供 8 个强大的自动化工具
- ✅ 可以直接在 Claude Desktop 中使用
- ✅ 包含完整的文档和测试

这是一个 **MCP Server**，不是 skill、plugin 或 extension。MCP 是 Claude Code 推荐的扩展方式，因为它：
- 原生集成
- 类型安全
- 易于调试
- 性能更好

现在只需将配置添加到 `~/.claude/settings.json` 并重启 Claude Desktop，就可以开始使用了！
