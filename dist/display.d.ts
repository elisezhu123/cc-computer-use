/**
 * Display detection + preflight.
 *
 * Two failure modes this module exists to prevent:
 *
 *   1. Guessing scaleFactor. A wrong scale factor silently offsets EVERY
 *      click, and the offset scales with distance from the origin - so clicks
 *      near the top-left "mostly work" and the bug survives casual testing.
 *      If we cannot measure the geometry, we refuse to start.
 *
 *   2. Assuming a single display. screencapture with no -D flag captures the
 *      main display; on a multi-monitor machine the model then reasons about
 *      a different screen than the one it is clicking on. Display selection
 *      is therefore explicit, never implicit.
 */
import type { DisplayGeometry } from './coords.js';
export interface AttachedDisplay {
    /** screencapture's 1-based display index (matches `-D <n>`). */
    index: number;
    name: string;
    /** True when this is the display macOS designates as main. */
    isMain: boolean;
    geometry: DisplayGeometry;
}
export declare class PreflightError extends Error {
    /** What the user must do to fix it. Shown verbatim in the tool error. */
    readonly remedy: string;
    constructor(message: string, 
    /** What the user must do to fix it. Shown verbatim in the tool error. */
    remedy: string);
}
/**
 * Enumerate attached displays with measured geometry.
 *
 * scaleFactor is derived, not assumed: physical/1 == logical means non-Retina,
 * physical/2 == logical means Retina. We accept a match within 1px to absorb
 * rounding, and reject anything else rather than picking the closest.
 */
export declare function detectDisplays(): Promise<AttachedDisplay[]>;
/**
 * Verify the two TCC permissions the server cannot function without.
 * Called once at startup so failures surface as actionable text rather than
 * as a mystery cliclick error mid-task.
 */
export declare function preflightPermissions(): Promise<void>;
//# sourceMappingURL=display.d.ts.map