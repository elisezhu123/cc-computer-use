#!/bin/bash
# Install prerequisites and build the computer-use MCP server.

set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname)" != "Darwin" ]; then
  echo "⚠️  This server drives macOS only (screencapture, cliclick, pbcopy)." >&2
fi

if command -v cliclick &> /dev/null; then
  echo "✅ cliclick: $(cliclick -V 2>&1 | head -1)"
elif command -v brew &> /dev/null; then
  echo "📦 Installing cliclick..."
  brew install cliclick
else
  echo "❌ cliclick not found and Homebrew is unavailable. Install cliclick, then re-run." >&2
  exit 1
fi

if ! command -v swiftc &> /dev/null; then
  echo "⚠️  swiftc not found. scroll and middle_click need it: xcode-select --install"
fi

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building..."
npm run build

echo ""
echo "✅ Build complete: $(pwd)/dist/index.js"
echo ""
echo "Next steps:"
echo "  1. Register the server:   ./configure.sh"
echo "     (or: claude mcp add computer-use -- node \"$(pwd)/dist/index.js\")"
echo "  2. System Settings > Privacy & Security: enable Screen Recording and"
echo "     Accessibility for the app that launches the server (Terminal / Claude)."
echo "  3. Verify:                node test-tools.mjs"
