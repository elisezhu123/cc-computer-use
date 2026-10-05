/**
 * The computer-use server: session state, the dispatcher, and the MCP wiring.
 *
 * Structure follows the official package: tools.ts owns the schemas, this file
 * owns execution. Every input action passes through `guard()` exactly once, so
 * there is a single place where the frontmost-app gate and the key blocklist
 * are enforced - including per-action inside computer_batch.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { buildComputerUseTools, BATCH_ACTION_ITEM_SCHEMA } from './tools.js';
import {
  detectDisplays,
  preflightPermissions,
  PreflightError,
  type AttachedDisplay,
} from './display.js';
import {
  modelToLogical,
  logicalToModel,
  clampRegion,
  physicalSize,
  type ScreenshotDims,
} from './coords.js';
import * as input from './input.js';
import { scrollAt, middleClick, closeScrollHelper } from './scroll.js';
import { capture, zoomRegion } from './screen.js';
import { pasteText, readClipboard, writeClipboard } from './clipboard.js';
import {
  listInstalledApps,
  getFrontmostBundleId,
  resolveApp,
  activateApp,
  filterAppsForDescription,
} from './apps.js';
import type { InstalledApp } from './types.js';
import { autoScreenshotEnabled, withAutoScreenshot } from './autoScreenshot.js';
import {
  newSession,
  assertActionAllowed,
  assertChordAllowed,
  tierForApp,
  PolicyError,
  type SessionState,
} from './policy.js';
import type { ScrollDirection } from './types.js';

const PRIMARY_FALLBACK_VIEWPORT = { logicalWidth: 1512, logicalHeight: 982, scaleFactor: 2 };

export interface ServerContext {
  displays: AttachedDisplay[];
  activeDisplayIndex: number;
  session: SessionState;
  /** Pixel space of the last full screenshot - the basis for ALL coordinates. */
  lastScreenshot: { png: Buffer; dims: ScreenshotDims } | null;
  installed: InstalledApp[];
  installedNames: string[];
  /** Attach a screenshot to screen-changing actions; defaults to CU_AUTO_SCREENSHOT. */
  autoScreenshot?: boolean;
}

function activeDisplay(ctx: ServerContext): AttachedDisplay {
  return (
    ctx.displays.find((d) => d.index === ctx.activeDisplayIndex) ?? ctx.displays[0]!
  );
}

/** Map model-space coords to cliclick logical points against the last screenshot. */
function toLogical(ctx: ServerContext, x: number, y: number): { x: number; y: number } {
  const d = activeDisplay(ctx);
  return modelToLogical(x, y, ctx.lastScreenshot?.dims ?? null, d.geometry);
}

/** The single enforcement point for every input action. */
async function guard(
  ctx: ServerContext,
  kind: 'read' | 'click' | 'type' | 'key' | 'scroll' | 'clipboard_read' | 'clipboard_write',
): Promise<void> {
  const frontmost = await getFrontmostBundleId();
  assertActionAllowed(ctx.session, frontmost, kind);
}

