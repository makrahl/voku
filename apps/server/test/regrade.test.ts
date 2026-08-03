import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import { STUDENT_COOKIE } from '../src/middleware/auth.js';

let server: TestServer;
let classId: string;
let testId: string;
let students: Array<{ id: string; name: string; token: string }>;

const GLOSSARY = [
  'receive;bekommen',
  'thorough;gründlich',
  'scarcely;kaum',
  'ambush;Hinterhalt',
  'nevertheless;dennoch',
  'ruthless;rücksichtslos',
].join('\n');

async function asTeacher<T>(fn: () => Promise<T>): Promise<T> {
  const studentCookie = server.cookie(STUDENT_COOKIE);
  server.clearCookies();
  await server.post('/api/admin/auth/login', {
    email: 'teacher@school.de',
    password: 'hunter2hunter2',
  });
  const result = await fn();
  server.clearCookies();
  if (studentCookie) await server.post('/api/s/session', { token: studentCookie });
  return result;
}

async function questions() {
  return asTeacher(
    async () => (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions,
  );
}

/** Runs a sprint for one student, answering with whatever strings are supplied. */
async function sprint(studentIndex: number, answers: string[]) {
  server.clearCookies();
  await server.post('/api/s/session', { token: students[studentIndex]!.token });
  let state = (await server.post(`/api/s/tests/${testId}/start`)).body;

  for (const given of answers) {
    if (!state.question) break;
    state = (
      await server.post(`/api/s/attempts/${state.attempt.id}/answers`, {
        questionId: state.question.id,
        given,
      })
    ).body;
  }
  if (state.attempt.submittedAt === null) {
    await server.post(`/api/s/attempts/${state.attempt.id}/submit`);
  }
  return state.attempt.id as string;
}

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();

  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
  students = (
    await server.post(`/api/admin/classes/${classId}/students`, {
      names: 'Lena Berger\nTom Weiß\nJonas Ott',
    })
  ).body.added;

  testId = (await server.post('/api/admin/tests', { classId, title: 'Unit 3' })).body.id;
  await server.post(`/api/admin/tests/${testId}/words/paste`, { text: GLOSSARY });
  await server.patch(`/api/admin/tests/${testId}`, {
    targetCount: 3,
    direction: 'de_en',
    mix: { translate_input: 100, mcq_translation: 0, mcq_definition: 0, fill_blank: 0 },
  });
  await server.post(`/api/admin/tests/${testId}/generate`);
  await server.post(`/api/admin/tests/${testId}/open`);
});

afterEach(async () => {
  await server.stop();
});

