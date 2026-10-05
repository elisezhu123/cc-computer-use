import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { FLAG_COMMAND, FLAG_SHIFT, nativeKeyFor, parseNativeChord } from './nativeKeys.js';
import { BackgroundSession, buildBackgroundTools, type HelperLike } from './background-server.js';

test('nativeKeyFor maps names and characters to ANSI key codes', () => {
  assert.deepEqual(nativeKeyFor('return'), { code: 36, flags: 0 });
  assert.deepEqual(nativeKeyFor('Down'), { code: 125, flags: 0 });
  assert.deepEqual(nativeKeyFor('Page_Down'), { code: 121, flags: 0 });
  assert.deepEqual(nativeKeyFor('a'), { code: 0, flags: 0 });
  assert.deepEqual(nativeKeyFor('A'), { code: 0, flags: FLAG_SHIFT });
  assert.deepEqual(nativeKeyFor('?'), { code: 44, flags: FLAG_SHIFT });
  assert.equal(nativeKeyFor('你'), null, 'no key code: typed as Unicode instead');
});

test('parseNativeChord combines modifier flags', () => {
  assert.deepEqual(parseNativeChord('cmd+shift+z'), { flags: FLAG_COMMAND | FLAG_SHIFT, keys: [{ code: 6, flags: 0 }] });
  assert.throws(() => parseNativeChord('cmd+你'), /type tool/);
});

/** Records every helper request and answers like background.swift would. */
class FakeHelper implements HelperLike {
  lines: string[] = [];
  running = new Map<string, number>([['com.apple.TextEdit', 4242]]);
  async request(line: string): Promise<string> {
    this.lines.push(line);
    const [verb, arg] = line.split(' ');
    if (verb === 'pid') {
      const pid = this.running.get(arg!);
      if (!pid) throw new Error('not running');
      return String(pid);
    }
    if (verb === 'window') return '77 100 50 800 600';
    return '';
  }
  close() {}
}

const INSTALLED = [
  { bundleId: 'com.apple.TextEdit', displayName: 'TextEdit', path: '/Applications/TextEdit.app' },
  { bundleId: 'com.apple.Notes', displayName: 'Notes', path: '/Applications/Notes.app' },
];

async function fakeWindowPng(): Promise<Buffer> {
  // A Retina window capture is twice its point size.
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#fff' } }).png().toBuffer();
}

async function session() {
  const helper = new FakeHelper();
  const launched: string[] = [];
  const s = new BackgroundSession(helper, INSTALLED, fakeWindowPng, async (id) => {
    launched.push(id);
    helper.running.set(id, 5151);
  });
  s.autoScreenshot = false;
  return { s, helper, launched };
}

const txt = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? '').join(' ');

test('background mode refuses everything before request_access and open_application', async () => {
  const { s } = await session();
  assert.match(txt(await s.dispatchAll('screenshot', {})), /needs_access/);
  await s.dispatchAll('request_access', { apps: ['TextEdit'], reason: 't' });
  assert.match(txt(await s.dispatchAll('left_click', { coordinate: [1, 1] })), /open_application/);
  assert.match(txt(await s.dispatchAll('open_application', { app: 'Notes' })), /not_granted/);
});

test('open_application targets a running app, or launches it hidden', async () => {
  const { s, launched } = await session();
  await s.dispatchAll('request_access', { apps: ['TextEdit', 'Notes'], reason: 't' });
  assert.match(txt(await s.dispatchAll('open_application', { app: 'TextEdit' })), /pid 4242/);
  assert.deepEqual(launched, []);
  assert.match(txt(await s.dispatchAll('open_application', { app: 'Notes' })), /pid 5151/);
  assert.deepEqual(launched, ['com.apple.Notes']);
});

