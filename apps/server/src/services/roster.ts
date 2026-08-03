import { randomUUID } from 'node:crypto';
import type { ClassView, StudentView } from '@voku/shared';
import type { Db } from '../db/index.js';
import { newToken } from './auth.js';
import { config } from '../config.js';

export interface ClassRow {
  id: string;
  teacher_id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
}

export interface StudentRow {
  id: string;
  class_id: string;
  name: string;
  token: string;
  created_at: string;
  archived_at: string | null;
}

export function loginUrl(token: string): string {
  return `${config.publicBaseUrl}/s/${token}`;
}

function toStudentView(row: StudentRow): StudentView {
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    token: row.token,
    loginUrl: loginUrl(row.token),
    archivedAt: row.archived_at,
  };
}

/**
 * One name per line. Blank lines go, surrounding whitespace goes, and a name
 * repeated within the same paste is counted once — pasting a column twice is a
 * far more common accident than genuinely having two identically-named students.
 */
export function parseNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function listClasses(db: Db, teacherId: string): ClassView[] {
  return db
    .all<ClassRow & { student_count: number; test_count: number }>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM students s
                WHERE s.class_id = c.id AND s.archived_at IS NULL) AS student_count,
              (SELECT COUNT(*) FROM tests t WHERE t.class_id = c.id)  AS test_count
         FROM classes c
        WHERE c.teacher_id = :teacher
        ORDER BY c.archived_at IS NOT NULL, c.name COLLATE NOCASE`,
      { teacher: teacherId },
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      studentCount: row.student_count,
      testCount: row.test_count,
      createdAt: row.created_at,
      archivedAt: row.archived_at,
    }));
}

export function getClass(db: Db, teacherId: string, classId: string): ClassRow | undefined {
  return db.get<ClassRow>('SELECT * FROM classes WHERE id = :id AND teacher_id = :teacher', {
    id: classId,
    teacher: teacherId,
  });
}

export function createClass(db: Db, teacherId: string, name: string): ClassRow {
  const row: ClassRow = {
    id: randomUUID(),
    teacher_id: teacherId,
    name,
    created_at: new Date().toISOString(),
    archived_at: null,
  };
  db.run(
    `INSERT INTO classes (id, teacher_id, name, created_at, archived_at)
     VALUES (:id, :teacher_id, :name, :created_at, :archived_at)`,
    { ...row },
  );
  return row;
}

export function listStudents(db: Db, classId: string, includeArchived = false): StudentView[] {
  const rows = db.all<StudentRow>(
    `SELECT * FROM students
      WHERE class_id = :class ${includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY name COLLATE NOCASE`,
    { class: classId },
  );
  return rows.map(toStudentView);
}

export interface AddStudentsResult {
  added: StudentView[];
  /** Names already on the roster, reported rather than silently dropped. */
  skipped: string[];
}

export function addStudents(db: Db, classId: string, names: string[]): AddStudentsResult {
  const existing = new Set(
    db
      .all<{ name: string }>('SELECT name FROM students WHERE class_id = :class', { class: classId })
      .map((r) => r.name.toLowerCase()),
  );

  const added: StudentView[] = [];
  const skipped: string[] = [];

  db.tx(() => {
    for (const name of names) {
      if (existing.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      existing.add(name.toLowerCase());
      const row: StudentRow = {
        id: randomUUID(),
        class_id: classId,
        name,
        token: newToken(),
        created_at: new Date().toISOString(),
        archived_at: null,
      };
      db.run(
        `INSERT INTO students (id, class_id, name, token, created_at, archived_at)
         VALUES (:id, :class_id, :name, :token, :created_at, :archived_at)`,
        { ...row },
      );
      added.push(toStudentView(row));
    }
  });

  return { added, skipped };
}

export function getStudent(db: Db, teacherId: string, studentId: string): StudentRow | undefined {
  return db.get<StudentRow>(
    `SELECT s.* FROM students s
       JOIN classes c ON c.id = s.class_id
      WHERE s.id = :id AND c.teacher_id = :teacher`,
    { id: studentId, teacher: teacherId },
  );
}

export function rotateStudentToken(db: Db, studentId: string): StudentView {
  const token = newToken();
  db.run('UPDATE students SET token = :token WHERE id = :id', { token, id: studentId });
  const row = db.get<StudentRow>('SELECT * FROM students WHERE id = :id', { id: studentId })!;
  return toStudentView(row);
}

export function studentAttemptCount(db: Db, studentId: string): number {
  const row = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempts WHERE student_id = :id', {
    id: studentId,
  });
  return row?.n ?? 0;
}

export { toStudentView };
