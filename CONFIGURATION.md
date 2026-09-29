# Computer Use MCP Server - Configuration Guide

## Quick Configuration

Add this to your `~/.claude/settings.json` file:

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

## Full Example Configuration

If you already have other MCP servers configured:

```json
{
  "mcpServers": {
    "ios-simulator": {
      "command": "node",
      "args": ["/Users/elise123/Tools/Claude/ios-simulator-mcp-server/dist/index.js"]
    },
    "computer-use": {
      "command": "node",
      "args": [
        "/Users/elise123/Tools/Claude/computer-use-mcp-server/dist/index.js"
      ]
    }
  }
}
```

## Test Examples

After restarting Claude Desktop, try these commands:

### 1. Get screen information
```
What's my screen resolution?
```

### 2. Take a screenshot
```
Take a screenshot and save it to /tmp/test.png
```

### 3. Automate mouse and keyboard
```
Move mouse to coordinates 500, 300 and click
```

```
Type "Hello World" and press Enter
```

### 4. Run AppleScript
```
Open Safari using AppleScript
```

## Troubleshooting

### Permission Issues

If you get permission errors, you need to grant accessibility permissions:

1. Open **System Settings** → **Privacy & Security** → **Accessibility**
2. Click the **+** button
3. Add **Claude.app** or **Terminal.app** (depending on where you run it)
4. Restart Claude Desktop

### cliclick Not Found

If mouse/keyboard control doesn't work:

```bash
brew install cliclick
```

### Screenshots Are Blank

macOS prevents capturing certain system dialogs for security. This is expected behavior.

## Development Mode

For development with auto-reload:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/Users/elise123/Tools/Claude/computer-use-mcp-server/src/index.ts"
      ]
    }
  }
}
```

This watches for file changes and automatically reloads the server.
