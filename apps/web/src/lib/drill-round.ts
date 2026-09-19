/**
 * The order of one practice round.
 *
 * A missed word comes back a few cards later rather than at the very end —
 * Leitner in miniature: a short gap while the miss is still fresh. It comes back
 * first as a choice and then, once recognised, typed again, because recognising
 * comes before producing and the second attempt should be one they can win.
 *
 * Kept free of React and of the network so the rules can be read and tested on
 * their own. Nothing here is stored anywhere; the round ends with the tab.
 */

export type DrillMode = 'typed' | 'choice';

export interface Card {
  wordId: string;
  mode: DrillMode;
}

/** How a word finished the round. */
export type Outcome =
  /** Typed correctly at the first attempt. */
  | 'first'
  /** Needed another go, but typed it correctly in the end. */
  | 'recovered'
  /** Ran out of attempts without typing it. */
  | 'missed';

export interface Round {
  cards: Card[];
  /** Index of the card being asked now; equal to `cards.length` once finished. */
  at: number;
  /** How many times each word has been asked so far this round. */
  seen: Record<string, number>;
  /** Set once a word is finished with; absent while it is still in play. */
  outcome: Record<string, Outcome>;
  /** How many different words the round started with. */
  total: number;
}

/** Cards between a miss and its return: long enough to be a gap, short enough to stay fresh. */
export const RETURN_AFTER = 3;

/**
 * Most times one word is asked in a round. Without a ceiling a word someone
 * cannot get would come round for ever and the round would never end.
 */
export const MAX_ASKS = 4;

export function startRound(wordIds: string[]): Round {
  return {
    cards: wordIds.map((wordId) => ({ wordId, mode: 'typed' })),
    at: 0,
    seen: {},
    outcome: {},
    total: new Set(wordIds).size,
  };
}

export function current(round: Round): Card | undefined {
  return round.cards[round.at];
}

export function isOver(round: Round): boolean {
  return round.at >= round.cards.length;
}

/** Words finished with, of the round's total — the count shown in the header. */
export function done(round: Round): number {
  return Object.keys(round.outcome).length;
}

/** True when this card is a word coming back after a miss, rather than its first outing. */
export function isReturn(round: Round, card: Card): boolean {
  return (round.seen[card.wordId] ?? 0) > 0;
}

/**
 * Records an answer to the current card and moves on.
 *
 * `askedAs` is how the card was actually put to the student. A choice card can
 * fall back to typing when no fair choice could be built, and then it must be
 * judged as the typing it was.
 */
export function answer(round: Round, correct: boolean, askedAs?: DrillMode): Round {
  const card = current(round);
  if (!card) return round;

  const mode = askedAs ?? card.mode;
  const asks = (round.seen[card.wordId] ?? 0) + 1;
  const seen = { ...round.seen, [card.wordId]: asks };
  const outcome = { ...round.outcome };
  const canComeBack = asks < MAX_ASKS;
  let next: Card | null = null;

  if (mode === 'typed') {
    if (correct) outcome[card.wordId] = asks === 1 ? 'first' : 'recovered';
    else if (canComeBack) next = { wordId: card.wordId, mode: 'choice' };
    else outcome[card.wordId] = 'missed';
  } else if (correct && canComeBack) {
    // Recognised it. Now produce it: typing is what the test will ask for.
    next = { wordId: card.wordId, mode: 'typed' };
  } else if (!correct && canComeBack) {
    next = { wordId: card.wordId, mode: 'choice' };
  } else {
    // Out of asks. Picking it from four is not the same as knowing it.
    outcome[card.wordId] = 'missed';
  }

  const cards = next ? insertAt(round.cards, round.at + 1 + RETURN_AFTER, next) : round.cards;
  return { ...round, cards, at: round.at + 1, seen, outcome };
}

/** Words that were not right first time — the ones worth a round of their own. */
export function neededAnotherGo(round: Round): string[] {
  return Object.entries(round.outcome)
    .filter(([, result]) => result !== 'first')
    .map(([wordId]) => wordId);
}

export function tally(round: Round): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { first: 0, recovered: 0, missed: 0 };
  for (const result of Object.values(round.outcome)) counts[result] += 1;
  return counts;
}

function insertAt<T>(items: T[], index: number, item: T): T[] {
  const at = Math.min(index, items.length);
  return [...items.slice(0, at), item, ...items.slice(at)];
}
