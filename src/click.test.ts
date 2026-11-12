import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, resolveClick } from './server.js';
import type { DesktopHelper } from './desktopHelper.js';
import type { HitResult } from './snap.js';
import { MAIN, LEFT, testContext } from './testSupport.js';

const APP = 'com.apple.TextEdit';
const TOOLBAR = { role: 'AXToolbar', label: '', frame: { x: 0, y: 30, w: 800, h: 30 }, bundleId: APP };
const BUTTON = { role: 'AXButton', label: 'Device', frame: { x: 100, y: 34, w: 20, h: 20 }, bundleId: APP };
const DIMS = { targetWidth: 1372, targetHeight: 887 };

/** A helper that records what it is asked to do. */
function fake(hit: HitResult) {
  const sent: string[] = [];
  const helper: Partial<DesktopHelper> = {
    hit: async (x, y, r) => { sent.push(`hit ${x} ${y} ${r.toFixed(2)}`); return hit; },
    click: async (...a) => { sent.push(`click ${a.join(' ')}`); },
    move: async (x, y) => { sent.push(`move ${x} ${y}`); },
    drag: async (from, to) => { sent.push(`drag ${from.x} ${from.y} ${to.x} ${to.y}`); },
    cursor: async () => ({ x: 7, y: 9 }),
  };
  return { helper, sent };
}

function ctxFor(helper: Partial<DesktopHelper> | null, displays = [MAIN]) {
  const ctx = testContext(helper ?? {}, displays);
  if (helper === null) ctx.helper = null;
  ctx.lastScreenshot = { png: Buffer.alloc(0), dims: DIMS };
  return ctx;
}

const textOf = (r: { content: { type: string; text?: string }[] }) =>
  r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

test('resolveClick reports the control under the point', async () => {
  const { helper } = fake({ at: BUTTON, nearby: [] });
  const ctx = ctxFor(helper);
  const r = await resolveClick(ctx, [87, 35], ctx.helper!, APP); // logical (110, 44)
  assert.deepEqual(r.point, { x: 110, y: 44 });
  assert.equal(r.note, 'Hit: AXButton "Device".');
  assert.equal(r.snappedTo, null);
});

test('resolveClick snaps out of a gap and says where', async () => {
  const { helper, sent } = fake({ at: TOOLBAR, nearby: [BUTTON] });
  const ctx = ctxFor(helper);
  const r = await resolveClick(ctx, [99, 35], ctx.helper!, APP); // logical (125, 44)
  assert.deepEqual(r.point, { x: 118, y: 44 });
  assert.equal(r.note, 'snapped to nearest control AXButton "Device".');
  assert.deepEqual(r.snappedTo, { x: 94, y: 35 });
  assert.equal(sent[0], 'hit 125 44 7.56'); // 6 screenshot px * 1728/1372
});

test('resolveClick with no helper, or an empty lookup, leaves the point alone', async () => {
  const none = ctxFor(null);
  assert.deepEqual(await resolveClick(none, [99, 35], null, APP), { point: { x: 125, y: 44 }, note: '', snappedTo: null });
  const { helper } = fake({ at: null, nearby: [] });
  const ctx = ctxFor(helper);
  assert.deepEqual(await resolveClick(ctx, [99, 35], ctx.helper!, APP), { point: { x: 125, y: 44 }, note: '', snappedTo: null });
});

test('CU_CLICK_SNAP=0 reports but does not move the point', async () => {
  const { helper } = fake({ at: TOOLBAR, nearby: [BUTTON] });
  const ctx = ctxFor(helper);
  process.env.CU_CLICK_SNAP = '0';
  try {
    const r = await resolveClick(ctx, [99, 35], ctx.helper!, APP);
    assert.deepEqual(r.point, { x: 125, y: 44 });
    assert.equal(r.note, 'Hit: AXToolbar.');
  } finally {
    delete process.env.CU_CLICK_SNAP;
  }
});

test('resolveClick never snaps onto an app that is not frontmost', async () => {
  const { helper } = fake({ at: TOOLBAR, nearby: [BUTTON] });
  const ctx = ctxFor(helper);
  const r = await resolveClick(ctx, [99, 35], ctx.helper!, 'com.apple.Safari');
  assert.deepEqual(r.point, { x: 125, y: 44 });
});

