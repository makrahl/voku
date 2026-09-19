import { describe, expect, it } from 'vitest';
import {
  MAX_ASKS,
  RETURN_AFTER,
  answer,
  current,
  done,
  isOver,
  isReturn,
  neededAnotherGo,
  startRound,
  tally,
  type Round,
} from '../src/lib/drill-round.ts';

const WORDS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Answers every remaining card correctly, to finish a round off. */
function finish(round: Round): Round {
  let r = round;
  while (!isOver(r)) r = answer(r, true);
  return r;
}

describe('one practice round', () => {
  it('asks every word once, typed, when nothing is missed', () => {
    const round = finish(startRound(WORDS));
    expect(round.cards).toHaveLength(WORDS.length);
    expect(round.cards.every((card) => card.mode === 'typed')).toBe(true);
    expect(tally(round)).toEqual({ first: 6, recovered: 0, missed: 0 });
  });

  // Leitner in miniature: a short gap while the miss is still fresh, not the
  // whole list's length.
  it('brings a missed word back a few cards later, not at the end of the round', () => {
    const round = answer(startRound(WORDS), false);
    const returned = round.cards.findIndex((card, i) => i > 0 && card.wordId === 'a');

    expect(returned).toBe(1 + RETURN_AFTER);
    expect(returned).toBeLessThan(round.cards.length - 1);
  });

  // Recognising comes before producing: the second attempt should be winnable.
  it('offers a missed word back as a choice first', () => {
    const round = answer(startRound(WORDS), false);
    expect(round.cards[1 + RETURN_AFTER]).toEqual({ wordId: 'a', mode: 'choice' });
  });

  it('asks for it typed again once it has been picked correctly', () => {
    let round = answer(startRound(WORDS), false); // a: typed, wrong
    while (current(round)!.wordId !== 'a') round = answer(round, true);
    expect(current(round)!.mode).toBe('choice');

    round = answer(round, true); // a: chosen correctly
    const next = round.cards.slice(round.at).find((card) => card.wordId === 'a');
    expect(next).toEqual({ wordId: 'a', mode: 'typed' });
  });

  it('counts a word typed correctly after help as recovered, not as first time', () => {
    let round = answer(startRound(['a']), false); // typed wrong
    round = answer(round, true); // choice right
    round = answer(round, true); // typed right

    expect(isOver(round)).toBe(true);
    expect(round.outcome.a).toBe('recovered');
  });

  it('knows a card is a word coming back rather than a first outing', () => {
    let round = answer(startRound(['a', 'b']), false);
    expect(isReturn(round, current(round)!)).toBe(false); // b, first time
    round = answer(round, true);
    expect(isReturn(round, current(round)!)).toBe(true); // a, back again
  });

  // Without a ceiling a word someone cannot get would come round for ever.
  it('gives up on a word after a fixed number of asks, and the round ends', () => {
    let round = startRound(['a']);
    let asks = 0;
    while (!isOver(round)) {
      round = answer(round, false);
      asks += 1;
    }
    expect(asks).toBe(MAX_ASKS);
    expect(round.outcome.a).toBe('missed');
  });

  // Picking it from four is not the same as knowing it.
  it('does not count a word as learned on a choice alone', () => {
    let round = startRound(['a']);
    round = answer(round, false); // typed wrong
    round = answer(round, false); // choice wrong
    round = answer(round, false); // choice wrong
    round = answer(round, true); // choice right, but out of asks
    expect(isOver(round)).toBe(true);
    expect(round.outcome.a).toBe('missed');
  });

  // When no fair choice can be built the card is asked as typing, and must be
  // judged as typing — otherwise a correct answer would be sent round again.
  it('judges a choice card that fell back to typing as typing', () => {
    let round = answer(startRound(['a']), false);
    expect(current(round)!.mode).toBe('choice');
    round = answer(round, true, 'typed');

    expect(isOver(round)).toBe(true);
    expect(round.outcome.a).toBe('recovered');
  });

  it('brings a miss near the end back at the end rather than dropping it', () => {
    let round = startRound(WORDS);
    for (let i = 0; i < WORDS.length - 1; i++) round = answer(round, true);
    round = answer(round, false); // the last word, missed

    expect(isOver(round)).toBe(false);
    expect(current(round)).toEqual({ wordId: 'f', mode: 'choice' });
  });

  it('counts progress in words, not cards, so the total does not jump when one comes back', () => {
    let round = answer(startRound(WORDS), false);
    expect(round.total).toBe(6);
    expect(done(round)).toBe(0);

    round = finish(round);
    expect(done(round)).toBe(6);
    expect(round.cards.length).toBeGreaterThan(6);
  });

  it('offers a round of just the words that needed another go', () => {
    let round = startRound(['a', 'b', 'c']);
    round = answer(round, true); // a first time
    round = answer(round, false); // b missed
    round = finish(round);

    expect(neededAnotherGo(round)).toEqual(['b']);
  });
});
