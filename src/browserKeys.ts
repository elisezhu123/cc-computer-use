/**
 * Key names for browser mode: the model-facing chord vocabulary (the same one
 * input.ts maps onto cliclick) translated to Playwright's KeyboardEvent.key
 * names. "cmd+shift+Down" -> modifiers ["Meta", "Shift"], keys ["ArrowDown"].
 */

const MODIFIERS: Readonly<Record<string, string>> = {
  cmd: 'Meta', command: 'Meta', meta: 'Meta', super: 'Meta', win: 'Meta', windows: 'Meta',
  ctrl: 'Control', control: 'Control',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
};

const KEYS: Readonly<Record<string, string>> = {
  return: 'Enter', enter: 'Enter',
  escape: 'Escape', esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete', forwarddelete: 'Delete', 'forward-delete': 'Delete',
  tab: 'Tab',
  space: ' ',
  up: 'ArrowUp', arrowup: 'ArrowUp', 'arrow-up': 'ArrowUp',
  down: 'ArrowDown', arrowdown: 'ArrowDown', 'arrow-down': 'ArrowDown',
  left: 'ArrowLeft', arrowleft: 'ArrowLeft', 'arrow-left': 'ArrowLeft',
  right: 'ArrowRight', arrowright: 'ArrowRight', 'arrow-right': 'ArrowRight',
  pageup: 'PageUp', page_up: 'PageUp', 'page-up': 'PageUp', prior: 'PageUp',
  pagedown: 'PageDown', page_down: 'PageDown', 'page-down': 'PageDown', next: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
};

export interface BrowserChord {
  modifiers: string[];
  keys: string[];
}

export function toBrowserKey(key: string): string {
  const lower = key.trim().toLowerCase();
  if (KEYS[lower] !== undefined) return KEYS[lower]!;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  // Single characters keep their case; anything else is passed through, which
  // covers Playwright's own names ("Enter", "ArrowDown") given verbatim.
  return key.trim();
}

export function parseBrowserChord(chord: string): BrowserChord {
  const modifiers: string[] = [];
  const keys: string[] = [];
  for (const raw of chord.split('+')) {
    const part = raw.trim();
    if (part.length === 0) continue;
    const mod = MODIFIERS[part.toLowerCase()];
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
    } else if (part.toLowerCase() !== 'fn') {
      keys.push(toBrowserKey(part));
    }
  }
  if (modifiers.length === 0 && keys.length === 0) {
    throw new Error(`Empty or unparseable key chord: ${JSON.stringify(chord)}`);
  }
  return { modifiers, keys };
}
