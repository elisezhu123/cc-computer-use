/**
 * Port of the API's image transcoder target-size algorithm.
 *
 * Pre-sizing screenshots to this function's output means the API's early-return
 * fires (tokens <= max) and the image is NOT resized server-side - so the model
 * sees exactly the dimensions in ScreenshotResult.width/height and the
 * coordinate mapping stays coherent.
 *
 * The long-edge constraint alone is NOT sufficient. On a 14" MBP
 * (1512x982 logical, 3024x1964 physical) the long edge caps at 1568, but
 * 1568x1014 is 56x37 = 2072 tokens - over budget - so the server would resize
 * again to 1372x887. The model would then click in 1372-space while the
 * mapping assumed 1568-space: ~14% coordinate error, silently. Both
 * constraints are enforced here.
 */

export interface ResizeParams {
  pxPerToken: number;
  maxTargetPx: number;
  maxTargetTokens: number;
}

/** Production defaults. Vision encoder uses 28px tiles; 1568 is both the
 * long-edge cap (56 tiles) AND the token budget. */
export const API_RESIZE_PARAMS: ResizeParams = {
  pxPerToken: 28,
  maxTargetPx: 1568,
  maxTargetTokens: 1568,
};

/** ceil(px / pxPerToken), integer ceil-div. */
export function nTokensForPx(px: number, pxPerToken: number): number {
  return Math.floor((px - 1) / pxPerToken) + 1;
}

export function nTokensForImg(
  width: number,
  height: number,
  pxPerToken: number,
): number {
  return nTokensForPx(width, pxPerToken) * nTokensForPx(height, pxPerToken);
}

/**
 * Binary-search along the width dimension for the largest image that:
 *   - preserves the input aspect ratio
 *   - has long edge <= maxTargetPx
 *   - has ceil(w/pxPerToken) * ceil(h/pxPerToken) <= maxTargetTokens
 *
 * Returns [width, height]. No-op if the input already satisfies all three.
 */
export function targetImageSize(
  width: number,
  height: number,
  params: ResizeParams = API_RESIZE_PARAMS,
): [number, number] {
  const { pxPerToken, maxTargetPx, maxTargetTokens } = params;

  if (
    width <= maxTargetPx &&
    height <= maxTargetPx &&
    nTokensForImg(width, height, pxPerToken) <= maxTargetTokens
  ) {
    return [width, height];
  }

  // Normalize to landscape for the search; transpose the result back.
  if (height > width) {
    const [w, h] = targetImageSize(height, width, params);
    return [h, w];
  }

  const aspectRatio = width / height;

  // Loop invariant: lowerBoundWidth is always valid, upperBoundWidth is
  // always invalid. ~12 iterations for a 4000px image.
  let upperBoundWidth = width;
  let lowerBoundWidth = 1;

  for (;;) {
    if (lowerBoundWidth + 1 === upperBoundWidth) {
      return [
        lowerBoundWidth,
        Math.max(Math.round(lowerBoundWidth / aspectRatio), 1),
      ];
    }

    const middleWidth = Math.floor((lowerBoundWidth + upperBoundWidth) / 2);
    const middleHeight = Math.max(Math.round(middleWidth / aspectRatio), 1);

    if (
      middleWidth <= maxTargetPx &&
      nTokensForImg(middleWidth, middleHeight, pxPerToken) <= maxTargetTokens
    ) {
      lowerBoundWidth = middleWidth;
    } else {
      upperBoundWidth = middleWidth;
    }
  }
}
