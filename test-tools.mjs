#!/usr/bin/env node
/**
 * Smoke test against the built server over stdio: start it, list the tools,
 * and call list_granted_applications (which has no side effects).
 *
 * Needs macOS with Screen Recording and Accessibility granted to the app
 * running this script - the server refuses to start otherwise and prints
 * which permission is missing.
 *
 *   npm run build && node test-tools.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  stderr: 'inherit',
});
const client = new Client({ name: 'computer-use-smoke-test', version: '1.0.0' });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`✅ ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);

  const result = await client.callTool({ name: 'list_granted_applications', arguments: {} });
  console.log('✅ list_granted_applications:');
  console.log(result.content.map((c) => c.text).join('\n'));
} catch (e) {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
