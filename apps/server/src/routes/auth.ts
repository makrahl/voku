import { Router } from 'express';
import { LoginRequestSchema } from '@voku/shared';
import { parseBody, route, unauthorized } from '../http.js';
import {
  createSession,
  destroySession,
  findTeacherByEmail,
  verifyPassword,
} from '../services/auth.js';
import {
  TEACHER_COOKIE,
  clearTeacherCookie,
  requireTeacher,
  setTeacherCookie,
} from '../middleware/auth.js';

export const authRouter: Router = Router();

authRouter.post(
  '/login',
  route((req, res) => {
    const { email, password } = parseBody(LoginRequestSchema, req.body);
    const teacher = findTeacherByEmail(req.db, email);
    // Hash even when the account is missing, so a wrong email and a wrong
    // password take the same amount of time.
    const ok = teacher
      ? verifyPassword(password, teacher.password_hash)
      : verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    if (!teacher || !ok) throw unauthorized('Wrong email or password');

    const { token } = createSession(req.db, teacher.id);
    setTeacherCookie(res, token);
    res.json({ id: teacher.id, email: teacher.email, isAdmin: teacher.is_admin === 1 });
  }),
);

authRouter.post(
  '/logout',
  route((req, res) => {
    destroySession(req.db, req.cookies?.[TEACHER_COOKIE] as string | undefined);
    clearTeacherCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireTeacher,
  route((req, res) => {
    res.json({
      id: req.teacher!.id,
      email: req.teacher!.email,
      isAdmin: req.teacher!.is_admin === 1,
    });
  }),
);
