import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseChord, toCliclickKey, chordModifiers, moveAndClickArgs } from './input.js';

const execFileAsync = promisify(execFile);

/**
 * The argv checks below need the real cliclick binary (macOS only). Without it
 * every call fails with ENOENT, which cliclickRejects reads as "accepted" - the
 * accept tests would pass vacuously and the reject tests would fail. Skip them
 * explicitly instead.
 */
const NO_CLICLICK = await execFileAsync('cliclick', ['-V']).then(
  () => false,
  (e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? 'cliclick is not installed (brew install cliclick)' : false),
);

/**
 * Ask cliclick itself whether it accepts an argv, via `-m test` (print the
 * action, perform nothing). This is the authoritative check: it is the real
 * binary's real parser, not a copy of its key list that could drift.
 *
 * Returns null when accepted, or cliclick's complaint when not.
 */
async function cliclickRejects(args: string[]): Promise<string | null> {
  try {
    const { stderr, stdout } = await execFileAsync('cliclick', ['-m', 'test', ...args]);
    const out = stdout + stderr;
    return /Invalid|may only be one of/i.test(out) ? out.split('\n')[0]!.trim() : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return /Invalid|may only be one of/i.test(msg) ? msg.split('\n')[0]!.trim() : null;
  }
}

/** Reconstruct the argv that input.ts would emit for a chord press. */
function chordArgv(chord: string): string[] {
  const { mods, keys } = parseChord(chord);
  const args: string[] = [];
  if (mods.length > 0) args.push(`kd:${mods.join(',')}`);
  for (const k of keys) args.push(k.length === 1 ? `t:${k}` : `kp:${k}`);
  if (mods.length > 0) args.push(`ku:${[...mods].reverse().join(',')}`);
  return args;
}

test('toCliclickKey maps the model vocabulary onto cliclick names', () => {
  assert.equal(toCliclickKey('escape'), 'esc');
  assert.equal(toCliclickKey('esc'), 'esc');
  assert.equal(toCliclickKey('backspace'), 'delete');
  assert.equal(toCliclickKey('delete'), 'fwd-delete');
  assert.equal(toCliclickKey('forward-delete'), 'fwd-delete');
  assert.equal(toCliclickKey('pageup'), 'page-up');
  assert.equal(toCliclickKey('page-down'), 'page-down');
  assert.equal(toCliclickKey('arrowup'), 'arrow-up');
  assert.equal(toCliclickKey('arrow-up'), 'arrow-up');
  assert.equal(toCliclickKey('enter'), 'return');
  assert.equal(toCliclickKey('command'), 'cmd');
  assert.equal(toCliclickKey('meta'), 'cmd');
  assert.equal(toCliclickKey('control'), 'ctrl');
  assert.equal(toCliclickKey('option'), 'alt');
  assert.equal(toCliclickKey('Down'), 'arrow-down', 'xdotool-style arrow names');
  assert.equal(toCliclickKey('left'), 'arrow-left');
  assert.equal(toCliclickKey('Page_Down'), 'page-down', 'xdotool-style page names');
  assert.equal(toCliclickKey('Prior'), 'page-up');
  assert.equal(toCliclickKey('super'), 'cmd');
  assert.deepEqual(parseChord('super+shift+Up'), { mods: ['cmd', 'shift'], keys: ['arrow-up'] });
  assert.equal(toCliclickKey('A'), 'a', 'single characters pass through lowercased');
});

test('parseChord separates modifiers from keys and dedupes', () => {
  assert.deepEqual(parseChord('cmd+a'), { mods: ['cmd'], keys: ['a'] });
  assert.deepEqual(parseChord('ctrl+shift+tab'), { mods: ['ctrl', 'shift'], keys: ['tab'] });
  assert.deepEqual(parseChord('cmd+command+q'), { mods: ['cmd'], keys: ['q'] }, 'aliases dedupe');
  assert.deepEqual(parseChord('return'), { mods: [], keys: ['return'] });
  assert.deepEqual(parseChord('cmd+shift'), { mods: ['cmd', 'shift'], keys: [] }, 'modifiers only');
  assert.deepEqual(parseChord('  cmd  +  a  '), { mods: ['cmd'], keys: ['a'] }, 'whitespace tolerated');
  assert.deepEqual(parseChord('option+escape'), { mods: ['alt'], keys: ['esc'] });
});

