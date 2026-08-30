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

async function key() {
  return asTeacher(
    async () => (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions,
  );
}

/** Runs one student through the sprint with the given answers, then hands in. */
async function sprint(index: number, answers: Array<'right' | 'wrong' | string>) {
  const questions = await key();
  const byId = new Map(questions.map((q: { id: string; payload: any }) => [q.id, q.payload]));

  server.clearCookies();
  await server.post('/api/s/session', { token: students[index]!.token });
  let state = (await server.post(`/api/s/tests/${testId}/start`)).body;

  for (const answer of answers) {
    if (!state.question) break;
    const payload = byId.get(state.question.id) as any;
    const given =
      answer === 'right'
        ? payload.accepted[0]
        : answer === 'wrong'
          ? 'definitely-not-it'
          : answer;
    state = (
      await server.post(`/api/s/attempts/${state.attempt.id}/answers`, {
        questionId: state.question.id,
        given,
      })
    ).body;
  }
  if (!state.attempt.submittedAt) {
    await server.post(`/api/s/attempts/${state.attempt.id}/submit`);
  }
}

async function stats() {
  return asTeacher(
    async () => (await server.get(`/api/admin/tests/${testId}/question-stats`)).body,
  );
}

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();

  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
  students = (
    await server.post(`/api/admin/classes/${classId}/students`, {
      names: 'Lena\nTom\nJonas\nMia',
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

describe('what the class knows', () => {
  it('is empty but not broken before anyone starts', async () => {
    const s = await stats();
    expect(s.studentsStarted).toBe(0);
    expect(s.medianReached).toBeNull();
    expect(s.troubleCount).toBe(0);
    expect(s.questions).toHaveLength(6);
    expect(s.questions.every((q: { correctRate: null }) => q.correctRate === null)).toBe(true);
  });

  it('counts a correct rate only over the students who reached the question', async () => {
    // Everyone answers Q1. Only Lena gets as far as Q4.
    await sprint(0, ['right', 'right', 'right', 'wrong']);
    await sprint(1, ['right']);
    await sprint(2, ['wrong']);

    const s = await stats();
    const q = (i: number) => s.questions.find((x: { orderIndex: number }) => x.orderIndex === i);

    // Q1: three reached, two right.
    expect(q(0)).toMatchObject({ reachedCount: 3, correctCount: 2, correctRate: 67 });
    // Q4: one reached, none right — 0%, not "everyone failed".
    expect(q(3)).toMatchObject({ reachedCount: 1, correctCount: 0, correctRate: 0 });
    // Q5: nobody reached it. Unknown, not zero.
    expect(q(4)).toMatchObject({ reachedCount: 0, correctRate: null });
  });

  it('does not let unreached questions look like failures', async () => {
    // One student answers only the first question, correctly.
    await sprint(0, ['right']);

    const s = await stats();
    const unreached = s.questions.filter((q: { correctRate: null }) => q.correctRate === null);

    expect(unreached).toHaveLength(5);
    // The whole point: a word nobody saw is not counted against anyone.
    expect(s.troubleCount).toBe(0);
  });

  it('flags a word most of the class got wrong', async () => {
    // Four students, all reach the first three; all fluff the second.
    for (let i = 0; i < 4; i++) await sprint(i, ['right', 'wrong', 'right']);

    const s = await stats();
    const q2 = s.questions.find((x: { orderIndex: number }) => x.orderIndex === 1);

    expect(q2.correctRate).toBe(0);
    expect(s.troubleCount).toBe(1);
  });

  it('needs more than a couple of students before calling a word trouble', async () => {
    // Two students get it wrong — real, but too thin to act on.
    await sprint(0, ['wrong']);
    await sprint(1, ['wrong']);

    const s = await stats();
    expect(s.questions[0].correctRate).toBe(0);
    expect(s.troubleCount).toBe(0);
  });

  it('reports what students actually wrote instead', async () => {
    await sprint(0, ['recieve']);
    await sprint(1, ['recieve']);
    await sprint(2, ['getting']);

    const s = await stats();
    const q1 = s.questions.find((x: { orderIndex: number }) => x.orderIndex === 0);

    expect(q1.commonWrong[0]).toEqual({ given: 'recieve', count: 2 });
    expect(q1.commonWrong.map((w: { given: string }) => w.given)).toContain('getting');
  });

  it('groups differently-cased spellings as one wrong answer', async () => {
    await sprint(0, ['recieve']);
    await sprint(1, ['Recieve']);

    const s = await stats();
    const q1 = s.questions.find((x: { orderIndex: number }) => x.orderIndex === 0);
    expect(q1.commonWrong).toHaveLength(1);
    expect(q1.commonWrong[0].count).toBe(2);
  });

  it('reports how far the typical student got', async () => {
    await sprint(0, ['right', 'right', 'right', 'right', 'right']);
    await sprint(1, ['right', 'right', 'right']);
    await sprint(2, ['right']);

    const s = await stats();
    expect(s.studentsStarted).toBe(3);
    expect(s.studentsSubmitted).toBe(3);
    expect(s.medianReached).toBe(3);
  });

  it('says nothing about multiple choice under "what they wrote"', async () => {
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

    const questions = await key();
    const first = questions[0];
    server.clearCookies();
    await server.post('/api/s/session', { token: students[0]!.token });
    const started = await server.post(`/api/s/tests/${testId}/start`);
    await server.post(`/api/s/attempts/${started.body.attempt.id}/answers`, {
      questionId: started.body.question.id,
      given: String((first.payload.correctIndex + 1) % 4),
    });

    const s = await stats();
    const q1 = s.questions.find((x: { orderIndex: number }) => x.orderIndex === 0);
    expect(q1.correctRate).toBe(0);
    // An option index is not a spelling worth reporting back.
    expect(q1.commonWrong).toEqual([]);
  });

  it('ignores practice runs, which are not measurement', async () => {
    await sprint(0, ['right', 'right']);
    await asTeacher(() => server.post(`/api/admin/tests/${testId}/close`));

    // A practice run afterwards must not move the class figures.
    server.clearCookies();
    await server.post('/api/s/session', { token: students[1]!.token });
    const practice = await server.post(`/api/s/tests/${testId}/practice`);
    await server.post(`/api/s/attempts/${practice.body.attempt.id}/answers`, {
      questionId: practice.body.question.id,
      given: 'nonsense',
    });

    const s = await stats();
    expect(s.studentsStarted).toBe(1);
    const total = s.questions.reduce(
      (sum: number, q: { reachedCount: number }) => sum + q.reachedCount,
      0,
    );
    expect(total).toBe(2);
  });

  it('is refused for another teacher’s test', async () => {
    await server.signInAsTeacher('other@school.de', 'hunter2hunter2');
    expect((await server.get(`/api/admin/tests/${testId}/question-stats`)).status).toBe(404);
  });
});
