/**
 * Reading a PDF in the browser.
 *
 * The file never leaves the machine: the text layer is pulled out here, and
 * only pages that turn out to be photographs are rendered to images and sent to
 * the model, the same way a photographed page already is. A 19-page word list
 * with real text therefore costs nothing and works with no model configured at
 * all, which is the point — the AI is optional everywhere.
 */
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export type Pdf = { doc: PDFDocumentProxy; pageCount: number };

export async function openPdf(file: File): Promise<Pdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await getDocument({ data }).promise;
  return { doc, pageCount: doc.numPages };
}

/** The text layer of one page, with the line breaks the document itself has. */
export async function readPageText(pdf: Pdf, pageNumber: number): Promise<string> {
  const page = await pdf.doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
    .join('');
  page.cleanup();
  return text;
}

/**
 * A scanned page as a JPEG data URI, wide enough for the model to read small
 * print but not so wide that six of them exceed the request body limit.
 */
export async function renderPageImage(pdf: Pdf, pageNumber: number, width = 1400): Promise<string> {
  const page = await pdf.doc.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / unscaled.width });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the page');

  // Scans photographed on a phone often have no background of their own.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();

  return canvas.toDataURL('image/jpeg', 0.8);
}
