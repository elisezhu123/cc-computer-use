/**
 * cliclick wrapper - the input layer, standing in for the official build's
 * Rust/enigo native module.
 *
 * cliclick consumes Cocoa LOGICAL POINTS. All coordinates reaching this file
 * are already in logical space (see coords.ts); this module never scales.
 *
 * Key naming: cliclick uses a compact hyphenated vocabulary that differs from
 * the model-facing names ("escape" -> "esc", "arrowup" -> "arrow-up",
 * "delete" -> "fwd-delete" vs "backspace" -> "delete"). The mapping lives here
 * and nowhere else, so a wrong name is a one-line fix rather than a scattered
 * mystery.
 */
export declare function sleep(ms: number): Promise<void>;
export declare function toCliclickKey(key: string): string;
export interface ParsedChord {
    mods: string[];
    keys: string[];
}
export declare function parseChord(chord: string): ParsedChord;
/** Press and release a chord, optionally repeated. */
export declare function pressChord(chord: string, repeat?: number): Promise<void>;
/**
 * Hold a chord down, wait, release. For a chord with no non-modifier key
 * (e.g. "shift" held while clicking) there is nothing to press in between.
 */
export declare function holdChord(chord: string, durationMs: number): Promise<void>;
/** Modifier keys only, for the click-during-modifier case. */
export declare function chordModifiers(chord: string): string[];
export declare function moveMouse(x: number, y: number): Promise<void>;
export declare function getMousePosition(): Promise<{
    x: number;
    y: number;
}>;
export type MouseButton = 'left' | 'right' | 'middle';
export declare function click(button: MouseButton, count: 1 | 2 | 3, modifiers?: string[], at?: {
    x: number;
    y: number;
} | null): Promise<void>;
/**
 * Press-and-hold at the current position, then release separately. cliclick's
 * dd:/du: pair only models a drag; holding still is achieved by issuing no
 * movement between them. Only the left button is supported - cliclick has no
 * right/other button down token.
 */
export declare function mouseDown(): Promise<void>;
export declare function mouseUp(): Promise<void>;
/** Drag from a start point to an end point. */
export declare function drag(from: {
    x: number;
    y: number;
} | null, to: {
    x: number;
    y: number;
}): Promise<void>;
/**
 * Type literal text. cliclick's `t:` types the string directly.
 *
 * Multi-line text is pasted from the clipboard instead: cliclick's `t:` does
 * not translate "\n" into Return, and sending text containing newlines
 * through argv risks argument-shape surprises. The caller decides; see
 * screen.ts/toolCalls for the fast path.
 */
export declare function typeText(text: string): Promise<void>;
//# sourceMappingURL=input.d.ts.map