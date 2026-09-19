import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import type { DueWord } from '@voku/shared';

let server: TestServer;
let classId: string;

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();
  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
});
afterEach(async () => {
  await server.stop();
});

/**
 * A closed unit, backdated so spacing has something to measure.
 *
 * Carries a filler word because a test will not open unless its pool is bigger
 * than the target; the filler is removed once the unit is over, so it cannot
 * turn up in anyone's revision list.
 */
async function pastUnit(title: string, words: string, daysAgo: number): Promise<string> {
  const id = (await server.post('/api/admin/tests', { classId, title })).body.id as string;
  await server.post(`/api/admin/tests/${id}/words/paste`, {
    text: `${words}\nfiller;Füllwort`,
  });
  await server.patch(`/api/admin/tests/${id}`, { targetCount: 1 });
  await server.post(`/api/admin/tests/${id}/generate`);
  await server.post(`/api/admin/tests/${id}/publish`);
  await server.post(`/api/admin/tests/${id}/open`);
  await server.post(`/api/admin/tests/${id}/close`);

  server.db.run(`DELETE FROM test_words WHERE test_id = :id AND headword_en = 'filler'`, { id });
  server.db.run('UPDATE tests SET closed_at = :at WHERE id = :id', {
    at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    id,
  });
  return id;
}

async function newTest(title = 'Unit 9'): Promise<string> {
  return (await server.post('/api/admin/tests', { classId, title })).body.id as string;
}

async function due(testId: string): Promise<DueWord[]> {
  return (await server.get<DueWord[]>(`/api/admin/tests/${testId}/due-words`)).body;
}

/**
 * One answer to the word in a unit, as though a student had sat it.
 *
 * Inserted rather than played through the API because a closed test cannot be
 * answered any more, and what is under test is the counting, not the route.
 */
function answerWord(
  testId: string,
  headword: string,
  opts: { mode: 'graded' | 'practice'; correct: boolean },
): void {
  const question = server.db.get<{ id: string }>(
    `SELECT q.id FROM questions q
       JOIN test_words w ON w.id = q.word_id
      WHERE w.test_id = :t AND w.headword_en = :h
      LIMIT 1`,
    { t: testId, h: headword },
  )!;
  const student = `stu-${opts.mode}-${headword}`;
  const attempt = `att-${opts.mode}-${headword}`;
  server.db.run(
    `INSERT OR IGNORE INTO students (id, class_id, name, token, created_at)
     VALUES (:id, :class, :name, :token, :now)`,
    { id: student, class: classId, name: 'Mara', token: `tok-${student}`, now: new Date().toISOString() },
  );
  server.db.run(
    `INSERT INTO attempts (id, test_id, student_id, mode, started_at, target_snapshot)
     VALUES (:id, :test, :student, :mode, :now, 1)`,
    { id: attempt, test: testId, student, mode: opts.mode, now: new Date().toISOString() },
  );
  server.db.run(
    `INSERT INTO answers (id, attempt_id, question_id, given_text, is_correct, answered_at)
     VALUES (:id, :attempt, :question, :given, :correct, :now)`,
    {
      id: `ans-${attempt}`,
      attempt,
      question: question.id,
      given: opts.correct ? headword : 'nonsense',
      correct: opts.correct ? 1 : 0,
      now: new Date().toISOString(),
    },
  );
}

