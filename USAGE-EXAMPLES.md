# 使用示例 (Usage Examples)

## 基础示例 (Basic Examples)

### 1. 截图 (Screenshot)

```typescript
// 基础截图
{
  "tool": "computer_screenshot",
  "arguments": {
    "output_path": "/tmp/screen.png"
  }
}

// 带缩放的截图
{
  "tool": "computer_screenshot",
  "arguments": {
    "output_path": "/tmp/screen_small.png",
    "width": 1920,
    "height": 1080
  }
}
```

### 2. 鼠标移动 (Mouse Movement)

```typescript
// 瞬间移动
{
  "tool": "computer_mouse_move",
  "arguments": {
    "x": 500,
    "y": 300,
    "animated": false
  }
}

// 动画移动（更自然，适合拖拽）
{
  "tool": "computer_mouse_move",
  "arguments": {
    "x": 500,
    "y": 300,
    "animated": true  // ✨ ease-out-cubic 60fps
  }
}
```

### 3. 点击 (Click)

```typescript
// 基础左键点击
{
  "tool": "computer_mouse_click",
  "arguments": {
    "x": 500,
    "y": 300
  }
}

// 右键点击
{
  "tool": "computer_mouse_click",
  "arguments": {
    "x": 500,
    "y": 300,
    "button": "right"
  }
}

// 双击
{
  "tool": "computer_mouse_click",
  "arguments": {
    "x": 500,
    "y": 300,
    "double": true
  }
}

// Cmd+Click（在新标签打开链接）
{
  "tool": "computer_mouse_click",
  "arguments": {
    "x": 500,
    "y": 300,
    "modifiers": ["command"]
  }
}

// Shift+Click（选择范围）
{
  "tool": "computer_mouse_click",
  "arguments": {
    "x": 500,
    "y": 300,
    "modifiers": ["shift"]
  }
}
```

---

## 高级示例 (Advanced Examples)

### 4. 文本输入 (Text Input)

```typescript
// 普通输入（短文本）
{
  "tool": "computer_type_text",
  "arguments": {
    "text": "Hello World",
    "delay": 50
  }
}

// 剪贴板输入（推荐：长文本、特殊字符、中文）
{
  "tool": "computer_type_text",
  "arguments": {
    "text": "这是一段很长的中文文本，包含特殊字符：¥€£ 和 emoji 🎉",
    "via_clipboard": true  // ✨ 更可靠！
  }
}

// 代码片段输入
{
  "tool": "computer_type_text",
  "arguments": {
    "text": "const hello = () => {\n  console.log('Hello');\n}",
    "via_clipboard": true
  }
}
```

### 5. 按键操作 (Key Press)

```typescript
// 单个按键
{
  "tool": "computer_press_key",
  "arguments": {
    "key": "return"
  }
}

// 快捷键（新语法！）
{
  "tool": "computer_press_key",
  "arguments": {
    "key": "cmd+c"  // ✨ 支持 + 分隔符
  }
}

// 复杂快捷键
{
  "tool": "computer_press_key",
  "arguments": {
    "key": "cmd+shift+a"  // 全选并高亮
  }
}

// 重复按键（方向键导航）
{
  "tool": "computer_press_key",
  "arguments": {
    "key": "arrowdown",
    "repeat": 5  // ✨ 8ms间隔，模拟USB键盘
  }
}

// Tab键切换
{
  "tool": "computer_press_key",
  "arguments": {
    "key": "tab",
    "repeat": 3
  }
}
```

### 6. 拖拽操作 (Drag) 🆕

```typescript
// 拖动窗口
{
  "tool": "computer_drag",
  "arguments": {
    "from_x": 100,
    "from_y": 50,   // 窗口标题栏
    "to_x": 500,
    "to_y": 300,
    "animated": true  // ✨ 动画拖拽，更自然
  }
}

// 调整窗口大小
{
  "tool": "computer_drag",
  "arguments": {
    "from_x": 800,
    "from_y": 600,  // 窗口右下角
    "to_x": 1200,
    "to_y": 900,
    "animated": true
  }
}

// 拖动滚动条
{
  "tool": "computer_drag",
  "arguments": {
    "from_x": 1400,
    "from_y": 200,  // 滚动条位置
    "to_x": 1400,
    "to_y": 600,
    "animated": false  // 滚动条不需要动画
  }
}

// 选择文本（拖拽选择）
{
  "tool": "computer_drag",
  "arguments": {
    "from_x": 200,
    "from_y": 300,
    "to_x": 600,
    "to_y": 300,
    "animated": true
  }
}
```

