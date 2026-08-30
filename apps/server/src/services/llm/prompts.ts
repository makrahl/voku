import { BLANK, type CefrLevel } from '@voku/shared';

/**
 * Prompts live together so the wording that decides question quality is easy to
 * read and tune in one place. They all state the audience explicitly — German
 * secondary students learning English — because that is what makes the
 * difficulty and trickiness judgements meaningful.
 */

const AUDIENCE =
  'The learners are German secondary-school students learning English. Their first language is German.';

export const EXTRACT_SYSTEM = `You extract vocabulary worth teaching from an English text.
${AUDIENCE}
You reply with JSON only, no prose and no code fences.`;

export function extractUser(text: string, level: CefrLevel, maxWords: number): string {
  return `Read the text and list up to ${maxWords} words or short phrases worth training.

Include only vocabulary ABOVE the ${level} level. Skip function words, numbers, proper nouns, and
anything a ${level} learner already knows. Give the dictionary form (lemma), not the inflected form
as it appears in the text.

For each word, judge two SEPARATE and INDEPENDENT things:

- "difficulty" 1-10: how hard the word is for a ${level} German learner to know at all.
- "trickiness" 0-3: how likely they are to get it WRONG because German misleads them.
  These are not the same. "become" is easy (difficulty 2) but very tricky (trickiness 3), because
  German "bekommen" means "to receive". "nevertheless" is hard (difficulty 8) but not tricky at all
  (trickiness 0) — nothing about German points the wrong way.

  Use "trickinessKind":
    "false_friend"        - a German cognate means something else (Gift/poison, eventually/eventuell)
    "confusable_pair"     - easily mixed up with a similar English word (lose/loose, affect/effect)
    "misleading_compound" - the parts do not add up to the meaning (understand, outstanding)
    "none"                - nothing misleading
  When trickiness is 1 or higher, put the trap in "trickinessNote", e.g.
  "German 'Gift' means poison, not a present". This note is used to write the wrong answers, so be
  concrete about what the learner will wrongly believe.

Also judge:
- "suitsFillBlank": can this word sit naturally in a one-sentence gap where only it fits?
  Verbs, adjectives and concrete nouns usually can; abstract connectives usually cannot.
- "suitsDefinitionMcq": can this be defined in one clear English sentence without using the word
  itself? Concrete words can; vague function words cannot.

Give "translationDe" as the single best German translation, plus "alternativesDe" and
"alternativesEn" for other answers a teacher would mark correct. Give "contextSentence" as the
sentence from the text where the word appeared, copied exactly.

Reply with:
{"words":[{"headword":"","lemma":"","pos":"","translationDe":"","alternativesDe":[],
"alternativesEn":[],"difficulty":1,"trickiness":0,"trickinessKind":"none","trickinessNote":"",
"contextSentence":"","suitsFillBlank":true,"suitsDefinitionMcq":true}]}

TEXT:
"""
${text}
"""`;
}

export const DISTRACTOR_SYSTEM = `You write wrong answers for vocabulary multiple-choice questions.
${AUDIENCE}
You reply with JSON only, no prose and no code fences.`;

export function distractorUser(
  items: Array<{ headword: string; answer: string; note?: string | null }>,
  targetLanguage: 'German' | 'English',
  count: number,
): string {
  const list = items
    .map(
      (item, i) =>
        `${i + 1}. "${item.headword}" — correct answer: "${item.answer}"${item.note ? ` — trap: ${item.note}` : ''}`,
    )
    .join('\n');

  return `For each word below, write exactly ${count} WRONG answers in ${targetLanguage}.

A wrong answer must be one the student would actually be tempted to pick. Random unrelated words
make the question free marks, which defeats the point. In order of preference:
  1. If a trap is given, one wrong answer must be exactly what the student wrongly believes the word
     means — for "eventually" with the trap "German 'eventuell' means possibly", use "eventuell".
  2. A near-synonym with a different nuance.
  3. A word from the same topic that would fit the sentence but not the meaning.

THE ONE RULE THAT MATTERS: exactly one option may be correct. Before you answer, check each wrong
option by asking "could a teacher mark this right?" — if yes, replace it.

This is the most common way these questions go wrong. For "kaum → scarcely", the options "barely",
"rarely" and "hardly ever" are all ALSO correct translations of "kaum", so that question has four
right answers and is broken. Near-synonyms of the correct answer are never acceptable as wrong
answers, however tempting they look.

Every wrong answer must be a real ${targetLanguage} word or phrase, and must be plausible. Do not
repeat the correct answer. Do not repeat yourself.

WORDS:
${list}

Reply with:
{"items":[{"headword":"","distractors":["","",""]}]}`;
}

export const DEFINITION_SYSTEM = `You write English dictionary-style definitions for vocabulary tests.
${AUDIENCE}
You reply with JSON only, no prose and no code fences.`;

export function definitionUser(
  items: Array<{ headword: string; pos?: string | null }>,
  count: number,
): string {
  const list = items
    .map((item, i) => `${i + 1}. "${item.headword}"${item.pos ? ` (${item.pos})` : ''}`)
    .join('\n');

  return `For each word below, write one short English definition and exactly ${count} wrong answers.

The definition must:
  - be a single clause of plain English, simpler than the word being defined
  - NOT contain the word itself, or any form of it
  - describe only that word, so no other option could also fit

The wrong answers are OTHER ENGLISH WORDS (not definitions) that a student might pick — words that
look or sound similar, or belong to the same topic. For "reluctant", good wrong answers are
"relentless", "resilient", "restless".

WORDS:
${list}

Reply with:
{"items":[{"headword":"","definition":"","distractors":["","",""]}]}`;
}

export const GAP_SYSTEM = `You write gap-fill sentences for vocabulary tests.
${AUDIENCE}
You reply with JSON only, no prose and no code fences.`;

export function gapUser(
  items: Array<{ headword: string; translationDe: string; context?: string | null }>,
): string {
  const list = items
    .map(
      (item, i) =>
        `${i + 1}. "${item.headword}" (German: ${item.translationDe})${item.context ? ` — appeared in: "${item.context}"` : ''}`,
    )
    .join('\n');

  return `For each word below, write one natural English sentence with the word removed and replaced
by exactly one gap written as ${BLANK}.

Rules:
  - The sentence must make the missing word the ONLY sensible answer. Give enough context that a
    student who knows the word can fill it, and one who does not cannot guess it from grammar alone.
  - Never define or translate the word inside the sentence — that gives the answer away.
  - Keep it to one sentence of about 8-16 words, at the level of a school textbook.
  - Use exactly one ${BLANK}. Do not put the word anywhere else in the sentence.
  - Put the inflected form the gap needs in "accepted" — if the sentence needs "slammed", accept
    "slammed". Include any other form that would be correct there.

WORDS:
${list}

Reply with:
{"items":[{"headword":"","sentence":"","accepted":[""]}]}`;
}

export const TRANSCRIBE_SYSTEM = `You read text out of images of printed pages.
You reply with JSON only, no prose and no code fences.`;

export const TRANSCRIBE_USER = `Transcribe all the readable text in the image or images, in reading order.

Keep paragraph breaks. Do not translate, summarise, correct spelling, or add commentary. If part is
unreadable, leave it out rather than guessing. Exercise numbers and captions can be left out.

Reply with: {"text":""}`;
