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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Settle delay after a move before clicking. An input->HID->AppKit->NSEvent
 * round trip must complete before a click dispatched at the new position is
 * interpreted against the old one. */
const MOVE_SETTLE_MS = 50;

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run cliclick with an argv array. Arguments are never shell-interpolated:
 * text typed for the model can contain any character, and a shell string
 * would turn that into command injection.
 */
async function cliclick(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('cliclick', args);
  return stdout.trim();
}

/**
 * Key name -> cliclick token. Covers the model-facing vocabulary used by the
 * key/hold_key tools; anything unmapped passes through lowercased, which is
 * correct for single characters and cliclick's own names.
 */
const KEY_MAP: Readonly<Record<string, string>> = {
  escape: 'esc',
  esc: 'esc',
  backspace: 'delete',
  delete: 'fwd-delete',
  forwarddelete: 'fwd-delete',
  'forward-delete': 'fwd-delete',
  pageup: 'page-up',
  'page-up': 'page-up',
  pagedown: 'page-down',
  'page-down': 'page-down',
  arrowup: 'arrow-up',
  'arrow-up': 'arrow-up',
  arrowdown: 'arrow-down',
  'arrow-down': 'arrow-down',
  arrowleft: 'arrow-left',
  'arrow-left': 'arrow-left',
  arrowright: 'arrow-right',
  'arrow-right': 'arrow-right',
  return: 'return',
  enter: 'return',
  tab: 'tab',
  space: 'space',
  // Modifiers. cliclick accepts cmd/ctrl/alt/fn/shift.
  command: 'cmd',
  cmd: 'cmd',
  meta: 'cmd',
  control: 'ctrl',
  ctrl: 'ctrl',
  option: 'alt',
  alt: 'alt',
  shift: 'shift',
};

export function toCliclickKey(key: string): string {
  const lower = key.trim().toLowerCase();
  return KEY_MAP[lower] ?? lower;
}

/**
 * Split a chord into modifier keys and non-modifier keys, canonicalized.
 *
 * cliclick's key model has three separate mechanisms and using the wrong one
 * silently does the wrong thing:
 *   - modifiers (cmd/ctrl/alt/shift/fn) are only valid with kd:/ku: (hold and
 *     release separately). Passing them to kp: is an error.
 *   - named keys (return, esc, arrow-up, f1, ...) go through kp:, which is
 *     press-then-release as one event.
 *   - ordinary characters (letters, digits, punctuation) go through t:"..."
 *     because kp: rejects them outright - `kp:a` fails with "Invalid key".
 */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['cmd', 'ctrl', 'alt', 'shift', 'fn']);

export interface ParsedChord {
  mods: string[];
  keys: string[];
}

export function parseChord(chord: string): ParsedChord {
  const mods: string[] = [];
  const keys: string[] = [];

  for (const raw of chord.split('+')) {
    const part = raw.trim();
    if (part.length === 0) continue;
    const mapped = toCliclickKey(part);
    if (MODIFIER_KEYS.has(mapped)) {
      if (!mods.includes(mapped)) mods.push(mapped);
    } else {
      keys.push(mapped);
    }
  }
  return { mods, keys };
}

/** A single printable character - t:"x" territory rather than kp:. */
function isPrintableChar(key: string): boolean {
  return key.length === 1;
}

/** One non-modifier key as a cliclick argument. */
function keyArg(key: string): string {
  return isPrintableChar(key) ? `t:${key}` : `kp:${key}`;
}

/**
 * Build the cliclick argv for one chord: hold modifiers, press each key,
 * release modifiers in reverse.
 *
 * Releasing in reverse matters: a chord with two modifiers where the release
 * order is wrong can leave a modifier stuck down, which then corrupts every
 * subsequent keystroke in the session.
 */
function chordArgs(chord: string): string[] {
  const { mods, keys } = parseChord(chord);
  if (mods.length === 0 && keys.length === 0) {
    throw new Error(`Empty or unparseable key chord: ${JSON.stringify(chord)}`);
  }

  const args: string[] = [];
  if (mods.length > 0) args.push(`kd:${mods.join(',')}`);
  for (const k of keys) args.push(keyArg(k));
  if (mods.length > 0) args.push(`ku:${[...mods].reverse().join(',')}`);
  return args;
}

/** Press and release a chord, optionally repeated. */
export async function pressChord(chord: string, repeat = 1): Promise<void> {
  const args = chordArgs(chord);
  for (let i = 0; i < repeat; i++) {
    await cliclick(args);
    if (i < repeat - 1) await sleep(8);
  }
}

/**
 * Hold a chord down, wait, release. For a chord with no non-modifier key
 * (e.g. "shift" held while clicking) there is nothing to press in between.
 */
