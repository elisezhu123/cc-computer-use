/**
 * Enhanced utility functions inspired by CC-Source executor.ts
 * Combines CC-Source best practices with standalone implementation
 */
import { exec, spawn } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
// Constants from CC-Source
const MOVE_SETTLE_MS = 50; // Time for mouse move to settle before click
const SCREENSHOT_JPEG_QUALITY = 0.75;
const CLIPBOARD_PASTE_DELAY_MS = 100; // Delay after paste before clipboard restore
/**
 * Sleep utility
 */
export async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Execute an AppleScript command
 */
export async function execAppleScript(script) {
    try {
        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
        return stdout.trim();
    }
    catch (error) {
        throw new Error(`AppleScript error: ${error.message}`);
    }
}
/**
 * Execute a cliclick command
 */
export async function execCliClick(args, extraArgs) {
    try {
        const allArgs = extraArgs ? [...args, ...extraArgs] : args;
        const { stdout } = await execAsync(`cliclick ${allArgs.join(" ")}`);
        return stdout.trim();
    }
    catch (error) {
        throw new Error(`cliclick error: ${error.message}`);
    }
}
/**
 * Get current screen resolution
 */
export async function getScreenInfo() {
    try {
        const { stdout } = await execAsync("system_profiler SPDisplaysDataType | grep Resolution");
        const match = stdout.match(/(\d+)\s*x\s*(\d+)/);
        if (match) {
            return {
                width: parseInt(match[1]),
                height: parseInt(match[2]),
                scaleFactor: 2
            };
        }
    }
    catch (e) {
        // Fallback
    }
    const script = `tell application "Finder" to get bounds of window of desktop`;
    try {
        const result = await execAppleScript(script);
        const coords = result.split(", ").map(Number);
        if (coords.length >= 4) {
            return {
                width: coords[2] - coords[0],
                height: coords[3] - coords[1],
                scaleFactor: 2
            };
        }
    }
    catch (e) {
        // Continue to fallback
    }
    return { width: 3024, height: 1964, scaleFactor: 2 };
}
/**
 * Get current mouse position
 */
export async function getMousePosition() {
    const result = await execCliClick(["p"]);
    const match = result.match(/(\d+),(\d+)/);
    if (!match) {
        throw new Error("Failed to get mouse position");
    }
    return {
        x: parseInt(match[1]),
        y: parseInt(match[2])
    };
}
/**
 * Move mouse and settle (inspired by CC-Source moveAndSettle)
 */
export async function moveMouseAndSettle(x, y) {
    await execCliClick([`m:${x},${y}`]);
    await sleep(MOVE_SETTLE_MS);
}
/**
 * Animated mouse movement with easing (inspired by CC-Source animatedMove)
 * Uses ease-out-cubic at 60fps
 */
export async function animatedMouseMove(targetX, targetY, enabled = true) {
    if (!enabled) {
        await moveMouseAndSettle(targetX, targetY);
        return;
    }
    const start = await getMousePosition();
    const deltaX = targetX - start.x;
    const deltaY = targetY - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 1)
        return;
    // Distance-proportional duration at 2000 px/sec, capped at 0.5s
    const durationSec = Math.min(distance / 2000, 0.5);
    if (durationSec < 0.03) {
        await moveMouseAndSettle(targetX, targetY);
        return;
    }
    const frameRate = 60;
    const frameIntervalMs = 1000 / frameRate;
    const totalFrames = Math.floor(durationSec * frameRate);
    for (let frame = 1; frame <= totalFrames; frame++) {
        const t = frame / totalFrames;
        // Ease-out-cubic
        const eased = 1 - Math.pow(1 - t, 3);
        await execCliClick([`m:${Math.round(start.x + deltaX * eased)},${Math.round(start.y + deltaY * eased)}`]);
        if (frame < totalFrames) {
            await sleep(frameIntervalMs);
        }
    }
    await sleep(MOVE_SETTLE_MS);
}
/**
 * Read clipboard via pbpaste (inspired by CC-Source)
 */
export async function readClipboard() {
    try {
        const { stdout } = await execAsync('pbpaste');
        return stdout;
    }
    catch (error) {
        throw new Error(`pbpaste failed: ${error.message}`);
    }
}
/**
 * Write clipboard via pbcopy (inspired by CC-Source)
 */
export async function writeClipboard(text) {
    return new Promise((resolve, reject) => {
        const pbcopy = spawn('pbcopy');
        pbcopy.on('error', (err) => {
            reject(new Error(`pbcopy failed: ${err.message}`));
        });
        pbcopy.on('close', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`pbcopy exited with code ${code}`));
            }
        });
        pbcopy.stdin.write(text);
        pbcopy.stdin.end();
    });
}
/**
 * Type via clipboard (inspired by CC-Source typeViaClipboard)
 * More reliable than direct typing for long text
 */
export async function typeViaClipboard(text) {
    let savedClipboard;
    try {
        // Save current clipboard
        savedClipboard = await readClipboard();
    }
    catch (e) {
        console.error('[computer-use] pbpaste before paste failed; proceeding without restore');
    }
    try {
        // Write text to clipboard
        await writeClipboard(text);
        // Verify clipboard write
        const verification = await readClipboard();
        if (verification !== text) {
            throw new Error('Clipboard write did not round-trip');
        }
        // Paste via Command+V
        await execCliClick(['kp:cmd', 'kp:v', 'ku:v', 'ku:cmd']);
        // Wait for paste to take effect
        await sleep(CLIPBOARD_PASTE_DELAY_MS);
    }
    finally {
        // Restore original clipboard
        if (savedClipboard !== undefined) {
            try {
                await writeClipboard(savedClipboard);
            }
            catch (e) {
                console.error('[computer-use] clipboard restore after paste failed');
            }
        }
    }
}
/**
 * Take a screenshot
 */
export async function takeScreenshot(outputPath) {
    if (outputPath) {
        await execAsync(`screencapture -x ${outputPath}`);
        return;
    }
    const fs = await import("fs/promises");
    const tmpPath = `/tmp/screenshot-${Date.now()}.png`;
    await execAsync(`screencapture -x ${tmpPath}`);
    const buffer = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath).catch(() => { });
    return buffer;
}
/**
 * Format error messages
 */
export function handleError(error, message) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const fullMessage = message ? `${message}: ${errorMsg}` : errorMsg;
    return `❌ ${fullMessage}`;
}
/**
 * Map key names to cliclick format
 */
export function mapKeyName(key) {
    const keyMap = {
        'escape': 'esc',
        'esc': 'esc',
        'backspace': 'delete',
        'delete': 'delete',
        'forward-delete': 'fwd-delete',
        'pageup': 'page-up',
        'pagedown': 'page-down',
        'arrowup': 'arrow-up',
        'arrowdown': 'arrow-down',
        'arrowleft': 'arrow-left',
        'arrowright': 'arrow-right',
        'return': 'return',
        'enter': 'return',
        'tab': 'tab',
        'space': 'space',
        'command': 'cmd',
        'cmd': 'cmd',
        'control': 'ctrl',
        'ctrl': 'ctrl',
        'option': 'alt',
        'alt': 'alt',
        'shift': 'shift',
    };
    const lowerKey = key.toLowerCase();
    return keyMap[lowerKey] || key;
}
/**
 * Parse key sequence like "ctrl+shift+a" into parts
 */
export function parseKeySequence(sequence) {
    return sequence.split('+')
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .map(mapKeyName);
}
//# sourceMappingURL=utils.js.map