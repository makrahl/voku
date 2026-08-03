import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { json } from '../db/index.js';
import { conflict, forbidden, notFound } from '../http.js';
import { createTeacher, newToken, type Teacher } from './auth.js';
import { config } from '../config.js';

/**
 * Accounts, roles and invitations.
 *
 * Two separate problems, deliberately solved differently: creating an account
 * is a one-time, high-friction act (an invite link the admin hands over however
 * they like — no mail server involved), while logging in afterwards has to work
 * on three devices for a year, which is what the password plus a long session
 * is for.
 *
 * Credentials live entirely in `auth.ts`. Nothing here assumes a password, so
 * adding passkeys later means adding a credential type, not unpicking this.
 */

const SETUP_CODE_KEY = 'setup_code';
export const INVITE_DAYS = 7;

export interface TeacherRow extends Teacher {
  is_admin: number;
}

export interface InviteRow {
  id: string;
  email: string;
  is_admin: number;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
}

export interface TeacherView {
  id: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
  classCount: number;
}

export interface InviteView {
  id: string;
  email: string;
  isAdmin: boolean;
  url: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export function inviteUrl(token: string): string {
  return `${config.publicBaseUrl}/admin/invite/${token}`;
}

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

export function isClaimed(db: Db): boolean {
  return Boolean(db.get('SELECT 1 FROM teachers LIMIT 1'));
}

/**
 * A one-time code printed to the server log, so that finding the URL before the
 * owner has claimed it is not the same as owning the instance. Persisted rather
 * than regenerated, so a restart mid-setup does not invalidate what was printed.
 */
export function setupCode(db: Db): string | null {
  if (isClaimed(db)) return null;
  const row = db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = :k', {
    k: SETUP_CODE_KEY,
  });
  const existing = json<string | null>(row?.value_json, null);
  if (existing) return existing;

  // Human-transcribable: no lookalike characters, grouped in fours.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raw = Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;

  db.run(
    `INSERT INTO settings (key, value_json) VALUES (:k, :v)
     ON CONFLICT(key) DO UPDATE SET value_json = :v`,
    { k: SETUP_CODE_KEY, v: JSON.stringify(code) },
  );
  return code;
}

export function claimInstance(db: Db, code: string, email: string, password: string): TeacherRow {
  if (isClaimed(db)) throw conflict('This instance has already been set up.');

  const expected = setupCode(db);
  if (!expected || code.trim().toUpperCase() !== expected) {
    throw forbidden('That setup code is not right. It was printed in the server log at startup.');
  }
  if (password.length < 10) throw conflict('Use a password of at least 10 characters.');

  const teacher = createTeacher(db, email, password);
  db.run('UPDATE teachers SET is_admin = 1 WHERE id = :id', { id: teacher.id });
  db.run('DELETE FROM settings WHERE key = :k', { k: SETUP_CODE_KEY });

  return { ...teacher, is_admin: 1 };
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export function listTeachers(db: Db): TeacherView[] {
  return db
    .all<TeacherRow & { class_count: number }>(
      `SELECT t.*, (SELECT COUNT(*) FROM classes c WHERE c.teacher_id = t.id) AS class_count
         FROM teachers t ORDER BY t.created_at ASC`,
    )
    .map((row) => ({
      id: row.id,
      email: row.email,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
      classCount: row.class_count,
    }));
}

export function adminCount(db: Db): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM teachers WHERE is_admin = 1')?.n ?? 0;
}

export function setAdmin(db: Db, actorId: string, teacherId: string, isAdmin: boolean): TeacherView {
  const target = db.get<TeacherRow>('SELECT * FROM teachers WHERE id = :id', { id: teacherId });
  if (!target) throw notFound('No such teacher');

  // Losing the last admin would leave nobody able to invite or promote anyone.
  if (!isAdmin && target.is_admin === 1 && adminCount(db) <= 1) {
    throw conflict('There has to be at least one admin.');
  }
  if (!isAdmin && actorId === teacherId) {
    throw conflict('You cannot remove your own admin rights — ask another admin to do it.');
  }

  db.run('UPDATE teachers SET is_admin = :admin WHERE id = :id', { admin: isAdmin, id: teacherId });
  return listTeachers(db).find((t) => t.id === teacherId)!;
}

