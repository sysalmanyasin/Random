import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for the "round list goes blank on load" bug:
// refreshRoundList() used to clear the holder, then await several network
// calls with no error handling, so a slow/failed/overlapping call left the
// list empty. These source-level checks pin the safe structure.
const src = readFileSync(new URL('../js/pages/engagement-pages.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('async function refreshRoundList()'));
const refresh = body.slice(0, body.indexOf('\n}\n') + 3);

test('refreshRoundList never clears the holder before awaiting', () => {
  const firstAwait = refresh.indexOf('await ');
  const beforeAwait = refresh.slice(0, firstAwait);
  assert.ok(!/holder\.innerHTML\s*=\s*''/.test(beforeAwait), 'must not blank holder before awaits');
  assert.ok(!/holder\.innerHTML\s*=\s*''/.test(refresh), 'must not blank holder at all');
});

test('refreshRoundList is latest-wins and failure-safe', () => {
  assert.match(refresh, /_roundListRenderToken/);
  assert.match(refresh, /try\s*{/);
  assert.match(refresh, /catch\s*\(/);
  assert.match(refresh, /isCurrent\(\)/);
});

test('cards are swapped in atomically', () => {
  assert.match(src, /holder\.replaceChildren\(frag\)/);
});
