/**
 * App enumeration, frontmost detection, and activation.
 *
 * Enumeration and activation use different mechanisms on purpose. mdfind
 * (Spotlight) gives the full installed set across /Applications and
 * ~/Applications, which is what request_access needs to resolve display names.
 * But Spotlight is often slow or disabled, so the frontmost check - which runs
 * before EVERY input action - asks LaunchServices directly via lsappinfo,
 * falling back to System Events.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import type { InstalledApp, RunningApp } from './types.js';

const execFileAsync = promisify(execFile);

/** Bundle IDs read via `defaults` for a .app path. */
async function readBundleId(appPath: string): Promise<string | null> {
  const plist = `${appPath}/Contents/Info.plist`;
  try {
    const { stdout } = await execFileAsync('defaults', ['read', plist.replace(/\.plist$/, ''), 'CFBundleIdentifier']);
    const id = stdout.trim();
    return id.length > 0 ? id : null;
  } catch {
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
/** Map with at most `limit` calls in flight, preserving order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Parse `mdfind -attr kMDItemCFBundleIdentifier` output. Each line is
 * "<path>   kMDItemCFBundleIdentifier = <id>", with "(null)" when Spotlight
 * has no bundle ID for the item.
 */
export function parseMdfindBundleIds(stdout: string): { path: string; bundleId: string | null }[] {
  const out: { path: string; bundleId: string | null }[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^(.*?\.app)\s+kMDItemCFBundleIdentifier\s*=\s*(.*)$/.exec(line.trim());
    if (m) {
      const id = m[2]!.trim().replace(/^"(.*)"$/, '$1');
      out.push({ path: m[1]!, bundleId: id && id !== '(null)' ? id : null });
    } else if (line.trim().endsWith('.app')) {
      out.push({ path: line.trim(), bundleId: null });
    }
  }
  return out;
}

/**
 * Enumerate installed applications. Timed by the caller (the tool description
 * is a nice-to-have, not a startup dependency).
 *
 * One mdfind per root returns paths and bundle IDs together; `defaults read`
 * is only spawned for the few bundles Spotlight has no ID for, and those run
 * concurrently. Reading every bundle with `defaults` serially cost one process
 * per installed app at startup.
 */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  const found = await Promise.all(
    ENUMERATION_ROOTS.map(async (root) => {
      try {
        const { stdout } = await execFileAsync('mdfind', [
          '-onlyin', root,
          '-attr', 'kMDItemCFBundleIdentifier',
          'kMDItemContentType == "com.apple.application-bundle"',
        ], { maxBuffer: 16 * 1024 * 1024 });
        return parseMdfindBundleIds(stdout);
      } catch {
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  const entries = found.flat().filter((e) => !seen.has(e.path) && seen.add(e.path));
  const resolved = await mapLimit(entries, 16, async (e) => ({
    ...e,
    bundleId: e.bundleId ?? (await readBundleId(e.path)),
  }));

  const out: InstalledApp[] = [];
  for (const { path, bundleId } of resolved) {
    if (!bundleId) continue;
    const base = path.split('/').pop() ?? path;
    out.push({ bundleId, displayName: base.replace(/\.app$/, ''), path });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

/** Parse `lsappinfo info -only bundleid` output: "CFBundleIdentifier"="com.x". */
export function parseLsappinfoBundleId(stdout: string): string | null {
  const m = /"CFBundleIdentifier"\s*=\s*"([^"]+)"/.exec(stdout);
  return m ? m[1]! : null;
}

/**
 * Frontmost app via LaunchServices. lsappinfo is a plain local query, so two
 * short spawns cost a fraction of an osascript Apple-event round trip to
 * System Events - which matters because this runs before every action - and
 * it needs no Automation permission.
 */
async function frontmostViaLsappinfo(): Promise<string | null> {
  try {
    const { stdout: asn } = await execFileAsync('lsappinfo', ['front']);
    const front = asn.trim();
    if (!/^ASN:/.test(front)) return null;
    const { stdout } = await execFileAsync('lsappinfo', ['info', '-only', 'bundleid', front]);
    return parseLsappinfoBundleId(stdout);
  } catch {
    return null;
  }
}

/** Bundle ID of the frontmost application, or null if undeterminable. */
export async function getFrontmostBundleId(): Promise<string | null> {
  const fast = await frontmostViaLsappinfo();
  if (fast) return fast;
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
    ]);
    const id = stdout.trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function listRunningApps(): Promise<RunningApp[]> {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to get bundle identifier of every application process whose background only is false',
    ]);
    const ids = stdout.split(',').map((s) => s.trim()).filter(Boolean);
    return ids.map((bundleId) => ({ bundleId, displayName: bundleId, isFrontmost: false }));
  } catch {
    return [];
  }
}

/** Ask Spotlight for the path of a bundle ID. Empty when not installed. */
async function pathForBundleId(bundleId: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('mdfind', [
      `kMDItemCFBundleIdentifier == '${bundleId.replace(/'/g, "")}'`,
    ]);
    const first = stdout.split('\n').map((s) => s.trim()).find(Boolean);
    return first ?? null;
  } catch {
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
export async function resolveApp(
  request: string,
  installed: readonly InstalledApp[],
): Promise<string | null> {
  const q = request.trim().toLowerCase();
  if (q.length === 0) return null;

  const byBundle = installed.find((a) => a.bundleId.toLowerCase() === q);
  if (byBundle) return byBundle.bundleId;

  const byName = installed.find((a) => a.displayName.toLowerCase() === q);
  if (byName) return byName.bundleId;

  // Bundle-ID fallback. Reverse-DNS shape only, so a display name that happens
  // to miss above does not turn into a wildcard Spotlight query.
  if (/^[a-z0-9]+(\.[a-z0-9_-]+)+$/i.test(request.trim())) {
    const path = await pathForBundleId(request.trim());
    if (path) return request.trim();
  }

  return null;
}

/** Bring an app to the front, launching it if necessary. */
export async function activateApp(bundleId: string): Promise<void> {
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
const NAME_PATTERN_BLOCKLIST: readonly RegExp[] = [
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
const ALWAYS_KEEP_BUNDLE_IDS: ReadonlySet<string> = new Set([
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
export function filterAppsForDescription(
  apps: readonly InstalledApp[],
): string[] {
  // Keep the whole object until the cap is applied. An earlier version mapped
  // to names first, which silently broke ALWAYS_KEEP_BUNDLE_IDS: the bundle-ID
  // check ran against a display name, never matched, and alphabetical
  // truncation then dropped Finder and TextEdit off the end of the list.
  const kept: { bundleId: string; name: string; always: boolean }[] = [];

  for (const app of apps) {
    const always = ALWAYS_KEEP_BUNDLE_IDS.has(app.bundleId);
    if (!always) {
      if (NAME_PATTERN_BLOCKLIST.some((re) => re.test(app.displayName))) continue;
      if (DAEMON_SHAPE.test(app.displayName)) continue;
    }
    // Allowlist: letters, digits, space, and the punctuation real app names
    // use. App names are attacker-controlled - anyone can ship an app called
    // anything - so a name cannot smuggle instructions into the description.
    const clean = app.displayName
      .replace(/[^\p{L}\p{N} .&+_'#@()\-]/gu, '')
      .slice(0, 40)
      .trim();
    if (clean.length === 0) continue;
    kept.push({ bundleId: app.bundleId, name: clean, always });
  }

  // Dedupe by name (two bundles can share a display name), preferring the
  // always-keep entry so promotion survives deduplication.
  const byName = new Map<string, { bundleId: string; name: string; always: boolean }>();
  for (const e of kept) {
    const prev = byName.get(e.name);
    if (!prev || (e.always && !prev.always)) byName.set(e.name, e);
  }

  const all = [...byName.values()];

  // Always-keep entries are included regardless of the cap; the rest fill the
  // remaining slots alphabetically.
  const pinned = all.filter((e) => e.always).sort((a, b) => a.name.localeCompare(b.name));
  const rest = all.filter((e) => !e.always).sort((a, b) => a.name.localeCompare(b.name));
  const room = Math.max(0, MAX_DESCRIPTION_APPS - pinned.length);

  return [...pinned, ...rest.slice(0, room)].map((e) => e.name);
}
