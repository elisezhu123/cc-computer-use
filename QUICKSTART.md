# Quick Start Guide

## Installation (3 steps)

### Step 1: Build
```bash
cd computer-use-mcp-server
./setup.sh
```

### Step 2: Configure
Edit `~/.claude/settings.json` and add:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "node",
      "args": [
        "/Users/elise123/Tools/Claude/computer-use-mcp-server/dist/index.js"
      ]
    }
  }
}
```

### Step 3: Enable Permissions
1. System Settings → Privacy & Security → Accessibility
2. Add Claude.app
3. Restart Claude Desktop

## Test Commands

Try these in Claude:

```
取个屏幕截图保存到 /tmp/test.png
```

```
我的屏幕分辨率是多少？
```

```
移动鼠标到坐标 (500, 300) 并点击
```

```
输入文本 "Hello World" 然后按回车
```

```
打开 Safari 应用
```

## All 8 Tools

1. `computer_screenshot` - 截屏
2. `computer_get_screen_info` - 屏幕信息
3. `computer_mouse_move` - 移动鼠标
4. `computer_mouse_click` - 点击
5. `computer_type_text` - 输入文本
6. `computer_press_key` - 按键
7. `computer_get_mouse_position` - 鼠标位置
8. `computer_run_applescript` - AppleScript

## Troubleshooting

### cliclick not found
```bash
brew install cliclick
```

### Permission denied
Grant Accessibility permissions in System Settings

### Need more help?
See [README.md](README.md) for full documentation
