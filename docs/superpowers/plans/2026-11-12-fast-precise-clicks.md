# Fast, Precise Desktop Clicks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面模式每次动作的本地耗时从约 1 秒降到 0.4 秒以内，并减少密集 UI 上的点偏。

**Architecture:** 新增常驻 Swift helper（`src/native/desktop.swift`）接管桌面模式的截图、鼠标、前台检查和显示器几何；TS 侧通过 `src/desktopHelper.ts` 调用，不可用时返回 `null`，各模块回退到现有的 `cliclick` / `screencapture` / `lsappinfo` 实现。点击前用辅助功能查询落点控件，由纯函数 `chooseClickPoint` 决定是否吸附。

**Tech Stack:** TypeScript（Node ≥ 18，`node:test`）、Swift（ScreenCaptureKit、ApplicationServices、AppKit）、sharp（仅回退路径）。

**Spec:** `docs/superpowers/specs/2026-11-12-fast-precise-clicks-design.md`

## Global Constraints

- 只改桌面模式。`background*.ts`、`browser*.ts`、`driverServer.ts`、`native/background.swift`、`scroll.ts`、`imageResize.ts` 的行为不变。
- `CU_NATIVE_HELPER=0` 或 helper 编译/启动失败 → 所有调用点走现有实现，行为与改动前一致。
- `CU_CLICK_SNAP=0` → 从不吸附，只报告点中的控件。
- 吸附半径：6 个截图像素。稳定判定：`minMs` 80、`maxMs` 600、采样间隔约 50ms。辅助功能超时 150ms。点击前稳定等待 50ms。
- 控件标题：截断到 60 字符，字符白名单与 `apps.ts` 的应用名过滤一致（`/[^\p{L}\p{N} .&+_'#@()\-]/gu`）。
- helper 二进制：`~/.cache/computer-use-mcp/cudesk-<源码 sha256 前 12 位>`。
- 键盘与文本输入继续用 `cliclick`。
- `guard()` 仍是每个输入动作恰好一次。
- 截图保持 PNG，尺寸仍由 `targetImageSize` 决定。
- 提交信息用 `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` 前缀；分支 `phase/01-fast-precise-clicks`；不要提交 `package-lock.json` 的既有改动。
- 测试命令：`npm test`。

## Review Focus

1. **会话中途插拔显示器或改分辨率**：`shot` 遇到不存在的 displayID 时应重新探测显示器并给出明确错误，而不是用旧几何继续点击。→ Task 5
2. **helper 回复被拆成多个 stdout 分块**（一张截图的 base64 约 750KB）：必须拼成完整一行再解析。→ Task 3
3. **辅助功能查询失败或超时**（应用无响应）：点击照常执行，结果里不写控件信息。→ Task 6
4. **吸附后的落点或控件外框超出屏幕**：落点必须夹在当前显示器范围内。→ Task 2
5. **helper 重启后保留帧丢失时调用 `zoom`**：回退到裁剪 `ctx.lastScreenshot.png`，不报错。→ Task 5

## File Structure

| 文件 | 职责 |
|---|---|
| `src/native/desktop.swift`（新） | helper：`displays` `front` `pos` `shot` `zoom` `hit` `click` `move` `down` `up` `drag` |
| `src/desktopHelper.ts`（新） | helper 的类型化封装、可用性判定、失败计数 |
| `src/nativeHelper.ts`（改） | 参数化源文件名、二进制前缀、日志标签，供两个 helper 共用 |
| `src/snap.ts`（新） | `chooseClickPoint`、`sanitizeLabel`、`describeHit`，纯函数 |
| `src/coords.ts`（改） | `DisplayGeometry` 加原点 |
| `src/display.ts` `screen.ts` `input.ts` `apps.ts` `autoScreenshot.ts` `server.ts`（改） | 优先走 helper，保留回退 |
| `scripts/bench.mjs`（新） | helper 路径与回退路径的耗时对比 |

---

### Task 1: 坐标换算加入显示器原点

**Files:**
- Modify: `src/coords.ts`
- Test: `src/coords.test.ts`

**Interfaces:**
- Produces: `DisplayGeometry` 新增可选字段 `originX?: number; originY?: number`（缺省视为 0）。`modelToLogical` / `logicalToModel` 签名不变。

- [ ] **Step 1: 写失败的测试**

```ts
const LEFT_4K = { logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 2, originX: -1085, originY: -1080 };
const DIMS_4K = { targetWidth: 1456, targetHeight: 819 };

test('modelToLogical adds the display origin', () => {
  assert.deepEqual(modelToLogical(0, 0, DIMS_4K, LEFT_4K), { x: -1085, y: -1080 });
  assert.deepEqual(modelToLogical(728, 410, DIMS_4K, LEFT_4K), { x: -125, y: -539 });
});

test('logicalToModel subtracts the display origin and round-trips', () => {
  assert.deepEqual(logicalToModel(-1085, -1080, DIMS_4K, LEFT_4K), { x: 0, y: 0 });
  const p = modelToLogical(1000, 500, DIMS_4K, LEFT_4K);
  const back = logicalToModel(p.x, p.y, DIMS_4K, LEFT_4K);
  assert.ok(Math.abs(back.x - 1000) <= 1 && Math.abs(back.y - 500) <= 1);
});

test('a geometry without an origin behaves as before', () => {
  assert.deepEqual(modelToLogical(686, 443, { targetWidth: 1372, targetHeight: 887 }, BUILTIN), { x: 864, y: 558 });
});
```

