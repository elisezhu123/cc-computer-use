import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelToLogical, logicalToModel, clampRegion } from './coords.js';
// Both attached displays on the reference machine.
const BUILTIN = { logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 };
const EXTERNAL = { logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 2 };
const CASES = [
    { name: 'built-in 16" MBP', display: BUILTIN, dims: { targetWidth: 1372, targetHeight: 887 } },
    { name: 'external 4K at 1080p HiDPI', display: EXTERNAL, dims: { targetWidth: 1456, targetHeight: 819 } },
    { name: 'non-Retina 1920x1080', display: { logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 1 },
        dims: { targetWidth: 1456, targetHeight: 819 } },
    { name: 'target larger than display (upscale case)', display: BUILTIN, dims: { targetWidth: 2000, targetHeight: 1293 } },
];
for (const { name, display, dims } of CASES) {
    test(`[${name}] corners map exactly`, () => {
        // The four corners of the image must land on the four corners of the
        // display. A wrong scale factor is smallest at the origin, so the corners
        // are where it shows.
        const cases = [
            [0, 0, 0, 0],
            [dims.targetWidth, 0, display.logicalWidth, 0],
            [0, dims.targetHeight, 0, display.logicalHeight],
            [dims.targetWidth, dims.targetHeight, display.logicalWidth, display.logicalHeight],
        ];
        for (const [mx, my, lx, ly] of cases) {
            const got = modelToLogical(mx, my, dims, display);
            assert.equal(got.x, lx, `x for (${mx},${my})`);
            assert.equal(got.y, ly, `y for (${mx},${my})`);
        }
    });
    test(`[${name}] full-space round trip stays within 1pt`, () => {
        // Exhaustive over the whole model image, not a sample: a mapping bug that
        // only shows at certain radii would slip past a sampling test.
        let worst = 0;
        for (let x = 0; x <= dims.targetWidth; x += 7) {
            for (let y = 0; y <= dims.targetHeight; y += 7) {
                const l = modelToLogical(x, y, dims, display);
                const back = logicalToModel(l.x, l.y, dims, display);
                worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
            }
        }
        assert.ok(worst <= 1, `worst round-trip error ${worst}pt (tolerance 1pt)`);
    });
    test(`[${name}] mapping is monotonic and never exceeds the display`, () => {
        let prevX = -1, prevY = -1;
        for (let x = 0; x <= dims.targetWidth; x += 3) {
            const l = modelToLogical(x, 0, dims, display);
            assert.ok(l.x >= prevX, `x not monotonic at ${x}: ${l.x} < ${prevX}`);
            assert.ok(l.x >= 0 && l.x <= display.logicalWidth, `x ${l.x} outside display`);
            prevX = l.x;
        }
        for (let y = 0; y <= dims.targetHeight; y += 3) {
            const l = modelToLogical(0, y, dims, display);
            assert.ok(l.y >= prevY, `y not monotonic at ${y}`);
            assert.ok(l.y >= 0 && l.y <= display.logicalHeight, `y ${l.y} outside display`);
            prevY = l.y;
        }
    });
    test(`[${name}] the 1/scaleFactor formula would be measurably wrong`, () => {
        // Guards against someone "simplifying" the mapping back to a divide.
        const cx = Math.floor(dims.targetWidth / 2);
        const correct = modelToLogical(cx, 0, dims, display).x;
        const buggy = Math.round(cx / display.scaleFactor);
        const drift = Math.abs(correct - buggy) / correct;
        assert.ok(drift > 0.15, `the buggy formula differs by only ${(drift * 100).toFixed(1)}% - the test itself is no longer meaningful`);
    });
}
test('clampRegion handles degenerate and inverted rectangles', () => {
    const dims = { targetWidth: 1372, targetHeight: 887 };
    assert.deepEqual(clampRegion([10, 10, 10, 10], dims), [10, 10, 11, 11], 'zero-size becomes 1x1');
    // y1 clamps to the image height (887), not to the requested 900.
    assert.deepEqual(clampRegion([900, 900, 100, 100], dims), [100, 100, 900, 887], 'inverted is ordered and clamped');
    assert.deepEqual(clampRegion([0, 0, 1372, 887], dims), [0, 0, 1372, 887], 'full image is unchanged');
    const edge = clampRegion([1372, 887, 1372, 887], dims);
    assert.ok(edge[2] <= dims.targetWidth && edge[3] <= dims.targetHeight, 'never exceeds the image');
});
test('coordinates outside the image map outside the display (documented behaviour)', () => {
    // The mapping is linear and does not clamp; callers that need bounds checking
    // must do it themselves. Pinning this makes that contract explicit rather
    // than accidental.
    const dims = { targetWidth: 1372, targetHeight: 887 };
    const out = modelToLogical(1372 + 500, 887 + 500, dims, BUILTIN);
    assert.ok(out.x > BUILTIN.logicalWidth, 'x maps beyond the display');
    assert.ok(out.y > BUILTIN.logicalHeight, 'y maps beyond the display');
});
//# sourceMappingURL=coords.fullspace.test.js.map