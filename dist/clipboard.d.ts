/**
 * Clipboard access via pbcopy/pbpaste.
 *
 * The read-back verification in pasteText is not ceremony: clipboard writes can
 * silently fail (a clipboard manager holding the pasteboard, or a large write
 * racing the paste). Pasting unverified would inject whatever was already on
 * the clipboard into the user's focused application.
 */
export declare function readClipboard(): Promise<string>;
export declare function writeClipboard(text: string): Promise<void>;
/**
 * Paste `text` by temporarily replacing the clipboard, then restoring it.
 *
 * The restore is in a finally so a throw between write and paste never leaves
 * the user's clipboard clobbered. A 100ms settle after Cmd+V is the threshold
 * where the target app has read the pasteboard but we have not yet restored -
 * restoring sooner makes the app paste the RESTORED content instead.
 */
export declare function pasteText(text: string, pressPaste: () => Promise<void>): Promise<void>;
//# sourceMappingURL=clipboard.d.ts.map