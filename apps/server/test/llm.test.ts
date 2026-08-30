import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import { startMockLlm, type MockLlm } from './mock-llm.js';
import { extractJson } from '../src/services/llm/client.js';

let server: TestServer;
let llm: MockLlm;
let classId: string;
let testId: string;

const TEXT = `She was reluctant to answer the question, but nevertheless she did.
He wanted to become a teacher.`;

/** Polls a job to completion the way the admin UI does. */
async function awaitJob(jobId: string) {
  for (let i = 0; i < 200; i++) {
    const res = await server.get(`/api/admin/jobs/${jobId}`);
    if (res.body.status === 'done' || res.body.status === 'error') return res.body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job never finished');
}

beforeEach(async () => {
  server = await TestServer.start();
  llm = await startMockLlm();
  await server.signInAsTeacher();

  await server.request('PUT', '/api/admin/settings/llm', {
    baseUrl: llm.baseUrl,
    apiKey: 'test-key',
    model: 'test-model',
  });

  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
  testId = (await server.post('/api/admin/tests', { classId, title: 'Unit 3' })).body.id;
  await server.patch(`/api/admin/tests/${testId}`, { sourceText: TEXT });
});

afterEach(async () => {
  await llm.stop();
  await server.stop();
});

describe('extractJson', () => {
  it('unwraps a fenced code block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips chatter around the object', () => {
    expect(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.')).toBe('{"a":1}');
  });

  it('leaves clean JSON alone', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
});

describe('settings', () => {
  it('never sends the API key back to the client', async () => {
    const res = await server.get('/api/admin/settings/llm');
    expect(res.body).toMatchObject({ model: 'test-model', hasApiKey: true, configured: true });
    expect(JSON.stringify(res.body)).not.toContain('test-key');
  });

  it('reports not configured when there is no key', async () => {
    await server.request('PUT', '/api/admin/settings/llm', { apiKey: '' });
    const res = await server.get('/api/admin/settings/llm');
    expect(res.body).toMatchObject({ hasApiKey: false, configured: false });
  });

  it('tests the connection', async () => {
    const res = await server.post('/api/admin/settings/llm/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('reports a provider error in language a teacher can act on', async () => {
    llm.failNext(401, '{"error":"invalid key"}');
    const res = await server.post('/api/admin/settings/llm/test');
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Check the model name and API key');
  });
});

describe('the model catalogue', () => {
  it('lists what the provider offers, slimmed to what a chooser needs', async () => {
    const res = await server.get('/api/admin/settings/llm/models');
    expect(res.status).toBe(200);

    const byId = Object.fromEntries(res.body.models.map((m: { id: string }) => [m.id, m]));
    expect(byId['anthropic/claude-sonnet-4.5']).toEqual({
      id: 'anthropic/claude-sonnet-4.5',
      name: 'Anthropic: Claude Sonnet 4.5',
      contextLength: 200000,
      vision: true,
      promptPricePerMillion: 3,
    });
  });

  it('understands both ways a provider can describe image support', async () => {
    const byId = Object.fromEntries(
      (await server.get('/api/admin/settings/llm/models')).body.models.map((m: { id: string }) => [
        m.id,
        m,
      ]),
    );
    // input_modalities array, and the older "text+image->text" string.
    expect(byId['anthropic/claude-sonnet-4.5'].vision).toBe(true);
    expect(byId['legacy/vision-1'].vision).toBe(true);
    expect(byId['meta/llama-3-70b'].vision).toBe(false);
  });

  it('copes with a bare entry and skips one with no id', async () => {
    const models = (await server.get('/api/admin/settings/llm/models')).body.models;

    expect(models.find((m: { id: string }) => m.id === 'local/bare-model')).toEqual({
      id: 'local/bare-model',
      name: 'local/bare-model', // falls back to the id
      contextLength: null,
      vision: false,
      promptPricePerMillion: null,
    });
    expect(models).toHaveLength(4);
  });

  it('reports a free model as zero rather than unknown', async () => {
    const models = (await server.get('/api/admin/settings/llm/models')).body.models;
    const llama = models.find((m: { id: string }) => m.id === 'meta/llama-3-70b');
    expect(llama.promptPricePerMillion).toBe(0);
  });

  it('explains a provider that refuses to list', async () => {
    llm.failNext(401, '{"error":"needs a key"}');
    const res = await server.get('/api/admin/settings/llm/models');

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Check the URL');
  });

  it('can be browsed with a URL that has not been saved yet', async () => {
    // Point the stored config somewhere useless, then pass the real one.
    await server.request('PUT', '/api/admin/settings/llm', { baseUrl: 'https://nowhere.invalid/v1' });
    const res = await server.get(
      `/api/admin/settings/llm/models?baseUrl=${encodeURIComponent(llm.baseUrl)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.models.length).toBeGreaterThan(0);
  });

  it('is admin-only, like the rest of the model settings', async () => {
    const invite = (await server.post('/api/admin/team/invites', { email: 'plain@school.de' })).body;
    server.clearCookies();
    await server.post(`/api/invites/${invite.id}/accept`, { password: 'a-long-enough-password' });

    expect((await server.get('/api/admin/settings/llm/models')).status).toBe(403);
  });
});

describe('AI buttons without a key', () => {
  it('refuse rather than failing silently, and point at the manual path', async () => {
    await server.request('PUT', '/api/admin/settings/llm', { apiKey: '' });
    const res = await server.post(`/api/admin/tests/${testId}/extract-words`, {});
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('build the test by hand');
  });
});

describe('pass 1 — extracting words', () => {
  it('stores difficulty and trickiness as independent signals', async () => {
    const started = await server.post(`/api/admin/tests/${testId}/extract-words`, { level: 'B1' });
    expect(started.status).toBe(202);
    const job = await awaitJob(started.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result.added).toBe(3);

    const words = (await server.get(`/api/admin/tests/${testId}/words`)).body;
    const byWord = Object.fromEntries(words.map((w: { headwordEn: string }) => [w.headwordEn, w]));

    // "become" is easy but a total trap; "nevertheless" is hard but honest.
    expect(byWord['become']).toMatchObject({ difficulty: 2, trickiness: 3, trickinessKind: 'false_friend' });
    expect(byWord['nevertheless']).toMatchObject({ difficulty: 8, trickiness: 0 });
    expect(byWord['become'].trickinessNote).toContain('bekommen');
    expect(byWord['reluctant'].acceptedEn).toEqual(['unwilling']);
    expect(byWord['nevertheless'].suitsFillBlank).toBe(false);
  });

  it('tells the model the level and the audience', async () => {
    await awaitJob((await server.post(`/api/admin/tests/${testId}/extract-words`, { level: 'B2' })).body.jobId);
    const request = llm.requests.at(-1)!;
    expect(request.system).toContain('German secondary-school students');
    expect(request.user).toContain('ABOVE the B2 level');
  });

  it('does not add a word the list already has', async () => {
    await awaitJob((await server.post(`/api/admin/tests/${testId}/extract-words`, {})).body.jobId);
    const second = await awaitJob(
      (await server.post(`/api/admin/tests/${testId}/extract-words`, {})).body.jobId,
    );
    expect(second.result.added).toBe(0);
    expect((await server.get(`/api/admin/tests/${testId}/words`)).body).toHaveLength(3);
  });

  it('refuses when there is no text yet', async () => {
    const empty = (await server.post('/api/admin/tests', { classId, title: 'Empty' })).body.id;
    const job = await awaitJob(
      (await server.post(`/api/admin/tests/${empty}/extract-words`, {})).body.jobId,
    );
    expect(job.status).toBe('error');
    expect(job.error).toContain('Add the text first');
  });

  it('retries once when the model replies with rubbish, then gives up cleanly', async () => {
    llm.enqueue('not json at all');
    llm.enqueue('{"words": "should be an array"}');

    const job = await awaitJob(
      (await server.post(`/api/admin/tests/${testId}/extract-words`, {})).body.jobId,
    );
    expect(job.status).toBe('error');
    expect(job.error).toContain('could not produce the expected format');
    expect(llm.requests).toHaveLength(2);
  });

  it('recovers when the second attempt is valid', async () => {
    llm.enqueue('total nonsense');
    const job = await awaitJob(
      (await server.post(`/api/admin/tests/${testId}/extract-words`, {})).body.jobId,
    );
    expect(job.status).toBe('done');
    // The retry is told exactly what was wrong.
    expect(llm.requests[1]!.user).toContain('Your last reply could not be used');
  });
});

describe('pass 2 — writing questions', () => {
  beforeEach(async () => {
    await awaitJob((await server.post(`/api/admin/tests/${testId}/extract-words`, {})).body.jobId);
    llm.requests.length = 0;
  });

  it('groups requests by format so each call has one output shape', async () => {
    await server.patch(`/api/admin/tests/${testId}`, {
      mix: { translate_input: 0, mcq_translation: 50, mcq_definition: 0, fill_blank: 50 },
    });
    const job = await awaitJob(
      (await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId,
    );
    expect(job.status).toBe('done');

    const systems = llm.requests.map((r) => r.system);
    // Never one mixed request: each is distractors, or definitions, or gaps.
    for (const system of systems) {
      const kinds = ['wrong answers', 'definitions', 'gap-fill'].filter((k) => system.includes(k));
      expect(kinds).toHaveLength(1);
    }
  });

  it('feeds the false-friend trap into the distractor prompt', async () => {
    await server.patch(`/api/admin/tests/${testId}`, {
      mix: { translate_input: 0, mcq_translation: 100, mcq_definition: 0, fill_blank: 0 },
    });
    await awaitJob((await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId);

    const distractorCall = llm.requests.find((r) => r.system.includes('wrong answers'));
    expect(distractorCall!.user).toContain('bekommen');
    expect(distractorCall!.user).toContain('trap:');
  });

  it('gives multiple choice to traps and to hard words, but not to easy ones', async () => {
    await server.patch(`/api/admin/tests/${testId}`, {
      mix: { translate_input: 0, mcq_translation: 100, mcq_definition: 0, fill_blank: 0 },
    });
    await awaitJob((await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId);

    const questions = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions;
    const mcqs = questions
      .filter((q: { type: string }) => q.type === 'mcq_translation')
      .map((q: { headwordEn: string }) => q.headwordEn);

    // "become" is difficulty 2 — far below the hard end of this list. It gets
    // multiple choice purely because it is a false friend, which is the rule
    // that matters: a trap qualifies however easy the word is.
    expect(mcqs).toContain('become');
    // "nevertheless" (8) and "reluctant" (6) are the hard end of a 2–8 spread.
    expect(mcqs).toContain('nevertheless');
    expect(questions).toHaveLength(3);
  });

  it('rejects a definition that contains the word it defines', async () => {
    await server.patch(`/api/admin/tests/${testId}`, {
      mix: { translate_input: 0, mcq_translation: 0, mcq_definition: 100, fill_blank: 0 },
    });
    const words = (await server.get(`/api/admin/tests/${testId}/words`)).body;
    for (const w of words) {
      await server.patch(`/api/admin/tests/${testId}/words/${w.id}`, { difficulty: 9 });
    }

    llm.enqueue(
      JSON.stringify({
        items: [
          { headword: 'reluctant', definition: 'being reluctant about a thing', distractors: ['a', 'b', 'c'] },
        ],
      }),
    );
    await awaitJob((await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId);

    const questions = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions;
    const reluctant = questions.find((q: { headwordEn: string }) => q.headwordEn === 'reluctant');
    expect(reluctant.type).toBe('translate_input');
  });

  it('rejects a gap sentence that does not have exactly one gap', async () => {
    await server.patch(`/api/admin/tests/${testId}`, {
      mix: { translate_input: 0, mcq_translation: 0, mcq_definition: 0, fill_blank: 100 },
    });
    llm.enqueue(
      JSON.stringify({
        items: [
          { headword: 'reluctant', sentence: 'No gap at all here.', accepted: ['reluctant'] },
          { headword: 'become', sentence: 'A ___ and another ___.', accepted: ['become'] },
        ],
      }),
    );
    await awaitJob((await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId);

    const questions = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions;
    expect(questions.every((q: { type: string }) => q.type !== 'fill_blank')).toBe(true);
    // Nothing is lost — every word still has a question.
    expect(questions).toHaveLength(3);
  });

  it('reports what the model could not manage', async () => {
    await server.patch(`/api/admin/tests/${testId}`, {
      mix: { translate_input: 0, mcq_translation: 0, mcq_definition: 0, fill_blank: 100 },
    });
    llm.enqueue(JSON.stringify({ items: [] }));
    const job = await awaitJob(
      (await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId,
    );

    const reasons = job.result.shortfalls.map((s: { reason: string }) => s.reason).join(' ');
    expect(reasons).toContain('could not write a usable question');
  });

  it('always produces exactly one question per included word', async () => {
    await awaitJob((await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId);
    const questions = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions;

    expect(questions).toHaveLength(3);
    expect(new Set(questions.map((q: { wordId: string }) => q.wordId)).size).toBe(3);
    expect(questions.map((q: { orderIndex: number }) => q.orderIndex)).toEqual([0, 1, 2]);
  });
});

describe('regenerating one question', () => {
  beforeEach(async () => {
    await awaitJob((await server.post(`/api/admin/tests/${testId}/extract-words`, {})).body.jobId);
    await awaitJob((await server.post(`/api/admin/tests/${testId}/generate-questions`, {})).body.jobId);
  });

  it('rewrites a question in place', async () => {
    const before = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions[0];
    const res = await server.post(
      `/api/admin/tests/${testId}/questions/${before.id}/regenerate`,
      {},
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(before.id);
  });

  it('switches a question to a different format', async () => {
    const before = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions.find(
      (q: { type: string }) => q.type === 'translate_input',
    );
    const res = await server.post(`/api/admin/tests/${testId}/questions/${before.id}/regenerate`, {
      type: 'fill_blank',
    });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('fill_blank');
    expect(res.body.payload.sentence).toContain('___');
  });

  it('needs no API key to fall back to a typed translation', async () => {
    const before = (await server.get(`/api/admin/tests/${testId}/questions`)).body.questions[0];
    await server.request('PUT', '/api/admin/settings/llm', { apiKey: '' });

    const res = await server.post(`/api/admin/tests/${testId}/questions/${before.id}/regenerate`, {
      type: 'translate_input',
    });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('translate_input');
  });
});

describe('transcribing an image', () => {
  it('sends the picture and returns the text for the teacher to check', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const job = await awaitJob(
      (await server.post(`/api/admin/tests/${testId}/transcribe`, { images: [dataUri] })).body.jobId,
    );

    expect(job.status).toBe('done');
    expect(job.result.text).toContain('reluctant');
    expect(llm.requests.at(-1)!.hasImages).toBe(true);
  });

  it('rejects anything that is not an image data URI', async () => {
    const res = await server.post(`/api/admin/tests/${testId}/transcribe`, {
      images: ['https://example.com/page.png'],
    });
    expect(res.status).toBe(400);
  });
});
