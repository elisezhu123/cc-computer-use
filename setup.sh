#!/bin/bash

# Quick setup script for Computer Use MCP Server

echo "🚀 Setting up Computer Use MCP Server..."

# Check if cliclick is installed
if ! command -v cliclick &> /dev/null; then
    echo "⚠️  cliclick not found. Installing via Homebrew..."
    brew install cliclick
else
    echo "✅ cliclick is already installed"
fi

# Build the project
echo "📦 Building TypeScript project..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Add this configuration to ~/.claude/settings.json:"
    echo ""
    echo '  "mcpServers": {'
    echo '    "computer-use": {'
    echo '      "command": "node",'
    echo '      "args": ['
    echo "        \"$(pwd)/dist/index.js\""
    echo '      ]'
    echo '    }'
    echo '  }'
    echo ""
    echo "2. Restart Claude Desktop"
    echo "3. Test with: 'Take a screenshot and save it to /tmp/test.png'"
else
    echo "❌ Build failed"
    exit 1
fi
