/**
 * App enumeration, frontmost detection, and activation.
 *
 * Enumeration and activation use different mechanisms on purpose. mdfind
 * (Spotlight) gives the full installed set across /Applications and
 * ~/Applications, which is what request_access needs to resolve display names.
 * But Spotlight is often slow or disabled, so the frontmost check - which runs
 * before EVERY input action - uses System Events instead, which is immediate.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
const execFileAsync = promisify(execFile);
/** Bundle IDs read via `defaults` for a .app path. */
async function readBundleId(appPath) {
    const plist = `${appPath}/Contents/Info.plist`;
    try {
        const { stdout } = await execFileAsync('defaults', ['read', plist.replace(/\.plist$/, ''), 'CFBundleIdentifier']);
        const id = stdout.trim();
        return id.length > 0 ? id : null;
    }
    catch {
        return null;
    }
}
/**
 * Roots scanned for installed applications.
 *
 * /System/Library/CoreServices is included because macOS puts real, user-facing
 * apps there - Finder, Keychain Access, Archive Utility, Disk Utility - and a
 * user naming "Finder" must resolve. It also holds ~145 bundles that are
 * background daemons (loginwindow, liquiddetectiond, CoreLocationAgent), so its
 * inclusion is only viable because NAME_PATTERN_BLOCKLIST and the daemon-shape
 * rule below drop almost all of them before they reach a tool description.
 */
const ENUMERATION_ROOTS = [
    '/Applications',
    '/System/Applications',
    '/System/Library/CoreServices',
    `${homedir()}/Applications`,
];
/**
 * Enumerate installed applications. Timed by the caller (the tool description
 * is a nice-to-have, not a startup dependency).
 */
