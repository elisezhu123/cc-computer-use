import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSystemKeyCombo, normalizeKeySequence, tierForApp, assertActionAllowed, assertChordAllowed, newSession, PolicyError, } from './policy.js';
// ── Key blocklist ────────────────────────────────────────────────────────────
test('every alias spelling of Cmd+Q is blocked', () => {
    for (const chord of ['cmd+q', 'command+q', 'meta+q', 'super+q', 'win+q', 'CMD+Q', ' cmd + q ']) {
        assert.equal(isSystemKeyCombo(chord), true, `${chord} must be blocked`);
    }
});
test('the suffix bypass cmd+q+a is caught', () => {
    // Rust presses Cmd, then Q (Cmd+Q fires HERE, quitting the app), then A.
    // Matching the joined string "meta+q+a" would miss it.
    assert.equal(isSystemKeyCombo('cmd+q+a'), true);
    assert.equal(isSystemKeyCombo('cmd+a+q'), true, 'order must not matter for the check');
});
test('other blocked combos', () => {
    for (const chord of ['cmd+shift+q', 'cmd+option+escape', 'cmd+alt+escape', 'cmd+tab', 'cmd+space', 'ctrl+cmd+q']) {
        assert.equal(isSystemKeyCombo(chord), true, `${chord} must be blocked`);
    }
});
test('ordinary combos are not blocked', () => {
    for (const chord of ['cmd+c', 'cmd+v', 'cmd+s', 'return', 'escape', 'ctrl+shift+tab', 'cmd+shift+4', 'a']) {
        assert.equal(isSystemKeyCombo(chord), false, `${chord} must be allowed`);
    }
});
test('modifier-only chords are not blocked (click modifiers)', () => {
    for (const chord of ['cmd', 'shift', 'cmd+shift', 'alt']) {
        assert.equal(isSystemKeyCombo(chord), false, `${chord} must be allowed`);
    }
});
test('normalizeKeySequence canonicalizes, dedupes, and orders', () => {
    assert.equal(normalizeKeySequence('Cmd + Shift + Q'), 'shift+meta+q');
    assert.equal(normalizeKeySequence('cmd+command+q'), 'meta+q', 'aliases dedupe');
    assert.equal(normalizeKeySequence('ctrl+alt+a'), 'ctrl+alt+a');
    assert.equal(normalizeKeySequence('alt+ctrl+a'), 'ctrl+alt+a', 'modifiers sort canonically');
    assert.equal(normalizeKeySequence('option+escape'), 'alt+escape');
});
// ── Tiers ────────────────────────────────────────────────────────────────────
test('tierForApp classifies shells, browsers, and everything else', () => {
    assert.equal(tierForApp('com.apple.Terminal'), 'click');
    assert.equal(tierForApp('com.googlecode.iterm2'), 'click');
    assert.equal(tierForApp('com.apple.Safari'), 'read');
    assert.equal(tierForApp('com.google.Chrome'), 'read');
    assert.equal(tierForApp('com.apple.TextEdit'), 'full');
    assert.equal(tierForApp(null), 'full');
});
// ── Gate ─────────────────────────────────────────────────────────────────────
function sessionWith(apps, grants = {}) {
    const s = newSession();
    s.allowedBundleIds = new Set(apps);
    for (const a of apps)
        s.tiers.set(a, tierForApp(a));
    Object.assign(s.grants, grants);
    return s;
}
test('everything is refused before request_access is called', () => {
    const s = newSession();
    assert.throws(() => assertActionAllowed(s, 'com.apple.TextEdit', 'click'), (e) => e instanceof PolicyError && e.code === 'needs_access');
});
test('an app outside the allowlist is refused', () => {
    const s = sessionWith(['com.apple.TextEdit']);
    assert.throws(() => assertActionAllowed(s, 'com.apple.Safari', 'click'), (e) => e instanceof PolicyError && e.code === 'not_granted');
});
test('an app inside the allowlist at full tier is allowed', () => {
    const s = sessionWith(['com.apple.TextEdit']);
    assert.doesNotThrow(() => assertActionAllowed(s, 'com.apple.TextEdit', 'click'));
    assert.doesNotThrow(() => assertActionAllowed(s, 'com.apple.TextEdit', 'type'));
});
test('a read-tier app can be seen but never touched', () => {
    const s = sessionWith(['com.apple.Safari']);
    assert.throws(() => assertActionAllowed(s, 'com.apple.Safari', 'click'), (e) => e instanceof PolicyError && e.code === 'denied_tier');
});
test('a click-tier app refuses typing but allows clicking', () => {
    const s = sessionWith(['com.apple.Terminal']);
    assert.doesNotThrow(() => assertActionAllowed(s, 'com.apple.Terminal', 'click'));
    assert.throws(() => assertActionAllowed(s, 'com.apple.Terminal', 'type'), (e) => e instanceof PolicyError && e.code === 'denied_tier');
    assert.throws(() => assertActionAllowed(s, 'com.apple.Terminal', 'key'), (e) => e instanceof PolicyError && e.code === 'denied_tier');
});
test('an undeterminable frontmost app is refused rather than assumed safe', () => {
    const s = sessionWith(['com.apple.TextEdit']);
    assert.throws(() => assertActionAllowed(s, null, 'click'), (e) => e instanceof PolicyError && e.code === 'not_granted');
});
test('clipboard access needs its own flag and is not app-scoped', () => {
    const withoutFlag = sessionWith(['com.apple.TextEdit']);
    assert.throws(() => assertActionAllowed(withoutFlag, 'com.apple.TextEdit', 'clipboard_read'), (e) => e instanceof PolicyError && e.code === 'needs_flag');
    const withFlag = sessionWith(['com.apple.TextEdit'], { clipboardRead: true });
    // No app has to be frontmost for a clipboard read - the clipboard is global.
    assert.doesNotThrow(() => assertActionAllowed(withFlag, null, 'clipboard_read'));
});
test('system key combos need the systemKeyCombos grant', () => {
    const s = sessionWith(['com.apple.TextEdit']);
    assert.throws(() => assertChordAllowed(s, 'cmd+q'), (e) => e instanceof PolicyError && e.code === 'needs_flag');
    assert.doesNotThrow(() => assertChordAllowed(s, 'cmd+c'), 'ordinary combos never need the grant');
    const granted = sessionWith(['com.apple.TextEdit'], { systemKeyCombos: true });
    assert.doesNotThrow(() => assertChordAllowed(granted, 'cmd+q'));
});
//# sourceMappingURL=policy.test.js.map