#!/usr/bin/env node
import { main } from './browser-server.js';

main().catch((error: unknown) => {
  process.stderr.write(
    `computer-use MCP server (browser mode) failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