export async function holdChord(chord: string, durationMs: number): Promise<void> {
  const { mods, keys } = parseChord(chord);
  if (mods.length === 0 && keys.length === 0) {
    throw new Error(`Empty or unparseable key chord: ${JSON.stringify(chord)}`);
  }

  const down: string[] = [];
  if (mods.length > 0) down.push(`kd:${mods.join(',')}`);
  for (const k of keys) down.push(keyArg(k));
  await cliclick(down);

  try {
    await sleep(durationMs);
  } finally {
    // Release in reverse; swallow so a release failure never masks the real
    // error, but never leave a modifier stuck down.
    const up: string[] = [];
    if (mods.length > 0) up.push(`ku:${[...mods].reverse().join(',')}`);
    await cliclick(up).catch(() => {});
  }
}

/** Modifier keys only, for the click-during-modifier case. */
export function chordModifiers(chord: string): string[] {
  return modsOnly(parseChord(chord));
}

function modsOnly(p: ParsedChord): string[] {
  return p.mods;
}

// ── Mouse ────────────────────────────────────────────────────────────────────

export async function moveMouse(x: number, y: number): Promise<void> {
  await cliclick([`m:${Math.round(x)},${Math.round(y)}`]);
  await sleep(MOVE_SETTLE_MS);
}

export async function getMousePosition(): Promise<{ x: number; y: number }> {
  const out = await cliclick(['p']);
  const m = /(-?\d+),(-?\d+)/.exec(out);
  if (!m) throw new Error(`cliclick p returned unparseable output: ${JSON.stringify(out)}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

export type MouseButton = 'left' | 'right' | 'middle';

/**
 * cliclick click tokens: c: / rc: / dc: / tc: (left, right, double, triple).
 * There is no "middle click" token and no modifier-carrying variant - so a
 * modifier-during-click is expressed as kp:/ku: around the click, and a
 * middle-click falls back to a synthetic scroll-wheel button event via the
 * Swift helper (see SCROLL note below).
 */
function clickToken(button: MouseButton, count: 1 | 2 | 3, at: string): string {
  if (button === 'left') {
    return count === 1 ? `c:${at}` : count === 2 ? `dc:${at}` : `tc:${at}`;
  }
  if (button === 'right') {
    // cliclick has no right double/triple click; repeat rc: - the OS
    // coalesces by timing when the events are close enough.
    return Array.from({ length: count }, () => `rc:${at}`).join(' ');
  }
  throw new Error(
    'cliclick cannot synthesize a middle click. Use the scroll helper or left_click instead.',
  );
}

export async function click(
  button: MouseButton,
  count: 1 | 2 | 3,
  modifiers: string[] = [],
  at: { x: number; y: number } | null = null,
): Promise<void> {
  const pos = at ? `${Math.round(at.x)},${Math.round(at.y)}` : '.';
  // Modifiers must be held with kd:/ku: - kp: on a modifier is an error, and
  // kd: takes the whole modifier list as one comma-separated argument.
  const mods = modifiers.map(toCliclickKey).filter((m) => MODIFIER_KEYS.has(m));
  const args: string[] = [];
  if (mods.length > 0) args.push(`kd:${mods.join(',')}`);
  args.push(clickToken(button, count, pos));
  if (mods.length > 0) args.push(`ku:${[...mods].reverse().join(',')}`);
  await cliclick(args);
}

/**
 * Press-and-hold at the current position, then release separately. cliclick's
 * dd:/du: pair only models a drag; holding still is achieved by issuing no
 * movement between them. Only the left button is supported - cliclick has no
 * right/other button down token.
 */
export async function mouseDown(): Promise<void> {
  await cliclick(['dd:.']);
}

export async function mouseUp(): Promise<void> {
  await cliclick(['du:.']);
}

/** Drag from a start point to an end point. */
export async function drag(
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
): Promise<void> {
  if (from) await moveMouse(from.x, from.y);
  const dest = `${Math.round(to.x)},${Math.round(to.y)}`;
  // dd: begins the drag at the destination, dm: continues it there, du: ends
  // it. Passing dd:+dm: to the same point gives the intervening move event
  // that most drag targets require to register the gesture.
  await cliclick([`dd:${dest}`, `dm:${dest}`, `du:${dest}`]);
}

// ── Text ─────────────────────────────────────────────────────────────────────

/**
 * Type literal text. cliclick's `t:` types the string directly.
 *
 * Multi-line text is pasted from the clipboard instead: cliclick's `t:` does
 * not translate "\n" into Return, and sending text containing newlines
 * through argv risks argument-shape surprises. The caller decides; see
 * screen.ts/toolCalls for the fast path.
 */
export async function typeText(text: string): Promise<void> {
  await cliclick([`t:${text}`]);
}