- [ ] **Step 2: 运行确认失败** — `npm test`，新增的前两个用例 FAIL。
- [ ] **Step 3: 实现** — 在 `modelToLogical` 的结果上加原点，在 `logicalToModel` 换算前减原点；`dims` 为 null 的直通分支不加原点。
- [ ] **Step 4: 运行确认通过** — `npm test` 全部 PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat: map coordinates against the display origin"`

---

### Task 2: 吸附判定（纯函数）

**Files:**
- Create: `src/snap.ts`
- Test: `src/snap.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Rect { x: number; y: number; w: number; h: number }
export interface HitElement { role: string; label: string; frame: Rect; bundleId: string | null }
export interface HitResult { at: HitElement | null; nearby: HitElement[] }
export interface SnapOptions {
  frontmostBundleId: string | null;
  radius: number;          // logical points
  enabled: boolean;
  bounds: Rect;            // active display, logical points
}
export interface ClickChoice { point: { x: number; y: number }; snapped: boolean; element: HitElement | null }

export const ACTIONABLE_ROLES: ReadonlySet<string>;  // AXButton AXCheckBox AXRadioButton AXPopUpButton AXMenuButton AXMenuItem AXMenuBarItem AXLink AXTextField AXTextArea AXComboBox AXSlider AXIncrementor AXDisclosureTriangle AXTab AXSegment
export const CONTAINER_ROLES: ReadonlySet<string>;   // AXWindow AXGroup AXToolbar AXScrollArea AXSplitGroup AXTabGroup AXLayoutArea AXUnknown

export function sanitizeLabel(raw: string): string;
export function chooseClickPoint(point: { x: number; y: number }, hit: HitResult, opts: SnapOptions): ClickChoice;
export function describeHit(choice: ClickChoice): string;  // 'Hit: AXButton "Device".' | 'snapped to nearest control AXButton "Device".' | ''
export function snapEnabled(env?: NodeJS.ProcessEnv): boolean;  // CU_CLICK_SNAP !== '0'
```

- [ ] **Step 1: 写失败的测试**

```ts
const APP = 'com.apple.TextEdit';
const BOUNDS = { x: 0, y: 0, w: 1728, h: 1117 };
const opts = { frontmostBundleId: APP, radius: 8, enabled: true, bounds: BOUNDS };
const el = (role: string, frame: Rect, bundleId = APP, label = 'Device'): HitElement => ({ role, label, frame, bundleId });
const TOOLBAR = el('AXToolbar', { x: 0, y: 30, w: 800, h: 30 });
const BUTTON = el('AXButton', { x: 100, y: 34, w: 20, h: 20 });

test('an actionable hit is left alone and reported', () => {
  const c = chooseClickPoint({ x: 105, y: 40 }, { at: BUTTON, nearby: [] }, opts);
  assert.deepEqual(c, { point: { x: 105, y: 40 }, snapped: false, element: BUTTON });
});

test('a container hit snaps to the nearest actionable neighbour, inset 2pt', () => {
  const far = el('AXButton', { x: 131, y: 34, w: 20, h: 20 }, APP, 'Other');
  const c = chooseClickPoint({ x: 125, y: 40 }, { at: TOOLBAR, nearby: [far, BUTTON] }, opts);
  assert.equal(c.snapped, true);
  assert.deepEqual(c.point, { x: 118, y: 40 });
  assert.equal(c.element, BUTTON);
});

test('a neighbour beyond the radius is ignored', () => {
  const c = chooseClickPoint({ x: 135, y: 40 }, { at: TOOLBAR, nearby: [BUTTON] }, opts);
  assert.deepEqual(c, { point: { x: 135, y: 40 }, snapped: false, element: TOOLBAR });
});

test('never snaps onto another app', () => {
  const foreign = el('AXButton', { x: 100, y: 34, w: 20, h: 20 }, 'com.apple.Terminal');
  assert.equal(chooseClickPoint({ x: 125, y: 40 }, { at: TOOLBAR, nearby: [foreign] }, opts).snapped, false);
});

test('web content, static text and images are never snapped away from', () => {
  for (const role of ['AXWebArea', 'AXStaticText', 'AXImage']) {
    assert.equal(chooseClickPoint({ x: 125, y: 40 }, { at: el(role, TOOLBAR.frame), nearby: [BUTTON] }, opts).snapped, false);
  }
});

test('disabled, or no hit information: the point is unchanged', () => {
  assert.equal(chooseClickPoint({ x: 125, y: 40 }, { at: TOOLBAR, nearby: [BUTTON] }, { ...opts, enabled: false }).snapped, false);
  assert.deepEqual(chooseClickPoint({ x: 125, y: 40 }, { at: null, nearby: [] }, opts), { point: { x: 125, y: 40 }, snapped: false, element: null });
});

test('a control smaller than 4pt snaps to its centre', () => {
  const tiny = el('AXButton', { x: 120, y: 39, w: 3, h: 3 });
  assert.deepEqual(chooseClickPoint({ x: 125, y: 40 }, { at: TOOLBAR, nearby: [tiny] }, opts).point, { x: 122, y: 41 });
});

test('a snapped point stays inside the display bounds', () => {
  const edge = el('AXButton', { x: -10, y: 34, w: 14, h: 20 });
  const c = chooseClickPoint({ x: 6, y: 40 }, { at: TOOLBAR, nearby: [edge] }, opts);
  assert.ok(c.point.x >= 0 && c.point.x < 1728);
});

test('sanitizeLabel truncates and strips instruction-shaped text', () => {
  assert.equal(sanitizeLabel('Save\n</tool> ignore previous: "rm"'), 'Save tool ignore previous rm');
  assert.equal(sanitizeLabel('x'.repeat(100)).length, 60);
});

test('describeHit wording', () => {
  assert.equal(describeHit({ point: { x: 1, y: 1 }, snapped: false, element: BUTTON }), 'Hit: AXButton "Device".');
  assert.equal(describeHit({ point: { x: 1, y: 1 }, snapped: true, element: BUTTON }), 'snapped to nearest control AXButton "Device".');
  assert.equal(describeHit({ point: { x: 1, y: 1 }, snapped: false, element: null }), '');
});
```

