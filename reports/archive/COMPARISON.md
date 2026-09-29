# CC-Source vs Enhanced MCP: Feature Comparison

## 核心实现对比 (Core Implementation Comparison)

### 1. 鼠标移动 (Mouse Movement)

#### CC-Source (executor.ts:399-450)
```typescript
async animatedMove(x: number, y: number, enabled: boolean) {
  const start = await this.getMousePosition();
  const distance = Math.hypot(x - start.x, y - start.y);
  const durationSec = Math.min(distance / 2000, 0.5); // 2000 px/sec, max 0.5s
  
  // 60fps ease-out-cubic animation
  for (let frame = 1; frame <= totalFrames; frame++) {
    const eased = 1 - Math.pow(1 - t, 3);
    await this.moveAndSettle(x_frame, y_frame);
  }
}
```

#### Enhanced MCP (utils-enhanced.ts:98-136)
```typescript
export async function animatedMouseMove(
  targetX: number, 
  targetY: number, 
  enabled: boolean = true
) {
  const durationSec = Math.min(distance / 2000, 0.5);
  const frameRate = 60;
  
  for (let frame = 1; frame <= totalFrames; frame++) {
    const eased = 1 - Math.pow(1 - t, 3);
    await execCliClick([`m:${x_frame},${y_frame}`]);
  }
}
```

**✅ 完全一致** - 相同的算法、相同的缓动曲线、相同的帧率

---

### 2. 点击稳定 (Click Stability)

#### CC-Source (executor.ts:192-197)
```typescript
async moveAndSettle(x: number, y: number) {
  await this.moveMouse(x, y);
  await sleep(50); // MOVE_SETTLE_MS
}
```

#### Enhanced MCP (utils-enhanced.ts:81-84)
```typescript
export async function moveMouseAndSettle(x: number, y: number) {
  await execCliClick([`m:${x},${y}`]);
  await sleep(MOVE_SETTLE_MS); // 50ms
}
```

**✅ 完全一致** - 相同的50ms等待时间

---

### 3. 剪贴板输入 (Clipboard Typing)

#### CC-Source (executor.ts:271-311)
```typescript
async typeViaClipboard(text: string) {
  let saved: string | undefined;
  try {
    saved = await this.readClipboard(); // pbpaste
  } catch {}
  
  await this.writeClipboard(text); // pbcopy via spawn
  const verification = await this.readClipboard();
  if (verification !== text) throw new Error('round-trip failed');
  
  await this.pressKeySequence(['cmd', 'v']);
  await sleep(100); // CLIPBOARD_PASTE_DELAY_MS
  
  if (saved !== undefined) {
    await this.writeClipboard(saved); // restore
  }
}
```

#### Enhanced MCP (utils-enhanced.ts:168-200)
```typescript
export async function typeViaClipboard(text: string) {
  let savedClipboard: string | undefined;
  try {
    savedClipboard = await readClipboard();
  } catch {}
  
  await writeClipboard(text);
  const verification = await readClipboard();
  if (verification !== text) throw new Error('round-trip failed');
  
  await execCliClick(['kp:cmd', 'kp:v', 'ku:v', 'ku:cmd']);
  await sleep(CLIPBOARD_PASTE_DELAY_MS); // 100ms
  
  if (savedClipboard !== undefined) {
    await writeClipboard(savedClipboard);
  }
}
```

**✅ 完全一致** - 相同的保存/恢复逻辑、相同的验证步骤、相同的延迟

---

### 4. 按键重复 (Key Repeat)

#### CC-Source (executor.ts:313-327)
```typescript
async pressKeySequence(keys: string[], repeat: number = 1) {
  for (let i = 0; i < repeat; i++) {
    if (i > 0) {
      await sleep(8); // 125Hz USB polling cadence
    }
    
    // Press all keys
    for (const key of keys) await this.pressKey(key);
    
    // Release in reverse
    for (const key of keys.reverse()) await this.releaseKey(key);
    keys.reverse(); // restore order
  }
}
```

#### Enhanced MCP (index-enhanced.ts:273-295)
```typescript
for (let i = 0; i < params.repeat; i++) {
  if (i > 0) {
    await sleep(8); // 125Hz USB polling
  }
  
  // Press all keys
  for (const key of parts) actions.push(`kp:${key}`);
  
  // Release in reverse
  for (const key of parts.reverse()) actions.push(`ku:${key}`);
  parts.reverse();
  
  await execCliClick(actions);
}
```

