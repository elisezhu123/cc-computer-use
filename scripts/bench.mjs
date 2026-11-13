#!/usr/bin/env node
/**
 * Latency of a screenshot and of an action with its automatic screenshot,
 * with the desktop helper and without it (CU_NATIVE_HELPER=0).
 *
 *   npm run build && node scripts/bench.mjs
 *
 * The action measured is a mouse_move to wherever the cursor already is, so
 * the benchmark does not disturb whoever is using the machine. A click costs
 * the same plus the Accessibility lookup and the button events (~20ms).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = 10;

async function measure() {
  const { createServer, dispatch } = await import(join(ROOT, 'dist/server.js'));
  const { getFrontmostBundleId } = await import(join(ROOT, 'dist/apps.js'));
  const { closeDesktopHelper } = await import(join(ROOT, 'dist/desktopHelper.js'));
  const { closeScrollHelper } = await import(join(ROOT, 'dist/scroll.js'));

  const { ctx } = await createServer();
  // Grant whichever app is in front, so the frontmost-app gate passes.
  ctx.session.allowedBundleIds = new Set([await getFrontmostBundleId()]);
  ctx.frontmost = async () => [...ctx.session.allowedBundleIds][0];

  const timed = async (name, args) => {
    const ms = [];
    for (let i = 0; i < RUNS + 1; i++) {
      const t = performance.now();
      const r = await dispatch(ctx, name, args);
      if (r.isError) throw new Error(`${name} failed: ${r.content[0]?.text}`);
      if (i > 0) ms.push(performance.now() - t); // the first run warms caches
    }
    ms.sort((a, b) => a - b);
    return { median: Math.round(ms[ms.length >> 1]), min: Math.round(ms[0]) };
  };

  await dispatch(ctx, 'screenshot', {});
  const where = await dispatch(ctx, 'cursor_position', {});
  const [, x, y] = /screenshot \((-?\d+), (-?\d+)\)/.exec(where.content[0].text);

  const out = {
    screenshot: await timed('screenshot', {}),
    'mouse_move alone': await timed('mouse_move', { coordinate: [Number(x), Number(y)] }),
    // mouse_move by itself attaches no screenshot; a one-action batch does.
    'mouse_move + auto screenshot': await timed('computer_batch', {
      actions: [{ action: 'mouse_move', coordinate: [Number(x), Number(y)] }],
    }),
  };
  closeDesktopHelper();
  closeScrollHelper();
  return out;
}

if (process.argv[2] === '--child') {
  process.stdout.write(JSON.stringify(await measure()));
  process.exit(0);
}

const run = (env) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr || `benchmark child exited with ${r.status}`);
  return JSON.parse(r.stdout);
};

const helper = run({ CU_NATIVE_HELPER: '1' });
const fallback = run({ CU_NATIVE_HELPER: '0' });

console.log(`median (min) over ${RUNS} runs\n`);
console.log(`${'action'.padEnd(32)}${'helper'.padEnd(18)}cliclick/screencapture`);
for (const k of Object.keys(helper)) {
  const f = (v) => `${v.median}ms (${v.min}ms)`;
  console.log(`${k.padEnd(32)}${f(helper[k]).padEnd(18)}${f(fallback[k])}`);
}