describe('bulk regrade', () => {
  it('groups rejected answers by what students actually typed', async () => {
    const qs = await questions();
    // Everyone starts on the easiest word; find what it wants.
    const first = qs[0];
    const wrongSpelling = `${first.payload.accepted[0]}x`;

    await sprint(0, [wrongSpelling]);
    await sprint(1, [wrongSpelling]);
    await sprint(2, ['something else entirely']);

    const groups = await asTeacher(
      async () => (await server.get(`/api/admin/tests/${testId}/rejected-answers`)).body,
    );

    const shared = groups.find((g: { variant: string }) => g.variant === wrongSpelling);
    expect(shared.count).toBe(2);
    expect(shared.studentNames.sort()).toEqual(['Lena Berger', 'Tom Weiß']);
    expect(shared.correctAnswer).toBe(first.payload.accepted[0]);
    expect(groups.some((g: { variant: string }) => g.variant === 'something else entirely')).toBe(true);
  });

  it('treats differently-cased spellings as one decision', async () => {
    const qs = await questions();
    const base = `${qs[0].payload.accepted[0]}x`;

    await sprint(0, [base]);
    await sprint(1, [base.toUpperCase()]);

    const groups = await asTeacher(
      async () => (await server.get(`/api/admin/tests/${testId}/rejected-answers`)).body,
    );
    expect(groups.filter((g: { questionId: string }) => g.questionId === qs[0].id)).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('accepting a variant re-marks every student who wrote it', async () => {
    const qs = await questions();
    const variant = `${qs[0].payload.accepted[0]}x`;

    const a = await sprint(0, [variant]);
    const b = await sprint(1, [variant]);
    for (const id of [a, b]) {
      expect(
        server.db.get<{ correct_count: number }>('SELECT correct_count FROM attempts WHERE id = :id', {
          id,
        })?.correct_count,
      ).toBe(0);
    }

    const res = await asTeacher(() =>
      server.post(`/api/admin/tests/${testId}/accept-variant`, {
        questionId: qs[0].id,
        variant,
        persist: true,
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.accepted).toContain(variant);
    for (const id of [a, b]) {
      expect(
        server.db.get<{ correct_count: number }>('SELECT correct_count FROM attempts WHERE id = :id', {
          id,
        })?.correct_count,
      ).toBe(1);
    }
  });

  it('persisting writes the variant onto the word for future tests', async () => {
    const qs = await questions();
    const variant = `${qs[0].payload.accepted[0]}x`;
    await sprint(0, [variant]);

    await asTeacher(() =>
      server.post(`/api/admin/tests/${testId}/accept-variant`, {
        questionId: qs[0].id,
        variant,
        persist: true,
      }),
    );

    const words = await asTeacher(
      async () => (await server.get(`/api/admin/tests/${testId}/words`)).body,
    );
    const word = words.find((w: { id: string }) => w.id === qs[0].wordId);
    // Direction is de_en, so the typed answer is the English side.
    expect(word.acceptedEn).toContain(variant);
  });

  it('leaves the word alone when persist is false', async () => {
    const qs = await questions();
    const variant = `${qs[0].payload.accepted[0]}x`;
    await sprint(0, [variant]);

    await asTeacher(() =>
      server.post(`/api/admin/tests/${testId}/accept-variant`, {
        questionId: qs[0].id,
        variant,
        persist: false,
      }),
    );

    const words = await asTeacher(
      async () => (await server.get(`/api/admin/tests/${testId}/words`)).body,
    );
    expect(words.find((w: { id: string }) => w.id === qs[0].wordId).acceptedEn).not.toContain(variant);
  });

  it('accepting the same variant twice is harmless', async () => {
    const qs = await questions();
    const variant = `${qs[0].payload.accepted[0]}x`;
    const attempt = await sprint(0, [variant]);

    for (let i = 0; i < 2; i++) {
      await asTeacher(() =>
        server.post(`/api/admin/tests/${testId}/accept-variant`, {
          questionId: qs[0].id,
          variant,
          persist: true,
        }),
      );
    }

    const payload = JSON.parse(
      server.db.get<{ payload_json: string }>('SELECT payload_json FROM questions WHERE id = :id', {
        id: qs[0].id,
      })!.payload_json,
    );
    expect(payload.accepted.filter((a: string) => a === variant)).toHaveLength(1);
    expect(
      server.db.get<{ correct_count: number }>('SELECT correct_count FROM attempts WHERE id = :id', {
        id: attempt,
      })?.correct_count,
    ).toBe(1);
  });

  it('multiple choice offers nothing to accept', async () => {
    await asTeacher(async () => {
      await server.post(`/api/admin/tests/${testId}/close`);
      const words = (await server.get(`/api/admin/tests/${testId}/words`)).body;
      for (const w of words) {
        await server.patch(`/api/admin/tests/${testId}/words/${w.id}`, { trickiness: 3 });
      }
      await server.patch(`/api/admin/tests/${testId}`, {
        mix: { translate_input: 0, mcq_translation: 100, mcq_definition: 0, fill_blank: 0 },
      });
      await server.post(`/api/admin/tests/${testId}/generate`);
      await server.post(`/api/admin/tests/${testId}/open`);
    });

    const qs = await questions();
    await sprint(0, [String((qs[0].payload.correctIndex + 1) % 4)]);

    const groups = await asTeacher(
      async () => (await server.get(`/api/admin/tests/${testId}/rejected-answers`)).body,
    );
    expect(groups).toEqual([]);

    const res = await asTeacher(() =>
      server.post(`/api/admin/tests/${testId}/accept-variant`, {
        questionId: qs[0].id,
        variant: 'anything',
        persist: true,
      }),
    );
    expect(res.status).toBe(409);
  });
});

describe('carrying words into the next test', () => {
  it('reports the correct rate over students who reached the question, not the whole class', async () => {
    const qs = await questions();
    // Lena answers the first two: one right, one wrong. Nobody else starts.
    await sprint(0, [qs[0].payload.accepted[0], 'wrong']);

    const candidates = await asTeacher(async () => {
      await server.post(`/api/admin/tests/${testId}/close`);
      const next = (await server.post('/api/admin/tests', { classId, title: 'Unit 4' })).body.id;
      return (
        await server.get(`/api/admin/tests/${next}/repeat-candidates?fromTestId=${testId}`)
      ).body;
    });

    const byWord = Object.fromEntries(
      candidates.map((c: { headwordEn: string }) => [c.headwordEn, c]),
    );
    const firstWord = qs[0].headwordEn;
    const secondWord = qs[1].headwordEn;

    expect(byWord[firstWord]).toMatchObject({ reachedCount: 1, correctRate: 100 });
    expect(byWord[secondWord]).toMatchObject({ reachedCount: 1, correctRate: 0 });
    // A word nobody reached is unknown, not a catastrophe.
    expect(byWord[qs[5].headwordEn]).toMatchObject({ reachedCount: 0, correctRate: null });
  });

  it('imports chosen words into a new test, tagged as repeats', async () => {
    const qs = await questions();

    const result = await asTeacher(async () => {
      await server.post(`/api/admin/tests/${testId}/close`);
      const next = (await server.post('/api/admin/tests', { classId, title: 'Unit 4' })).body.id;
      const res = await server.post(`/api/admin/tests/${next}/import-words`, {
        fromTestId: testId,
        wordIds: [qs[0].wordId, qs[1].wordId],
      });
      return { res, next };
    });

    expect(result.res.status).toBe(201);
    expect(result.res.body.added).toHaveLength(2);
    expect(result.res.body.added.every((w: { origin: string }) => w.origin === 'repeat')).toBe(true);
  });

  it('does not import a word the new test already has', async () => {
    const qs = await questions();

    const res = await asTeacher(async () => {
      await server.post(`/api/admin/tests/${testId}/close`);
      const next = (await server.post('/api/admin/tests', { classId, title: 'Unit 4' })).body.id;
      await server.post(`/api/admin/tests/${next}/words/paste`, { text: 'receive;bekommen' });
      return server.post(`/api/admin/tests/${next}/import-words`, {
        fromTestId: testId,
        wordIds: [qs[0].wordId, qs[1].wordId],
      });
    });

    const added = res.body.added.map((w: { headwordEn: string }) => w.headwordEn);
    expect(added).not.toContain('receive');
    expect(res.body.skipped).toBe(1);
  });

  it('lists earlier tests in the class as sources', async () => {
    const sources = await asTeacher(async () => {
      const next = (await server.post('/api/admin/tests', { classId, title: 'Unit 4' })).body.id;
      return (await server.get(`/api/admin/tests/${next}/repeat-sources`)).body;
    });
    expect(sources.map((t: { title: string }) => t.title)).toEqual(['Unit 3']);
  });

  it('will not take words from another teacher’s test', async () => {
    const res = await asTeacher(async () => {
      const next = (await server.post('/api/admin/tests', { classId, title: 'Unit 4' })).body.id;
      await server.signInAsTeacher('other@school.de', 'hunter2hunter2');
      return server.get(`/api/admin/tests/${next}/repeat-candidates?fromTestId=${testId}`);
    });
    expect(res.status).toBe(404);
  });
});
