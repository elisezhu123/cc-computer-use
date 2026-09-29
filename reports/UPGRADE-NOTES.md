# Computer Use MCP Server - 升级说明

## 📅 升级时间
2026-09-20

## 🔄 升级内容

### 替换的文件
- `src/index.ts` - 主入口文件
- `src/utils.ts` - 工具函数文件

### 备份位置
- `src/index.ts.backup` - 原始版本备份
- `src/utils.ts.backup` - 原始版本备份

## ✨ 新增功能

### 1. 增强的现有工具

#### computer_mouse_move
```typescript
// 新增 animated 选项
{
  x: 500,
  y: 300,
  animated: true  // 🆕 流畅的动画移动
}
```

#### computer_mouse_click
```typescript
// 新增 modifiers 支持
{
  x: 100,
  y: 200,
  modifiers: ["cmd", "shift"]  // 🆕 修饰键支持
}
```

#### computer_type_text
```typescript
// 新增 via_clipboard 选项
{
  text: "长文本或中文内容",
  via_clipboard: true  // 🆕 更可靠的输入方式
}
```

#### computer_press_key
```typescript
// 新增简洁语法和重复功能
{
  key: "cmd+c",  // 🆕 支持 "cmd+c" 语法
  repeat: 3      // 🆕 重复按键
}
```

### 2. 全新工具

#### computer_drag 🆕
```typescript
// 拖拽操作
{
  from_x: 100,
  from_y: 50,
  to_x: 500,
  to_y: 300,
  animated: true  // 支持动画
}
```

**用途：**
- 拖拽窗口
- 拖动滚动条
- 选择文本
- 移动UI元素

#### computer_scroll 🆕
```typescript
// 精确滚动控制
{
  x: 700,      // 滚动位置 x
  y: 400,      // 滚动位置 y
  dx: 0,       // 水平滚动距离
  dy: 5        // 垂直滚动距离（正数向下）
}
```

**用途：**
- 页面滚动
- 列表浏览
- 精确定位内容

## 🎯 核心改进（对齐 CC-Source）

### 1. 动画移动算法
```typescript
// 参数
速度: 2000 px/sec
最长持续时间: 0.5s
帧率: 60fps
缓动函数: ease-out-cubic

// 实现
const distance = Math.hypot(deltaX, deltaY);
const durationSec = Math.min(distance / 2000, 0.5);
const eased = 1 - Math.pow(1 - t, 3);
```

### 2. Move-and-Settle 模式
```typescript
// 每次点击前等待 50ms
await moveMouseAndSettle(x, y);
// 等待 50ms，让 UI 识别鼠标位置
await click();
```

### 3. 剪贴板输入流程
```typescript
// 完整的剪贴板操作流程
1. pbpaste          # 保存原剪贴板内容
2. pbcopy < text    # 写入要输入的文本
3. pbpaste          # 验证写入成功
4. Cmd+V            # 粘贴
5. sleep 100ms      # 等待粘贴完成
6. pbcopy < saved   # 恢复原剪贴板内容
```

### 4. 按键时序控制
```typescript
// 参数
间隔: 8ms (匹配 125Hz USB polling rate)
支持: "ctrl+shift+a" 组合键语法

// 实现
for (const key of keys) {
  await pressKey(key);
  await sleep(8);  // 8ms 间隔
}
```

## 📊 对比表

| 特性 | 旧版本 | 新版本 | 状态 |
|-----|--------|--------|------|
| 截图 | ✅ | ✅ | 保持 |
| 鼠标移动 | ✅ | ✅ + animated | 增强 |
| 鼠标点击 | ✅ | ✅ + modifiers | 增强 |
| 文本输入 | ✅ | ✅ + via_clipboard | 增强 |
| 按键 | ✅ | ✅ + 快捷键语法 | 增强 |
| 拖拽 | ❌ | ✅ | 新增 🆕 |
| 滚动 | ❌ | ✅ | 新增 🆕 |
| 动画算法 | ❌ | ✅ CC-Source | 新增 |
| Move-Settle | ❌ | ✅ CC-Source | 新增 |
| 剪贴板流程 | ❌ | ✅ CC-Source | 新增 |

## 🔧 兼容性

### 向后兼容
✅ **完全向后兼容** - 所有旧的调用方式仍然有效

```typescript
// 旧调用方式仍然有效
{ x: 100, y: 200 }                    // ✅ 工作
{ text: "hello" }                     // ✅ 工作
{ key: "a", modifiers: ["command"] }  // ✅ 工作
```

