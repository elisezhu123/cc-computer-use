/**
 * Scroll support via a compiled-on-first-use Swift helper.
 *
 * Why not cliclick: it has no scroll command at all. Why not pyobjc: Quartz is
 * not installed in the pyenv python3 on this machine, and requiring a pip
 * install is a worse dependency than a 30-line Swift file the system compiler
 * can build. swiftc ships with the Xcode command line tools already present.
 *
 * The helper is a long-lived child process reading one request per line, so a
 * burst of scrolls costs one spawn total rather than one per tick.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SWIFT_SRC = join(HERE, 'native', 'scroll.swift');
const CACHE_DIR = join(homedir(), '.cache', 'computer-use-mcp');
const BINARY = join(CACHE_DIR, 'cuscroll');
/** Pixels per "tick" of scroll. One tick is one wheel event; the model asks
 * for ticks, this decides how far each travels. */
const PIXELS_PER_TICK = 40;
/** Resolve direction to CGEvent pixel deltas. Positive dy scrolls content up
 * ... which moves the view DOWN, matching the tool's "scroll_direction". */
function deltas(direction, ticks) {
    const px = ticks * PIXELS_PER_TICK;
    switch (direction) {
        case 'down': return [0, px];
        case 'up': return [0, -px];
        case 'right': return [px, 0];
        case 'left': return [-px, 0];
    }
}
let compiled = null;
/** Compile the helper once per process, cached across runs on disk. */
export async function ensureScrollHelper() {
    if (compiled)
        return compiled;
    if (existsSync(BINARY)) {
        compiled = BINARY;
        return BINARY;
    }
    if (!existsSync(SWIFT_SRC)) {
        throw new Error(`Scroll helper source is missing: ${SWIFT_SRC}`);
    }
    await mkdir(CACHE_DIR, { recursive: true });
    try {
        await execFileAsync('swiftc', ['-O', '-o', BINARY, SWIFT_SRC], { timeout: 120_000 });
    }
    catch (e) {
        throw new Error(`Failed to compile the Swift scroll helper. ` +
            `Install the Xcode command line tools with \`xcode-select --install\`. (${String(e)})`);
    }
    await access(BINARY);
    compiled = BINARY;
    return BINARY;
}
let child = null;
function getChild(binary) {
    if (child && !child.killed)
        return child;
    child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('exit', () => { child = null; });
    child.stderr.on('data', (d) => {
        process.stderr.write(`[cuscroll] ${d.toString()}`);
    });
    return child;
}
/** Send one request line to the helper and wait for its ok/err reply. */
async function request(line) {
    const binary = await ensureScrollHelper();
    const proc = getChild(binary);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Scroll helper did not respond within 10s.'));
        }, 10_000);
        const onData = (buf) => {
            const text = buf.toString();
            if (text.includes('ok')) {
                cleanup();
                resolve();
                return;
            }
            const err = /err (.+)/.exec(text);
            if (err) {
                cleanup();
                reject(new Error(`Scroll helper: ${err[1]}`));
            }
        };
        const onExit = (code) => {
            cleanup();
            reject(new Error(`Scroll helper exited with code ${code}.`));
        };
        function cleanup() {
            clearTimeout(timer);
            proc.stdout.off('data', onData);
            proc.off('exit', onExit);
        }
        proc.stdout.on('data', onData);
        proc.once('exit', onExit);
        proc.stdin.write(line, (e) => { if (e) {
            cleanup();
            reject(e);
        } });
    });
}
/**
 * Scroll `ticks` wheel events at a logical-point position.
 *
 * Waits for the helper's "ok"/"err" line so a silent failure (blocked by TCC,
 * helper crashed) surfaces as a tool error instead of an unverified success.
 */
export async function scrollAt(x, y, direction, ticks) {
    if (ticks <= 0)
        return;
    const [dx, dy] = deltas(direction, ticks);
    await request(`scroll ${Math.round(x)} ${Math.round(y)} ${dx} ${dy} ${Math.round(ticks)}\n`);
}
/**
 * Middle-click. cliclick cannot do this at all - it has no middle-button token -
 * so the helper synthesizes CGEvent .otherMouseDown/Up with button 2.
 */
export async function middleClick(x, y, count = 1) {
    await request(`middle ${Math.round(x)} ${Math.round(y)} ${Math.round(count)}\n`);
}
/** Terminate the helper on server shutdown. */
export function closeScrollHelper() {
    if (child && !child.killed)
        child.kill();
    child = null;
}
//# sourceMappingURL=scroll.js.map