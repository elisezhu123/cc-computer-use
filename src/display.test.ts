import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displaysFromHelper } from './display.js';

test('displaysFromHelper keeps origins and numbers displays from 1', () => {
  const out = displaysFromHelper([
    { id: 1, name: 'Built-in', isMain: true, originX: 0, originY: 0, logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 },
    { id: 5, name: 'LG', isMain: false, originX: -1085, originY: -1080, logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 2 },
  ]);
  assert.deepEqual(out.map((d) => [d.index, d.displayId, d.geometry.originX]), [[1, 1, 0], [2, 5, -1085]]);
  assert.deepEqual(out[1]!.geometry, {
    logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 2, originX: -1085, originY: -1080,
  });
  assert.equal(out[0]!.isMain, true);
});
