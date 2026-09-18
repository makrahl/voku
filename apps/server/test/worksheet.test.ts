import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import { toCsv } from '../src/services/worksheet.js';
import type { WorksheetView } from '@voku/shared';

let server: TestServer;
let classId: string;
let testId: string;

/** Two words whose example uses an inflected form, which the gap has to catch. */
const WORDS = [
  {
    headwordEn: 'ambush',
    translationDe: 'Hinterhalt',
    definitionEn: 'a surprise attack from a hidden position',
    contextSentence: 'The robbers ambushed the travellers on the mountain road.',
  },
  {
    headwordEn: 'thorough',
    translationDe: 'gründlich',
    definitionEn: 'done carefully, leaving nothing out',
    contextSentence: 'Dad gave the car a thorough wash before selling it.',
  },
];

beforeEach(async () => {
  server = await TestServer.start();
  await server.signInAsTeacher();
  classId = (await server.post('/api/admin/classes', { name: '9b' })).body.id;
  testId = (await server.post('/api/admin/tests', { classId, title: 'Unit 3' })).body.id;

  for (const word of WORDS) {
    await server.post(`/api/admin/tests/${testId}/words`, word);
  }
});
afterEach(async () => {
  await server.stop();
});

async function sheet(variant?: string): Promise<WorksheetView> {
  const query = variant ? `?variant=${variant}` : '';
  return (await server.get(`/api/admin/tests/${testId}/worksheet${query}`)).body;
}

describe('the printed worksheet', () => {
  it('prints all four columns on the sheet they learn from', async () => {
    const view = await sheet('full');
    expect(view.columns).toEqual(['word', 'german', 'definition', 'example']);
    expect(view.rows).toHaveLength(2);
    expect(view.rows[0]).toMatchObject({
      word: 'ambush',
      german: 'Hinterhalt',
      definition: 'a surprise attack from a hidden position',
    });
  });

  it('leaves the German blank when that is the thing being asked for', async () => {
    const view = await sheet('no_german');
    expect(view.rows.every((r) => r.german === '')).toBe(true);
    // Everything else stays: the German is the question, not a redaction.
    expect(view.rows.every((r) => r.word && r.definition && r.example)).toBe(true);
  });

  // The gap and the word column answer each other, so the word has to go too.
  it('removes the word from its own example, and from the word column with it', async () => {
    const view = await sheet('gapped');
    expect(view.rows.every((r) => r.word === '')).toBe(true);
    expect(view.rows[0]!.example).toBe('The robbers ___ the travellers on the mountain road.');
    expect(view.rows[1]!.example).toBe('Dad gave the car a ___ wash before selling it.');
  });

  // Better a blank line than a gap exercise with the answer printed in it.
  it('drops an example it cannot gap rather than printing the word in plain sight', async () => {
    await server.post(`/api/admin/tests/${testId}/words`, {
      headwordEn: 'go',
      translationDe: 'gehen',
      contextSentence: 'She went home early.',
    });
    const row = (await sheet('gapped')).rows.find((r) => r.german === 'gehen')!;
    expect(row.example).toBe('');
  });

  it('cuts the sheet down to the pair list when that is all that is wanted', async () => {
    const view = await sheet('compact');
    expect(view.columns).toEqual(['word', 'german']);
    expect(view.rows[0]).toMatchObject({ word: 'ambush', german: 'Hinterhalt' });
  });

  it('leaves a word with no definition yet as a blank cell, not a broken sheet', async () => {
    await server.post(`/api/admin/tests/${testId}/words`, {
      headwordEn: 'weary',
      translationDe: 'müde',
    });
    const row = (await sheet('full')).rows.find((r) => r.word === 'weary')!;
    expect(row).toMatchObject({ definition: '', example: '' });
  });

  it('leaves out a word the teacher took out of the test', async () => {
    const words = (await server.get(`/api/admin/tests/${testId}/words`)).body;
    await server.patch(`/api/admin/tests/${testId}/words/${words[0].id}`, { included: false });
    expect((await sheet('full')).rows).toHaveLength(1);
  });

  it('refuses another teacher’s sheet', async () => {
    await server.signInAsTeacher('other@school.de', 'hunter2hunter2');
    expect((await server.get(`/api/admin/tests/${testId}/worksheet`)).status).toBe(404);
  });
});

describe('the worksheet as a table file', () => {
  const csv = async (variant?: string): Promise<string> => {
    const query = variant ? `?variant=${variant}` : '';
    return (await server.get<string>(`/api/admin/tests/${testId}/worksheet.csv${query}`)).body;
  };

  it('downloads as a named file rather than opening in the tab', async () => {
    const res = await server.get(`/api/admin/tests/${testId}/worksheet.csv?variant=compact`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('Unit-3-compact.csv');
  });

  // Asserted on the builder rather than the response: fetch() strips a leading
  // byte order mark when it decodes, so over HTTP the test could never see it.
  it('starts with a byte order mark, so Excel gets the umlauts right', () => {
    const text = toCsv({
      title: 'Unit 3',
      className: '9b',
      variant: 'compact',
      columns: ['word', 'german'],
      rows: [{ word: 'thorough', german: 'gründlich', definition: '', example: '' }],
    });
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('gründlich');
  });

  it('keeps the umlaut intact over the wire', async () => {
    expect(await csv()).toContain('gründlich');
  });

  it('quotes a cell containing the separator instead of splitting on it', async () => {
    await server.post(`/api/admin/tests/${testId}/words`, {
      headwordEn: 'however',
      translationDe: 'jedoch; allerdings',
    });
    expect(await csv('compact')).toContain('"jedoch; allerdings"');
  });

  it('carries the same blanking as the screen', async () => {
    const text = await csv('gapped');
    expect(text).toContain('___');
    expect(text).not.toContain('ambushed');
  });
});
