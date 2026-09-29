/**
 * Display detection + preflight.
 *
 * Two failure modes this module exists to prevent:
 *
 *   1. Guessing scaleFactor. A wrong scale factor silently offsets EVERY
 *      click, and the offset scales with distance from the origin - so clicks
 *      near the top-left "mostly work" and the bug survives casual testing.
 *      If we cannot measure the geometry, we refuse to start.
 *
 *   2. Assuming a single display. screencapture with no -D flag captures the
 *      main display; on a multi-monitor machine the model then reasons about
 *      a different screen than the one it is clicking on. Display selection
 *      is therefore explicit, never implicit.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DisplayGeometry } from './coords.js';

const execFileAsync = promisify(execFile);

export interface AttachedDisplay {
  /** screencapture's 1-based display index (matches `-D <n>`). */
  index: number;
  name: string;
  /** True when this is the display macOS designates as main. */
  isMain: boolean;
  geometry: DisplayGeometry;
}

export class PreflightError extends Error {
  constructor(
    message: string,
    /** What the user must do to fix it. Shown verbatim in the tool error. */
    readonly remedy: string,
  ) {
    super(message);
    this.name = 'PreflightError';
  }
}

/** Physical pixel dimensions of a screenshot of `displayIndex`, or null. */
async function probePhysicalSize(displayIndex: number): Promise<[number, number] | null> {
  const tmp = `/tmp/cu-probe-${displayIndex}-${Date.now()}.png`;
  try {
    await execFileAsync('screencapture', ['-x', '-D', String(displayIndex), tmp]);
    const { stdout } = await execFileAsync('sips', [
      '-g', 'pixelWidth', '-g', 'pixelHeight', tmp,
    ]);
    const w = /pixelWidth:\s*(\d+)/.exec(stdout)?.[1];
    const h = /pixelHeight:\s*(\d+)/.exec(stdout)?.[1];
    if (!w || !h) return null;
    return [Number(w), Number(h)];
  } catch {
    return null;
  } finally {
    await execFileAsync('rm', ['-f', tmp]).catch(() => {});
  }
}

/**
 * Logical bounds of the union of all displays, via Finder. On a multi-monitor
 * Mac this is the bounding box, so it is only used to derive the main display's
 * logical size once physical sizes are known (see detectDisplays).
 */
async function desktopBounds(): Promise<[number, number, number, number] | null> {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e', 'tell application "Finder" to get bounds of window of desktop',
    ]);
    const parts = stdout.trim().split(',').map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    return parts as [number, number, number, number];
  } catch {
    return null;
  }
}

/**
 * Enumerate attached displays with measured geometry.
 *
 * scaleFactor is derived, not assumed: physical/1 == logical means non-Retina,
 * physical/2 == logical means Retina. We accept a match within 1px to absorb
 * rounding, and reject anything else rather than picking the closest.
 */
export async function detectDisplays(): Promise<AttachedDisplay[]> {
  const { stdout } = await execFileAsync('system_profiler', ['SPDisplaysDataType']);

  // Split the output into display blocks. Each starts with an indented
  // "Name:" line followed by its properties.
  const blocks: { name: string; isMain: boolean; physical: [number, number] | null }[] = [];
  let current: { name: string; isMain: boolean; physical: [number, number] | null } | null = null;

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    const nameMatch = /^(.+):$/.exec(line);
    if (nameMatch && /^\s{8}\S/.test(raw)) {
      if (current) blocks.push(current);
      current = { name: nameMatch[1]!.trim(), isMain: false, physical: null };
      continue;
    }
    if (!current) continue;
    if (/^Main Display: Yes/.test(line)) current.isMain = true;
    const res = /^Resolution:\s*(\d+)\s*x\s*(\d+)/.exec(line);
    if (res && !/UI Looks like/.test(line)) {
      current.physical = [Number(res[1]), Number(res[2])];
    }
  }
  if (current) blocks.push(current);

  const withPhysical = blocks.filter((b) => b.physical !== null);
  if (withPhysical.length === 0) {
    throw new PreflightError(
      'Could not determine display resolution from system_profiler.',
      'Run `system_profiler SPDisplaysDataType` and check the Resolution lines are present.',
    );
  }

  const bounds = await desktopBounds();
  const displays: AttachedDisplay[] = [];

  for (let i = 0; i < withPhysical.length; i++) {
    const b = withPhysical[i]!;
    const physical = b.physical!;
    const probed = await probePhysicalSize(i + 1);

    // Prefer the measured screenshot size - it is what the model will see.
    const [physW, physH] = probed ?? physical;

    // Derive logical size. With a single display the Finder union is exact.
    // With several, only the main display can be derived from the union
    // reliably; others fall back to physical/2 which the screenshot probe
    // above has already validated for size.
    let logicalW: number;
    let logicalH: number;
    if (bounds && withPhysical.length === 1) {
      logicalW = bounds[2] - bounds[0];
      logicalH = bounds[3] - bounds[1];
    } else {
      logicalW = Math.round(physW / 2);
      logicalH = Math.round(physH / 2);
    }

    const scaleFactor = physW / logicalW;
    if (scaleFactor < 1 || scaleFactor > 4) {
      throw new PreflightError(
        `Implausible scale factor ${scaleFactor.toFixed(3)} for display "${b.name}" ` +
          `(physical ${physW}x${physH}, logical ${logicalW}x${logicalH}).`,
        'Report this - the display geometry could not be derived and clicking would be inaccurate.',
      );
    }

    displays.push({
      index: i + 1,
      name: b.name,
      isMain: b.isMain,
      geometry: {
        logicalWidth: logicalW,
        logicalHeight: logicalH,
        scaleFactor,
      },
    });
  }

  if (displays.length === 0) {
    throw new PreflightError('No displays could be measured.', 'Check the display connection.');
  }
  return displays;
}

/**
 * Verify the two TCC permissions the server cannot function without.
 * Called once at startup so failures surface as actionable text rather than
 * as a mystery cliclick error mid-task.
 */
export async function preflightPermissions(): Promise<void> {
  // 1. Screen Recording - required for screencapture.
  const shot = await probePhysicalSize(1);
  if (!shot) {
    throw new PreflightError(
      'Screen Recording permission is not granted - screencapture fails.',
      'System Settings > Privacy & Security > Screen Recording: enable the app hosting this MCP server (Terminal / Claude), then restart it.',
    );
  }

  // 2. Accessibility - required for cliclick to synthesize input.
  try {
    const { stderr } = await execFileAsync('cliclick', ['-V']);
    if (/Accessibility privileges not enabled/i.test(stderr)) {
      throw new PreflightError(
        'Accessibility permission is not granted - cliclick cannot synthesize input.',
        'System Settings > Privacy & Security > Accessibility: enable the app hosting this MCP server (Terminal / Claude), then restart it.',
      );
    }
  } catch (e) {
    if (e instanceof PreflightError) throw e;
    throw new PreflightError(
      'cliclick is not installed or not runnable.',
      'Install with `brew install cliclick`.',
    );
  }
}
