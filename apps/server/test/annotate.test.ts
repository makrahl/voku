import { describe, expect, it } from 'vitest';
import {
  annotateText,
  plainText,
  unmatchedWords,
  type AnnotatableWord,
  type TextBlock,
} from '../src/services/annotate.js';

const word = (id: string, en: string, de: string): AnnotatableWord => ({
  id,
  headwordEn: en,
  translationDe: de,
});

/** All text, as the reader would see it. */
const rendered = (blocks: TextBlock[]) =>
  blocks.map((b) => b.segments.map((s) => s.text).join('')).join('\n\n');

/** The marked-up words, in order. */
const marked = (blocks: TextBlock[]) =>
  blocks.flatMap((b) => b.segments.filter((s) => s.wordId).map((s) => s.text));

describe('markdown', () => {
  it('reads headings at three levels', () => {
    const blocks = annotateText('# Title\n\n## Sub\n\n### Small\n\nBody text.', []);
    expect(blocks.map((b) => [b.type, b.level])).toEqual([
      ['heading', 1],
      ['heading', 2],
      ['heading', 3],
      ['paragraph', undefined],
    ]);
    expect(blocks[0]!.segments[0]!.text).toBe('Title');
  });

  it('marks bold and italic, and removes the markers', () => {
    const blocks = annotateText('A **bold** and an *italic* word.', []);
    expect(rendered(blocks)).toBe('A bold and an italic word.');

    const bold = blocks[0]!.segments.find((s) => s.marks?.includes('bold'));
    const italic = blocks[0]!.segments.find((s) => s.marks?.includes('italic'));
    expect(bold?.text).toBe('bold');
    expect(italic?.text).toBe('italic');
  });

  it('accepts underscores as well as asterisks', () => {
    const blocks = annotateText('__strong__ and _slanted_.', []);
    expect(rendered(blocks)).toBe('strong and slanted.');
    expect(blocks[0]!.segments.find((s) => s.text === 'strong')?.marks).toEqual(['bold']);
    expect(blocks[0]!.segments.find((s) => s.text === 'slanted')?.marks).toEqual(['italic']);
  });

  it('handles bold inside italic', () => {
    const blocks = annotateText('*very **strong** indeed*', []);
    expect(rendered(blocks)).toBe('very strong indeed');
    const inner = blocks[0]!.segments.find((s) => s.text === 'strong');
    expect(inner?.marks?.sort()).toEqual(['bold', 'italic']);
  });

  it('leaves an unclosed marker as literal text', () => {
    expect(rendered(annotateText('2 * 3 = 6 and 4 * 5 = 20', []))).toBe('2 * 3 = 6 and 4 * 5 = 20');
    expect(rendered(annotateText('an **unclosed run', []))).toBe('an **unclosed run');
  });

  it('joins wrapped lines into one paragraph and splits on blank lines', () => {
    const blocks = annotateText('One line\nand its continuation.\n\nA second paragraph.', []);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.segments[0]!.text).toBe('One line and its continuation.');
  });

  it('strips markers for anything that should not see them', () => {
    expect(plainText('# Title\n\nA **bold** word.')).toBe('Title\n\nA bold word.');
  });
});

describe('marking the trained words', () => {
  it('marks a word and carries its translation', () => {
    const blocks = annotateText('She was reluctant.', [word('w1', 'reluctant', 'widerwillig')]);
    expect(marked(blocks)).toEqual(['reluctant']);
    expect(blocks[0]!.segments.find((s) => s.wordId)).toMatchObject({
      translationDe: 'widerwillig',
    });
  });

  it('matches the inflected form the text uses', () => {
    const blocks = annotateText('He attempted it, lingering by the gate.', [
      word('w1', 'attempt', 'versuchen'),
      word('w2', 'linger', 'verweilen'),
    ]);
    expect(marked(blocks)).toEqual(['attempted', 'lingering']);
  });

  it('handles a doubled consonant and a dropped e', () => {
    expect(marked(annotateText('She slammed it.', [word('w1', 'slam', 'x')]))).toEqual(['slammed']);
    expect(marked(annotateText('He is coming.', [word('w1', 'come', 'x')]))).toEqual(['coming']);
  });

  it('keeps the casing of the text', () => {
    expect(marked(annotateText('Reluctant people wait.', [word('w1', 'reluctant', 'x')]))).toEqual([
      'Reluctant',
    ]);
  });

  it('does not match inside a longer word', () => {
    expect(marked(annotateText('The scarf was red.', [word('w1', 'scar', 'x')]))).toEqual([]);
  });

  it('prefers a longer phrase over one of its parts', () => {
    const blocks = annotateText('They had long since gone.', [
      word('w1', 'long', 'lang'),
      word('w2', 'long since', 'längst'),
    ]);
    expect(marked(blocks)).toEqual(['long since']);
  });

  it('does not mark words inside a heading', () => {
    const blocks = annotateText('# The bridge\n\nThe bridge was old.', [
      word('w1', 'bridge', 'Brücke'),
    ]);
    expect(marked(blocks)).toEqual(['bridge']);
    expect(blocks[0]!.segments.every((s) => !s.wordId)).toBe(true);
  });
});

describe('formatting and marking together', () => {
  it('lets a word be bold and trained at once', () => {
    const blocks = annotateText('The **bridge** stood.', [word('w1', 'bridge', 'Brücke')]);

    expect(rendered(blocks)).toBe('The bridge stood.');
    const seg = blocks[0]!.segments.find((s) => s.wordId);
    expect(seg).toMatchObject({ text: 'bridge', translationDe: 'Brücke' });
    expect(seg?.marks).toEqual(['bold']);
  });

  it('splits a run where formatting covers only part of a word', () => {
    const blocks = annotateText('The **bri**dge stood.', [word('w1', 'bridge', 'Brücke')]);
    expect(rendered(blocks)).toBe('The bridge stood.');

    const parts = blocks[0]!.segments.filter((s) => s.wordId);
    expect(parts.map((s) => s.text)).toEqual(['bri', 'dge']);
    expect(parts[0]!.marks).toEqual(['bold']);
    expect(parts[1]!.marks).toBeUndefined();
  });

  it('finds a word even when a marker sits inside it', () => {
    // "**bridge**" must still match; the markers are gone before matching.
    expect(marked(annotateText('a **bridge** here', [word('w1', 'bridge', 'x')]))).toEqual([
      'bridge',
    ]);
  });

  it('rebuilds the text exactly, whatever it contains', () => {
    const source = 'Costs $5 (roughly) — the merchant\'s "bridge", he said.';
    const blocks = annotateText(source, [word('w1', 'merchant', 'Händler')]);
    expect(rendered(blocks)).toBe(source);
  });

  it('handles an empty text and an empty word list', () => {
    expect(annotateText('', [word('w1', 'a', 'b')])).toEqual([]);
    expect(annotateText('   \n\n  ', [])).toEqual([]);
    expect(rendered(annotateText('Some text.', []))).toBe('Some text.');
  });
});

describe('unmatchedWords', () => {
  it('reports words the text never uses', () => {
    const words = [word('w1', 'bridge', 'Brücke'), word('w2', 'ambush', 'Hinterhalt')];
    const blocks = annotateText('The bridge stood.', words);
    expect(unmatchedWords(blocks, words).map((w) => w.headwordEn)).toEqual(['ambush']);
  });

  it('is empty when everything was found', () => {
    const words = [word('w1', 'bridge', 'x')];
    expect(unmatchedWords(annotateText('The bridge.', words), words)).toEqual([]);
  });
});