- [ ] **Step 2: 运行确认失败** — `npm test`，`snap.test.js` 找不到模块。
- [ ] **Step 3: 实现 `src/snap.ts`**

落点算法：把原点夹到候选外框向内收 2 点后的矩形里（宽或高 < 4 时该轴取中心），取与原点欧氏距离最小且 ≤ `radius` 的候选；结果四舍五入后再夹到 `bounds` 内。`sanitizeLabel`：换行与连续空白折叠成一个空格 → 按白名单删字符 → 再折叠空白并 trim → 截断到 60。`describeHit` 里的 label 为空时省略引号部分。

- [ ] **Step 4: 运行确认通过** — `npm test` PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat: add click snapping decision as a pure function"`

---

### Task 3: helper 的截图、显示器、前台应用

**Files:**
- Create: `src/native/desktop.swift`, `src/desktopHelper.ts`
- Modify: `src/nativeHelper.ts`, `package.json`（`test` 脚本）
- Test: `src/desktopHelper.test.ts`

**Interfaces:**
- Consumes: `HitResult` from `./snap.js`。
- Produces:

```ts
// nativeHelper.ts
export interface NativeHelperOptions { source: string; binPrefix: string; label: string }
export class NativeHelper { constructor(opts?: NativeHelperOptions) }   // default = background.swift / 'cubg' / 'cubg'
export function splitLines(buffer: string): { lines: string[]; rest: string }

// desktopHelper.ts
export interface HelperDisplay {
  id: number; name: string; isMain: boolean;
  originX: number; originY: number; logicalWidth: number; logicalHeight: number; scaleFactor: number;
}
export interface DesktopHelper {
  displays(): Promise<HelperDisplay[]>;
  frontmost(): Promise<string | null>;
  cursor(): Promise<{ x: number; y: number }>;
  shot(displayId: number, tw: number, th: number, minMs: number, maxMs: number): Promise<Buffer>;
  /** null when the helper holds no frame (e.g. it restarted). Region is in screenshot pixels. */
  zoom(region: readonly [number, number, number, number], ow: number, oh: number): Promise<Buffer | null>;
  hit(x: number, y: number, radius: number): Promise<HitResult>;                                  // Task 4
  click(button: 0 | 1 | 2, x: number, y: number, count: number, flags: number): Promise<void>;    // Task 4
  move(x: number, y: number): Promise<void>;                                                       // Task 4
  down(): Promise<void>; up(): Promise<void>;                                                      // Task 4
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;              // Task 4
  close(): void;
}
export function helperEnabled(env?: NodeJS.ProcessEnv): boolean;   // CU_NATIVE_HELPER !== '0'
/** The shared helper, or null when disabled, uncompilable, or failed twice in a row. */
export function getDesktopHelper(): Promise<DesktopHelper | null>;
export function closeDesktopHelper(): void;
export function createDesktopHelper(transport: { request(line: string): Promise<string>; close(): void }): DesktopHelper;
```

helper 协议（本任务的部分）：

| 请求 | 回复 |
|---|---|
| `displays` | `ok <json array of HelperDisplay>`，主屏排第一 |
| `front` | `ok <bundleId>`，无前台应用时 `ok` |
| `pos` | `ok <x> <y>` |
| `shot <displayID> <tw> <th> <minMs> <maxMs>` | `ok <base64 png>`；displayID 不存在 → `err no such display <id>` |
| `zoom <x0> <y0> <x1> <y1> <ow> <oh>` | `ok <base64 png>`；无保留帧 → `err no frame` |

- [ ] **Step 1: 写失败的测试**

