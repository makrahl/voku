/**
 * Marks the trained words inside the source text, so a student revises the
 * vocabulary where it was used rather than as a list of pairs.
 *
 * Light markdown is understood — headings, bold, italic. It is parsed into a
 * structure rather than into HTML because the word highlights have to compose
 * with the formatting: the same run of text can be both bold and a trained
 * word, and injecting spans into an HTML string would be fragile and unsafe.
 */

export interface AnnotatableWord {
  id: string;
  headwordEn: string;
  translationDe: string;
}

export type Mark = 'bold' | 'italic';

export interface TextSegment {
  text: string;
  marks?: Mark[];
  /** Set when this run of text is one of the trained words. */
  wordId?: string;
  headwordEn?: string;
  translationDe?: string;
}

export interface TextBlock {
  type: 'heading' | 'paragraph';
  /** 1–3, for headings only. */
  level?: number;
  segments: TextSegment[];
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

interface Range {
  start: number;
  end: number;
  mark: Mark;
}

interface Inline {
  plain: string;
  ranges: Range[];
}

/** Strips the markers, recording where each one applied. Nesting is handled. */
function parseInline(source: string): Inline {
  let plain = '';
  const ranges: Range[] = [];
  let i = 0;

  /**
   * The closing marker: not preceded by a space, and for a single character not
   * part of a doubled run — otherwise "*a **b** c*" ends the italic on the first
   * asterisk of the bold.
   */
  const findClose = (delim: string, from: number): number => {
    let j = from;
    while (j < source.length) {
      const idx = source.indexOf(delim, j);
      if (idx === -1) return -1;
      const before = source[idx - 1];
      const doubled =
        delim.length === 1 && (source[idx - 1] === delim || source[idx + 1] === delim);
      if (before !== undefined && !/\s/.test(before) && !doubled) return idx;
      j = idx + delim.length;
    }
    return -1;
  };

  const take = (delim: string, mark: Mark): boolean => {
    if (!source.startsWith(delim, i)) return false;
    // An opening marker is attached to what it emphasises, which is what keeps
    // "2 * 3 = 6" as arithmetic rather than italics.
    const after = source[i + delim.length];
    if (after === undefined || /\s/.test(after)) return false;

    const close = findClose(delim, i + delim.length);
    if (close <= i + delim.length) return false;

    const inner = parseInline(source.slice(i + delim.length, close));
    const offset = plain.length;
    plain += inner.plain;
    ranges.push({ start: offset, end: plain.length, mark });
    for (const r of inner.ranges) {
      ranges.push({ start: r.start + offset, end: r.end + offset, mark: r.mark });
    }
    i = close + delim.length;
    return true;
  };

  while (i < source.length) {
    if (take('**', 'bold') || take('__', 'bold') || take('*', 'italic') || take('_', 'italic')) {
      continue;
    }
    plain += source[i];
    i++;
  }
  return { plain, ranges };
}

interface RawBlock {
  type: 'heading' | 'paragraph';
  level?: number;
  source: string;
}

function parseBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', source: paragraph.join(' ') });
    paragraph = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1]!.length, source: heading[2]!.trim() });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** The text with markers removed, for anything that should not see them. */
export function plainText(text: string): string {
  return parseBlocks(text)
    .map((block) => parseInline(block.source).plain)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Word matching
// ---------------------------------------------------------------------------

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUFFIXES = ['', 's', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'est'];
const DOUBLES = 'bdfglmnprt';

/**
 * The surface forms a headword can take in the text. Explicit forms rather than
 * one clever pattern: "slam" becomes "slammed", "come" becomes "coming", and
 * both are easier to state than to encode.
 */
function formsOf(word: string): string[] {
  const forms = new Set<string>();
  const stem = word.trim();
  const last = stem[stem.length - 1] ?? '';

  for (const suffix of SUFFIXES) forms.add(stem + suffix);
  if (DOUBLES.includes(last.toLowerCase())) {
    for (const suffix of ['ed', 'ing', 'er', 'est']) forms.add(stem + last + suffix);
  }
  if (last.toLowerCase() === 'e') {
    for (const suffix of ['ing', 'ed']) forms.add(stem.slice(0, -1) + suffix);
  }
  if (last.toLowerCase() === 'y') {
    for (const suffix of ['ies', 'ied', 'ier', 'iest', 'ily']) {
      forms.add(stem.slice(0, -1) + suffix);
    }
  }
  return [...forms];
}

/** Longest form first, so "attempted" wins over "attempt". */
function patternFor(headword: string): RegExp {
  const alternatives = formsOf(headword)
    .sort((a, b) => b.length - a.length)
    .map((form) => form.split(/\s+/).map(escape).join('\\s+'));
  return new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'gi');
}

interface Hit {
  start: number;
  end: number;
  word: AnnotatableWord;
}

function findWords(plain: string, words: AnnotatableWord[]): Hit[] {
  const hits: Hit[] = [];
  // Longer headwords first, so a phrase is not broken up by one of its parts.
  const ordered = [...words].sort((a, b) => b.headwordEn.length - a.headwordEn.length);

  for (const word of ordered) {
    for (const match of plain.matchAll(patternFor(word.headwordEn))) {
      const start = match.index;
      const end = start + match[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ start, end, word });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function toSegments(plain: string, ranges: Range[], hits: Hit[]): TextSegment[] {
  // Every point where formatting or a word starts or ends becomes a boundary,
  // so each resulting run has one consistent set of properties.
  const boundaries = new Set<number>([0, plain.length]);
  for (const r of ranges) {
    boundaries.add(r.start);
    boundaries.add(r.end);
  }
  for (const h of hits) {
    boundaries.add(h.start);
    boundaries.add(h.end);
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const segments: TextSegment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;

    const marks = [...new Set(ranges.filter((r) => r.start <= start && r.end >= end).map((r) => r.mark))];
    const hit = hits.find((h) => h.start <= start && h.end >= end);

    const segment: TextSegment = { text: plain.slice(start, end) };
    if (marks.length > 0) segment.marks = marks;
    if (hit) {
      segment.wordId = hit.word.id;
      segment.headwordEn = hit.word.headwordEn;
      segment.translationDe = hit.word.translationDe;
    }
    segments.push(segment);
  }
  return segments;
}

export function annotateText(text: string, words: AnnotatableWord[]): TextBlock[] {
  if (!text.trim()) return [];

  return parseBlocks(text).map((block) => {
    const { plain, ranges } = parseInline(block.source);
    const hits = block.type === 'heading' ? [] : findWords(plain, words);
    const parsed: TextBlock = { type: block.type, segments: toSegments(plain, ranges, hits) };
    if (block.level) parsed.level = block.level;
    return parsed;
  });
}
