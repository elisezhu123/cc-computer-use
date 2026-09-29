#!/usr/bin/env node
import { main } from './server.js';
main().catch((error) => {
    process.stderr.write(`computer-use MCP server failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map