```ts
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
      if (line === 'front') return 'com.apple.TextEdit';
      if (line === 'pos') return '12 -34';
      if (line.startsWith('zoom')) throw new Error('Desktop helper: no frame');
      return Buffer.from('png').toString('base64');
    },
  });
  assert.equal(await h.frontmost(), 'com.apple.TextEdit');
  assert.deepEqual(await h.cursor(), { x: 12, y: -34 });
  assert.equal((await h.shot(1, 1372, 887, 80, 600)).toString(), 'png');
  assert.equal(await h.zoom([0, 0, 10, 10], 40, 40), null);
  assert.deepEqual(sent, ['front', 'pos', 'shot 1 1372 887 80 600', 'zoom 0 0 10 10 40 40']);
});

// Integration: needs swiftc and Screen Recording permission.
const live = await getDesktopHelper().catch(() => null);
const SKIP = live ? false : 'desktop helper unavailable (no swiftc, or CU_NATIVE_HELPER=0)';

test('displays: main display first, plausible geometry', { skip: SKIP }, async () => {
  const d = await live!.displays();
  assert.ok(d.length >= 1 && d[0]!.isMain);
  assert.deepEqual([d[0]!.originX, d[0]!.originY], [0, 0]);
  for (const x of d) assert.ok(x.scaleFactor >= 1 && x.scaleFactor <= 4 && x.logicalWidth > 0);
});

test('shot returns a PNG of exactly the requested size', { skip: SKIP }, async () => {
  const [main] = await live!.displays();
  const meta = await sharp(await live!.shot(main!.id, 640, 400, 0, 0)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 640, 400]);
});

test('shot with a settle window returns within maxMs plus overhead', { skip: SKIP }, async () => {
  const [main] = await live!.displays();
  const t = performance.now();
  await live!.shot(main!.id, 640, 400, 80, 600);
  assert.ok(performance.now() - t < 1500);
});

test('zoom crops the retained full-resolution frame', { skip: SKIP }, async () => {
  const [main] = await live!.displays();
  await live!.shot(main!.id, 640, 400, 0, 0);
  const meta = await sharp((await live!.zoom([0, 0, 160, 100], 640, 400))!).metadata();
  assert.deepEqual([meta.width, meta.height], [640, 400]);
});

test('shot of an unknown display is an error, not a hang', { skip: SKIP }, async () => {
  await assert.rejects(live!.shot(999999, 640, 400, 0, 0), /no such display/);
});

test('front matches lsappinfo', { skip: SKIP }, async () => {
  assert.equal(await live!.frontmost(), await getFrontmostBundleIdViaLsappinfo());
});
```

`getFrontmostBundleIdViaLsappinfo` 是 `apps.ts` 现有 `getFrontmostBundleId` 的 lsappinfo 部分，Task 5 会把它拆出来；本任务先在测试里直接 `import { getFrontmostBundleId } from './apps.js'` 代替，Task 5 改名时一并更新。

- [ ] **Step 2: 运行确认失败** — `npm test`。
- [ ] **Step 3: 参数化 `NativeHelper`** — 构造函数接受 `NativeHelperOptions`，错误文字和 stderr 前缀用 `label`；把 stdout 的按行拆分提成导出的 `splitLines`；无参构造行为不变（`background.test.ts` 不改即通过）。
- [ ] **Step 4: 把 `package.json` 的 `test` 脚本改为** `tsc && npm run copy-native && node --test dist/*.test.js`（集成测试要在 `dist/native/` 里找到 Swift 源码）。
- [ ] **Step 5: 实现 `src/native/desktop.swift` 的 `displays` `front` `pos` `shot` `zoom`**

实现者需要知道的约束：
- stdin 读取放在后台线程，主线程跑 `RunLoop.main.run()`。`NSWorkspace.frontmostApplication` 在没有主 run loop 的进程里会返回过期值；如果实测仍然过期，改为取 `CGWindowListCopyWindowInfo(.optionOnScreenOnly)` 里第一个 layer 0 窗口的所属进程。
- 截图用 `SCScreenshotManager.captureImage(contentFilter:configuration:completionHandler:)`（async 版本在当前 SDK 里不返回图像），`showsCursor = false`。`SCShareableContent` 缓存起来，`shot` 找不到 displayID 时刷新一次再判定。
- `shot`：以 `width = logicalWidth * scale` 截全分辨率一帧并保留（连同 `tw`、`th`），再用 `CGContext`（`interpolationQuality = .high`）缩到 `tw×th`，`CGImageDestination` 编码 PNG。
- 稳定判定：`maxMs > 0` 时，每约 50ms 截一张宽 160 的小图，与上一张逐像素比较；任一通道差值 > 8 的像素占比 < 0.5% 且已过 `minMs` 即稳定；到 `maxMs` 无条件截图。
- `zoom`：区域按 `全分辨率宽 / tw` 换算到保留帧上裁剪，再缩放到 `ow×oh`。
- `displays` 的名称用 `NSScreen.localizedName`，原点用 `CGDisplayBounds`（左上角为原点的全局坐标，与 CGEvent 一致）。

- [ ] **Step 6: 实现 `src/desktopHelper.ts`** — `getDesktopHelper` 懒加载单例，`new NativeHelper({ source: 'desktop.swift', binPrefix: 'cudesk', label: 'cudesk' })`；首次调用用 `displays` 探活，失败则在 stderr 写一行原因并此后返回 `null`。封装层统计传输级失败（进程退出、超时），连续 2 次后关闭 helper 并此后返回 `null`；`err` 回复不计入。`zoom` 把 `no frame` 错误转成 `null`。
- [ ] **Step 7: 运行确认通过** — `npm test` PASS（本机上集成用例不应被跳过）。
- [ ] **Step 8: 提交** — `git commit -m "feat: add desktop helper for capture, displays and frontmost app"`