test('input is posted to the target pid at window-relative global points', async () => {
  const { s, helper } = await session();
  await s.dispatchAll('request_access', { apps: ['TextEdit'], reason: 't' });
  await s.dispatchAll('open_application', { app: 'TextEdit' });
  const shot = await s.dispatchAll('screenshot', {});
  assert.match(txt(shot), /^\d+x\d+ pixels of the com.apple.TextEdit window/);
  const { targetWidth } = s.lastScreenshot!.dims;
  const k = 800 / targetWidth; // screenshot pixels -> window points

  helper.lines = [];
  await s.dispatchAll('left_click', { coordinate: [Math.round(400 / k), Math.round(300 / k)], text: 'cmd' });
  assert.deepEqual(helper.lines.filter((l) => l.startsWith('click')), [`click 4242 0 500 350 1 ${FLAG_COMMAND}`]);

  helper.lines = [];
  await s.dispatchAll('double_click', { coordinate: [0, 0] });
  assert.deepEqual(helper.lines.filter((l) => l.startsWith('click')), ['click 4242 0 100 50 2 0']);

  helper.lines = [];
  await s.dispatchAll('right_click', { coordinate: [0, 0] });
  assert.deepEqual(helper.lines.filter((l) => l.startsWith('click')), ['click 4242 1 100 50 1 0']);

  helper.lines = [];
  await s.dispatchAll('type', { text: '你好\nok' });
  assert.deepEqual(helper.lines, [
    `text 4242 ${Buffer.from('你好').toString('base64')}`,
    'key 4242 36 1 0', 'key 4242 36 0 0',
    `text 4242 ${Buffer.from('ok').toString('base64')}`,
  ]);

  helper.lines = [];
  await s.dispatchAll('key', { text: 'cmd+s' });
  assert.deepEqual(helper.lines, [`key 4242 1 1 ${FLAG_COMMAND}`, `key 4242 1 0 ${FLAG_COMMAND}`]);

  helper.lines = [];
  await s.dispatchAll('scroll', { coordinate: [0, 0], scroll_direction: 'down', scroll_amount: 2 });
  assert.deepEqual(helper.lines.filter((l) => l.startsWith('scroll')), ['scroll 4242 100 50 0 40', 'scroll 4242 100 50 0 40']);

  helper.lines = [];
  await s.dispatchAll('left_click_drag', { start_coordinate: [0, 0], coordinate: [Math.round(100 / k), 0] });
  const drag = helper.lines.filter((l) => l.startsWith('mouse'));
  assert.equal(drag[0], 'mouse 4242 down 0 100 50 1 0');
  assert.equal(drag.at(-1), 'mouse 4242 up 0 200 50 1 0');
});

test('the system-key blocklist and strict tiers apply to the target app', async () => {
  const { s, helper } = await session();
  await s.dispatchAll('request_access', { apps: ['TextEdit'], reason: 't' });
  await s.dispatchAll('open_application', { app: 'TextEdit' });
  helper.lines = [];
  assert.match(txt(await s.dispatchAll('key', { text: 'cmd+q' })), /needs_flag/);
  assert.deepEqual(helper.lines, [], 'nothing is sent when refused');
});

test('background tools offer the app tools and drop desktop-only ones', () => {
  const names = buildBackgroundTools().map((t) => t.name);
  for (const n of ['request_access', 'open_application', 'screenshot', 'computer_batch']) assert.ok(names.includes(n), n);
  for (const n of ['switch_display', 'read_clipboard', 'navigate']) assert.ok(!names.includes(n), n);
});

test('with auto screenshots, actions return the new window state', async () => {
  const { s } = await session();
  s.autoScreenshot = true;
  s.autoScreenshotSettleMs = 0;
  await s.dispatchAll('request_access', { apps: ['TextEdit'], reason: 't' });
  const opened = await s.dispatchAll('open_application', { app: 'TextEdit' });
  assert.ok(opened.content.some((c) => c.type === 'image'), 'open_application shows the target');

  const clicked = await s.dispatchAll('left_click', { coordinate: [10, 10] });
  assert.match(txt(clicked), /Screenshot after the action: \d+x\d+ pixels/);
  assert.equal(clicked.content.filter((c) => c.type === 'image').length, 1);

  const moved = await s.dispatchAll('mouse_move', { coordinate: [10, 10] });
  assert.ok(!moved.content.some((c) => c.type === 'image'), 'moving alone changes nothing on screen');

  const batch = await s.dispatchAll('computer_batch', { actions: [{ action: 'key', text: 'a' }, { action: 'screenshot' }] });
  assert.equal(batch.content.filter((c) => c.type === 'image').length, 1, 'a trailing screenshot is not repeated');
  assert.doesNotMatch(txt(batch), /Screenshot after the action/);

  const refused = await s.dispatchAll('key', { text: 'cmd+q' });
  assert.ok(refused.isError && !refused.content.some((c) => c.type === 'image'), 'errors carry no screenshot');
});
