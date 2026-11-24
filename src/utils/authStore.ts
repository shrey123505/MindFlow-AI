import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

const PASSWORD_BYTES = 64;
const PASSWORD_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const KEEP_USAGE_DAYS = 45;
const DUMMY_SALT = Buffer.alloc(PASSWORD_SALT_BYTES, 0x4d);
const DUMMY_HASH = Buffer.alloc(PASSWORD_BYTES, 0x31);

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthUsage {
  date: string;
  analysesUsed: number;
  analysisLimit: number;
  aiActionsUsed: number;
  aiActionLimit: number;
  resetsAt: string;
}

export interface UsagePolicy {
  analysisLimit: number;
  aiActionLimit: number;
  globalDailyLimit: number;
}

export interface UsageDecision {
  allowed: boolean;
  reason?: 'analysis_limit' | 'user_daily_limit' | 'global_daily_limit';
  usage: AuthUsage;
  globalUsed: number;
  globalLimit: number;
}

interface StoredUser extends AuthUser {
  passwordSalt: string;
  passwordHash: string;
}

interface StoredSession {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface DailyUserUsage {
  analyses: number;
  aiActions: number;
}

interface DailyUsageBucket {
  global: number;
  users: Record<string, DailyUserUsage>;
}

interface AuthData {
  version: 1;
  users: StoredUser[];
  sessions: StoredSession[];
  usageByDate: Record<string, DailyUsageBucket>;
}

export class AuthStoreError extends Error {
  readonly code: 'EMAIL_TAKEN' | 'INVALID_CREDENTIALS' | 'ACCOUNT_LIMIT' | 'USER_NOT_FOUND';

  constructor(
    message: string,
    code: 'EMAIL_TAKEN' | 'INVALID_CREDENTIALS' | 'ACCOUNT_LIMIT' | 'USER_NOT_FOUND'
  ) {
    super(message);
    this.name = 'AuthStoreError';
    this.code = code;
  }
}

function emptyData(): AuthData {
  return { version: 1, users: [], sessions: [], usageByDate: {} };
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    email.length < 6 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return null;
  }
  return email;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return 'Enter a password.';
  if (value.length < 12) return 'Use a password with at least 12 characters.';
  if (value.length > 128) return 'Password must be 128 characters or fewer.';
  return null;
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

function publicUser(user: StoredUser): AuthUser {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isAuthData(value: unknown): value is AuthData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AuthData>;
  return (
    data.version === 1 &&
    Array.isArray(data.users) &&
    Array.isArray(data.sessions) &&
    Boolean(data.usageByDate) &&
    typeof data.usageByDate === 'object'
  );
}

async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      PASSWORD_BYTES,
      { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      }
    );
  });
}

