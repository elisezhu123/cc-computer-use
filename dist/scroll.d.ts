/**
 * Scroll support via a compiled-on-first-use Swift helper.
 *
 * Why not cliclick: it has no scroll command at all. Why not pyobjc: Quartz is
 * not installed in the pyenv python3 on this machine, and requiring a pip
 * install is a worse dependency than a 30-line Swift file the system compiler
 * can build. swiftc ships with the Xcode command line tools already present.
 *
 * The helper is a long-lived child process reading one request per line, so a
 * burst of scrolls costs one spawn total rather than one per tick.
 */
import type { ScrollDirection } from './types.js';
/** Compile the helper once per process, cached across runs on disk. */
export declare function ensureScrollHelper(): Promise<string>;
/**
 * Scroll `ticks` wheel events at a logical-point position.
 *
 * Waits for the helper's "ok"/"err" line so a silent failure (blocked by TCC,
 * helper crashed) surfaces as a tool error instead of an unverified success.
 */
export declare function scrollAt(x: number, y: number, direction: ScrollDirection, ticks: number): Promise<void>;
/**
 * Middle-click. cliclick cannot do this at all - it has no middle-button token -
 * so the helper synthesizes CGEvent .otherMouseDown/Up with button 2.
 */
export declare function middleClick(x: number, y: number, count?: number): Promise<void>;
/** Terminate the helper on server shutdown. */
export declare function closeScrollHelper(): void;
//# sourceMappingURL=scroll.d.ts.map