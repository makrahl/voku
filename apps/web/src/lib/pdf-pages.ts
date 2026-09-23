/**
 * Deciding what a PDF actually gave us, kept apart from the reader itself so it
 * can be tested without a browser.
 *
 * A PDF is one of two things wearing the same file extension: a document with
 * real text in it, which costs nothing to read, and a stack of photographs,
 * which only a vision model can read and which therefore costs money. The
 * teacher should never have to know which they were handed — but they do need
 * to be asked before the paid path runs, so the two cases are told apart here.
 */

/**
 * Below this, a page's text layer is noise — a page number, a scanner's stamp,
 * a stray ligature — and the page is really a photograph.
 */
const REAL_TEXT_CHARS = 25;

export function isScanned(pageText: string): boolean {
  return pageText.replace(/\s/g, '').length < REAL_TEXT_CHARS;
}

/** Page numbers (1-based, as the teacher counts them) that need reading by eye. */
export function scannedPages(pages: string[]): number[] {
  return pages.map((text, i) => (isScanned(text) ? i + 1 : 0)).filter((n) => n > 0);
}

/** One blank line between pages, which is how a paragraph break is written here. */
export function joinPages(pages: string[]): string {
  return pages
    .map((page) => page.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Adds to what is already in the box rather than replacing the teacher's text. */
export function appendText(existing: string, addition: string): string {
  if (!addition.trim()) return existing;
  return existing.trim() ? `${existing.trim()}\n\n${addition.trim()}` : addition.trim();
}

/**
 * Pages are sent to the model in small batches: the request body has a ceiling,
 * and a batch that fails should cost one batch, not the whole book.
 */
export const PAGES_PER_BATCH = 4;

export function batched<T>(items: T[], size = PAGES_PER_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