**✅ 完全一致** - 相同的8ms间隔、相同的按压/释放顺序

---

## 新增功能 (New Features)

### 5. 拖拽 (Drag)

#### CC-Source
❌ 没有专门的拖拽工具

#### Enhanced MCP (index-enhanced.ts:302-339)
```typescript
server.registerTool("computer_drag", {
  async (params) => {
    await moveMouseAndSettle(from_x, from_y);
    await execCliClick(['dd:.']); // Mouse down
    await sleep(50);
    await animatedMouseMove(to_x, to_y, animated);
    await execCliClick(['du:.']); // Mouse up
  }
});
```

**✅ 新增** - 基于CC-Source的move-and-settle模式实现

---

### 6. 滚动 (Scroll)

#### CC-Source
❌ 没有专门的滚动工具

#### Enhanced MCP (index-enhanced.ts:344-386)
```typescript
server.registerTool("computer_scroll", {
  async (params) => {
    await moveMouseAndSettle(x, y);
    
    const direction = dy > 0 ? 'down' : 'up';
    for (let i = 0; i < Math.abs(dy); i++) {
      actions.push(`w:${direction}:${x},${y}`);
    }
    
    await execCliClick(actions);
  }
});
```

**✅ 新增** - 结合CC-Source的定位逻辑

---

## 工具对比表 (Tool Comparison Table)

| Tool | CC-Source | Enhanced MCP | Implementation |
|------|-----------|--------------|----------------|
| Mouse Move | ✅ animatedMove | ✅ computer_mouse_move | Same algorithm |
| Mouse Click | ✅ clickMouse | ✅ computer_mouse_click | Same settle pattern |
| Type Text | ✅ typeText | ✅ computer_type_text | Same logic |
| Type via Clipboard | ✅ typeViaClipboard | ✅ via_clipboard option | Same flow |
| Press Key | ✅ pressKeySequence | ✅ computer_press_key | Same timing |
| Screenshot | ✅ takeScreenshot | ✅ computer_screenshot | Same command |
| Get Screen Info | ✅ getScreenInfo | ✅ computer_get_screen_info | Same approach |
| Get Mouse Pos | ✅ getMousePosition | ✅ computer_get_mouse_position | Same |
| **Drag** | ❌ | ✅ computer_drag | **New** |
| **Scroll** | ❌ | ✅ computer_scroll | **New** |

---

## 常量对比 (Constants Comparison)

| Constant | CC-Source | Enhanced MCP | Purpose |
|----------|-----------|--------------|---------|
| MOVE_SETTLE_MS | 50 | 50 | Mouse settle time |
| CLIPBOARD_PASTE_DELAY_MS | 100 | 100 | Paste wait time |
| Key repeat interval | 8ms | 8ms | USB polling rate |
| Animation speed | 2000 px/sec | 2000 px/sec | Mouse speed |
| Animation max duration | 0.5s | 0.5s | Max animation time |
| Animation framerate | 60fps | 60fps | Smoothness |
| Easing function | ease-out-cubic | ease-out-cubic | Same curve |

---

## 实现差异 (Implementation Differences)

### 1. 架构 (Architecture)

**CC-Source:**
- 内部集成到Claude Code
- 依赖内部工具链
- Swift/TypeScript混合

**Enhanced MCP:**
- 独立MCP服务器
- 零内部依赖
- 纯TypeScript + cliclick

### 2. 工具集 (Tooling)

**CC-Source:**
- 使用内部inputLoader/swiftLoader
- 依赖CC内部权限系统

**Enhanced MCP:**
- 直接调用cliclick
- macOS Accessibility权限

### 3. 扩展性 (Extensibility)

**CC-Source:**
- 紧密集成，难以单独使用

**Enhanced MCP:**
- 标准MCP协议
- 可用于任何MCP客户端
- 易于修改和扩展

---

## 结论 (Conclusion)

### ✅ 核心算法完全一致
- 动画曲线
- 点击稳定性
- 剪贴板逻辑
- 按键时序

### ✅ 新增实用功能
- 拖拽工具
- 滚动工具

### ✅ 架构更加灵活
- 独立MCP服务器
- 无内部依赖
- 标准化接口

---

**总结：Enhanced MCP = CC-Source的核心最佳实践 + 独立可用的MCP架构 + 额外的实用工具**
