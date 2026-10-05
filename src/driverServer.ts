/**
 * Shared layer for the background modes (browser, native app). Each mode
 * supplies a Driver - the few primitives that actually deliver input to its
 * target - and this module provides the rest of the tool contract on top:
 * screenshot-relative coordinates, zoom, cursor tracking, computer_batch, and
 * result formatting. The desktop server (server.ts) predates this and keeps
 * its own dispatcher.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import sharp from 'sharp';

import { buildComputerUseTools, BATCH_ACTION_ITEM_SCHEMA, FRONTMOST_GATE_DESC } from './tools.js';
import { API_RESIZE_PARAMS, targetImageSize } from './imageResize.js';
import { clampRegion, type ScreenshotDims } from './coords.js';
import { zoomRegion } from './screen.js';
import type { ScrollDirection } from './types.js';
import { autoScreenshotEnabled, withAutoScreenshot, AUTO_SCREENSHOT_SETTLE_MS } from './autoScreenshot.js';

export type MouseButton = 'left' | 'right' | 'middle';

/** Input primitives in the driver's own coordinate units (CSS px, window points). */
export interface Driver {
  /** A PNG of the target plus its size in driver units, and a label for the note. */
  capture(): Promise<{ png: Buffer; width: number; height: number; label: string }>;
  click(x: number, y: number, button: MouseButton, count: number, modifiersChord: string): Promise<void>;
  move(x: number, y: number): Promise<void>;
  mouseDown(x: number, y: number): Promise<void>;
  mouseUp(x: number, y: number): Promise<void>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
  type(text: string): Promise<void>;
  key(chord: string, repeat: number): Promise<void>;
  hold(chord: string, seconds: number): Promise<void>;
  scroll(x: number, y: number, direction: ScrollDirection, ticks: number): Promise<void>;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };
export interface ToolResult { content: ContentBlock[]; isError?: boolean }

/** Tools every driver supports. */
export const DRIVER_TOOL_NAMES: ReadonlySet<string> = new Set([
  'screenshot', 'zoom', 'cursor_position',
  'left_click', 'double_click', 'triple_click', 'right_click', 'middle_click',
  'mouse_move', 'left_click_drag', 'left_mouse_down', 'left_mouse_up',
  'type', 'key', 'hold_key', 'scroll', 'wait', 'computer_batch',
]);

/**
 * The desktop tool schemas, restricted to `names`, with the desktop-only
 * frontmost-gate wording removed (a background mode has no frontmost app).
 */
export function buildDriverTools(names: ReadonlySet<string>, installedAppNames: readonly string[] = []): Tool[] {
  return buildComputerUseTools(installedAppNames)
    .filter((t) => names.has(t.name))
    .map((t) => ({
      ...t,
      description: (t.description ?? '')
        .replace(` ${FRONTMOST_GATE_DESC}`, '')
        .replace(`${FRONTMOST_GATE_DESC} `, '')
        .replace(' The gate runs before EACH action inside the batch.', '')
        .replace('Returns an error if the allowlist is empty. ', '')
        .replace(
          ' Implemented via a synthesized scroll-wheel button event, so it requires the scroll helper to have compiled.',
          '',
        )
        .trim(),
    }));
}

export function text(s: string): ToolResult {
  return { content: [{ type: 'text', text: s }] };
}

function reqCoord(value: unknown, name = 'coordinate'): [number, number] {
  const c = value as number[] | undefined;
  if (!c || c.length !== 2 || c.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
    throw new Error(`A ${name} of [x, y] is required.`);
  }
  return [c[0]!, c[1]!];
}

export class DriverSession {
  /** The last screenshot, and the driver-unit size it was taken at. */
  lastScreenshot: { png: Buffer; dims: ScreenshotDims; width: number; height: number } | null = null;
  /** Last pointer position in driver units. */
  cursor = { x: 0, y: 0 };
  /** Attach a screenshot to each screen-changing action (see autoScreenshot.ts). */
  autoScreenshot = autoScreenshotEnabled();
  autoScreenshotSettleMs = AUTO_SCREENSHOT_SETTLE_MS;