test('chordModifiers returns only modifiers', () => {
  assert.deepEqual(chordModifiers('cmd+shift+a'), ['cmd', 'shift']);
  assert.deepEqual(chordModifiers('shift'), ['shift']);
  assert.deepEqual(chordModifiers('a'), []);
});

// ── Every emitted argv is checked against the real cliclick binary ───────────

test('cliclick accepts every special-key and character token we emit', { skip: NO_CLICLICK }, async () => {
  const keys = ['return', 'escape', 'tab', 'space', 'backspace', 'delete', 'forward-delete',
    'pageup', 'pagedown', 'home', 'end', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'up', 'down', 'left', 'right', 'page_up', 'page_down',
    'f1', 'f12', 'a', 'Z', '0', '9', '/', '.', '-', '=', '[', ']'];
  const rejects: string[] = [];
  for (const k of keys) {
    const { keys: parsed } = parseChord(k);
    for (const p of parsed) {
      const arg = p.length === 1 ? `t:${p}` : `kp:${p}`;
      const bad = await cliclickRejects([arg]);
      if (bad) rejects.push(`${k} -> ${arg}: ${bad}`);
    }
  }
  assert.deepEqual(rejects, [], `cliclick rejected:\n${rejects.join('\n')}`);
});

test('cliclick accepts every modifier combination we emit', { skip: NO_CLICLICK }, async () => {
  const chords = ['cmd+a', 'cmd+shift+q', 'ctrl+alt+delete', 'cmd+option+escape',
    'shift+tab', 'cmd+tab', 'ctrl+shift+tab', 'alt+f4', 'cmd+space', 'cmd+shift+4'];
  const rejects: string[] = [];
  for (const c of chords) {
    const argv = chordArgv(c);
    const bad = await cliclickRejects(argv);
    if (bad) rejects.push(`${c} -> ${argv.join(' ')}: ${bad}`);
  }
  assert.deepEqual(rejects, [], `cliclick rejected:\n${rejects.join('\n')}`);
});

test('modifiers are never emitted through kp: (the bug that broke every combo)', { skip: NO_CLICLICK }, async () => {
  // kp: is press-and-release; a modifier sent that way is an error, and the
  // original implementation sent every part that way.
  for (const m of ['cmd', 'ctrl', 'alt', 'shift', 'fn']) {
    const bad = await cliclickRejects([`kp:${m}`]);
    assert.ok(bad !== null, `cliclick unexpectedly accepted kp:${m} - the invariant this test protects has changed`);
  }
});

test('letters are never emitted through kp: (also rejected)', { skip: NO_CLICLICK }, async () => {
  for (const ch of ['a', 'z', '0', '9']) {
    const bad = await cliclickRejects([`kp:${ch}`]);
    assert.ok(bad !== null, `cliclick unexpectedly accepted kp:${ch}`);
  }
});

test('moveAndClickArgs moves, settles, and clicks in one argv', () => {
  assert.deepEqual(moveAndClickArgs(100.4, 200.6, 'left', 1), ['m:100,201', 'w:50', 'c:.']);
  assert.deepEqual(moveAndClickArgs(1, 2, 'left', 2), ['m:1,2', 'w:50', 'dc:.']);
  assert.deepEqual(moveAndClickArgs(1, 2, 'right', 2), ['m:1,2', 'w:50', 'rc:.', 'rc:.']);
  assert.deepEqual(
    moveAndClickArgs(1, 2, 'left', 1, ['command', 'shift']),
    ['m:1,2', 'w:50', 'kd:cmd,shift', 'c:.', 'ku:shift,cmd'],
  );
});

test('cliclick accepts every moveAndClick argv', { skip: NO_CLICLICK }, async () => {
  const rejects: string[] = [];
  for (const argv of [
    moveAndClickArgs(10, 20, 'left', 1),
    moveAndClickArgs(10, 20, 'left', 3),
    moveAndClickArgs(10, 20, 'right', 1),
    moveAndClickArgs(10, 20, 'left', 1, ['cmd', 'alt']),
  ]) {
    const bad = await cliclickRejects(argv);
    if (bad) rejects.push(`${argv.join(' ')}: ${bad}`);
  }
  assert.deepEqual(rejects, [], `cliclick rejected:\n${rejects.join('\n')}`);
});
