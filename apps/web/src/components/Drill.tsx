import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DrillChoice, DrillFeedback, DrillItem, DrillView } from '@voku/shared';
import { api } from '../lib/api.ts';
import {
  answer as record,
  current as currentCard,
  done,
  isOver,
  isReturn,
  neededAnotherGo,
  startRound,
  tally,
  type DrillMode,
  type Round,
} from '../lib/drill-round.ts';
import { Button, Empty, Spinner } from './ui.tsx';
import { FeedbackFlash, QuestionCard, useFlash } from './Sprint.tsx';

/**
 * Drilling the word pairs.
 *
 * One component for the class and for the teacher previewing them, so a preview
 * cannot quietly differ from the thing it is previewing — only the path differs.
 * The order of a round — when a missed word comes back, and whether as a choice
 * or typed — lives in `lib/drill-round.ts`, where it can be read on its own.
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
  const [round, setRound] = useState<Round | null>(null);
  const [busy, setBusy] = useState(false);
  const { feedback, show } = useFlash<DrillFeedback>();

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.get<DrillView>(path),
  });

  const items = useMemo(
    () => new Map((data?.items ?? []).map((item) => [item.wordId, item])),
    [data],
  );

  const begin = useCallback((wordIds: string[]) => setRound(startRound(shuffled(wordIds))), []);

  useEffect(() => {
    if (data && round === null) begin(data.items.map((item) => item.wordId));
  }, [data, round, begin]);

  const card = round ? currentCard(round) : undefined;
  const item = card ? items.get(card.wordId) : undefined;

  // Only fetched when a missed word comes back; the first outing is always typed.
  const choice = useQuery({
    queryKey: [...queryKey, 'choice', card?.wordId],
    queryFn: () => api.get<DrillChoice>(`${path}/${card!.wordId}/choice`),
    enabled: card?.mode === 'choice',
    staleTime: Infinity,
  });

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
  if (!round) return <Spinner />;

  // A choice card with no fair choice to offer is simply asked as typing again.
  const askedAs: DrillMode =
    card?.mode === 'choice' && (choice.data?.options.length ?? 0) > 0 ? 'choice' : 'typed';
  const waitingForChoice = card?.mode === 'choice' && choice.isLoading;

  const submit = async (given: string) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const result = await api.post<DrillFeedback>(path, { wordId: card.wordId, given });
      show(result, () => {
        setRound((r) => (r ? record(r, result.correct, askedAs) : r));
        setBusy(false);
      });
    } catch {
      setBusy(false);
    }
  };

  const over = isOver(round);
  const counts = tally(round);
  const again = neededAnotherGo(round);

  // Said quietly above the question: where the word is from, and why it is back.
  const note = card
    ? [
        item?.repeatedFrom ? `from ${item.repeatedFrom}` : null,
        isReturn(round, card)
          ? askedAs === 'choice'
            ? 'another go — pick the right one'
            : 'now type it yourself'
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="flex flex-1 flex-col">
      <header className="rule-b flex flex-wrap items-baseline justify-between gap-4 pb-5">
        {heading}
        <div className="flex items-center gap-6">
          {!over ? (
            // Words, not cards: a missed word coming back must not make the
            // total jump, or the round looks like it is getting longer.
            <span className="tabular text-sm text-ink-40">
              {done(round)}/{round.total}
            </span>
          ) : null}
          {action}
        </div>
      </header>

      {/* No progress line: its tick marks the sprint's target, and practice has
          no target to reach. The count in the header is the whole story. */}
      <div className="flex flex-1 flex-col justify-center py-10">
        {over ? (
          <div className="flex flex-col items-center gap-6 text-center">
            <span className="label">Right first time</span>
            <p className="text-display font-semibold tracking-tight">
              {counts.first}
              <span className="text-ink-40">/{round.total}</span>
            </p>
            <p className="max-w-md text-lg text-ink-40">
              {again.length === 0
                ? 'All of them. Nothing left to practise here.'
                : [
                    counts.recovered > 0 ? `${counts.recovered} got there on another go` : null,
                    counts.missed > 0 ? `${counts.missed} still to learn` : null,
                  ]
                    .filter(Boolean)
                    .join(', ') + '. Practising costs nothing — go again.'}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
              {again.length > 0 ? (
                <Button variant="primary" size="lg" onClick={() => begin(again)}>
                  The ones that needed another go
                </Button>
              ) : null}
              <Button
                variant={again.length > 0 ? 'secondary' : 'primary'}
                size="lg"
                onClick={() => begin(data.items.map((i) => i.wordId))}
              >
                All of them again
              </Button>
            </div>
          </div>
        ) : feedback ? (
          <FeedbackFlash feedback={feedback} />
        ) : waitingForChoice || !card || !item ? (
          <Spinner />
        ) : (
          <div className="flex flex-col gap-6">
            {note ? <p className="label text-center">{note}</p> : null}
            <QuestionCard
              question={{
                // Per card, not per word: the same word comes back, and its input
                // must start empty and take focus again when it does.
                id: `${card.wordId}:${round.at}`,
                index: round.at,
                total: round.cards.length,
                payload:
                  askedAs === 'choice'
                    ? {
                        type: 'mcq_translation',
                        direction: item.direction,
                        prompt: item.prompt,
                        options: choice.data!.options,
                      }
                    : { type: 'translate_input', direction: item.direction, prompt: item.prompt },
              }}
              disabled={busy}
              chosen={null}
              correctAnswer={null}
              onAnswer={(given) =>
                // A choice answers with the option's position; the grader wants its text.
                void submit(askedAs === 'choice' ? choice.data!.options[Number(given)]! : given)
              }
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