/** MCP content blocks we emit. Typed explicitly so a mixed text+image result
 * is expressible without fighting literal inference at every return site. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

function text(s: string): ToolResult {
  return { content: [{ type: 'text', text: s }] };
}

function textAndImage(s: string, png: Buffer): ToolResult {
  return {
    content: [
      { type: 'text', text: s },
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
    ],
  };
}

function errorResult(e: unknown): ToolResult {
  if (e instanceof PolicyError) {
    return { isError: true, content: [{ type: 'text', text: `${e.code}: ${e.message}` }] };
  }
  if (e instanceof PreflightError) {
    return {
      isError: true,
      content: [{ type: 'text', text: `preflight: ${e.message}\n\nHow to fix: ${e.remedy}` }],
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
  };
}

// ── Screenshot ───────────────────────────────────────────────────────────────

async function doScreenshot(ctx: ServerContext, saveToDisk: boolean): Promise<ToolResult> {
  if (ctx.session.allowedBundleIds === null) {
    throw new PolicyError(
      'request_access has not been called yet. Call it before taking screenshots.',
      'needs_access',
    );
  }
  const d = activeDisplay(ctx);
  const shot = await capture(d.index, saveToDisk ? `/tmp/cu-shot-${Date.now()}.png` : undefined);
  ctx.lastScreenshot = { png: shot.data, dims: shot.dims };

  const others = ctx.displays
    .filter((x) => x.index !== d.index)
    .map((x) => `${x.name} (index ${x.index})`)
    .join(', ');

  const note =
    `${shot.dims.targetWidth}x${shot.dims.targetHeight} pixels on "${d.name}" (display ${d.index}). ` +
    `All click coordinates are relative to an image of this size.` +
    (others ? ` Other attached displays: ${others}. Use switch_display to capture one.` : '') +
    (shot.savedPath ? ` Saved to ${shot.savedPath}.` : '');

  return textAndImage(note, shot.data);
}

// ── Single actions ───────────────────────────────────────────────────────────

async function doClick(
  ctx: ServerContext,
  button: 'left' | 'right' | 'middle',
  count: 1 | 2 | 3,
  coord: number[],
  modifiers: string,
): Promise<ToolResult> {
  await guard(ctx, 'click');
  const mods = modifiers ? input.chordModifiers(modifiers) : [];

  if (button === 'middle') {
    // cliclick has no middle-click token; the Swift helper synthesizes a
    // button-2 event instead.
    if (mods.length > 0) {
      throw new PolicyError(
        'Modifiers are not supported with middle_click. Use left_click with modifiers instead.',
        'bad_request',
      );
    }
    const p = toLogical(ctx, coord[0]!, coord[1]!);
    await middleClick(p.x, p.y, count);
    return text(`Middle-clicked${count > 1 ? ` x${count}` : ''} at screenshot (${coord[0]}, ${coord[1]}).`);
  }

  const p = toLogical(ctx, coord[0]!, coord[1]!);
  await input.moveAndClick(p.x, p.y, button, count, mods);
  return text(
    `Clicked ${button}${count > 1 ? ` x${count}` : ''} at screenshot (${coord[0]}, ${coord[1]}) ` +
      `= logical (${p.x}, ${p.y}).`,
  );
}

/** Above this length, pasting is much faster than cliclick typing each character. */
const PASTE_THRESHOLD_CHARS = 200;

/**
 * Type text. Multi-line text goes through the clipboard: cliclick's `t:` does
 * not translate newlines into Return, so a multi-line string would arrive as
 * one line. Requires the clipboardWrite grant. Long single-line text also
 * takes the clipboard path when that grant exists, for speed.
 */
async function doType(ctx: ServerContext, value: string): Promise<ToolResult> {
  await guard(ctx, 'type');

  if (!value.includes('\n') && value.length > PASTE_THRESHOLD_CHARS && ctx.session.grants.clipboardWrite) {
    await pasteText(value, async () => {
      await input.pressChord('cmd+v');
    });
    return text(`Typed ${value.length} characters via the clipboard.`);
  }

  if (value.includes('\n')) {
    if (!ctx.session.grants.clipboardWrite) {
      throw new PolicyError(
        'This text contains newlines, which requires the clipboard fast path, but clipboardWrite was not granted. ' +
          'Re-call request_access with clipboardWrite: true, or type the lines separately.',
        'needs_flag',
      );
    }
    const parts = value.split('\n');
    await pasteText(value, async () => {
      await input.pressChord('cmd+v');
    });
    return text(`Typed ${value.length} characters (${parts.length} lines) via the clipboard.`);
  }

  await input.typeText(value);
  return text(`Typed ${value.length} characters.`);
}

async function doScroll(
  ctx: ServerContext,
  coord: number[],
  direction: ScrollDirection,
  amount: number,
): Promise<ToolResult> {
  await guard(ctx, 'scroll');
  const p = toLogical(ctx, coord[0]!, coord[1]!);
  await scrollAt(p.x, p.y, direction, amount);
  return text(`Scrolled ${direction} by ${amount} ticks at screenshot (${coord[0]}, ${coord[1]}).`);
}

// ── Batch ────────────────────────────────────────────────────────────────────

/**
 * Execute actions sequentially, stopping at the first error.
 *
 * Coordinates for every action resolve against the pre-batch screenshot, and a
 * mid-batch `screenshot` action updates `lastScreenshot` for the MODEL's next
 * decision but does not retroactively change this batch's basis - so a batch is
 * one predictable unit, matching the official semantics.
 */
