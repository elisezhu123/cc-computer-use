/**
 * Screenshot capture. Produces exactly what the model sees, and reports the
 * dimensions it produced so coords.ts has a basis to map against.
 *
 * Capture is by display index (see display.ts) - never implicit, because on a
 * multi-monitor machine the implicit capture is the main display and the model
 * may be reasoning about a different one.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { API_RESIZE_PARAMS, targetImageSize } from './imageResize.js';
import type { ScreenshotDims } from './coords.js';
import type { AttachedDisplay } from './display.js';
import type { DesktopHelper } from './desktopHelper.js';

const execFileAsync = promisify(execFile);

export interface CapturedScreenshot {
  /** PNG bytes at exactly targetWidth x targetHeight. */
  data: Buffer;
  dims: ScreenshotDims;
  /** Where it was written if save_to_disk was set. */
  savedPath?: string;
  /**
   * Set when the desktop helper took this screenshot: names the
   * full-resolution frame it kept, for zoom. Absent for a screencapture frame.
   */
  frameId?: number;
}

/**
 * The display being captured is gone, or is no longer where or what the
 * server measured (moved, different resolution or scale). Coordinates mapped
 * with the old geometry would land in the wrong place, so the caller must
 * re-detect displays and require a new screenshot.
 */
export class DisplayChangedError extends Error {
  constructor(detail: string) {
    super(`The display configuration changed (${detail}). Take a new screenshot before continuing.`);
    this.name = 'DisplayChangedError';
  }
}

type ScreencaptureFn = (displayIndex: number) => Promise<{ data: Buffer; dims: ScreenshotDims }>;

async function captureRaw(displayIndex: number): Promise<string> {
  const path = join(tmpdir(), `cu-shot-${process.pid}-${Date.now()}.png`);
  try {
    await execFileAsync('screencapture', ['-x', '-D', String(displayIndex), path]);
  } catch (e) {
    throw new Error(
      `screencapture failed for display ${displayIndex}. ` +
        `This usually means Screen Recording permission is missing. (${String(e)})`,
    );
  }
  return path;
}

export interface CaptureOptions {
  /**
   * Wait for the screen to stop changing before capturing: at least minMs, at
   * most maxMs. Only the desktop helper can do this; without it the caller
   * sleeps a fixed time instead (see autoScreenshot.ts).
   */
  settle?: { minMs: number; maxMs: number };
  saveToDiskPath?: string;
}

/**
 * Capture a display at the API's target size, so the server-side transcoder
 * early-returns and the model's pixel space is exactly what we can invert.
 *
 * With the desktop helper this is one in-process capture already scaled to the
 * target size. Without it: screencapture to a file, then sharp to resize.
 * Never upscales: targetImageSize returns the input size when it already fits.
 */
export async function capture(
  display: AttachedDisplay,
  opts: CaptureOptions = {},
  helper: DesktopHelper | null = null,
  screencapture: ScreencaptureFn = captureWithScreencapture,
): Promise<CapturedScreenshot> {
  let data: Buffer | undefined;
  let dims: ScreenshotDims | undefined;
  let frameId: number | undefined;

  if (helper && display.displayId !== undefined) {
    const g = display.geometry;
    const [tw, th] = targetImageSize(
      Math.round(g.logicalWidth * g.scaleFactor),
      Math.round(g.logicalHeight * g.scaleFactor),
      API_RESIZE_PARAMS,
    );
    let shot;
    try {
      shot = await helper.shot(display.displayId, tw, th, opts.settle?.minMs ?? 0, opts.settle?.maxMs ?? 0);
    } catch (e) {
      if (e instanceof Error && /no such display/.test(e.message)) {
        throw new DisplayChangedError(`"${display.name}" is no longer attached`);
      }
      // Any other helper failure: this one capture goes through screencapture
      // instead of failing the tool call.
    }
    if (shot) {
      const now = shot.geometry;
      const same =
        Math.abs(now.originX - (g.originX ?? 0)) < 1 &&
        Math.abs(now.originY - (g.originY ?? 0)) < 1 &&
        Math.abs(now.logicalWidth - g.logicalWidth) < 1 &&
        Math.abs(now.logicalHeight - g.logicalHeight) < 1 &&
        Math.abs(now.scaleFactor - g.scaleFactor) < 0.01;
      if (!same) throw new DisplayChangedError(`"${display.name}" moved or changed resolution`);
      data = shot.png;
      dims = { targetWidth: tw, targetHeight: th };
      frameId = shot.frameId;
    }
  }
  if (!data || !dims) {
    ({ data, dims } = await screencapture(display.index));
  }

  let savedPath: string | undefined;
  if (opts.saveToDiskPath) {
    await writeFile(opts.saveToDiskPath, data);
    savedPath = opts.saveToDiskPath;
  }
  return { data, dims, savedPath, frameId };
}

async function captureWithScreencapture(
  displayIndex: number,
): Promise<{ data: Buffer; dims: ScreenshotDims }> {
  const raw = await captureRaw(displayIndex);
  try {
    const image = sharp(raw);
    const meta = await image.metadata();
    if (!meta.width || !meta.height) {
      throw new Error('screencapture produced an image with no readable dimensions.');
    }

    const [tw, th] = targetImageSize(meta.width, meta.height, API_RESIZE_PARAMS);

    let pipeline = image;
    if (tw !== meta.width || th !== meta.height) {
      pipeline = pipeline.resize(tw, th, { fit: 'fill' });
    }
    return { data: await pipeline.png().toBuffer(), dims: { targetWidth: tw, targetHeight: th } };
  } finally {
    await unlink(raw).catch(() => {});
  }
}

/**
 * Higher-resolution view of a region of the last full screenshot, for reading
 * small text. Read-only: it does NOT change the coordinate basis, which stays
 * the full-screen screenshot. Ported from the official `zoom` tool semantics.
 *
 * Given the desktop helper and the id of the frame it kept for that
 * screenshot, the crop comes from that full-resolution frame, so the zoom shows detail the downscaled
 * screenshot does not have. Otherwise (no helper, the helper restarted and
 * lost its frame, or a background mode whose screenshots are not the
 * desktop's) the screenshot itself is cropped and upscaled.
 */
export async function zoomRegion(
  fullScreenshotPng: Buffer,
  region: readonly [number, number, number, number],
  helper: DesktopHelper | null = null,
  frameId?: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const [x0, y0, x1, y1] = region;
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 1 || height < 1) {
    throw new Error(`Zoom region must be at least 1x1, got ${width}x${height}.`);
  }

  // Upscale to the long-edge cap so text is legible.
  const scale = Math.min(
    4,
    Math.max(1, API_RESIZE_PARAMS.maxTargetPx / Math.max(width, height)),
  );
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);

  // Only a screenshot the helper itself took has a frame there to crop.
  if (helper && frameId !== undefined) {
    const fromFrame = await helper.zoom(frameId, region, outW, outH).catch(() => null);
    if (fromFrame) return { data: fromFrame, width: outW, height: outH };
  }

  const cropped = sharp(fullScreenshotPng).extract({ left: x0, top: y0, width, height });
  const data = await cropped.resize(outW, outH, { fit: 'fill' }).png().toBuffer();
  return { data, width: outW, height: outH };
}

export async function readFileBuffer(path: string): Promise<Buffer> {
  return readFile(path);
}
