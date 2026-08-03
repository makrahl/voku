import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import { TEACHER_COOKIE } from '../src/middleware/auth.js';
import { setupCode } from '../src/services/team.js';

let server: TestServer;

beforeEach(async () => {
  server = await TestServer.start();
});
afterEach(async () => {
  await server.stop();
});

const STRONG = 'a-long-enough-password';

describe('first run', () => {
  it('reports itself unclaimed and does not leak the setup code', async () => {
    const status = await server.get('/api/setup/status');
    expect(status.body).toEqual({ claimed: false });
    expect(JSON.stringify(status.body)).not.toContain('-');
  });

  it('refuses to claim without the right code', async () => {
    const res = await server.post('/api/setup/claim', {
      code: 'WRON-GCOD-EEEE',
      email: 'head@school.de',
      password: STRONG,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('server log');
    expect((await server.get('/api/setup/status')).body.claimed).toBe(false);
  });

  it('claims with the printed code, becomes admin, and signs straight in', async () => {
    const code = setupCode(server.db)!;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const res = await server.post('/api/setup/claim', {
      code: code.toLowerCase(), // case-insensitive, because people retype it
      email: 'Head@School.de',
      password: STRONG,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'head@school.de', isAdmin: true });
    expect(server.cookie(TEACHER_COOKIE)).toBeTruthy();
    expect((await server.get('/api/admin/auth/me')).body.isAdmin).toBe(true);
  });

  it('rejects a weak password at setup', async () => {
    const code = setupCode(server.db)!;
    const res = await server.post('/api/setup/claim', {
      code,
      email: 'head@school.de',
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('cannot be claimed twice', async () => {
    const code = setupCode(server.db)!;
    await server.post('/api/setup/claim', { code, email: 'head@school.de', password: STRONG });

    const second = await server.post('/api/setup/claim', {
      code,
      email: 'someone@else.de',
      password: STRONG,
    });
    expect(second.status).toBe(409);
    expect((await server.get('/api/setup/status')).body.claimed).toBe(true);
  });

  it('destroys the setup code once claimed', async () => {
    const code = setupCode(server.db)!;
    await server.post('/api/setup/claim', { code, email: 'head@school.de', password: STRONG });
    expect(setupCode(server.db)).toBeNull();
  });

  it('keeps the same code across restarts while still unclaimed', () => {
    expect(setupCode(server.db)).toBe(setupCode(server.db));
  });
});

describe('inviting colleagues', () => {
  beforeEach(async () => {
    const code = setupCode(server.db)!;
    await server.post('/api/setup/claim', { code, email: 'head@school.de', password: STRONG });
  });

  it('returns a link rather than sending mail', async () => {
    const res = await server.post('/api/admin/team/invites', { email: 'Frau.Mueller@school.de' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('frau.mueller@school.de');
    expect(res.body.isAdmin).toBe(false);
    expect(res.body.url).toMatch(/^http:\/\/localhost:3000\/admin\/invite\/[\w-]+$/);
    expect(res.body.expired).toBe(false);
  });

  it('lets the invitee see who the invite is for before committing', async () => {
    const invite = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;
    server.clearCookies();

    const preview = await server.get(`/api/invites/${invite.id}`);
    expect(preview.body).toEqual({ email: 'new@school.de', isAdmin: false });
  });

  it('creates the account on acceptance and signs them in', async () => {
    const invite = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;
    server.clearCookies();

    const accepted = await server.post(`/api/invites/${invite.id}/accept`, { password: STRONG });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ email: 'new@school.de', isAdmin: false });

    const me = await server.get('/api/admin/auth/me');
    expect(me.body.email).toBe('new@school.de');
  });

  it('carries the admin flag through the invite', async () => {
    const invite = (
      await server.post('/api/admin/team/invites', { email: 'deputy@school.de', isAdmin: true })
    ).body;
    server.clearCookies();

    const accepted = await server.post(`/api/invites/${invite.id}/accept`, { password: STRONG });
    expect(accepted.body.isAdmin).toBe(true);
  });

  it('burns the invitation — the same link cannot be used twice', async () => {
    const invite = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;
    server.clearCookies();
    await server.post(`/api/invites/${invite.id}/accept`, { password: STRONG });

    const again = await server.post(`/api/invites/${invite.id}/accept`, { password: STRONG });
    expect(again.status).toBe(404);
  });

  it('refuses an expired invitation', async () => {
    const invite = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;
    server.db.run('UPDATE invites SET expires_at = :past WHERE id = :id', {
      past: new Date(Date.now() - 1000),
      id: invite.id,
    });
    server.clearCookies();

    const res = await server.post(`/api/invites/${invite.id}/accept`, { password: STRONG });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('expired');
  });

  it('rejects a made-up token', async () => {
    server.clearCookies();
    expect((await server.get('/api/invites/not-a-real-token')).status).toBe(404);
  });

  it('will not invite an email that already has an account', async () => {
    const res = await server.post('/api/admin/team/invites', { email: 'head@school.de' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already has an account');
  });

  it('re-inviting replaces the outstanding link instead of leaving two live', async () => {
    const first = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;
    const second = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;

    expect(second.id).not.toBe(first.id);
    expect((await server.get('/api/admin/team')).body.invites).toHaveLength(1);

    server.clearCookies();
    expect((await server.get(`/api/invites/${first.id}`)).status).toBe(404);
    expect((await server.get(`/api/invites/${second.id}`)).status).toBe(200);
  });

  it('revokes an open invitation', async () => {
    const invite = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;
    expect((await server.delete(`/api/admin/team/invites/${invite.id}`)).status).toBe(204);

    server.clearCookies();
    expect((await server.get(`/api/invites/${invite.id}`)).status).toBe(404);
  });

  it('drops an accepted invite off the open list', async () => {
    const invite = (await server.post('/api/admin/team/invites', { email: 'new@school.de' })).body;
    server.clearCookies();
    await server.post(`/api/invites/${invite.id}/accept`, { password: STRONG });

    await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
    expect((await server.get('/api/admin/team')).body.invites).toEqual([]);
    expect((await server.get('/api/admin/team')).body.teachers).toHaveLength(2);
  });
});

describe('who may manage the team', () => {
  let plainTeacherCookie: string;

  beforeEach(async () => {
    const code = setupCode(server.db)!;
    await server.post('/api/setup/claim', { code, email: 'head@school.de', password: STRONG });
    const invite = (await server.post('/api/admin/team/invites', { email: 'plain@school.de' })).body;

    server.clearCookies();
    await server.post(`/api/invites/${invite.id}/accept`, { password: STRONG });
    plainTeacherCookie = server.cookie(TEACHER_COOKIE)!;
  });

  it('refuses a non-admin, with a reason', async () => {
    const res = await server.get('/api/admin/team');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only an admin');
    expect((await server.post('/api/admin/team/invites', { email: 'x@y.de' })).status).toBe(403);
  });

  it('refuses an anonymous request', async () => {
    server.clearCookies();
    expect((await server.get('/api/admin/team')).status).toBe(401);
  });

  it('still lets a plain teacher use the rest of the app', async () => {
    expect((await server.get('/api/admin/classes')).status).toBe(200);
    expect((await server.post('/api/admin/classes', { name: '7a' })).status).toBe(201);
  });

  describe('the language model is instance-wide, not per teacher', () => {
    it('tells a plain teacher only whether the AI is available', async () => {
      const res = await server.get('/api/admin/settings/llm');

      // Enough to decide whether the AI buttons appear, and nothing more.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false });
      expect(res.body).not.toHaveProperty('baseUrl');
      expect(res.body).not.toHaveProperty('model');
      expect(res.body).not.toHaveProperty('hasApiKey');
    });

    it('refuses to let a plain teacher change or test it', async () => {
      const put = await server.request('PUT', '/api/admin/settings/llm', {
        baseUrl: 'https://example.com/v1',
        apiKey: 'sneaky',
        model: 'whatever',
      });
      expect(put.status).toBe(403);
      expect(put.body.error).toContain('Only an admin');
      expect((await server.post('/api/admin/settings/llm/test')).status).toBe(403);
    });

    it('leaves the configuration untouched after a refused write', async () => {
      await server.request('PUT', '/api/admin/settings/llm', { apiKey: 'sneaky' });

      server.clearCookies();
      await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
      expect((await server.get('/api/admin/settings/llm')).body.hasApiKey).toBe(false);
    });

    it('gives an admin the full configuration, but never the key itself', async () => {
      server.clearCookies();
      await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
      await server.request('PUT', '/api/admin/settings/llm', {
        baseUrl: 'https://example.com/v1',
        apiKey: 'secret-value',
        model: 'test-model',
      });

      const res = await server.get('/api/admin/settings/llm');
      expect(res.body).toMatchObject({ model: 'test-model', hasApiKey: true, configured: true });
      expect(JSON.stringify(res.body)).not.toContain('secret-value');
    });

    it('lets a plain teacher see that the AI became available, without the details', async () => {
      server.clearCookies();
      await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
      await server.request('PUT', '/api/admin/settings/llm', {
        baseUrl: 'https://example.com/v1',
        apiKey: 'secret-value',
        model: 'test-model',
      });

      server.clearCookies();
      await server.post('/api/admin/auth/login', { email: 'plain@school.de', password: STRONG });
      expect((await server.get('/api/admin/settings/llm')).body).toEqual({ configured: true });
    });
  });

  it('promotes and demotes', async () => {
    void plainTeacherCookie;
    server.clearCookies();
    await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });

    const plain = (await server.get('/api/admin/team')).body.teachers.find(
      (t: { email: string }) => t.email === 'plain@school.de',
    );
    const promoted = await server.patch(`/api/admin/team/teachers/${plain.id}`, { isAdmin: true });
    expect(promoted.body.isAdmin).toBe(true);

    const demoted = await server.patch(`/api/admin/team/teachers/${plain.id}`, { isAdmin: false });
    expect(demoted.body.isAdmin).toBe(false);
  });

  it('will not let the last admin be removed or demoted', async () => {
    server.clearCookies();
    await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
    const head = (await server.get('/api/admin/team')).body.teachers.find(
      (t: { email: string }) => t.email === 'head@school.de',
    );

    const demote = await server.patch(`/api/admin/team/teachers/${head.id}`, { isAdmin: false });
    expect(demote.status).toBe(409);

    const remove = await server.delete(`/api/admin/team/teachers/${head.id}`);
    expect(remove.status).toBe(409);
    expect(remove.body.error).toContain('your own account');
  });

  it('refuses to remove a teacher who still has classes', async () => {
    // The plain teacher makes a class, then the admin tries to delete them.
    await server.post('/api/admin/classes', { name: '7a' });

    server.clearCookies();
    await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
    const plain = (await server.get('/api/admin/team')).body.teachers.find(
      (t: { email: string }) => t.email === 'plain@school.de',
    );

    const res = await server.delete(`/api/admin/team/teachers/${plain.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('every result in them');
  });

  it('removes a teacher who has nothing', async () => {
    server.clearCookies();
    await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
    const plain = (await server.get('/api/admin/team')).body.teachers.find(
      (t: { email: string }) => t.email === 'plain@school.de',
    );

    expect((await server.delete(`/api/admin/team/teachers/${plain.id}`)).status).toBe(204);
    expect((await server.get('/api/admin/team')).body.teachers).toHaveLength(1);
  });

  it('keeps each teacher’s classes to themselves', async () => {
    await server.post('/api/admin/classes', { name: '7a' });
    const mine = (await server.get('/api/admin/classes')).body;

    server.clearCookies();
    await server.post('/api/admin/auth/login', { email: 'head@school.de', password: STRONG });
    const theirs = (await server.get('/api/admin/classes')).body;

    expect(mine.map((c: { name: string }) => c.name)).toEqual(['7a']);
    expect(theirs).toEqual([]);
    expect((await server.get(`/api/admin/classes/${mine[0].id}`)).status).toBe(404);
  });
});