---

### Task 4: helper 的鼠标与控件查询

**Files:**
- Modify: `src/native/desktop.swift`, `src/desktopHelper.ts`
- Test: `src/desktopHelper.test.ts`

**Interfaces:**
- Produces: Task 3 接口里标注 Task 4 的方法。协议：

| 请求 | 回复 |
|---|---|
| `hit <x> <y> <radius>` | `ok <json {at, nearby}>`，元素字段同 `HitElement`，`label` 为原始文本 |
| `click <button> <x> <y> <count> <flags>` | `ok` |
| `move <x> <y>` | `ok` |
| `down` / `up` | `ok`（当前光标位置，左键） |
| `drag <x0> <y0> <x1> <y1>` | `ok` |

- [ ] **Step 1: 写失败的测试**

```ts
test('createDesktopHelper: mouse and hit requests', async () => {
  const sent: string[] = [];
  const h = createDesktopHelper({
    close() {},
    async request(line) {
      sent.push(line);
      return line.startsWith('hit')
        ? JSON.stringify({ at: { role: 'AXButton', label: 'Save\nnow', frame: { x: 1, y: 2, w: 3, h: 4 }, bundleId: 'a.b' }, nearby: [] })
        : '';
    },
  });
  await h.click(0, 519.4, 48.6, 2, 0x100000);
  await h.move(10, 20); await h.down(); await h.up();
  await h.drag({ x: 1, y: 2 }, { x: 3, y: 4 });
  const hit = await h.hit(5, 6, 7.56);
  assert.deepEqual(sent, ['click 0 519 49 2 1048576', 'move 10 20', 'down', 'up', 'drag 1 2 3 4', 'hit 5 6 7.56']);
  assert.equal(hit.at!.label, 'Save now', 'labels are sanitized on the way in');
});

test('createDesktopHelper: a failed hit is empty, not an error', async () => {
  const h = createDesktopHelper({ close() {}, async request() { throw new Error('Desktop helper: ax timeout'); } });
  assert.deepEqual(await h.hit(1, 1, 8), { at: null, nearby: [] });
});

test('hit on the menu bar finds a menu bar item', { skip: SKIP }, async () => {
  const hit = await live!.hit(40, 12, 8);
  assert.equal(hit.at?.role, 'AXMenuBarItem');
});

test('malformed mouse requests are rejected', { skip: SKIP }, async () => {
  await assert.rejects(live!.click(0, Number.NaN, 0, 1, 0));
});
```

集成测试不实际发送点击或移动，避免测试时动用户的鼠标。

- [ ] **Step 2: 运行确认失败** — `npm test`。
- [ ] **Step 3: 在 `desktop.swift` 实现 `hit` `click` `move` `down` `up` `drag`**

- 鼠标事件用 `CGEvent(mouseEventSource:mouseType:mouseCursorPosition:mouseButton:)` + `.post(tap: .cghidEventTap)`。
- `click`：发 move → `usleep(50_000)` → 对 `i in 1...count` 发 down/up 并设置 `mouseEventClickState = i`；`flags` 写到每个事件的 `flags`。button 0/1/2 对应 left/right/center。
- `drag`：move 到起点 → 50ms → leftMouseDown → 10 步 `leftMouseDragged` 线性插值（每步间隔 10ms）→ leftMouseUp。
- `hit`：`AXUIElementCreateSystemWide()` 上 `AXUIElementSetMessagingTimeout(…, 0.15)`；`AXUIElementCopyElementAtPosition` 取原点的元素；再在 `radius/2` 和 `radius` 两个半径、8 个方向共 16 个点上各查一次，按元素去重后作为 `nearby`（不含 `at` 本身）。每个元素读 `AXRole`、`AXTitle`（空则 `AXDescription`）、`AXPosition` + `AXSize`、`AXUIElementGetPid` → bundle ID。任何一步失败该元素略过；原点查询失败时回复 `ok {"at":null,"nearby":[]}`。

- [ ] **Step 4: 在 `desktopHelper.ts` 实现对应方法** — 坐标四舍五入为整数（`hit` 的半径除外）；`hit` 对每个 label 调 `sanitizeLabel`，请求抛错时返回空结果。
- [ ] **Step 5: 运行确认通过** — `npm test` PASS。
- [ ] **Step 6: 提交** — `git commit -m "feat: add mouse input and accessibility hit testing to the desktop helper"`

---

### Task 5: 截图、显示器、前台检查接入 helper

**Files:**
- Modify: `src/display.ts`, `src/screen.ts`, `src/apps.ts`, `src/autoScreenshot.ts`, `src/server.ts`
- Test: `src/screen.test.ts`（新）, `src/display.test.ts`（新）

**Interfaces:**
- Consumes: `getDesktopHelper()`, `DesktopHelper`, `HelperDisplay`。
- Produces:

