import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import { difficultyForPosition, parseWordPaste } from '../src/services/tests.js';

let server: TestServer;
let classId: string;

const GLOSSARY = [
  'reluctant;widerwillig',
  'thorough;gründlich',
  'scarcely;kaum',
  'ambush;Hinterhalt',
  'nevertheless;dennoch',
  'ruthless;rücksichtslos',
  'diligent;fleißig',
  'obstacle;Hindernis',
  'weary;müde',
  'vivid;lebhaft',
].join('\n');

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();
  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
});
afterEach(async () => {
  await server.stop();
});

async function makeTest(title = 'Unit 3') {
  return (await server.post('/api/admin/tests', { classId, title })).body.id as string;
}

async function withWords(count = 10) {
  const id = await makeTest();
  const lines = GLOSSARY.split('\n').slice(0, count).join('\n');
  await server.post(`/api/admin/tests/${id}/words/paste`, { text: lines });
  return id;
}

describe('parseWordPaste', () => {
  it('accepts semicolons, tabs, and spaced hyphens', () => {
    expect(parseWordPaste('reluctant;widerwillig\nthorough\tgründlich\nweary - müde')).toEqual([
      { en: 'reluctant', de: 'widerwillig' },
      { en: 'thorough', de: 'gründlich' },
      { en: 'weary', de: 'müde' },
    ]);
  });

  it('splits on the first separator, so a hyphenated translation survives', () => {
    expect(parseWordPaste('well-being;Wohl-befinden')).toEqual([
      { en: 'well-being', de: 'Wohl-befinden' },
    ]);
  });

  it('ignores blank and malformed lines rather than failing the whole paste', () => {
    expect(parseWordPaste('reluctant;widerwillig\n\nnoseparator\n   \nweary;müde')).toEqual([
      { en: 'reluctant', de: 'widerwillig' },
      { en: 'weary', de: 'müde' },
    ]);
  });

  it('keeps the first of a repeated English word', () => {
    expect(parseWordPaste('weary;müde\nWEARY;erschöpft')).toEqual([{ en: 'weary', de: 'müde' }]);
  });
});

describe('difficultyForPosition', () => {
  it('spreads paste order across the 1-10 scale', () => {
    expect(difficultyForPosition(0, 10)).toBe(1);
    expect(difficultyForPosition(9, 10)).toBe(10);
    expect(difficultyForPosition(0, 1)).toBe(5);
  });
});

