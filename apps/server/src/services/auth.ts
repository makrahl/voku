import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/index.js';
import { config } from '../config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashRaw, 'base64');
  const actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltRaw, 'base64'), expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 32 bytes of entropy, url-safe. Used for both teacher sessions and student tokens. */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface Teacher {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  /** 1 for admins. Present from migration 2 onwards. */
  is_admin?: number;
}

export function createTeacher(db: Db, email: string, password: string): Teacher {
  const teacher: Teacher = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO teachers (id, email, password_hash, created_at)
     VALUES (:id, :email, :password_hash, :created_at)`,
    { ...teacher },
  );
  return teacher;
}

export function setTeacherPassword(db: Db, teacherId: string, password: string): void {
  db.run('UPDATE teachers SET password_hash = :hash WHERE id = :id', {
    hash: hashPassword(password),
    id: teacherId,
  });
}

export function findTeacherByEmail(db: Db, email: string): Teacher | undefined {
  return db.get<Teacher>('SELECT * FROM teachers WHERE email = :email', {
    email: email.trim().toLowerCase(),
  });
}

export function createSession(db: Db, teacherId: string): { token: string; expiresAt: Date } {
  const token = newToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionDays * 86_400_000);
  db.run(
    `INSERT INTO sessions (id, teacher_id, created_at, expires_at)
     VALUES (:id, :teacher_id, :created_at, :expires_at)`,
    { id: token, teacher_id: teacherId, created_at: now, expires_at: expiresAt },
  );
  return { token, expiresAt };
}

export function teacherForSession(db: Db, token: string | undefined): Teacher | undefined {
  if (!token) return undefined;
  return db.get<Teacher>(
    `SELECT t.* FROM sessions s
       JOIN teachers t ON t.id = s.teacher_id
      WHERE s.id = :id AND s.expires_at > :now`,
    { id: token, now: new Date() },
  );
}

export function destroySession(db: Db, token: string | undefined): void {
  if (!token) return;
  db.run('DELETE FROM sessions WHERE id = :id', { id: token });
}

export function purgeExpiredSessions(db: Db): number {
  return db.run('DELETE FROM sessions WHERE expires_at <= :now', { now: new Date() }).changes;
}