```ts
// display.ts
export interface AttachedDisplay { index: number; name: string; isMain: boolean; geometry: DisplayGeometry; displayId?: number }
export function displaysFromHelper(list: HelperDisplay[]): AttachedDisplay[];   // index = position + 1

// screen.ts
export interface CaptureOptions { settle?: { minMs: number; maxMs: number }; saveToDiskPath?: string }
export async function capture(display: AttachedDisplay, opts?: CaptureOptions, helper?: DesktopHelper | null): Promise<CapturedScreenshot>;
export async function zoomRegion(fullScreenshotPng: Buffer, region: readonly [number, number, number, number], helper?: DesktopHelper | null): Promise<{ data: Buffer; width: number; height: number }>;

// apps.ts
export async function getFrontmostBundleId(helper?: DesktopHelper | null): Promise<string | null>;
export async function getFrontmostBundleIdViaLsappinfo(): Promise<string | null>;   // the existing body

// autoScreenshot.ts
export const AUTO_SCREENSHOT_SETTLE = { minMs: 80, maxMs: 600 };
```

`helper` 参数缺省时各函数内部调用 `getDesktopHelper()`；显式传 `null` 强制走回退，供测试使用。

- [ ] **Step 1: 写失败的测试**

```ts
// display.test.ts
test('displaysFromHelper keeps origins and numbers displays from 1', () => {
  const out = displaysFromHelper([
    { id: 1, name: 'Built-in', isMain: true, originX: 0, originY: 0, logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 },
    { id: 5, name: 'LG', isMain: false, originX: -1085, originY: -1080, logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 2 },
  ]);
  assert.deepEqual(out.map((d) => [d.index, d.displayId, d.geometry.originX]), [[1, 1, 0], [2, 5, -1085]]);
});

// screen.test.ts
const DISPLAY = { index: 1, name: 'x', isMain: true, displayId: 7, geometry: { logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2 } };
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#888' } }).png().toBuffer();

test('capture asks the helper for the API target size and the settle window', async () => {
  const calls: unknown[][] = [];
  const helper = { shot: async (...a: unknown[]) => { calls.push(a); return png(1372, 887); } } as unknown as DesktopHelper;
  const shot = await capture(DISPLAY, { settle: { minMs: 80, maxMs: 600 } }, helper);
  assert.deepEqual(calls, [[7, 1372, 887, 80, 600]]);
  assert.deepEqual(shot.dims, { targetWidth: 1372, targetHeight: 887 });
});

test('capture without a settle window does not wait', async () => {
  const calls: unknown[][] = [];
  const helper = { shot: async (...a: unknown[]) => { calls.push(a); return png(1372, 887); } } as unknown as DesktopHelper;
  await capture(DISPLAY, {}, helper);
  assert.deepEqual(calls[0]!.slice(3), [0, 0]);
});

test('zoomRegion falls back to cropping the screenshot when the helper has no frame', async () => {
  const helper = { zoom: async () => null } as unknown as DesktopHelper;
  const out = await zoomRegion(await png(1372, 887), [0, 0, 392, 222], helper);
  assert.deepEqual([out.width, out.height], [1568, 888]);
});

test('zoomRegion uses the helper frame when there is one', async () => {
  const calls: unknown[][] = [];
  const helper = { zoom: async (...a: unknown[]) => { calls.push(a); return png(1568, 888); } } as unknown as DesktopHelper;
  await zoomRegion(await png(1372, 887), [0, 0, 392, 222], helper);
  assert.deepEqual(calls, [[[0, 0, 392, 222], 1568, 888]]);
});
```

- [ ] **Step 2: 运行确认失败** — `npm test`。
- [ ] **Step 3: `display.ts`** — 加 `displaysFromHelper`；`detectDisplays()` 在 helper 可用时返回 `displaysFromHelper(await helper.displays())`，否则走现有逻辑。`preflightPermissions()` 在 helper 可用时用一次 `shot`（0, 0 等待）代替 `screencapture` 探测，`cliclick` 检查保留（键盘仍依赖它）。
- [ ] **Step 4: `screen.ts`** — `capture` 改为接收 `AttachedDisplay`。helper 路径：`targetImageSize(round(logicalW*scale), round(logicalH*scale))` → `helper.shot(display.displayId, tw, th, minMs, maxMs)`。回退路径：传了 `settle` 就先在 JS 里 sleep 250ms（与改动前的固定等待一致），没传则不等，再走现有的 `screencapture` + `sharp` 代码。`zoomRegion`：输出尺寸的算法不变；helper 返回非 null 就用它，否则走现有裁剪。
- [ ] **Step 5: `apps.ts`** — 现有函数体改名为 `getFrontmostBundleIdViaLsappinfo`；`getFrontmostBundleId` 先试 helper 的 `frontmost()`，helper 为 null 或抛错时回退。把 Task 3 测试里的 import 改成 `getFrontmostBundleIdViaLsappinfo`。
- [ ] **Step 6: `autoScreenshot.ts` 与 `server.ts`** — `withAutoScreenshot` 去掉自身的 sleep，`take` 回调改为接收 settle 窗口：`take: (settle: { minMs: number; maxMs: number }) => Promise<Result>`，调用时传 `AUTO_SCREENSHOT_SETTLE`；`settleMs` 参数删除。`server.ts` 的 `doScreenshot(ctx, saveToDisk, settle?)` 把 `settle` 传给 `capture`；直接调用 `screenshot` 工具时不传。`driverServer.ts` 的调用点保持原来的 250ms 行为：它在自己的 `take` 里先 sleep `this.autoScreenshotSettleMs` 再截图。`server.ts` 里 `shot` 抛出 `no such display` 时：重新 `detectDisplays()` 更新 `ctx.displays`，把 `activeDisplayIndex` 重置为主屏，`lastScreenshot = null`，返回错误 `The display configuration changed. Take a new screenshot before continuing.`
- [ ] **Step 7: 更新受影响的现有测试** — `autoScreenshot` 相关用例按新的 `take` 签名调整；确认 `background.test.ts`、`browser.test.ts` 不需要改动即通过。
- [ ] **Step 8: 运行确认通过** — `npm test` PASS；再跑 `CU_NATIVE_HELPER=0 npm test` 也 PASS。
- [ ] **Step 9: 提交** — `git commit -m "feat: capture, zoom and frontmost check through the desktop helper"`