describe('word list', () => {
  it('imports a pasted glossary in difficulty order', async () => {
    const id = await withWords();
    const words = (await server.get(`/api/admin/tests/${id}/words`)).body;

    expect(words).toHaveLength(10);
    // Listed hardest first for review.
    expect(words[0].difficulty).toBeGreaterThan(words[9].difficulty);
    expect(words.every((w: { included: boolean }) => w.included)).toBe(true);
  });

  it('rejects a paste with no usable pairs and says what the format is', async () => {
    const id = await makeTest();
    const res = await server.post(`/api/admin/tests/${id}/words/paste`, {
      text: 'just\nsome\nwords',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('semicolon');
  });

  it('keeps only the hardest N when a cutoff is applied', async () => {
    const id = await withWords();
    const res = await server.post(`/api/admin/tests/${id}/cutoff`, { keep: 4 });

    expect(res.body.kept).toBe(4);
    const included = res.body.words.filter((w: { included: boolean }) => w.included);
    expect(included).toHaveLength(4);
    // Everything kept is at least as hard as everything dropped.
    const dropped = res.body.words.filter((w: { included: boolean }) => !w.included);
    const minKept = Math.min(...included.map((w: { difficulty: number }) => w.difficulty));
    const maxDropped = Math.max(...dropped.map((w: { difficulty: number }) => w.difficulty));
    expect(minKept).toBeGreaterThanOrEqual(maxDropped);
  });

  it('edits a translation and its accepted alternatives', async () => {
    const id = await withWords(3);
    const word = (await server.get(`/api/admin/tests/${id}/words`)).body[0];

    const res = await server.patch(`/api/admin/tests/${id}/words/${word.id}`, {
      translationDe: 'zögerlich',
      acceptedEn: ['unwilling'],
    });
    expect(res.body.translationDe).toBe('zögerlich');
    expect(res.body.acceptedEn).toEqual(['unwilling']);
  });

  it('refuses to serve words from another teacher’s test', async () => {
    const id = await withWords(3);
    await server.signInAsTeacher('other@school.de', 'hunter2hunter2');
    expect((await server.get(`/api/admin/tests/${id}/words`)).status).toBe(404);
  });

  // The worksheet needs a definition and an example for every word, so both must
  // be writable by hand — a teacher with no model configured still gets a sheet.
  it('takes a definition and an example sentence typed by the teacher', async () => {
    const id = await withWords(3);
    const word = (await server.get(`/api/admin/tests/${id}/words`)).body[0];

    const res = await server.patch(`/api/admin/tests/${id}/words/${word.id}`, {
      definitionEn: 'not wanting to do something',
      contextSentence: 'She was reluctant to admit her mistake.',
    });
    expect(res.body.definitionEn).toBe('not wanting to do something');
    expect(res.body.contextSentence).toBe('She was reluctant to admit her mistake.');
  });

  it('clears a definition the teacher rejects rather than storing an empty one', async () => {
    const id = await withWords(3);
    const word = (await server.get(`/api/admin/tests/${id}/words`)).body[0];

    await server.patch(`/api/admin/tests/${id}/words/${word.id}`, { definitionEn: 'a bad one' });
    const res = await server.patch(`/api/admin/tests/${id}/words/${word.id}`, { definitionEn: '' });
    expect(res.body.definitionEn).toBeNull();
  });
});

describe('generating questions without a language model', () => {
  it('produces exactly one question per included word', async () => {
    const id = await withWords();
    const res = await server.post(`/api/admin/tests/${id}/generate`);

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(10);
    const wordIds = res.body.questions.map((q: { wordId: string }) => q.wordId);
    expect(new Set(wordIds).size).toBe(10);
  });

  it('orders questions from easiest to hardest, identically for everyone', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);

    const words = (await server.get(`/api/admin/tests/${id}/words`)).body;
    const byId = new Map(words.map((w: { id: string; difficulty: number }) => [w.id, w.difficulty]));
    const questions = (await server.get(`/api/admin/tests/${id}/questions`)).body.questions;

    const difficulties = questions.map((q: { wordId: string }) => byId.get(q.wordId) as number);
    expect(questions.map((q: { orderIndex: number }) => q.orderIndex)).toEqual([...Array(10).keys()]);
    for (let i = 1; i < difficulties.length; i++) {
      expect(difficulties[i]).toBeGreaterThanOrEqual(difficulties[i - 1]!);
    }
  });

  it('reports honestly that it could not build the formats needing prose', async () => {
    const id = await withWords();
    await server.patch(`/api/admin/tests/${id}`, {
      mix: { translate_input: 0, mcq_translation: 0, mcq_definition: 100, fill_blank: 0 },
    });
    const res = await server.post(`/api/admin/tests/${id}/generate`);

    expect(res.body.report.achieved.mcq_definition).toBe(0);
    expect(res.body.report.achieved.translate_input).toBe(10);
    const reasons = res.body.report.shortfalls.map((s: { reason: string }) => s.reason).join(' ');
    expect(reasons).toContain('language model');
  });

  it('builds real multiple choice when the words are tricky enough', async () => {
    const id = await withWords();
    const words = (await server.get(`/api/admin/tests/${id}/words`)).body;
    for (const word of words) {
      await server.patch(`/api/admin/tests/${id}/words/${word.id}`, { trickiness: 3 });
    }
    await server.patch(`/api/admin/tests/${id}`, {
      mix: { translate_input: 0, mcq_translation: 100, mcq_definition: 0, fill_blank: 0 },
    });

    const res = await server.post(`/api/admin/tests/${id}/generate`);
    expect(res.body.report.achieved.mcq_translation).toBe(10);
    for (const q of res.body.questions) {
      expect(q.payload.options).toHaveLength(4);
      expect(q.payload.options[q.payload.correctIndex]).toBeTruthy();
    }
  });

  it('refuses to generate from an empty word list', async () => {
    const id = await makeTest();
    const res = await server.post(`/api/admin/tests/${id}/generate`);
    expect(res.status).toBe(409);
  });

  it('regenerating replaces rather than appends', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.post(`/api/admin/tests/${id}/generate`);
    expect((await server.get(`/api/admin/tests/${id}/questions`)).body.questions).toHaveLength(10);
  });
});

