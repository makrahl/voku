import { acceptedAnswers, correctAnswerText, isMultipleChoice, type QuestionPayload } from '@voku/shared';

/**
 * Grading is strict: spelling counts, and a near miss scores zero.
 *
 * The distance calculation below is *not* used to award marks. It only decides
 * whether the feedback reads "Almost — receive" instead of a bare "receive", so
 * a student who nearly had it sees the correct form rather than just a red flash.
 * Anything that softens the mark itself belongs in the teacher's bulk-regrade
 * panel, where it is a deliberate decision rather than a silent tolerance.
 */

const LEADING_EN = /^(?:to|the|a|an)\s+/;
const LEADING_DE = /^(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|sich)\s+/;

/**
 * Everything that should not decide right from wrong: case, surrounding
 * punctuation, doubled spaces, and the article or infinitive marker a student
 * may or may not have bothered to type.
 */
export function normalise(text: string): string {
  let out = text
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Strip punctuation only from the ends, so "well-being" survives intact.
  out = out.replace(/^[\p{P}\p{S}]+/gu, '').replace(/[\p{P}\p{S}]+$/gu, '').trim();

  out = out.replace(LEADING_EN, '').replace(LEADING_DE, '').trim();
  return out;
}

/**
 * Optimal string alignment distance — Levenshtein plus adjacent transposition.
 * The transposition case is the whole reason: "recieve" for "receive" is two
 * substitutions to plain Levenshtein but one swap to a human, and it is the
 * single most common misspelling German learners produce.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr: number[] = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2]! + 1);
      }
      curr[j] = value;
    }
    prev2 = prev;
    prev = curr;
    curr = new Array(b.length + 1);
  }
  return prev[b.length]!;
}

/** Long enough that one slip is a typo rather than a different word. */
const MIN_LENGTH_FOR_ALMOST = 5;

export function isAlmost(given: string, correct: string): boolean {
  const g = normalise(given);
  const c = normalise(correct);
  if (!g || g === c) return false;
  if (c.length < MIN_LENGTH_FOR_ALMOST) return false;
  return editDistance(g, c) === 1;
}

export interface Grade {
  correct: boolean;
  /** Wrong, but only just — drives the "Almost — receive" hint. */
  almost: boolean;
  correctAnswer: string;
}

export function gradeAnswer(payload: QuestionPayload, given: string): Grade {
  const correctAnswer = correctAnswerText(payload);

  if (isMultipleChoice(payload)) {
    const chosen = Number.parseInt(given, 10);
    return {
      correct: Number.isInteger(chosen) && chosen === payload.correctIndex,
      almost: false,
      correctAnswer,
    };
  }

  const accepted = acceptedAnswers(payload) ?? [];
  const normalisedGiven = normalise(given);
  if (!normalisedGiven) return { correct: false, almost: false, correctAnswer };

  const correct = accepted.some((answer) => normalise(answer) === normalisedGiven);
  if (correct) return { correct: true, almost: false, correctAnswer };

  return {
    correct: false,
    almost: accepted.some((answer) => isAlmost(given, answer)),
    correctAnswer,
  };
}
