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

import {
  buildDriverTools,
  DriverSession,
  DRIVER_TOOL_NAMES,
  errorResult,
  type Driver,
  type MouseButton,
  type ToolResult,
} from './driverServer.js';
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

export function buildBrowserTools(): Tool[] {
  const tools = buildDriverTools(DRIVER_TOOL_NAMES);
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

// ── Driver ───────────────────────────────────────────────────────────────────

async function withModifiers<T>(page: Page, modifiers: string[], fn: () => Promise<T>): Promise<T> {
  for (const m of modifiers) await page.keyboard.down(m);
  try {
    return await fn();
  } finally {
    for (const m of [...modifiers].reverse()) await page.keyboard.up(m).catch(() => {});
  }
}

class BrowserDriver implements Driver {
  private context: BrowserContext | null = null;
  private launching: Promise<BrowserContext> | null = null;

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

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = null;
  }

  async capture() {
    const page = await this.page();
    const png = await page.screenshot({ type: 'png', scale: 'css' });
    const title = await page.title().catch(() => '');
    return {
      png,
      width: this.config.viewport.width,
      height: this.config.viewport.height,
      label: `the browser tab "${title}" (${page.url()})`,
    };
  }

  async click(x: number, y: number, button: MouseButton, count: number, chord: string) {
    const page = await this.page();
    const mods = chord ? parseBrowserChord(chord).modifiers : [];
    await withModifiers(page, mods, () => page.mouse.click(x, y, { button, clickCount: count }));
  }

  async move(x: number, y: number) { await (await this.page()).mouse.move(x, y); }
  async mouseDown(x: number, y: number) { const p = await this.page(); await p.mouse.move(x, y); await p.mouse.down(); }
  async mouseUp(x: number, y: number) { const p = await this.page(); await p.mouse.move(x, y); await p.mouse.up(); }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    const page = await this.page();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  }

  async type(value: string) {
    const page = await this.page();
    if (value.length > INSERT_THRESHOLD_CHARS && !value.includes('\n')) await page.keyboard.insertText(value);
    else await page.keyboard.type(value);
  }

  async key(chord: string, repeat: number) {
    const page = await this.page();
    const { modifiers, keys } = parseBrowserChord(chord);
    for (let i = 0; i < repeat; i++) {
      if (keys.length <= 1) {
        await page.keyboard.press([...modifiers, ...keys].join('+'));
      } else {
        await withModifiers(page, modifiers, async () => {
          for (const k of keys) await page.keyboard.press(k);
        });
      }
    }
  }

  async hold(chord: string, seconds: number) {
    const page = await this.page();
    const { modifiers, keys } = parseBrowserChord(chord);
    const all = [...modifiers, ...keys];
    for (const k of all) await page.keyboard.down(k);
    try {
      await new Promise((r) => setTimeout(r, seconds * 1000));
    } finally {
      for (const k of [...all].reverse()) await page.keyboard.up(k).catch(() => {});
    }
  }

  async scroll(x: number, y: number, direction: ScrollDirection, ticks: number) {
    const px = ticks * PIXELS_PER_TICK;
    const [dx, dy] =
      direction === 'up' ? [0, -px] : direction === 'left' ? [-px, 0] : direction === 'right' ? [px, 0] : [0, px];
    const page = await this.page();
    await page.mouse.move(x, y);
    await page.mouse.wheel(dx, dy);
  }

  async navigate(url: string): Promise<void> {
    const page = await this.page();
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
}

// ── Session ──────────────────────────────────────────────────────────────────

export class BrowserSession extends DriverSession {
  declare readonly driver: BrowserDriver;

  constructor(readonly config: BrowserConfig) {
    super(new BrowserDriver(config));
  }

  page(): Promise<Page> { return this.driver.page(); }
  close(): Promise<void> { return this.driver.close(); }
}

export async function dispatchBrowser(
  s: BrowserSession,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (name !== 'navigate') return s.dispatch(name, args);
  try {
    await s.driver.navigate(String(args.url ?? '').trim());
    return await s.screenshot();
  } catch (e) {
    return errorResult(e);
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
