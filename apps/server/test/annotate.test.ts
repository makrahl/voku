import { describe, expect, it } from 'vitest';
import { annotateText, unmatchedWords, type AnnotatableWord } from '../src/services/annotate.js';

const word = (id: string, en: string, de: string): AnnotatableWord => ({
  id,
  headwordEn: en,
  translationDe: de,
});

/** The marked runs, in order. */
const marked = (segments: ReturnType<typeof annotateText>) =>
  segments.filter((s) => s.wordId).map((s) => s.text);

describe('annotateText', () => {
  it('marks a word where it appears and leaves the rest alone', () => {
    const segments = annotateText('She was reluctant to answer.', [
      word('w1', 'reluctant', 'widerwillig'),
    ]);

    expect(segments.map((s) => s.text).join('')).toBe('She was reluctant to answer.');
    expect(marked(segments)).toEqual(['reluctant']);
    expect(segments.find((s) => s.wordId)).toMatchObject({ translationDe: 'widerwillig' });
  });

  it('matches the inflected form the text actually uses', () => {
    const segments = annotateText('He attempted it, lingering by the sturdy gate.', [
      word('w1', 'attempt', 'versuchen'),
      word('w2', 'linger', 'verweilen'),
      word('w3', 'sturdy', 'robust'),
    ]);
    expect(marked(segments)).toEqual(['attempted', 'lingering', 'sturdy']);
  });

  it('handles a doubled consonant', () => {
    expect(marked(annotateText('She slammed the door.', [word('w1', 'slam', 'zuschlagen')]))).toEqual([
      'slammed',
    ]);
  });

  it('marks every occurrence', () => {
    const segments = annotateText('The bridge, and the other bridge.', [
      word('w1', 'bridge', 'Brücke'),
    ]);
    expect(marked(segments)).toEqual(['bridge', 'bridge']);
  });

  it('keeps the original casing of the text', () => {
    expect(marked(annotateText('Reluctant people wait.', [word('w1', 'reluctant', 'x')]))).toEqual([
      'Reluctant',
    ]);
  });

  it('does not match inside a longer word', () => {
    expect(marked(annotateText('The scarf was red.', [word('w1', 'scar', 'Narbe')]))).toEqual([]);
  });

  it('matches a multi-word entry', () => {
    expect(
      marked(annotateText('They had long since gone.', [word('w1', 'long since', 'längst')])),
    ).toEqual(['long since']);
  });

  it('gives a longer phrase precedence over one of its parts', () => {
    const segments = annotateText('They had long since gone.', [
      word('w1', 'long', 'lang'),
      word('w2', 'long since', 'längst'),
    ]);
    expect(marked(segments)).toEqual(['long since']);
  });

  it('never overlaps two marks', () => {
    const segments = annotateText('a thorough thoroughly thorough test', [
      word('w1', 'thorough', 'gründlich'),
    ]);
    let cursor = 0;
    for (const s of segments) cursor += s.text.length;
    expect(cursor).toBe('a thorough thoroughly thorough test'.length);
  });

  it('rebuilds the text exactly, whatever it contains', () => {
    const text = 'Costs $5 (roughly) — the merchant\'s "bridge", he said.\n\nNew paragraph.';
    const segments = annotateText(text, [
      word('w1', 'merchant', 'Händler'),
      word('w2', 'bridge', 'Brücke'),
    ]);
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });

  it('survives a headword with regex characters', () => {
    expect(() => annotateText('a (b) c', [word('w1', 'a.b*c', 'x')])).not.toThrow();
  });

  it('handles an empty text and an empty word list', () => {
    expect(annotateText('', [word('w1', 'a', 'b')])).toEqual([]);
    expect(annotateText('Some text.', [])).toEqual([{ text: 'Some text.' }]);
  });
});

describe('unmatchedWords', () => {
  it('reports words the text never uses', () => {
    const words = [word('w1', 'bridge', 'Brücke'), word('w2', 'ambush', 'Hinterhalt')];
    const segments = annotateText('The bridge stood.', words);

    expect(unmatchedWords(segments, words).map((w) => w.headwordEn)).toEqual(['ambush']);
  });

  it('is empty when everything was found', () => {
    const words = [word('w1', 'bridge', 'Brücke')];
    expect(unmatchedWords(annotateText('The bridge.', words), words)).toEqual([]);
  });
});
