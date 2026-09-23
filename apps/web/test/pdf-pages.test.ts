import { describe, expect, it } from 'vitest';
import { appendText, batched, isScanned, joinPages, scannedPages } from '../src/lib/pdf-pages.ts';

/**
 * A PDF is either a document or a stack of photographs, and the teacher cannot
 * be expected to know which. Telling them apart is what decides whether the
 * paid path runs at all, so it is stated here as a rule rather than left to the
 * shape of a page.
 */

const WORD_LIST_PAGE = `English German Example
to grind sth out herunterleiern The channel grinds out the same story every week.
lavish üppig a lavish reception at the embassy`;

describe('telling a document from a scan', () => {
  it('reads a page that has real text', () => {
    expect(isScanned(WORD_LIST_PAGE)).toBe(false);
  });

  it('counts a page with nothing on it as a scan', () => {
    expect(isScanned('')).toBe(true);
    expect(isScanned('   \n\n  ')).toBe(true);
  });

  // What a scanner leaves behind: a page number, a stamp, one stray ligature.
  it('is not fooled by the litter a scanner leaves in the text layer', () => {
    expect(isScanned('12')).toBe(true);
    expect(isScanned('Seite 3 von 19')).toBe(true);
  });

  it('names the scanned pages the way a teacher counts them, from one', () => {
    expect(scannedPages([WORD_LIST_PAGE, '', WORD_LIST_PAGE, '7'])).toEqual([2, 4]);
  });

  it('says nothing needs paying for when every page has text', () => {
    expect(scannedPages([WORD_LIST_PAGE, WORD_LIST_PAGE])).toEqual([]);
  });
});

describe('putting the pages together', () => {
  it('separates pages by a blank line, which is what starts a paragraph here', () => {
    expect(joinPages(['One', 'Two'])).toBe('One\n\nTwo');
  });

  it('leaves out the pages that had nothing on them', () => {
    expect(joinPages(['One', '   ', 'Two'])).toBe('One\n\nTwo');
  });

  it('adds to the teacher’s text instead of replacing it', () => {
    expect(appendText('Already here.', 'From the PDF.')).toBe('Already here.\n\nFrom the PDF.');
    expect(appendText('', 'From the PDF.')).toBe('From the PDF.');
  });

  it('does not add a blank line when the PDF gave nothing', () => {
    expect(appendText('Already here.', '  ')).toBe('Already here.');
  });
});

describe('sending pages to the model', () => {
  // The request body has a ceiling, and a batch that fails should cost one
  // batch rather than the whole book.
  it('goes a few pages at a time, however long the document is', () => {
    const pages = Array.from({ length: 19 }, (_, i) => `page ${i + 1}`);
    const batches = batched(pages);

    expect(batches.every((batch) => batch.length <= 4)).toBe(true);
    expect(batches.flat()).toEqual(pages);
  });
});
