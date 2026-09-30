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

// ── App tiers ────────────────────────────────────────────────────────────────

export type AppTier = 'full' | 'click' | 'read';

/** Apps that can execute arbitrary shell commands - clickable, not typable. */
const SHELL_ACCESS_BUNDLE_IDS: ReadonlySet<string> = new Set([
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.microsoft.VSCode',
  'dev.warp.Warp-Stable',
  'com.github.wez.wezterm',
  'io.alacritty',
  'net.kovidgoyal.kitty',
  'com.jetbrains.intellij',
  'com.jetbrains.pycharm',
]);

/** Read-only: visible in screenshots, never interacted with. A stray click on
 * a trading UI can execute a trade. */
const READ_ONLY_BUNDLE_IDS: ReadonlySet<string> = new Set([
  'com.apple.Safari',
  'com.apple.SafariTechnologyPreview',
  'com.google.Chrome',
  'org.mozilla.firefox',
  'com.microsoft.edgemac',
  'company.thebrowser.Browser',
]);

/**
 * Tiers are opt-in. By default every granted app is fully interactive -
 * browsers included - so the allowlist, the frontmost gate and the system-key
 * blocklist are the boundary. Set CU_STRICT_APP_TIERS=1 to restore the
 * official build's restrictions: browsers view-only, shells click-only.
 */
export const STRICT_APP_TIERS = /^(1|true|yes)$/i.test(process.env.CU_STRICT_APP_TIERS ?? '');

export function tierForApp(bundleId: string | null, strict = STRICT_APP_TIERS): AppTier {
  if (!strict || bundleId === null) return 'full';
  if (READ_ONLY_BUNDLE_IDS.has(bundleId)) return 'read';
  if (SHELL_ACCESS_BUNDLE_IDS.has(bundleId)) return 'click';
  return 'full';
}

// ── System key blocklist ─────────────────────────────────────────────────────

/** Modifier aliases collapsed to canonical names. Canonical names are the last
 * word in each group. Without collapsing, `command+q` and `cmd+q` and `meta+q`
 * would each need their own blocklist entry and one would be missed. */
const CANONICAL_MODIFIER: Readonly<Record<string, string>> = {
  meta: 'meta', super: 'meta', command: 'meta', cmd: 'meta', windows: 'meta', win: 'meta',
  ctrl: 'ctrl', control: 'ctrl', lctrl: 'ctrl', lcontrol: 'ctrl', rctrl: 'ctrl', rcontrol: 'ctrl',
  shift: 'shift', lshift: 'shift', rshift: 'shift',
  alt: 'alt', option: 'alt',
};

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'];

const BLOCKED_DARWIN: ReadonlySet<string> = new Set([
  'meta+q',
  'shift+meta+q',
  'alt+meta+escape',
  'meta+tab',
  'meta+space',
  'ctrl+meta+q',
]);

function partitionKeys(seq: string): { mods: string[]; keys: string[] } {
  const parts = seq.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const mods: string[] = [];
  const keys: string[] = [];
  for (const p of parts) {
    const canonical = CANONICAL_MODIFIER[p];
    if (canonical !== undefined) mods.push(canonical);
    else keys.push(p);
  }
  const unique = [...new Set(mods)];
  unique.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return { mods: unique, keys };
}

export function normalizeKeySequence(seq: string): string {
  const { mods, keys } = partitionKeys(seq);
  return [...mods, ...keys].join('+');
}

/**
 * True if the chord would fire a blocked OS shortcut.
 *
 * Checks mods + EACH non-modifier key individually, not just the joined
 * string: `cmd+q+a` sends Cmd, then Q (Cmd+Q fires, quitting the app), then A.
 * Matching only "meta+q+a" would miss it.
 */
export function isSystemKeyCombo(chord: string): boolean {
  const { mods, keys } = partitionKeys(chord);
  if (keys.length === 0) return BLOCKED_DARWIN.has(mods.join('+'));
  const prefix = mods.length > 0 ? mods.join('+') + '+' : '';
  for (const key of keys) {
    if (BLOCKED_DARWIN.has(prefix + key)) return true;
  }
  return false;
}

// ── Session state ────────────────────────────────────────────────────────────

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

export function newSession(): SessionState {
  return {
    allowedBundleIds: null,
    requestedNames: [],
    grants: { clipboardRead: false, clipboardWrite: false, systemKeyCombos: false },
    tiers: new Map(),
  };
}

export class PolicyError extends Error {
  constructor(message: string, readonly code: 'not_granted' | 'denied_tier' | 'needs_flag' | 'needs_access' | 'bad_request') {
    super(message);
    this.name = 'PolicyError';
  }
}

/**
 * The frontmost-app gate. Called before every input action.
 *
 * `actionKind` decides which tier restriction applies (strict mode only, see
 * tierForApp): a 'read'-tier app refuses every interaction; a 'click'-tier
 * app allows clicking and scrolling but refuses typing and keys.
 */
export function assertActionAllowed(
  session: SessionState,
  frontmostBundleId: string | null,
  actionKind: 'read' | 'click' | 'type' | 'key' | 'scroll' | 'clipboard_read' | 'clipboard_write',
): void {
  if (session.allowedBundleIds === null) {
    throw new PolicyError(
      'request_access has not been called yet in this session. Call it first and get the user\'s allowlist before any other tool.',
      'needs_access',
    );
  }

  if (actionKind === 'clipboard_read' && !session.grants.clipboardRead) {
    throw new PolicyError(
      'Reading the clipboard was not granted for this session. Re-call request_access with clipboardRead: true.',
      'needs_flag',
    );
  }
  if (actionKind === 'clipboard_write' && !session.grants.clipboardWrite) {
    throw new PolicyError(
      'Writing the clipboard was not granted for this session. Re-call request_access with clipboardWrite: true.',
      'needs_flag',
    );
  }

  // Clipboard access is not app-scoped - the clipboard is global.
  if (actionKind === 'clipboard_read' || actionKind === 'clipboard_write') return;

  if (frontmostBundleId === null) {
    throw new PolicyError(
      'Could not determine the frontmost application, so the action was refused.',
      'not_granted',
    );
  }

  if (!session.allowedBundleIds.has(frontmostBundleId)) {
    throw new PolicyError(
      `The frontmost application (${frontmostBundleId}) is not in this session's allowlist, so the action was refused. ` +
        'Call request_access to add it, or bring an allowed app to the front.',
      'not_granted',
    );
  }

  const tier = session.tiers.get(frontmostBundleId) ?? tierForApp(frontmostBundleId);
  if (tier === 'read') {
    throw new PolicyError(
      `${frontmostBundleId} is read-only for this session: it is visible in screenshots but cannot be interacted with.`,
      'denied_tier',
    );
  }
  if (tier === 'click' && (actionKind === 'type' || actionKind === 'key')) {
    throw new PolicyError(
      `${frontmostBundleId} grants click access only - typing into it is refused because it can execute arbitrary commands.`,
      'denied_tier',
    );
  }
}

/** Key-chord gate, separate from the app gate. */
export function assertChordAllowed(session: SessionState, chord: string): void {
  if (!isSystemKeyCombo(chord)) return;
  if (session.grants.systemKeyCombos) return;
  throw new PolicyError(
    `"${chord}" is a system-level shortcut (quit app / switch app / lock screen) and was not granted. ` +
      'Re-call request_access with systemKeyCombos: true if the user agrees.',
    'needs_flag',
  );
}
