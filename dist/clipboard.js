/**
 * Clipboard access via pbcopy/pbpaste.
 *
 * The read-back verification in pasteText is not ceremony: clipboard writes can
 * silently fail (a clipboard manager holding the pasteboard, or a large write
 * racing the paste). Pasting unverified would inject whatever was already on
 * the clipboard into the user's focused application.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export async function readClipboard() {
    const { stdout } = await execFileAsync('pbpaste', [], {
        maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
}
export async function writeClipboard(text) {
    await new Promise((resolve, reject) => {
        const proc = spawn('pbcopy');
        proc.on('error', (e) => reject(new Error(`pbcopy failed: ${e.message}`)));
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`pbcopy exited with code ${code}`)));
        proc.stdin.write(text);
        proc.stdin.end();
    });
}
/**
 * Paste `text` by temporarily replacing the clipboard, then restoring it.
 *
 * The restore is in a finally so a throw between write and paste never leaves
 * the user's clipboard clobbered. A 100ms settle after Cmd+V is the threshold
 * where the target app has read the pasteboard but we have not yet restored -
 * restoring sooner makes the app paste the RESTORED content instead.
 */
export async function pasteText(text, pressPaste) {
    let saved;
    try {
        saved = await readClipboard();
    }
    catch {
        process.stderr.write('[computer-use] pbpaste before paste failed; proceeding without restore\n');
    }
    try {
        await writeClipboard(text);
        if ((await readClipboard()) !== text) {
            throw new Error('Clipboard write did not round-trip; refusing to paste.');
        }
        await pressPaste();
        await new Promise((r) => setTimeout(r, 100));
    }
    finally {
        if (typeof saved === 'string') {
            try {
                await writeClipboard(saved);
            }
            catch {
                process.stderr.write('[computer-use] clipboard restore after paste failed\n');
            }
        }
    }
}
//# sourceMappingURL=clipboard.js.map