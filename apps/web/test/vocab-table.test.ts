import { describe, expect, it } from 'vitest';
import { bands, rows, toEntries, type Box, type Page, type Positioned } from '../src/lib/vocab-table.ts';

/**
 * Built from the shape of a real list — a four-column table exported from
 * Word, striped, with the heading repeated on the second page. PDF coordinates
 * count up from the bottom of the page, which is why every row here has a
 * larger y than the row below it.
 */

const cell = (x0: number, x1: number, y0: number, y1: number): Box => ({ x0, x1, y0, y1 });

/** One shaded row: four cells across, at the given height. */
const shadedRow = (y0: number, y1: number): Box[] => [
  cell(40, 130, y0, y1),
  cell(131, 253, y0, y1),
  cell(254, 413, y0, y1),
  cell(414, 578, y0, y1),
];

const at = (x: number, y: number, str: string): Positioned => ({ x, y, str });

const PAGE: Page = {
  boxes: [
    // A border drawn around the whole table, which is not a row.
    cell(40, 578, 600, 700),
    ...shadedRow(686, 700), // heading
    ...shadedRow(618, 645), // second entry; the first is white, in the gap
  ],
  texts: [
    at(45, 689, 'ENGLISH'),
    at(136, 689, 'GERMAN'),
    at(260, 689, 'DEFINITION'),
    at(419, 689, 'IN THE TEXT'),

    // The unshaded row between the heading and the shaded one, three lines deep.
    at(45, 675, 'burden (n.)'),
    at(136, 675, 'die Last, die Bürde'),
    at(260, 675, 'a heavy load you are'),
    at(260, 662, 'carrying'),
    at(419, 675, '“Delaney shifted his burden”'),

    at(45, 634, 'to justify sth'),
    at(136, 634, 'etwas rechtfertigen'),
    at(260, 634, 'to give good reasons'),
    at(419, 634, '“how can you justify that?”'),
  ],
};

/**
 * A table arrives drawn in one of two ways and the reader must not care which:
 * some are striped, with a shaded cell per other row, and some are ruled, with
 * a hairline between every row and nothing else. The next list a teacher
 * brings will be whichever of those it happens to be.
 */
const RULED: Page = {
  boxes: [
    // Hairlines across, one per row boundary, and two down the sides.
    { x0: 40, x1: 578, y0: 700, y1: 700.5 },
    { x0: 40, x1: 578, y0: 686, y1: 686.5 },
    { x0: 40, x1: 578, y0: 645, y1: 645.5 },
    { x0: 40, x1: 578, y0: 618, y1: 618.5 },
    { x0: 40, x1: 40.5, y0: 618, y1: 700 },
    { x0: 254, x1: 254.5, y0: 618, y1: 700 },
    { x0: 578, x1: 578.5, y0: 618, y1: 700 },
  ],
  texts: [
    at(45, 689, 'ENGLISH'),
    at(260, 689, 'DEFINITION'),
    at(45, 675, 'burden (n.)'),
    at(260, 675, 'a heavy load'),
    at(45, 634, 'to justify sth'),
    at(260, 634, 'to give good reasons'),
  ],
};

describe('finding the rows', () => {
  // The stripes say where the rows are, and so do the rules. Neither is
  // required, because plenty of lists have only one of them.
  it('reads a striped table by its shaded rows and the white gaps between', () => {
    const table = rows(PAGE);
    expect(table).toHaveLength(3);
    expect(table[0]![0]).toBe('ENGLISH');
    expect(table[1]![0]).toBe('burden (n.)');
    expect(table[2]![0]).toBe('to justify sth');
  });

  it('reads a ruled table with no shading at all', () => {
    const table = rows(RULED);
    expect(table).toHaveLength(3);
    expect(table[1]).toEqual(['burden (n.)', 'a heavy load']);
    expect(toEntries(table)).toHaveLength(0); // no German column in this one
  });

  it('ignores a band too tall to be a row, which is the space around a table', () => {
    expect(bands(PAGE).some((band) => band.top - band.bottom > 140)).toBe(false);
  });

  it('gives nothing at all for a page with no table on it', () => {
    expect(bands({ boxes: [], texts: [at(45, 600, 'just a paragraph')] })).toEqual([]);
    expect(rows({ boxes: [], texts: [at(45, 600, 'just a paragraph')] })).toEqual([]);
  });
});

describe('reading the cells', () => {
  it('keeps each column apart and joins the lines within a cell', () => {
    const table = rows(PAGE);
    expect(table[1]).toEqual([
      'burden (n.)',
      'die Last, die Bürde',
      'a heavy load you are carrying',
      '“Delaney shifted his burden”',
    ]);
  });

  it('reads every row of the table, shaded or not', () => {
    expect(rows(PAGE)).toHaveLength(3);
  });
});

describe('turning rows into words', () => {
  const table = rows(PAGE);

  it('uses the heading row to say which column is which', () => {
    const entries = toEntries(table);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      english: 'burden (n.)',
      german: 'die Last, die Bürde',
      definition: 'a heavy load you are carrying',
      example: '“Delaney shifted his burden”',
    });
  });

  // The heading is repeated at the top of every page of a long list.
  it('drops the heading wherever it appears, not only at the top', () => {
    const entries = toEntries([...table, ['ENGLISH', 'GERMAN', 'DEFINITION', 'IN THE TEXT'], [
      'to assimilate',
      'sich anpassen',
      'to become part of a society',
      '“the Mexicans would assimilate”',
    ]]);
    expect(entries.map((e) => e.english)).toEqual(['burden (n.)', 'to justify sth', 'to assimilate']);
  });

  it('follows a heading written in German, or in another order', () => {
    const entries = toEntries([
      ['Deutsch', 'Englisch'],
      ['die Bürde', 'burden'],
    ]);
    expect(entries[0]).toMatchObject({ english: 'burden', german: 'die Bürde' });
  });

  it('assumes the usual order when there is no heading at all', () => {
    const entries = toEntries([['burden', 'die Bürde', 'a heavy load', '“his burden”']]);
    expect(entries[0]).toMatchObject({ english: 'burden', definition: 'a heavy load' });
  });

  it('skips a row with only half a pair — there is nothing to practise', () => {
    expect(toEntries([['burden', ''], ['', 'die Bürde'], ['weary', 'müde']])).toHaveLength(1);
  });

  // Exports leave a narrow empty column at the left often enough to matter.
  it('ignores a column that is empty all the way down', () => {
    const entries = toEntries([
      ['', 'ENGLISH', 'GERMAN'],
      ['', 'burden', 'die Bürde'],
    ]);
    expect(entries[0]).toMatchObject({ english: 'burden', german: 'die Bürde' });
  });
});
