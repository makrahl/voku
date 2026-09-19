import { randomUUID } from 'node:crypto';
import {
  QuestionPayloadSchema,
  stripAnswer,
  type AnswerFeedback,
  type AttemptMode,
  type AttemptView,
  type StudentQuestionView,
} from '@voku/shared';
import type { Db } from '../db/index.js';
import { json } from '../db/index.js';
import { conflict, forbidden, notFound } from '../http.js';
import { gradeAnswer } from './grading.js';
import { makeRng, seedFrom, shuffle } from './rng.js';
import type { QuestionRow, TestRow } from './tests.js';

export interface AttemptRow {
  id: string;
  test_id: string;
  student_id: string;
  mode: AttemptMode;
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
  reached_index: number;
  correct_count: number;
  target_snapshot: number;
  order_json: string | null;
}

export function getAttempt(db: Db, attemptId: string): AttemptRow {
  const row = db.get<AttemptRow>('SELECT * FROM attempts WHERE id = :id', { id: attemptId });
  if (!row) throw notFound('No such attempt');
  return row;
}

function poolFor(db: Db, testId: string): QuestionRow[] {
  return db.all<QuestionRow>(
    'SELECT * FROM questions WHERE test_id = :t ORDER BY order_index ASC',
    { t: testId },
  );
}

/**
 * Graded runs go in strict difficulty order, identical for every student, so
 * position 12 is the same question for the whole class and the results are
 * directly comparable. Practice runs are shuffled — by then the point is to
 * drill the words, not to measure anybody.
 */
export function orderedQuestions(db: Db, attempt: AttemptRow): QuestionRow[] {
  const pool = poolFor(db, attempt.test_id);
  if (attempt.mode !== 'practice' || !attempt.order_json) return pool;

  const order = json<string[]>(attempt.order_json, []);
  const byId = new Map(pool.map((q) => [q.id, q]));
  const shuffled = order.map((id) => byId.get(id)).filter((q): q is QuestionRow => q !== undefined);
  // Any question added since the attempt started still gets appended.
  const seen = new Set(order);
  return [...shuffled, ...pool.filter((q) => !seen.has(q.id))];
}

/** The clock belongs to the server. A device with a wrong time gains nothing. */
export function isExpired(attempt: AttemptRow, now = new Date()): boolean {
  if (!attempt.deadline_at) return false;
  return new Date(attempt.deadline_at).getTime() <= now.getTime();
}

export function secondsRemaining(attempt: AttemptRow, now = new Date()): number | null {
  if (!attempt.deadline_at) return null;
  const ms = new Date(attempt.deadline_at).getTime() - now.getTime();
  return Math.max(0, Math.round(ms / 1000));
}

/**
 * Ends an attempt whose time is up. Called before every read and every write,
 * so an expired sprint closes itself without needing a background job.
 */
export function settleIfExpired(db: Db, attempt: AttemptRow): AttemptRow {
  if (attempt.submitted_at || !isExpired(attempt)) return attempt;
  db.run('UPDATE attempts SET submitted_at = :at WHERE id = :id', {
    at: attempt.deadline_at,
    id: attempt.id,
  });
  return getAttempt(db, attempt.id);
}

export function startAttempt(
  db: Db,
  test: TestRow,
  studentId: string,
  mode: AttemptMode,
): AttemptRow {
  if (mode === 'graded') {
    if (test.status !== 'open') throw conflict('This test is not open.');

    const existing = db.get<AttemptRow>(
      `SELECT * FROM attempts WHERE test_id = :t AND student_id = :s AND mode = 'graded'`,
      { t: test.id, s: studentId },
    );
    // Resume rather than restart: a dead iPad must not cost the sprint.
    if (existing) return settleIfExpired(db, existing);
  } else if (test.status !== 'closed') {
    throw conflict('Practice opens once the test has been closed.');
  }

  const pool = poolFor(db, test.id);
  if (pool.length === 0) throw conflict('This test has no questions.');

  const now = new Date();
  const id = randomUUID();
  const deadline =
    mode === 'graded' ? new Date(now.getTime() + test.duration_seconds * 1000).toISOString() : null;
  // Practice is untimed and shuffled; the seed keeps a resumed run consistent.
  const order =
    mode === 'practice'
      ? JSON.stringify(shuffle(pool.map((q) => q.id), makeRng(seedFrom(id))))
      : null;

  db.run(
    `INSERT INTO attempts (id, test_id, student_id, mode, started_at, deadline_at,
                           submitted_at, reached_index, correct_count, target_snapshot, order_json)
     VALUES (:id, :test_id, :student_id, :mode, :started_at, :deadline_at,
             NULL, 0, 0, :target, :order_json)`,
    {
      id,
      test_id: test.id,
      student_id: studentId,
      mode,
      started_at: now.toISOString(),
      deadline_at: deadline,
      // Snapshot the target, so editing it later cannot move a finished score.
      target: test.target_count,
      order_json: order,
    },
  );
  return getAttempt(db, id);
}

export function answeredCount(db: Db, attemptId: string): number {
  return (
    db.get<{ n: number }>('SELECT COUNT(*) AS n FROM answers WHERE attempt_id = :a', { a: attemptId })
      ?.n ?? 0
  );
}

export function percentFor(attempt: AttemptRow): number {
  if (attempt.target_snapshot <= 0) return 0;
  // Deliberately uncapped: passing 100% is the point of the format.
  return Math.round((attempt.correct_count / attempt.target_snapshot) * 100);
}

