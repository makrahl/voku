import { Router } from 'express';
import {
  BulkStudentsSchema,
  ClassInputSchema,
  ClassUpdateSchema,
  StudentUpdateSchema,
} from '@voku/shared';
import { conflict, notFound, param, parseBody, route } from '../http.js';
import { requireTeacher } from '../middleware/auth.js';
import {
  addStudents,
  createClass,
  getClass,
  getStudent,
  listClasses,
  listStudents,
  parseNames,
  rotateStudentToken,
  studentAttemptCount,
  toStudentView,
} from '../services/roster.js';
import { renderQrSheet } from '../services/qrsheet.js';

export const classesRouter: Router = Router();

classesRouter.use(requireTeacher);

classesRouter.get(
  '/',
  route((req, res) => {
    res.json(listClasses(req.db, req.teacher!.id));
  }),
);

classesRouter.post(
  '/',
  route((req, res) => {
    const { name } = parseBody(ClassInputSchema, req.body);
    const row = createClass(req.db, req.teacher!.id, name);
    res.status(201).json({
      id: row.id,
      name: row.name,
      studentCount: 0,
      testCount: 0,
      createdAt: row.created_at,
      archivedAt: null,
    });
  }),
);

classesRouter.get(
  '/:id',
  route((req, res) => {
    const cls = getClass(req.db, req.teacher!.id, param(req, 'id'));
    if (!cls) throw notFound('No such class');
    res.json({
      id: cls.id,
      name: cls.name,
      createdAt: cls.created_at,
      archivedAt: cls.archived_at,
      students: listStudents(req.db, cls.id),
    });
  }),
);

classesRouter.patch(
  '/:id',
  route((req, res) => {
    const cls = getClass(req.db, req.teacher!.id, param(req, 'id'));
    if (!cls) throw notFound('No such class');
    const body = parseBody(ClassUpdateSchema, req.body);

    if (body.name !== undefined) {
      req.db.run('UPDATE classes SET name = :name WHERE id = :id', { name: body.name, id: cls.id });
    }
    if (body.archived !== undefined) {
      req.db.run('UPDATE classes SET archived_at = :at WHERE id = :id', {
        at: body.archived ? new Date() : null,
        id: cls.id,
      });
    }
    res.json(listClasses(req.db, req.teacher!.id).find((c) => c.id === cls.id));
  }),
);

classesRouter.delete(
  '/:id',
  route((req, res) => {
    const cls = getClass(req.db, req.teacher!.id, param(req, 'id'));
    if (!cls) throw notFound('No such class');

    // Deleting a class would cascade away every test and every score in it.
    // Refuse once there is history and point at archiving instead.
    const tests = req.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tests WHERE class_id = :id', {
      id: cls.id,
    });
    if ((tests?.n ?? 0) > 0) {
      throw conflict(
        'This class has tests, so deleting it would delete those results too. Archive it instead.',
      );
    }
    req.db.run('DELETE FROM classes WHERE id = :id', { id: cls.id });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

classesRouter.get(
  '/:id/students',
  route((req, res) => {
    const cls = getClass(req.db, req.teacher!.id, param(req, 'id'));
    if (!cls) throw notFound('No such class');
    res.json(listStudents(req.db, cls.id, req.query.includeArchived === 'true'));
  }),
);

classesRouter.post(
  '/:id/students',
  route((req, res) => {
    const cls = getClass(req.db, req.teacher!.id, param(req, 'id'));
    if (!cls) throw notFound('No such class');

    const { names } = parseBody(BulkStudentsSchema, req.body);
    const parsed = parseNames(names);
    if (parsed.length === 0) throw conflict('No names found — put one name per line.');

    res.status(201).json(addStudents(req.db, cls.id, parsed));
  }),
);

classesRouter.get(
  '/:id/qr-sheet',
  route(async (req, res) => {
    const cls = getClass(req.db, req.teacher!.id, param(req, 'id'));
    if (!cls) throw notFound('No such class');
    const html = await renderQrSheet(cls.name, listStudents(req.db, cls.id));
    res.type('html').send(html);
  }),
);

// ---------------------------------------------------------------------------
// Individual students, mounted separately at /api/admin/students
// ---------------------------------------------------------------------------

export const studentsRouter: Router = Router();

studentsRouter.use(requireTeacher);

studentsRouter.patch(
  '/:id',
  route((req, res) => {
    const student = getStudent(req.db, req.teacher!.id, param(req, 'id'));
    if (!student) throw notFound('No such student');
    const body = parseBody(StudentUpdateSchema, req.body);

    if (body.name !== undefined) {
      req.db.run('UPDATE students SET name = :name WHERE id = :id', { name: body.name, id: student.id });
    }
    if (body.archived !== undefined) {
      req.db.run('UPDATE students SET archived_at = :at WHERE id = :id', {
        at: body.archived ? new Date() : null,
        id: student.id,
      });
    }
    res.json(toStudentView(req.db.get('SELECT * FROM students WHERE id = :id', { id: student.id })!));
  }),
);

studentsRouter.post(
  '/:id/rotate-token',
  route((req, res) => {
    const student = getStudent(req.db, req.teacher!.id, param(req, 'id'));
    if (!student) throw notFound('No such student');
    res.json(rotateStudentToken(req.db, student.id));
  }),
);

studentsRouter.delete(
  '/:id',
  route((req, res) => {
    const student = getStudent(req.db, req.teacher!.id, param(req, 'id'));
    if (!student) throw notFound('No such student');

    // Once a student has sat a test, deleting them would delete those results.
    if (studentAttemptCount(req.db, student.id) > 0) {
      throw conflict(
        'This student has taken tests, so deleting them would delete those results too. Archive them instead.',
      );
    }
    req.db.run('DELETE FROM students WHERE id = :id', { id: student.id });
    res.status(204).end();
  }),
);
