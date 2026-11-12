/**
 * Typed access to native/desktop.swift, the desktop helper that does screen
 * capture, display geometry, mouse input and Accessibility hit testing in one long-lived process.
 *
 * The helper is an optimization, never a requirement: getDesktopHelper()
 * returns null when it is disabled (CU_NATIVE_HELPER=0), cannot be compiled,
 * or keeps dying, and every caller then uses the original cliclick /
 * screencapture path. (The frontmost-app check always uses lsappinfo: see
 * the note at the end of desktop.swift.)
 */

import { NativeHelper } from './nativeHelper.js';

export interface HelperDisplay {
  /** CGDirectDisplayID. */
  id: number;
  name: string;
  isMain: boolean;
  /** Top-left in global logical points. */
  originX: number;
  originY: number;
  logicalWidth: number;
  logicalHeight: number;
  scaleFactor: number;
}

export interface DesktopHelper {
  displays(): Promise<HelperDisplay[]>;
  cursor(): Promise<{ x: number; y: number }>;
  /** PNG of the display at tw x th, taken once the screen settles (0/0: at once). */
  shot(displayId: number, tw: number, th: number, minMs: number, maxMs: number): Promise<Buffer>;
  /** Region is in pixels of the last shot. Null when the helper holds no frame. */
  zoom(region: readonly [number, number, number, number], ow: number, oh: number): Promise<Buffer | null>;
  close(): void;
}

export interface HelperTransport {
  request(line: string): Promise<string>;
  close(): void;
}

export function helperEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CU_NATIVE_HELPER !== '0';
}

export function createDesktopHelper(t: HelperTransport): DesktopHelper {
  return {
    async displays() {
      return JSON.parse(await t.request('displays')) as HelperDisplay[];
    },
    async cursor() {
      const [x, y] = (await t.request('pos')).split(' ').map(Number);
      if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) {
        throw new Error('Desktop helper returned an unparseable cursor position.');
      }
      return { x, y };
    },
    async shot(displayId, tw, th, minMs, maxMs) {
      return Buffer.from(await t.request(`shot ${displayId} ${tw} ${th} ${minMs} ${maxMs}`), 'base64');
    },
    async zoom(region, ow, oh) {
      try {
        return Buffer.from(await t.request(`zoom ${region.join(' ')} ${ow} ${oh}`), 'base64');
      } catch (e) {
        if (e instanceof Error && /no frame/.test(e.message)) return null;
        throw e;
      }
    },
    close() {
      t.close();
    },
  };
}

/** Process-level failures (exit, timeout), as opposed to an "err" reply. */
function isTransportFailure(e: unknown): boolean {
  return e instanceof Error && /exited with code|did not respond|Failed to compile|source is missing|EPIPE|ENOENT/.test(e.message);
}

const MAX_CONSECUTIVE_FAILURES = 2;

let shared: Promise<DesktopHelper | null> | null = null;
let sharedTransport: HelperTransport | null = null;
let disabled = false;

function disable(reason: string): void {
  if (disabled) return;
  disabled = true;
  sharedTransport?.close();
  sharedTransport = null;
  process.stderr.write(`[computer-use] desktop helper unavailable, using cliclick/screencapture: ${reason}\n`);
}

/**
 * The shared helper, or null when it is disabled, cannot be built, or has
 * failed twice in a row at the process level.
 */
export function getDesktopHelper(): Promise<DesktopHelper | null> {
  if (disabled || !helperEnabled()) return Promise.resolve(null);
  shared ??= (async () => {
    const native = new NativeHelper({ source: 'desktop.swift', binPrefix: 'cudesk', label: 'Desktop' });
    let failures = 0;
    const transport: HelperTransport = {
      close: () => native.close(),
      async request(line) {
        try {
          const out = await native.request(line);
          failures = 0;
          return out;
        } catch (e) {
          if (isTransportFailure(e) && ++failures >= MAX_CONSECUTIVE_FAILURES) {
            disable(e instanceof Error ? e.message : String(e));
          }
          throw e;
        }
      },
    };
    sharedTransport = transport;
    const helper = createDesktopHelper(transport);
    try {
      await helper.displays();
    } catch (e) {
      disable(e instanceof Error ? e.message : String(e));
      return null;
    }
    return helper;
  })();
  return shared.then((h) => (disabled ? null : h));
}

export function closeDesktopHelper(): void {
  sharedTransport?.close();
  sharedTransport = null;
  shared = null;
}