export async function listInstalledApps() {
    const roots = ENUMERATION_ROOTS;
    const seen = new Set();
    const out = [];
    for (const root of roots) {
        let paths = [];
        try {
            const { stdout } = await execFileAsync('mdfind', [
                '-onlyin', root,
                'kMDItemContentType == "com.apple.application-bundle"',
            ]);
            paths = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
        }
        catch {
            continue;
        }
        for (const appPath of paths) {
            if (seen.has(appPath))
                continue;
            seen.add(appPath);
            const bundleId = await readBundleId(appPath);
            if (!bundleId)
                continue;
            const base = appPath.split('/').pop() ?? appPath;
            out.push({ bundleId, displayName: base.replace(/\.app$/, ''), path: appPath });
        }
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
}
/** Bundle ID of the frontmost application, or null if undeterminable. */
export async function getFrontmostBundleId() {
    try {
        const { stdout } = await execFileAsync('osascript', [
            '-e',
            'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
        ]);
        const id = stdout.trim();
        return id.length > 0 ? id : null;
    }
    catch {
        return null;
    }
}
export async function listRunningApps() {
    try {
        const { stdout } = await execFileAsync('osascript', [
            '-e',
            'tell application "System Events" to get bundle identifier of every application process whose background only is false',
        ]);
        const ids = stdout.split(',').map((s) => s.trim()).filter(Boolean);
        return ids.map((bundleId) => ({ bundleId, displayName: bundleId, isFrontmost: false }));
    }
    catch {
        return [];
    }
}
/** Ask Spotlight for the path of a bundle ID. Empty when not installed. */
async function pathForBundleId(bundleId) {
    try {
        const { stdout } = await execFileAsync('mdfind', [
            `kMDItemCFBundleIdentifier == '${bundleId.replace(/'/g, "")}'`,
        ]);
        const first = stdout.split('\n').map((s) => s.trim()).find(Boolean);
        return first ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Resolve a requested app to a bundle ID.
 *
 * Enumerated apps are checked first (fast, exact). On a miss the request is
 * treated as a bundle ID and looked up in Spotlight directly - this is what
 * finds system apps outside the enumeration roots, Finder being the one that
 * matters in practice (it lives in /System/Library/CoreServices).
 *
 * A name that matches nothing returns null so the caller can report which
 * requests failed, rather than silently granting an empty set.
 */
export async function resolveApp(request, installed) {
    const q = request.trim().toLowerCase();
    if (q.length === 0)
        return null;
    const byBundle = installed.find((a) => a.bundleId.toLowerCase() === q);
    if (byBundle)
        return byBundle.bundleId;
    const byName = installed.find((a) => a.displayName.toLowerCase() === q);
    if (byName)
        return byName.bundleId;
    // Bundle-ID fallback. Reverse-DNS shape only, so a display name that happens
    // to miss above does not turn into a wildcard Spotlight query.
    if (/^[a-z0-9]+(\.[a-z0-9_-]+)+$/i.test(request.trim())) {
        const path = await pathForBundleId(request.trim());
        if (path)
            return request.trim();
    }
    return null;
}
/** Bring an app to the front, launching it if necessary. */
export async function activateApp(bundleId) {
    await execFileAsync('osascript', [
        '-e', `tell application id "${bundleId}" to activate`,
    ]);
}
// ── Description-time filtering ───────────────────────────────────────────────
/**
 * Background services mdfind returns that are never useful to the model.
 *
 * The keyword rules match at end-of-string OR immediately before " (" so
 * "Slack Helper (GPU)" and "ABAssistantService" are caught while "Service Desk"
 * (keyword followed by more words) is not.
 */
const NAME_PATTERN_BLOCKLIST = [
    /Helper(?:$|\s\()/,
    /Agent(?:$|\s\()/,
    /Service(?:$|\s\()/,
    /Uninstaller(?:$|\s\()/,
    /Updater(?:$|\s\()/,
    /Installer(?:$|\s\()/,
    /Launcher(?:$|\s\()/,
    /Forwarder(?:$|\s\()/,
    /Simulator(?:$|\s\()/,
    /UIServer(?:$|\s\()/,
    /^Desktop \d+/,
    /^Screen Sharing/,
    /^\./,
];
/**
 * Daemon naming shape: a single all-lowercase token, optionally ending in "d"
 * ("liquiddetectiond", "loginwindow", "rcd"). Real user-facing apps are
 * multi-word or capitalized, so this drops OS plumbing without needing an
 * exhaustive name list that the next macOS release would invalidate.
 */
const DAEMON_SHAPE = /^[a-z][a-z0-9]*$/;
/**
 * Always advertised if installed, bypassing the count cap.
 *
 * Two groups: the apps automation is usually aimed at, and the macOS system
 * apps that live in /System/Library/CoreServices. The system apps need to be
 * named explicitly because that directory contributes ~145 bundles and the cap
 * would otherwise push Finder off the end of the list - the model would then
 * never see the one system app a user is most likely to name.
 *
 * Bundle IDs, not display names: they are locale-invariant, so this list
 * survives a non-English system. Keep it short - each entry is a guaranteed
 * token in the tool description.
 */
const ALWAYS_KEEP_BUNDLE_IDS = new Set([
    // Browsers
    'com.apple.Safari', 'com.google.Chrome', 'org.mozilla.firefox',
    'com.microsoft.edgemac', 'company.thebrowser.Browser',
    // Communication
    'com.tinyspeck.slackmacgap', 'com.apple.MobileSMS', 'com.apple.mail',
    'us.zoom.xos', 'com.microsoft.teams2',
    // Productivity
    'com.microsoft.Word', 'com.microsoft.Excel', 'com.microsoft.Powerpoint',
    'com.microsoft.Outlook', 'com.apple.iWork.Pages', 'com.apple.iWork.Numbers',
    'com.apple.iWork.Keynote', 'com.apple.Notes', 'com.apple.reminders',
    'com.apple.iCal', 'com.apple.systempreferences',
    // System apps from /System/Library/CoreServices
    'com.apple.finder', 'com.apple.TextEdit', 'com.apple.Preview',
    'com.apple.keychainaccess', 'com.apple.archiveutility',
    'com.apple.DiskUtility', 'com.apple.ScreenSaver.Engine',
    'com.apple.systempreferences',
]);
const MAX_DESCRIPTION_APPS = 80;
/**
 * Sanitize the app list for inclusion in the request_access tool description.
 *
 * Two concerns: noise (Spotlight returns XPC helpers and daemons) and
 * prompt-injection hardening - app display names are attacker-controlled,
 * anyone can ship an app called anything. Names are length-capped and stripped
 * to a character allowlist, so a name cannot smuggle instructions.
 */
export function filterAppsForDescription(apps) {
    // Keep the whole object until the cap is applied. An earlier version mapped
    // to names first, which silently broke ALWAYS_KEEP_BUNDLE_IDS: the bundle-ID
    // check ran against a display name, never matched, and alphabetical
    // truncation then dropped Finder and TextEdit off the end of the list.
    const kept = [];
    for (const app of apps) {
        const always = ALWAYS_KEEP_BUNDLE_IDS.has(app.bundleId);
        if (!always) {
            if (NAME_PATTERN_BLOCKLIST.some((re) => re.test(app.displayName)))
                continue;
            if (DAEMON_SHAPE.test(app.displayName))
                continue;
        }
        // Allowlist: letters, digits, space, and the punctuation real app names
        // use. App names are attacker-controlled - anyone can ship an app called
        // anything - so a name cannot smuggle instructions into the description.
        const clean = app.displayName
            .replace(/[^\p{L}\p{N} .&+_'#@()\-]/gu, '')
            .slice(0, 40)
            .trim();
        if (clean.length === 0)
            continue;
        kept.push({ bundleId: app.bundleId, name: clean, always });
    }
    // Dedupe by name (two bundles can share a display name), preferring the
    // always-keep entry so promotion survives deduplication.
    const byName = new Map();
    for (const e of kept) {
        const prev = byName.get(e.name);
        if (!prev || (e.always && !prev.always))
            byName.set(e.name, e);
    }
    const all = [...byName.values()];
    // Always-keep entries are included regardless of the cap; the rest fill the
    // remaining slots alphabetically.
    const pinned = all.filter((e) => e.always).sort((a, b) => a.name.localeCompare(b.name));
    const rest = all.filter((e) => !e.always).sort((a, b) => a.name.localeCompare(b.name));
    const room = Math.max(0, MAX_DESCRIPTION_APPS - pinned.length);
    return [...pinned, ...rest.slice(0, room)].map((e) => e.name);
}
//# sourceMappingURL=apps.js.map