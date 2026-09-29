# Computer Use MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.6.1-green)](https://modelcontextprotocol.io/)
[![macOS](https://img.shields.io/badge/Platform-macOS-lightgrey)](https://www.apple.com/macos/)

**Complete computer automation for Claude Code** - Screenshot capture, mouse/keyboard control, and desktop automation via MCP (Model Context Protocol).

---

## ✨ Features

| Feature | Tools | Status |
|---------|-------|--------|
| 📸 **Screenshot** | `computer_screenshot` | ✅ With resize support |
| 🖱️ **Mouse Control** | `computer_mouse_move`, `computer_mouse_click` | ✅ Move, click, double-click |
| ⌨️ **Keyboard** | `computer_type_text`, `computer_press_key` | ✅ Text input + shortcuts |
| 📺 **Screen Info** | `computer_get_screen_info`, `computer_get_mouse_position` | ✅ Resolution + cursor |
| 🍎 **AppleScript** | `computer_run_applescript` | ✅ Advanced automation |

---

## 🚀 Quick Start

### 1. Install & Build

```bash
cd computer-use-mcp-server
npm install
npm run build

# Or use the setup script
./setup.sh
```

### 2. Configure Claude Desktop

Add to `~/.claude/settings.json`:

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

### 3. Grant Permissions

1. **System Settings** → **Privacy & Security** → **Accessibility**
2. Add **Claude.app**
3. Restart Claude Desktop

### 4. Test It

```
Take a screenshot and save it to /tmp/test.png
```

---

## 📖 Documentation

- [README.md](README.md) - Full documentation
- [CONFIGURATION.md](CONFIGURATION.md) - Setup guide
- [SUMMARY.md](SUMMARY.md) - 功能总结（中文）
- [PROJECT_STATUS.md](PROJECT_STATUS.md) - Implementation status

---

## 🎯 Example Usage

### Screenshot
```
Take a screenshot and save to /tmp/screen.png
```

### Mouse Control
```
Move mouse to 500, 300 and click
```

### Keyboard Input
```
Type "Hello World" and press Command+S
```

### AppleScript
```
Open Safari using AppleScript
```

---

## 🛠️ Technical Stack

- **Language**: TypeScript 5.7
- **Framework**: MCP SDK 1.6.1
- **Transport**: stdio
- **Platform**: macOS
- **Tools**: cliclick, screencapture, osascript

---

## 📦 Project Structure

```
computer-use-mcp-server/
├── src/
│   ├── index.ts          # Main server (8 MCP tools)
│   ├── types.ts          # Type definitions
│   └── utils.ts          # Helper functions
├── dist/                 # Compiled output
├── package.json          # Dependencies
├── setup.sh              # One-click setup
└── configure.sh          # Auto-configuration
```

---

## 🔐 Security

⚠️ **Important**: This server controls your mouse, keyboard, and can execute system commands.

- `computer_run_applescript` is marked as `destructiveHint: true`
- Requires Accessibility permissions
- All operations logged to stderr
- Use in trusted environments only

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| `cliclick not found` | `brew install cliclick` |
| Permission denied | Grant Accessibility permissions in System Settings |
| Screenshots blank | Normal for system dialogs (macOS security) |

---

## 🎉 Credits

Created based on:
- MCP SDK best practices
- `ios-simulator-mcp-server` code style
- Anthropic's computer use capabilities

---

## 📄 License

MIT

---

**Ready to use!** Just configure Claude Desktop and restart. 🚀
