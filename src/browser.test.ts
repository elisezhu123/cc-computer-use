import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowserChord, toBrowserKey } from './browserKeys.js';
import { buildBrowserTools, configFromEnv } from './browser-server.js';

test('toBrowserKey maps the model vocabulary onto Playwright key names', () => {
  assert.equal(toBrowserKey('return'), 'Enter');
  assert.equal(toBrowserKey('Escape'), 'Escape');
  assert.equal(toBrowserKey('backspace'), 'Backspace');
  assert.equal(toBrowserKey('Down'), 'ArrowDown');
  assert.equal(toBrowserKey('arrowleft'), 'ArrowLeft');
  assert.equal(toBrowserKey('Page_Down'), 'PageDown');
  assert.equal(toBrowserKey('space'), ' ');
  assert.equal(toBrowserKey('f5'), 'F5');
  assert.equal(toBrowserKey('A'), 'A', 'single characters keep their case');
});

test('parseBrowserChord splits modifiers from keys', () => {
  assert.deepEqual(parseBrowserChord('cmd+a'), { modifiers: ['Meta'], keys: ['a'] });
  assert.deepEqual(parseBrowserChord('ctrl+shift+tab'), { modifiers: ['Control', 'Shift'], keys: ['Tab'] });
  assert.deepEqual(parseBrowserChord('option+command+Left'), { modifiers: ['Alt', 'Meta'], keys: ['ArrowLeft'] });
  assert.deepEqual(parseBrowserChord('shift'), { modifiers: ['Shift'], keys: [] });
  assert.throws(() => parseBrowserChord(' + '));
});

test('browser tools drop desktop-only tools and the frontmost-app gate text', () => {
  const tools = buildBrowserTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('navigate'));
  assert.ok(names.includes('computer_batch'));
  for (const desktopOnly of ['request_access', 'open_application', 'switch_display', 'read_clipboard']) {
    assert.ok(!names.includes(desktopOnly), `${desktopOnly} must not be offered in browser mode`);
  }
  for (const t of tools) assert.doesNotMatch(t.description ?? '', /allowlist/, t.name);
});

test('configFromEnv parses the browser settings', () => {
  const c = configFromEnv({ CU_BROWSER_VIEWPORT: '1440x900', CU_BROWSER_HEADLESS: '1', CU_BROWSER_PATH: '/x/chrome' });
  assert.deepEqual(c.viewport, { width: 1440, height: 900 });
  assert.equal(c.headless, true);
  assert.equal(c.executablePath, '/x/chrome');
  const d = configFromEnv({});
  assert.deepEqual(d.viewport, { width: 1280, height: 800 });
  assert.equal(d.headless, false);
  assert.equal(d.executablePath, undefined);
});
