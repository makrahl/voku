import { Router } from 'express';
import {
  AnswerSubmitSchema,
  QuestionPayloadSchema,
  StudentSessionSchema,
  correctAnswerText,
  type StudentHomeView,
} from '@voku/shared';
import { forbidden, notFound, param, parseBody, route, unauthorized } from '../http.js';
import {
  STUDENT_COOKIE,
  clearStudentCookie,
  requireStudent,
  setStudentCookie,
} from '../middleware/auth.js';
import {
  attemptView,
  getAttempt,
  nextQuestion,
  recordAnswer,
  settleIfExpired,
  startAttempt,
  submitAttempt,
  type AttemptRow,
} from '../services/attempts.js';
import { includedWords, type TestRow } from '../services/tests.js';
import { annotateText, unmatchedWords } from '../services/annotate.js';
import type { Db } from '../db/index.js';

export const studentRouter: Router = Router();

studentRouter.post(
  '/session',
  route((req, res) => {
    const { token } = parseBody(StudentSessionSchema, req.body);
    const student = req.db.get<{ id: string; name: string; class_id: string }>(
      'SELECT id, name, class_id FROM students WHERE token = :t AND archived_at IS NULL',
      { t: token },
    );
    if (!student) throw unauthorized('That code is not valid — ask your teacher for a new one');

    // Move the token from the URL into a cookie, so it stops being shoulder-surfable.
    setStudentCookie(res, token);
    const cls = req.db.get<{ name: string }>('SELECT name FROM classes WHERE id = :id', {
      id: student.class_id,
    });
    res.json({ id: student.id, name: student.name, className: cls?.name ?? '' });
  }),
);

studentRouter.post(
  '/logout',
  route((_req, res) => {
    clearStudentCookie(res);
    res.status(204).end();
  }),
);

studentRouter.use(requireStudent);

/** Ensures the attempt belongs to the signed-in student before anything else. */
function ownAttempt(req: { db: Db; student?: { id: string } }, attemptId: string): AttemptRow {
  const attempt = getAttempt(req.db, attemptId);
  if (attempt.student_id !== req.student!.id) throw notFound('No such attempt');
  return settleIfExpired(req.db, attempt);
}

function testOf(db: Db, testId: string, classId: string): TestRow {
  const test = db.get<TestRow>('SELECT * FROM tests WHERE id = :id AND class_id = :c', {
    id: testId,
    c: classId,
  });
  if (!test) throw notFound('No such test');
  return test;
}

studentRouter.get(
  '/me',
  route((req, res) => {
    const student = req.student!;

    const openTests = req.db
      .all<{ id: string; title: string; duration_seconds: number }>(
        `SELECT id, title, duration_seconds FROM tests
          WHERE class_id = :c AND status = 'open' ORDER BY opened_at DESC`,
        { c: student.class_id },
      )
      .map((test) => {
        const attempt = req.db.get<AttemptRow>(
          `SELECT * FROM attempts WHERE test_id = :t AND student_id = :s AND mode = 'graded'`,
          { t: test.id, s: student.id },
        );
        const settled = attempt ? settleIfExpired(req.db, attempt) : null;
        return {
          id: test.id,
          title: test.title,
          durationSeconds: test.duration_seconds,
          attemptId: settled?.id ?? null,
          submitted: Boolean(settled?.submitted_at),
        };
      });

    // Study lists are visible before a test opens and again once it has closed,
    // but never while it is open — that would just be the answers on screen.
    const studyLists = req.db.all<{ id: string; title: string; n: number }>(
      `SELECT t.id, t.title,
              (SELECT COUNT(*) FROM test_words w WHERE w.test_id = t.id AND w.included = 1) AS n
         FROM tests t
        WHERE t.class_id = :c AND t.status IN ('published', 'closed')
        ORDER BY COALESCE(t.closed_at, t.published_at) DESC`,
      { c: student.class_id },
    );

    const pastAttempts = req.db
      .all<AttemptRow & { title: string }>(
        `SELECT a.*, t.title FROM attempts a JOIN tests t ON t.id = a.test_id
          WHERE a.student_id = :s AND a.mode = 'graded' AND a.submitted_at IS NOT NULL
          ORDER BY a.submitted_at DESC`,
        { s: student.id },
      )
      .map((row) => ({
        attemptId: row.id,
        testId: row.test_id,
        testTitle: row.title,
        percent:
          row.target_snapshot > 0 ? Math.round((row.correct_count / row.target_snapshot) * 100) : 0,
        correctCount: row.correct_count,
        targetCount: row.target_snapshot,
        submittedAt: row.submitted_at!,
      }));

    const cls = req.db.get<{ name: string }>('SELECT name FROM classes WHERE id = :id', {
      id: student.class_id,
    });

    const view: StudentHomeView = {
      student: { id: student.id, name: student.name },
      className: cls?.name ?? '',
      openTests,
      studyLists: studyLists.map((t) => ({ id: t.id, title: t.title, wordCount: t.n })),
      pastAttempts,
    };
    res.json(view);
  }),
);

