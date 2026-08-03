import QRCode from 'qrcode';
import type { StudentView } from '@voku/shared';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * A printable sheet of login cards — one per student, cut apart and glued into
 * the back of an exercise book. Rendered server-side to inline SVG so it prints
 * crisply and needs no network when the page is opened.
 */
export async function renderQrSheet(className: string, students: StudentView[]): Promise<string> {
  const cards = await Promise.all(
    students.map(async (student) => {
      const svg = await QRCode.toString(student.loginUrl, {
        type: 'svg',
        margin: 0,
        errorCorrectionLevel: 'M',
      });
      return `
      <article class="card">
        <div class="name">${escapeHtml(student.name)}</div>
        <div class="qr">${svg}</div>
        <div class="meta">${escapeHtml(className)}</div>
      </article>`;
    }),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>voku login codes — ${escapeHtml(className)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 12mm;
    background: #fff;
    color: #111;
    font-family: "Helvetica Neue", Arial, sans-serif;
  }
  header { margin-bottom: 8mm; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  header p { margin: 0; font-size: 9pt; color: #555; }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6mm;
  }
  .card {
    border: 1px dashed #999;
    border-radius: 2mm;
    padding: 5mm 4mm;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .name { font-size: 12pt; font-weight: 700; line-height: 1.2; }
  .qr { width: 34mm; height: 34mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .meta { font-size: 8pt; color: #666; letter-spacing: 0.04em; text-transform: uppercase; }
  .empty { font-size: 11pt; color: #666; }
  @media print {
    body { padding: 0; }
    header { display: none; }
    @page { size: A4; margin: 10mm; }
  }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(className)} — login codes</h1>
    <p>Print, cut along the dashed lines, and give one card to each student.
       Scanning the code signs them in and keeps them signed in.</p>
  </header>
  ${
    students.length === 0
      ? '<p class="empty">No students in this class yet.</p>'
      : `<div class="grid">${cards.join('')}</div>`
  }
</body>
</html>`;
}