describe('which words are due to come round again', () => {
  it('offers a word from a unit long past, and holds back one from last week', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);
    await pastUnit('Unit 2', 'thorough;gründlich', 3);
    const next = await newTest();

    const list = await due(next);
    const byWord = Object.fromEntries(list.map((w) => [w.headwordEn, w]));

    // First outing, so the gap is about ten days.
    expect(byWord['ambush']!.dueInDays).toBeLessThan(0);
    expect(byWord['thorough']!.dueInDays).toBeGreaterThan(0);
    // The overdue one sorts first, which is what the teacher sees at the top.
    expect(list[0]!.headwordEn).toBe('ambush');
  });

  it('says which unit a word came from, and how long ago', async () => {
    await pastUnit('Unit 3 — Weather', 'ambush;Hinterhalt', 20);
    const list = await due(await newTest());

    expect(list[0]).toMatchObject({
      headwordEn: 'ambush',
      translationDe: 'Hinterhalt',
      fromTestTitle: 'Unit 3 — Weather',
      timesTested: 1,
      daysSince: 20,
    });
  });

  // The whole point of spacing: each time round buys more time than the last.
  it('waits longer each time a word has been round', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 30);
    const twice = await newTest('Unit 2');
    const onceOnly = await due(twice);
    expect(onceOnly[0]!.dueInDays).toBeLessThan(0);

    // Carry it into a second unit, close that too, and ask again at the same remove.
    await server.post(`/api/admin/tests/${twice}/import-words`, {
      wordIds: [onceOnly[0]!.wordId],
    });
    await server.post(`/api/admin/tests/${twice}/words/paste`, { text: 'filler;Füllwort' });
    await server.patch(`/api/admin/tests/${twice}`, { targetCount: 1 });
    await server.post(`/api/admin/tests/${twice}/generate`);
    await server.post(`/api/admin/tests/${twice}/publish`);
    await server.post(`/api/admin/tests/${twice}/open`);
    await server.post(`/api/admin/tests/${twice}/close`);
    server.db.run(`DELETE FROM test_words WHERE test_id = :id AND headword_en = 'filler'`, {
      id: twice,
    });
    server.db.run('UPDATE tests SET closed_at = :at WHERE id = :id', {
      at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      id: twice,
    });

    const list = await due(await newTest('Unit 3'));
    const word = list.find((w) => w.headwordEn === 'ambush')!;
    expect(word.timesTested).toBe(2);
    // Same thirty days, one outing more: it can wait longer than it could before.
    // Stated as a comparison rather than a threshold, because the thresholds are
    // tuning and this is the decision.
    expect(word.dueInDays).toBeGreaterThan(onceOnly[0]!.dueInDays);
  });

  it('leaves out a word the test being built already has', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt\nthorough;gründlich', 40);
    const next = await newTest();
    await server.post(`/api/admin/tests/${next}/words/paste`, { text: 'ambush;Hinterhalt' });

    const list = await due(next);
    expect(list.map((w) => w.headwordEn)).toEqual(['thorough']);
  });

  // An open or draft unit is not finished, so there is nothing to judge yet.
  it('draws only on units that are over', async () => {
    const id = (await server.post('/api/admin/tests', { classId, title: 'Draft' })).body.id;
    await server.post(`/api/admin/tests/${id}/words/paste`, { text: 'ambush;Hinterhalt' });

    expect(await due(await newTest())).toEqual([]);
  });

  it('keeps one class out of another’s revision', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);
    const otherClass = (await server.post('/api/admin/classes', { name: '9c' })).body.id;
    const theirTest = (await server.post('/api/admin/tests', { classId: otherClass, title: 'X' }))
      .body.id;

    expect(await due(theirTest)).toEqual([]);
  });

  it('will not show another teacher’s classes', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);
    const next = await newTest();
    await server.signInAsTeacher('other@school.de', 'hunter2hunter2');

    expect((await server.get(`/api/admin/tests/${next}/due-words`)).status).toBe(404);
  });
});