  constructor(readonly driver: Driver) {}

  /** Model-space (screenshot pixels) -> driver units. */
  toUnits(x: number, y: number): { x: number; y: number } {
    const s = this.lastScreenshot;
    if (!s) return { x, y };
    return { x: (x * s.width) / s.dims.targetWidth, y: (y * s.height) / s.dims.targetHeight };
  }

  toModel(x: number, y: number): { x: number; y: number } {
    const s = this.lastScreenshot;
    if (!s) return { x: Math.round(x), y: Math.round(y) };
    return {
      x: Math.round((x * s.dims.targetWidth) / s.width),
      y: Math.round((y * s.dims.targetHeight) / s.height),
    };
  }

  async screenshot(): Promise<ToolResult> {
    const shot = await this.driver.capture();
    const meta = await sharp(shot.png).metadata();
    // Size the image as the API will see it, based on the captured pixels
    // (a Retina window capture is 2x its point size).
    const [tw, th] = targetImageSize(meta.width!, meta.height!, API_RESIZE_PARAMS);
    const png = tw === meta.width && th === meta.height
      ? shot.png
      : await sharp(shot.png).resize(tw, th, { fit: 'fill' }).png().toBuffer();
    this.lastScreenshot = { png, dims: { targetWidth: tw, targetHeight: th }, width: shot.width, height: shot.height };
    return {
      content: [
        {
          type: 'text',
          text: `${tw}x${th} pixels of ${shot.label}. All click coordinates are relative to an image of this size.`,
        },
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      ],
    };
  }

  /** One action; returns a one-line summary. Shared by single tools and computer_batch. */
  async run(action: string, a: Record<string, unknown>): Promise<string> {
    const d = this.driver;
    const at = (name = 'coordinate') => {
      const [mx, my] = reqCoord(a[name], name);
      return { m: [mx, my] as const, p: this.toUnits(mx, my) };
    };
    const click = async (button: MouseButton, count: number) => {
      const { m, p } = at();
      await d.click(p.x, p.y, button, count, a.text ? String(a.text) : '');
      this.cursor = p;
      return `${button} click${count > 1 ? ` x${count}` : ''} at screenshot (${m[0]}, ${m[1]})`;
    };

    switch (action) {
      case 'left_click': return click('left', 1);
      case 'double_click': return click('left', 2);
      case 'triple_click': return click('left', 3);
      case 'right_click': return click('right', 1);
      case 'middle_click': return click('middle', 1);
      case 'mouse_move': {
        const { m, p } = at();
        await d.move(p.x, p.y);
        this.cursor = p;
        return `mouse_move to screenshot (${m[0]}, ${m[1]})`;
      }
      case 'left_click_drag': {
        const { m, p: to } = at();
        const from = a.start_coordinate ? at('start_coordinate').p : this.cursor;
        await d.drag(from, to);
        this.cursor = to;
        return `dragged to screenshot (${m[0]}, ${m[1]})`;
      }
      case 'left_mouse_down': await d.mouseDown(this.cursor.x, this.cursor.y); return 'left_mouse_down';
      case 'left_mouse_up': await d.mouseUp(this.cursor.x, this.cursor.y); return 'left_mouse_up';
      case 'type': {
        const value = String(a.text ?? '');
        await d.type(value);
        return `typed ${value.length} characters`;
      }
      case 'key': {
        const repeat = Math.max(1, Math.min(Number(a.repeat ?? 1), 100));
        await d.key(String(a.text ?? ''), repeat);
        return `key ${String(a.text ?? '')}${repeat > 1 ? ` x${repeat}` : ''}`;
      }
      case 'hold_key': {
        const seconds = Math.min(Math.max(Number(a.duration ?? 0), 0), 100);
        await d.hold(String(a.text ?? ''), seconds);
        return `hold_key ${String(a.text ?? '')} for ${seconds}s`;
      }
      case 'scroll': {
        const { m, p } = at();
        const direction = String(a.scroll_direction ?? 'down') as ScrollDirection;
        const ticks = Math.min(Math.max(Number(a.scroll_amount ?? 1), 0), 100);
        await d.scroll(p.x, p.y, direction, ticks);
        this.cursor = p;
        return `scrolled ${direction} by ${ticks} ticks at screenshot (${m[0]}, ${m[1]})`;
      }
      case 'wait': {
        const seconds = Math.min(Math.max(Number(a.duration ?? 0), 0), 100);
        await new Promise((r) => setTimeout(r, seconds * 1000));
        return `wait ${seconds}s`;
      }
      case 'cursor_position': {
        const p = this.toModel(this.cursor.x, this.cursor.y);
        return `cursor at screenshot (${p.x}, ${p.y})`;
      }
      default:
        throw new Error(
          `Unknown action "${action}". Valid actions: ${BATCH_ACTION_ITEM_SCHEMA.properties.action.enum.join(', ')}.`,
        );
    }
  }