async function doBatch(
  ctx: ServerContext,
  actions: readonly Record<string, unknown>[],
): Promise<ToolResult> {
  const frozenDims = ctx.lastScreenshot?.dims ?? null;
  const results: string[] = [];
  let image: { data: string; mimeType: string } | null = null;

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const action = String(a.action ?? '');
    const coord = a.coordinate as number[] | undefined;

    try {
      let line: string;
      switch (action) {
        case 'left_click':
        case 'right_click':
        case 'double_click':
        case 'triple_click': {
          const button = action === 'right_click' ? 'right' : 'left';
          const count = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
          await guard(ctx, 'click');
          if (!coord) throw new Error(`${action} requires a coordinate.`);
          const p = toLogical(ctx, coord[0]!, coord[1]!);
          await input.moveAndClick(
            p.x,
            p.y,
            button,
            count as 1 | 2 | 3,
            a.text ? input.chordModifiers(String(a.text)) : [],
          );
          line = `${action} at (${coord.join(', ')})`;
          break;
        }
        case 'mouse_move': {
          await guard(ctx, 'click');
          if (!coord) throw new Error('mouse_move requires a coordinate.');
          const p = toLogical(ctx, coord[0]!, coord[1]!);
          await input.moveMouse(p.x, p.y);
          line = `mouse_move to (${coord.join(', ')})`;
          break;
        }
        case 'left_click_drag': {
          await guard(ctx, 'click');
          if (!coord) throw new Error('left_click_drag requires a coordinate (end point).');
          const start = a.start_coordinate as number[] | undefined;
          const to = toLogical(ctx, coord[0]!, coord[1]!);
          const from = start ? toLogical(ctx, start[0]!, start[1]!) : null;
          await input.drag(from, to);
          line = `left_click_drag to (${coord.join(', ')})`;
          break;
        }
        case 'type': {
          line = firstText(await doType(ctx, String(a.text ?? '')));
          break;
        }
        case 'key': {
          await guard(ctx, 'key');
          const chord = String(a.text ?? '');
          assertChordAllowed(ctx.session, chord);
          await input.pressChord(chord, Number(a.repeat ?? 1));
          line = `key ${chord}`;
          break;
        }
        case 'hold_key': {
          await guard(ctx, 'key');
          const chord = String(a.text ?? '');
          assertChordAllowed(ctx.session, chord);
          await input.holdChord(chord, Number(a.duration ?? 1) * 1000);
          line = `hold_key ${chord}`;
          break;
        }
        case 'scroll': {
          if (!coord) throw new Error('scroll requires a coordinate.');
          line = firstText(
            await doScroll(
              ctx,
              coord,
              String(a.scroll_direction ?? 'down') as ScrollDirection,
              Number(a.scroll_amount ?? 1),
            ),
          );
          break;
        }
        case 'wait': {
          const ms = Number(a.duration ?? 0) * 1000;
          await input.sleep(Math.min(Math.max(ms, 0), 100_000));
          line = `wait ${a.duration}s`;
          break;
        }
        case 'cursor_position': {
          const p = await input.getMousePosition();
          line = `cursor_position (${p.x}, ${p.y}) logical`;
          break;
        }
        case 'left_mouse_down': {
          await guard(ctx, 'click');
          await input.mouseDown();
          line = 'left_mouse_down';
          break;
        }
        case 'left_mouse_up': {
          await guard(ctx, 'click');
          await input.mouseUp();
          line = 'left_mouse_up';
          break;
        }
        case 'screenshot': {
          const shot = await doScreenshot(ctx, false);
          const img = shot.content.find((c): c is { type: 'image'; data: string; mimeType: string } => c.type === 'image');
          const txt = shot.content.find((c): c is { type: 'text'; text: string } => c.type === 'text');
          if (img) image = { data: img.data, mimeType: img.mimeType };
          line = `screenshot ${txt?.text ?? ''}`;
          break;
        }
        default:
          throw new Error(
            `Unknown action "${action}". Valid actions: ${(BATCH_ACTION_ITEM_SCHEMA.properties.action.enum as readonly string[]).join(', ')}.`,
          );
      }
      results.push(`${i + 1}. ${line}`);
    } catch (e) {
      // ctx.lastScreenshot is restored so the batch's coordinate basis is not
      // corrupted by a mid-batch screenshot when we bail out.
      if (frozenDims && ctx.lastScreenshot) ctx.lastScreenshot.dims = frozenDims;
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text:
              `Batch stopped at action ${i + 1} of ${actions.length} (${action}): ${msg}\n\n` +
              `Completed before the failure:\n${results.join('\n') || '(none)'}`,
          },
        ],
      };
    }
  }

  if (frozenDims && ctx.lastScreenshot) ctx.lastScreenshot.dims = frozenDims;

  const summary = `Completed all ${actions.length} actions:\n${results.join('\n')}`;
  if (image) {
    return { content: [{ type: 'text', text: summary }, { type: 'image', ...image }] };
  }
  return text(summary);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export async function dispatch(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const result = await dispatchAction(ctx, name, args);
  if (!(ctx.autoScreenshot ?? autoScreenshotEnabled())) return result;
  return withAutoScreenshot(name, args, result, () => doScreenshot(ctx, false));
}

