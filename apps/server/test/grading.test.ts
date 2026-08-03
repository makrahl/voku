import { describe, expect, it } from 'vitest';
import { BLANK, type QuestionPayload } from '@voku/shared';
import { editDistance, gradeAnswer, isAlmost, normalise } from '../src/services/grading.js';

describe('normalise', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normalise('  Reluctant  ')).toBe('reluctant');
  });

  it('collapses runs of whitespace', () => {
    expect(normalise('give   up')).toBe('give up');
  });

  it('drops the English infinitive marker', () => {
    expect(normalise('to receive')).toBe('receive');
  });

  it('drops German and English articles', () => {
    expect(normalise('der Hinterhalt')).toBe('hinterhalt');
    expect(normalise('das Hindernis')).toBe('hindernis');
    expect(normalise('the obstacle')).toBe('obstacle');
  });

  it('drops the reflexive "sich"', () => {
    expect(normalise('sich erinnern')).toBe('erinnern');
  });

  it('strips punctuation at the ends but keeps it inside a word', () => {
    expect(normalise('"reluctant."')).toBe('reluctant');
    expect(normalise('well-being')).toBe('well-being');
  });

  it('normalises curly apostrophes typed by an iPad', () => {
    expect(normalise('don’t')).toBe(normalise("don't"));
  });

  it('leaves German umlauts and ß alone — they are not decoration', () => {
    expect(normalise('gründlich')).toBe('gründlich');
    expect(normalise('Fleiß')).toBe('fleiß');
  });
});

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('receive', 'receive')).toBe(0);
  });

  it('counts an adjacent transposition as one, not two', () => {
    // The whole reason for optimal string alignment over plain Levenshtein.
    expect(editDistance('recieve', 'receive')).toBe(1);
  });

  it('counts a single substitution, insertion or deletion as one', () => {
    expect(editDistance('thorough', 'thoroagh')).toBe(1);
    expect(editDistance('thorough', 'thorrough')).toBe(1);
    expect(editDistance('thorough', 'thorogh')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });
});

describe('isAlmost', () => {
  it('fires for a one-slip miss on a long word', () => {
    expect(isAlmost('recieve', 'receive')).toBe(true);
    expect(isAlmost('nevertheles', 'nevertheless')).toBe(true);
  });

  it('does not fire for a correct answer', () => {
    expect(isAlmost('receive', 'receive')).toBe(false);
  });

  it('does not fire on short words, where one letter means a different word', () => {
    expect(isAlmost('cat', 'car')).toBe(false);
    expect(isAlmost('kaum', 'raum')).toBe(false);
  });

  it('does fire once the word is long enough, even for a real other word', () => {
    // "wary" is a word in its own right, but the hint only changes the wording
    // of the feedback — the answer is still marked wrong — so pointing at the
    // missing letter helps more than a bare red flash.
    expect(isAlmost('wary', 'weary')).toBe(true);
  });

  it('does not fire when the answer is simply wrong', () => {
    expect(isAlmost('gründlich', 'widerwillig')).toBe(false);
  });

  it('does not fire for an empty answer', () => {
    expect(isAlmost('', 'receive')).toBe(false);
  });
});

const typed: QuestionPayload = {
  type: 'translate_input',
  direction: 'de_en',
  prompt: 'widerwillig',
  accepted: ['reluctant', 'unwilling'],
};

const mcq: QuestionPayload = {
  type: 'mcq_translation',
  direction: 'en_de',
  prompt: 'eventually',
  options: ['eventuell', 'schließlich', 'ereignisreich', 'gleichmäßig'],
  correctIndex: 1,
};

const gap: QuestionPayload = {
  type: 'fill_blank',
  sentence: `She gave the room a ${BLANK} cleaning.`,
  accepted: ['thorough'],
};

describe('gradeAnswer', () => {
  it('accepts any of the alternatives, in any case', () => {
    expect(gradeAnswer(typed, 'reluctant').correct).toBe(true);
    expect(gradeAnswer(typed, 'UNWILLING').correct).toBe(true);
    expect(gradeAnswer(typed, '  to reluctant  ').correct).toBe(true);
  });

  it('marks a near miss wrong but flags it, and shows the correct form', () => {
    const grade = gradeAnswer(gap, 'thorogh');
    expect(grade.correct).toBe(false);
    expect(grade.almost).toBe(true);
    expect(grade.correctAnswer).toBe('thorough');
  });

  it('marks a plainly wrong answer wrong without flagging it', () => {
    const grade = gradeAnswer(typed, 'thorough');
    expect(grade).toMatchObject({ correct: false, almost: false });
  });

  it('treats an empty answer as wrong, not almost', () => {
    expect(gradeAnswer(typed, '   ')).toMatchObject({ correct: false, almost: false });
  });

  it('grades multiple choice by index', () => {
    expect(gradeAnswer(mcq, '1').correct).toBe(true);
    expect(gradeAnswer(mcq, '0').correct).toBe(false);
  });

  it('reports the chosen option text as the correct answer for feedback', () => {
    expect(gradeAnswer(mcq, '0').correctAnswer).toBe('schließlich');
  });

  it('never marks multiple choice "almost" — there is no such thing', () => {
    expect(gradeAnswer(mcq, '0').almost).toBe(false);
  });

  it('rejects a non-numeric multiple-choice answer instead of crashing', () => {
    expect(gradeAnswer(mcq, 'schließlich').correct).toBe(false);
    expect(gradeAnswer(mcq, '').correct).toBe(false);
    expect(gradeAnswer(mcq, '99').correct).toBe(false);
  });

  it('is strict about spelling — this is the decision, stated as a test', () => {
    expect(gradeAnswer(gap, 'thorogh').correct).toBe(false);
    expect(gradeAnswer(typed, 'reluctent').correct).toBe(false);
  });
});
