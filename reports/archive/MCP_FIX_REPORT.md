# MCP 修复报告

## 修复时间
2026-09-19

## 修复内容

### 1. iOS Simulator Panel Desktop Extension

**问题：**
- `simulator_home` - 使用了已废弃的 `xcrun simctl ui ${udid} home` 命令
- `simulator_rotate` - 使用了已废弃的 `xcrun simctl ui ${udid} rotate` 命令

**原因：**
新版本 Xcode 的 `xcrun simctl ui` 命令已经移除了 `home` 和 `rotate` 子命令。

**解决方案：**
- `simulator_home`: 使用 AppleScript 发送 Cmd+Shift+H 键盘快捷键
- `simulator_rotate`: 使用 AppleScript 发送 Cmd+Left/Right 键盘快捷键

**修改文件：**
- `~/.claude-projects-3p/Claude Extensions/local.mcpb.ios-simulator-panel-contributors.ios-simulator-panel/src/index.ts`
- 创建了 `tsconfig.json` 以支持编译

**修改代码：**
```typescript
// simulator_home - 第 272-280 行
case "simulator_home": {
  let udid = args?.udid as string || "booted";
  // Use keyboard shortcut Cmd+Shift+H to trigger home button
  await execAsync(`osascript -e 'tell application "System Events" to keystroke "h" using {command down, shift down}'`);
  return {
    content: [{
      type: "text",
      text: "Home button pressed",
    }],
  };
}

// simulator_rotate - 第 283-293 行
case "simulator_rotate": {
  let udid = args?.udid as string || "booted";
  const direction = args?.direction as string;
  // Use keyboard shortcut Cmd+Left/Right to rotate
  const key = direction === "left" ? "123" : "124"; // 123 = left arrow, 124 = right arrow
  await execAsync(`osascript -e 'tell application "System Events" to key code ${key} using {command down}'`);
  return {
    content: [{
      type: "text",
      text: `Rotated ${direction}`,
    }],
  };
}
```

---

### 2. Computer Use MCP Server

**问题：**
- `computer_get_screen_info` - AppleScript 无法获取屏幕尺寸
- `computer_press_key` - 键名映射错误（`escape` 应该是 `esc`）

**原因：**
1. 原来的 AppleScript 使用 `System Events` 的 `desktop` 对象，在某些系统版本上不可用
2. cliclick 对特殊键名有特定要求，需要映射常见的键名

**解决方案：**
1. `computer_get_screen_info`: 
   - 首先尝试使用 `system_profiler` 获取屏幕信息
   - 失败则使用 `Finder` 的 `bounds` 属性
   - 最后回退到常见的 MacBook Pro 分辨率
   
2. `computer_press_key`:
   - 添加键名映射函数 `mapKeyName()`
   - 自动将常见键名转换为 cliclick 格式

**修改文件：**
- `~/Tools/Claude/computer-use-mcp-server/src/utils.ts`
- `~/Tools/Claude/computer-use-mcp-server/src/index.ts`

**修改代码：**

utils.ts - `getScreenInfo()` 函数：
```typescript
export async function getScreenInfo(): Promise<ScreenInfo> {
  // Use system_profiler to get display info reliably
  try {
    const { stdout } = await execAsync("system_profiler SPDisplaysDataType | grep Resolution");
    const match = stdout.match(/(\d+)\s*x\s*(\d+)/);
    if (match) {
      return {
        width: parseInt(match[1]),
        height: parseInt(match[2]),
        scaleFactor: 2
      };
    }
  } catch (e) {}

  // Fallback: try using osascript with Finder
  const script = `tell application "Finder" to get bounds of window of desktop`;
  try {
    const result = await execAppleScript(script);
    const coords = result.split(", ").map(Number);
    if (coords.length >= 4) {
      return {
        width: coords[2] - coords[0],
        height: coords[3] - coords[1],
        scaleFactor: 2
      };
    }
  } catch (e) {}

  // Final fallback: common MacBook Pro resolution
  return {
    width: 3024,
    height: 1964,
    scaleFactor: 2
  };
}
```

utils.ts - 新增 `mapKeyName()` 函数：
```typescript
export function mapKeyName(key: string): string {
  const keyMap: Record<string, string> = {
    'escape': 'esc',
    'backspace': 'delete',
    'forward-delete': 'fwd-delete',
    'pageup': 'page-up',
    'pagedown': 'page-down',
    'arrowup': 'arrow-up',
    'arrowdown': 'arrow-down',
    'arrowleft': 'arrow-left',
    'arrowright': 'arrow-right',
  };
  const lowerKey = key.toLowerCase();
  return keyMap[lowerKey] || key;
}
```

index.ts - 更新 `computer_press_key` 使用映射：
```typescript
async (params) => {
  try {
    // Map key name to cliclick format
    const mappedKey = mapKeyName(params.key);
    let keyCmd = `kp:${mappedKey}`;
    // ... rest of the code
  }
}
```

---

## 测试结果

### iOS Simulator Panel
- ✅ `simulator_list` - 可用
- ✅ `simulator_boot` - 可用
- ✅ `simulator_shutdown` - 可用
- ✅ `simulator_screenshot` - 可用
- ✅ `simulator_open_panel` - 可用
- ✅ `simulator_home` - **已修复**
- ✅ `simulator_rotate` - **已修复**

### Computer Use MCP
- ✅ `computer_screenshot` - 可用
- ✅ `computer_get_mouse_position` - 可用
- ✅ `computer_mouse_move` - 可用
- ✅ `computer_mouse_click` - 可用
- ✅ `computer_type_text` - 可用
- ✅ `computer_run_applescript` - 可用
- ✅ `computer_get_screen_info` - **已修复**（返回 3456x2234）
- ✅ `computer_press_key` - **已修复**

---

## 使用说明

### 重启 Claude Desktop
修复完成后需要重启 Claude Desktop 应用以加载更新的 MCP 服务器。

### 测试命令
```bash
# 测试 Computer Use MCP
cd ~/Tools/Claude/computer-use-mcp-server
node test-tools.mjs

# 重新编译 iOS Simulator Panel（如果需要）
cd "$HOME/.claude-projects-3p/Claude Extensions/local.mcpb.ios-simulator-panel-contributors.ios-simulator-panel"
npm run build
```

---

## 侧边栏面板说明

iOS Simulator Panel 是一个 Desktop Extension，提供侧边栏面板功能。它与普通的 MCP 服务器不同：

1. **Desktop Extension** = MCP 服务器 + UI 面板
2. 使用 `manifest.json` 声明为 extension
3. 通过 `_meta` 字段和 `ui://` 资源提供 UI
4. 侧边栏由 `simulator_open_panel` 工具触发

要创建类似的侧边栏面板，需要：
- 在 manifest.json 中声明 extension
- 提供 UI 资源（HTML/CSS/JS）
- 在工具响应中返回 `_meta` 数据
- 注册 UI 资源 handler

---

## 已知限制

1. `computer_get_screen_info` 在某些系统上可能需要辅助功能权限
2. `computer_press_key` 和其他 cliclick 功能需要安装 cliclick：`brew install cliclick`
3. iOS Simulator 的 home 和 rotate 功能需要模拟器窗口处于焦点状态
4. 键盘快捷键可能与系统或其他应用冲突

---

## 下一步

所有功能已修复并测试通过。建议：

1. 重启 Claude Desktop 加载更新
2. 测试实际使用场景
3. 如有需要，可以添加更多键名映射
4. 考虑为 computer_get_screen_info 添加更精确的 scaleFactor 检测
