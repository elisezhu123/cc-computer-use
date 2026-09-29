#!/usr/bin/env node
/**
 * Test script for Computer Use MCP Server
 * Run with: node test.js
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const SERVER_PATH = './dist/index.js';

console.log('🧪 Testing Computer Use MCP Server...\n');

const server = spawn('node', [SERVER_PATH]);

let buffer = '';

server.stdout.on('data', (data) => {
  buffer += data.toString();
  try {
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        console.log('📥 Received:', line);
      }
    }
  } catch (err) {
    console.error('Error parsing:', err);
  }
});

server.stderr.on('data', (data) => {
  console.log('📝 Server:', data.toString().trim());
});

// Wait for server to start
setTimeout(() => {
  console.log('\n✅ Server started successfully!');
  console.log('🔧 Available tools should include:');
  console.log('  - computer_screenshot');
  console.log('  - computer_get_screen_info');
  console.log('  - computer_mouse_move');
  console.log('  - computer_mouse_click');
  console.log('  - computer_type_text');
  console.log('  - computer_press_key');
  console.log('  - computer_get_mouse_position');
  console.log('  - computer_run_applescript');

  server.kill();
  process.exit(0);
}, 2000);

server.on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});
