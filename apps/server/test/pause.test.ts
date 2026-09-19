import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';

/**
 * While any test in the class runs, nothing that shows an answer is served.
 *
 * The case this exists for: a word brought back from an earlier unit is, by
 * design, also a question in the test being written — so the earlier unit's
 * word list, practice, review and a student's own list would all be the answer
 * on screen, one tab away from the sprint.
 */

let server: TestServer;
let classId: string;
let lena: string;
let unit1: string;
let unit2: string;
let unit1Attempt: string;

const TYPED_ONLY = { translate_input: 100, mcq_translation: 0, mcq_definition: 0, fill_blank: 0 };

async function unit(title: string, words: string): Promise<string> {
  const id = (await server.post('/api/admin/tests', { classId, title })).body.id as string;
  await server.post(`/api/admin/tests/${id}/words/paste`, { text: words });
  await server.patch(`/api/admin/tests/${id}`, { targetCount: 1, mix: TYPED_ONLY });
  await server.post(`/api/admin/tests/${id}/generate`);
  await server.post(`/api/admin/tests/${id}/publish`);
  return id;
}

/** Sits a test as Lena, answering every question wrongly, and hands in. */
async function sit(testId: string): Promise<string> {
  await server.post('/api/s/session', { token: lena });
  const started = (await server.post(`/api/s/tests/${testId}/start`)).body;
  let question = started.question;
  while (question) {
    question = (
      await server.post(`/api/s/attempts/${started.attempt.id}/answers`, {
        questionId: question.id,
        given: 'wrong',
      })
    ).body.question;
  }
  await server.post(`/api/s/attempts/${started.attempt.id}/submit`);
  return started.attempt.id as string;
}

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();
  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
  lena = (await server.post(`/api/admin/classes/${classId}/students`, { names: 'Lena Berger' })).body
    .added[0].token;

  // Unit 1: sat, missed, closed.
  unit1 = await unit('Unit 1', 'thorough;gründlich\nweary;müde\nvivid;lebhaft');
  await server.post(`/api/admin/tests/${unit1}/open`);
  unit1Attempt = await sit(unit1);
  await server.post(`/api/admin/tests/${unit1}/close`);

  // Unit 2 brings "thorough" back and is now running.
  unit2 = (await server.post('/api/admin/tests', { classId, title: 'Unit 2' })).body.id;
  const thorough = server.db.get<{ id: string }>(
    `SELECT id FROM test_words WHERE test_id = :t AND headword_en = 'thorough'`,
    { t: unit1 },
  )!.id;
  await server.post(`/api/admin/tests/${unit2}/import-words`, { wordIds: [thorough] });
  await server.post(`/api/admin/tests/${unit2}/words/paste`, { text: 'sturdy;robust\nlinger;verweilen' });
  await server.patch(`/api/admin/tests/${unit2}`, { targetCount: 1, mix: TYPED_ONLY });
  await server.post(`/api/admin/tests/${unit2}/generate`);
  await server.post(`/api/admin/tests/${unit2}/publish`);
  await server.post(`/api/admin/tests/${unit2}/open`);

  await server.post('/api/s/session', { token: lena });
});
afterEach(async () => {
  await server.stop();
});

describe('while a test is running', () => {
  it('tells the home screen that revision is paused', async () => {
    expect((await server.get('/api/s/me')).body.revisionPaused).toBe(true);
  });

  // The whole reason: Unit 2 asks for "thorough", and Unit 1's list says it.
  it('will not show an earlier unit’s word list', async () => {
    expect((await server.get(`/api/s/tests/${unit1}/words`)).status).toBe(403);
  });

  it('will not drill, offer a choice from, or mark an earlier unit', async () => {
    const wordId = server.db.get<{ id: string }>(
      `SELECT id FROM test_words WHERE test_id = :t AND headword_en = 'thorough'`,
      { t: unit1 },
    )!.id;
    expect((await server.get(`/api/s/tests/${unit1}/drill`)).status).toBe(403);
    expect((await server.get(`/api/s/tests/${unit1}/drill/${wordId}/choice`)).status).toBe(403);
    expect(
      (await server.post(`/api/s/tests/${unit1}/drill`, { wordId, given: 'thorough' })).status,
    ).toBe(403);
  });

  it('will not show a student their own words', async () => {
    expect((await server.get('/api/s/my-words')).status).toBe(403);
    expect((await server.get('/api/s/my-words/drill')).status).toBe(403);
  });

  it('will not re-run an earlier unit’s questions', async () => {
    expect((await server.post(`/api/s/tests/${unit1}/practice`)).status).toBe(403);
  });

  it('will not show an earlier unit’s review', async () => {
    expect((await server.get(`/api/s/attempts/${unit1Attempt}/review`)).status).toBe(403);
  });

  // Handing in early does not leave the room.
  it('stays paused for a student who has already handed in', async () => {
    await sit(unit2);
    expect((await server.get('/api/s/me')).body.revisionPaused).toBe(true);
    expect((await server.get(`/api/s/tests/${unit1}/words`)).status).toBe(403);
  });

  // Reviewing the running test itself after handing in was decided before,
  // on its own terms, and is left as it was — but it offers no practice.
  it('still lets a student who handed in see their own review of it, without practice', async () => {
    const attempt = await sit(unit2);
    const review = await server.get(`/api/s/attempts/${attempt}/review`);
    expect(review.status).toBe(200);
    expect(review.body.canPractiseWords).toBe(false);
  });

  it('stops a practice run that was started before the test opened', async () => {
    // Close Unit 2 for a moment so a practice run on Unit 1 can begin.
    await server.post(`/api/admin/tests/${unit2}/close`);
    const practice = (await server.post(`/api/s/tests/${unit1}/practice`)).body;
    await server.post(`/api/admin/tests/${unit2}/open`);

    const res = await server.post(`/api/s/attempts/${practice.attempt.id}/answers`, {
      questionId: practice.question.id,
      given: 'thorough',
    });
    expect(res.status).toBe(403);
  });
});

describe('once it closes', () => {
  it('gives everything back', async () => {
    await server.post(`/api/admin/tests/${unit2}/close`);

    expect((await server.get('/api/s/me')).body.revisionPaused).toBe(false);
    expect((await server.get(`/api/s/tests/${unit1}/words`)).status).toBe(200);
    expect((await server.get('/api/s/my-words')).status).toBe(200);
    expect((await server.get(`/api/s/attempts/${unit1Attempt}/review`)).status).toBe(200);
  });
});

describe('another class’s test', () => {
  it('pauses nothing here', async () => {
    await server.post(`/api/admin/tests/${unit2}/close`);
    const other = (await server.post('/api/admin/classes', { name: '9c' })).body.id;
    const theirs = (await server.post('/api/admin/tests', { classId: other, title: 'X' })).body.id;
    await server.post(`/api/admin/tests/${theirs}/words/paste`, { text: 'a;b\nc;d\ne;f' });
    await server.patch(`/api/admin/tests/${theirs}`, { targetCount: 1 });
    await server.post(`/api/admin/tests/${theirs}/generate`);
    await server.post(`/api/admin/tests/${theirs}/publish`);
    await server.post(`/api/admin/tests/${theirs}/open`);

    expect((await server.get('/api/s/me')).body.revisionPaused).toBe(false);
    expect((await server.get(`/api/s/tests/${unit1}/words`)).status).toBe(200);
  });
});
