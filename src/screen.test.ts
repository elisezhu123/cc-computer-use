import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { capture, zoomRegion } from './screen.js';
import type { DesktopHelper } from './desktopHelper.js';

const DISPLAY = {
  index: 1, name: 'x', isMain: true, displayId: 7,
  geometry: { logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 },
};
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#888' } }).png().toBuffer();

function shotRecorder() {
  const calls: unknown[][] = [];
  const helper = {
    shot: async (...a: unknown[]) => { calls.push(a); return png(1372, 887); },
  } as unknown as DesktopHelper;
  return { calls, helper };
}

test('capture asks the helper for the API target size and the settle window', async () => {
  const { calls, helper } = shotRecorder();
  const shot = await capture(DISPLAY, { settle: { minMs: 80, maxMs: 600 } }, helper);
  assert.deepEqual(calls, [[7, 1372, 887, 80, 600]]);
  assert.deepEqual(shot.dims, { targetWidth: 1372, targetHeight: 887 });
  assert.equal((await sharp(shot.data).metadata()).width, 1372);
});

test('capture without a settle window does not wait', async () => {
  const { calls, helper } = shotRecorder();
  await capture(DISPLAY, {}, helper);
  assert.deepEqual(calls[0]!.slice(3), [0, 0]);
});

test('zoomRegion falls back to cropping the screenshot when the helper has no frame', async () => {
  const helper = { zoom: async () => null } as unknown as DesktopHelper;
  const out = await zoomRegion(await png(1372, 887), [0, 0, 392, 222], helper);
  assert.deepEqual([out.width, out.height], [1568, 888]);
  assert.equal((await sharp(out.data).metadata()).width, 1568);
});

test('zoomRegion uses the helper frame when there is one', async () => {
  const calls: unknown[][] = [];
  const helper = {
    zoom: async (...a: unknown[]) => { calls.push(a); return png(1568, 888); },
  } as unknown as DesktopHelper;
  await zoomRegion(await png(1372, 887), [0, 0, 392, 222], helper);
  assert.deepEqual(calls, [[[0, 0, 392, 222], 1568, 888]]);
});

test('zoomRegion without a helper crops the screenshot, as the background modes rely on', async () => {
  const out = await zoomRegion(await png(1372, 887), [0, 0, 392, 222]);
  assert.deepEqual([out.width, out.height], [1568, 888]);
});
