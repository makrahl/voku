import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import { parseNames } from '../src/services/roster.js';

let server: TestServer;

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();
});
afterEach(async () => {
  await server.stop();
});

async function makeClass(name = '9b') {
  const res = await server.post('/api/admin/classes', { name });
  return res.body.id as string;
}

describe('parseNames', () => {
  it('takes one name per line and tidies whitespace', () => {
    expect(parseNames('  Lena  Berger \n\nTom Weiß\n   \nJonas Ott  ')).toEqual([
      'Lena Berger',
      'Tom Weiß',
      'Jonas Ott',
    ]);
  });

  it('collapses runs of whitespace inside a name', () => {
    expect(parseNames('Anna    Maria   Schmidt')).toEqual(['Anna Maria Schmidt']);
  });

  it('drops a name repeated within the same paste, case-insensitively', () => {
    expect(parseNames('Tom Weiß\ntom weiss\nTom Weiß\nLena')).toEqual(['Tom Weiß', 'tom weiss', 'Lena']);
  });

  it('handles CRLF line endings, which is what a Windows paste gives you', () => {
    expect(parseNames('Lena\r\nTom\r\n')).toEqual(['Lena', 'Tom']);
  });
});

describe('classes', () => {
  it('creates a class and lists it with live counts', async () => {
    const id = await makeClass('9b');
    await server.post(`/api/admin/classes/${id}/students`, { names: 'Lena\nTom' });

    const list = await server.get('/api/admin/classes');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, name: '9b', studentCount: 2, testCount: 0 });
  });

  it('requires a signed-in teacher', async () => {
    server.clearCookies();
    expect((await server.get('/api/admin/classes')).status).toBe(401);
    expect((await server.post('/api/admin/classes', { name: 'x' })).status).toBe(401);
  });

  it('will not serve another teacher’s class', async () => {
    const id = await makeClass();
    // A second teacher signing in replaces the cookie in the jar.
    await server.signInAsTeacher('other@school.de', 'hunter2hunter2');
    expect((await server.get(`/api/admin/classes/${id}`)).status).toBe(404);
  });

  it('renames and archives', async () => {
    const id = await makeClass('9b');
    expect((await server.patch(`/api/admin/classes/${id}`, { name: '9c' })).body.name).toBe('9c');

    const archived = await server.patch(`/api/admin/classes/${id}`, { archived: true });
    expect(archived.body.archivedAt).toBeTruthy();
  });

  it('refuses to delete a class that has tests, and says what to do instead', async () => {
    const id = await makeClass();
    server.db.run(
      `INSERT INTO tests (id, class_id, title, mix_json, created_at)
       VALUES ('t1', :c, 'Unit 3', '{}', :now)`,
      { c: id, now: new Date() },
    );

    const res = await server.delete(`/api/admin/classes/${id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Archive it instead');
    expect(server.db.get('SELECT id FROM classes WHERE id = :id', { id })).toBeTruthy();
  });

  it('deletes an empty class', async () => {
    const id = await makeClass();
    expect((await server.delete(`/api/admin/classes/${id}`)).status).toBe(204);
    expect((await server.get('/api/admin/classes')).body).toHaveLength(0);
  });
});

describe('students', () => {
  it('bulk-adds from a pasted list and gives each a distinct token', async () => {
    const id = await makeClass();
    const res = await server.post(`/api/admin/classes/${id}/students`, {
      names: 'Lena Berger\nTom Weiß\nJonas Ott',
    });

    expect(res.status).toBe(201);
    expect(res.body.added).toHaveLength(3);
    expect(res.body.skipped).toEqual([]);

    const tokens = new Set(res.body.added.map((s: { token: string }) => s.token));
    expect(tokens.size).toBe(3);
    for (const token of tokens) expect((token as string).length).toBeGreaterThanOrEqual(32);
  });

  it('reports names already on the roster instead of duplicating them', async () => {
    const id = await makeClass();
    await server.post(`/api/admin/classes/${id}/students`, { names: 'Lena\nTom' });

    const second = await server.post(`/api/admin/classes/${id}/students`, {
      names: 'lena\nJonas',
    });
    expect(second.body.added.map((s: { name: string }) => s.name)).toEqual(['Jonas']);
    expect(second.body.skipped).toEqual(['lena']);
    expect((await server.get(`/api/admin/classes/${id}/students`)).body).toHaveLength(3);
  });

  it('rejects a paste with no usable names', async () => {
    const id = await makeClass();
    const res = await server.post(`/api/admin/classes/${id}/students`, { names: '   \n\n  ' });
    expect(res.status).toBe(409);
  });

  it('builds a login URL from the public base URL', async () => {
    const id = await makeClass();
    const res = await server.post(`/api/admin/classes/${id}/students`, { names: 'Lena' });
    const student = res.body.added[0];
    expect(student.loginUrl).toBe(`http://localhost:3000/s/${student.token}`);
  });

  it('rotating a token invalidates the old one', async () => {
    const id = await makeClass();
    const created = (await server.post(`/api/admin/classes/${id}/students`, { names: 'Lena' })).body
      .added[0];

    const rotated = await server.post(`/api/admin/students/${created.id}/rotate-token`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).not.toBe(created.token);
    expect(
      server.db.get('SELECT id FROM students WHERE token = :t', { t: created.token }),
    ).toBeUndefined();
  });

  it('archives instead of listing, but keeps the row', async () => {
    const id = await makeClass();
    const student = (await server.post(`/api/admin/classes/${id}/students`, { names: 'Lena' })).body
      .added[0];

    await server.patch(`/api/admin/students/${student.id}`, { archived: true });
    expect((await server.get(`/api/admin/classes/${id}/students`)).body).toHaveLength(0);
    expect(
      (await server.get(`/api/admin/classes/${id}/students?includeArchived=true`)).body,
    ).toHaveLength(1);
  });

  it('refuses to delete a student who has sat a test', async () => {
    const id = await makeClass();
    const student = (await server.post(`/api/admin/classes/${id}/students`, { names: 'Lena' })).body
      .added[0];
    server.db.run(
      `INSERT INTO tests (id, class_id, title, mix_json, created_at)
       VALUES ('t1', :c, 'Unit 3', '{}', :now)`,
      { c: id, now: new Date() },
    );
    server.db.run(
      `INSERT INTO attempts (id, test_id, student_id, mode, started_at, target_snapshot)
       VALUES ('a1', 't1', :s, 'graded', :now, 25)`,
      { s: student.id, now: new Date() },
    );

    const res = await server.delete(`/api/admin/students/${student.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Archive them instead');
  });
});

describe('QR sheet', () => {
  it('renders one inline SVG card per student', async () => {
    const id = await makeClass('9b');
    await server.post(`/api/admin/classes/${id}/students`, { names: 'Lena Berger\nTom Weiß' });

    const res = await server.get(`/api/admin/classes/${id}/qr-sheet`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = res.body as unknown as string;
    expect((html.match(/<svg/g) ?? []).length).toBe(2);
    expect(html).toContain('Lena Berger');
    expect(html).toContain('Tom Wei&szlig;'.replace('&szlig;', 'ß'));
    // Tokens must not appear as readable text — the QR image is the credential.
    expect(html).not.toMatch(/\/s\/[A-Za-z0-9_-]{32}/);
  });

  it('handles an empty class without failing', async () => {
    const id = await makeClass();
    const res = await server.get(`/api/admin/classes/${id}/qr-sheet`);
    expect(res.status).toBe(200);
    expect(res.body as unknown as string).toContain('No students in this class yet');
  });

  it('escapes a name that contains markup', async () => {
    const id = await makeClass();
    await server.post(`/api/admin/classes/${id}/students`, { names: '<script>alert(1)</script>' });
    const html = (await server.get(`/api/admin/classes/${id}/qr-sheet`)).body as unknown as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
