#!/usr/bin/env node
/**
 * Test computer-use MCP tools directly
 */

import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let buffer = '';

server.stdout.on('data', (data) => {
  buffer += data.toString();

  // Try to parse complete JSON-RPC messages
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Keep incomplete line

  for (const line of lines) {
    if (line.trim()) {
      try {
        const msg = JSON.parse(line);
        console.log('Response:', JSON.stringify(msg, null, 2));
      } catch (e) {
        console.log('Raw:', line);
      }
    }
  }
});

// Initialize
const initMsg = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' }
  }
};

console.log('Sending initialize...');
server.stdin.write(JSON.stringify(initMsg) + '\n');

setTimeout(() => {
  // Test computer_get_screen_info
  const testMsg = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'computer_get_screen_info',
      arguments: { response_format: 'json' }
    }
  };

  console.log('\nTesting computer_get_screen_info...');
  server.stdin.write(JSON.stringify(testMsg) + '\n');
}, 1000);

setTimeout(() => {
  // Test computer_press_key
  const testMsg2 = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'computer_press_key',
      arguments: { key: 'escape' }
    }
  };

  console.log('\nTesting computer_press_key...');
  server.stdin.write(JSON.stringify(testMsg2) + '\n');
}, 2000);

setTimeout(() => {
  server.kill();
  process.exit(0);
}, 3000);
