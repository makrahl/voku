import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { QuestionType } from '@voku/shared';
import { admin, api } from '../lib/api.ts';
import { Empty, Row, Rows, Spinner, cx } from '../components/ui.tsx';

interface QuestionStat {
  questionId: string;
  headwordEn: string;
  translationDe: string;
  type: QuestionType;
  orderIndex: number;
  reachedCount: number;
  correctCount: number;
  correctRate: number | null;
  commonWrong: Array<{ given: string; count: number }>;
}

interface TestStats {
  questions: QuestionStat[];
  studentsStarted: number;
  studentsSubmitted: number;
  medianReached: number | null;
  troubleCount: number;
}

const TYPE_SHORT: Record<QuestionType, string> = {
  translate_input: 'typed',
  mcq_translation: 'choice',
  mcq_definition: 'definition',
  fill_blank: 'gap',
};

/** Empty bar reads as trouble without needing a second colour. */
function Rate({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="w-28 text-right text-sm text-ink-40">not reached</span>;
  return (
    <span className="flex w-28 shrink-0 items-center gap-3">
      <span className="relative h-1 flex-1 bg-hairline">
        <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${rate}%` }} />
      </span>
      <span className="tabular w-9 text-right text-sm">{rate}%</span>
    </span>
  );
}

/** Defaults to worst-first: the point is the words to reteach, not the test order. */
export function QuestionStats({ testId }: { testId: string }) {
  const [order, setOrder] = useState<'trouble' | 'test'>('trouble');

  const stats = useQuery({
    queryKey: ['admin', 'question-stats', testId],
    queryFn: () => api.get<TestStats>(admin(`/tests/${testId}/question-stats`)),
  });

  if (stats.isLoading) return <Spinner />;
  if (!stats.data) return null;
  const { questions, medianReached, troubleCount, studentsStarted } = stats.data;

  if (studentsStarted === 0) {
    return (
      <section className="flex flex-col gap-6">
        <span className="label">What the class knows</span>
        <Empty title="Nothing yet">This fills in as students answer.</Empty>
      </section>
    );
  }

  const sorted =
    order === 'test'
      ? [...questions].sort((a, b) => a.orderIndex - b.orderIndex)
      : [...questions].sort((a, b) => {
          // Unreached is unknown, not bad — sorts last.
          if (a.correctRate === null) return 1;
          if (b.correctRate === null) return -1;
          return a.correctRate - b.correctRate || b.reachedCount - a.reachedCount;
        });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="label">What the class knows</span>
          <p className="mt-2 max-w-prose text-ink-60">
            {troubleCount > 0 ? (
              <>
                <span className="text-ink">
                  {troubleCount} {troubleCount === 1 ? 'word is' : 'words are'} worth teaching again
                </span>{' '}
                — more than half the students who reached them got them wrong.
              </>
            ) : (
              'No word was missed by more than half the students who reached it.'
            )}
            {medianReached !== null ? (
              <> The typical student answered {medianReached} of {questions.length}.</>
            ) : null}
          </p>
        </div>

        <div className="flex gap-6">
          {(
            [
              ['trouble', 'Hardest first'],
              ['test', 'Test order'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOrder(value)}
              className={cx(
                'label py-1 transition-colors',
                order === value ? '!text-ink border-b-2 border-accent' : 'hover:!text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Rows>
        {sorted.map((q) => (
          <Row key={q.questionId}>
            <span className="tabular w-7 shrink-0 text-sm text-ink-40">
              {String(q.orderIndex + 1).padStart(2, '0')}
            </span>

            <div className="min-w-52 flex-1">
              <p className="text-lg">
                {q.headwordEn}
                <span className="text-ink-40"> · {q.translationDe}</span>
              </p>
              {q.commonWrong.length > 0 ? (
                <p className="mt-0.5 text-sm text-ink-40">
                  wrote{' '}
                  {q.commonWrong
                    .map((w) => `“${w.given}”${w.count > 1 ? ` ×${w.count}` : ''}`)
                    .join(', ')}
                </p>
              ) : null}
            </div>

            <span className="w-20 shrink-0 text-sm text-ink-40">{TYPE_SHORT[q.type]}</span>
            <span className="tabular w-24 shrink-0 text-sm text-ink-40">
              {q.reachedCount === 0
                ? ''
                : `${q.correctCount}/${q.reachedCount} students`}
            </span>
            <Rate rate={q.correctRate} />
          </Row>
        ))}
      </Rows>
    </section>
  );
}
