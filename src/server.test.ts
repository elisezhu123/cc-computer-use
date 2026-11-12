import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { dispatch, type ServerContext } from './server.js';
import { newSession } from './policy.js';
import type { DesktopHelper, HelperDisplay } from './desktopHelper.js';
import { displaysFromHelper } from './display.js';

const MAIN: HelperDisplay = {
  id: 1, name: 'Built-in', isMain: true, originX: 0, originY: 0,
  logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2,
};
const LEFT: HelperDisplay = {
  id: 5, name: 'LG', isMain: false, originX: -1085, originY: -1080,
  logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 2,
};
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#888' } }).png().toBuffer();

export function testContext(helper: Partial<DesktopHelper>, displays = [MAIN]): ServerContext {
  const session = newSession();
  session.allowedBundleIds = new Set(['com.apple.TextEdit']);
  return {
    displays: displaysFromHelper(displays),
    activeDisplayIndex: 1,
    session,
    lastScreenshot: null,
    installed: [],
    installedNames: [],
    autoScreenshot: false,
    helper: helper as DesktopHelper,
  };
}

const textOf = (r: { content: { type: string; text?: string }[] }) =>
  r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

test('screenshot goes through the helper at the API target size', async () => {
  const calls: unknown[][] = [];
  const ctx = testContext({ shot: async (...a) => { calls.push(a); return png(1372, 887); } });
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
  const ctx = testContext({ shot: async () => png(1372, 887), zoom: async () => null });
  await dispatch(ctx, 'screenshot', {});
  const r = await dispatch(ctx, 'zoom', { region: [0, 0, 392, 222] });
  assert.equal(r.isError, undefined);
  assert.ok(r.content.some((c) => c.type === 'image'));
});
