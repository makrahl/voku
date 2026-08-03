import { Router } from 'express';
import { z } from 'zod';
import { param, parseBody, route } from '../http.js';
import { requireAdmin, requireTeacher, setTeacherCookie } from '../middleware/auth.js';
import { createSession } from '../services/auth.js';
import {
  acceptInvite,
  claimInstance,
  createInvite,
  isClaimed,
  listInvites,
  listTeachers,
  readInvite,
  removeTeacher,
  revokeInvite,
  setAdmin,
} from '../services/team.js';

const ClaimSchema = z.object({
  code: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(10),
});

const InviteSchema = z.object({
  email: z.string().trim().email(),
  isAdmin: z.boolean().default(false),
});

const AcceptSchema = z.object({
  password: z.string().min(10),
});

const RoleSchema = z.object({
  isAdmin: z.boolean(),
});

/**
 * Public routes. Nothing here requires a session — they are how the first
 * session comes to exist.
 */
export const setupRouter: Router = Router();

setupRouter.get(
  '/status',
  route((req, res) => {
    // Deliberately does not reveal the setup code — only whether one is needed.
    res.json({ claimed: isClaimed(req.db) });
  }),
);

setupRouter.post(
  '/claim',
  route((req, res) => {
    const { code, email, password } = parseBody(ClaimSchema, req.body);
    const teacher = claimInstance(req.db, code, email, password);

    const { token } = createSession(req.db, teacher.id);
    setTeacherCookie(res, token);
    res.status(201).json({ id: teacher.id, email: teacher.email, isAdmin: true });
  }),
);

export const inviteRouter: Router = Router();

inviteRouter.get(
  '/:token',
  route((req, res) => {
    res.json(readInvite(req.db, param(req, 'token')));
  }),
);

inviteRouter.post(
  '/:token/accept',
  route((req, res) => {
    const { password } = parseBody(AcceptSchema, req.body);
    const teacher = acceptInvite(req.db, param(req, 'token'), password);

    // Straight in — asking them to log in again immediately would be pointless.
    const { token } = createSession(req.db, teacher.id);
    setTeacherCookie(res, token);
    res.status(201).json({
      id: teacher.id,
      email: teacher.email,
      isAdmin: teacher.is_admin === 1,
    });
  }),
);

/** Admin-only. Everything below manages who else can use this instance. */
export const teamRouter: Router = Router();

teamRouter.use(requireTeacher, requireAdmin);

teamRouter.get(
  '/',
  route((req, res) => {
    res.json({ teachers: listTeachers(req.db), invites: listInvites(req.db) });
  }),
);

teamRouter.post(
  '/invites',
  route((req, res) => {
    const { email, isAdmin } = parseBody(InviteSchema, req.body);
    // The link is returned, not emailed — the admin sends it however they like,
    // which keeps a mail server out of the deployment entirely.
    res.status(201).json(createInvite(req.db, req.teacher!.id, email, isAdmin));
  }),
);

teamRouter.delete(
  '/invites/:id',
  route((req, res) => {
    revokeInvite(req.db, param(req, 'id'));
    res.status(204).end();
  }),
);

teamRouter.patch(
  '/teachers/:id',
  route((req, res) => {
    const { isAdmin } = parseBody(RoleSchema, req.body);
    res.json(setAdmin(req.db, req.teacher!.id, param(req, 'id'), isAdmin));
  }),
);

teamRouter.delete(
  '/teachers/:id',
  route((req, res) => {
    removeTeacher(req.db, req.teacher!.id, param(req, 'id'));
    res.status(204).end();
  }),
);
