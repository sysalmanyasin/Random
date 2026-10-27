import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRepo } from '../js/repository/supabase.js';

const { isValidStaffPin, pinToAuthPassword, signInWithPhonePin } = SupabaseRepo;

test('staff PIN must be exactly 4 digits', () => {
  assert.equal(isValidStaffPin('1945'), true);
  for (const bad of ['', '123', '12345', 'abcd', '12a4', ' 1945', '19 45']) assert.equal(isValidStaffPin(bad), false, bad);
});

test('auth password for a 4-digit PIN meets Supabase 6-char minimum and stays digits-only (<= 8)', () => {
  const pw = pinToAuthPassword('1945');
  assert.ok(pw.length >= 6);
  assert.match(pw, /^\d{4,8}$/); // what the deployed admin-actions function validates
  assert.ok(pw.startsWith('1945'));
});

function fakeClient(validPasswords, calls = []) {
  return {
    auth: {
      signInWithPassword: async ({ email, password }) => {
        calls.push(password);
        if (validPasswords.includes(password)) return { data: { user: { id: 'u1' } }, error: null };
        return { data: null, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };
      },
    },
  };
}

test('login: new-style account (padded password) succeeds on first try', async () => {
  const calls = [];
  const res = await signInWithPhonePin(fakeClient([pinToAuthPassword('1945')], calls), '0326-6008914', '1945');
  assert.equal(res.error, null);
  assert.deepEqual(calls, ['194500']);
});

test('login: legacy account (raw 4-digit password) still works via fallback', async () => {
  const calls = [];
  const res = await signInWithPhonePin(fakeClient(['1945'], calls), '03266008914', '1945');
  assert.equal(res.error, null);
  assert.deepEqual(calls, ['194500', '1945']);
});

test('login: wrong PIN fails after both attempts', async () => {
  const res = await signInWithPhonePin(fakeClient([pinToAuthPassword('1945')]), '03266008914', '9999');
  assert.ok(res.error);
});

test('login: blocked account error is returned without a second attempt', async () => {
  const calls = [];
  const client = { auth: { signInWithPassword: async ({ password }) => { calls.push(password); return { data: null, error: { code: 'user_banned', message: 'User is banned' } }; } } };
  const res = await signInWithPhonePin(client, '03266008914', '1945');
  assert.equal(res.error.code, 'user_banned');
  assert.equal(calls.length, 1);
});
