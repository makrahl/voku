import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import type { DrillFeedback, DrillView } from '@voku/shared';

let server: TestServer;
let classId: string;
let testId: string;
let token: string;

const GLOSSARY = [
  'reluctant;widerwillig',
  'thorough;gründlich',
  'scarcely;kaum',
  'ambush;Hinterhalt',
  'nevertheless;dennoch',
  'ruthless;rücksichtslos',
].join('\n');

/** Publishes the test, which is the state a class revises in. */
async function publish() {
  await server.post(`/api/admin/tests/${testId}/generate`);
  await server.post(`/api/admin/tests/${testId}/publish`);
}

/** Runs as the student, then hands the session back to the teacher. */
async function asStudent<T>(work: () => Promise<T>): Promise<T> {
  server.clearCookies();
  await server.post('/api/s/session', { token });
  const out = await work();
  server.clearCookies();
  await server.post('/api/admin/auth/login', {
    email: 'teacher@school.de',
    password: 'hunter2hunter2',
  });
  return out;
}

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();
  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
  token = (
    await server.post(`/api/admin/classes/${classId}/students`, { names: 'Lena Berger' })
  ).body.added[0].token;
  testId = (await server.post('/api/admin/tests', { classId, title: 'Unit 3' })).body.id;
  await server.post(`/api/admin/tests/${testId}/words/paste`, { text: GLOSSARY });
  // A test will not open unless its pool is bigger than the target, and the
  // default target is far above this deliberately short list.
  await server.patch(`/api/admin/tests/${testId}`, { targetCount: 4 });
});
afterEach(async () => {
  await server.stop();
});

describe('practising the word list before the test', () => {
  it('offers every word in the test once the test is published', async () => {
    await publish();
    const view = await asStudent(
      async () => (await server.get<DrillView>(`/api/s/tests/${testId}/drill`)).body,
    );

    expect(view.title).toBe('Unit 3');
    expect(view.items).toHaveLength(6);
    expect(view.items.every((item) => item.prompt)).toBe(true);
  });

  // The decision: revising must not become a rehearsal of the exact questions.
  // The drill is built from the word pairs, so it never carries the test's own
  // multiple-choice options or gap sentences.
  it('never hands over an answer, an option list or a gap sentence', async () => {
    await publish();
    const raw = await asStudent(
      async () => (await server.get(`/api/s/tests/${testId}/drill`)).body,
    );

    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain('accepted');
    expect(serialised).not.toContain('options');
    expect(serialised).not.toContain('correctIndex');
    expect(serialised).not.toContain('sentence');
  });

  it('marks an answer with the same strictness as the real sprint', async () => {
    await publish();
    const { items, right, nearMiss } = await asStudent(async () => {
      const view = (await server.get<DrillView>(`/api/s/tests/${testId}/drill`)).body;
      const item = view.items.find((i) => i.prompt === 'widerwillig' || i.prompt === 'reluctant')!;
      const answer = item.prompt === 'widerwillig' ? 'reluctant' : 'widerwillig';

      const right = (
        await server.post<DrillFeedback>(`/api/s/tests/${testId}/drill`, {
          wordId: item.wordId,
          given: answer,
        })
      ).body;
      const nearMiss = (
        await server.post<DrillFeedback>(`/api/s/tests/${testId}/drill`, {
          wordId: item.wordId,
          given: `${answer.slice(0, -1)}x`,
        })
      ).body;
      return { items: view.items, right, nearMiss };
    });

    expect(items.length).toBeGreaterThan(0);
    expect(right.correct).toBe(true);
    // Strict spelling is the decision; "almost" shows the form without a mark.
    expect(nearMiss.correct).toBe(false);
    expect(nearMiss.almost).toBe(true);
    expect(nearMiss.correctAnswer).toBeTruthy();
  });

  // Practice is a study aid, not a measurement. Nothing about it reaches the
  // teacher, and nothing about it can move a score.
  it('records nothing — no attempt, no answer, no trace', async () => {
    await publish();
    await asStudent(async () => {
      const view = (await server.get<DrillView>(`/api/s/tests/${testId}/drill`)).body;
      for (const item of view.items) {
        await server.post(`/api/s/tests/${testId}/drill`, {
          wordId: item.wordId,
          given: 'whatever',
        });
      }
    });

    expect(server.db.all('SELECT * FROM attempts')).toHaveLength(0);
    expect(server.db.all('SELECT * FROM answers')).toHaveLength(0);
  });

  it('is refused while the test is open, when they should be taking it', async () => {
    await publish();
    await server.post(`/api/admin/tests/${testId}/open`);

    const res = await asStudent(async () => server.get(`/api/s/tests/${testId}/drill`));
    expect(res.status).toBe(403);
  });

  it('is refused on a draft, where there is nothing settled to learn', async () => {
    const res = await asStudent(async () => server.get(`/api/s/tests/${testId}/drill`));
    expect(res.status).toBe(403);
  });

  it('comes back after the test, for the words they got wrong', async () => {
    await publish();
    await server.post(`/api/admin/tests/${testId}/open`);
    await server.post(`/api/admin/tests/${testId}/close`);

    const view = await asStudent(
      async () => (await server.get<DrillView>(`/api/s/tests/${testId}/drill`)).body,
    );
    expect(view.items).toHaveLength(6);
  });

  it('will not drill another class’s test', async () => {
    await publish();
    const otherClass = (await server.post('/api/admin/classes', { name: '9c' })).body.id;
    const otherTest = (await server.post('/api/admin/tests', { classId: otherClass, title: 'X' }))
      .body.id;

    const res = await asStudent(async () => server.get(`/api/s/tests/${otherTest}/drill`));
    expect(res.status).toBe(404);
  });

  it('refuses a word that is not in this test', async () => {
    await publish();
    const res = await asStudent(async () =>
      server.post(`/api/s/tests/${testId}/drill`, { wordId: 'made-up', given: 'x' }),
    );
    expect(res.status).toBe(404);
  });
});

describe('the teacher previewing that practice', () => {
  // The preview exists to answer "what will they get?" before deciding to
  // publish, so it must work on a draft — unlike the students' own drill.
  it('works on a draft, which the students’ drill refuses', async () => {
    const mine = (await server.get<DrillView>(`/api/admin/tests/${testId}/drill`)).body;
    expect(mine.items).toHaveLength(6);

    const theirs = await asStudent(async () => server.get(`/api/s/tests/${testId}/drill`));
    expect(theirs.status).toBe(403);
  });

  it('asks exactly what the class will be asked', async () => {
    await publish();
    const mine = (await server.get<DrillView>(`/api/admin/tests/${testId}/drill`)).body;
    const theirs = await asStudent(
      async () => (await server.get<DrillView>(`/api/s/tests/${testId}/drill`)).body,
    );
    expect(mine.items).toEqual(theirs.items);
  });

  it('marks the preview without recording it', async () => {
    const view = (await server.get<DrillView>(`/api/admin/tests/${testId}/drill`)).body;
    const res = await server.post<DrillFeedback>(`/api/admin/tests/${testId}/drill`, {
      wordId: view.items[0]!.wordId,
      given: 'nonsense',
    });

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(false);
    expect(res.body.correctAnswer).toBeTruthy();
    expect(server.db.all('SELECT * FROM attempts')).toHaveLength(0);
    expect(server.db.all('SELECT * FROM answers')).toHaveLength(0);
  });

  it('will not preview another teacher’s test', async () => {
    await server.signInAsTeacher('other@school.de', 'hunter2hunter2');
    expect((await server.get(`/api/admin/tests/${testId}/drill`)).status).toBe(404);
  });
});
