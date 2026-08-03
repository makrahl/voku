import type { NextFunction, Request, Response } from 'express';
import { cookieSecure, config } from '../config.js';
import { teacherForSession } from '../services/auth.js';
import { forbidden, unauthorized } from '../http.js';

export const TEACHER_COOKIE = 'voku_session';
export const STUDENT_COOKIE = 'voku_student';

const base = {
  httpOnly: true,
  sameSite: 'lax',
  secure: cookieSecure,
  path: '/',
} as const;

export function setTeacherCookie(res: Response, token: string): void {
  res.cookie(TEACHER_COOKIE, token, { ...base, maxAge: config.sessionDays * 86_400_000 });
}

export function clearTeacherCookie(res: Response): void {
  res.clearCookie(TEACHER_COOKIE, base);
}

/** Student tokens are long-lived by design — the QR code is printed once a year. */
export function setStudentCookie(res: Response, token: string): void {
  res.cookie(STUDENT_COOKIE, token, { ...base, maxAge: 365 * 86_400_000 });
}

export function clearStudentCookie(res: Response): void {
  res.clearCookie(STUDENT_COOKIE, base);
}

export function requireTeacher(req: Request, _res: Response, next: NextFunction): void {
  const teacher = teacherForSession(req.db, req.cookies?.[TEACHER_COOKIE] as string | undefined);
  if (!teacher) {
    next(unauthorized());
    return;
  }
  req.teacher = teacher;
  next();
}

/** Admin-only routes: inviting, promoting and removing colleagues. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.teacher) {
    next(unauthorized());
    return;
  }
  if ((req.teacher as { is_admin?: number }).is_admin !== 1) {
    next(forbidden('Only an admin can manage the team.'));
    return;
  }
  next();
}

export interface StudentRow {
  id: string;
  class_id: string;
  name: string;
  token: string;
}

export function requireStudent(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[STUDENT_COOKIE] as string | undefined;
  if (!token) {
    next(unauthorized('Scan your code to sign in'));
    return;
  }
  const student = req.db.get<StudentRow>(
    'SELECT id, class_id, name, token FROM students WHERE token = :token AND archived_at IS NULL',
    { token },
  );
  if (!student) {
    next(unauthorized('That code is no longer valid — ask your teacher for a new one'));
    return;
  }
  req.student = student;
  next();
}
