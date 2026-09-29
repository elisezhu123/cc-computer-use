/**
 * Screenshot capture. Produces exactly what the model sees, and reports the
 * dimensions it produced so coords.ts has a basis to map against.
 *
 * Capture is by display index (see display.ts) - never implicit, because on a
 * multi-monitor machine the implicit capture is the main display and the model
 * may be reasoning about a different one.
 */
import type { ScreenshotDims } from './coords.js';
export interface CapturedScreenshot {
    /** PNG bytes at exactly targetWidth x targetHeight. */
    data: Buffer;
    dims: ScreenshotDims;
    /** Where it was written if save_to_disk was set. */
    savedPath?: string;
}
/**
 * Capture, then resize to the API's target size so the server-side transcoder
 * early-returns and the model's pixel space is exactly what we can invert.
 *
 * Never upscales: targetImageSize returns the input size when it already fits.
 */
export declare function capture(displayIndex: number, saveToDiskPath?: string): Promise<CapturedScreenshot>;
/**
 * Higher-resolution view of a region of the last full screenshot, for reading
 * small text. Read-only: it does NOT change the coordinate basis, which stays
 * the full-screen screenshot. Ported from the official `zoom` tool semantics.
 */
export declare function zoomRegion(fullScreenshotPng: Buffer, region: readonly [number, number, number, number]): Promise<{
    data: Buffer;
    width: number;
    height: number;
}>;
export declare function readFileBuffer(path: string): Promise<Buffer>;
//# sourceMappingURL=screen.d.ts.map