async function dispatchAction(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'request_access': {
        const requested = (args.apps as string[] | undefined) ?? [];
        const reason = String(args.reason ?? '');
        const resolved: string[] = [];
        const unresolved: string[] = [];

        for (const req of requested) {
          const bundleId = await resolveApp(req, ctx.installed);
          if (bundleId) resolved.push(bundleId);
          else unresolved.push(req);
        }

        const existing = ctx.session.allowedBundleIds ?? new Set<string>();
        for (const id of resolved) existing.add(id);
        ctx.session.allowedBundleIds = existing;
        ctx.session.requestedNames.push(...requested);
        for (const id of resolved) {
          ctx.session.tiers.set(id, tierForApp(id));
        }

        const g = ctx.session.grants;
        if (args.clipboardRead === true) g.clipboardRead = true;
        if (args.clipboardWrite === true) g.clipboardWrite = true;
        if (args.systemKeyCombos === true) g.systemKeyCombos = true;

        const lines = [
          `Reason given: ${reason}`,
          `Granted (${existing.size}): ${[...existing].join(', ') || '(none)'}`,
        ];
        if (unresolved.length > 0) {
          lines.push(
            `Could not resolve (${unresolved.length}): ${unresolved.join(', ')}. ` +
              'These are neither installed app names nor known bundle IDs - check the spelling against the app list in this tool\'s description.',
          );
        }
        const restricted = [...existing].filter((id) => tierForApp(id) !== 'full');
        if (restricted.length > 0) {
          lines.push(
            `Restricted tiers: ${restricted.map((id) => `${id}=${tierForApp(id)}`).join(', ')}. ` +
              'read = visible only, click = clickable but not typable.',
          );
        }
        lines.push(
          `Flags: clipboardRead=${g.clipboardRead}, clipboardWrite=${g.clipboardWrite}, systemKeyCombos=${g.systemKeyCombos}`,
        );
        return text(lines.join('\n'));
      }

      case 'list_granted_applications': {
        const d = activeDisplay(ctx);
        const dims = ctx.lastScreenshot?.dims;
        return text(
          JSON.stringify(
            {
              granted: ctx.session.allowedBundleIds ? [...ctx.session.allowedBundleIds] : null,
              requestedNames: ctx.session.requestedNames,
              grants: ctx.session.grants,
              activeDisplay: { index: d.index, name: d.name, ...d.geometry },
              lastScreenshot: dims ?? null,
            },
            null,
            2,
          ),
        );
      }

      case 'screenshot':
        return await doScreenshot(ctx, args.save_to_disk === true);

      case 'zoom': {
        const region = args.region as number[] | undefined;
        if (!region || region.length !== 4) throw new Error('zoom requires a region of [x0, y0, x1, y1].');
        if (!ctx.lastScreenshot) throw new Error('Take a screenshot before zooming.');
        const clamped = clampRegion(region, ctx.lastScreenshot.dims);
        const out = await zoomRegion(ctx.lastScreenshot.png, clamped);
        const note =
          `Zoomed ${clamped[2] - clamped[0]}x${clamped[3] - clamped[1]} of screenshot space ` +
          `(${clamped.join(', ')}) to ${out.width}x${out.height}. ` +
          'Click coordinates still refer to the full-screen screenshot, NOT this image.' +
          (args.save_to_disk === true ? ` Saved to /tmp/cu-zoom-${Date.now()}.png.` : '');
        return {
          content: [
            { type: 'text' as const, text: note },
            { type: 'image' as const, data: out.data.toString('base64'), mimeType: 'image/png' },
          ],
        };
      }

      case 'switch_display': {
        const want = String(args.display ?? '').trim();
        if (want.toLowerCase() === 'auto') {
          const main = ctx.displays.find((d) => d.isMain) ?? ctx.displays[0]!;
          ctx.activeDisplayIndex = main.index;
          return text(`Screenshots now capture the main display: "${main.name}" (${main.index}).`);
        }
        const numeric = Number(want);
        const found = Number.isFinite(numeric)
          ? ctx.displays.find((d) => d.index === numeric)
          : ctx.displays.find((d) => d.name.toLowerCase() === want.toLowerCase());
        if (!found) {
          throw new Error(
            `No display matches "${want}". Attached: ${ctx.displays.map((d) => `${d.name} (${d.index})`).join(', ')}.`,
          );
        }
        ctx.activeDisplayIndex = found.index;
        return text(`Screenshots now capture "${found.name}" (${found.index}). Call screenshot to see it.`);
      }

      case 'cursor_position': {
        const p = await input.getMousePosition();
        const d = activeDisplay(ctx);
        const inModel = logicalToModel(p.x, p.y, ctx.lastScreenshot?.dims ?? null, d.geometry);
        return text(
          `Cursor at screenshot (${inModel.x}, ${inModel.y})` +
            (ctx.lastScreenshot ? '' : ' - logical points, no screenshot taken yet') +
            ` [logical (${p.x}, ${p.y})]`,
        );
      }

      case 'left_click': return await doClick(ctx, 'left', 1, reqCoord(args), String(args.text ?? ''));
      case 'double_click': return await doClick(ctx, 'left', 2, reqCoord(args), String(args.text ?? ''));
      case 'triple_click': return await doClick(ctx, 'left', 3, reqCoord(args), String(args.text ?? ''));
      case 'right_click': return await doClick(ctx, 'right', 1, reqCoord(args), String(args.text ?? ''));
      case 'middle_click': return await doClick(ctx, 'middle', 1, reqCoord(args), '');

      case 'mouse_move': {
        await guard(ctx, 'click');
        const c = reqCoord(args);
        const p = toLogical(ctx, c[0]!, c[1]!);
        await input.moveMouse(p.x, p.y);
        return text(`Moved to screenshot (${c[0]}, ${c[1]}) = logical (${p.x}, ${p.y}).`);
      }

      case 'left_click_drag': {
        await guard(ctx, 'click');
        const c = reqCoord(args);
        const start = args.start_coordinate as number[] | undefined;
        const to = toLogical(ctx, c[0]!, c[1]!);
        const from = start ? toLogical(ctx, start[0]!, start[1]!) : null;
        await input.drag(from, to);
        return text(`Dragged ${from ? `from logical (${from.x}, ${from.y}) ` : ''}to logical (${to.x}, ${to.y}).`);
      }

      case 'left_mouse_down': await guard(ctx, 'click'); await input.mouseDown(); return text('Left button is down.');
      case 'left_mouse_up': await guard(ctx, 'click'); await input.mouseUp(); return text('Left button is up.');

      case 'type': return await doType(ctx, String(args.text ?? ''));

      case 'key': {
        await guard(ctx, 'key');
        const chord = String(args.text ?? '');
        assertChordAllowed(ctx.session, chord);
        await input.pressChord(chord, Number(args.repeat ?? 1));
        return text(`Pressed ${chord}${Number(args.repeat ?? 1) > 1 ? ` x${args.repeat}` : ''}.`);
      }

      case 'hold_key': {
        await guard(ctx, 'key');
        const chord = String(args.text ?? '');
        assertChordAllowed(ctx.session, chord);
        const seconds = Math.min(Math.max(Number(args.duration ?? 0), 0), 100);
        await input.holdChord(chord, seconds * 1000);
        return text(`Held ${chord} for ${seconds}s.`);
      }

      case 'scroll': {
        const c = reqCoord(args);
        return await doScroll(
          ctx,
          c,
          String(args.scroll_direction ?? 'down') as ScrollDirection,
          Number(args.scroll_amount ?? 1),
        );
      }

      case 'open_application': {
        const want = String(args.app ?? '');
        const bundleId = await resolveApp(want, ctx.installed);
        if (!bundleId) throw new Error(`Could not resolve "${want}" to an installed application.`);
        if (ctx.session.allowedBundleIds === null || !ctx.session.allowedBundleIds.has(bundleId)) {
          throw new PolicyError(
            `${bundleId} is not in this session's allowlist. Call request_access first.`,
            'not_granted',
          );
        }
        await activateApp(bundleId);
        return text(`Brought ${bundleId} to the front.`);
      }

      case 'read_clipboard': {
        await guard(ctx, 'clipboard_read');
        return text(await readClipboard());
      }

      case 'write_clipboard': {
        await guard(ctx, 'clipboard_write');
        await writeClipboard(String(args.text ?? ''));
        return text(`Wrote ${String(args.text ?? '').length} characters to the clipboard.`);
      }

      case 'wait': {
        const seconds = Math.min(Math.max(Number(args.duration ?? 0), 0), 100);
        await input.sleep(seconds * 1000);
        return text(`Waited ${seconds}s.`);
      }

      case 'computer_batch': {
        const actions = args.actions as Record<string, unknown>[] | undefined;
        if (!actions || actions.length === 0) throw new Error('computer_batch requires a non-empty actions array.');
        return await doBatch(ctx, actions);
      }

      default:
        throw new Error(`Unknown tool "${name}".`);
    }
  } catch (e) {
    return errorResult(e);
  }
}