export function removeTeacher(db: Db, actorId: string, teacherId: string): void {
  const target = db.get<TeacherRow>('SELECT * FROM teachers WHERE id = :id', { id: teacherId });
  if (!target) throw notFound('No such teacher');
  if (actorId === teacherId) throw conflict('You cannot remove your own account.');
  if (target.is_admin === 1 && adminCount(db) <= 1) {
    throw conflict('There has to be at least one admin.');
  }

  // Their classes, tests and every score in them would go with them.
  const classes = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM classes WHERE teacher_id = :id', {
    id: teacherId,
  });
  if ((classes?.n ?? 0) > 0) {
    throw conflict(
      `${target.email} still has ${classes!.n} class(es). Removing them would delete those classes and every result in them.`,
    );
  }
  db.run('DELETE FROM teachers WHERE id = :id', { id: teacherId });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

function toInviteView(row: InviteRow): InviteView {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === 1,
    url: inviteUrl(row.id),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() <= Date.now(),
  };
}

export function listInvites(db: Db): InviteView[] {
  return db
    .all<InviteRow>('SELECT * FROM invites WHERE accepted_at IS NULL ORDER BY created_at DESC')
    .map(toInviteView);
}

export function createInvite(
  db: Db,
  invitedBy: string,
  email: string,
  isAdmin: boolean,
): InviteView {
  const normalised = email.trim().toLowerCase();
  if (db.get('SELECT 1 FROM teachers WHERE email = :e', { e: normalised })) {
    throw conflict(`${normalised} already has an account.`);
  }

  // Re-inviting replaces the outstanding link rather than leaving two live.
  db.run('DELETE FROM invites WHERE email = :e AND accepted_at IS NULL', { e: normalised });

  const row: InviteRow = {
    id: newToken(),
    email: normalised,
    is_admin: isAdmin ? 1 : 0,
    invited_by: invitedBy,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
    accepted_at: null,
    accepted_by: null,
  };
  db.run(
    `INSERT INTO invites (id, email, is_admin, invited_by, created_at, expires_at, accepted_at, accepted_by)
     VALUES (:id, :email, :is_admin, :invited_by, :created_at, :expires_at, :accepted_at, :accepted_by)`,
    { ...row },
  );
  return toInviteView(row);
}

export function revokeInvite(db: Db, inviteId: string): void {
  const changes = db.run('DELETE FROM invites WHERE id = :id AND accepted_at IS NULL', {
    id: inviteId,
  }).changes;
  if (changes === 0) throw notFound('No such open invitation');
}

export interface InvitePreview {
  email: string;
  isAdmin: boolean;
}

/** Public: what the invitee sees before choosing a password. */
export function readInvite(db: Db, token: string): InvitePreview {
  const row = db.get<InviteRow>('SELECT * FROM invites WHERE id = :id', { id: token });
  if (!row || row.accepted_at) throw notFound('That invitation is no longer valid.');
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw conflict('That invitation has expired — ask for a new link.');
  }
  return { email: row.email, isAdmin: row.is_admin === 1 };
}

export function acceptInvite(db: Db, token: string, password: string): TeacherRow {
  const row = db.get<InviteRow>('SELECT * FROM invites WHERE id = :id', { id: token });
  if (!row || row.accepted_at) throw notFound('That invitation is no longer valid.');
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw conflict('That invitation has expired — ask for a new link.');
  }
  if (password.length < 10) throw conflict('Use a password of at least 10 characters.');
  if (db.get('SELECT 1 FROM teachers WHERE email = :e', { e: row.email })) {
    throw conflict('An account with that email already exists.');
  }

  return db.tx(() => {
    const teacher = createTeacher(db, row.email, password);
    if (row.is_admin === 1) {
      db.run('UPDATE teachers SET is_admin = 1 WHERE id = :id', { id: teacher.id });
    }
    db.run('UPDATE invites SET accepted_at = :at, accepted_by = :by WHERE id = :id', {
      at: new Date().toISOString(),
      by: teacher.id,
      id: row.id,
    });
    return { ...teacher, is_admin: row.is_admin };
  });
}
