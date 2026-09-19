import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import type { DrillChoice, DrillFeedback, DrillView, MyWordsView } from '@voku/shared';

let server: TestServer;
let classId: string;
let lena: string;
let tom: string;

const TYPED_ONLY = { translate_input: 100, mcq_translation: 0, mcq_definition: 0, fill_blank: 0 };

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();
  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
  const added = (
    await server.post(`/api/admin/classes/${classId}/students`, { names: 'Lena Berger\nTom Weiß' })
  ).body.added;
  lena = added[0].token;
  tom = added[1].token;
});
afterEach(async () => {
  await server.stop();
});

/** What a student has to type to get a question right, read straight off the stored payload. */
function answerTo(questionId: string): { headword: string; accepted: string } {
  const row = server.db.get<{ payload_json: string; headword_en: string }>(
    `SELECT q.payload_json, w.headword_en FROM questions q
       JOIN test_words w ON w.id = q.word_id WHERE q.id = :id`,
    { id: questionId },
  )!;
  return { headword: row.headword_en, accepted: JSON.parse(row.payload_json).accepted[0] };
}

/**
 * One unit, sat by one student: `wrong` are answered wrongly, the rest rightly,
 * and they stop after `reach` questions. The teacher's session stays alongside
 * the student's, so both kinds of route can be driven in turn.
 */
async function sitUnit(
  title: string,
  words: string,
  {
    as = lena,
    wrong = [] as string[],
    reach = Infinity,
    close = true,
    testId,
  }: { as?: string; wrong?: string[]; reach?: number; close?: boolean; testId?: string } = {},
): Promise<string> {
  const id = testId ?? ((await server.post('/api/admin/tests', { classId, title })).body.id as string);
  if (!testId) {
    await server.post(`/api/admin/tests/${id}/words/paste`, { text: words });
    await server.patch(`/api/admin/tests/${id}`, { targetCount: 1, mix: TYPED_ONLY });
    await server.post(`/api/admin/tests/${id}/generate`);
    await server.post(`/api/admin/tests/${id}/publish`);
    await server.post(`/api/admin/tests/${id}/open`);
  }

  await server.post('/api/s/session', { token: as });
  const started = (await server.post(`/api/s/tests/${id}/start`)).body;
  let question = started.question;
  for (let n = 0; question && n < reach; n++) {
    const { headword, accepted } = answerTo(question.id);
    const given = wrong.includes(headword) ? 'definitely wrong' : accepted;
    question = (
      await server.post(`/api/s/attempts/${started.attempt.id}/answers`, {
        questionId: question.id,
        given,
      })
    ).body.question;
  }
  await server.post(`/api/s/attempts/${started.attempt.id}/submit`);

  if (close) await server.post(`/api/admin/tests/${id}/close`);
  return id;
}

async function mine(token = lena): Promise<MyWordsView> {
  await server.post('/api/s/session', { token });
  return (await server.get<MyWordsView>('/api/s/my-words')).body;
}

const UNIT = 'reluctant;widerwillig\nthorough;gründlich\nscarcely;kaum\nambush;Hinterhalt';