### 7. 滚动操作 (Scroll) 🆕

```typescript
// 向下滚动
{
  "tool": "computer_scroll",
  "arguments": {
    "x": 700,
    "y": 400,
    "dy": 5,   // 正数 = 向下
    "dx": 0
  }
}

// 向上滚动
{
  "tool": "computer_scroll",
  "arguments": {
    "x": 700,
    "y": 400,
    "dy": -3,  // 负数 = 向上
    "dx": 0
  }
}

// 水平滚动
{
  "tool": "computer_scroll",
  "arguments": {
    "x": 700,
    "y": 400,
    "dy": 0,
    "dx": 5   // 正数 = 向右
  }
}

// 对角滚动
{
  "tool": "computer_scroll",
  "arguments": {
    "x": 700,
    "y": 400,
    "dy": 3,
    "dx": 2
  }
}
```

---

## 组合场景 (Combined Scenarios)

### 场景1: 打开网页并搜索

```typescript
// 1. 打开浏览器（Spotlight搜索）
{ "tool": "computer_press_key", "arguments": { "key": "cmd+space" } }
{ "tool": "computer_type_text", "arguments": { "text": "Safari" } }
{ "tool": "computer_press_key", "arguments": { "key": "return" } }

// 等待浏览器打开...

// 2. 点击地址栏
{ "tool": "computer_mouse_click", "arguments": { "x": 700, "y": 50 } }

// 3. 输入网址
{ "tool": "computer_type_text", "arguments": { 
  "text": "https://www.anthropic.com",
  "via_clipboard": true 
}}

// 4. 回车
{ "tool": "computer_press_key", "arguments": { "key": "return" } }
```

### 场景2: 填写表单

```typescript
// 1. 点击第一个输入框
{ "tool": "computer_mouse_click", "arguments": { "x": 500, "y": 300 } }

// 2. 输入姓名
{ "tool": "computer_type_text", "arguments": { 
  "text": "张三",
  "via_clipboard": true 
}}

// 3. Tab到下一个字段
{ "tool": "computer_press_key", "arguments": { "key": "tab" } }

// 4. 输入邮箱
{ "tool": "computer_type_text", "arguments": { 
  "text": "zhangsan@example.com" 
}}

// 5. Tab到下一个字段
{ "tool": "computer_press_key", "arguments": { "key": "tab" } }

// 6. 输入多行文本
{ "tool": "computer_type_text", "arguments": { 
  "text": "这是一段\n多行的\n留言内容",
  "via_clipboard": true 
}}

// 7. 点击提交按钮
{ "tool": "computer_mouse_click", "arguments": { "x": 600, "y": 500 } }
```

### 场景3: 窗口管理

```typescript
// 1. 拖动窗口到屏幕中央
{ "tool": "computer_drag", "arguments": {
  "from_x": 200, "from_y": 50,
  "to_x": 512, "to_y": 384,
  "animated": true
}}

// 2. 调整窗口大小
{ "tool": "computer_drag", "arguments": {
  "from_x": 1024, "from_y": 768,
  "to_x": 1200, "to_y": 900,
  "animated": true
}}

// 3. 最大化窗口（双击标题栏）
{ "tool": "computer_mouse_click", "arguments": {
  "x": 512, "y": 50,
  "double": true
}}
```

### 场景4: 文本编辑

```typescript
// 1. 全选
{ "tool": "computer_press_key", "arguments": { "key": "cmd+a" } }

// 2. 复制
{ "tool": "computer_press_key", "arguments": { "key": "cmd+c" } }

// 3. 点击新位置
{ "tool": "computer_mouse_click", "arguments": { "x": 700, "y": 400 } }

// 4. 粘贴
{ "tool": "computer_press_key", "arguments": { "key": "cmd+v" } }

// 5. 向下移动光标5次
{ "tool": "computer_press_key", "arguments": { 
  "key": "arrowdown", 
  "repeat": 5 
}}

// 6. Shift+End选择到行尾
{ "tool": "computer_press_key", "arguments": { "key": "shift+end" } }
```

