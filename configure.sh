#!/bin/bash

# Auto-configuration script for Computer Use MCP Server
# This script adds the MCP server to Claude settings automatically

SETTINGS_FILE="$HOME/.claude/settings.json"
SERVER_PATH="/Users/elise123/Tools/Claude/computer-use-mcp-server/dist/index.js"

echo "🔧 Auto-configuring Computer Use MCP Server..."

# Check if settings file exists
if [ ! -f "$SETTINGS_FILE" ]; then
    echo "❌ Settings file not found at $SETTINGS_FILE"
    echo "Please create it first or run Claude Desktop at least once."
    exit 1
fi

# Backup existing settings
cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"
echo "💾 Backed up existing settings to $SETTINGS_FILE.backup"

# Check if mcpServers section exists
if grep -q '"mcpServers"' "$SETTINGS_FILE"; then
    echo "📝 Found existing mcpServers section"

    # Check if computer-use already exists
    if grep -q '"computer-use"' "$SETTINGS_FILE"; then
        echo "⚠️  computer-use server already configured"
        echo "To reconfigure, manually edit $SETTINGS_FILE"
        exit 0
    fi

    echo "Adding computer-use to existing mcpServers..."
    # This is complex - suggest manual edit
    echo "⚠️  Please manually add this to your mcpServers section:"
    echo ""
    echo '    "computer-use": {'
    echo '      "command": "node",'
    echo '      "args": ['
    echo "        \"$SERVER_PATH\""
    echo '      ]'
    echo '    }'
    echo ""
else
    echo "Creating new mcpServers section..."

    # Use jq to add mcpServers if available
    if command -v jq &> /dev/null; then
        jq ". + {\"mcpServers\": {\"computer-use\": {\"command\": \"node\", \"args\": [\"$SERVER_PATH\"]}}}" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp"
        mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
        echo "✅ Configuration added successfully!"
    else
        echo "⚠️  jq not found. Please manually add this to $SETTINGS_FILE:"
        echo ""
        echo '  "mcpServers": {'
        echo '    "computer-use": {'
        echo '      "command": "node",'
        echo '      "args": ['
        echo "        \"$SERVER_PATH\""
        echo '      ]'
        echo '    }'
        echo '  }'
        echo ""
    fi
fi

echo ""
echo "🎉 Next steps:"
echo "1. Restart Claude Desktop"
echo "2. Grant Accessibility permissions if prompted"
echo "3. Test with: 'Take a screenshot and save it to /tmp/test.png'"