describe('a student’s own words to work on', () => {
  it('lists the words they got wrong, and not the ones they got right', async () => {
    await sitUnit('Unit 1', UNIT, { wrong: ['thorough'] });
    const view = await mine();

    expect(view.words.map((w) => w.headwordEn)).toEqual(['thorough']);
    expect(view.words[0]).toMatchObject({
      translationDe: 'gründlich',
      fromTestTitle: 'Unit 1',
      timesMissed: 1,
    });
  });

  // Not getting to word 35 in five minutes is not the same as getting it wrong.
  it('leaves out words they never reached', async () => {
    // Every word would be wrong — but only the first is ever reached.
    await sitUnit('Unit 1', UNIT, {
      wrong: ['reluctant', 'thorough', 'scarcely', 'ambush'],
      reach: 1,
    });
    expect((await mine()).words).toHaveLength(1);
  });

  // While the test runs, an early finisher's list would be answers the others
  // are still working on — so the whole list is paused, not merely filtered.
  it('is paused while the test is still open, and complete once it closes', async () => {
    const id = await sitUnit('Unit 1', UNIT, { wrong: ['thorough'], close: false });
    await server.post('/api/s/session', { token: lena });
    expect((await server.get('/api/s/my-words')).status).toBe(403);

    await server.post(`/api/admin/tests/${id}/close`);
    expect((await mine()).words.map((w) => w.headwordEn)).toEqual(['thorough']);
  });

  // Practice is not measurement.
  it('does not count a practice run', async () => {
    const id = await sitUnit('Unit 1', UNIT);

    await server.post('/api/s/session', { token: lena });
    const practice = (await server.post(`/api/s/tests/${id}/practice`)).body;
    let question = practice.question;
    while (question) {
      question = (
        await server.post(`/api/s/attempts/${practice.attempt.id}/answers`, {
          questionId: question.id,
          given: 'definitely wrong',
        })
      ).body.question;
    }

    expect((await mine()).words).toEqual([]);
  });

  // The list is meant to empty. The test is where a word is shown to be known,
  // usually because the teacher brought it back.
  it('drops a word once it is got right in a later unit, and counts it as cleared', async () => {
    const first = await sitUnit('Unit 1', UNIT, { wrong: ['thorough'] });
    expect((await mine()).words).toHaveLength(1);

    const next = (await server.post('/api/admin/tests', { classId, title: 'Unit 2' })).body.id;
    const thorough = server.db.get<{ id: string }>(
      `SELECT id FROM test_words WHERE test_id = :t AND headword_en = 'thorough'`,
      { t: first },
    )!.id;
    await server.post(`/api/admin/tests/${next}/import-words`, { wordIds: [thorough] });
    await server.post(`/api/admin/tests/${next}/words/paste`, { text: 'weary;müde\nvivid;lebhaft' });
    await server.patch(`/api/admin/tests/${next}`, { targetCount: 1, mix: TYPED_ONLY });
    await server.post(`/api/admin/tests/${next}/generate`);
    await server.post(`/api/admin/tests/${next}/publish`);
    await server.post(`/api/admin/tests/${next}/open`);
    await sitUnit('', '', { testId: next });

    const view = await mine();
    expect(view.words).toEqual([]);
    expect(view.cleared).toBe(1);
  });

  it('counts a word missed in two units once, as missed twice', async () => {
    const first = await sitUnit('Unit 1', UNIT, { wrong: ['thorough'] });

    const next = (await server.post('/api/admin/tests', { classId, title: 'Unit 2' })).body.id;
    const thorough = server.db.get<{ id: string }>(
      `SELECT id FROM test_words WHERE test_id = :t AND headword_en = 'thorough'`,
      { t: first },
    )!.id;
    await server.post(`/api/admin/tests/${next}/import-words`, { wordIds: [thorough] });
    await server.post(`/api/admin/tests/${next}/words/paste`, { text: 'weary;müde\nvivid;lebhaft' });
    await server.patch(`/api/admin/tests/${next}`, { targetCount: 1, mix: TYPED_ONLY });
    await server.post(`/api/admin/tests/${next}/generate`);
    await server.post(`/api/admin/tests/${next}/publish`);
    await server.post(`/api/admin/tests/${next}/open`);
    await sitUnit('', '', { testId: next, wrong: ['thorough'] });

    const view = await mine();
    expect(view.words).toHaveLength(1);
    expect(view.words[0]).toMatchObject({ headwordEn: 'thorough', timesMissed: 2, fromTestTitle: 'Unit 2' });
  });

  it('never shows one student another’s words', async () => {
    await sitUnit('Unit 1', UNIT, { as: lena, wrong: ['thorough'] });
    expect((await mine(tom)).words).toEqual([]);
  });

  // Accepting a spelling afterwards is a decision that the answer was right, so
  // it should reach the student's list as well as their score.
  it('lets a bulk regrade take a word off the list', async () => {
    const id = await sitUnit('Unit 1', UNIT, { wrong: ['thorough'] });
    const question = server.db.get<{ id: string }>(
      `SELECT q.id FROM questions q JOIN test_words w ON w.id = q.word_id
        WHERE q.test_id = :t AND w.headword_en = 'thorough'`,
      { t: id },
    )!;

    await server.post(`/api/admin/tests/${id}/accept-variant`, {
      questionId: question.id,
      variant: 'definitely wrong',
      persist: false,
    });

    expect((await mine()).words).toEqual([]);
  });
});

