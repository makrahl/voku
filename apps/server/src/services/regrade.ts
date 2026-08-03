import {
  QuestionPayloadSchema,
  correctAnswerText,
  isMultipleChoice,
  type QuestionPayload,
  type RejectedAnswerGroup,
  type RepeatCandidate,
} from '@voku/shared';
import type { Db } from '../db/index.js';
import { json } from '../db/index.js';
import { conflict, notFound } from '../http.js';
import { normalise } from './grading.js';
import { rescoreAttempt } from './attempts.js';

/**
 * Strict spelling makes this panel structural rather than a nicety. After a
 * test, every rejected typed answer is grouped by what students actually wrote,
 * so "seven of them typed 'recieve'" is one decision instead of seven.
 */
export function rejectedAnswers(db: Db, testId: string): RejectedAnswerGroup[] {
  const rows = db.all<{
    question_id: string;
    payload_json: string;
    headword_en: string;
    given_text: string;
    student_name: string;
  }>(
    `SELECT a.question_id, q.payload_json, w.headword_en, a.given_text, s.name AS student_name
       FROM answers a
       JOIN attempts  t ON t.id = a.attempt_id
       JOIN questions q ON q.id = a.question_id
       JOIN test_words w ON w.id = q.word_id
       JOIN students  s ON s.id = t.student_id
      WHERE q.test_id = :test AND t.mode = 'graded' AND a.is_correct = 0
      ORDER BY s.name COLLATE NOCASE`,
    { test: testId },
  );

  const groups = new Map<string, RejectedAnswerGroup>();

  for (const row of rows) {
    const payload = QuestionPayloadSchema.parse(JSON.parse(row.payload_json));
    // Multiple choice has nothing to accept — they picked a listed option.
    if (isMultipleChoice(payload)) continue;

    const variant = row.given_text.trim();
    if (!variant) continue;

    // Group by the normalised form so "Recieve" and "recieve " are one decision.
    const key = `${row.question_id}::${normalise(variant)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (!existing.studentNames.includes(row.student_name)) {
        existing.studentNames.push(row.student_name);
      }
      continue;
    }
    groups.set(key, {
      questionId: row.question_id,
      headwordEn: row.headword_en,
      correctAnswer: correctAnswerText(payload),
      variant,
      count: 1,
      studentNames: [row.student_name],
    });
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || a.headwordEn.localeCompare(b.headwordEn));
}

export interface AcceptVariantResult {
  rescoredAttempts: number;
  accepted: string[];
}

/**
 * Adds a variant to a question's accepted list and re-marks every attempt at
 * this test. Optionally writes it back to the word so the same argument never
 * has to happen again in a future test.
 */
export function acceptVariant(
  db: Db,
  testId: string,
  questionId: string,
  variant: string,
  persist: boolean,
): AcceptVariantResult {
  const row = db.get<{ payload_json: string; word_id: string }>(
    'SELECT payload_json, word_id FROM questions WHERE id = :id AND test_id = :t',
    { id: questionId, t: testId },
  );
  if (!row) throw notFound('No such question in this test');

  const payload = QuestionPayloadSchema.parse(JSON.parse(row.payload_json)) as QuestionPayload;
  if (isMultipleChoice(payload)) {
    throw conflict('There is nothing to accept on a multiple-choice question.');
  }

  const trimmed = variant.trim();
  if (!trimmed) throw conflict('That answer is empty.');

  const already = payload.accepted.some((a) => normalise(a) === normalise(trimmed));
  const accepted = already ? payload.accepted : [...payload.accepted, trimmed];

  let rescored = 0;
  db.tx(() => {
    if (!already) {
      db.run('UPDATE questions SET payload_json = :p WHERE id = :id', {
        p: JSON.stringify({ ...payload, accepted }),
        id: questionId,
      });

      if (persist) {
        // Typed questions ask for English when the prompt is German, and vice versa.
        const column =
          payload.type === 'fill_blank' || payload.direction === 'de_en'
            ? 'accepted_en_json'
            : 'accepted_de_json';
        const word = db.get<Record<string, string>>(
          `SELECT ${column} AS list FROM test_words WHERE id = :id`,
          { id: row.word_id },
        );
        const list = json<string[]>(word?.list, []);
        if (!list.some((a) => normalise(a) === normalise(trimmed))) {
          db.run(`UPDATE test_words SET ${column} = :list WHERE id = :id`, {
            list: JSON.stringify([...list, trimmed]),
            id: row.word_id,
          });
        }
      }
    }

    for (const attempt of db.all<{ id: string }>(
      `SELECT id FROM attempts WHERE test_id = :t AND mode = 'graded'`,
      { t: testId },
    )) {
      rescoreAttempt(db, attempt.id);
      rescored++;
    }
  });

  return { rescoredAttempts: rescored, accepted };
}

/**
 * Words from an earlier test in the same class, with how the class did on them.
 *
 * The correct rate counts only students who actually *reached* the question. In
 * a sprint most students never get to the last few, and treating unreached as
 * wrong would make every hard word look like a catastrophe.
 */
export function repeatCandidates(db: Db, fromTestId: string): RepeatCandidate[] {
  return db
    .all<{
      word_id: string;
      headword_en: string;
      translation_de: string;
      difficulty: number;
      reached: number;
      correct: number;
    }>(
      `SELECT w.id AS word_id, w.headword_en, w.translation_de, w.difficulty,
              COUNT(a.id)                            AS reached,
              COALESCE(SUM(a.is_correct), 0)         AS correct
         FROM test_words w
         LEFT JOIN questions q ON q.word_id = w.id
         LEFT JOIN answers   a ON a.question_id = q.id
         LEFT JOIN attempts  t ON t.id = a.attempt_id AND t.mode = 'graded'
        WHERE w.test_id = :test AND w.included = 1
        GROUP BY w.id
        ORDER BY w.difficulty DESC, w.sort_rank ASC`,
      { test: fromTestId },
    )
    .map((row) => ({
      wordId: row.word_id,
      headwordEn: row.headword_en,
      translationDe: row.translation_de,
      difficulty: row.difficulty,
      correctRate: row.reached === 0 ? null : Math.round((row.correct / row.reached) * 100),
      reachedCount: row.reached,
    }));
}
