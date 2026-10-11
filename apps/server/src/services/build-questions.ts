import {
  BLANK,
  DEFAULT_MCQ_OPTIONS,
  type QuestionDirection,
  type QuestionPayload,
  type QuestionType,
  type TestDirection,
} from '@voku/shared';
import type { Rng } from './rng.js';
import { shuffle } from './rng.js';

/**
 * Building question payloads without a language model.
 *
 * Two of the four formats need nothing but the word pair: a typed translation,
 * and a multiple-choice translation whose distractors are drawn from the other
 * words on the same list — same text, same topic, so they are plausible by
 * construction. The other two need prose written for them, and downgrade to a
 * typed translation here; the LLM path fills them in properly.
 */

export interface BuildableWord {
  id: string;
  headwordEn: string;
  translationDe: string;
  acceptedEn: string[];
  acceptedDe: string[];
  contextSentence: string | null;
  /** Written by the teacher or a model; either way the definition MCQ can use it. */
  definitionEn: string | null;
  difficulty: number;
}

export interface BuiltQuestion {
  wordId: string;
  type: QuestionType;
  payload: QuestionPayload;
  /** Set when the requested format could not be built from the data available. */
  downgradedFrom?: QuestionType;
}

/** `mixed` alternates by position, which splits evenly and stays deterministic. */
export function resolveDirection(direction: TestDirection, index: number): QuestionDirection {
  if (direction === 'mixed') return index % 2 === 0 ? 'de_en' : 'en_de';
  return direction;
}

/** What the student is shown, and what they have to produce. */
export function promptAndAnswers(
  word: BuildableWord,
  direction: QuestionDirection,
): { prompt: string; accepted: string[] } {
  if (direction === 'de_en') {
    return {
      prompt: word.translationDe,
      accepted: dedupe([word.headwordEn, ...word.acceptedEn]),
    };
  }
  return {
    prompt: word.headwordEn,
    accepted: dedupe([word.translationDe, ...word.acceptedDe]),
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Distractors from words of similar difficulty, so the choice is between four
 * words of comparable weight rather than one hard word and three easy ones.
 */
function pickDistractors(
  word: BuildableWord,
  pool: BuildableWord[],
  direction: QuestionDirection,
  count: number,
): string[] {
  const answer = promptAndAnswers(word, direction).accepted[0]!.toLowerCase();
  const taken = new Set<string>([answer]);
  const out: string[] = [];

  const nearest = pool
    .filter((other) => other.id !== word.id)
    .sort(
      (a, b) =>
        Math.abs(a.difficulty - word.difficulty) - Math.abs(b.difficulty - word.difficulty) ||
        a.id.localeCompare(b.id),
    );

  for (const other of nearest) {
    if (out.length >= count) break;
    const candidate = promptAndAnswers(other, direction).accepted[0];
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(candidate);
  }
  return out;
}

/**
 * The forms of a headword worth looking for in a sentence, longest first.
 *
 * A word list does not write words the way a sentence does. It says
 * "burden (n.)", "to justify sth", "to lock oneself away from sth" — a lemma
 * with a part of speech, an infinitive marker and a placeholder for whatever
 * the object happens to be. The sentence has none of that furniture, so it is
 * taken off a layer at a time, and the last resort is the longest real word in
 * the entry: blanking "locking" out of a phrase is a fair gap, and no gap at
 * all is not.
 */
export function headwordForms(headword: string): string[] {
  const forms: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (trimmed.length >= 2 && !forms.includes(trimmed)) forms.push(trimmed);
  };

  add(headword);
  // "burden (n.)", "freeway onramp (AE)" — the note is not part of the word.
  const bare = headword.replace(/\([^)]*\)/g, ' ').trim();
  add(bare);
  // "to justify sth" — the placeholder stands for a word the sentence has its own.
  const withoutPlaceholder = bare.replace(/\b(sth|sb|sth\/sb|sb\/sth|somebody|something)\b/gi, ' ');
  add(withoutPlaceholder);
  // "to grind sth out" is still "grind … out"; the infinitive marker is ours.
  add(withoutPlaceholder.replace(/^(to|a|an|the)\s+/i, ''));

  const longest = [...withoutPlaceholder.matchAll(/\p{L}+/gu)]
    .map((match) => match[0])
    .filter((word) => !/^(to|a|an|the|of|in|on|at|for|with|from|one|ones|oneself)$/i.test(word))
    .sort((a, b) => b.length - a.length)[0];
  if (longest) add(longest);

  return forms;
}

/**
 * Turns the sentence the word appeared in into a gap. Tries each form of the
 * headword and a few common inflections, because the text says "slammed" where
 * the word list says "slam". The surface form found is what the student types.
 */
export function blankOut(sentence: string, headword: string): { sentence: string; surface: string } | null {
  // `\b` counts é as a boundary, which would gap "Cliché" and leave the "s" of
  // "Clichés" sitting next to the blank. These say "no letter either side".
  const before = '(?<![\\p{L}\\p{M}])';
  const after = '(?![\\p{L}\\p{M}])';

  for (const form of headwordForms(headword)) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      // Inflected forms first: the longest match is the honest one to blank.
      new RegExp(`${before}${escaped}(s|es|ed|d|ing|ly|er|est)${after}`, 'iu'),
      // "slam" -> "slamming", "slammed": doubled final consonant.
      new RegExp(`${before}${escaped}([bdfglmnprt])\\1?(ed|ing)${after}`, 'iu'),
      new RegExp(`${before}${escaped}${after}`, 'iu'),
    ];
    // "justify" -> "justified", "justifies": the y turns into an i.
    if (/y$/i.test(form)) {
      patterns.push(new RegExp(`${before}${escaped.slice(0, -1)}i(ed|es)${after}`, 'iu'));
    }
    for (const pattern of patterns) {
      const match = pattern.exec(sentence);
      if (!match) continue;
      return { sentence: sentence.replace(pattern, BLANK), surface: match[0] };
    }
  }
  return null;
}