describe('practising those words', () => {
  it('drills the listed words without handing over the answers', async () => {
    await sitUnit('Unit 1', UNIT, { wrong: ['thorough', 'scarcely'] });
    await server.post('/api/s/session', { token: lena });

    const view = (await server.get<DrillView>('/api/s/my-words/drill')).body;
    expect(view.items.map((i) => i.prompt).sort()).toEqual(['gründlich', 'kaum']);
    expect(view.items.every((i) => i.repeatedFrom === 'Unit 1')).toBe(true);
    expect(JSON.stringify(view)).not.toContain('accepted');
  });

  it('marks an answer the same way the unit would', async () => {
    await sitUnit('Unit 1', UNIT, { wrong: ['thorough'] });
    await server.post('/api/s/session', { token: lena });
    const item = (await server.get<DrillView>('/api/s/my-words/drill')).body.items[0]!;

    const right = await server.post<DrillFeedback>('/api/s/my-words/drill', {
      wordId: item.wordId,
      given: 'thorough',
    });
    expect(right.body.correct).toBe(true);
  });

  it('offers a listed word as a choice', async () => {
    await sitUnit('Unit 1', UNIT, { wrong: ['thorough'] });
    await server.post('/api/s/session', { token: lena });
    const item = (await server.get<DrillView>('/api/s/my-words/drill')).body.items[0]!;

    const choice = (
      await server.get<DrillChoice>(`/api/s/my-words/drill/${item.wordId}/choice`)
    ).body;
    expect(choice.options).toContain('thorough');
    expect(choice.options.length).toBeGreaterThanOrEqual(3);
  });

  // Only their own list: this is not a way to look up any word in any test.
  it('refuses a word that is not on the student’s own list', async () => {
    const id = await sitUnit('Unit 1', UNIT, { wrong: ['thorough'] });
    const reluctant = server.db.get<{ id: string }>(
      `SELECT id FROM test_words WHERE test_id = :t AND headword_en = 'reluctant'`,
      { t: id },
    )!.id;

    await server.post('/api/s/session', { token: lena });
    const mark = await server.post('/api/s/my-words/drill', { wordId: reluctant, given: 'x' });
    const choice = await server.get(`/api/s/my-words/drill/${reluctant}/choice`);
    expect(mark.status).toBe(404);
    expect(choice.status).toBe(404);

    // And Lena's word is not Tom's to drill.
    const thorough = server.db.get<{ id: string }>(
      `SELECT id FROM test_words WHERE test_id = :t AND headword_en = 'thorough'`,
      { t: id },
    )!.id;
    await server.post('/api/s/session', { token: tom });
    expect((await server.post('/api/s/my-words/drill', { wordId: thorough, given: 'x' })).status).toBe(404);
  });

  it('is empty, not broken, for a student with nothing to work on', async () => {
    await server.post('/api/s/session', { token: lena });
    expect((await server.get<MyWordsView>('/api/s/my-words')).body).toEqual({ words: [], cleared: 0 });
    expect((await server.get<DrillView>('/api/s/my-words/drill')).body.items).toEqual([]);
  });
});
