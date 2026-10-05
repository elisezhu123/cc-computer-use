#!/usr/bin/env node
/**
 * Native background mode (experimental): drive one granted macOS app without
 * moving the user's cursor or needing the app in front.
 *
 * Input goes straight to the target process (CGEventPostToPid via
 * native/background.swift; buttons and other controls are pressed through
 * Accessibility), and an agent cursor overlay shows where the agent acts
 * while the user's own cursor stays put. Screenshots capture just that app's window
 * (`screencapture -l`), even while other windows cover it. Coordinates are
 * pixels of that window screenshot.
 *
 * Limits: whether an app acts on events it receives while in the background is
 * up to the app. Keyboard input and typing work in many apps; clicks are often
 * ignored by apps that only accept mouse events for their key window. Use
 * browser mode for web pages, or a virtual machine for full reliability.
 *
 * The session allowlist, strict tiers (CU_STRICT_APP_TIERS) and the system-key
 * blocklist apply as in desktop mode, checked against the target app rather
 * than the frontmost one.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  buildDriverTools,
  DriverSession,
  DRIVER_TOOL_NAMES,
  errorResult,
  text,
  type Driver,
  type MouseButton,
  type ToolResult,
} from './driverServer.js';
import { NativeHelper } from './nativeHelper.js';
import { modifierCodes, parseNativeChord } from './nativeKeys.js';
import { listInstalledApps, resolveApp, filterAppsForDescription } from './apps.js';
import {
  newSession,
  assertActionAllowed,
  assertChordAllowed,
  tierForApp,
  PolicyError,
  type SessionState,
} from './policy.js';
import type { InstalledApp, ScrollDirection } from './types.js';

const execFileAsync = promisify(execFile);

/** Same per-tick distance and sign convention as scroll.ts. */
const PIXELS_PER_TICK = 40;

export interface HelperLike {
  request(line: string): Promise<string>;
  close(): void;
}

interface Target { bundleId: string; pid: number }

type ActionKind = 'click' | 'type' | 'key' | 'scroll';

// ── Driver ───────────────────────────────────────────────────────────────────

export class NativeDriver implements Driver {
  target: Target | null = null;
  /** Called before every input with its kind; throws to refuse. */
  gate: (kind: ActionKind, chord?: string) => void = () => {};

  constructor(
    readonly helper: HelperLike,
    private readonly captureWindow: (windowId: number) => Promise<Buffer> = screencaptureWindow,
  ) {}

  private requireTarget(): Target {
    if (!this.target) {
      throw new PolicyError('No target app yet. Call open_application with a granted app first.', 'bad_request');
    }
    return this.target;
  }

  /** The target's front window: id and global origin/size in points. */
  async window(): Promise<{ id: number; x: number; y: number; w: number; h: number }> {
    const t = this.requireTarget();
    const [id, x, y, w, h] = (await this.helper.request(`window ${t.pid}`)).split(' ').map(Number);
    return { id: id!, x: x!, y: y!, w: w!, h: h! };
  }

  /** Window-local point -> global point, against the window's current position. */
  private async global(x: number, y: number): Promise<{ gx: number; gy: number }> {
    const w = await this.window();
    return { gx: Math.round(w.x + x), gy: Math.round(w.y + y) };
  }

  private mouse(kind: 'down' | 'up' | 'move' | 'drag', button: MouseButton, gx: number, gy: number, clicks = 1, flags = 0) {
    const b = button === 'right' ? 1 : button === 'middle' ? 2 : 0;
    return this.helper.request(`mouse ${this.requireTarget().pid} ${kind} ${b} ${gx} ${gy} ${clicks} ${flags}`);
  }

  private keyEvent(code: number, down: boolean, flags: number) {
    return this.helper.request(`key ${this.requireTarget().pid} ${code} ${down ? 1 : 0} ${flags}`);
  }

  async capture() {
    const t = this.requireTarget();
    const w = await this.window();
    return { png: await this.captureWindow(w.id), width: w.w, height: w.h, label: `the ${t.bundleId} window` };
  }

  async click(x: number, y: number, button: MouseButton, count: number, chord: string) {
    this.gate('click');
    const flags = chord ? parseNativeChord(chord).flags : 0;
    const { gx, gy } = await this.global(x, y);
    // One request: the helper glides the agent cursor there, then presses the
    // control through Accessibility or posts the click to the target window.
    const b = button === 'right' ? 1 : button === 'middle' ? 2 : 0;
    await this.helper.request(`click ${this.requireTarget().pid} ${b} ${gx} ${gy} ${count} ${flags}`);
  }