---

### Task 6: 点击接入 helper，报告并吸附

**Files:**
- Modify: `src/input.ts`, `src/server.ts`
- Test: `src/click.test.ts`（新）

**Interfaces:**
- Consumes: `DesktopHelper`, `chooseClickPoint`, `describeHit`, `snapEnabled`, `parseNativeChord`（`nativeKeys.ts`，取 `.flags`）。
- Produces:

```ts
// input.ts — each takes an optional helper; null/undefined-and-unavailable falls back to cliclick
export async function moveAndClick(x, y, button: 'left' | 'right' | 'middle', count: 1 | 2 | 3, modifiersChord?: string, helper?: DesktopHelper | null): Promise<void>;
export async function moveMouse(x, y, helper?): Promise<void>;
export async function getMousePosition(helper?): Promise<{ x: number; y: number }>;
export async function mouseDown(helper?): Promise<void>;
export async function mouseUp(helper?): Promise<void>;
export async function drag(from, to, helper?): Promise<void>;

// server.ts
export async function resolveClick(
  ctx: ServerContext, model: readonly [number, number], helper: DesktopHelper | null,
): Promise<{ point: { x: number; y: number }; note: string }>;
```

`moveAndClick` 的第 5 个参数从修饰键数组改成原始 chord 字符串：helper 路径用 `parseNativeChord(chord).flags`，回退路径用现有的 `chordModifiers(chord)`。middle 键在回退路径上仍调用 `scroll.ts` 的 `middleClick`。

- [ ] **Step 1: 写失败的测试**

```ts
const GEOM = { logicalWidth: 1728, logicalHeight: 1117, scaleFactor: 2, originX: 0, originY: 0 };
function ctxWith(frontmost = 'com.apple.TextEdit'): ServerContext { /* one display GEOM, lastScreenshot dims 1372x887, session granting `frontmost` */ }
const TOOLBAR = { role: 'AXToolbar', label: '', frame: { x: 0, y: 30, w: 800, h: 30 }, bundleId: 'com.apple.TextEdit' };
const BUTTON = { role: 'AXButton', label: 'Device', frame: { x: 100, y: 34, w: 20, h: 20 }, bundleId: 'com.apple.TextEdit' };
function fake(hit: HitResult | Error) {
  const sent: string[] = [];
  const helper = {
    frontmost: async () => 'com.apple.TextEdit',
    hit: async (x: number, y: number, r: number) => { sent.push(`hit ${x} ${y} ${r.toFixed(2)}`); if (hit instanceof Error) return { at: null, nearby: [] }; return hit; },
    click: async (...a: number[]) => { sent.push(`click ${a.join(' ')}`); },
  } as unknown as DesktopHelper;
  return { helper, sent };
}

test('resolveClick reports the control under the point', async () => {
  const { helper } = fake({ at: BUTTON, nearby: [] });
  const r = await resolveClick(ctxWith(), [87, 35], helper);          // logical (110, 44)
  assert.deepEqual(r.point, { x: 110, y: 44 });
  assert.equal(r.note, 'Hit: AXButton "Device".');
});

test('resolveClick snaps out of a gap and says so', async () => {
  const { helper, sent } = fake({ at: TOOLBAR, nearby: [BUTTON] });
  const r = await resolveClick(ctxWith(), [99, 35], helper);          // logical (125, 44)
  assert.deepEqual(r.point, { x: 118, y: 44 });
  assert.match(r.note, /^snapped to nearest control AXButton "Device"\.$/);
  assert.equal(sent[0], 'hit 125 44 7.56');                           // 6 px * 1728/1372
});

test('resolveClick with no helper, or a failed lookup, leaves the point alone', async () => {
  assert.deepEqual(await resolveClick(ctxWith(), [99, 35], null), { point: { x: 125, y: 44 }, note: '' });
  const { helper } = fake(new Error('ax timeout'));
  assert.deepEqual(await resolveClick(ctxWith(), [99, 35], helper), { point: { x: 125, y: 44 }, note: '' });
});

test('CU_CLICK_SNAP=0 reports but does not move the point', async () => { /* set env for the call; expect point (125, 44) and note 'Hit: AXToolbar.' */ });

test('left_click through dispatch clicks the resolved point and reports it', async () => {
  // dispatch(ctx, 'left_click', { coordinate: [99, 35] }) with autoScreenshot: false and the fake helper injected
  // sent ends with 'click 0 118 44 1 0'; result text matches
  // /Clicked left at screenshot \(99, 35\): snapped to \(94, 35\), nearest control AXButton "Device"\./
});
```

