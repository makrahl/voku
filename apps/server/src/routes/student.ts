import { Router } from 'express';
import {
  AnswerSubmitSchema,
  DrillAnswerSchema,
  QuestionPayloadSchema,
  StudentSessionSchema,
  correctAnswerText,
  type DrillFeedback,
  type DrillView,
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
  reviewOpen,
  settleIfExpired,
  startAttempt,
  submitAttempt,
  type AttemptRow,
} from '../services/attempts.js';
import { includedWords, type TestRow } from '../services/tests.js';
import { drillChoice, drillItems, drillPayloads } from '../services/drill.js';
import { myWordChoice, myWordPayload, myWords, myWordsDrill } from '../services/my-words.js';
import { gradeAnswer } from '../services/grading.js';
import { annotateText } from '../services/annotate.js';
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
      })
      // Once handed in there is nothing to do, and it is already listed under
      // what they have finished, with the score.
      .filter((test) => !test.submitted);

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
      // Separate from `openTests`, which leaves out a test once handed in: an
      // early finisher has nothing to start, but revision is still paused.
      revisionPaused: testRunning(req.db, student.class_id),
    };
    res.json(view);
  }),
);

/**
 * True while any test in the class is running.
 *
 * Then nothing that shows an answer is served — not that unit's list, not an
 * earlier unit's, not a student's own words, not an old review. A word brought
 * back from an earlier unit is, by design, also a question in the test being
 * written, so an earlier list is as good as this one's during those minutes. It
 * holds for students who have already handed in too: they are still in the room.
 */
function testRunning(db: Db, classId: string, except?: string): boolean {
  return Boolean(
    db.get(
      `SELECT 1 FROM tests WHERE class_id = :c AND status = 'open'
          ${except ? 'AND id != :except' : ''} LIMIT 1`,
      except ? { c: classId, except } : { c: classId },
    ),
  );
}

const PAUSED = 'Revision is paused while a test is running. It comes back once the test closes.';

function assertNothingRunning(db: Db, classId: string): void {
  if (testRunning(db, classId)) throw forbidden(PAUSED);
}

/**
 * Revising is allowed once a test is published, and again once it is closed.
 * Not in a draft, where there is nothing settled to learn, and not while any
 * test in the class is open — during those minutes they should be taking it.
 */
function assertRevisable(db: Db, test: TestRow): void {
  if (test.status === 'open' || test.status === 'draft') {
    throw forbidden('The word list is not available right now.');
  }
  assertNothingRunning(db, test.class_id);
}

studentRouter.get(
  '/tests/:id/words',
  route((req, res) => {
    const test = testOf(req.db, param(req, 'id'), req.student!.class_id);
    assertRevisable(req.db, test);

    const words = includedWords(req.db, test.id).map((w) => ({
      id: w.id,
      headwordEn: w.headword_en,
      translationDe: w.translation_de,
      // Named rather than coloured: the accent already means "right answer" to
      // a student, and a colour would not survive the worksheet's photocopier.
      repeatedFrom: w.repeated_from_title ?? null,
    }));
    res.json({
      title: test.title,
      words,
      blocks: annotateText(test.source_text, words),
    });
  }),
);

studentRouter.get(
  '/tests/:id/drill',
  route((req, res) => {
    const test = testOf(req.db, param(req, 'id'), req.student!.class_id);
    assertRevisable(req.db, test);
    res.json({ title: test.title, items: drillItems(req.db, test) } satisfies DrillView);
  }),
);

/** A missed word, offered back as a choice before it is asked to be typed again. */
studentRouter.get(
  '/tests/:id/drill/:wordId/choice',
  route((req, res) => {
    const test = testOf(req.db, param(req, 'id'), req.student!.class_id);
    assertRevisable(req.db, test);
    const choice = drillChoice(req.db, test, param(req, 'wordId'));
    if (!choice) throw notFound('No such word in this test');
    res.json(choice);
  }),
);

/**
 * Marks one drilled word. Nothing is written: practice is a study aid, not a
 * measurement, and the teacher is never told who revised or how it went.
 */
studentRouter.post(
  '/tests/:id/drill',
  route((req, res) => {
    const test = testOf(req.db, param(req, 'id'), req.student!.class_id);
    assertRevisable(req.db, test);
    const { wordId, given } = parseBody(DrillAnswerSchema, req.body);

    const payload = drillPayloads(req.db, test).get(wordId);
    if (!payload) throw notFound('No such word in this test');

    // The same grader the real sprint uses, so practice teaches the same
    // strictness — a spelling accepted here must be accepted there.
    const grade = gradeAnswer(payload, given);
    res.json({
      correct: grade.correct,
      almost: grade.almost,
      correctAnswer: grade.correctAnswer,
    } satisfies DrillFeedback);
  }),
);

// ---------------------------------------------------------------------------
// The student's own words to work on
//
// Shaped like a test's drill — list, choice, mark — so the practice screen is
// the same component pointed at a different path. Scoped to the signed-in
// student throughout; there is no teacher-side equivalent, by design.
// ---------------------------------------------------------------------------

// A student's own list is made of words that come back in later units, so it
// is paused like every other list while a test runs.
studentRouter.use('/my-words', (req, _res, next) => {
  assertNothingRunning(req.db, req.student!.class_id);
  next();
});

studentRouter.get(
  '/my-words',
  route((req, res) => {
    res.json(myWords(req.db, req.student!.id));
  }),
);

studentRouter.get(
  '/my-words/drill',
  route((req, res) => {
    res.json({
      title: 'Words to work on',
      items: myWordsDrill(req.db, req.student!.id),
    } satisfies DrillView);
  }),
);

studentRouter.get(
  '/my-words/drill/:wordId/choice',
  route((req, res) => {
    const choice = myWordChoice(req.db, req.student!.id, param(req, 'wordId'));
    if (!choice) throw notFound('That word is not on your list');
    res.json(choice);
  }),
);

studentRouter.post(
  '/my-words/drill',
  route((req, res) => {
    const { wordId, given } = parseBody(DrillAnswerSchema, req.body);
    const payload = myWordPayload(req.db, req.student!.id, wordId);
    if (!payload) throw notFound('That word is not on your list');

    const grade = gradeAnswer(payload, given);
    res.json({
      correct: grade.correct,
      almost: grade.almost,
      correctAnswer: grade.correctAnswer,
    } satisfies DrillFeedback);
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
    // Re-running an old unit's questions shows their answers, and a repeated
    // word may be in the test running now. This unit being open is refused by
    // startAttempt itself, as it always was; this covers every other unit.
    if (testRunning(req.db, test.class_id, test.id)) throw forbidden(PAUSED);
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
    // A practice run started before a test opened must not carry on through it:
    // every answer's feedback names the right word.
    if (attempt.mode === 'practice') assertNothingRunning(req.db, req.student!.class_id);
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

    // Not on handing in: an early finisher would hold the whole answer key while
    // the rest of the room is still writing. See reviewOpen.
    if (!reviewOpen(req.db, test.id)) {
      throw forbidden('Your answers appear here once your teacher closes the test.');
    }
    // An earlier unit's review is a list of answers too, and paused like the
    // rest while another test runs.
    if (testRunning(req.db, test.class_id, test.id)) throw forbidden(PAUSED);

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
      // An early finisher must not be offered the word list while the rest of
      // the class is still writing — it is the answers to half the questions.
      canPractiseWords: !testRunning(req.db, test.class_id),
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
