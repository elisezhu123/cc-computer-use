/**
 * Permission policy: session allowlist, frontmost-app gate, app tiers, and the
 * system-key blocklist.
 *
 * This is the layer the old server had none of. Without it any tool call can
 * act on any application, including apps that execute arbitrary shell commands
 * or manage credentials - so the model's own judgement is the only boundary,
 * which is not a boundary.
 *
 * The gate is enforced on EVERY input action (including each action inside
 * computer_batch), not once per session: a click can open an app that was
 * never granted, and the next action would then be operating on it.
 */
export type AppTier = 'full' | 'click' | 'read';
export declare function tierForApp(bundleId: string | null): AppTier;
export declare function normalizeKeySequence(seq: string): string;
/**
 * True if the chord would fire a blocked OS shortcut.
 *
 * Checks mods + EACH non-modifier key individually, not just the joined
 * string: `cmd+q+a` sends Cmd, then Q (Cmd+Q fires, quitting the app), then A.
 * Matching only "meta+q+a" would miss it.
 */
export declare function isSystemKeyCombo(chord: string): boolean;
export interface GrantFlags {
    clipboardRead: boolean;
    clipboardWrite: boolean;
    systemKeyCombos: boolean;
}
export interface SessionState {
    /** Bundle IDs the user allowed, or null when request_access was never called. */
    allowedBundleIds: Set<string> | null;
    /** Display names the user asked for, kept for reporting. */
    requestedNames: string[];
    grants: GrantFlags;
    /** Resolved bundle ID -> tier, frozen at request_access time. */
    tiers: Map<string, AppTier>;
}
export declare function newSession(): SessionState;
export declare class PolicyError extends Error {
    readonly code: 'not_granted' | 'denied_tier' | 'needs_flag' | 'needs_access' | 'bad_request';
    constructor(message: string, code: 'not_granted' | 'denied_tier' | 'needs_flag' | 'needs_access' | 'bad_request');
}
/**
 * The frontmost-app gate. Called before every input action.
 *
 * `actionKind` decides which tier restriction applies: a 'read'-tier app can
 * be clicked but not typed into; a 'click'-tier app can be clicked and typed
 * into only if it is not shell-capable... see tierForApp for the mapping.
 */
export declare function assertActionAllowed(session: SessionState, frontmostBundleId: string | null, actionKind: 'read' | 'click' | 'type' | 'key' | 'scroll' | 'clipboard_read' | 'clipboard_write'): void;
/** Key-chord gate, separate from the app gate. */
export declare function assertChordAllowed(session: SessionState, chord: string): void;
//# sourceMappingURL=policy.d.ts.map