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
import { sanitizeLabel, type HitElement, type HitResult } from './snap.js';

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

export interface HelperShot {
  png: Buffer;
  /** Names the full-resolution frame the helper kept for zoom. */
  frameId: number;
  /** The display's geometry at the moment of capture. */
  geometry: {
    originX: number;
    originY: number;
    logicalWidth: number;
    logicalHeight: number;
    scaleFactor: number;
  };
}

export interface DesktopHelper {
  displays(): Promise<HelperDisplay[]>;
  cursor(): Promise<{ x: number; y: number }>;
  /** The display at tw x th, taken once the screen settles (0/0: at once). */
  shot(displayId: number, tw: number, th: number, minMs: number, maxMs: number): Promise<HelperShot>;
  /**
   * Crop of the full-resolution frame behind the shot with this frameId;
   * region is in that shot's pixels. Null when the helper no longer holds
   * that frame (it restarted, or a later shot replaced it).
   */
  zoom(
    frameId: number,
    region: readonly [number, number, number, number],
    ow: number,
    oh: number,
  ): Promise<Buffer | null>;
  /**
   * What Accessibility reports at a point and within `radius` of it. Never
   * throws: a failed or timed-out lookup is an empty result, so a click can
   * always go ahead without it.
   */
  hit(x: number, y: number, radius: number): Promise<HitResult>;
  /** Move, settle 50ms, click. button: 0 left, 1 right, 2 middle. flags: CGEventFlags. */
  click(button: 0 | 1 | 2, x: number, y: number, count: number, flags: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  /** Left button down / up at the current cursor position. */
  down(): Promise<void>;
  up(): Promise<void>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
  close(): void;
}

export interface HelperTransport {
  request(line: string): Promise<string>;
  close(): void;
}

export function helperEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CU_NATIVE_HELPER !== '0';
}

/** Global logical points as integers; rejects NaN/Infinity before they reach the helper. */
function pt(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('A finite coordinate is required.');
  return `${Math.round(x)} ${Math.round(y)}`;
}

/**
 * Everything in a hit element is supplied by whatever app is under the
 * pointer, including apps the session never granted, and the role and label
 * end up in tool results the model reads. Roles must look like roles, labels
 * are sanitized, and an element without a usable frame is dropped.
 */
function cleanElement(raw: unknown): HitElement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const el = raw as Record<string, unknown>;
  const f = el.frame as Record<string, unknown> | null | undefined;
  if (typeof f !== 'object' || f === null) return null;
  const nums = [f.x, f.y, f.w, f.h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const role = typeof el.role === 'string' && /^AX[A-Za-z]{1,40}$/.test(el.role) ? el.role : 'AXUnknown';
  const out: HitElement = {
    role,
    label: sanitizeLabel(typeof el.label === 'string' ? el.label : ''),
    frame: { x: f.x as number, y: f.y as number, w: f.w as number, h: f.h as number },
    bundleId: typeof el.bundleId === 'string' ? el.bundleId : null,
  };
  if (el.inWeb === true) out.inWeb = true;
  return out;
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
      const reply = await t.request(`shot ${displayId} ${tw} ${th} ${minMs} ${maxMs}`);
      const parts = reply.split(' ');
      const [frameId, originX, originY, logicalWidth, logicalHeight, scaleFactor] = parts.slice(0, 6).map(Number);
      if (parts.length !== 7 || [frameId, originX, originY, logicalWidth, logicalHeight, scaleFactor].some((n) => !Number.isFinite(n))) {
        throw new Error('Desktop helper returned an unparseable screenshot reply.');
      }
      return {
        png: Buffer.from(parts[6]!, 'base64'),
        frameId: frameId!,
        geometry: {
          originX: originX!, originY: originY!,
          logicalWidth: logicalWidth!, logicalHeight: logicalHeight!, scaleFactor: scaleFactor!,
        },
      };
    },
    async zoom(frameId, region, ow, oh) {
      try {
        return Buffer.from(await t.request(`zoom ${frameId} ${region.join(' ')} ${ow} ${oh}`), 'base64');
      } catch (e) {
        if (e instanceof Error && /no frame/.test(e.message)) return null;
        throw e;
      }
    },
    async hit(x, y, radius) {
      try {
        const raw = JSON.parse(await t.request(`hit ${pt(x, y)} ${radius.toFixed(2)}`)) as {
          at?: unknown;
          nearby?: unknown;
        };
        const nearby = Array.isArray(raw.nearby) ? raw.nearby : [];
        return {
          at: cleanElement(raw.at),
          nearby: nearby.map(cleanElement).filter((e): e is HitElement => e !== null),
        };
      } catch {
        return { at: null, nearby: [] };
      }
    },
    async click(button, x, y, count, flags) {
      await t.request(`click ${button} ${pt(x, y)} ${count} ${flags}`);
    },
    async move(x, y) {
      await t.request(`move ${pt(x, y)}`);
    },
    async down() {
      await t.request('down');
    },
    async up() {
      await t.request('up');
    },
    async drag(from, to) {
      await t.request(`drag ${pt(from.x, from.y)} ${pt(to.x, to.y)}`);
    },
    close() {
      t.close();
    },
  };
}

/** Process-level failures (exit, timeout), as opposed to an "err" reply. */
function isTransportFailure(e: unknown): boolean {
  return e instanceof Error && /exited with code|did not respond|could not be started|not accepting input|Failed to compile|source is missing/.test(e.message);
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