describe('reviewing questions', () => {
  it('accepts an edited payload and rejects an invalid one', async () => {
    const id = await withWords();
    const question = (await server.post(`/api/admin/tests/${id}/generate`)).body.questions[0];

    const ok = await server.patch(`/api/admin/tests/${id}/questions/${question.id}`, {
      payload: { ...question.payload, accepted: ['reluctant', 'unwilling'] },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.payload.accepted).toEqual(['reluctant', 'unwilling']);

    const bad = await server.patch(`/api/admin/tests/${id}/questions/${question.id}`, {
      payload: { ...question.payload, accepted: [] },
    });
    expect(bad.status).toBe(400);
  });

  it('deleting a question drops its word from the test and keeps positions contiguous', async () => {
    const id = await withWords();
    const questions = (await server.post(`/api/admin/tests/${id}/generate`)).body.questions;

    expect((await server.delete(`/api/admin/tests/${id}/questions/${questions[3].id}`)).status).toBe(204);

    const after = (await server.get(`/api/admin/tests/${id}/questions`)).body.questions;
    expect(after).toHaveLength(9);
    expect(after.map((q: { orderIndex: number }) => q.orderIndex)).toEqual([...Array(9).keys()]);

    const words = (await server.get(`/api/admin/tests/${id}/words`)).body;
    const dropped = words.find((w: { id: string }) => w.id === questions[3].wordId);
    expect(dropped.included).toBe(false);
  });
});

describe('lifecycle', () => {
  it('publishes a draft that has words', async () => {
    const id = await withWords();
    const res = await server.post(`/api/admin/tests/${id}/publish`);
    expect(res.body.status).toBe('published');
    expect(res.body.publishedAt).toBeTruthy();
  });

  it('will not publish an empty test', async () => {
    const id = await makeTest();
    expect((await server.post(`/api/admin/tests/${id}/publish`)).status).toBe(409);
  });

  it('will not open a test whose pool is no bigger than the target', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.patch(`/api/admin/tests/${id}`, { targetCount: 10 });

    const res = await server.post(`/api/admin/tests/${id}/open`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('above 100%');
  });

  it('opens once the pool is larger than the target', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.patch(`/api/admin/tests/${id}`, { targetCount: 6 });

    const res = await server.post(`/api/admin/tests/${id}/open`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
  });

  it('will not open without questions', async () => {
    const id = await withWords();
    const res = await server.post(`/api/admin/tests/${id}/open`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Generate the questions');
  });

  it('allows renaming an open test, since a title cannot affect an attempt', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.patch(`/api/admin/tests/${id}`, { targetCount: 6 });
    await server.post(`/api/admin/tests/${id}/open`);

    const renamed = await server.patch(`/api/admin/tests/${id}`, { title: 'Unit 3 — Vocabulary' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Unit 3 — Vocabulary');
    expect(renamed.body.status).toBe('open');
  });

  it('still refuses a settings change bundled in with a rename', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.patch(`/api/admin/tests/${id}`, { targetCount: 6 });
    await server.post(`/api/admin/tests/${id}/open`);

    const res = await server.patch(`/api/admin/tests/${id}`, {
      title: 'Renamed',
      targetCount: 2,
    });
    expect(res.status).toBe(409);
    // Neither change was applied.
    const after = (await server.get(`/api/admin/tests/${id}`)).body;
    expect(after.title).toBe('Unit 3');
    expect(after.targetCount).toBe(6);
  });

  it('refuses edits while a test is open', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.patch(`/api/admin/tests/${id}`, { targetCount: 6 });
    await server.post(`/api/admin/tests/${id}/open`);

    const res = await server.post(`/api/admin/tests/${id}/generate`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('taking it right now');
  });

  it('rejects an illegal transition', async () => {
    const id = await withWords();
    const res = await server.post(`/api/admin/tests/${id}/close`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('cannot go straight to closed');
  });

  it('closes an open test and can reopen it for a latecomer', async () => {
    const id = await withWords();
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.patch(`/api/admin/tests/${id}`, { targetCount: 6 });
    await server.post(`/api/admin/tests/${id}/open`);

    expect((await server.post(`/api/admin/tests/${id}/close`)).body.status).toBe('closed');
    const reopened = await server.post(`/api/admin/tests/${id}/open`);
    expect(reopened.body.status).toBe('open');
    expect(reopened.body.closedAt).toBeNull();
  });
});
