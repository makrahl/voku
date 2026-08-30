import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RejectedAnswerGroup, ResultsView } from '@voku/shared';
import { ApiError, admin, api } from '../lib/api.ts';
import { Button, Empty, ErrorText, Row, Rows, Spinner, Status, cx } from '../components/ui.tsx';
import { QuestionStats } from './QuestionStats.tsx';

const STATE_LABEL = {
  not_started: 'not started',
  in_progress: 'working',
  submitted: 'handed in',
} as const;

/**
 * The teacher's view of the room, and deliberately theirs alone: no ranking, no
 * projector mode, and nothing recorded about how a student was working — just
 * enough to see who is stuck and who never started.
 */
export function Board() {
  const { testId = '' } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ['admin', 'results', testId],
    queryFn: () => api.get<ResultsView>(admin(`/tests/${testId}/results`)),
    // Fast enough to feel live, slow enough to be invisible on a school network.
    refetchInterval: (query) => (query.state.data?.test.status === 'open' ? 3000 : false),
  });

  const lifecycle = useMutation({
    mutationFn: (action: 'open' | 'close') => api.post(admin(`/tests/${testId}/${action}`)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'results', testId] }),
    onError: (e: ApiError) => setError(e.message),
  });

  const reset = useMutation({
    mutationFn: (attemptId: string) =>
      api.post(admin(`/tests/${testId}/attempts/${attemptId}/reset`)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'results', testId] }),
  });

  // The board polls while a test is open; keep the stats in step with it.
  useQuery({
    queryKey: ['admin', 'question-stats-tick', testId],
    queryFn: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'question-stats', testId] });
      return Date.now();
    },
    refetchInterval: results.data?.test.status === 'open' ? 5000 : false,
    enabled: results.data?.test.status === 'open',
  });

  if (results.isLoading) return <Spinner />;
  if (!results.data) return null;
  const { test, rows, classAveragePercent } = results.data;

  const working = rows.filter((r) => r.state === 'in_progress').length;
  const done = rows.filter((r) => r.state === 'submitted').length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link
            to={`/admin/tests/${testId}`}
            className="label transition-colors hover:!text-ink"
          >
            ← {test.title}
          </Link>
          <h1 className="text-hero">Live board</h1>
        </div>
        <div className="flex items-center gap-2">
          <Status tone={test.status === 'open' ? 'accent' : 'quiet'}>{test.status}</Status>
          {test.status === 'open' ? (
            <Button variant="danger" onClick={() => lifecycle.mutate('close')}>
              Close the test
            </Button>
          ) : (
            <Button onClick={() => lifecycle.mutate('open')}>Reopen</Button>
          )}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="rule-t rule-b grid gap-8 py-8 sm:grid-cols-3">
        <Stat label="Working" value={String(working)} />
        <Stat label="Handed in" value={`${done} of ${rows.length}`} />
        <Stat
          label="Class average"
          value={classAveragePercent === null ? '—' : `${classAveragePercent}%`}
        />
      </div>

      <Rows>
        {rows.map((row) => (
          <Row
            key={row.studentId}
            className={cx(row.state === 'not_started' && 'opacity-40')}
          >
            <span className="min-w-40 flex-1 text-xl">{row.studentName}</span>
            <Status tone={row.state === 'in_progress' ? 'accent' : 'quiet'}>
              {STATE_LABEL[row.state]}
            </Status>
            <span className="tabular w-28 text-sm text-ink-40">
              {row.state === 'not_started' ? '' : `${row.reachedIndex} answered`}
            </span>
            <span className="tabular w-20 text-right text-2xl font-semibold tracking-tight">
              {row.state === 'not_started' ? '' : `${row.percent}%`}
            </span>
            {row.attemptId ? (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  if (confirm(`Wipe ${row.studentName}'s attempt and let them start again?`)) {
                    reset.mutate(row.attemptId!);
                  }
                }}
              >
                Reset
              </Button>
            ) : null}
          </Row>
        ))}
      </Rows>

      {/* Live too: seeing half the class stall on question 7 is useful while
          it is still happening. */}
      <QuestionStats testId={testId} />

      {test.status === 'closed' ? <RegradePanel testId={testId} /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{label}</span>
      <p className="tabular text-4xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

/**
 * Spelling is marked strictly, which makes this panel load-bearing rather than a
 * nicety: every rejected answer grouped by what students actually typed, so
 * "seven of them wrote recieve" is one decision instead of seven arguments.
 */
function RegradePanel({ testId }: { testId: string }) {
  const queryClient = useQueryClient();

  const rejected = useQuery({
    queryKey: ['admin', 'rejected', testId],
    queryFn: () => api.get<RejectedAnswerGroup[]>(admin(`/tests/${testId}/rejected-answers`)),
  });

  const accept = useMutation({
    mutationFn: (group: RejectedAnswerGroup) =>
      api.post(admin(`/tests/${testId}/accept-variant`), {
        questionId: group.questionId,
        variant: group.variant,
        persist: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'rejected', testId] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'results', testId] });
    },
  });

  const groups = rejected.data ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <span className="label">Answers you might have accepted</span>
        <p className="mt-2 text-sm text-ink-60">
          Accepting one re-marks everybody who wrote it, and remembers it for future tests.
        </p>
      </div>

      {rejected.isLoading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <Empty title="Nothing to review">Every wrong answer was properly wrong.</Empty>
      ) : (
        <Rows>
          {groups.map((group) => (
            <Row key={`${group.questionId}-${group.variant}`}>
              <span className="min-w-28 text-lg">{group.headwordEn}</span>
              <span className="text-lg text-ink-40 line-through">{group.variant}</span>
              <span className="text-lg text-accent">{group.correctAnswer}</span>
              <span className="flex-1" />
              <span className="text-sm text-ink-40" title={group.studentNames.join(', ')}>
                {group.count} student{group.count === 1 ? '' : 's'}
              </span>
              <Button size="sm" onClick={() => accept.mutate(group)} disabled={accept.isPending}>
                Accept
              </Button>
            </Row>
          ))}
        </Rows>
      )}
    </section>
  );
}
