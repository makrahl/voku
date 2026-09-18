import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
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

const HEADINGS: Record<keyof WorksheetRow, string> = {
  word: 'English',
  german: 'German',
  definition: 'Definition',
  example: 'Example',
  from: 'Revision',
};

/** Share of the page each column gets, matching the print view's proportions. */
const WIDTHS: Record<keyof WorksheetRow, number> = {
  word: 18,
  german: 18,
  definition: 30,
  example: 34,
  from: 14,
};

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
    from: word.repeated_from_title ? `from ${word.repeated_from_title}` : '',
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
  const rows = words.map((word) => rowFor(word, variant));

  // The revision column only appears when something is coming back, so a sheet
  // of all-new words is not given an empty column to explain.
  const columns = [...COLUMNS[variant]];
  if (rows.some((row) => row.from)) columns.push('from');

  return { title: test.title, className, variant, columns, rows };
}

/**
 * Excel opens a semicolon-separated file straight into columns on a German
 * locale, and reads the bytes as the system codepage unless a byte order mark
 * says otherwise — without it "gründlich" arrives as "grÃ¼ndlich".
 */
export function toCsv(view: WorksheetView): string {
  const heading = HEADINGS;

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

/**
 * The same sheet as a Word file, for a teacher who wants to add a header, a
 * logo or an extra task before copying it.
 *
 * Only horizontal hairlines, as on screen: a fully boxed table reads as a
 * spreadsheet, and an empty cell still needs a line to write on — which a
 * bottom border gives for free.
 */
export async function toDocx(view: WorksheetView): Promise<Buffer> {
  const HAIRLINE = { style: BorderStyle.SINGLE, size: 2, color: 'C9C9C4' };
  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

  const cell = (text: string, column: keyof WorksheetRow, heading = false) =>
    new TableCell({
      width: { size: WIDTHS[column], type: WidthType.PERCENTAGE },
      margins: { top: 80, bottom: 80, right: 140 },
      borders: { top: NONE, bottom: HAIRLINE, left: NONE, right: NONE },
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text,
              bold: heading,
              size: heading ? 16 : 22,
              allCaps: heading,
              color: heading ? '6B6B66' : '161613',
            }),
          ],
        }),
      ],
    });

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        children: [
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: view.title, bold: true, size: 32 })],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [new TextRun({ text: view.className, color: '6B6B66', size: 20 })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: NONE,
              bottom: NONE,
              left: NONE,
              right: NONE,
              insideHorizontal: HAIRLINE,
              insideVertical: NONE,
            },
            rows: [
              new TableRow({
                tableHeader: true,
                children: view.columns.map((column) => cell(HEADINGS[column], column, true)),
              }),
              ...view.rows.map(
                (row) =>
                  new TableRow({
                    // Keeps a wrapped row off a page break, as the print view does.
                    cantSplit: true,
                    children: view.columns.map((column) => cell(row[column], column)),
                  }),
              ),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 240 },
            children: [new TextRun({ text: 'voku', color: '9A9A95', size: 16 })],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
