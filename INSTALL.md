# 安装指南 (Installation Guide)

## 前置要求 (Prerequisites)

### 1. 系统要求
- macOS (已测试)
- Node.js >= 18
- Claude Desktop App

### 2. 安装 cliclick
```bash
brew install cliclick
```

验证安装：
```bash
cliclick -V
# 应该输出版本号，例如：cliclick 5.0
```

### 3. 系统权限设置

**系统设置 → 隐私与安全性 → 辅助功能**

添加以下应用：
- ✅ Claude.app
- ✅ Terminal.app (如果从终端测试)

---

## 快速安装 (Quick Install)

### 步骤1: 克隆/下载项目

如果你已有项目文件：
```bash
cd /Users/elise123/Tools/Claude/computer-use-mcp-server
```

或者创建新项目：
```bash
mkdir -p ~/computer-use-mcp-server
cd ~/computer-use-mcp-server
# 复制所有 src/ 文件到这里
```

### 步骤2: 安装依赖
```bash
npm install
```

### 步骤3: 编译
```bash
npm run build
```

你应该看到 `dist/` 目录被创建，包含：
- index.js
- index-enhanced.js ⭐
- utils.js
- utils-enhanced.js ⭐
- types.js

### 步骤4: 配置 Claude Desktop

编辑配置文件：
```bash
code ~/.claude/settings.json
# 或
nano ~/.claude/settings.json
```

添加 MCP 服务器配置：
```json
{
  "mcpServers": {
    "computer-use-enhanced": {
      "command": "node",
      "args": [
        "/Users/elise123/Tools/Claude/computer-use-mcp-server/dist/index-enhanced.js"
      ]
    }
  }
}
```

**⚠️ 注意：** 替换路径为你的实际安装路径！

### 步骤5: 重启 Claude Desktop

完全退出并重新打开 Claude Desktop App。

### 步骤6: 验证安装

在 Claude Desktop 中询问：
```
请列出所有 computer_ 开头的工具
```

你应该看到10个工具：
1. computer_screenshot
2. computer_get_screen_info
3. computer_mouse_move
4. computer_mouse_click
5. computer_type_text
6. computer_press_key
7. computer_get_mouse_position
8. computer_run_applescript
9. computer_drag ⭐
10. computer_scroll ⭐

---

## 测试安装 (Test Installation)

### 测试1: 截图
```
请截图保存到 /tmp/test.png
```

### 测试2: 获取屏幕信息
```
请获取屏幕分辨率
```

### 测试3: 移动鼠标
```
请把鼠标移动到屏幕中央（使用动画）
```

### 测试4: 输入文本
```
请在当前位置输入"Hello World"（使用剪贴板）
```

### 测试5: 按键
```
请按下 Command+C 组合键
```

---

## 故障排查 (Troubleshooting)

### 问题1: 工具未显示

**症状：** Claude 说"没有 computer_xxx 工具"

**解决方案：**
1. 检查配置文件路径是否正确
   ```bash
   cat ~/.claude/settings.json
   ```

2. 检查编译输出是否存在
   ```bash
   ls -la ~/computer-use-mcp-server/dist/index-enhanced.js
   ```

3. 完全退出 Claude Desktop（右键 Dock 图标 → 退出）

4. 重新打开 Claude Desktop

### 问题2: cliclick 命令未找到

**症状：** 错误信息包含 "cliclick: command not found"

**解决方案：**
```bash
# 安装 cliclick
brew install cliclick

# 验证安装
which cliclick
# 应输出：/opt/homebrew/bin/cliclick 或类似路径
```

### 问题3: 权限被拒绝

**症状：** 错误信息包含 "accessibility permission"

**解决方案：**
1. 打开 **系统设置**
2. 进入 **隐私与安全性**
3. 点击 **辅助功能**
4. 点击左下角 🔒 解锁
5. 点击 ➕ 添加 Claude.app
6. 重启 Claude Desktop

### 问题4: 点击不准确

**症状：** 鼠标点击的位置不对

**可能原因：**
1. 多显示器设置
2. 分辨率不匹配
3. 缩放设置

**解决方案：**
```
请先获取屏幕信息，然后使用 animated: true 选项移动鼠标
```

### 问题5: 输入中文乱码

**症状：** 输入中文时出现乱码

**解决方案：**
```
请使用 via_clipboard: true 选项输入文本
```

这样会通过剪贴板输入，支持所有 Unicode 字符。

### 问题6: Node 版本过低

**症状：** 错误信息 "Unsupported Node.js version"

