import { describe, expect, it } from 'vitest';
import type { MixWeights } from '@voku/shared';
import {
  MIN_DIFFICULTY_FOR_DEFINITION,
  MIN_DIFFICULTY_FOR_MCQ,
  MIN_TRICKINESS_FOR_MCQ,
  assignFormats,
  type AssignableWord,
} from '../src/services/assign.js';

function word(id: string, over: Partial<AssignableWord> = {}): AssignableWord {
  return {
    id,
    difficulty: 5,
    trickiness: 0,
    suitsFillBlank: true,
    suitsDefinitionMcq: true,
    ...over,
  };
}

const evenMix: MixWeights = {
  translate_input: 25,
  mcq_translation: 25,
  mcq_definition: 25,
  fill_blank: 25,
};

const typedOnly: MixWeights = {
  translate_input: 100,
  mcq_translation: 0,
  mcq_definition: 0,
  fill_blank: 0,
};

function typeOf(result: ReturnType<typeof assignFormats>, id: string) {
  return result.assignments.find((a) => a.wordId === id)?.type;
}

describe('assignFormats', () => {
  it('gives every word exactly one question', () => {
    const words = Array.from({ length: 40 }, (_, i) => word(`w${i}`));
    const { assignments, report } = assignFormats(words, evenMix);

    expect(assignments).toHaveLength(40);
    expect(new Set(assignments.map((a) => a.wordId)).size).toBe(40);
    expect(report.total).toBe(40);
    expect(Object.values(report.achieved).reduce((a, b) => a + b, 0)).toBe(40);
  });

  it('handles an empty word list', () => {
    const { assignments, report } = assignFormats([], evenMix);
    expect(assignments).toEqual([]);
    expect(report.total).toBe(0);
    expect(report.shortfalls).toEqual([]);
  });

  describe('multiple choice is reserved for traps', () => {
    it('never gives MCQ-translation to a word that is neither tricky nor hard', () => {
      const words = Array.from({ length: 20 }, (_, i) =>
        word(`w${i}`, { trickiness: 0, difficulty: MIN_DIFFICULTY_FOR_MCQ - 1 }),
      );
      const { assignments, report } = assignFormats(words, evenMix);

      expect(assignments.every((a) => a.type !== 'mcq_translation')).toBe(true);
      expect(report.achieved.mcq_translation).toBe(0);
    });

    it('lets a hard word earn multiple choice even when nothing about it is tricky', () => {
      // The brief was "false friends AND difficult words" — difficulty qualifies
      // on its own, which is what makes the format usable from a pasted list
      // where no trickiness data exists.
      const words = [
        word('hard', { trickiness: 0, difficulty: MIN_DIFFICULTY_FOR_MCQ }),
        ...Array.from({ length: 3 }, (_, i) =>
          word(`easy${i}`, { trickiness: 0, difficulty: MIN_DIFFICULTY_FOR_MCQ - 1 }),
        ),
      ];
      const result = assignFormats(words, {
        translate_input: 75,
        mcq_translation: 25,
        mcq_definition: 0,
        fill_blank: 0,
      });
      expect(typeOf(result, 'hard')).toBe('mcq_translation');
    });

    it('still prefers a trap over a merely hard word when slots are scarce', () => {
      const words = [
        word('trap', { trickiness: 3, difficulty: 3 }),
        word('hard', { trickiness: 0, difficulty: 10 }),
        word('plain-a', { trickiness: 0, difficulty: 2 }),
        word('plain-b', { trickiness: 0, difficulty: 2 }),
      ];
      const result = assignFormats(words, {
        translate_input: 75,
        mcq_translation: 25,
        mcq_definition: 0,
        fill_blank: 0,
      });
      expect(typeOf(result, 'trap')).toBe('mcq_translation');
      expect(typeOf(result, 'hard')).not.toBe('mcq_translation');
    });

    it('prefers the trickiest words for the MCQ slots it does have', () => {
      const words = [
        word('plain-a', { trickiness: 0, difficulty: 3 }),
        word('trap-strong', { trickiness: 3, difficulty: 3 }),
        word('plain-b', { trickiness: 0, difficulty: 3 }),
        word('trap-weak', { trickiness: MIN_TRICKINESS_FOR_MCQ, difficulty: 3 }),
      ];
      // One MCQ slot out of four words.
      const result = assignFormats(words, {
        translate_input: 75,
        mcq_translation: 25,
        mcq_definition: 0,
        fill_blank: 0,
      });

      expect(typeOf(result, 'trap-strong')).toBe('mcq_translation');
      expect(typeOf(result, 'trap-weak')).not.toBe('mcq_translation');
    });

    it('reports a shortfall rather than inventing traps that are not there', () => {
      const words = [
        word('trap', { trickiness: 3, difficulty: 3 }),
        ...Array.from({ length: 9 }, (_, i) =>
          word(`plain${i}`, { trickiness: 0, difficulty: 3 }),
        ),
      ];
      const { report } = assignFormats(words, {
        translate_input: 0,
        mcq_translation: 100,
        mcq_definition: 0,
        fill_blank: 0,
      });

      expect(report.achieved.mcq_translation).toBe(1);
      const shortfall = report.shortfalls.find((s) => s.type === 'mcq_translation');
      expect(shortfall).toMatchObject({ wanted: 10, got: 1 });
      expect(shortfall?.reason).toContain('free guess');
      // The other nine still became questions.
      expect(report.achieved.translate_input).toBe(9);
    });
  });

  describe('definition MCQ needs a hard, definable word', () => {
    it('skips words that are too easy to be worth defining', () => {
      const words = Array.from({ length: 10 }, (_, i) =>
        word(`easy${i}`, { difficulty: MIN_DIFFICULTY_FOR_DEFINITION - 1, suitsDefinitionMcq: true }),
      );
      const { report } = assignFormats(words, {
        translate_input: 50,
        mcq_translation: 0,
        mcq_definition: 50,
        fill_blank: 0,
      });
      expect(report.achieved.mcq_definition).toBe(0);
    });

    it('skips words the extractor said cannot be defined, however hard they are', () => {
      const words = Array.from({ length: 10 }, (_, i) =>
        word(`hard${i}`, { difficulty: 10, suitsDefinitionMcq: false }),
      );
      const { report } = assignFormats(words, {
        translate_input: 50,
        mcq_translation: 0,
        mcq_definition: 50,
        fill_blank: 0,
      });
      expect(report.achieved.mcq_definition).toBe(0);
      expect(report.shortfalls.some((s) => s.type === 'mcq_definition')).toBe(true);
    });
  });

  it('only puts gap-suitable words in a gap sentence', () => {
    const words = [
      word('fits', { suitsFillBlank: true }),
      ...Array.from({ length: 5 }, (_, i) => word(`nofit${i}`, { suitsFillBlank: false })),
    ];
    const result = assignFormats(words, {
      translate_input: 50,
      mcq_translation: 0,
      mcq_definition: 0,
      fill_blank: 50,
    });

    const fillBlanks = result.assignments.filter((a) => a.type === 'fill_blank');
    expect(fillBlanks).toHaveLength(1);
    expect(fillBlanks[0]!.wordId).toBe('fits');
  });

  it('honours a typed-only mix exactly', () => {
    const words = Array.from({ length: 12 }, (_, i) => word(`w${i}`, { trickiness: 3, difficulty: 10 }));
    const { report } = assignFormats(words, typedOnly);

    expect(report.achieved.translate_input).toBe(12);
    expect(report.achieved.mcq_translation).toBe(0);
    expect(report.shortfalls).toEqual([]);
  });

  it('falls back to typed translation when no weights are given at all', () => {
    const words = Array.from({ length: 5 }, (_, i) => word(`w${i}`));
    const { report } = assignFormats(words, {
      translate_input: 0,
      mcq_translation: 0,
      mcq_definition: 0,
      fill_blank: 0,
    });
    expect(report.achieved.translate_input).toBe(5);
  });

  it('splits proportionally when every word is eligible for everything', () => {
    const words = Array.from({ length: 40 }, (_, i) =>
      word(`w${i}`, { trickiness: 3, difficulty: 10, suitsFillBlank: true, suitsDefinitionMcq: true }),
    );
    const { report } = assignFormats(words, evenMix);

    for (const type of ['translate_input', 'mcq_translation', 'mcq_definition', 'fill_blank'] as const) {
      expect(report.achieved[type]).toBe(10);
    }
    expect(report.shortfalls).toEqual([]);
  });

  it('rounds without losing or inventing a question', () => {
    // 7 words over a 3-way split cannot divide evenly.
    const words = Array.from({ length: 7 }, (_, i) => word(`w${i}`, { trickiness: 3, difficulty: 10 }));
    const { assignments, report } = assignFormats(words, {
      translate_input: 33,
      mcq_translation: 33,
      mcq_definition: 34,
      fill_blank: 0,
    });

    expect(assignments).toHaveLength(7);
    expect(Object.values(report.achieved).reduce((a, b) => a + b, 0)).toBe(7);
  });

  it('is deterministic — the same input always produces the same assignment', () => {
    const words = Array.from({ length: 30 }, (_, i) =>
      word(`w${i}`, { trickiness: i % 4, difficulty: (i % 10) + 1, suitsFillBlank: i % 2 === 0 }),
    );
    const first = assignFormats(words, evenMix);
    const second = assignFormats([...words].reverse(), evenMix);

    const sort = (r: typeof first) =>
      [...r.assignments].sort((a, b) => a.wordId.localeCompare(b.wordId));
    expect(sort(first)).toEqual(sort(second));
  });
});
