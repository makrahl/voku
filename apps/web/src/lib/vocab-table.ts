/**
 * Reading a vocabulary table off a page.
 *
 * The teacher's lists are four-column tables — word, German, definition, the
 * sentence it appeared in — written in Word and exported. Everything voku
 * needs for a worksheet and for every question format is already in them, so
 * the useful thing is to take the table as a table rather than flattening it
 * into text and guessing where the columns were.
 *
 * Kept apart from the PDF reader so the rules can be tested without one: this
 * module sees only boxes and positioned words.
 */

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Positioned {
  x: number;
  /** Baseline, measured from the bottom of the page as PDF does. */
  y: number;
  str: string;
}

export interface Page {
  boxes: Box[];
  texts: Positioned[];
}

/** A row of the table, one string per column. */
export type Row = string[];

export interface VocabEntry {
  english: string;
  german: string;
  definition: string;
  example: string;
}

/** Within a point or two is the same edge: exports are not pixel-exact. */
const SAME_EDGE = 3;

/** Taller than this and it is not one row of a word list. */
const TALLEST_ROW = 140;
/** Shorter than this and it is the gap between two rules of the same border. */
const SHORTEST_ROW = 8;
/** Narrower than this and it is a border's thickness, not a column. */
const NARROWEST_COLUMN = 20;

/**
 * Every line a table is drawn with, whichever way it was drawn.
 *
 * A table from Word arrives as some mixture of three things: ruled lines,
 * shaded cells, and nothing at all. The lines are thin rectangles, the shading
 * is a fat one, and both of them have the same edges in the same places — so
 * rather than favouring one, every edge of every shape is collected and the
 * table is cut along them. A list with ruled rows and a list with striped rows
 * then read exactly alike, which matters because the next list the teacher
 * brings will be whichever of those two it happens to be.
 */
function edgesOf(page: Page): { across: number[]; down: number[] } {
  const across: number[] = [];
  const down: number[] = [];

  for (const box of page.boxes) {
    const width = box.x1 - box.x0;
    const height = box.y1 - box.y0;
    // Thin in one direction is a rule; big in both is a shaded cell. Either
    // way its edges sit on the table's lines.
    const isRule = (height <= 2 && width >= 40) || (width <= 2 && height >= SHORTEST_ROW);
    const isCell = width >= NARROWEST_COLUMN && height >= 6;
    if (!isRule && !isCell) continue;
    across.push(box.y0, box.y1);
    down.push(box.x0, box.x1);
  }

  return { across: dedupe(across).sort((a, b) => b - a), down: dedupe(down).sort((a, b) => a - b) };
}

function dedupe(values: number[]): number[] {
  const out: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    if (!out.some((kept) => Math.abs(kept - value) <= SAME_EDGE)) out.push(value);
  }
  return out;
}

export interface Band {
  top: number;
  bottom: number;
}

/**
 * The horizontal bands a row can occupy: the spaces between the lines across
 * the table. A space too tall to be a row is the gap between two tables, or
 * the margin above one, and is left out.
 */
export function bands(page: Page): Band[] {
  const { across } = edgesOf(page);
  const out: Band[] = [];
  for (let i = 0; i + 1 < across.length; i++) {
    const top = across[i]!;
    const bottom = across[i + 1]!;
    if (top - bottom >= SHORTEST_ROW && top - bottom <= TALLEST_ROW) out.push({ top, bottom });
  }
  return out;
}

/** The vertical slices a column can occupy, by the same reasoning. */
export function columns(page: Page): Array<{ left: number; right: number }> {
  const { down } = edgesOf(page);
  const out: Array<{ left: number; right: number }> = [];
  for (let i = 0; i + 1 < down.length; i++) {
    const left = down[i]!;
    const right = down[i + 1]!;
    if (right - left >= NARROWEST_COLUMN) out.push({ left, right });
  }
  return out;
}