`dispatch` 需要能注入 helper：给 `ServerContext` 加可选字段 `helper?: DesktopHelper | null`（`undefined` 表示用 `getDesktopHelper()`），所有调用点通过一个 `helperFor(ctx)` 取用。

- [ ] **Step 2: 运行确认失败** — `npm test`。
- [ ] **Step 3: `input.ts`** — 鼠标函数优先走 helper，回退到现有 `cliclick` 调用；`getMousePosition` 用 `helper.cursor()`。`drag` 的 `from` 为 null 时 helper 路径先取 `cursor()`。
- [ ] **Step 4: `server.ts`** — 实现 `resolveClick`：`toLogical` → helper 为 null 则直接返回 → `helper.hit(x, y, 6 * logicalWidth / targetWidth)` → `chooseClickPoint`（`bounds` 取当前显示器的原点与逻辑尺寸，`frontmostBundleId` 取 `helper.frontmost()`，`enabled` 取 `snapEnabled()`）→ `note = describeHit(choice)`；吸附时把新落点用 `logicalToModel` 换回截图像素写进文字。`doClick` 与 `doBatch` 的四种点击都改走它。结果文字：

  - 未吸附：`Clicked left at screenshot (412, 38) = logical (519, 48). Hit: AXButton "Device".`（无控件信息时没有最后一句）
  - 吸附：`Clicked left at screenshot (430, 38): snapped to (424, 38), nearest control AXButton "Device".`

  `mouse_move`、`left_click_drag`、`left_mouse_down/up` 只换到 helper 输入，不调用 `resolveClick`。`main()` 的 shutdown 里加 `closeDesktopHelper()`。
- [ ] **Step 5: 运行确认通过** — `npm test` 和 `CU_NATIVE_HELPER=0 npm test` 都 PASS。
- [ ] **Step 6: 提交** — `git commit -m "feat: click through the desktop helper with hit reporting and snapping"`

---

### Task 7: 基准、实机验证、文档

**Files:**
- Create: `scripts/bench.mjs`
- Modify: `reports/ARCHITECTURE.md`, `reports/CHANGELOG.md`, `reports/TESTING.md`, `README.md`（环境变量表）, `docs/phases.md`

**Interfaces:**
- Consumes: `dist/server.js` 的 `createServer`、`dispatch`。

- [ ] **Step 1: 写 `scripts/bench.mjs`** — 对 `screenshot` 和 `mouse_move`（含自动截图；目标是屏幕中心，不产生点击）各跑 10 次，打印中位数和最小值；用 `CU_NATIVE_HELPER=0` 再跑一遍子进程，两组并排输出。运行前在 ctx 上把 Finder 加入白名单并断言前台应用已授权，否则提示用户先把一个已授权应用切到前台。
- [ ] **Step 2: 运行基准** — `npm run build && node scripts/bench.mjs`。期望 helper 路径的 `mouse_move`（含截图）中位数 ≤ 400ms。未达标则先定位（稳定判定的等待、全分辨率截图后的缩放、base64 传输各占多少）再调整，不要改完成标准。
- [ ] **Step 3: 实机验证**（通过 MCP 客户端或直接调 `dispatch`，逐条记录结果）
  1. 授权 TextEdit，打开一个文档，`left_click` 工具栏上的一个小按钮：结果里的控件名与截图一致。
  2. 故意点在两个工具栏按钮之间的缝隙：结果报告吸附，且生效的是相邻按钮。
  3. `CU_CLICK_SNAP=0` 重复第 2 步：不吸附。
  4. `switch_display` 到副屏，`screenshot`，`mouse_move` 到截图中心，`cursor_position` 返回的截图坐标与目标相差 ≤ 1 像素，且光标确实在那块屏上。
  5. `zoom` 一块含小字的区域：文字比改动前清晰（保存前后两张图对比）。
  6. 切换前台应用后立刻执行一个动作：`not_granted` / 放行的判断跟随新的前台应用（验证 `front` 没有返回过期值）。
  7. `CU_NATIVE_HELPER=0` 启动，重复第 1 步：功能正常，结果里没有控件信息。
- [ ] **Step 4: 更新文档** — `ARCHITECTURE.md`：能力对照表、模块列表、性能一节、时序常量表、新增"点击反馈与吸附"一节；`CHANGELOG.md` 的未发布段落；`TESTING.md` 的测试数量和新的跳过条件；`README.md` 加 `CU_NATIVE_HELPER`、`CU_CLICK_SNAP`；`docs/phases.md` 勾选完成标准并写上实测数字。
- [ ] **Step 5: 提交** — `git commit -m "docs: document the desktop helper, click snapping and benchmarks"`
