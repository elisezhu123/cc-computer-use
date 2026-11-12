import { test, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { splitLines } from './nativeHelper.js';
import {
  closeDesktopHelper,
  createDesktopHelper,
  getDesktopHelper,
  helperEnabled,
  type DesktopHelper,
} from './desktopHelper.js';

after(() => closeDesktopHelper());

test('splitLines reassembles a reply delivered in several chunks', () => {
  let rest = '';
  const out: string[] = [];
  for (const chunk of ['ok AAA', 'ABBB', 'B\nok se', 'cond\n']) {
    const r = splitLines(rest + chunk);
    out.push(...r.lines);
    rest = r.rest;
  }
  assert.deepEqual(out, ['ok AAAABBBB', 'ok second']);
  assert.equal(rest, '');
});

test('helperEnabled honours CU_NATIVE_HELPER=0', () => {
  assert.equal(helperEnabled({ CU_NATIVE_HELPER: '0' }), false);
  assert.equal(helperEnabled({}), true);
});

test('createDesktopHelper formats requests and parses replies', async () => {
  const sent: string[] = [];
  const h = createDesktopHelper({
    close() {},
    async request(line) {
      sent.push(line);
      if (line === 'pos') return '12 -34';
      if (line.startsWith('zoom')) throw new Error('Desktop helper: no frame');
      return Buffer.from('png').toString('base64');
    },
  });
  assert.deepEqual(await h.cursor(), { x: 12, y: -34 });
  assert.equal((await h.shot(1, 1372, 887, 80, 600)).toString(), 'png');
  assert.equal(await h.zoom([0, 0, 10, 10], 40, 40), null);
  assert.deepEqual(sent, ['pos', 'shot 1 1372 887 80 600', 'zoom 0 0 10 10 40 40']);
});

// ── Integration: needs swiftc and Screen Recording permission ────────────────

// The helper is fetched inside each test, not with a top-level await: the
// runner fires `after` as soon as the tests registered so far have finished,
// which would close the helper while it is still starting.
const UNAVAILABLE = 'desktop helper unavailable (no swiftc, no Screen Recording, or CU_NATIVE_HELPER=0)';
async function liveHelper(t: TestContext): Promise<DesktopHelper | null> {
  const h = await getDesktopHelper().catch(() => null);
  if (!h) t.skip(UNAVAILABLE);
  return h;
}

test('displays: main display first, plausible geometry', async (t) => {
  const live = await liveHelper(t);
  if (!live) return;
  const d = await live.displays();
  assert.ok(d.length >= 1 && d[0]!.isMain);
  assert.deepEqual([d[0]!.originX, d[0]!.originY], [0, 0]);
  for (const x of d) assert.ok(x.scaleFactor >= 1 && x.scaleFactor <= 4 && x.logicalWidth > 0);
});

test('shot returns a PNG of exactly the requested size', async (t) => {
  const live = await liveHelper(t);
  if (!live) return;
  const [main] = await live.displays();
  const meta = await sharp(await live.shot(main!.id, 640, 400, 0, 0)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 640, 400]);
});

test('shot with a settle window returns within maxMs plus overhead', async (t) => {
  const live = await liveHelper(t);
  if (!live) return;
  const [main] = await live.displays();
  const started = performance.now();
  await live.shot(main!.id, 640, 400, 80, 600);
  assert.ok(performance.now() - started < 1500);
});

test('zoom crops the retained full-resolution frame', async (t) => {
  const live = await liveHelper(t);
  if (!live) return;
  const [main] = await live.displays();
  await live.shot(main!.id, 640, 400, 0, 0);
  const meta = await sharp((await live.zoom([0, 0, 160, 100], 640, 400))!).metadata();
  assert.deepEqual([meta.width, meta.height], [640, 400]);
});

test('shot of an unknown display is an error, not a hang', async (t) => {
  const live = await liveHelper(t);
  if (!live) return;
  await assert.rejects(live.shot(999999, 640, 400, 0, 0), /no such display/);
});
