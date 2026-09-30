#!/usr/bin/env node
import { main } from './background-server.js';

main().catch((error: unknown) => {
  process.stderr.write(
    `computer-use MCP server (background mode) failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
