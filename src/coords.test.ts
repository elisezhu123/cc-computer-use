import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelToLogical, logicalToModel, physicalSize, clampRegion } from './coords.js';
import { targetImageSize, API_RESIZE_PARAMS } from './imageResize.js';

// This machine: 16" M1 Max built-in display.
// physical 3456x2234, logical 1728x1117.
const BUILTIN = { logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 };

test('targetImageSize: the 14" MBP long-edge trap (1568x1014)', () => {
  // 1568x1014 is 56x37 = 2072 tokens, over the 1568 budget. The long-edge
  // rule alone would keep 1568 and the server would resize again to 1372x887,
  // putting the model 14% off. Both constraints must hold.
  const [w, h] = targetImageSize(1568, 1014);
  assert.notEqual(w, 1568, 'must not keep a width that overflows the token budget');
  assert.ok(w <= API_RESIZE_PARAMS.maxTargetPx);
  const tiles = Math.ceil(w / 28) * Math.ceil(h / 28);
  assert.ok(tiles <= API_RESIZE_PARAMS.maxTargetTokens, `tokens ${tiles} over budget`);
});

test('targetImageSize: this machine 3024x1964 physical -> 1372x891', () => {
  const [w, h] = targetImageSize(3024, 1964);
  assert.equal(w, 1372);
  assert.equal(h, 891);
  assert.ok(Math.ceil(w / 28) * Math.ceil(h / 28) <= 1568);
});

test('targetImageSize: actual built-in physical 3456x2234', () => {
  const [w, h] = targetImageSize(3456, 2234);
  const tiles = Math.ceil(w / 28) * Math.ceil(h / 28);
  assert.ok(tiles <= API_RESIZE_PARAMS.maxTargetTokens, `tokens ${tiles}`);
  assert.ok(w <= 1568 && h <= 1568);
  // aspect ratio preserved within a pixel
  assert.ok(Math.abs(w / h - 3456 / 2234) < 0.01);
});

test('targetImageSize: already-small image is untouched', () => {
  assert.deepEqual(targetImageSize(800, 600), [800, 600]);
});

test('targetImageSize: portrait input is transposed back correctly', () => {
  const [w, h] = targetImageSize(1200, 4000);
  assert.ok(h > w, 'portrait stays portrait');
  assert.ok(h <= 1568);
});

// The regression this whole module exists for: the mapping is
// logical/target, NOT 1/scaleFactor.
test('modelToLogical: 1/scaleFactor would be wrong by ~60% on this display', () => {
  const dims = { targetWidth: 1372, targetHeight: 888 };
  const bottomRight = modelToLogical(1372, 888, dims, BUILTIN);

  // Correct: the full target image maps to the full logical display.
  assert.equal(bottomRight.x, 1728);
  assert.equal(bottomRight.y, 1117);

  // The buggy formula (x / scaleFactor) would have produced these:
  assert.notEqual(bottomRight.x, 686, 'must not divide by scaleFactor');
  const buggy = Math.round(1372 / BUILTIN.scaleFactor);
  assert.ok(Math.abs(buggy - bottomRight.x) / bottomRight.x > 0.5, 'the two differ by >50%');
});

test('modelToLogical: origin maps to origin', () => {
  const dims = { targetWidth: 1372, targetHeight: 888 };
  assert.deepEqual(modelToLogical(0, 0, dims, BUILTIN), { x: 0, y: 0 });
});

test('modelToLogical: centre maps to centre', () => {
  const dims = { targetWidth: 1372, targetHeight: 888 };
  const c = modelToLogical(686, 444, dims, BUILTIN);
  assert.ok(Math.abs(c.x - 864) <= 1, `x ${c.x}`);
  assert.ok(Math.abs(c.y - 558.5) <= 1, `y ${c.y}`);
});

test('modelToLogical: no screenshot passes coordinates through unchanged', () => {
  assert.deepEqual(modelToLogical(100, 200, null, BUILTIN), { x: 100, y: 200 });
});

test('logicalToModel is the inverse of modelToLogical', () => {
  const dims = { targetWidth: 1372, targetHeight: 888 };
  for (const p of [{ x: 0, y: 0 }, { x: 1372, y: 888 }, { x: 500, y: 300 }]) {
    const logical = modelToLogical(p.x, p.y, dims, BUILTIN);
    const back = logicalToModel(logical.x, logical.y, dims, BUILTIN);
    assert.ok(Math.abs(back.x - p.x) <= 1, `x ${back.x} vs ${p.x}`);
    assert.ok(Math.abs(back.y - p.y) <= 1, `y ${back.y} vs ${p.y}`);
  }
});

test('non-Retina display (scaleFactor 1) needs no special case', () => {
  const external = { logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 1 };
  assert.deepEqual(physicalSize(external), [1920, 1080]);
  const dims = { targetWidth: 1920, targetHeight: 1080 };
  assert.deepEqual(modelToLogical(960, 540, dims, external), { x: 960, y: 540 });
});

test('physicalSize rounds rather than truncating', () => {
  const odd = { logicalWidth: 1512.5, logicalHeight: 982.5, scaleFactor: 2 };
  assert.deepEqual(physicalSize(odd), [3025, 1965]);
});

test('clampRegion keeps the region inside the image and ordered', () => {
  const dims = { targetWidth: 1372, targetHeight: 888 };
  assert.deepEqual(clampRegion([100, 100, 300, 200], dims), [100, 100, 300, 200]);
  // reversed input is normalized
  assert.deepEqual(clampRegion([300, 200, 100, 100], dims), [100, 100, 300, 200]);
  // out of bounds is clamped
  assert.deepEqual(clampRegion([-50, -50, 99999, 99999], dims), [0, 0, 1372, 888]);
});
