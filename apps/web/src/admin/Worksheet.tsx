import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { WorksheetRow, WorksheetVariant, WorksheetView } from '@voku/shared';
import { admin, api } from '../lib/api.ts';
import { Button, Empty, Spinner, cx } from '../components/ui.tsx';

/**
 * The printed sheet.
 *
 * What a student may see was decided on the server, so this page lays out
 * whatever it is handed and never re-derives it. Everything the teacher clicks
 * carries `no-print`, leaving only the sheet on paper.
 */

const VARIANTS: Array<{ value: WorksheetVariant; label: string; hint: string }> = [
  { value: 'full', label: 'To learn from', hint: 'Every column filled in.' },
  { value: 'no_german', label: 'German left blank', hint: 'They fill in the translation.' },
  { value: 'gapped', label: 'Gapped examples', hint: 'The word is missing from its own sentence.' },
  { value: 'compact', label: 'Word and German only', hint: 'The short list, for testing each other.' },
];

const HEADINGS: Record<keyof WorksheetRow, string> = {
  word: 'English',
  german: 'German',
  definition: 'Definition',
  example: 'Example',
};

/** Roughly how much of the width each column needs when it is printed. */
const WIDTHS: Record<keyof WorksheetRow, string> = {
  word: '18%',
  german: '18%',
  definition: '30%',
  example: '34%',
};

export function Worksheet() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const [variant, setVariant] = useState<WorksheetVariant>('full');

  const sheet = useQuery({
    queryKey: ['admin', 'worksheet', testId, variant],
    queryFn: () => api.get<WorksheetView>(admin(`/tests/${testId}/worksheet?variant=${variant}`)),
  });

  const download = (extension: string) => {
    window.location.href = `/api/admin/tests/${testId}/worksheet.${extension}?variant=${variant}`;
  };

  if (sheet.isLoading) return <Spinner label="Laying out the sheet" />;
  if (!sheet.data) return <Empty title="That sheet is not there">It may have been deleted.</Empty>;

  const view = sheet.data;
  const empty = view.rows.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="no-print flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate(`/admin/tests/${testId}`)}
            className="label transition-colors hover:!text-ink"
          >
            ← {view.title}
          </button>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => download('csv')}>Table file</Button>
            <Button onClick={() => download('docx')}>Word file</Button>
            <Button variant="primary" onClick={() => window.print()} disabled={empty}>
              Print
            </Button>
          </div>
        </div>

        <div className="rule-t rule-b flex flex-wrap gap-x-8 gap-y-3 py-4">
          {VARIANTS.map((option) => (
            <label key={option.value} className="flex items-baseline gap-2 text-sm">
              <input
                type="radio"
                name="variant"
                checked={variant === option.value}
                onChange={() => setVariant(option.value)}
                className="accent-[var(--color-accent)]"
              />
              <span>
                <span className={cx(variant === option.value ? 'text-ink' : 'text-ink-60')}>
                  {option.label}
                </span>
                <span className="block text-ink-40">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {empty ? (
        <Empty title="Nothing to print yet">
          Add some words to the test, and they will appear here.
        </Empty>
      ) : (
        <article className="flex flex-col gap-6">
          <header className="rule-b flex items-baseline justify-between gap-6 pb-3">
            <h1 className="text-2xl font-semibold tracking-tight">{view.title}</h1>
            <span className="label">{view.className}</span>
          </header>

          <table className="w-full border-collapse text-left align-top">
            <thead>
              <tr>
                {view.columns.map((column) => (
                  <th
                    key={column}
                    style={{ width: WIDTHS[column] }}
                    className="label rule-b pb-2 pr-4 align-bottom"
                  >
                    {HEADINGS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row, index) => (
                <tr key={index} className="rule-b align-top">
                  {view.columns.map((column) => (
                    <td key={column} className="py-3 pr-4 leading-snug">
                      {/* An empty cell is the exercise, so it gets a line to
                          write on rather than collapsing to nothing. */}
                      {row[column] || <span className="block border-b border-hairline pt-5" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      )}
    </div>
  );
}
