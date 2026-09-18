import type { DueWord } from '@voku/shared';
import type { Db } from '../db/index.js';

/**
 * Which words from earlier units are due to come round again.
 *
 * Spacing is the second of the two techniques with the strongest evidence
 * behind them, and the one voku was missing: "words from an earlier test"
 * already existed, but it browsed a single unit and ignored how long ago it was.
 *
 * Deliberately at the level of the class, not the student. Working out what one
 * child individually is due would mean tracking each of them over months, and
 * this app stores a first name and a score on purpose. The teacher stays the one
 * who decides what goes in the next test; this only says what is worth offering.
 */

/**
 * Days to wait before a word is worth asking again, by how often it has been
 * tested. Expanding, because each successful recall buys more time than the one
 * before — the schedule behind the Leitner box, at the scale of school units.
 */
const BASE_GAP_DAYS = [10, 28, 70];

/** A class that knew a word can wait longer; one that did not should see it sooner. */
const KNEW_IT = 90;
const STRUGGLED = 50;

function targetGapDays(timesTested: number, correctRate: number | null): number {
  const base = BASE_GAP_DAYS[Math.min(timesTested, BASE_GAP_DAYS.length) - 1] ?? BASE_GAP_DAYS[0]!;
  if (correctRate === null) return base;
  if (correctRate >= KNEW_IT) return base * 2;
  if (correctRate < STRUGGLED) return Math.round(base / 2);
  return base;
}

interface Row {
  word_id: string;
  headword_en: string;
  translation_de: string;
  from_test_id: string;
  from_test_title: string;
  tested_at: string | null;
  reached: number;
  correct: number;
}

/**
 * One row per word, newest occurrence first, so a word carried through several
 * units is judged on how it went the last time rather than the first.
 */
export function dueWords(db: Db, classId: string, excludeTestId: string, now = new Date()): DueWord[] {
  const rows = db.all<Row>(
    `SELECT w.id                              AS word_id,
            w.headword_en,
            w.translation_de,
            t.id                              AS from_test_id,
            t.title                           AS from_test_title,
            COALESCE(t.closed_at, t.opened_at) AS tested_at,
            COUNT(a.id)                       AS reached,
            COALESCE(SUM(a.is_correct), 0)    AS correct
       FROM tests t
       JOIN test_words w ON w.test_id = t.id AND w.included = 1
       LEFT JOIN questions q ON q.word_id = w.id
       LEFT JOIN answers   a ON a.question_id = q.id
       LEFT JOIN attempts  at2 ON at2.id = a.attempt_id AND at2.mode = 'graded'
      WHERE t.class_id = :class
        AND t.id != :exclude
        AND t.status = 'closed'
      GROUP BY w.id
      ORDER BY COALESCE(t.closed_at, t.opened_at) DESC`,
    { class: classId, exclude: excludeTestId },
  );

  // Words already in the test being built are not candidates for it.
  const alreadyHere = new Set(
    db
      .all<{ headword_en: string }>('SELECT headword_en FROM test_words WHERE test_id = :t', {
        t: excludeTestId,
      })
      .map((r) => r.headword_en.toLowerCase()),
  );

  const seen = new Map<string, DueWord>();

  for (const row of rows) {
    const key = row.headword_en.toLowerCase();
    if (alreadyHere.has(key)) continue;

    const correctRate = row.reached === 0 ? null : Math.round((row.correct / row.reached) * 100);

    const existing = seen.get(key);
    if (existing) {
      // Rows arrive newest first, so this is an older outing of the same word:
      // it adds to the count but must not overwrite the recent verdict.
      existing.timesTested += 1;
      continue;
    }

    const testedAt = row.tested_at;
    if (!testedAt) continue;

    const daysSince = Math.floor(
      (now.getTime() - new Date(testedAt).getTime()) / (24 * 60 * 60 * 1000),
    );

    seen.set(key, {
      wordId: row.word_id,
      headwordEn: row.headword_en,
      translationDe: row.translation_de,
      fromTestId: row.from_test_id,
      fromTestTitle: row.from_test_title,
      testedAt,
      daysSince,
      timesTested: 1,
      correctRate,
      // Filled in below, once every outing of the word has been counted.
      dueInDays: 0,
    });
  }

  return [...seen.values()]
    .map((word) => ({
      ...word,
      dueInDays: targetGapDays(word.timesTested, word.correctRate) - word.daysSince,
    }))
    .sort((a, b) => {
      // Most overdue first; among equals, the ones the class knew least.
      if (a.dueInDays !== b.dueInDays) return a.dueInDays - b.dueInDays;
      return (a.correctRate ?? 101) - (b.correctRate ?? 101);
    });
}
