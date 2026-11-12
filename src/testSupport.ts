/** Shared fixtures for the server-level tests. Not a test file itself. */

import sharp from 'sharp';
import type { ServerContext } from './server.js';
import { newSession } from './policy.js';
import type { DesktopHelper, HelperDisplay } from './desktopHelper.js';
import { displaysFromHelper } from './display.js';

export const MAIN: HelperDisplay = {
  id: 1, name: 'Built-in', isMain: true, originX: 0, originY: 0,
  logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2,
};
export const LEFT: HelperDisplay = {
  id: 5, name: 'LG', isMain: false, originX: -1085, originY: -1080,
  logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 2,
};
export const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#888' } }).png().toBuffer();

export function testContext(helper: Partial<DesktopHelper>, displays = [MAIN]): ServerContext {
  const session = newSession();
  session.allowedBundleIds = new Set(['com.apple.TextEdit']);
  return {
    displays: displaysFromHelper(displays),
    activeDisplayIndex: 1,
    session,
    lastScreenshot: null,
    installed: [],
    installedNames: [],
    autoScreenshot: false,
    helper: helper as DesktopHelper,
    frontmost: async () => 'com.apple.TextEdit',
  };
}
