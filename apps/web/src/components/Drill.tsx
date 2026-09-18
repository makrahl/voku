import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DrillFeedback, DrillItem, DrillView } from '@voku/shared';
import { api } from '../lib/api.ts';
import { Button, Empty, Spinner } from './ui.tsx';
import { FeedbackFlash, QuestionCard, useFlash } from './Sprint.tsx';

/**
 * Drilling the word pairs.
 *
 * One component for the class and for the teacher previewing them, so a preview
 * cannot quietly differ from the thing it is previewing — only the path differs.
 *
 * Nothing is stored anywhere: the run lives here and dies with the tab, which is
 * the honest shape for something the server deliberately does not remember.
 */
export function Drill({
  path,
  queryKey,
  heading,
  action,
}: {
  /** API path serving the drill; answers are POSTed to the same one. */
  path: string;
  queryKey: unknown[];
  heading: ReactNode;
  /** Sits at the right of the header — "Close" for a student, "Done" for a preview. */
  action: ReactNode;
}) {
  const [queue, setQueue] = useState<DrillItem[] | null>(null);
  const [at, setAt] = useState(0);
  const [missed, setMissed] = useState<DrillItem[]>([]);
  const [right, setRight] = useState(0);
  const [busy, setBusy] = useState(false);
  const { feedback, show } = useFlash<DrillFeedback>();

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.get<DrillView>(path),
  });

  const begin = useCallback((items: DrillItem[]) => {
    setQueue(shuffled(items));
    setAt(0);
    setMissed([]);
    setRight(0);
  }, []);

  useEffect(() => {
    if (data && queue === null) begin(data.items);
  }, [data, queue, begin]);

  if (isLoading) return <Spinner />;
  if (error || !data) {
    return (
      <Empty title="Not ready yet">
        These words are not open for practice right now.
      </Empty>
    );
  }
  if (data.items.length === 0) {
    return <Empty title="No words yet">Add some words and they will appear here to practise.</Empty>;
  }

  const items = queue ?? [];
  const current = items[at];

  const answer = async (given: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const result = await api.post<DrillFeedback>(path, { wordId: current.wordId, given });
      if (result.correct) setRight((n) => n + 1);
      else setMissed((list) => [...list, current]);

      show(result, () => {
        setAt((n) => n + 1);
        setBusy(false);
      });
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="rule-b flex flex-wrap items-baseline justify-between gap-4 pb-5">
        {heading}
        <div className="flex items-center gap-6">
          {current ? (
            <span className="tabular text-sm text-ink-40">
              {at + 1}/{items.length}
            </span>
          ) : null}
          {action}
        </div>
      </header>

      {/* No progress line: its tick marks the sprint's target, and practice has
          no target to reach. The count in the header is the whole story. */}
      <div className="flex flex-1 flex-col justify-center py-10">
        {!current ? (
          <div className="flex flex-col items-center gap-6 text-center">
            <span className="label">Practice</span>
            <p className="text-display font-semibold tracking-tight">
              {right}
              <span className="text-ink-40">/{items.length}</span>
            </p>
            <p className="max-w-md text-lg text-ink-40">
              {missed.length === 0
                ? 'All of them. Nothing left to practise here.'
                : `${missed.length} still to get. Practising costs nothing — go again.`}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
              {missed.length > 0 ? (
                <Button variant="primary" size="lg" onClick={() => begin(missed)}>
                  The ones I missed
                </Button>
              ) : null}
              <Button
                variant={missed.length > 0 ? 'secondary' : 'primary'}
                size="lg"
                onClick={() => begin(data.items)}
              >
                All of them again
              </Button>
            </div>
          </div>
        ) : feedback ? (
          <FeedbackFlash feedback={feedback} />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Above the question, not beside it: it says where the word is from,
                which is context for revising, not a hint towards the answer. */}
            {current.repeatedFrom ? (
              <p className="label text-center">from {current.repeatedFrom}</p>
            ) : null}
            <QuestionCard
            question={{
              id: current.wordId,
              index: at,
              total: items.length,
              payload: {
                type: 'translate_input',
                direction: current.direction,
                prompt: current.prompt,
              },
            }}
              disabled={busy}
              chosen={null}
              correctAnswer={null}
              onAnswer={(given) => void answer(given)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Fisher–Yates. Practice order is shuffled; only the real sprint is fixed. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
