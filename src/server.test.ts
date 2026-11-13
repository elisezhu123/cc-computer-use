import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from './server.js';
import { MAIN, LEFT, png, testContext } from './testSupport.js';

const frame = async (geometry = MAIN) => ({
  png: await png(1372, 887),
  frameId: 1,
  geometry: {
    originX: geometry.originX, originY: geometry.originY,
    logicalWidth: geometry.logicalWidth, logicalHeight: geometry.logicalHeight, scaleFactor: geometry.scaleFactor,
  },
});

const textOf = (r: { content: { type: string; text?: string }[] }) =>
  r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

test('screenshot goes through the helper at the API target size', async () => {
  const calls: unknown[][] = [];
  const ctx = testContext({ shot: async (...a) => { calls.push(a); return frame(); } });
  const r = await dispatch(ctx, 'screenshot', {});
  assert.equal(r.isError, undefined);
  assert.deepEqual(calls, [[1, 1372, 887, 0, 0]]);
  assert.deepEqual(ctx.lastScreenshot?.dims, { targetWidth: 1372, targetHeight: 887 });
});

test('a display that disappeared drops the stale geometry and screenshot basis', async () => {
  const ctx = testContext(
    {
      shot: async () => { throw new Error('Desktop helper: no such display 5'); },
      displays: async () => [MAIN],
    },
    [MAIN, LEFT],
  );
  ctx.activeDisplayIndex = 2;
  ctx.lastScreenshot = { png: await png(10, 10), dims: { targetWidth: 1456, targetHeight: 819 } };

  const r = await dispatch(ctx, 'screenshot', {});

  assert.equal(r.isError, true);
  assert.match(textOf(r), /display configuration changed/i);
  assert.equal(ctx.displays.length, 1);
  assert.equal(ctx.activeDisplayIndex, 1);
  assert.equal(ctx.lastScreenshot, null);
});

test('zoom after the helper lost its frame still returns an image', async () => {
  const ctx = testContext({ shot: async () => frame(), zoom: async () => null });
  await dispatch(ctx, 'screenshot', {});
  const r = await dispatch(ctx, 'zoom', { region: [0, 0, 392, 222] });
  assert.equal(r.isError, undefined);
  assert.ok(r.content.some((c) => c.type === 'image'));
});

test('after a display change, coordinates are refused until a new screenshot', async () => {
  let gone = true;
  const sent: string[] = [];
  const ctx = testContext({
    shot: async () => { if (gone) throw new Error('Desktop helper: no such display 1'); return frame(); },
    displays: async () => [MAIN],
    hit: async () => ({ at: null, nearby: [] }),
    click: async (...a) => { sent.push(a.join(' ')); },
  });
  ctx.lastScreenshot = { png: await png(10, 10), dims: { targetWidth: 1372, targetHeight: 887 } };
  await dispatch(ctx, 'screenshot', {});

  const refused = await dispatch(ctx, 'left_click', { coordinate: [100, 100] });
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /screenshot/i);
  assert.deepEqual(sent, [], 'no click with coordinates from the old screenshot');

  gone = false;
  await dispatch(ctx, 'screenshot', {});
  assert.equal((await dispatch(ctx, 'left_click', { coordinate: [100, 100] })).isError, undefined);
  assert.equal(sent.length, 1);
});

test('an action whose automatic screenshot hits a display change says so', async () => {
  const ctx = testContext({
    shot: async () => { throw new Error('Desktop helper: no such display 1'); },
    displays: async () => [MAIN],
    hit: async () => ({ at: null, nearby: [] }),
    click: async () => {},
  });
  ctx.autoScreenshot = true;
  ctx.lastScreenshot = { png: await png(10, 10), dims: { targetWidth: 1372, targetHeight: 887 } };

  const r = await dispatch(ctx, 'left_click', { coordinate: [100, 100] });

  assert.equal(r.isError, undefined, 'the click itself happened');
  assert.match(textOf(r), /display configuration changed/i);
});

test('computer_batch refuses an ungranted frontmost app before any lookup or click', async () => {
  const sent: string[] = [];
  const ctx = testContext({
    hit: async () => { sent.push('hit'); return { at: null, nearby: [] }; },
    click: async () => { sent.push('click'); },
  });
  ctx.lastScreenshot = { png: await png(10, 10), dims: { targetWidth: 1372, targetHeight: 887 } };
  ctx.frontmost = async () => 'com.apple.Safari';
  const r = await dispatch(ctx, 'computer_batch', { actions: [{ action: 'left_click', coordinate: [5, 5] }] });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /not_granted|not in this session/);
  assert.deepEqual(sent, []);
});
