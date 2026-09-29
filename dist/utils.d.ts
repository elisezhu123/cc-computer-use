/**
 * Enhanced utility functions inspired by CC-Source executor.ts
 * Combines CC-Source best practices with standalone implementation
 */
import { ScreenInfo, MousePosition } from "./types.js";
/**
 * Sleep utility
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Execute an AppleScript command
 */
export declare function execAppleScript(script: string): Promise<string>;
/**
 * Execute a cliclick command
 */
export declare function execCliClick(args: string[], extraArgs?: string[]): Promise<string>;
/**
 * Get current screen resolution
 */
export declare function getScreenInfo(): Promise<ScreenInfo>;
/**
 * Get current mouse position
 */
export declare function getMousePosition(): Promise<MousePosition>;
/**
 * Move mouse and settle (inspired by CC-Source moveAndSettle)
 */
export declare function moveMouseAndSettle(x: number, y: number): Promise<void>;
/**
 * Animated mouse movement with easing (inspired by CC-Source animatedMove)
 * Uses ease-out-cubic at 60fps
 */
export declare function animatedMouseMove(targetX: number, targetY: number, enabled?: boolean): Promise<void>;
/**
 * Read clipboard via pbpaste (inspired by CC-Source)
 */
export declare function readClipboard(): Promise<string>;
/**
 * Write clipboard via pbcopy (inspired by CC-Source)
 */
export declare function writeClipboard(text: string): Promise<void>;
/**
 * Type via clipboard (inspired by CC-Source typeViaClipboard)
 * More reliable than direct typing for long text
 */
export declare function typeViaClipboard(text: string): Promise<void>;
/**
 * Take a screenshot
 */
export declare function takeScreenshot(outputPath?: string): Promise<Buffer | void>;
/**
 * Format error messages
 */
export declare function handleError(error: unknown, message?: string): string;
/**
 * Map key names to cliclick format
 */
export declare function mapKeyName(key: string): string;
/**
 * Parse key sequence like "ctrl+shift+a" into parts
 */
export declare function parseKeySequence(sequence: string): string[];
//# sourceMappingURL=utils.d.ts.map