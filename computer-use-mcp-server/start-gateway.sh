#!/bin/bash

# Computer Use MCP Server - Gateway Mode Startup Script
# This script starts the HTTP server for Claude Code Gateway integration

PORT=${PORT:-3100}

echo "Starting Computer Use MCP Server in Gateway mode..." >&2
echo "Port: $PORT" >&2

cd "$(dirname "$0")"

# Build if needed
if [ ! -d "dist" ]; then
  echo "Building TypeScript..." >&2
  npm run build
fi

# Start the HTTP server
export PORT
exec node dist/http-server.js
