---
name: computer-use
description: Use the computer-use MCP server to take screenshots, control mouse/keyboard, and automate desktop tasks on macOS
---

# Computer Use Skill

This skill enables computer automation through the computer-use MCP server.

## When to Use

Use this skill when the user asks to:
- Take screenshots
- Control the mouse (move, click, drag)
- Type text or press keyboard shortcuts
- Get screen information
- Automate desktop tasks
- Run AppleScript commands

## Available Tools

### `computer_screenshot`
Capture a screenshot of the screen.

**Parameters:**
- `output_path` (required): Where to save the screenshot
- `width` (optional): Resize width in pixels
- `height` (optional): Resize height in pixels

**Example:**
```typescript
{
  "output_path": "/tmp/screenshot.png",
  "width": 800
}
```

### `computer_get_screen_info`
Get screen resolution and display information.

**Returns:** width, height, and scale factor

### `computer_mouse_move`
Move mouse cursor to coordinates.

**Parameters:**
- `x` (required): X coordinate in pixels
- `y` (required): Y coordinate in pixels

### `computer_mouse_click`
Click the mouse.

**Parameters:**
- `x` (optional): X coordinate
- `y` (optional): Y coordinate
- `button` (optional): 'left', 'right', or 'middle'
- `double` (optional): true for double-click

### `computer_type_text`
Type text using keyboard.

**Parameters:**
- `text` (required): Text to type
- `delay` (optional): Milliseconds between keystrokes

### `computer_press_key`
Press a key with optional modifiers.

**Parameters:**
- `key` (required): Key name (e.g., 'return', 'tab', 'a', 'c')
- `modifiers` (optional): Array of 'command', 'control', 'option', 'shift'

**Common shortcuts:**
- Copy: `{ "key": "c", "modifiers": ["command"] }`
- Paste: `{ "key": "v", "modifiers": ["command"] }`
- Save: `{ "key": "s", "modifiers": ["command"] }`

### `computer_get_mouse_position`
Get current mouse cursor position.

### `computer_run_applescript`
Execute AppleScript for advanced automation.

**Parameters:**
- `script` (required): AppleScript code

**Example:**
```typescript
{
  "script": "tell application \"Safari\" to activate"
}
```

## Usage Patterns

### Taking Screenshots
Always save to `/tmp/` or user's chosen location. Optionally resize for efficiency.

### Mouse Control
1. Get screen info first if needed for coordinate calculations
2. Move mouse to position
3. Click or perform action

### Keyboard Input
1. For text: use `computer_type_text`
2. For shortcuts: use `computer_press_key` with modifiers
3. Common patterns: Cmd+C for copy, Cmd+V for paste

### AppleScript Automation
Use for application control, window management, or system tasks that cliclick can't handle.

## Best Practices

- Always check if cliclick is installed before mouse/keyboard operations
- Use `/tmp/` for temporary screenshots
- Get screen resolution before calculating click coordinates
- Test with read-only operations first (screenshot, get position)
- Handle permission errors gracefully

## Security Notes

- Requires Accessibility permissions in System Settings
- `computer_run_applescript` is marked destructive - use carefully
- All operations are logged for auditing

## Platform Support

**macOS only** - requires:
- `screencapture` (built-in)
- `cliclick` (install via `brew install cliclick`)
- `osascript` (built-in)