studentRouter.get(
  '/tests/:id/words',
  route((req, res) => {
    const test = testOf(req.db, param(req, 'id'), req.student!.class_id);
    if (test.status === 'open' || test.status === 'draft') {
      throw forbidden('The word list is not available right now.');
    }

    const words = includedWords(req.db, test.id).map((w) => ({
      id: w.id,
      headwordEn: w.headword_en,
      translationDe: w.translation_de,
    }));
    const segments = annotateText(test.source_text, words);

    res.json({
      title: test.title,
      words,
      segments,
      // Words the text never uses — a pasted list has no text at all.
      alsoLearn: unmatchedWords(segments, words),
    });
  }),
);

studentRouter.post(
  '/tests/:id/start',
  route((req, res) => {
    const test = testOf(req.db, param(req, 'id'), req.student!.class_id);
    const attempt = startAttempt(req.db, test, req.student!.id, 'graded');
    res.json({
      attempt: attemptView(req.db, attempt, test.title),
      question: nextQuestion(req.db, attempt),
    });
  }),
);

studentRouter.post(
  '/tests/:id/practice',
  route((req, res) => {
    const test = testOf(req.db, param(req, 'id'), req.student!.class_id);
    const attempt = startAttempt(req.db, test, req.student!.id, 'practice');
    res.json({
      attempt: attemptView(req.db, attempt, test.title),
      question: nextQuestion(req.db, attempt),
    });
  }),
);

studentRouter.get(
  '/attempts/:id',
  route((req, res) => {
    const attempt = ownAttempt(req, param(req, 'id'));
    const test = req.db.get<TestRow>('SELECT * FROM tests WHERE id = :id', { id: attempt.test_id })!;
    res.json({
      attempt: attemptView(req.db, attempt, test.title),
      question: nextQuestion(req.db, attempt),
    });
  }),
);

studentRouter.post(
  '/attempts/:id/answers',
  route((req, res) => {
    const attempt = ownAttempt(req, param(req, 'id'));
    const { questionId, given } = parseBody(AnswerSubmitSchema, req.body);
    const feedback = recordAnswer(req.db, attempt, questionId, given);

    const updated = getAttempt(req.db, attempt.id);
    const question = nextQuestion(req.db, updated);
    // Running out of questions ends the sprint just as the clock would.
    if (!question) submitAttempt(req.db, updated);

    const test = req.db.get<TestRow>('SELECT * FROM tests WHERE id = :id', { id: attempt.test_id })!;
    res.json({
      feedback,
      question,
      attempt: attemptView(req.db, getAttempt(req.db, attempt.id), test.title),
    });
  }),
);

studentRouter.post(
  '/attempts/:id/submit',
  route((req, res) => {
    const attempt = ownAttempt(req, param(req, 'id'));
    const test = req.db.get<TestRow>('SELECT * FROM tests WHERE id = :id', { id: attempt.test_id })!;
    res.json({ attempt: attemptView(req.db, submitAttempt(req.db, attempt), test.title) });
  }),
);

studentRouter.get(
  '/attempts/:id/review',
  route((req, res) => {
    const attempt = ownAttempt(req, param(req, 'id'));
    const test = req.db.get<TestRow>('SELECT * FROM tests WHERE id = :id', { id: attempt.test_id })!;

    // Answers stay hidden until the student has handed in or the test is over.
    if (!attempt.submitted_at && test.status !== 'closed') {
      throw forbidden('You can look at the answers once you have handed in.');
    }

    const rows = req.db.all<{
      id: string;
      payload_json: string;
      order_index: number;
      given_text: string | null;
      is_correct: number | null;
    }>(
      `SELECT q.id, q.payload_json, q.order_index, a.given_text, a.is_correct
         FROM questions q
         LEFT JOIN answers a ON a.question_id = q.id AND a.attempt_id = :a
        WHERE q.test_id = :t
        ORDER BY q.order_index ASC`,
      { a: attempt.id, t: attempt.test_id },
    );

    res.json({
      attempt: attemptView(req.db, attempt, test.title),
      questions: rows.map((row) => {
        const payload = QuestionPayloadSchema.parse(JSON.parse(row.payload_json));
        return {
          id: row.id,
          orderIndex: row.order_index,
          payload,
          correctAnswer: correctAnswerText(payload),
          given: row.given_text,
          // `null` means the student never got this far, which is not the same
          // as getting it wrong — the review screen shows that distinction.
          correct: row.is_correct === null ? null : row.is_correct === 1,
          reached: row.given_text !== null,
        };
      }),
    });
  }),
);

export { STUDENT_COOKIE };
