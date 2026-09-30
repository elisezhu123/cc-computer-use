/**
 * Key names for native background mode: chords translated to macOS virtual
 * key codes (Carbon kVK_*, ANSI layout) and CGEventFlags modifier bits, which
 * is what CGEventPostToPid needs. Characters with no key code on the ANSI
 * layout (CJK, emoji, accented letters) are typed as Unicode instead.
 */

export const FLAG_SHIFT = 0x20000;
export const FLAG_CONTROL = 0x40000;
export const FLAG_ALT = 0x80000;
export const FLAG_COMMAND = 0x100000;

const MODIFIER_FLAGS: Readonly<Record<string, number>> = {
  cmd: FLAG_COMMAND, command: FLAG_COMMAND, meta: FLAG_COMMAND, super: FLAG_COMMAND, win: FLAG_COMMAND,
  ctrl: FLAG_CONTROL, control: FLAG_CONTROL,
  alt: FLAG_ALT, option: FLAG_ALT,
  shift: FLAG_SHIFT,
};

/** Modifier key codes, for holding a modifier on its own. */
const MODIFIER_CODES: Readonly<Record<number, number>> = {
  [FLAG_COMMAND]: 55, [FLAG_SHIFT]: 56, [FLAG_ALT]: 58, [FLAG_CONTROL]: 59,
};

const NAMED: Readonly<Record<string, number>> = {
  return: 36, enter: 36, tab: 48, space: 49, backspace: 51, escape: 53, esc: 53,
  delete: 117, forwarddelete: 117, 'forward-delete': 117,
  home: 115, end: 119,
  pageup: 116, page_up: 116, 'page-up': 116, prior: 116,
  pagedown: 121, page_down: 121, 'page-down': 121, next: 121,
  left: 123, arrowleft: 123, 'arrow-left': 123,
  right: 124, arrowright: 124, 'arrow-right': 124,
  down: 125, arrowdown: 125, 'arrow-down': 125,
  up: 126, arrowup: 126, 'arrow-up': 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
};

/** ANSI key codes for unshifted characters. */
const CHARS: Readonly<Record<string, number>> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15,
  y: 16, t: 17, '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26,
  '-': 27, '8': 28, '0': 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, l: 37, j: 38, "'": 39,
  k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, '`': 50, ' ': 49,
};

/** Shifted characters -> their unshifted key. */
const SHIFTED: Readonly<Record<string, string>> = {
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`',
};

export interface NativeKey {
  code: number;
  flags: number;
}

/** A single key (no modifiers) as code + implied shift, or null when it has no ANSI key code. */
export function nativeKeyFor(key: string): NativeKey | null {
  const lower = key.toLowerCase();
  if (NAMED[lower] !== undefined) return { code: NAMED[lower]!, flags: 0 };
  if (key.length !== 1) return null;
  if (CHARS[key] !== undefined) return { code: CHARS[key]!, flags: 0 };
  if (/[A-Z]/.test(key)) return { code: CHARS[lower]!, flags: FLAG_SHIFT };
  if (SHIFTED[key] !== undefined) return { code: CHARS[SHIFTED[key]!]!, flags: FLAG_SHIFT };
  return null;
}

/** A chord as a list of key presses sharing one modifier mask. */
export function parseNativeChord(chord: string): { flags: number; keys: NativeKey[] } {
  let flags = 0;
  const keys: NativeKey[] = [];
  for (const raw of chord.split('+')) {
    const part = raw.trim();
    if (part.length === 0 || part.toLowerCase() === 'fn') continue;
    const mod = MODIFIER_FLAGS[part.toLowerCase()];
    if (mod !== undefined) {
      flags |= mod;
      continue;
    }
    const k = nativeKeyFor(part);
    if (!k) throw new Error(`Key "${part}" has no key code in background mode. Use the type tool for text.`);
    keys.push(k);
  }
  if (flags === 0 && keys.length === 0) throw new Error(`Empty or unparseable key chord: ${JSON.stringify(chord)}`);
  return { flags, keys };
}

/** Key codes of the modifiers set in `flags`, in press order. */
export function modifierCodes(flags: number): number[] {
  return [FLAG_COMMAND, FLAG_CONTROL, FLAG_ALT, FLAG_SHIFT].filter((f) => flags & f).map((f) => MODIFIER_CODES[f]!);
}