  async move(x: number, y: number) {
    this.gate('click');
    const { gx, gy } = await this.global(x, y);
    await this.mouse('move', 'left', gx, gy);
  }

  async mouseDown(x: number, y: number) {
    this.gate('click');
    const { gx, gy } = await this.global(x, y);
    await this.mouse('down', 'left', gx, gy);
  }

  async mouseUp(x: number, y: number) {
    this.gate('click');
    const { gx, gy } = await this.global(x, y);
    await this.mouse('up', 'left', gx, gy);
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    this.gate('click');
    const a = await this.global(from.x, from.y);
    const b = await this.global(to.x, to.y);
    await this.mouse('down', 'left', a.gx, a.gy);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await this.mouse('drag', 'left', Math.round(a.gx + ((b.gx - a.gx) * i) / steps), Math.round(a.gy + ((b.gy - a.gy) * i) / steps));
    }
    await this.mouse('up', 'left', b.gx, b.gy);
  }

  async type(value: string) {
    this.gate('type');
    const pid = this.requireTarget().pid;
    // Newlines as Return presses; everything else as Unicode text.
    const lines = value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length > 0) {
        await this.helper.request(`text ${pid} ${Buffer.from(lines[i]!, 'utf8').toString('base64')}`);
      }
      if (i < lines.length - 1) {
        await this.keyEvent(36, true, 0);
        await this.keyEvent(36, false, 0);
      }
    }
  }

  async key(chord: string, repeat: number) {
    this.gate('key', chord);
    const { flags, keys } = parseNativeChord(chord);
    for (let r = 0; r < repeat; r++) {
      if (keys.length === 0) {
        for (const code of modifierCodes(flags)) { await this.keyEvent(code, true, flags); await this.keyEvent(code, false, 0); }
      }
      for (const k of keys) {
        await this.keyEvent(k.code, true, flags | k.flags);
        await this.keyEvent(k.code, false, flags | k.flags);
      }
    }
  }

  async hold(chord: string, seconds: number) {
    this.gate('key', chord);
    const { flags, keys } = parseNativeChord(chord);
    const codes = keys.length > 0 ? keys.map((k) => ({ code: k.code, flags: flags | k.flags })) : modifierCodes(flags).map((code) => ({ code, flags }));
    for (const k of codes) await this.keyEvent(k.code, true, k.flags);
    try {
      await new Promise((r) => setTimeout(r, seconds * 1000));
    } finally {
      for (const k of [...codes].reverse()) await this.keyEvent(k.code, false, 0).catch(() => {});
    }
  }

  async scroll(x: number, y: number, direction: ScrollDirection, ticks: number) {
    this.gate('scroll');
    const { gx, gy } = await this.global(x, y);
    const [dx, dy] =
      direction === 'down' ? [0, PIXELS_PER_TICK] : direction === 'up' ? [0, -PIXELS_PER_TICK]
        : direction === 'right' ? [PIXELS_PER_TICK, 0] : [-PIXELS_PER_TICK, 0];
    await this.mouse('move', 'left', gx, gy);
    for (let i = 0; i < ticks; i++) {
      await this.helper.request(`scroll ${this.requireTarget().pid} ${gx} ${gy} ${dx} ${dy}`);
    }
  }
}

async function screencaptureWindow(windowId: number): Promise<Buffer> {
  const path = join(tmpdir(), `cu-window-${process.pid}-${Date.now()}.png`);
  try {
    await execFileAsync('screencapture', ['-x', '-o', '-l', String(windowId), path]);
    return await readFile(path);
  } catch (e) {
    throw new Error(
      `Could not capture window ${windowId}. Screen Recording permission may be missing. (${String(e)})`,
    );
  } finally {
    await unlink(path).catch(() => {});
  }
}

// ── Session and tools ────────────────────────────────────────────────────────

const APP_TOOL_NAMES = new Set(['request_access', 'list_granted_applications', 'open_application']);

export function buildBackgroundTools(installedAppNames: readonly string[] = []): Tool[] {
  const names = new Set([...APP_TOOL_NAMES, ...DRIVER_TOOL_NAMES]);
  return buildDriverTools(names, installedAppNames).map((t) =>
    t.name === 'open_application'
      ? {
          ...t,
          description:
            'Background mode: choose the granted app that all following actions go to, launching it hidden if it is not running. ' +
            'It is NOT brought to the front, and the user\'s cursor is never moved.',
        }
      : t,
  );
}

