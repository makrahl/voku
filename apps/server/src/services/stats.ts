import type { QuestionType } from '@voku/shared';
import type { Db } from '../db/index.js';

/**
 * Which words the class did not know — the question a teacher asks after "who
 * scored what". Rates count only students who reached the question: in a sprint
 * most never see the last few, and counting those as wrong buries the real
 * problems.
 */

export interface QuestionStat {
  questionId: string;
  wordId: string;
  headwordEn: string;
  translationDe: string;
  type: QuestionType;
  orderIndex: number;
  /** Students who got this far and answered. */
  reachedCount: number;
  correctCount: number;
  /** Null when nobody reached it — unknown, not zero. */
  correctRate: number | null;
  /** What they wrote instead, most common first. Empty for multiple choice. */
  commonWrong: Array<{ given: string; count: number }>;
}

export interface TestStats {
  questions: QuestionStat[];
  studentsStarted: number;
  studentsSubmitted: number;
  /** How far the typical student got — where the clock, not the vocabulary, stopped them. */
  medianReached: number | null;
  /** Questions at least half the class that saw them got wrong. */
  troubleCount: number;
}

const TROUBLE_THRESHOLD = 50;
/** Below this, a rate over one or two students is noise rather than a signal. */
const MIN_REACHED_FOR_TROUBLE = 3;

export function testStats(db: Db, testId: string): TestStats {
  const rows = db.all<{
    question_id: string;
    word_id: string;
    headword_en: string;
    translation_de: string;
    type: QuestionType;
    order_index: number;
    reached: number;
    correct: number;
  }>(
    `SELECT q.id            AS question_id,
            q.word_id,
            w.headword_en,
            w.translation_de,
            q.type,
            q.order_index,
            COUNT(a.id)                    AS reached,
            COALESCE(SUM(a.is_correct), 0) AS correct
       FROM questions q
       JOIN test_words w ON w.id = q.word_id
       -- Filtered before the join; on a LEFT JOIN the practice rows survive.
       LEFT JOIN (
              SELECT a.question_id, a.is_correct, a.id
                FROM answers a
                JOIN attempts t ON t.id = a.attempt_id
               WHERE t.mode = 'graded'
            ) a ON a.question_id = q.id
      WHERE q.test_id = :test
      GROUP BY q.id
      ORDER BY q.order_index ASC`,
    { test: testId },
  );

  // Evidence of how a word was misunderstood, not just that it was.
  const wrong = db.all<{ question_id: string; given: string; n: number }>(
    `SELECT a.question_id, a.given_text AS given, COUNT(*) AS n
       FROM answers a
       JOIN attempts t ON t.id = a.attempt_id AND t.mode = 'graded'
       JOIN questions q ON q.id = a.question_id
      WHERE q.test_id = :test AND a.is_correct = 0 AND TRIM(a.given_text) != ''
      GROUP BY a.question_id, LOWER(TRIM(a.given_text))
      ORDER BY n DESC`,
    { test: testId },
  );

  const wrongByQuestion = new Map<string, Array<{ given: string; count: number }>>();
  for (const row of wrong) {
    const list = wrongByQuestion.get(row.question_id) ?? [];
    if (list.length < 3) list.push({ given: row.given, count: row.n });
    wrongByQuestion.set(row.question_id, list);
  }

  const questions: QuestionStat[] = rows.map((row) => ({
    questionId: row.question_id,
    wordId: row.word_id,
    headwordEn: row.headword_en,
    translationDe: row.translation_de,
    type: row.type,
    orderIndex: row.order_index,
    reachedCount: row.reached,
    correctCount: row.correct,
    correctRate: row.reached === 0 ? null : Math.round((row.correct / row.reached) * 100),
    // Multiple choice has no free text worth reporting.
    commonWrong:
      row.type === 'mcq_translation' || row.type === 'mcq_definition'
        ? []
        : (wrongByQuestion.get(row.question_id) ?? []),
  }));

  const attempts = db.all<{ reached_index: number; submitted_at: string | null }>(
    `SELECT reached_index, submitted_at FROM attempts
      WHERE test_id = :test AND mode = 'graded'`,
    { test: testId },
  );

  const reached = attempts.map((a) => a.reached_index).sort((a, b) => a - b);
  const medianReached =
    reached.length === 0
      ? null
      : reached.length % 2 === 1
        ? reached[(reached.length - 1) / 2]!
        : Math.round((reached[reached.length / 2 - 1]! + reached[reached.length / 2]!) / 2);

  return {
    questions,
    studentsStarted: attempts.length,
    studentsSubmitted: attempts.filter((a) => a.submitted_at).length,
    medianReached,
    troubleCount: questions.filter(
      (q) =>
        q.correctRate !== null &&
        q.reachedCount >= MIN_REACHED_FOR_TROUBLE &&
        q.correctRate < TROUBLE_THRESHOLD,
    ).length,
  };
}
