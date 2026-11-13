import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { capture, zoomRegion, DisplayChangedError } from './screen.js';
import type { DesktopHelper } from './desktopHelper.js';

const DISPLAY = {
  index: 1, name: 'x', isMain: true, displayId: 7,
  geometry: { logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 },
};
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#888' } }).png().toBuffer();

const GEOMETRY = { originX: 0, originY: 0, logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 };

function shotRecorder(geometry = GEOMETRY) {
  const calls: unknown[][] = [];
  const helper = {
    shot: async (...a: unknown[]) => { calls.push(a); return { png: await png(1372, 887), frameId: 3, geometry }; },
  } as unknown as DesktopHelper;
  return { calls, helper };
}

test('capture refuses a frame whose display geometry no longer matches', async () => {
  // Same display ID, but it moved (lid closed, displays rearranged) or changed
  // resolution: every later click would be mapped with the old numbers.
  for (const changed of [{ ...GEOMETRY, originX: -1728 }, { ...GEOMETRY, logicalWidth: 1512 }, { ...GEOMETRY, scaleFactor: 1 }]) {
    const { helper } = shotRecorder(changed);
    await assert.rejects(capture(DISPLAY, {}, helper), DisplayChangedError);
  }
});

test('capture treats a vanished display as a display change', async () => {
  const helper = { shot: async () => { throw new Error('Desktop helper: no such display 7'); } } as unknown as DesktopHelper;
  await assert.rejects(capture(DISPLAY, {}, helper), DisplayChangedError);
});

test('capture falls back to screencapture for this call when the helper capture fails', async () => {
  const helper = { shot: async () => { throw new Error('Desktop helper: capture failed for display 7'); } } as unknown as DesktopHelper;
  const used: number[] = [];
  const shot = await capture(DISPLAY, {}, helper, async (index) => {
    used.push(index);
    return { data: await png(1372, 887), dims: { targetWidth: 1372, targetHeight: 887 } };
  });
  assert.deepEqual(used, [1]);
  assert.equal(shot.frameId, undefined, 'a screencapture frame is not one the helper can zoom');
});

test('capture asks the helper for the API target size and the settle window', async () => {
  const { calls, helper } = shotRecorder();
  const shot = await capture(DISPLAY, { settle: { minMs: 80, maxMs: 600 } }, helper);
  assert.deepEqual(calls, [[7, 1372, 887, 80, 600]]);
  assert.deepEqual(shot.dims, { targetWidth: 1372, targetHeight: 887 });
  assert.equal((await sharp(shot.data).metadata()).width, 1372);
  assert.equal(shot.frameId, 3);
});

test('capture without a settle window does not wait', async () => {
  const { calls, helper } = shotRecorder();
  await capture(DISPLAY, {}, helper);
  assert.deepEqual(calls[0]!.slice(3), [0, 0]);
});

test('zoomRegion falls back to cropping the screenshot when the helper has no frame', async () => {
  const helper = { zoom: async () => null } as unknown as DesktopHelper;
  const out = await zoomRegion(await png(1372, 887), [0, 0, 392, 222], helper, 3);
  assert.deepEqual([out.width, out.height], [1568, 888]);
  assert.equal((await sharp(out.data).metadata()).width, 1568);
});

test('zoomRegion uses the helper frame when there is one', async () => {
  const calls: unknown[][] = [];
  const helper = {
    zoom: async (...a: unknown[]) => { calls.push(a); return png(1568, 888); },
  } as unknown as DesktopHelper;
  await zoomRegion(await png(1372, 887), [0, 0, 392, 222], helper, 3);
  assert.deepEqual(calls, [[3, [0, 0, 392, 222], 1568, 888]]);
});

test('zoomRegion never asks the helper about a screenshot the helper did not take', async () => {
  const helper = { zoom: async () => { throw new Error('must not be called'); } } as unknown as DesktopHelper;
  const out = await zoomRegion(await png(1372, 887), [0, 0, 392, 222], helper, undefined);
  assert.equal(out.width, 1568);
});

test('zoomRegion without a helper crops the screenshot, as the background modes rely on', async () => {
  const out = await zoomRegion(await png(1372, 887), [0, 0, 392, 222]);
  assert.deepEqual([out.width, out.height], [1568, 888]);
});