export class BackgroundSession extends DriverSession {
  declare readonly driver: NativeDriver;
  readonly policy: SessionState = newSession();

  constructor(
    helper: HelperLike,
    readonly installed: InstalledApp[] = [],
    captureWindow?: (windowId: number) => Promise<Buffer>,
    private readonly launchHidden: (bundleId: string) => Promise<void> = openHidden,
  ) {
    super(new NativeDriver(helper, captureWindow));
    this.driver.gate = (kind, chord) => {
      if (this.policy.allowedBundleIds === null) {
        throw new PolicyError('request_access has not been called yet. Call it first.', 'needs_access');
      }
      if (!this.driver.target) {
        throw new PolicyError('No target app yet. Call open_application with a granted app first.', 'bad_request');
      }
      assertActionAllowed(this.policy, this.driver.target.bundleId, kind);
      if (chord) assertChordAllowed(this.policy, chord);
    };
  }

  async openApplication(want: string): Promise<string> {
    const bundleId = await resolveApp(want, this.installed);
    if (!bundleId) throw new Error(`Could not resolve "${want}" to an installed application.`);
    if (!this.policy.allowedBundleIds?.has(bundleId)) {
      throw new PolicyError(`${bundleId} is not in this session's allowlist. Call request_access first.`, 'not_granted');
    }
    let pid = await this.driver.helper.request(`pid ${bundleId}`).catch(() => null);
    if (!pid) {
      await this.launchHidden(bundleId);
      for (let i = 0; i < 50 && !pid; i++) {
        await new Promise((r) => setTimeout(r, 200));
        pid = await this.driver.helper.request(`pid ${bundleId}`).catch(() => null);
      }
      if (!pid) throw new Error(`${bundleId} did not start within 10s.`);
    }
    this.driver.target = { bundleId, pid: Number(pid) };
    this.lastScreenshot = null;
    return `Actions now go to ${bundleId} (pid ${pid}) in the background. Call screenshot to see its window.`;
  }

  async dispatchAll(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case 'request_access': {
          const requested = (args.apps as string[] | undefined) ?? [];
          const resolved: string[] = [];
          const unresolved: string[] = [];
          for (const req of requested) {
            const id = await resolveApp(req, this.installed);
            if (id) resolved.push(id);
            else unresolved.push(req);
          }
          const allowed = this.policy.allowedBundleIds ?? new Set<string>();
          for (const id of resolved) {
            allowed.add(id);
            this.policy.tiers.set(id, tierForApp(id));
          }
          this.policy.allowedBundleIds = allowed;
          this.policy.requestedNames.push(...requested);
          if (args.systemKeyCombos === true) this.policy.grants.systemKeyCombos = true;
          const lines = [
            `Reason given: ${String(args.reason ?? '')}`,
            `Granted (${allowed.size}): ${[...allowed].join(', ') || '(none)'}`,
          ];
          if (unresolved.length > 0) lines.push(`Could not resolve: ${unresolved.join(', ')}.`);
          lines.push('Background mode: call open_application to choose which granted app receives input.');
          return text(lines.join('\n'));
        }
        case 'list_granted_applications':
          return text(JSON.stringify({
            granted: this.policy.allowedBundleIds ? [...this.policy.allowedBundleIds] : null,
            target: this.driver.target,
            lastScreenshot: this.lastScreenshot?.dims ?? null,
          }, null, 2));
        case 'open_application':
          return text(await this.openApplication(String(args.app ?? '')));
        case 'screenshot':
        case 'zoom':
          if (this.policy.allowedBundleIds === null) {
            throw new PolicyError('request_access has not been called yet. Call it first.', 'needs_access');
          }
          return await this.dispatch(name, args);
        default:
          return await this.dispatch(name, args);
      }
    } catch (e) {
      return errorResult(e);
    }
  }
}

async function openHidden(bundleId: string): Promise<void> {
  // -g: do not bring to the foreground; -b: by bundle ID.
  await execFileAsync('open', ['-g', '-b', bundleId]);
}

// ── Wiring ───────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const installed = await listInstalledApps();
  const helper = new NativeHelper();
  const session = new BackgroundSession(helper, installed);
  const tools = buildBackgroundTools(filterAppsForDescription(installed));
  const server = new Server(
    { name: 'computer-use-background', version: '3.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return (await session.dispatchAll(name, (args ?? {}) as Record<string, unknown>)) as never;
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write('computer-use MCP server (native background mode, experimental) running on stdio\n');
  const shutdown = async () => {
    helper.close();
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.stdin.on('end', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