**解决方案：**
```bash
# 检查 Node 版本
node -v
# 需要 >= 18

# 使用 nvm 升级
nvm install 18
nvm use 18

# 或使用 brew
brew upgrade node
```

---

## 高级配置 (Advanced Configuration)

### 同时使用原版和增强版

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "node",
      "args": [
        "/path/to/computer-use-mcp-server/dist/index.js"
      ]
    },
    "computer-use-enhanced": {
      "command": "node",
      "args": [
        "/path/to/computer-use-mcp-server/dist/index-enhanced.js"
      ]
    }
  }
}
```

### 启用调试日志

修改 `src/index-enhanced.ts`：
```typescript
// 在文件顶部添加
const DEBUG = true;

// 在需要的地方添加
if (DEBUG) console.error('[computer-use]', 'Debug info...');
```

重新编译：
```bash
npm run build
```

查看日志：
```bash
# Claude Desktop 日志位置
tail -f ~/Library/Logs/Claude/mcp-server-computer-use-enhanced.log
```

### 自定义常量

编辑 `src/utils-enhanced.ts`：
```typescript
// 修改这些常量
const MOVE_SETTLE_MS = 50;           // 点击前等待时间
const CLIPBOARD_PASTE_DELAY_MS = 100; // 粘贴后等待时间
```

重新编译生效。

---

## 卸载 (Uninstall)

### 1. 从 Claude Desktop 移除

编辑 `~/.claude/settings.json`，删除：
```json
{
  "mcpServers": {
    // 删除这一段
    "computer-use-enhanced": { ... }
  }
}
```

### 2. 删除项目文件

```bash
rm -rf ~/computer-use-mcp-server
```

### 3. 重启 Claude Desktop

---

## 升级 (Upgrade)

### 从原版升级到增强版

1. **保留原版配置** (可选)
2. **添加增强版配置**
3. **重启 Claude Desktop**
4. **测试新功能**

### 更新到最新版本

```bash
cd ~/computer-use-mcp-server

# 备份当前版本
cp -r src src.backup

# 更新文件
# (复制新的 src/index-enhanced.ts 和 src/utils-enhanced.ts)

# 重新编译
npm run build

# 重启 Claude Desktop
```

---

## 开发模式 (Development Mode)

### 实时编译

```bash
# 终端1: 监听文件变化
npm run build -- --watch
```

### 直接运行（测试）

```bash
# 不启动 MCP 服务器，而是测试某个函数
npm run dev
```

编辑 `src/index-enhanced.ts` 添加测试代码：
```typescript
// 在文件末尾添加
if (process.env.NODE_ENV === 'development') {
  (async () => {
    const screenInfo = await getScreenInfo();
    console.log('Screen:', screenInfo);
    
    await moveMouseAndSettle(500, 300);
    console.log('Moved to (500, 300)');
  })();
}
```

---

## 常见问题 (FAQ)

### Q: 支持 Windows/Linux 吗？

A: 目前仅支持 macOS。Windows/Linux 需要：
- 替换 `screencapture` → 其他截图工具
- 替换 `cliclick` → `xdotool` (Linux) 或 `AutoHotkey` (Windows)
- 替换 `pbcopy/pbpaste` → 其他剪贴板工具

### Q: 可以在其他 MCP 客户端使用吗？

A: 可以！只要客户端支持 MCP 协议，就能使用这个服务器。

### Q: 性能如何？

A: 
- 截图：~200ms
- 鼠标移动：即时 (动画: 50-500ms)
- 点击：即时
- 输入：即时 (剪贴板: ~100ms)

### Q: 安全吗？

A: 
- ✅ 本地运行，无网络请求
- ✅ 需要系统权限确认
- ✅ 开源代码，可审计
- ⚠️ 授予辅助功能权限意味着可以控制整个系统

### Q: 可以用于自动化测试吗？

A: 可以！这就是设计目的之一。但建议：
- 对生产环境使用专门的测试工具
- 这个工具更适合 LLM 驱动的交互式操作

---

## 获取帮助 (Get Help)

### 文档
- [README-ENHANCED.md](README-ENHANCED.md) - 功能介绍
- [COMPARISON.md](COMPARISON.md) - 对比 CC-Source
- [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md) - 使用示例

### 示例代码
查看 `USAGE-EXAMPLES.md` 中的完整示例。

### 调试
1. 检查 Claude Desktop 日志
2. 使用 `console.error()` 输出调试信息
3. 测试单个工具功能

---

**祝安装顺利！** 🎉

如有问题，请先查看故障排查部分。
