#!/usr/bin/env node
/**
 * Browser mode: the same computer-use tool contract, driving an isolated
 * Chrome through the DevTools protocol (Playwright) instead of the system
 * mouse and keyboard.
 *
 * Input is delivered to the page itself, so it never moves the user's cursor,
 * never needs the window to be frontmost, and keeps working while the window
 * is covered, minimized, or headless. The browser runs with its own profile
 * (~/.cache/computer-use-mcp/browser-profile), so it starts without the user's
 * logins and cookies.
 *
 * Coordinates work as in desktop mode: pixels of the most recent screenshot.
 * The screenshot is the page viewport, resized to the API target size when the
 * viewport is larger, and mapped back to CSS pixels here.
 *
 * Environment:
 *   CU_BROWSER_PATH      Chrome/Chromium executable (default: installed Google Chrome)
 *   CU_BROWSER_HEADLESS  1 to run without a window
 *   CU_BROWSER_VIEWPORT  WIDTHxHEIGHT in CSS pixels (default 1280x800)
 *   CU_BROWSER_PROFILE   profile directory (default ~/.cache/computer-use-mcp/browser-profile)
 *   CU_BROWSER_START_URL page opened on launch (default about:blank)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import sharp from 'sharp';

import { buildComputerUseTools, BATCH_ACTION_ITEM_SCHEMA, FRONTMOST_GATE_DESC } from './tools.js';
import { API_RESIZE_PARAMS, targetImageSize } from './imageResize.js';
import { clampRegion, type ScreenshotDims } from './coords.js';
import { zoomRegion } from './screen.js';
import { parseBrowserChord } from './browserKeys.js';
import type { ScrollDirection } from './types.js';

// ── Configuration ────────────────────────────────────────────────────────────

export interface BrowserConfig {
  executablePath?: string;
  headless: boolean;
  viewport: { width: number; height: number };
  profileDir: string;
  startUrl: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BrowserConfig {
  const vp = /^(\d+)x(\d+)$/.exec(env.CU_BROWSER_VIEWPORT ?? '');
  return {
    executablePath: env.CU_BROWSER_PATH || undefined,
    headless: /^(1|true|yes)$/i.test(env.CU_BROWSER_HEADLESS ?? ''),
    viewport: vp ? { width: Number(vp[1]), height: Number(vp[2]) } : { width: 1280, height: 800 },
    profileDir: env.CU_BROWSER_PROFILE || join(homedir(), '.cache', 'computer-use-mcp', 'browser-profile'),
    startUrl: env.CU_BROWSER_START_URL || 'about:blank',
  };
}

/** Wheel pixels per scroll tick - one notch of a physical mouse wheel. */
const PIXELS_PER_TICK = 100;

/** Above this length, insertText (no per-key events) replaces key-by-key typing. */
const INSERT_THRESHOLD_CHARS = 200;

// ── Tools ────────────────────────────────────────────────────────────────────

const BROWSER_TOOL_NAMES = new Set([
  'screenshot', 'zoom', 'cursor_position',
  'left_click', 'double_click', 'triple_click', 'right_click', 'middle_click',
  'mouse_move', 'left_click_drag', 'left_mouse_down', 'left_mouse_up',
  'type', 'key', 'hold_key', 'scroll', 'wait', 'computer_batch',
]);

export function buildBrowserTools(): Tool[] {
  const tools = buildComputerUseTools([])
    .filter((t) => BROWSER_TOOL_NAMES.has(t.name))
    .map((t) => ({
      ...t,
      description: (t.description ?? '')
        .replace(` ${FRONTMOST_GATE_DESC}`, '')
        .replace(`${FRONTMOST_GATE_DESC} `, '')
        .replace(' The gate runs before EACH action inside the batch.', '')
        .replace(
          'Returns an error if the allowlist is empty. ',
          '',
        )
        .replace(
          'Implemented via a synthesized scroll-wheel button event, so it requires the scroll helper to have compiled.',
          '',
        )
        .trim(),
    }));
  tools.unshift({
    name: 'navigate',
    description:
      'Browser mode: load a URL in the controlled browser tab, or go "back" / "forward" / "reload". ' +
      'Waits for the page to load, then returns a screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL (https://...), or "back", "forward", "reload".' },
      },
      required: ['url'],
    },
  });
  return tools;
}

