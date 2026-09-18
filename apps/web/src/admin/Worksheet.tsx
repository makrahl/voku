import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WordView, WorksheetRow, WorksheetVariant, WorksheetView } from '@voku/shared';
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

/** Which columns a variant actually prints, so a missing cell is only worth
 *  mentioning when it would leave a hole in the sheet being looked at. */
const NEEDS: Record<WorksheetVariant, Array<'definition' | 'example'>> = {
  full: ['definition', 'example'],
  no_german: ['definition', 'example'],
  gapped: ['definition', 'example'],
  compact: [],
};

export function Worksheet({
  testId,
  aiReady,
  editable,
  onStarted,
}: {
  testId: string;
  aiReady: boolean;
  /** An open test is locked, so the gaps cannot be filled until it closes. */
  editable: boolean;
  onStarted: () => void;
}) {
  const [variant, setVariant] = useState<WorksheetVariant>('full');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = useQuery({
    queryKey: ['admin', 'words', testId],
    queryFn: () => api.get<WordView[]>(admin(`/tests/${testId}/words`)),
  });

  const included = (words.data ?? []).filter((word) => word.included);
  const needed = NEEDS[variant];
  const missing = {
    definition: needed.includes('definition')
      ? included.filter((word) => !word.definitionEn).length
      : 0,
    example: needed.includes('example')
      ? included.filter((word) => !word.contextSentence).length
      : 0,
  };
  const short = Math.max(missing.definition, missing.example);

  const fillGaps = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post(admin(`/tests/${testId}/enrich-words`), {});
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
          <span className="label">What goes on the sheet</span>
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

      {/* An unfilled cell prints as a writing line, exactly like one left blank
          on purpose — so the sheet itself cannot tell the teacher which it is. */}
      {short > 0 ? (
        <div className="no-print rule-b flex flex-wrap items-center justify-between gap-4 pb-5">
          <div className="flex flex-col gap-1">
            <span className="text-ink">
              {missing.definition > 0
                ? `${missing.definition} of ${included.length} words have no definition yet`
                : `${missing.example} of ${included.length} words have no example yet`}
              {missing.definition > 0 && missing.example > 0 ? `, and ${missing.example} no example` : ''}
              .
            </span>
            <span className="text-sm text-ink-40">
              Those cells print as blank lines, which on this version of the sheet looks the same as
              a gap left on purpose.
            </span>
          </div>
          {!editable ? (
            <span className="text-sm text-ink-40">Close the test to fill them in.</span>
          ) : aiReady ? (
            <Button onClick={fillGaps} disabled={busy}>
              Write the missing ones
            </Button>
          ) : (
            <span className="text-sm text-ink-40">Write them on the Words step.</span>
          )}
        </div>
      ) : null}
      {error ? <p className="no-print text-sm text-ink-60">{error}</p> : null}

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