/**
 * An example sentence as a question should show it.
 *
 * A teacher's list quotes the text and says where it was: «“Clichés. There's a
 * point of saturation.” l. 23». The quotation marks and the line reference are
 * for the worksheet, where the class has the text in front of them; inside a
 * question they are furniture, and the reference is a hint nobody intended.
 * The stored sentence keeps them — this only changes what the question shows.
 */
export function asQuestionSentence(sentence: string): string {
  return sentence
    .trim()
    .replace(/\s*\(?\bll?\.\s*\d+(\s*[–-]\s*\d+)?\)?\s*$/i, '')
    .replace(/^[“”"«»']+|[“”"«»']+$/g, '')
    .trim();
}

/**
 * The sentence to show under a typed prompt, or nothing.
 *
 * Asked into German the student sees the English sentence as it stands: it
 * fixes which sense of the word is meant, and the German is still theirs to
 * produce. Asked into English the same sentence would hand over the answer, so
 * the word is blanked out first — and if it cannot be found in the sentence
 * (an inflection the patterns miss), no context is shown at all rather than a
 * sentence with the answer sitting in it.
 */
function typedContext(word: BuildableWord, direction: QuestionDirection): string | null {
  const sentence = word.contextSentence ? asQuestionSentence(word.contextSentence) : '';
  if (!sentence) return null;
  if (direction === 'en_de') return sentence;
  return blankOut(sentence, word.headwordEn)?.sentence ?? null;
}

export interface BuildOptions {
  direction: TestDirection;
  rng: Rng;
  optionCount?: number;
}

/**
 * Builds every payload it can from local data alone. Anything needing prose the
 * model would have written is reported via `downgradedFrom` rather than faked.
 */
export function buildOffline(
  words: BuildableWord[],
  assignments: Array<{ wordId: string; type: QuestionType }>,
  { direction, rng, optionCount = DEFAULT_MCQ_OPTIONS }: BuildOptions,
): BuiltQuestion[] {
  const byId = new Map(words.map((w) => [w.id, w]));
  const out: BuiltQuestion[] = [];

  assignments.forEach((assignment, index) => {
    const word = byId.get(assignment.wordId);
    if (!word) return;
    const qDirection = resolveDirection(direction, index);

    const typed = (downgradedFrom?: QuestionType): BuiltQuestion => {
      const { prompt, accepted } = promptAndAnswers(word, qDirection);
      const context = typedContext(word, qDirection);
      return {
        wordId: word.id,
        type: 'translate_input',
        payload: {
          type: 'translate_input',
          direction: qDirection,
          prompt,
          accepted,
          ...(context ? { context } : {}),
        },
        ...(downgradedFrom ? { downgradedFrom } : {}),
      };
    };

    switch (assignment.type) {
      case 'translate_input':
        out.push(typed());
        return;

      case 'mcq_translation': {
        const { prompt, accepted } = promptAndAnswers(word, qDirection);
        const distractors = pickDistractors(word, words, qDirection, optionCount - 1);
        // Fewer than two options is not a choice.
        if (distractors.length < 2) {
          out.push(typed('mcq_translation'));
          return;
        }
        const options = shuffle([accepted[0]!, ...distractors], rng);
        out.push({
          wordId: word.id,
          type: 'mcq_translation',
          payload: {
            type: 'mcq_translation',
            direction: qDirection,
            prompt,
            options,
            correctIndex: options.indexOf(accepted[0]!),
          },
        });
        return;
      }

      case 'fill_blank': {
        const example = word.contextSentence ? asQuestionSentence(word.contextSentence) : '';
        const blanked = example ? blankOut(example, word.headwordEn) : null;
        if (!blanked) {
          out.push(typed('fill_blank'));
          return;
        }
        out.push({
          wordId: word.id,
          type: 'fill_blank',
          payload: {
            type: 'fill_blank',
            sentence: blanked.sentence,
            accepted: dedupe([blanked.surface, word.headwordEn, ...word.acceptedEn]),
            hint: word.translationDe,
          },
        });
        return;
      }

      case 'mcq_definition': {
        // Written by a model, or — now that whole lists can be imported — by
        // the teacher, in which case no model is needed for this format either.
        const definition = word.definitionEn?.trim();
        if (!definition) {
          out.push(typed('mcq_definition'));
          return;
        }
        // The words themselves are the options: which word does this describe?
        const others = words
          .filter((other) => other.id !== word.id)
          .sort(
            (a, b) =>
              Math.abs(a.difficulty - word.difficulty) - Math.abs(b.difficulty - word.difficulty) ||
              a.id.localeCompare(b.id),
          )
          .map((other) => other.headwordEn)
          .filter((headword) => headword.toLowerCase() !== word.headwordEn.toLowerCase())
          .slice(0, optionCount - 1);
        if (others.length < 2) {
          out.push(typed('mcq_definition'));
          return;
        }
        const options = shuffle([word.headwordEn, ...others], rng);
        out.push({
          wordId: word.id,
          type: 'mcq_definition',
          payload: {
            type: 'mcq_definition',
            definition,
            options,
            correctIndex: options.indexOf(word.headwordEn),
          },
        });
        return;
      }
    }
  });

  return out;
}