// ── Session ──────────────────────────────────────────────────────────────────

type ContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface ToolResult { content: ContentBlock[]; isError?: boolean }

export class BrowserSession {
  private context: BrowserContext | null = null;
  private launching: Promise<BrowserContext> | null = null;
  lastScreenshot: { png: Buffer; dims: ScreenshotDims } | null = null;
  /** Last pointer position in CSS pixels; Playwright does not expose it. */
  cursor = { x: 0, y: 0 };

  constructor(readonly config: BrowserConfig) {}

  private async launch(): Promise<BrowserContext> {
    const { config } = this;
    const context = await chromium.launchPersistentContext(config.profileDir, {
      headless: config.headless,
      ...(config.executablePath ? { executablePath: config.executablePath } : { channel: 'chrome' }),
      viewport: config.viewport,
      deviceScaleFactor: 1,
      // Keep rendering and timers at full speed while the window is covered or
      // in the background - otherwise games and animations throttle.
      args: [
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    });
    context.on('close', () => { this.context = null; this.launching = null; });
    const page = context.pages()[0] ?? (await context.newPage());
    if (config.startUrl !== 'about:blank') await page.goto(config.startUrl);
    return context;
  }

  async page(): Promise<Page> {
    if (!this.context) {
      this.launching ??= this.launch();
      try {
        this.context = await this.launching;
      } catch (e) {
        this.launching = null;
        throw new Error(
          `Could not launch the browser (${e instanceof Error ? e.message.split('\n')[0] : String(e)}). ` +
            'Install Google Chrome, or set CU_BROWSER_PATH to a Chrome/Chromium executable.',
        );
      }
    }
    const pages = this.context.pages();
    return pages[pages.length - 1] ?? (await this.context.newPage());
  }

  /** Model-space (screenshot pixels) -> CSS pixels. */
  toCss(x: number, y: number): { x: number; y: number } {
    const { width, height } = this.config.viewport;
    const dims = this.lastScreenshot?.dims;
    if (!dims) return { x, y };
    return { x: (x * width) / dims.targetWidth, y: (y * height) / dims.targetHeight };
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = null;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

function text(s: string): ToolResult {
  return { content: [{ type: 'text', text: s }] };
}

function reqCoord(value: unknown, name = 'coordinate'): [number, number] {
  const c = value as number[] | undefined;
  if (!c || c.length !== 2 || c.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
    throw new Error(`A ${name} of [x, y] is required.`);
  }
  return [c[0]!, c[1]!];
}

async function withModifiers<T>(page: Page, modifiers: string[], fn: () => Promise<T>): Promise<T> {
  for (const m of modifiers) await page.keyboard.down(m);
  try {
    return await fn();
  } finally {
    for (const m of [...modifiers].reverse()) await page.keyboard.up(m).catch(() => {});
  }
}

async function screenshot(s: BrowserSession): Promise<ToolResult> {
  const page = await s.page();
  const raw = await page.screenshot({ type: 'png', scale: 'css' });
  const meta = await sharp(raw).metadata();
  const [tw, th] = targetImageSize(meta.width!, meta.height!, API_RESIZE_PARAMS);
  const png = tw === meta.width && th === meta.height
    ? raw
    : await sharp(raw).resize(tw, th, { fit: 'fill' }).png().toBuffer();
  s.lastScreenshot = { png, dims: { targetWidth: tw, targetHeight: th } };
  const note =
    `${tw}x${th} pixels of the browser tab "${await page.title().catch(() => '')}" (${page.url()}). ` +
    'All click coordinates are relative to an image of this size.';
  return {
    content: [
      { type: 'text', text: note },
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
    ],
  };
}

async function click(
  s: BrowserSession,
  args: Record<string, unknown>,
  button: 'left' | 'right' | 'middle',
  clickCount: number,
): Promise<string> {
  const [mx, my] = reqCoord(args.coordinate);
  const p = s.toCss(mx, my);
  const page = await s.page();
  const mods = args.text ? parseBrowserChord(String(args.text)).modifiers : [];
  await withModifiers(page, mods, () => page.mouse.click(p.x, p.y, { button, clickCount }));
  s.cursor = p;
  return `${button} click${clickCount > 1 ? ` x${clickCount}` : ''} at screenshot (${mx}, ${my})`;
}

async function pressKey(s: BrowserSession, chord: string, repeat: number): Promise<string> {
  const page = await s.page();
  const { modifiers, keys } = parseBrowserChord(chord);
  const combo = [...modifiers, ...keys].join('+');
  for (let i = 0; i < Math.max(1, Math.min(repeat, 100)); i++) {
    if (keys.length <= 1) {
      await page.keyboard.press(combo || modifiers.join('+'));
    } else {
      await withModifiers(page, modifiers, async () => {
        for (const k of keys) await page.keyboard.press(k);
      });
    }
  }
  return `key ${chord}${repeat > 1 ? ` x${repeat}` : ''}`;
}

async function holdKey(s: BrowserSession, chord: string, seconds: number): Promise<string> {
  const page = await s.page();
  const { modifiers, keys } = parseBrowserChord(chord);
  const all = [...modifiers, ...keys];
  for (const k of all) await page.keyboard.down(k);
  try {
    await new Promise((r) => setTimeout(r, Math.min(Math.max(seconds, 0), 100) * 1000));
  } finally {
    for (const k of [...all].reverse()) await page.keyboard.up(k).catch(() => {});
  }
  return `hold_key ${chord} for ${seconds}s`;
}

async function typeText(s: BrowserSession, value: string): Promise<string> {
  const page = await s.page();
  if (value.length > INSERT_THRESHOLD_CHARS && !value.includes('\n')) {
    await page.keyboard.insertText(value);
  } else {
    await page.keyboard.type(value);
  }
  return `typed ${value.length} characters`;
}

async function scroll(s: BrowserSession, args: Record<string, unknown>): Promise<string> {
  const [mx, my] = reqCoord(args.coordinate);
  const p = s.toCss(mx, my);
  const direction = String(args.scroll_direction ?? 'down') as ScrollDirection;
  const ticks = Math.min(Math.max(Number(args.scroll_amount ?? 1), 0), 100);
  const px = ticks * PIXELS_PER_TICK;
  const [dx, dy] =
    direction === 'up' ? [0, -px] : direction === 'left' ? [-px, 0] : direction === 'right' ? [px, 0] : [0, px];
  const page = await s.page();
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(dx, dy);
  s.cursor = p;
  return `scrolled ${direction} by ${ticks} ticks at screenshot (${mx}, ${my})`;
}

async function drag(s: BrowserSession, args: Record<string, unknown>): Promise<string> {
  const [ex, ey] = reqCoord(args.coordinate);
  const to = s.toCss(ex, ey);
  const from = args.start_coordinate ? s.toCss(...reqCoord(args.start_coordinate, 'start_coordinate')) : s.cursor;
  const page = await s.page();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  s.cursor = to;
  return `dragged to screenshot (${ex}, ${ey})`;
}

async function navigate(s: BrowserSession, url: string): Promise<void> {
  const page = await s.page();
  if (url === 'back') await page.goBack({ waitUntil: 'load' });
  else if (url === 'forward') await page.goForward({ waitUntil: 'load' });
  else if (url === 'reload') await page.reload({ waitUntil: 'load' });
  else {
    if (!/^(https?|file|about|data):/i.test(url)) {
      throw new Error(`"${url}" is not an absolute URL. Include the scheme, e.g. https://example.com.`);
    }
    await page.goto(url, { waitUntil: 'load' });
  }
}

/** One action; returns a one-line summary. Shared by single tools and computer_batch. */
async function runAction(s: BrowserSession, action: string, a: Record<string, unknown>): Promise<string> {
  const page = () => s.page();
  switch (action) {
    case 'left_click': return click(s, a, 'left', 1);
    case 'double_click': return click(s, a, 'left', 2);
    case 'triple_click': return click(s, a, 'left', 3);
    case 'right_click': return click(s, a, 'right', 1);
    case 'middle_click': return click(s, a, 'middle', 1);
    case 'mouse_move': {
      const [mx, my] = reqCoord(a.coordinate);
      const p = s.toCss(mx, my);
      await (await page()).mouse.move(p.x, p.y);
      s.cursor = p;
      return `mouse_move to screenshot (${mx}, ${my})`;
    }
    case 'left_click_drag': return drag(s, a);
    case 'left_mouse_down': await (await page()).mouse.down(); return 'left_mouse_down';
    case 'left_mouse_up': await (await page()).mouse.up(); return 'left_mouse_up';
    case 'type': return typeText(s, String(a.text ?? ''));
    case 'key': return pressKey(s, String(a.text ?? ''), Number(a.repeat ?? 1));
    case 'hold_key': return holdKey(s, String(a.text ?? ''), Number(a.duration ?? 0));
    case 'scroll': return scroll(s, a);
    case 'wait': {
      const seconds = Math.min(Math.max(Number(a.duration ?? 0), 0), 100);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return `wait ${seconds}s`;
    }
    case 'cursor_position': {
      const dims = s.lastScreenshot?.dims;
      const { width, height } = s.config.viewport;
      const x = dims ? Math.round((s.cursor.x * dims.targetWidth) / width) : Math.round(s.cursor.x);
      const y = dims ? Math.round((s.cursor.y * dims.targetHeight) / height) : Math.round(s.cursor.y);
      return `cursor at screenshot (${x}, ${y})`;
    }
    default:
      throw new Error(
        `Unknown action "${action}". Valid actions: ${BATCH_ACTION_ITEM_SCHEMA.properties.action.enum.join(', ')}.`,
      );
  }
}

export async function dispatchBrowser(
  s: BrowserSession,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'screenshot':
        return await screenshot(s);

      case 'navigate':
        await navigate(s, String(args.url ?? '').trim());
        return await screenshot(s);

      case 'zoom': {
        const region = args.region as number[] | undefined;
        if (!region || region.length !== 4) throw new Error('zoom requires a region of [x0, y0, x1, y1].');
        if (!s.lastScreenshot) throw new Error('Take a screenshot before zooming.');
        const clamped = clampRegion(region, s.lastScreenshot.dims);
        const out = await zoomRegion(s.lastScreenshot.png, clamped);
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
              const shot = await screenshot(s);
              image = shot.content.find((c) => c.type === 'image') ?? null;
              results.push(`${i + 1}. screenshot`);
            } else {
              results.push(`${i + 1}. ${await runAction(s, action, a)}`);
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
        if (!BROWSER_TOOL_NAMES.has(name)) throw new Error(`Unknown tool "${name}".`);
        return text(await runAction(s, name, args));
    }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] };
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────────

export function createBrowserServer(config: BrowserConfig = configFromEnv()): {
  server: Server;
  session: BrowserSession;
} {
  const session = new BrowserSession(config);
  const tools = buildBrowserTools();
  const server = new Server(
    { name: 'computer-use-browser', version: '3.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return (await dispatchBrowser(session, name, (args ?? {}) as Record<string, unknown>)) as never;
  });
  return { server, session };
}

export async function main(): Promise<void> {
  const { server, session } = createBrowserServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write('computer-use MCP server (browser mode) running on stdio\n');
  const shutdown = async () => {
    await session.close();
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.stdin.on('end', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