/**
 * The table as rows of text.
 *
 * Lines inside a cell are joined with a space. A word wrapped mid-way gains
 * one it did not have — "Versicherungsauszahlun g" — which is visible in the
 * preview and quick to correct, where guessing at it would be neither.
 */
export function rows(page: Page): Row[] {
  const slices = columns(page);
  if (slices.length < 2) return [];

  const out: Row[] = [];
  for (const band of bands(page)) {
    const byColumn: Positioned[][] = slices.map(() => []);
    for (const text of page.texts) {
      if (text.y < band.bottom - 1 || text.y >= band.top - 1) continue;
      // By where the word starts: a long line runs past its column's right edge
      // only when the cell is wider than the slice, and then it still began here.
      const column = slices.findIndex(
        (slice) => text.x >= slice.left - SAME_EDGE && text.x < slice.right - 1,
      );
      if (column >= 0) byColumn[column]!.push(text);
    }
    const row = byColumn.map((items) =>
      [...items]
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (row.filter(Boolean).length >= 2) out.push(row);
  }
  return out;
}

const HEADINGS: Record<keyof VocabEntry, RegExp> = {
  english: /^(english|englisch|word|wort|vokabel)/i,
  german: /^(german|deutsch|übersetzung|translation)/i,
  definition: /^(definition|meaning|erklärung|bedeutung)/i,
  example: /^(in the text|example|beispiel|satz|sentence|context)/i,
};

function headerIndex(row: Row): Partial<Record<keyof VocabEntry, number>> | null {
  const found: Partial<Record<keyof VocabEntry, number>> = {};
  row.forEach((cell, index) => {
    for (const [field, pattern] of Object.entries(HEADINGS) as Array<[keyof VocabEntry, RegExp]>) {
      if (found[field] === undefined && pattern.test(cell.trim())) found[field] = index;
    }
  });
  // Two headings is enough to be sure it is a heading row and not vocabulary.
  return Object.keys(found).length >= 2 ? found : null;
}

/**
 * Rows to entries.
 *
 * The heading row names the columns, which is what makes a list written in
 * someone else's order — or with only three columns — still land in the right
 * fields. Without one the order of the columns is taken as given, because that
 * is the order every list of this kind is written in.
 */
export function toEntries(rows: Row[]): VocabEntry[] {
  return readList(rows).entries;
}

export interface ListReading {
  entries: VocabEntry[];
  /**
   * Rows that looked like vocabulary but had only one half of the pair.
   *
   * Some lists give an English word and an English definition and no German at
   * all. There is nothing to ask in either direction, so the row is left out —
   * and counted, because silently dropping a third of someone's list is the
   * kind of thing they should hear from the screen rather than discover in a
   * lesson.
   */
  skipped: number;
}

export function readList(rows: Row[]): ListReading {
  const used = rows.map((row) => [...row]);
  // A column empty in every row is an artefact of the export, not a column.
  const keep = (used[0] ?? []).map((_, index) => used.some((row) => (row[index] ?? '').trim()));
  const trimmed = used.map((row) => row.filter((_, index) => keep[index]));

  let columns: Partial<Record<keyof VocabEntry, number>> = {
    english: 0,
    german: 1,
    definition: 2,
    example: 3,
  };
  const entries: VocabEntry[] = [];
  let skipped = 0;

  for (const row of trimmed) {
    const heading = headerIndex(row);
    // Repeated on every page of a long list, and never a word.
    if (heading) {
      columns = heading;
      continue;
    }
    const at = (field: keyof VocabEntry) => {
      const index = columns[field];
      return index === undefined ? '' : (row[index] ?? '').trim();
    };
    const entry = {
      english: at('english'),
      german: at('german'),
      definition: at('definition'),
      example: at('example'),
    };
    // Both halves of the pair, or there is nothing to ask in either direction.
    if (entry.english && entry.german) entries.push(entry);
    else if (entry.english || entry.german) skipped += 1;
  }
  return { entries, skipped };
}