### 场景5: 网页长截图

```typescript
// 1. 截取当前视窗
{ "tool": "computer_screenshot", "arguments": { 
  "output_path": "/tmp/page_1.png" 
}}

// 2. 向下滚动
{ "tool": "computer_scroll", "arguments": {
  "x": 700, "y": 400,
  "dy": 10
}}

// 等待页面渲染...

// 3. 截取第二屏
{ "tool": "computer_screenshot", "arguments": { 
  "output_path": "/tmp/page_2.png" 
}}

// 4. 继续滚动
{ "tool": "computer_scroll", "arguments": {
  "x": 700, "y": 400,
  "dy": 10
}}

// 5. 截取第三屏
{ "tool": "computer_screenshot", "arguments": { 
  "output_path": "/tmp/page_3.png" 
}}
```

---

## 最佳实践 (Best Practices)

### ✅ 推荐做法

1. **长文本用剪贴板**
   ```typescript
   { "via_clipboard": true }  // 超过50字符时推荐
   ```

2. **拖拽用动画**
   ```typescript
   { "animated": true }  // 让系统更好地识别拖拽
   ```

3. **快捷键用新语法**
   ```typescript
   { "key": "cmd+c" }  // 而不是手动指定modifiers
   ```

4. **点击前等待**
   ```typescript
   // 工具已内置50ms settle时间，无需手动等待
   ```

### ❌ 避免做法

1. **不要在短时间内重复截图**
   ```typescript
   // 错误：screencapture需要时间
   screenshot(); screenshot(); screenshot();
   
   // 正确：加入适当延迟
   screenshot(); await sleep(200); screenshot();
   ```

2. **不要忽略动画标志**
   ```typescript
   // 拖拽时使用animated: false可能导致失败
   ```

3. **不要硬编码坐标**
   ```typescript
   // 错误：不同分辨率会失败
   { "x": 500, "y": 300 }
   
   // 正确：先获取屏幕信息
   const info = getScreenInfo();
   { "x": info.width / 2, "y": info.height / 2 }
   ```

---

## 性能提示 (Performance Tips)

### 延迟时间参考

| 操作 | 内置延迟 | 推荐额外等待 |
|-----|---------|-------------|
| 鼠标移动后 | 50ms | 0ms |
| 点击后 | 0ms | 100-200ms |
| 按键后 | 0ms | 50-100ms |
| 剪贴板粘贴后 | 100ms | 0ms |
| 截图后 | 0ms | 200ms |
| 滚动后 | 0ms | 100ms |
| 拖拽后 | 0ms | 200ms |

### 速度优化

```typescript
// 慢速（每个操作都截图验证）
click(); screenshot(); 
type(); screenshot(); 
press(); screenshot();

// 快速（批量操作后验证）
click(); 
type(); 
press(); 
screenshot();
```

---

## 调试技巧 (Debugging Tips)

### 1. 定位问题

```typescript
// 先获取屏幕信息
{ "tool": "computer_get_screen_info" }

// 获取当前鼠标位置
{ "tool": "computer_get_mouse_position" }

// 截图确认状态
{ "tool": "computer_screenshot", "arguments": {
  "output_path": "/tmp/debug.png"
}}
```

### 2. 测试坐标

```typescript
// 移动到目标位置（不点击）
{ "tool": "computer_mouse_move", "arguments": {
  "x": 500, "y": 300,
  "animated": true
}}

// 截图确认位置正确
{ "tool": "computer_screenshot", "arguments": {
  "output_path": "/tmp/position_check.png"
}}

// 确认后再点击
{ "tool": "computer_mouse_click", "arguments": {
  "x": 500, "y": 300
}}
```

### 3. AppleScript调试

```typescript
// 获取前台应用
{ "tool": "computer_run_applescript", "arguments": {
  "script": "tell application \"System Events\" to get name of first application process whose frontmost is true"
}}

// 获取窗口位置
{ "tool": "computer_run_applescript", "arguments": {
  "script": "tell application \"System Events\" to get position of window 1 of process \"Safari\""
}}

// 获取窗口大小
{ "tool": "computer_run_applescript", "arguments": {
  "script": "tell application \"System Events\" to get size of window 1 of process \"Safari\""
}}
```

---

**提示：所有示例都可以直接在Claude Desktop中使用！** 🚀