describe('taking the due words into the new test', () => {
  it('imports from several earlier units in one go', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);
    await pastUnit('Unit 2', 'thorough;gründlich', 40);
    const next = await newTest();

    const list = await due(next);
    expect(list).toHaveLength(2);

    const res = await server.post(`/api/admin/tests/${next}/import-words`, {
      wordIds: list.map((w) => w.wordId),
    });
    expect(res.status).toBe(201);
    expect(res.body.added).toHaveLength(2);
  });

  // The label the class sees: which unit this word is back from.
  it('remembers which unit each word came back from', async () => {
    await pastUnit('Unit 3 — Weather', 'ambush;Hinterhalt', 40);
    const next = await newTest();
    const list = await due(next);

    const added = (
      await server.post(`/api/admin/tests/${next}/import-words`, {
        wordIds: [list[0]!.wordId],
      })
    ).body.added;

    expect(added[0].origin).toBe('repeat');
    expect(added[0].repeatedFrom).toMatchObject({ title: 'Unit 3 — Weather' });
  });

  it('is a suggestion only — nothing arrives on its own', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);
    const next = await newTest();

    expect((await due(next)).length).toBeGreaterThan(0);
    expect((await server.get(`/api/admin/tests/${next}/words`)).body).toEqual([]);
  });

  /** Builds a test carrying one repeat and one new word, ready for the class. */
  async function unitWithARepeat(): Promise<{ testId: string; token: string }> {
    await pastUnit('Unit 3 — Weather', 'ambush;Hinterhalt', 40);
    const testId = await newTest('Unit 4');
    const list = await due(testId);
    await server.post(`/api/admin/tests/${testId}/import-words`, { wordIds: [list[0]!.wordId] });
    await server.post(`/api/admin/tests/${testId}/words/paste`, { text: 'weary;müde\nvivid;lebhaft' });
    await server.patch(`/api/admin/tests/${testId}`, { targetCount: 1 });
    await server.post(`/api/admin/tests/${testId}/generate`);
    await server.post(`/api/admin/tests/${testId}/publish`);

    const token = (
      await server.post(`/api/admin/classes/${classId}/students`, { names: 'Lena Berger' })
    ).body.added[0].token as string;
    return { testId, token };
  }

  it('tells the class which words are coming back, and from where', async () => {
    const { testId, token } = await unitWithARepeat();

    server.clearCookies();
    await server.post('/api/s/session', { token });
    const study = (await server.get(`/api/s/tests/${testId}/words`)).body;
    const drill = (await server.get(`/api/s/tests/${testId}/drill`)).body;

    const carried = study.words.find((w: { headwordEn: string }) => w.headwordEn === 'ambush');
    const fresh = study.words.find((w: { headwordEn: string }) => w.headwordEn === 'weary');
    expect(carried.repeatedFrom).toBe('Unit 3 — Weather');
    expect(fresh.repeatedFrom).toBeNull();

    expect(drill.items.some((i: { repeatedFrom: string | null }) => i.repeatedFrom === 'Unit 3 — Weather')).toBe(true);
  });

  it('prints the revision column only when something is coming back', async () => {
    const { testId } = await unitWithARepeat();
    const withRepeat = (await server.get(`/api/admin/tests/${testId}/worksheet`)).body;
    expect(withRepeat.columns).toContain('from');
    expect(withRepeat.rows.find((r: { word: string }) => r.word === 'ambush').from).toBe(
      'from Unit 3 — Weather',
    );
    expect(withRepeat.rows.find((r: { word: string }) => r.word === 'weary').from).toBe('');

    // A sheet of nothing but new words gets no column to explain.
    const plain = await newTest('Unit 5');
    await server.post(`/api/admin/tests/${plain}/words/paste`, { text: 'weary;müde' });
    const noRepeat = (await server.get(`/api/admin/tests/${plain}/worksheet`)).body;
    expect(noRepeat.columns).not.toContain('from');
  });

  /**
   * Practice is unlimited and unmarked, so counting it would let a class that
   * revised hard look like a class that knew the words — and the schedule would
   * push those words further away for exactly the wrong reason. This is the
   * decision, stated as a test.
   */
  it('judges a word on the graded test only, and ignores how practice went', async () => {
    const unit = await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);
    answerWord(unit, 'ambush', { mode: 'graded', correct: false });
    answerWord(unit, 'ambush', { mode: 'practice', correct: true });

    const [word] = await due(await newTest());

    // One graded answer, and it was wrong. Not two answers at 50%.
    expect(word!.correctRate).toBe(0);
    // Struggled, so it comes back sooner than the ten-day base gap.
    expect(word!.dueInDays).toBeLessThan(10 - 40);
  });

  it('still offers a word nobody ever reached, which has no rate at all', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);

    const [word] = await due(await newTest());

    // The outer joins exist for this: no answers must not mean no word.
    expect(word!.headwordEn).toBe('ambush');
    expect(word!.correctRate).toBeNull();
  });

  it('will not import a word from another teacher’s class', async () => {
    await pastUnit('Unit 1', 'ambush;Hinterhalt', 40);
    const mine = await due(await newTest());
    const wordId = mine[0]!.wordId;

    await server.signInAsTeacher('other@school.de', 'hunter2hunter2');
    const theirClass = (await server.post('/api/admin/classes', { name: '9c' })).body.id;
    const theirTest = (await server.post('/api/admin/tests', { classId: theirClass, title: 'X' }))
      .body.id;

    const res = await server.post(`/api/admin/tests/${theirTest}/import-words`, { wordIds: [wordId] });
    expect(res.status).toBe(404);
  });
});
