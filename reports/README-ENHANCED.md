# Enhanced Computer Use MCP Server

**Version 2.0** - Fusion of CC-Source best practices + standalone implementation

## 🎯 What's Enhanced?

This version combines the battle-tested patterns from Claude Code's internal `computer-use` implementation with a standalone MCP server architecture:

### ✨ Key Improvements from CC-Source

1. **Move-and-Settle Pattern** 
   - Every click waits 50ms after mouse movement for UI to register position
   - Eliminates "click in wrong place" issues

2. **Animated Mouse Movement**
   - Smooth ease-out-cubic animation at 60fps
   - Distance-proportional duration (2000 px/sec, max 0.5s)
   - Better drag detection by native apps

3. **Clipboard-Based Typing**
   - More reliable for long text or special characters
   - Preserves and restores original clipboard content
   - Verifies clipboard write before pasting

4. **New Tools**
   - `computer_drag` - Drag from point A to B (window resize, scrollbars)
   - `computer_scroll` - Scroll at position with dx/dy amounts

5. **Enhanced Key Handling**
   - Key sequences: `"ctrl+c"`, `"cmd+shift+a"` 
   - Repeat support with proper timing (125Hz USB polling)
   - 8ms delay between repeats

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
npm run build
```

### 2. Configure Claude Desktop

Add to `~/.claude/settings.json`:

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

### 3. Grant Permissions

**System Settings → Privacy & Security → Accessibility**
- Add `Claude.app`

### 4. Restart Claude Desktop

## 🛠️ Available Tools

### Original Tools (Enhanced)

1. **computer_screenshot** - Take screenshots
2. **computer_get_screen_info** - Get display info
3. **computer_mouse_move** - Move cursor (with optional animation)
4. **computer_mouse_click** - Click with modifiers
5. **computer_type_text** - Type text (with clipboard mode)
6. **computer_press_key** - Press keys/sequences
7. **computer_get_mouse_position** - Get cursor position
8. **computer_run_applescript** - Execute AppleScript

### New Tools

9. **computer_drag** - Drag from one point to another
10. **computer_scroll** - Scroll at position

## 📖 Usage Examples

### Animated Mouse Movement

```json
{
  "x": 500,
  "y": 300,
  "animated": true
}
```

### Type via Clipboard (Reliable)

```json
{
  "text": "Long text with special chars: 你好世界 🎉",
  "via_clipboard": true
}
```

### Key Sequences

```json
{
  "key": "cmd+c",
  "repeat": 1
}
```

```json
{
  "key": "ctrl+shift+a"
}
```

### Drag Operation

```json
{
  "from_x": 100,
  "from_y": 200,
  "to_x": 500,
  "to_y": 600,
  "animated": true
}
```

### Scroll

```json
{
  "x": 500,
  "y": 400,
  "dy": 5,
  "dx": 0
}
```

## 🔬 Technical Deep Dive

### Move-and-Settle Pattern

Every click follows this pattern:
1. Move mouse to target
2. Wait 50ms (MOVE_SETTLE_MS)
3. Execute click

This ensures the OS and apps register the mouse position before the click event.

### Animated Movement Algorithm

```typescript
// Distance-proportional duration at 2000 px/sec, capped at 0.5s
const durationSec = Math.min(distance / 2000, 0.5);

// 60fps animation
const frameRate = 60;
const totalFrames = Math.floor(durationSec * frameRate);

// Ease-out-cubic for each frame
const eased = 1 - Math.pow(1 - t, 3);
```

This creates smooth, natural mouse movement that apps can detect during drag operations.

### Clipboard-Based Typing Flow

1. Save current clipboard → `pbpaste`
2. Write text to clipboard → `pbcopy` (via spawn, not exec)
3. Verify clipboard write
4. Paste via `Command+V`
5. Wait 100ms for paste to take effect
6. Restore original clipboard

This is more reliable than character-by-character typing for:
- Long text (>100 chars)
- Special characters
- Unicode text
- Code snippets

### Key Repeat Timing

```typescript
for (let i = 0; i < repeat; i++) {
  if (i > 0) {
    await sleep(8); // 8ms = 125Hz USB polling cadence
  }
  await pressAndRelease(keys);
}
```

Matches standard USB keyboard polling rate.

## 🆚 Comparison: Original vs Enhanced

| Feature | Original | Enhanced |
|---------|----------|----------|
| Click reliability | Basic | ✅ Move-and-settle |
| Mouse movement | Instant | ✅ Animated (optional) |
| Text input | Direct typing | ✅ + Clipboard mode |
| Key sequences | Manual modifiers | ✅ `"ctrl+c"` syntax |
| Drag support | ❌ | ✅ New tool |
| Scroll support | ❌ | ✅ New tool |
| Repeat timing | Basic delay | ✅ USB polling rate |

## 📦 Project Structure

```
computer-use-mcp-server/
├── src/
│   ├── index.ts              # Original implementation
│   ├── index-enhanced.ts     # 🆕 Enhanced fusion
│   ├── utils.ts              # Original utilities
│   ├── utils-enhanced.ts     # 🆕 Enhanced utilities
│   └── types.ts              # Shared types
├── dist/                     # Compiled JavaScript
├── package.json
└── tsconfig.json
```

## 🔧 Dependencies

- **@modelcontextprotocol/sdk** - MCP server framework
- **zod** - Schema validation
- **sharp** - Image resizing
- **cliclick** - Mouse/keyboard control (brew install cliclick)

## 🎓 Credits

**Inspired by:**
- Claude Code's internal `computer-use` implementation (`CC-Source/src/utils/computerUse/executor.ts`)
- Anthropic's computer-use best practices

**Implemented as:**
- Standalone MCP server (no internal dependencies)
- Standard macOS tools (cliclick, screencapture, pbcopy/pbpaste)
- TypeScript with full type safety

## 🤝 Contributing

This is a reference implementation. Feel free to:
- Add more tools (window management, app control)
- Optimize animation curves
- Add Linux/Windows support
- Report issues

## 📄 License

MIT

---

**Pro Tip:** Use `animated: true` for drag operations and `via_clipboard: true` for typing long text. These options make automation more reliable! 🎯