export class PersistentAuthStore {
  private data: AuthData = emptyData();
  private initialized = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!isAuthData(parsed)) throw new Error('The account store has an unsupported format.');
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = emptyData();
      await this.persist();
    }
    this.initialized = true;
  }

  private serial<T>(work: () => Promise<T> | T): Promise<T> {
    if (!this.initialized) return Promise.reject(new Error('Auth store is not initialized.'));
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }

  private async mutate<T>(work: () => Promise<T> | T): Promise<T> {
    return this.serial(async () => {
      const before = JSON.stringify(this.data);
      try {
        const result = await work();
        await this.persist();
        return result;
      } catch (error) {
        this.data = JSON.parse(before) as AuthData;
        throw error;
      }
    });
  }

  private prune(now: Date): void {
    const nowMs = now.getTime();
    this.data.sessions = this.data.sessions.filter(
      (session) => Date.parse(session.expiresAt) > nowMs
    );
    const oldest = new Date(nowMs - KEEP_USAGE_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    for (const day of Object.keys(this.data.usageByDate)) {
      if (day < oldest) delete this.data.usageByDate[day];
    }
  }

  async register(emailValue: unknown, passwordValue: unknown): Promise<AuthUser> {
    const email = normalizeEmail(emailValue);
    if (!email) throw new Error('Enter a valid email address.');
    const passwordError = validatePassword(passwordValue);
    if (passwordError) throw new Error(passwordError);
    const password = passwordValue as string;
    const salt = randomBytes(PASSWORD_SALT_BYTES);
    const passwordHash = await derivePassword(password, salt);

    return this.mutate(() => {
      if (this.data.users.some((user) => user.email === email)) {
        throw new AuthStoreError('An account with this email already exists.', 'EMAIL_TAKEN');
      }
      if (this.data.users.length >= 100_000) {
        throw new AuthStoreError('New accounts are temporarily unavailable.', 'ACCOUNT_LIMIT');
      }
      const user: StoredUser = {
        id: randomUUID(),
        email,
        passwordSalt: salt.toString('base64url'),
        passwordHash: passwordHash.toString('base64url'),
        createdAt: new Date().toISOString(),
      };
      this.data.users.push(user);
      return publicUser(user);
    });
  }

  async authenticate(emailValue: unknown, passwordValue: unknown): Promise<AuthUser | null> {
    const email = normalizeEmail(emailValue);
    if (!email || typeof passwordValue !== 'string' || passwordValue.length > 128) {
      await derivePassword('invalid-login-attempt', DUMMY_SALT);
      return null;
    }
    const user = await this.serial(() => this.data.users.find((candidate) => candidate.email === email));
    const salt = user ? Buffer.from(user.passwordSalt, 'base64url') : DUMMY_SALT;
    const expected = user ? Buffer.from(user.passwordHash, 'base64url') : DUMMY_HASH;
    const actual = await derivePassword(passwordValue, salt);
    const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
    return user && matches ? publicUser(user) : null;
  }

  async createSession(userId: string, now = new Date()): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();
    await this.mutate(() => {
      const user = this.data.users.find((candidate) => candidate.id === userId);
      if (!user) throw new AuthStoreError('Account was not found.', 'USER_NOT_FOUND');
      this.prune(now);
      const previous = this.data.sessions
        .filter((session) => session.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      while (previous.length >= 8) {
        const oldest = previous.shift();
        if (oldest) this.data.sessions = this.data.sessions.filter((s) => s.tokenHash !== oldest.tokenHash);
      }
      this.data.sessions.push({
        tokenHash: tokenHash(token),
        userId,
        createdAt: now.toISOString(),
        expiresAt,
      });
    });
    return { token, expiresAt };
  }

  async getUserForSession(token: string | null, now = new Date()): Promise<AuthUser | null> {
    if (!token || token.length > 100) return null;
    return this.serial(() => {
      const hashed = tokenHash(token);
      const session = this.data.sessions.find(
        (candidate) => candidate.tokenHash === hashed && Date.parse(candidate.expiresAt) > now.getTime()
      );
      const user = session && this.data.users.find((candidate) => candidate.id === session.userId);
      return user ? publicUser(user) : null;
    });
  }

  async destroySession(token: string | null): Promise<void> {
    if (!token || token.length > 100) return;
    const hashed = tokenHash(token);
    await this.mutate(() => {
      this.data.sessions = this.data.sessions.filter((session) => session.tokenHash !== hashed);
    });
  }

  async getUsage(userId: string, policy: UsagePolicy, now = new Date()): Promise<AuthUsage> {
    return this.serial(() => {
      const date = utcDateKey(now);
      const entry = this.data.usageByDate[date]?.users[userId];
      return {
        date,
        analysesUsed: entry?.analyses ?? 0,
        analysisLimit: policy.analysisLimit,
        aiActionsUsed: entry?.aiActions ?? 0,
        aiActionLimit: policy.aiActionLimit,
        resetsAt: nextUtcMidnight(now).toISOString(),
      };
    });
  }

  async consumeUsage(
    userId: string,
    kind: 'analysis' | 'ai',
    policy: UsagePolicy,
    now = new Date()
  ): Promise<UsageDecision> {
    return this.mutate(() => {
      this.prune(now);
      if (!this.data.users.some((user) => user.id === userId)) {
        throw new AuthStoreError('Account was not found.', 'USER_NOT_FOUND');
      }
      const date = utcDateKey(now);
      const bucket = (this.data.usageByDate[date] ??= { global: 0, users: {} });
      const usage = (bucket.users[userId] ??= { analyses: 0, aiActions: 0 });
      const toUsage = (): AuthUsage => ({
        date,
        analysesUsed: usage.analyses,
        analysisLimit: policy.analysisLimit,
        aiActionsUsed: usage.aiActions,
        aiActionLimit: policy.aiActionLimit,
        resetsAt: nextUtcMidnight(now).toISOString(),
      });

      if (kind === 'analysis' && usage.analyses >= policy.analysisLimit) {
        return {
          allowed: false,
          reason: 'analysis_limit',
          usage: toUsage(),
          globalUsed: bucket.global,
          globalLimit: policy.globalDailyLimit,
        };
      }
      if (usage.aiActions >= policy.aiActionLimit) {
        return {
          allowed: false,
          reason: 'user_daily_limit',
          usage: toUsage(),
          globalUsed: bucket.global,
          globalLimit: policy.globalDailyLimit,
        };
      }
      if (bucket.global >= policy.globalDailyLimit) {
        return {
          allowed: false,
          reason: 'global_daily_limit',
          usage: toUsage(),
          globalUsed: bucket.global,
          globalLimit: policy.globalDailyLimit,
        };
      }

      usage.aiActions += 1;
      if (kind === 'analysis') usage.analyses += 1;
      bucket.global += 1;
      return {
        allowed: true,
        usage: toUsage(),
        globalUsed: bucket.global,
        globalLimit: policy.globalDailyLimit,
      };
    });
  }
}
