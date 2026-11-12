/**
 * Where a click should actually land, given what Accessibility says is under
 * and around the requested point.
 *
 * The model picks coordinates on a screenshot scaled to well under half the
 * screen's resolution, so on dense UI it is routinely a few pixels off and
 * lands in the gap between two controls. When that happens - the point is on
 * a bare container and a clickable control is within a few pixels - the click
 * moves onto that control, and the result says so.
 *
 * Pure: the Accessibility lookup itself lives in the desktop helper.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export interface HitElement {
  role: string;
  /** Title or description, already passed through sanitizeLabel. */
  label: string;
  /** Global logical points. */
  frame: Rect;
  bundleId: string | null;
}

export interface HitResult {
  /** The element under the point, or null when the lookup failed. */
  at: HitElement | null;
  /** Other elements found within the search radius. */
  nearby: HitElement[];
}

export interface SnapOptions {
  frontmostBundleId: string | null;
  /** Logical points. */
  radius: number;
  enabled: boolean;
  /** The active display, in global logical points. */
  bounds: Rect;
}

export interface ClickChoice {
  point: { x: number; y: number };
  snapped: boolean;
  element: HitElement | null;
}

/** Controls that do something when clicked. */
export const ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
  'AXButton', 'AXCheckBox', 'AXRadioButton', 'AXPopUpButton', 'AXMenuButton',
  'AXMenuItem', 'AXMenuBarItem', 'AXLink', 'AXTextField', 'AXTextArea',
  'AXComboBox', 'AXSlider', 'AXIncrementor', 'AXDisclosureTriangle', 'AXTab',
  'AXSegment',
]);

/**
 * Bare layout containers: a click that lands on one of these hit a gap.
 * Deliberately excludes web areas, text, images and canvases, where the exact
 * point is meaningful and must not be second-guessed.
 */
export const CONTAINER_ROLES: ReadonlySet<string> = new Set([
  'AXWindow', 'AXGroup', 'AXToolbar', 'AXScrollArea', 'AXSplitGroup',
  'AXTabGroup', 'AXLayoutArea', 'AXUnknown',
]);

/** Keep the click this far inside a control's edge. */
const INSET = 2;
const MAX_LABEL_CHARS = 60;

export function snapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CU_CLICK_SNAP !== '0';
}

/**
 * Control titles are set by whatever app or web page is on screen, and they
 * end up in tool results the model reads. Same treatment as app names in
 * apps.ts: a short length cap and a character allowlist, so a title cannot
 * carry markup or instructions.
 */
export function sanitizeLabel(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} .&+_'#@()\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_CHARS);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/** The point inside `frame` (inset from its edges) closest to `p`. */
function nearestPointIn(p: { x: number; y: number }, frame: Rect): { x: number; y: number } {
  const axis = (v: number, start: number, size: number) =>
    size < INSET * 2 ? start + size / 2 : clamp(v, start + INSET, start + size - INSET);
  return { x: axis(p.x, frame.x, frame.w), y: axis(p.y, frame.y, frame.h) };
}

export function chooseClickPoint(
  point: { x: number; y: number },
  hit: HitResult,
  opts: SnapOptions,
): ClickChoice {
  const unchanged: ClickChoice = { point, snapped: false, element: hit.at };
  if (!opts.enabled || !hit.at || !CONTAINER_ROLES.has(hit.at.role)) return unchanged;

  let best: { el: HitElement; at: { x: number; y: number }; dist: number } | null = null;
  for (const el of hit.nearby) {
    if (!ACTIONABLE_ROLES.has(el.role)) continue;
    // Snapping must never move a click onto an app the frontmost-app gate did
    // not check.
    if (!opts.frontmostBundleId || el.bundleId !== opts.frontmostBundleId) continue;
    const at = nearestPointIn(point, el.frame);
    const dist = Math.hypot(at.x - point.x, at.y - point.y);
    if (dist <= opts.radius && (!best || dist < best.dist)) best = { el, at, dist };
  }
  if (!best) return unchanged;

  const b = opts.bounds;
  return {
    point: {
      x: clamp(Math.round(best.at.x), b.x, b.x + b.w - 1),
      y: clamp(Math.round(best.at.y), b.y, b.y + b.h - 1),
    },
    snapped: true,
    element: best.el,
  };
}

/** One sentence for the tool result; empty when nothing is known. */
export function describeHit(choice: ClickChoice): string {
  if (!choice.element) return '';
  const { role, label } = choice.element;
  const what = label ? `${role} "${label}"` : role;
  return choice.snapped ? `snapped to nearest control ${what}.` : `Hit: ${what}.`;
}
