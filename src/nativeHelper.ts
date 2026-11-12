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
}

const BACKGROUND: NativeHelperOptions = { source: 'background.swift', binPrefix: 'cubg', label: 'Background' };

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

export class NativeHelper {
  constructor(private readonly opts: NativeHelperOptions = BACKGROUND) {}

  private child: ChildProcessWithoutNullStreams | null = null;
  private binary: Promise<string> | null = null;
  private buffer = '';
  private waiting: { resolve: (line: string) => void; reject: (e: Error) => void }[] = [];
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

  private async process(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child && !this.child.killed && this.child.exitCode === null) return this.child;
    this.binary ??= this.compile().catch((e) => { this.binary = null; throw e; });
    const child = spawn(await this.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    child.stdout.on('data', (d: Buffer) => {
      const { lines, rest } = splitLines(this.buffer + d.toString());
      this.buffer = rest;
      for (const line of lines) this.waiting.shift()?.resolve(line);
    });
    child.stderr.on('data', (d: Buffer) => process.stderr.write(`[${this.opts.binPrefix}] ${d.toString()}`));
    child.on('exit', (code) => {
      this.child = null;
      for (const w of this.waiting.splice(0)) w.reject(new Error(`${this.opts.label} helper exited with code ${code}.`));
    });
    this.child = child;
    return child;
  }

  /** Send one request; resolves with the payload after "ok", rejects on "err". */
  request(line: string): Promise<string> {
    const run = async () => {
      const child = await this.process();
      const reply = await new Promise<string>((resolve, reject) => {
        const entry = {
          resolve: (l: string) => { clearTimeout(timer); resolve(l); },
          reject: (e: Error) => { clearTimeout(timer); reject(e); },
        };
        // On timeout, drop this waiter and restart the helper: a late reply
        // would otherwise be matched to the next request.
        const timer = setTimeout(() => {
          this.waiting = this.waiting.filter((w) => w !== entry);
          child.kill();
          reject(new Error(`${this.opts.label} helper did not respond within 10s.`));
        }, 10_000);
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
    this.child?.kill();
    this.child = null;
  }
}
