import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeHelper } from './nativeHelper.js';

/** A stand-in helper: never answers "hang", echoes everything else. */
const ECHO = [
  process.execPath,
  '-e',
  `require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
     if (l !== 'hang') console.log('ok ' + l);
   });`,
];

test('a request queued behind a timed-out one runs on a fresh helper and succeeds', async () => {
  const h = new NativeHelper({ source: '', binPrefix: 'test', label: 'Test', command: ECHO, timeoutMs: 200 });
  try {
    const hung = h.request('hang');
    const next = h.request('ping');
    await assert.rejects(hung, /did not respond/);
    assert.equal(await next, 'ping');
    assert.equal(await h.request('again'), 'again');
  } finally {
    h.close();
  }
});

test('a helper binary that cannot be started rejects the request instead of crashing the server', async () => {
  const h = new NativeHelper({
    source: '', binPrefix: 'test', label: 'Test', command: ['/nonexistent/cu-helper'], timeoutMs: 500,
  });
  try {
    await assert.rejects(h.request('ping'));
    await assert.rejects(h.request('ping'));
  } finally {
    h.close();
  }
});
