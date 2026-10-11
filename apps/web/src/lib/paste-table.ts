/**
 * A table pasted from a spreadsheet or a Word table.
 *
 * Excel, Google Sheets, Numbers and Word all put a copied table on the
 * clipboard the same way: one row per line, a tab between cells. A cell with a
 * line break of its own is wrapped in quotes, with any quote inside doubled,
 * so a long example sentence does not split its row in two.
 *
 * Only tabs make a table. A semicolon or a spaced hyphen is how a pair is typed
 * by hand, and a definition is full of both, so splitting on them past the
 * first would cut sentences in half. Tabs are never typed into a text box, so
 * a tab-separated line with three or more cells can only be a pasted table.
 */

import { readList, type ListReading, type Row } from './vocab-table.ts';

/** The rows of a pasted table, or null when the text is a plain list of pairs. */
export function pastedTable(text: string): Row[] | null {
  const rows = splitRows(text.replace(/\r\n?/g, '\n'));
  // Two columns is a list of pairs, which the plain paste already handles.
  if (!rows.some((row) => row.filter((cell) => cell.trim()).length >= 3)) return null;

  // Rows copied from a ragged range come out with fewer cells; pad them so the
  // columns still line up for the reader.
  const width = Math.max(...rows.map((row) => row.length));
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
}

/** The same reading a PDF list gets: headings recognised, half-pairs counted. */
export function readPastedList(text: string): ListReading | null {
  const rows = pastedTable(text);
  return rows ? readList(rows) : null;
}

function splitRows(text: string): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let i = 0;

  while (i <= text.length) {
    const quoted = text[i] === '"' ? closingQuote(text, i) : -1;
    let cell: string;
    if (quoted >= 0) {
      // A line break inside a cell is layout, not content: one line of text.
      cell = text
        .slice(i + 1, quoted)
        .replace(/""/g, '"')
        .replace(/\s*\n\s*/g, ' ');
      i = quoted + 1;
    } else {
      let end = i;
      while (end < text.length && text[end] !== '\t' && text[end] !== '\n') end++;
      cell = text.slice(i, end);
      i = end;
    }
    row.push(cell.trim());

    if (text[i] === '\t') {
      i++;
      continue;
    }
    rows.push(row);
    row = [];
    i++;
  }
  return rows;
}

/**
 * Where a quoted cell ends, or -1 if the quote is just part of the text.
 *
 * An example sentence can open with a quotation mark — `"I'm weary," she
 * said.` — and is then not a quoted cell at all. A real one closes with a quote
 * that stands right before a tab, a line break or the end.
 */
function closingQuote(text: string, open: number): number {
  let i = open + 1;
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        i += 2;
        continue;
      }
      const next = text[i + 1];
      return next === undefined || next === '\t' || next === '\n' ? i : -1;
    }
    i++;
  }
  return -1;
}