test('left_click clicks the snapped point and reports it', async () => {
  const { helper, sent } = fake({ at: TOOLBAR, nearby: [BUTTON] });
  const r = await dispatch(ctxFor(helper), 'left_click', { coordinate: [99, 35] });
  assert.equal(r.isError, undefined, textOf(r));
  assert.equal(sent.at(-1), 'click 0 118 44 1 0');
  assert.equal(
    textOf(r),
    'Clicked left at screenshot (99, 35): snapped to (94, 35), nearest control AXButton "Device".',
  );
});

test('left_click on a control reports the hit and keeps the point', async () => {
  const { helper, sent } = fake({ at: BUTTON, nearby: [] });
  const r = await dispatch(ctxFor(helper), 'left_click', { coordinate: [87, 35] });
  assert.equal(sent.at(-1), 'click 0 110 44 1 0');
  assert.equal(textOf(r), 'Clicked left at screenshot (87, 35) = logical (110, 44). Hit: AXButton "Device".');
});

test('a failed lookup still clicks, without element information', async () => {
  const { helper, sent } = fake({ at: null, nearby: [] });
  const r = await dispatch(ctxFor(helper), 'left_click', { coordinate: [87, 35] });
  assert.equal(sent.at(-1), 'click 0 110 44 1 0');
  assert.equal(textOf(r), 'Clicked left at screenshot (87, 35) = logical (110, 44).');
});

test('modifiers, button and count reach the helper', async () => {
  const { helper, sent } = fake({ at: BUTTON, nearby: [] });
  const ctx = ctxFor(helper);
  await dispatch(ctx, 'right_click', { coordinate: [87, 35] });
  await dispatch(ctx, 'double_click', { coordinate: [87, 35] });
  await dispatch(ctx, 'middle_click', { coordinate: [87, 35] });
  await dispatch(ctx, 'left_click', { coordinate: [87, 35], text: 'cmd+shift' });
  assert.deepEqual(sent.filter((l) => l.startsWith('click')), [
    'click 1 110 44 1 0',
    'click 0 110 44 2 0',
    'click 2 110 44 1 0',
    `click 0 110 44 1 ${0x100000 | 0x20000}`,
  ]);
});

test('a click on a secondary display lands on that display', async () => {
  const { helper, sent } = fake({ at: null, nearby: [] });
  const ctx = ctxFor(helper, [MAIN, LEFT]);
  ctx.activeDisplayIndex = 2;
  ctx.lastScreenshot = { png: Buffer.alloc(0), dims: { targetWidth: 1456, targetHeight: 819 } };
  await dispatch(ctx, 'left_click', { coordinate: [728, 410] });
  assert.equal(sent.at(-1), 'click 0 -125 -539 1 0');
});

test('computer_batch clicks resolve through the same path', async () => {
  const { helper, sent } = fake({ at: TOOLBAR, nearby: [BUTTON] });
  const r = await dispatch(ctxFor(helper), 'computer_batch', {
    actions: [{ action: 'left_click', coordinate: [99, 35] }, { action: 'mouse_move', coordinate: [87, 35] }],
  });
  assert.equal(r.isError, undefined, textOf(r));
  assert.deepEqual(sent.filter((l) => !l.startsWith('hit')), ['click 0 118 44 1 0', 'move 110 44']);
  assert.match(textOf(r), /1\. left_click at \(99, 35\): snapped to \(94, 35\), nearest control AXButton "Device"\./);
});

test('mouse_move and drag go through the helper and never snap', async () => {
  const { helper, sent } = fake({ at: TOOLBAR, nearby: [BUTTON] });
  const ctx = ctxFor(helper);
  await dispatch(ctx, 'mouse_move', { coordinate: [99, 35] });
  await dispatch(ctx, 'left_click_drag', { coordinate: [99, 35], start_coordinate: [87, 35] });
  await dispatch(ctx, 'left_click_drag', { coordinate: [99, 35] });
  assert.deepEqual(sent, ['move 125 44', 'drag 110 44 125 44', 'drag 7 9 125 44']);
});

test('an app that is not granted is refused before any lookup or click', async () => {
  const { helper, sent } = fake({ at: BUTTON, nearby: [] });
  const ctx = ctxFor(helper);
  ctx.frontmost = async () => 'com.apple.Safari';
  const r = await dispatch(ctx, 'left_click', { coordinate: [87, 35] });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /^not_granted/);
  assert.deepEqual(sent, []);
});
