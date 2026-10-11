import { describe, expect, it } from 'vitest';
import { pastedTable, readPastedList } from '../src/lib/paste-table.ts';

/**
 * What lands on the clipboard when a table is copied out of Excel, Google
 * Sheets or Word: tab-separated cells, one row per line, and a cell with a
 * line break of its own wrapped in quotes.
 */

describe('a table pasted from a spreadsheet', () => {
  it('fills all four fields instead of gluing them onto the German', () => {
    const reading = readPastedList(
      'weary\tmüde\ttired after a long effort\tShe was weary after the trip.\n' +
        'steep\tsteil\trising sharply\tThe path was steep.',
    );
    expect(reading?.entries).toEqual([
      {
        english: 'weary',
        german: 'müde',
        definition: 'tired after a long effort',
        example: 'She was weary after the trip.',
      },
      { english: 'steep', german: 'steil', definition: 'rising sharply', example: 'The path was steep.' },
    ]);
  });

  it('follows the headings when the columns are in another order', () => {
    const reading = readPastedList(
      'Deutsch\tEnglisch\tBeispiel\n' + 'müde\tweary\tShe was weary after the trip.',
    );
    expect(reading?.entries).toEqual([
      { english: 'weary', german: 'müde', definition: '', example: 'She was weary after the trip.' },
    ]);
  });

  it('keeps a cell with a line break in it on one row', () => {
    const rows = pastedTable(
      'weary\tmüde\ttired\t"She was weary\nafter the trip, and said ""enough""."\n' +
        'steep\tsteil\trising sharply\tThe path was steep.',
    );
    expect(rows).toEqual([
      ['weary', 'müde', 'tired', 'She was weary after the trip, and said "enough".'],
      ['steep', 'steil', 'rising sharply', 'The path was steep.'],
    ]);
  });

  it('leaves a sentence that merely opens with a quotation mark alone', () => {
    const rows = pastedTable('weary\tmüde\ttired\t"I\'m weary," she said.\n');
    expect(rows).toEqual([['weary', 'müde', 'tired', '"I\'m weary," she said.']]);
  });

  // Some lists have no German for some words; there is nothing to ask either way.
  it('counts the rows with half a pair rather than adding them', () => {
    const reading = readPastedList('weary\tmüde\ttired\nsteep\t\trising sharply\n');
    expect(reading?.entries.map((e) => e.english)).toEqual(['weary']);
    expect(reading?.skipped).toBe(1);
  });

  it('copes with Windows line endings and a ragged last row', () => {
    const rows = pastedTable('weary\tmüde\ttired\r\nsteep\tsteil\r\n');
    expect(rows).toEqual([
      ['weary', 'müde', 'tired'],
      ['steep', 'steil', ''],
    ]);
  });
});

/** Two columns, or a list typed by hand, keeps going the way it always has. */
describe('a plain list of pairs', () => {
  it('is not taken for a table', () => {
    expect(pastedTable('receive;bekommen\nthorough;gründlich')).toBeNull();
    expect(pastedTable('receive\tbekommen\nthorough\tgründlich')).toBeNull();
    expect(pastedTable('weary - müde; erschöpft')).toBeNull();
  });
});
