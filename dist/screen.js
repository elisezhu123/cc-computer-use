/**
 * Screenshot capture. Produces exactly what the model sees, and reports the
 * dimensions it produced so coords.ts has a basis to map against.
 *
 * Capture is by display index (see display.ts) - never implicit, because on a
 * multi-monitor machine the implicit capture is the main display and the model
 * may be reasoning about a different one.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { API_RESIZE_PARAMS, targetImageSize } from './imageResize.js';
const execFileAsync = promisify(execFile);
async function captureRaw(displayIndex) {
    const path = join(tmpdir(), `cu-shot-${process.pid}-${Date.now()}.png`);
    try {
        await execFileAsync('screencapture', ['-x', '-D', String(displayIndex), path]);
    }
    catch (e) {
        throw new Error(`screencapture failed for display ${displayIndex}. ` +
            `This usually means Screen Recording permission is missing. (${String(e)})`);
    }
    return path;
}
/**
 * Capture, then resize to the API's target size so the server-side transcoder
 * early-returns and the model's pixel space is exactly what we can invert.
 *
 * Never upscales: targetImageSize returns the input size when it already fits.
 */
export async function capture(displayIndex, saveToDiskPath) {
    const raw = await captureRaw(displayIndex);
    try {
        const image = sharp(raw);
        const meta = await image.metadata();
        if (!meta.width || !meta.height) {
            throw new Error('screencapture produced an image with no readable dimensions.');
        }
        const [tw, th] = targetImageSize(meta.width, meta.height, API_RESIZE_PARAMS);
        let pipeline = image;
        if (tw !== meta.width || th !== meta.height) {
            pipeline = pipeline.resize(tw, th, { fit: 'fill' });
        }
        const data = await pipeline.png().toBuffer();
        let savedPath;
        if (saveToDiskPath) {
            await writeFile(saveToDiskPath, data);
            savedPath = saveToDiskPath;
        }
        return { data, dims: { targetWidth: tw, targetHeight: th }, savedPath };
    }
    finally {
        await unlink(raw).catch(() => { });
    }
}
/**
 * Higher-resolution view of a region of the last full screenshot, for reading
 * small text. Read-only: it does NOT change the coordinate basis, which stays
 * the full-screen screenshot. Ported from the official `zoom` tool semantics.
 */
export async function zoomRegion(fullScreenshotPng, region) {
    const [x0, y0, x1, y1] = region;
    const width = x1 - x0;
    const height = y1 - y0;
    if (width < 1 || height < 1) {
        throw new Error(`Zoom region must be at least 1x1, got ${width}x${height}.`);
    }
    // Crop first, then upscale to the long-edge cap so text is legible.
    const cropped = sharp(fullScreenshotPng).extract({ left: x0, top: y0, width, height });
    const scale = Math.min(4, Math.max(1, API_RESIZE_PARAMS.maxTargetPx / Math.max(width, height)));
    const outW = Math.round(width * scale);
    const outH = Math.round(height * scale);
    const data = await cropped.resize(outW, outH, { fit: 'fill' }).png().toBuffer();
    return { data, width: outW, height: outH };
}
export async function readFileBuffer(path) {
    return readFile(path);
}
//# sourceMappingURL=screen.js.map