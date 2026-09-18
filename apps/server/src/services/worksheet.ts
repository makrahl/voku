import { BLANK, type WorksheetRow, type WorksheetVariant, type WorksheetView } from '@voku/shared';
import type { Db } from '../db/index.js';
import { includedWords, type TestRow, type WordRow } from './tests.js';

/**
 * The printed sheet.
 *
 * One builder for every format, because the variants are about what a student
 * is allowed to see and that must not depend on which button the teacher
 * pressed. The renderers below only lay out what they are handed.
 */

const COLUMNS: Record<WorksheetVariant, Array<keyof WorksheetRow>> = {
  full: ['word', 'german', 'definition', 'example'],
  no_german: ['word', 'german', 'definition', 'example'],
  gapped: ['word', 'german', 'definition', 'example'],
  // No definition and no example: this is the list to test each other from.
  compact: ['word', 'german'],
};

/**
 * Replaces the word in its own example with a gap.
 *
 * Matches on the stem so an inflected form is caught too — "ambushed" for
 * "ambush", "slamming" for "slam". When the sentence uses a form the stem does
 * not reach ("went" for "go"), the example is dropped rather than printed
 * intact: a gap exercise that shows the answer is worse than a blank line.
 */
function gap(example: string, word: string): string {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\w*`, 'gi');
  return pattern.test(example) ? example.replace(pattern, BLANK) : '';
}

function rowFor(word: WordRow, variant: WorksheetVariant): WorksheetRow {
  const full: WorksheetRow = {
    word: word.headword_en,
    german: word.translation_de,
    definition: word.definition_en ?? '',
    example: word.context_sentence ?? '',
  };

  if (variant === 'no_german') return { ...full, german: '' };
  if (variant === 'gapped') {
    // The word goes too: left in place, it answers the gap two columns along.
    return { ...full, word: '', example: gap(full.example, word.headword_en) };
  }
  return full;
}

export function buildWorksheet(
  db: Db,
  test: TestRow,
  className: string,
  variant: WorksheetVariant,
): WorksheetView {
  // Easiest first, the order the sprint uses — the sheet is what they revise from.
  const words = includedWords(db, test.id);

  return {
    title: test.title,
    className,
    variant,
    columns: COLUMNS[variant],
    rows: words.map((word) => rowFor(word, variant)),
  };
}

/**
 * Excel opens a semicolon-separated file straight into columns on a German
 * locale, and reads the bytes as the system codepage unless a byte order mark
 * says otherwise — without it "gründlich" arrives as "grÃ¼ndlich".
 */
export function toCsv(view: WorksheetView): string {
  const heading: Record<keyof WorksheetRow, string> = {
    word: 'English',
    german: 'German',
    definition: 'Definition',
    example: 'Example',
  };

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const line = (cells: string[]) => cells.map(escape).join(';');

  const body = [
    line(view.columns.map((c) => heading[c])),
    ...view.rows.map((row) => line(view.columns.map((c) => row[c]))),
    // Excel wants the trailing newline; without it the last row can be dropped.
  ]
    .join('\r\n')
    .concat('\r\n');

  return `﻿${body}`;
}