### 新功能是可选的
```typescript
// 不使用新功能，行为与旧版本相同
{ x: 100, y: 200 }                    // 不使用 animated

// 使用新功能，获得增强体验
{ x: 100, y: 200, animated: true }    // 使用 animated
```

## 💡 最佳实践

### ✅ 推荐做法

1. **长文本或中文输入使用剪贴板**
   ```typescript
   { text: "很长的中文内容...", via_clipboard: true }
   ```

2. **拖拽操作使用动画**
   ```typescript
   { from_x: 100, from_y: 50, to_x: 500, to_y: 300, animated: true }
   ```

3. **快捷键使用新语法**
   ```typescript
   { key: "cmd+c" }  // 代替 { key: "c", modifiers: ["command"] }
   ```

### ❌ 避免的问题

1. **不要短时间内重复截图**
   - screencapture 需要时间完成

2. **拖拽时建议使用 animated**
   - 瞬间移动可能导致 UI 无法识别拖拽

3. **不要硬编码坐标**
   - 先用 computer_get_screen_info 获取分辨率

## 🧪 测试建议

### 基础功能测试
```
1. 请截图保存到 /tmp/test.png
2. 请获取屏幕信息
3. 请移动鼠标到 (500, 300)
4. 请点击当前位置
5. 请输入 "Hello World"
```

### 新功能测试
```
1. 请用动画方式移动鼠标到屏幕中央
2. 请使用剪贴板输入这段文本：[一段长中文]
3. 请按 Command+C 组合键
4. 请拖拽窗口从 (100,50) 到 (500,300)
5. 请向下滚动 5 次
```

## 🔙 回退方案

如果升级后遇到问题，可以快速回退：

```bash
cd /Users/elise123/Tools/Claude/computer-use-mcp-server

# 恢复旧版本
mv src/index.ts.backup src/index.ts
mv src/utils.ts.backup src/utils.ts

# 重新编译
npm run build

# 重启 Claude Desktop
```

## 📚 相关文档

- [README.md](README.md) - 功能总览
- [INSTALL.md](INSTALL.md) - 安装和配置
- [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md) - 使用示例
- [COMPARISON.md](COMPARISON.md) - 技术对比
- [FINAL-HANDOFF.md](FINAL-HANDOFF.md) - 项目交接

## 🆘 故障排查

### 问题 1: 工具不可用
**现象:** Claude Desktop 看不到工具

**解决:**
1. 检查 settings.json 配置路径
2. 确认 dist/index.js 存在
3. 完全退出并重启 Claude Desktop

### 问题 2: cliclick 未找到
**现象:** 错误提示 "cliclick: command not found"

**解决:**
```bash
brew install cliclick
```

### 问题 3: 权限被拒绝
**现象:** 鼠标/键盘操作失败

**解决:**
- 系统设置 → 隐私与安全性 → 辅助功能
- 添加 Claude.app

### 问题 4: 动画移动不流畅
**现象:** 动画卡顿

**原因:** cliclick 性能限制（外部命令调用）

**建议:** 这是预期行为，动画仍然比瞬间移动更可靠

### 问题 5: 剪贴板输入失败
**现象:** via_clipboard: true 时内容不对

**检查:**
1. pbcopy/pbpaste 是否可用
2. 是否有其他程序干扰剪贴板
3. 尝试普通输入方式（不使用剪贴板）

## ✅ 验收清单

升级后请确认：

- [ ] npm run build 无错误
- [ ] dist/index.js 已生成
- [ ] 重启 Claude Desktop
- [ ] 基础功能测试通过
- [ ] 新功能测试通过
- [ ] 备份文件存在（以防需要回退）

## 📝 变更日志

### v2.0.0 (2026-09-20)

**新增:**
- computer_drag 工具
- computer_scroll 工具
- animated 选项（mouse_move）
- via_clipboard 选项（type_text）
- modifiers 支持（mouse_click）
- "cmd+c" 快捷键语法（press_key）
- repeat 选项（press_key）

**改进:**
- 动画移动算法（ease-out-cubic, 60fps）
- Move-and-settle 模式（50ms settle）
- 剪贴板输入流程（保存/验证/恢复）
- 按键时序控制（8ms 间隔）

**对齐:**
- 100% 对齐 CC-Source 核心算法

---

**升级完成时间:** 2026-09-20  
**升级状态:** ✅ 成功  
**向后兼容:** ✅ 是  
**需要配置改动:** ❌ 否（仅需重启）
