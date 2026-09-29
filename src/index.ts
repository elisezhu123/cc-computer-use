#!/usr/bin/env node
import { main } from './server.js';
import { PreflightError } from './display.js';

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const remedy = error instanceof PreflightError ? `\nHow to fix: ${error.remedy}` : '';
  process.stderr.write(`computer-use MCP server failed to start: ${message}${remedy}\n`);
  process.exit(1);
});
