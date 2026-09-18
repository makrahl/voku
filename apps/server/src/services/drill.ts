import { stripAnswer, type DrillItem, type QuestionPayload } from '@voku/shared';
import type { Db } from '../db/index.js';
import { buildOffline } from './build-questions.js';
import { makeRng, seedFrom } from './rng.js';
import { includedWords, toBuildable, type TestRow } from './tests.js';

/**
 * Drilling the word pairs before a test.
 *
 * Shared by the student's practice screen and the teacher's preview of it, so
 * what the teacher checks is literally what the class will be asked. Nothing
 * here writes: practice is a study aid, not a measurement.
 */

/**
 * The whole list is built and one question picked out of it, rather than
 * building the single word asked for: on a `mixed` test the direction comes
 * from the word's position, so the two would disagree and a student could be
 * asked one way and marked the other.
 */
export function drillPayloads(db: Db, test: TestRow): Map<string, QuestionPayload> {
  const words = includedWords(db, test.id);
  const built = buildOffline(
    words.map(toBuildable),
    words.map((word) => ({ wordId: word.id, type: 'translate_input' as const })),
    { direction: test.direction, rng: makeRng(seedFrom(test.id)) },
  );
  return new Map(built.map((question) => [question.wordId, question.payload]));
}

export function drillItems(db: Db, test: TestRow): DrillItem[] {
  return [...drillPayloads(db, test)].flatMap(([wordId, payload]) => {
    // stripAnswer is the only path from a question to a student, even for one
    // built on the fly — hand-rolling the shape is how an answer leaks.
    const safe = stripAnswer(payload);
    return safe.type === 'translate_input'
      ? [{ wordId, prompt: safe.prompt, direction: safe.direction }]
      : [];
  });
}
