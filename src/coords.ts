/**
 * Coordinate mapping: model-space (screenshot pixels) -> cliclick-space
 * (Cocoa logical points).
 *
 * The chain is:
 *
 *   cliclick  <- logical points      (input space)
 *   screencapture <- physical pixels (logical * scaleFactor)
 *   model     <- apiTarget pixels    (targetImageSize(physical))
 *
 * Because the screenshot handed to the model IS apiTarget-sized, the
 * model->physical step is identity, and the mapping to cliclick space is:
 *
 *   logical = model * (logicalW / targetW)
 *
 * Both dimensions are required. It is NOT `1 / scaleFactor` - that mistake
 * produces a ~21% click offset on a 14" MBP (logical 1512, target 1372).
 *
 * Rounding: `Math.round` on the final value only. Intermediate rounding on a
 * Retina 2x display would quantize to even logical points and make >1px
 * targets unclickable.
 */

export interface DisplayGeometry {
  /** Cocoa points - what cliclick consumes. */
  logicalWidth: number;
  logicalHeight: number;
  /** logical -> physical multiplier. 2 on Retina, 1 on non-Retina. */
  scaleFactor: number;
}

export interface ScreenshotDims {
  /** Dimensions of the image actually shown to the model. */
  targetWidth: number;
  targetHeight: number;
}

/** Sentinel screenshot dims for calls made before any screenshot exists. */
export const NO_SCREENSHOT: ScreenshotDims | null = null;

export function physicalSize(d: DisplayGeometry): [number, number] {
  return [
    Math.round(d.logicalWidth * d.scaleFactor),
    Math.round(d.logicalHeight * d.scaleFactor),
  ];
}

/**
 * Map a model-space screenshot pixel to cliclick logical points.
 *
 * If no screenshot has been taken yet, dims is null and the value is passed
 * through unchanged - the caller is then responsible for having taken a
 * screenshot first. Every coordinate-bearing tool takes a screenshot, so this
 * path only matters for cursor_position on a cold session.
 */
export function modelToLogical(
  x: number,
  y: number,
  dims: ScreenshotDims | null,
  display: DisplayGeometry,
): { x: number; y: number } {
  if (!dims) {
    return { x: Math.round(x), y: Math.round(y) };
  }
  const sx = display.logicalWidth / dims.targetWidth;
  const sy = display.logicalHeight / dims.targetHeight;
  return { x: Math.round(x * sx), y: Math.round(y * sy) };
}

/** Inverse of modelToLogical - for cursor_position reporting. */
export function logicalToModel(
  x: number,
  y: number,
  dims: ScreenshotDims | null,
  display: DisplayGeometry,
): { x: number; y: number } {
  if (!dims) {
    return { x: Math.round(x), y: Math.round(y) };
  }
  const sx = dims.targetWidth / display.logicalWidth;
  const sy = dims.targetHeight / display.logicalHeight;
  return { x: Math.round(x * sx), y: Math.round(y * sy) };
}

/** Crop a region from model-space into model-space [x0,y0,x1,y1], clamped. */
export function clampRegion(
  region: readonly number[],
  dims: ScreenshotDims,
): [number, number, number, number] {
  const [rx0, ry0, rx1, ry1] = region as [number, number, number, number];
  const x0 = Math.max(0, Math.min(Math.round(Math.min(rx0, rx1)), dims.targetWidth - 1));
  const y0 = Math.max(0, Math.min(Math.round(Math.min(ry0, ry1)), dims.targetHeight - 1));
  const x1 = Math.max(x0 + 1, Math.min(Math.round(Math.max(rx0, rx1)), dims.targetWidth));
  const y1 = Math.max(y0 + 1, Math.min(Math.round(Math.max(ry0, ry1)), dims.targetHeight));
  return [x0, y0, x1, y1];
}