/**
 * Whether a student may go through their answers: only once the test is closed.
 *
 * It used to open as soon as they handed in, which gave an early finisher the
 * whole answer key — reached and unreached questions alike — on one screen,
 * while the rest of the room was still writing. Handing in now shows the score;
 * the answers follow when the teacher closes the test. The instant feedback
 * during the sprint is a separate decision and is unchanged.
 */
export function reviewOpen(db: Db, testId: string): boolean {
  return (
    db.get<{ status: string }>('SELECT status FROM tests WHERE id = :id', { id: testId })?.status ===
    'closed'
  );
}

export function attemptView(db: Db, attempt: AttemptRow, testTitle: string): AttemptView {
  const now = new Date();
  return {
    id: attempt.id,
    testId: attempt.test_id,
    testTitle,
    mode: attempt.mode,
    startedAt: attempt.started_at,
    deadlineAt: attempt.deadline_at,
    submittedAt: attempt.submitted_at,
    serverNow: now.toISOString(),
    secondsRemaining: attempt.submitted_at ? 0 : secondsRemaining(attempt, now),
    reachedIndex: attempt.reached_index,
    correctCount: attempt.correct_count,
    targetCount: attempt.target_snapshot,
    percent: percentFor(attempt),
    poolSize: poolFor(db, attempt.test_id).length,
    reviewOpen: reviewOpen(db, attempt.test_id),
  };
}

/** The next unanswered question, with every answer-bearing field removed. */
export function nextQuestion(db: Db, attempt: AttemptRow): StudentQuestionView | null {
  if (attempt.submitted_at) return null;

  const ordered = orderedQuestions(db, attempt);
  const answered = new Set(
    db
      .all<{ question_id: string }>('SELECT question_id FROM answers WHERE attempt_id = :a', {
        a: attempt.id,
      })
      .map((r) => r.question_id),
  );

  const index = ordered.findIndex((q) => !answered.has(q.id));
  if (index === -1) return null;

  const question = ordered[index]!;
  return {
    id: question.id,
    index: index + 1,
    total: ordered.length,
    payload: stripAnswer(QuestionPayloadSchema.parse(JSON.parse(question.payload_json))),
  };
}

export function recordAnswer(
  db: Db,
  attempt: AttemptRow,
  questionId: string,
  given: string,
): AnswerFeedback {
  // Expiry is checked before the submitted flag on purpose: by the time this
  // runs, settleIfExpired has usually already stamped submitted_at, and a
  // student whose clock ran out deserves "Time is up", not "already handed in".
  if (isExpired(attempt)) {
    settleIfExpired(db, attempt);
    throw forbidden('Time is up.');
  }
  if (attempt.submitted_at) throw conflict('This attempt has already been handed in.');

  const row = db.get<QuestionRow>('SELECT * FROM questions WHERE id = :id AND test_id = :t', {
    id: questionId,
    t: attempt.test_id,
  });
  if (!row) throw notFound('No such question in this test');

  const already = db.get<{ id: string }>(
    'SELECT id FROM answers WHERE attempt_id = :a AND question_id = :q',
    { a: attempt.id, q: questionId },
  );
  if (already) throw conflict('That question has already been answered.');

  const payload = QuestionPayloadSchema.parse(JSON.parse(row.payload_json));
  const grade = gradeAnswer(payload, given);

  const updated = db.tx(() => {
    db.run(
      `INSERT INTO answers (id, attempt_id, question_id, given_text, is_correct, answered_at)
       VALUES (:id, :attempt_id, :question_id, :given, :correct, :at)`,
      {
        id: randomUUID(),
        attempt_id: attempt.id,
        question_id: questionId,
        given,
        correct: grade.correct,
        at: new Date().toISOString(),
      },
    );
    db.run(
      `UPDATE attempts
          SET correct_count = correct_count + :inc,
              reached_index = reached_index + 1
        WHERE id = :id`,
      { inc: grade.correct ? 1 : 0, id: attempt.id },
    );
    return getAttempt(db, attempt.id);
  });

  return {
    correct: grade.correct,
    correctAnswer: grade.correctAnswer,
    almost: grade.almost,
    correctCount: updated.correct_count,
    percent: percentFor(updated),
  };
}

export function submitAttempt(db: Db, attempt: AttemptRow): AttemptRow {
  if (attempt.submitted_at) return attempt;
  db.run('UPDATE attempts SET submitted_at = :at WHERE id = :id', {
    at: new Date().toISOString(),
    id: attempt.id,
  });
  return getAttempt(db, attempt.id);
}

/**
 * Recomputes every answer against the current accepted lists. Used by the bulk
 * regrade panel, so accepting a variant re-marks the whole class at once.
 */
export function rescoreAttempt(db: Db, attemptId: string): number {
  const answers = db.all<{ id: string; question_id: string; given_text: string; payload_json: string }>(
    `SELECT a.id, a.question_id, a.given_text, q.payload_json
       FROM answers a JOIN questions q ON q.id = a.question_id
      WHERE a.attempt_id = :a`,
    { a: attemptId },
  );

  let correct = 0;
  db.tx(() => {
    for (const answer of answers) {
      const payload = QuestionPayloadSchema.parse(JSON.parse(answer.payload_json));
      const grade = gradeAnswer(payload, answer.given_text);
      if (grade.correct) correct++;
      db.run('UPDATE answers SET is_correct = :c WHERE id = :id', {
        c: grade.correct,
        id: answer.id,
      });
    }
    db.run('UPDATE attempts SET correct_count = :n WHERE id = :id', { n: correct, id: attemptId });
  });
  return correct;
}
