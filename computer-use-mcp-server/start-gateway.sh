#!/bin/bash
# Start the computer-use MCP server in HTTP gateway mode.
#
#   Streamable HTTP: http://127.0.0.1:$PORT/mcp
#   SSE (legacy):    http://127.0.0.1:$PORT/sse
#
# PORT defaults to 3100, HOST to 127.0.0.1. Do not set HOST to a public
# interface: the gateway has no authentication.

set -euo pipefail

export PORT="${PORT:-3100}"
export HOST="${HOST:-127.0.0.1}"

# This script lives in computer-use-mcp-server/; the project root is its parent.
cd "$(dirname "$0")/.."

if [ ! -f dist/http-server.js ]; then
  echo "Building TypeScript..." >&2
  npm run build >&2
fi

exec node dist/http-server.js
