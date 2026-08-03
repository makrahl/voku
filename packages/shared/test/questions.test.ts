import { describe, expect, it } from 'vitest';
import {
  BLANK,
  QuestionPayloadSchema,
  acceptedAnswers,
  correctAnswerText,
  stripAnswer,
  type QuestionPayload,
} from '@voku/shared';

const translate: QuestionPayload = {
  type: 'translate_input',
  direction: 'de_en',
  prompt: 'widerwillig',
  accepted: ['reluctant', 'unwilling'],
};

const mcqTranslation: QuestionPayload = {
  type: 'mcq_translation',
  direction: 'en_de',
  prompt: 'eventually',
  options: ['schließlich', 'eventuell', 'ereignisreich', 'gleichmäßig'],
  correctIndex: 0,
};

const mcqDefinition: QuestionPayload = {
  type: 'mcq_definition',
  definition: 'unwilling to do something, and slow to begin',
  options: ['reluctant', 'relentless', 'resilient', 'restless'],
  correctIndex: 0,
};

const fillBlank: QuestionPayload = {
  type: 'fill_blank',
  sentence: `Despite the interruption, she gave the room a ${BLANK} cleaning.`,
  accepted: ['thorough'],
  hint: 'gründlich',
};

const ALL = [translate, mcqTranslation, mcqDefinition, fillBlank];

describe('stripAnswer', () => {
  it.each(ALL)('removes every answer-bearing field from $type', (payload) => {
    const stripped = stripAnswer(payload) as Record<string, unknown>;
    expect(stripped).not.toHaveProperty('accepted');
    expect(stripped).not.toHaveProperty('correctIndex');
  });

  it('keeps the fields the student needs to answer', () => {
    expect(stripAnswer(mcqTranslation)).toEqual({
      type: 'mcq_translation',
      direction: 'en_de',
      prompt: 'eventually',
      options: ['schließlich', 'eventuell', 'ereignisreich', 'gleichmäßig'],
    });
    expect(stripAnswer(fillBlank)).toEqual({
      type: 'fill_blank',
      sentence: `Despite the interruption, she gave the room a ${BLANK} cleaning.`,
      hint: 'gründlich',
    });
  });

  it('never leaks the correct option text through the surviving fields', () => {
    // The options array must still be present, but nothing may indicate which is right.
    const stripped = stripAnswer(mcqDefinition) as { options: string[] };
    expect(stripped.options).toHaveLength(4);
    expect(JSON.stringify(stripped)).not.toContain('correctIndex');
  });
});

describe('correctAnswerText', () => {
  it('returns the canonical accepted answer for typed formats', () => {
    expect(correctAnswerText(translate)).toBe('reluctant');
    expect(correctAnswerText(fillBlank)).toBe('thorough');
  });

  it('resolves the option at correctIndex for multiple choice', () => {
    expect(correctAnswerText(mcqTranslation)).toBe('schließlich');
    expect(correctAnswerText({ ...mcqDefinition, correctIndex: 2 })).toBe('resilient');
  });
});

describe('acceptedAnswers', () => {
  it('is null for multiple choice and a list for typed formats', () => {
    expect(acceptedAnswers(mcqTranslation)).toBeNull();
    expect(acceptedAnswers(translate)).toEqual(['reluctant', 'unwilling']);
  });
});

describe('QuestionPayloadSchema', () => {
  it.each(ALL)('accepts a well-formed $type', (payload) => {
    expect(QuestionPayloadSchema.parse(payload)).toMatchObject({ type: payload.type });
  });

  it('rejects a correctIndex past the end of the options', () => {
    const r = QuestionPayloadSchema.safeParse({ ...mcqTranslation, correctIndex: 4 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain('out of range');
  });

  it('rejects duplicated options, which would make the question unanswerable', () => {
    const r = QuestionPayloadSchema.safeParse({
      ...mcqDefinition,
      options: ['reluctant', 'Reluctant', 'resilient', 'restless'],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain('distinct');
  });

  it('rejects a fill-blank sentence without exactly one blank', () => {
    expect(QuestionPayloadSchema.safeParse({ ...fillBlank, sentence: 'No gap here.' }).success).toBe(false);
    expect(
      QuestionPayloadSchema.safeParse({ ...fillBlank, sentence: `A ${BLANK} and a ${BLANK}.` }).success,
    ).toBe(false);
  });

  it('rejects an empty accepted list', () => {
    expect(QuestionPayloadSchema.safeParse({ ...translate, accepted: [] }).success).toBe(false);
  });
});
