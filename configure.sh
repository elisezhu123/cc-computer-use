#!/bin/bash
# Register this checkout's computer-use MCP server with Claude Code.
#
#   ./configure.sh            local scope (default): this project, only you
#   ./configure.sh user       available in every project

set -euo pipefail
cd "$(dirname "$0")"

SCOPE="${1:-local}"
SERVER_PATH="$(pwd)/dist/index.js"

if [ ! -f "$SERVER_PATH" ]; then
  echo "❌ $SERVER_PATH not found. Run ./setup.sh first." >&2
  exit 1
fi

if command -v claude &> /dev/null; then
  claude mcp add --scope "$SCOPE" computer-use -- node "$SERVER_PATH"
  echo "✅ Registered with Claude Code (scope: $SCOPE). Check with: claude mcp list"
else
  echo "Claude Code CLI not found. Add this to your MCP client configuration:"
  echo ""
  cat <<JSON
{
  "mcpServers": {
    "computer-use": {
      "command": "node",
      "args": ["$SERVER_PATH"]
    }
  }
}
JSON
  echo ""
  echo "Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json"
fi
