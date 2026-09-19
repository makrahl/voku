import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import type { DrillChoice, DrillFeedback, DrillView } from '@voku/shared';

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

describe('a second go, offered as a choice', () => {
  /** Signs in as the student, fetches the choice for one word, and marks every option. */
  async function choiceFor(germanPrompt: string) {
    return asStudent(async () => {
      const view = (await server.get<DrillView>(`/api/s/tests/${testId}/drill`)).body;
      const item = view.items.find((i) => i.prompt === germanPrompt)!;
      const choice = (
        await server.get<DrillChoice>(`/api/s/tests/${testId}/drill/${item.wordId}/choice`)
      ).body;
      const marks = [];
      for (const option of choice.options) {
        const feedback = (
          await server.post<DrillFeedback>(`/api/s/tests/${testId}/drill`, {
            wordId: item.wordId,
            given: option,
          })
        ).body;
        marks.push({ option, correct: feedback.correct });
      }
      return { choice, marks };
    });
  }

  it('offers the word back with exactly one right option, and marks it by the same grader', async () => {
    await publish();
    const { choice, marks } = await choiceFor('widerwillig');

    expect(choice.prompt).toBe('widerwillig');
    expect(choice.options.length).toBeGreaterThanOrEqual(3);
    expect(marks.filter((m) => m.correct).map((m) => m.option)).toEqual(['reluctant']);
  });

  it('never hands over which option is right', async () => {
    await publish();
    const raw = await asStudent(async () => {
      const view = (await server.get<DrillView>(`/api/s/tests/${testId}/drill`)).body;
      return (await server.get(`/api/s/tests/${testId}/drill/${view.items[0]!.wordId}/choice`)).body;
    });
    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain('correctIndex');
    expect(serialised).not.toContain('accepted');
  });

  // The decision: the test's own multiple choice carries the traps the model
  // wrote, and practising on them would spend them before the sprint. So the
  // choice is built from the word list, never from the stored questions.
  it('is built from the word list, never from the test’s own trap options', async () => {
    await server.post(`/api/admin/tests/${testId}/generate`);
    const questions = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions;
    for (const question of questions) {
      await server.patch(`/api/admin/tests/${testId}/questions/${question.id}`, {
        payload: {
          type: 'mcq_translation',
          direction: 'de_en',
          prompt: 'x',
          options: ['zzz-trap-1', 'zzz-trap-2', 'zzz-trap-3', 'right'],
          correctIndex: 3,
        },
      });
    }
    await server.post(`/api/admin/tests/${testId}/publish`);

    const { choice } = await choiceFor('widerwillig');
    expect(choice.options.some((option) => option.startsWith('zzz-trap'))).toBe(false);
  });

  // A wrong option the grader would accept is a second right answer, and a
  // choice with two right answers teaches nothing. Near-synonyms are exactly
  // the failure the test's own distractors still have.
  it('leaves out an option that would also count as right', async () => {
    const words = (await server.get(`/api/admin/tests/${testId}/words`)).body;
    const reluctant = words.find((w: { headwordEn: string }) => w.headwordEn === 'reluctant');
    // "thorough" is on the list as its own word, and nearest in difficulty.
    await server.patch(`/api/admin/tests/${testId}/words/${reluctant.id}`, {
      acceptedEn: ['thorough'],
    });
    await publish();

    const { choice, marks } = await choiceFor('widerwillig');
    expect(choice.options).not.toContain('thorough');
    expect(marks.filter((m) => m.correct)).toHaveLength(1);
  });

  it('offers no choice when the list is too short to make a fair one', async () => {
    const short = (await server.post('/api/admin/tests', { classId, title: 'Two words' })).body.id;
    await server.post(`/api/admin/tests/${short}/words/paste`, {
      text: 'reluctant;widerwillig\nthorough;gründlich',
    });
    const view = (await server.get<DrillView>(`/api/admin/tests/${short}/drill`)).body;
    const choice = (
      await server.get<DrillChoice>(`/api/admin/tests/${short}/drill/${view.items[0]!.wordId}/choice`)
    ).body;

    expect(choice.options).toEqual([]);
    expect(choice.prompt).toBeTruthy();
  });

  it('keeps to the same rules as the drill: not while the test is open', async () => {
    await publish();
    await server.post(`/api/admin/tests/${testId}/open`);
    const wordId = (await server.get(`/api/admin/tests/${testId}/words`)).body[0].id;

    const res = await asStudent(async () =>
      server.get(`/api/s/tests/${testId}/drill/${wordId}/choice`),
    );
    expect(res.status).toBe(403);
  });

  it('refuses a word that is not on the list', async () => {
    await publish();
    const res = await asStudent(async () =>
      server.get(`/api/s/tests/${testId}/drill/made-up/choice`),
    );
    expect(res.status).toBe(404);
  });
});

describe('what the review screen may offer', () => {
  /** Sits the test and hands in, leaving the test open for the rest of the class. */
  async function submitEarly(): Promise<string> {
    await publish();
    await server.post(`/api/admin/tests/${testId}/open`);

    return asStudent(async () => {
      const started = (await server.post(`/api/s/tests/${testId}/start`)).body;
      await server.post(`/api/s/attempts/${started.attempt.id}/submit`);
      return started.attempt.id as string;
    });
  }

  // The word list is the answer to half the questions, so an early finisher
  // must not be handed it while the others are still writing.
  it('withholds the word drill from someone who handed in while the test runs', async () => {
    const attemptId = await submitEarly();

    const review = await asStudent(
      async () => (await server.get(`/api/s/attempts/${attemptId}/review`)).body,
    );
    expect(review.canPractiseWords).toBe(false);

    const refused = await asStudent(async () => server.get(`/api/s/tests/${testId}/drill`));
    expect(refused.status).toBe(403);
  });

  it('offers it once the test is closed', async () => {
    const attemptId = await submitEarly();
    await server.post(`/api/admin/tests/${testId}/close`);

    const review = await asStudent(
      async () => (await server.get(`/api/s/attempts/${attemptId}/review`)).body,
    );
    expect(review.canPractiseWords).toBe(true);

    const allowed = await asStudent(async () => server.get(`/api/s/tests/${testId}/drill`));
    expect(allowed.status).toBe(200);
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
