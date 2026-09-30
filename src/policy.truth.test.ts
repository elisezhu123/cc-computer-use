import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertActionAllowed, assertChordAllowed, newSession, tierForApp, PolicyError, type SessionState } from './policy.js';

const KINDS = ['read', 'click', 'type', 'key', 'scroll'] as const;

function session(apps: string[], grants: Partial<{ clipboardRead: boolean; clipboardWrite: boolean; systemKeyCombos: boolean }> = {}): SessionState {
  const s = newSession();
  s.allowedBundleIds = new Set(apps);
  for (const a of apps) s.tiers.set(a, tierForApp(a, true));
  Object.assign(s.grants, grants);
  return s;
}

/** Does the gate allow this combination? */
function allows(s: SessionState, bundleId: string | null, kind: (typeof KINDS)[number]): boolean {
  try { assertActionAllowed(s, bundleId, kind); return true; }
  catch (e) { if (e instanceof PolicyError) return false; throw e; }
}

test('full truth table (strict tiers): allowlist x tier x action', () => {
  const cases: [string, string, string, boolean][] = [
    // [label, app, action, expected]
    ['no allowlist at all', '', 'click', false],
  ];
  // Nothing is allowed before request_access.
  for (const kind of KINDS) {
    const s = newSession();
    assert.equal(allows(s, 'com.apple.TextEdit', kind), false, `no-allowlist/${kind}`);
  }

  const full = session(['com.apple.TextEdit']);
  for (const kind of KINDS) {
    assert.equal(allows(full, 'com.apple.TextEdit', kind), true, `full-tier/${kind} must be allowed`);
  }

  const read = session(['com.apple.Safari']);
  for (const kind of KINDS) {
    assert.equal(allows(read, 'com.apple.Safari', kind), false, `read-tier/${kind} must be refused`);
  }

  const click = session(['com.apple.Terminal']);
  assert.equal(allows(click, 'com.apple.Terminal', 'click'), true, 'click-tier allows clicking');
  assert.equal(allows(click, 'com.apple.Terminal', 'scroll'), true, 'click-tier allows scrolling');
  assert.equal(allows(click, 'com.apple.Terminal', 'read'), true, 'click-tier allows reading');
  assert.equal(allows(click, 'com.apple.Terminal', 'type'), false, 'click-tier refuses typing');
  assert.equal(allows(click, 'com.apple.Terminal', 'key'), false, 'click-tier refuses keys');

  // An app in the allowlist but with an unrelated app frontmost.
  assert.equal(allows(full, 'com.apple.Notes', 'click'), false, 'unlisted frontmost app');
  assert.equal(allows(full, null, 'click'), false, 'undeterminable frontmost app');
  assert.equal(allows(full, 'com.apple.TextEdit', 'click'), true, 'listed frontmost app');
  void cases;
});

test('each restriction reports a distinguishable code', () => {
  const codes: [() => void, string][] = [
    [() => assertActionAllowed(newSession(), 'com.apple.TextEdit', 'click'), 'needs_access'],
    [() => assertActionAllowed(session(['com.apple.TextEdit']), 'com.apple.Notes', 'click'), 'not_granted'],
    [() => assertActionAllowed(session(['com.apple.TextEdit']), null, 'click'), 'not_granted'],
    [() => assertActionAllowed(session(['com.apple.Safari']), 'com.apple.Safari', 'click'), 'denied_tier'],
    [() => assertActionAllowed(session(['com.apple.Terminal']), 'com.apple.Terminal', 'type'), 'denied_tier'],
    [() => assertActionAllowed(session(['com.apple.TextEdit']), 'com.apple.TextEdit', 'clipboard_read'), 'needs_flag'],
  ];
  for (const [fn, expected] of codes) {
    assert.throws(fn, (e: unknown) => e instanceof PolicyError && e.code === expected,
      `expected code ${expected}, got ${((): string => { try { fn(); return 'no throw'; } catch (e) { return e instanceof PolicyError ? e.code : String(e); } })()}`);
  }
});

test('grant flags are independent of each other', () => {
  const base = session(['com.apple.TextEdit']);
  assert.equal(allows(base, 'com.apple.TextEdit', 'click'), true);
  assert.throws(() => assertActionAllowed(base, null, 'clipboard_read'),
    (e: unknown) => e instanceof PolicyError && e.code === 'needs_flag');
  assert.throws(() => assertActionAllowed(base, null, 'clipboard_write'),
    (e: unknown) => e instanceof PolicyError && e.code === 'needs_flag');

  const both = session(['com.apple.TextEdit'], { clipboardRead: true, clipboardWrite: true });
  assert.doesNotThrow(() => assertActionAllowed(both, null, 'clipboard_read'));
  assert.doesNotThrow(() => assertActionAllowed(both, null, 'clipboard_write'));

  // systemKeyCombos is orthogonal to clipboard access.
  assert.equal(allows(both, 'com.apple.TextEdit', 'click'), true);
});

test('clipboard is not scoped to the frontmost app, other actions are', () => {
  const s = session(['com.apple.TextEdit'], { clipboardRead: true });
  // No app frontmost - clipboard still works.
  assert.doesNotThrow(() => assertActionAllowed(s, null, 'clipboard_read'));
  // But a click with no frontmost app does not.
  assert.throws(() => assertActionAllowed(s, null, 'click'));
});

test('systemKeyCombos gates the blocklist and nothing else', () => {
  const without = session(['com.apple.TextEdit']);
  const withGrant = session(['com.apple.TextEdit'], { systemKeyCombos: true });
  const blocked = ['cmd+q', 'cmd+shift+q', 'cmd+option+escape', 'cmd+tab', 'cmd+space', 'ctrl+cmd+q'];
  const allowed = ['cmd+c', 'cmd+v', 'cmd+s', 'cmd+w', 'cmd+a', 'return', 'escape', 'ctrl+tab'];

  for (const c of blocked) {
    assert.throws(() => assertChordAllowed(without, c), `without grant: ${c} must be blocked`);
    assert.doesNotThrow(() => assertChordAllowed(withGrant, c), `with grant: ${c} must be allowed`);
  }
  for (const c of allowed) {
    assert.doesNotThrow(() => assertChordAllowed(without, c), `ordinary combo ${c} must never need a grant`);
  }
});

test('allowlist accumulates rather than replacing', () => {
  const s = session(['com.apple.TextEdit']);
  s.allowedBundleIds!.add('com.apple.Notes');
  s.tiers.set('com.apple.Notes', tierForApp('com.apple.Notes', true));
  assert.equal(allows(s, 'com.apple.TextEdit', 'click'), true, 'the earlier grant survives');
  assert.equal(allows(s, 'com.apple.Notes', 'click'), true, 'the new grant applies');
});
