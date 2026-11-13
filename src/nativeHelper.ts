/**
 * Runs a Swift helper from native/ as a long-lived child process: compiled with
 * swiftc on first use, then one request line in, one "ok ..."/"err ..." line
 * out. Requests are serialized, so replies always match their request.
 *
 * The binary name includes a hash of the Swift source, so an updated helper
 * is recompiled instead of silently reusing a stale cached build.
 */

import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(homedir(), '.cache', 'computer-use-mcp');

export interface NativeHelperOptions {
  /** File name under native/, e.g. "background.swift". */
  source: string;
  /** Cached binary name prefix, e.g. "cubg". */
  binPrefix: string;
  /** Name used in error messages and the stderr prefix. */
  label: string;
  /** Run this argv instead of compiling `source`. For tests. */
  command?: string[];
  /** How long one request may take before the helper is restarted. Default 10s. */
  timeoutMs?: number;
}

const BACKGROUND: NativeHelperOptions = { source: 'background.swift', binPrefix: 'cubg', label: 'Background' };
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Split buffered stdout into complete lines plus the unterminated remainder.
 * A single reply can be far larger than one pipe chunk (a screenshot is
 * ~750KB of base64), so a line is only complete once its newline arrives.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.map((l) => l.trim()), rest };
}

type Child = ChildProcessWithoutNullStreams;

interface Waiter {
  /** The process this request was written to. A reply or an exit from any
   * other process (the one it replaced, say) must not settle it. */
  child: Child;
  resolve: (line: string) => void;
  reject: (e: Error) => void;
}

export class NativeHelper {
  constructor(private readonly opts: NativeHelperOptions = BACKGROUND) {}

  private child: Child | null = null;
  private binary: Promise<string> | null = null;
  private waiting: Waiter[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  private async compile(): Promise<string> {
    const src = join(HERE, 'native', this.opts.source);
    if (!existsSync(src)) throw new Error(`${this.opts.label} helper source is missing: ${src}`);
    const hash = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 12);
    const bin = join(CACHE_DIR, `${this.opts.binPrefix}-${hash}`);
    if (existsSync(bin)) return bin;
    await mkdir(CACHE_DIR, { recursive: true });
    try {
      await execFileAsync('swiftc', ['-O', '-o', bin, src], { timeout: 180_000 });
    } catch (e) {
      throw new Error(
        `Failed to compile the ${this.opts.label.toLowerCase()} helper. Install the Xcode command line tools with ` +
          `\`xcode-select --install\`. (${e instanceof Error ? e.message.split('\n').slice(0, 5).join(' ') : String(e)})`,
      );
    }
    return bin;
  }

  /** Reject every request written to `child`, and forget it if it is current. */
  private retire(child: Child, why: Error): void {
    if (this.child === child) this.child = null;
    const mine = this.waiting.filter((w) => w.child === child);
    this.waiting = this.waiting.filter((w) => w.child !== child);
    for (const w of mine) w.reject(why);
  }

  private async process(): Promise<Child> {
    if (this.child) return this.child;

    let argv: string[];
    if (this.opts.command) {
      argv = this.opts.command;
    } else {
      this.binary ??= this.compile().catch((e) => { this.binary = null; throw e; });
      argv = [await this.binary];
    }

    const child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    // Decode as a stream: a multi-byte character can straddle two chunks.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      const { lines, rest } = splitLines(buffer + d);
      buffer = rest;
      for (const line of lines) {
        const i = this.waiting.findIndex((w) => w.child === child);
        if (i >= 0) this.waiting.splice(i, 1)[0]!.resolve(line);
      }
    });
    child.stderr.on('data', (d: Buffer) => process.stderr.write(`[${this.opts.binPrefix}] ${d.toString()}`));
    child.on('exit', (code) => {
      this.retire(child, new Error(`${this.opts.label} helper exited with code ${code}.`));
    });
    // Without these listeners a missing binary (cache directory cleared) or a
    // write to a dead process is an uncaught exception that takes the whole
    // MCP server down.
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') this.binary = null; // recompile next time
      this.retire(child, new Error(`${this.opts.label} helper could not be started: ${e.message}`));
    });
    child.stdin.on('error', (e: Error) => {
      this.retire(child, new Error(`${this.opts.label} helper is not accepting input: ${e.message}`));
    });
    this.child = child;
    return child;
  }

  /** Send one request; resolves with the payload after "ok", rejects on "err". */
  request(line: string): Promise<string> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const run = async () => {
      const child = await this.process();
      const reply = await new Promise<string>((resolve, reject) => {
        const entry: Waiter = {
          child,
          resolve: (l) => { clearTimeout(timer); resolve(l); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        };
        // On timeout, retire this process before anything else can use it: a
        // late reply would otherwise be matched to the next request, and the
        // next request must start a fresh process rather than write to this
        // one while it is being killed.
        const timer = setTimeout(() => {
          this.retire(child, new Error(`${this.opts.label} helper did not respond within ${timeoutMs / 1000}s.`));
          child.kill();
        }, timeoutMs);
        this.waiting.push(entry);
        child.stdin.write(`${line}\n`);
      });
      if (reply === 'ok' || reply.startsWith('ok ')) return reply.slice(3);
      throw new Error(`${this.opts.label} helper: ${reply.replace(/^err /, '')}`);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  close(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
