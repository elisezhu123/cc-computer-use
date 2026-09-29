# iOS Simulator Panel 侧边栏问题排查

## 当前状态

✅ **所有工具功能正常：**
- simulator_list ✅
- simulator_boot ✅
- simulator_open_panel ✅ (工具调用成功)
- simulator_screenshot ✅
- simulator_home ✅
- simulator_rotate ✅
- simulator_shutdown ✅

❓ **侧边栏未显示**

## 问题分析

### 1. Extension 配置正确
- ✅ manifest.json 配置完整
- ✅ UI 文件存在 (dist/ui/index.html)
- ✅ 工具已注册
- ✅ `_meta` 字段正确返回

### 2. 可能的原因

**A. 需要重启 Claude Desktop**
Desktop Extension 的 UI 面板可能需要应用完全重启才能加载。我们修改了代码并重新编译，但 Claude Desktop 进程可能还在使用旧版本。

**B. Extension 注册问题**
Extension 位于：
```
~/.claude-projects-3p/Claude Extensions/local.mcpb.ios-simulator-panel-contributors.ios-simulator-panel/
```

这个路径是 Claude Desktop 扫描 extensions 的标准位置。

**C. UI 资源加载问题**
代码中使用了：
```typescript
_meta: {
  "ui/resourceUri": "ui://simulator-panel/index.html"
}
```

UI 通过 CDN 加载 MCP App Bridge：
```javascript
import { createAppBridge } from 'https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@1.1.2/+esm';
```

### 3. 工具返回的数据

当调用 `simulator_open_panel` 时，返回：
```json
{
  "content": [{
    "type": "text",
    "text": "Simulator panel opened for B1F23680-CED0-4008-9C44-3B1C12FB5AD8"
  }],
  "_meta": {
    "screenshot": "<base64 image data>",
    "udid": "B1F23680-CED0-4008-9C44-3B1C12FB5AD8"
  }
}
```

这个返回是正确的，包含了 `_meta` 数据。

## 解决方案

### 方案 1：重启 Claude Desktop（推荐）

1. 完全退出 Claude Desktop（Cmd+Q）
2. 重新启动应用
3. 再次调用 `simulator_open_panel`

重启会：
- 重新加载所有 Desktop Extensions
- 重新扫描 `.claude-projects-3p/Claude Extensions/` 目录
- 加载最新编译的代码

### 方案 2：检查 Extension 是否被识别

查看 Claude Desktop 的日志：
```bash
# macOS 日志位置
tail -f ~/Library/Logs/Claude/main.log
```

查找关于 extension 加载的信息。

### 方案 3：手动验证 UI 文件

在浏览器中测试 UI：
```bash
cd "$HOME/.claude-projects-3p/Claude Extensions/local.mcpb.ios-simulator-panel-contributors.ios-simulator-panel/dist/ui"
python3 -m http.server 8000
# 打开 http://localhost:8000
```

虽然 MCP App Bridge 不会工作，但可以验证 HTML/CSS 是否正确。

### 方案 4：检查权限

确保 Claude Desktop 可以读取 extension 目录：
```bash
ls -la "$HOME/.claude-projects-3p/Claude Extensions/local.mcpb.ios-simulator-panel-contributors.ios-simulator-panel/"
```

## 与 Claude Code Browser 面板的对比

Claude Code 的 Browser 面板是**内置功能**，不是 Desktop Extension。它使用不同的机制：
- 内置于应用程序
- 使用专用的 preview_start 工具
- 直接集成到 UI 架构中

Desktop Extension 的面板是**第三方扩展**：
- 通过 manifest.json 注册
- 使用 MCP SDK 的 `_meta` 字段
- 需要应用重启才能加载

## 测试步骤

1. **退出 Claude Desktop**
   ```
   Cmd+Q 或 菜单 → Quit
   ```

2. **确认进程已关闭**
   ```bash
   ps aux | grep -i claude | grep -v grep
   ```

3. **重新启动 Claude Desktop**

4. **等待完全加载**（约 5-10 秒）

5. **重新测试**
   ```
   1. simulator_boot
   2. simulator_open_panel
   3. 检查右侧是否出现面板
   ```

## 预期结果

重启后，当调用 `simulator_open_panel` 时，应该在 Claude Desktop 右侧看到：

- **面板标题**: "iOS Simulator"
- **模拟器屏幕**: 实时预览
- **控制按钮**: Home, Screenshot, Rotate Left, Rotate Right, Refresh, Shutdown
- **自动刷新**: 每 2 秒更新一次截图

## 备选方案

如果重启后仍然无法显示面板，可能的原因：

1. **Claude Desktop 版本不支持** - Desktop Extension 是较新的功能
2. **MCP App Bridge 加载失败** - CDN 网络问题
3. **Extension manifest 版本不兼容** - manifest_version "0.2" 可能需要更新

此时可以：
- 使用纯 MCP 工具调用（不依赖 UI 面板）
- 所有功能仍然可用，只是没有可视化界面
- 继续使用 screenshot 工具查看模拟器状态

## 当前工作状态

即使没有侧边栏面板，所有核心功能都已修复并可用：

✅ 启动/关闭模拟器
✅ 截取屏幕
✅ 按 Home 按钮
✅ 旋转屏幕
✅ 所有功能都可以通过工具调用使用

侧边栏面板只是一个**可视化增强**，不影响核心功能。
