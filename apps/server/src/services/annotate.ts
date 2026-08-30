/**
 * Marks the trained words inside the source text, so a student revises the
 * vocabulary where it was used rather than as a list of pairs.
 *
 * Matching allows the usual inflections, because the list holds lemmas while
 * the text holds "lingering" and "attempted".
 */

export interface AnnotatableWord {
  id: string;
  headwordEn: string;
  translationDe: string;
}

export interface TextSegment {
  text: string;
  /** Set when this run of text is one of the trained words. */
  wordId?: string;
  headwordEn?: string;
  translationDe?: string;
}

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

  // slam -> slammed, slamming
  if (DOUBLES.includes(last.toLowerCase())) {
    for (const suffix of ['ed', 'ing', 'er', 'est']) forms.add(stem + last + suffix);
  }
  // come -> coming, hoped -> hoping
  if (last.toLowerCase() === 'e') {
    for (const suffix of ['ing', 'ed']) forms.add(stem.slice(0, -1) + suffix);
  }
  // happy -> happier, happily
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

export function annotateText(text: string, words: AnnotatableWord[]): TextSegment[] {
  if (!text) return [];

  const hits: Hit[] = [];
  // Longer headwords first, so a phrase is not broken up by one of its parts.
  const ordered = [...words].sort((a, b) => b.headwordEn.length - a.headwordEn.length);

  for (const word of ordered) {
    const pattern = patternFor(word.headwordEn);
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      // Keep the first word that claims a span; later ones skip it.
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ start, end, word });
    }
  }

  hits.sort((a, b) => a.start - b.start);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) segments.push({ text: text.slice(cursor, hit.start) });
    segments.push({
      text: text.slice(hit.start, hit.end),
      wordId: hit.word.id,
      headwordEn: hit.word.headwordEn,
      translationDe: hit.word.translationDe,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  return segments;
}

/** Words on the list that never appear in the text — shown separately. */
export function unmatchedWords(
  segments: TextSegment[],
  words: AnnotatableWord[],
): AnnotatableWord[] {
  const found = new Set(segments.map((s) => s.wordId).filter(Boolean));
  return words.filter((w) => !found.has(w.id));
}