  /** Handles the DRIVER_TOOL_NAMES tools. Errors come back as isError results. */
  async dispatch(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.withScreenshot(name, args, await this.dispatchAction(name, args));
  }

  /** Adds the after-action screenshot when enabled. */
  withScreenshot(name: string, args: Record<string, unknown>, result: ToolResult): Promise<ToolResult> {
    if (!this.autoScreenshot) return Promise.resolve(result);
    return withAutoScreenshot(name, args, result, () => this.screenshot(), this.autoScreenshotSettleMs);
  }

  private async dispatchAction(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case 'screenshot':
          return await this.screenshot();

        case 'zoom': {
          const region = args.region as number[] | undefined;
          if (!region || region.length !== 4) throw new Error('zoom requires a region of [x0, y0, x1, y1].');
          if (!this.lastScreenshot) throw new Error('Take a screenshot before zooming.');
          const clamped = clampRegion(region, this.lastScreenshot.dims);
          const out = await zoomRegion(this.lastScreenshot.png, clamped);
          return {
            content: [
              {
                type: 'text',
                text:
                  `Zoomed (${clamped.join(', ')}) to ${out.width}x${out.height}. ` +
                  'Click coordinates still refer to the full screenshot, NOT this image.',
              },
              { type: 'image', data: out.data.toString('base64'), mimeType: 'image/png' },
            ],
          };
        }

        case 'computer_batch': {
          const actions = args.actions as Record<string, unknown>[] | undefined;
          if (!actions || actions.length === 0) throw new Error('computer_batch requires a non-empty actions array.');
          const results: string[] = [];
          let image: ContentBlock | null = null;
          for (let i = 0; i < actions.length; i++) {
            const a = actions[i]!;
            const action = String(a.action ?? '');
            try {
              if (action === 'screenshot') {
                const shot = await this.screenshot();
                image = shot.content.find((c) => c.type === 'image') ?? null;
                results.push(`${i + 1}. screenshot`);
              } else {
                results.push(`${i + 1}. ${await this.run(action, a)}`);
              }
            } catch (e) {
              return {
                isError: true,
                content: [{
                  type: 'text',
                  text:
                    `Batch stopped at action ${i + 1} of ${actions.length} (${action}): ` +
                    `${e instanceof Error ? e.message : String(e)}\n\n` +
                    `Completed before the failure:\n${results.join('\n') || '(none)'}`,
                }],
              };
            }
          }
          const summary = text(`Completed all ${actions.length} actions:\n${results.join('\n')}`);
          if (image) summary.content.push(image);
          return summary;
        }

        default:
          if (!DRIVER_TOOL_NAMES.has(name)) throw new Error(`Unknown tool "${name}".`);
          return text(await this.run(name, args));
      }
    } catch (e) {
      return errorResult(e);
    }
  }
}

/** Policy errors keep their code prefix ("not_granted: ..."), as in desktop mode. */
export function errorResult(e: unknown): ToolResult {
  const code = e instanceof Error && e.name === 'PolicyError' ? (e as Error & { code?: string }).code : undefined;
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text', text: code ? `${code}: ${message}` : message }] };
}
