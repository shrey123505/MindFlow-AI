import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AuthStoreError,
  PersistentAuthStore,
  normalizeEmail,
  validatePassword,
  type UsagePolicy,
} from './authStore.ts';

async function withStore(run: (store: PersistentAuthStore, filePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mindflow-auth-'));
  const filePath = path.join(directory, 'accounts.json');
  const store = new PersistentAuthStore(filePath);
  await store.initialize();
  try {
    await run(store, filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('normalizes emails and enforces strong password length', () => {
  assert.equal(normalizeEmail('  Student@Example.com '), 'student@example.com');
  assert.equal(normalizeEmail('invalid address'), null);
  assert.equal(validatePassword('short'), 'Use a password with at least 12 characters.');
  assert.equal(validatePassword('long-enough-password'), null);
});

test('stores password hashes, authenticates, and revokes opaque sessions', async () => {
  await withStore(async (store, filePath) => {
    const user = await store.register('Student@Example.com', 'a-long-safe-password');
    assert.equal(user.email, 'student@example.com');
    assert.deepEqual(await store.authenticate('STUDENT@example.com', 'a-long-safe-password'), user);
    assert.equal(await store.authenticate('student@example.com', 'wrong-password'), null);

    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as {
      users: Array<{ passwordHash: string; passwordSalt: string }>;
      sessions: Array<{ tokenHash: string }>;
    };
    assert.notEqual(persisted.users[0].passwordHash, 'a-long-safe-password');
    assert.ok(persisted.users[0].passwordSalt);

    const session = await store.createSession(user.id);
    assert.equal((await store.getUserForSession(session.token))?.id, user.id);
    const persistedAfterSession = JSON.parse(await readFile(filePath, 'utf8')) as {
      sessions: Array<{ tokenHash: string }>;
    };
    assert.notEqual(persistedAfterSession.sessions[0]?.tokenHash, session.token);
    assert.match(persistedAfterSession.sessions[0]?.tokenHash ?? '', /^[a-f0-9]{64}$/);
    await store.destroySession(session.token);
    assert.equal(await store.getUserForSession(session.token), null);
  });
});

test('rejects duplicate email addresses without modifying the account store', async () => {
  await withStore(async (store) => {
    await store.register('student@example.com', 'a-long-safe-password');
    await assert.rejects(
      store.register('STUDENT@example.com', 'another-safe-password'),
      (error: unknown) => error instanceof AuthStoreError && error.code === 'EMAIL_TAKEN'
    );
  });
});

test('enforces per-user analysis, daily AI, and site-wide daily usage limits', async () => {
  await withStore(async (store) => {
    const first = await store.register('first@example.com', 'a-long-safe-password');
    const second = await store.register('second@example.com', 'another-safe-password');
    const policy: UsagePolicy = { analysisLimit: 1, aiActionLimit: 2, globalDailyLimit: 2 };
    const day = new Date('2026-11-24T10:00:00.000Z');

    assert.equal((await store.consumeUsage(first.id, 'analysis', policy, day)).allowed, true);
    assert.equal((await store.consumeUsage(first.id, 'analysis', policy, day)).reason, 'analysis_limit');
    assert.equal((await store.consumeUsage(first.id, 'ai', policy, day)).allowed, true);
    assert.equal((await store.consumeUsage(second.id, 'ai', policy, day)).reason, 'global_daily_limit');

    const nextDay = new Date('2026-11-25T00:01:00.000Z');
    const nextDayUsage = await store.consumeUsage(second.id, 'analysis', policy, nextDay);
    assert.equal(nextDayUsage.allowed, true);
    assert.equal(nextDayUsage.usage.analysesUsed, 1);
  });
});