function firstText(r: ToolResult): string {
  const t = r.content.find((c): c is { type: 'text'; text: string } => c.type === 'text');
  return t?.text ?? '';
}

function reqCoord(args: Record<string, unknown>): number[] {
  const c = args.coordinate as number[] | undefined;
  if (!c || c.length !== 2 || c.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
    throw new Error('A coordinate of [x, y] is required.');
  }
  return c;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

/** Machine facts shared by every session: measured once, never per request. */
export interface ServerEnvironment {
  displays: AttachedDisplay[];
  installed: InstalledApp[];
}

export async function loadEnvironment(): Promise<ServerEnvironment> {
  await preflightPermissions();
  const displays = await detectDisplays();
  const installed = await listInstalledApps();
  return { displays, installed };
}

/**
 * One MCP Server with its own session state (allowlist, grants, screenshot
 * basis). The HTTP gateway calls this once per client session with a shared
 * environment, so no client inherits another's grants.
 */
export async function createServer(
  env?: ServerEnvironment,
): Promise<{ server: Server; ctx: ServerContext }> {
  const { displays, installed } = env ?? (await loadEnvironment());
  const main = displays.find((d) => d.isMain) ?? displays[0]!;

  const ctx: ServerContext = {
    displays,
    activeDisplayIndex: main.index,
    session: newSession(),
    lastScreenshot: null,
    installed,
    installedNames: filterAppsForDescription(installed),
  };

  const tools: Tool[] = buildComputerUseTools(ctx.installedNames);

  // Low-level Server with the tools capability declared explicitly. The
  // high-level McpServer only advertises `tools` when registerTool() is used;
  // registering handlers directly on it leaves the capability unset, and the
  // SDK then rejects tools/list with "Server does not support tools".
  const server = new Server(
    { name: 'computer-use', version: '3.1.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return (await dispatch(ctx, name, (args ?? {}) as Record<string, unknown>)) as never;
  });

  return { server, ctx };
}

export async function main(): Promise<void> {
  const { server } = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `computer-use MCP server running on stdio ` +
      `(viewport ${PRIMARY_FALLBACK_VIEWPORT.logicalWidth}x${PRIMARY_FALLBACK_VIEWPORT.logicalHeight})\n`,
  );

  const shutdown = async () => {
    closeScrollHelper();
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('error', () => void shutdown());
}
