import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnswerFeedback,
  AttemptView,
  QuestionPayload,
  StudentHomeView,
  StudentQuestionView,
} from '@voku/shared';
import { ApiError, api, student } from '../lib/api.ts';
import { Button, Empty, Rows, Row, Spinner, Status, Wordmark, cx } from '../components/ui.tsx';
import { StudyText, type Block } from './StudyText.tsx';
import { Drill } from '../components/Drill.tsx';
import {
  Countdown,
  FeedbackFlash,
  ProgressLine,
  QuestionCard,
  useFlash,
} from '../components/Sprint.tsx';

interface AttemptState {
  attempt: AttemptView;
  question: StudentQuestionView | null;
}

/** Centred single-plane frame, sized for a tablet in landscape. */
function Screen({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-8 py-8', className)}>
      {children}
    </div>
  );
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        {children}
      </div>
    </Screen>
  );
}

/**
 * Every dead end a student can reach — signed out, a dud code, a test that
 * ended. They all carry the wordmark, because these are the screens most likely
 * to be seen by someone who does not yet know what this app is, and a bare line
 * of grey text tells them nothing.
 */
function Message({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Centred>
      <Wordmark size="lg" />
      <div className="flex flex-col gap-3">
        <span className="label">{eyebrow}</span>
        <h1 className="text-hero">{title}</h1>
      </div>
      {children ? <div className="max-w-sm text-lg text-ink-60">{children}</div> : null}
      {action}
    </Centred>
  );
}

/** `/s/<token>` — swaps the token for a cookie so it leaves the address bar. */
function TokenLogin() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .post(student('/session'), { token })
      .then(() => !cancelled && navigate('/s', { replace: true }))
      .catch((err: ApiError) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (error) {
    return (
      <Message eyebrow="Sign in" title="That code did not work">
        {error} Ask your teacher for a new one — codes can be reprinted in a moment.
      </Message>
    );
  }
  return (
    <Centred>
      <Wordmark size="lg" />
      <Spinner label="Signing you in…" />
    </Centred>
  );
}

function Home() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['student', 'me'],
    queryFn: () => api.get<StudentHomeView>(student('/me')),
    // A test can open at any moment during the lesson.
    refetchInterval: 5000,
  });

  if (isLoading) return <Centred><Spinner /></Centred>;
  if (error) {
    return (
      <Message eyebrow="Vocabulary sprints" title="Scan your code to start">
        Point your camera at the code your teacher gave you. It signs you in and keeps you signed
        in — there is no password to remember.
      </Message>
    );
  }
  if (!data) return null;

  return (
    <Screen>
      <header className="rule-b flex items-baseline justify-between pb-5">
        <Wordmark size="sm" />
        <span className="label">
          {data.student.name} · {data.className}
        </span>
      </header>

      <div className="flex flex-col gap-14 py-12">
        <section className="flex flex-col gap-6">
          <span className="label">Ready</span>
          {data.openTests.length === 0 ? (
            <Empty title="Nothing to do right now">
              A quiz appears here the moment your teacher opens it.
            </Empty>
          ) : (
            <Rows>
              {data.openTests.map((test) => (
                <Row key={test.id}>
                  <div className="flex-1">
                    <p className="text-2xl font-semibold tracking-tight">{test.title}</p>
                    <p className="text-sm text-ink-40">
                      {Math.round(test.durationSeconds / 60)} minutes
                    </p>
                  </div>
                  {test.submitted ? (
                    <Status tone="quiet">Handed in</Status>
                  ) : (
                    <Button variant="primary" onClick={() => navigate(`/s/tests/${test.id}/sprint`)}>
                      {test.attemptId ? 'Carry on' : 'Start'}
                    </Button>
                  )}
                </Row>
              ))}
            </Rows>
          )}
        </section>

        {data.studyLists.length > 0 ? (
          <section className="flex flex-col gap-6">
            <span className="label">Words to learn</span>
            <Rows>
              {data.studyLists.map((list) => (
                <Row key={list.id} onClick={() => navigate(`/s/tests/${list.id}/words`)}>
                  <span className="flex-1 text-xl">{list.title}</span>
                  <span className="text-sm text-ink-40">{list.wordCount} words</span>
                  {/* Practising is the thing they are here to do, so it is one
                      tap from the front door rather than inside the list. */}
                  <Button
                    variant="primary"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/s/tests/${list.id}/drill`);
                    }}
                  >
                    Practise
                  </Button>
                </Row>
              ))}
            </Rows>
          </section>
        ) : null}

        {data.pastAttempts.length > 0 ? (
          <section className="flex flex-col gap-6">
            <span className="label">Finished</span>
            <Rows>
              {data.pastAttempts.map((attempt) => (
                <Row
                  key={attempt.attemptId}
                  onClick={() => navigate(`/s/attempts/${attempt.attemptId}/review`)}
                >
                  <span className="flex-1 text-xl">{attempt.testTitle}</span>
                  <span className="tabular text-2xl font-semibold tracking-tight">
                    {attempt.correctCount}
                    <span className="text-ink-40">/{attempt.targetCount}</span>
                  </span>
                </Row>
              ))}
            </Rows>
          </section>
        ) : null}
      </div>
    </Screen>
  );
}

function StudyList() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'text' | 'list'>('text');
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['student', 'words', testId],
    queryFn: () =>
      api.get<{
        title: string;
        words: Array<{ id: string; headwordEn: string; translationDe: string }>;
        blocks: Block[];
      }>(student(`/tests/${testId}/words`)),
  });

  // A test built from a pasted word list has no text to show.
  const hasText = (data?.blocks.length ?? 0) > 0;
  const showing = hasText ? mode : 'list';

  return (
    <Screen>
      <header className="rule-b flex flex-wrap items-baseline justify-between gap-4 pb-5">
        <span className="label">{data?.title ?? 'Words to learn'}</span>
        <div className="flex items-center gap-6">
          {hasText
            ? (
                [
                  ['text', 'In the text'],
                  ['list', 'Word list'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={cx(
                    'label py-1 transition-colors',
                    showing === value ? '!text-ink border-b-2 border-accent' : 'hover:!text-ink',
                  )}
                >
                  {label}
                </button>
              ))
            : null}
          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate(`/s/tests/${testId}/drill`)}
          >
            Practise
          </Button>
          <Button size="sm" variant="quiet" onClick={() => navigate('/s')}>
            Close
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="py-12">
          <Spinner />
        </div>
      ) : showing === 'text' ? (
        <div className="flex flex-col gap-6 py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <p className="text-ink-40">Tap a coloured word to see what it means.</p>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={cx('label transition-colors', showAll ? '!text-ink' : 'hover:!text-ink')}
            >
              {showAll ? 'Hide translations' : 'Show every translation'}
            </button>
          </div>
          <StudyText blocks={data!.blocks} showAll={showAll} />
        </div>
      ) : (
        <div className="py-10">
          <Rows>
            {(data?.words ?? []).map((word) => (
              <Row key={word.id}>
                <span className="flex-1 text-xl">{word.headwordEn}</span>
                <span className="flex-1 text-xl text-ink-60">{word.translationDe}</span>
              </Row>
            ))}
          </Rows>
        </div>
      )}
    </Screen>
  );
}

/** The class's practice screen. The drill itself is shared with the teacher's preview. */
function StudentDrill() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();

  return (
    <Screen>
      <Drill
        path={student(`/tests/${testId}/drill`)}
        queryKey={['student', 'drill', testId]}
        heading={<span className="label">Practice</span>}
        action={
          <Button size="sm" variant="quiet" onClick={() => navigate('/s')}>
            Close
          </Button>
        }
      />
    </Screen>
  );
}

/** Start screen (2a): eyebrow, wordmark, one-line summary, one primary action. */
function StartScreen({
  className: klass,
  title,
  poolSize,
  target,
  minutes,
  resuming,
  onStart,
}: {
  className: string;
  title: string;
  poolSize: number;
  target: number;
  minutes: number;
  resuming: boolean;
  onStart: () => void;
}) {
  return (
    <Centred>
      <span className="label">
        {klass} · {title}
      </span>
      <Wordmark size="lg" />
      <p className="text-lg text-ink-60">
        {poolSize} words · answer as many as you can · {minutes} minutes
      </p>
      <p className="max-w-md text-lg text-ink-40">
        {target} correct is a full score. You can go past it.
      </p>
      <Button variant="primary" size="lg" className="mt-4" onClick={onStart}>
        {resuming ? 'Carry on' : 'Start quiz'}
      </Button>
    </Centred>
  );
}

function Sprint({ mode }: { mode: 'graded' | 'practice' }) {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AttemptState | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const { feedback, show } = useFlash();

  const home = useQuery({
    queryKey: ['student', 'me'],
    queryFn: () => api.get<StudentHomeView>(student('/me')),
  });

  useEffect(() => {
    let cancelled = false;
    api
      .post<AttemptState>(student(`/tests/${testId}/${mode === 'graded' ? 'start' : 'practice'}`))
      .then((next) => !cancelled && setState(next))
      .catch((err: ApiError) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [testId, mode]);

  const finish = useCallback(
    (attemptId: string) => {
      void queryClient.invalidateQueries({ queryKey: ['student', 'me'] });
      navigate(`/s/attempts/${attemptId}/score`, { replace: true });
    },
    [navigate, queryClient],
  );

  const answer = async (given: string) => {
    if (!state?.question || busy) return;
    setBusy(true);
    setChosen(given);
    try {
      const result = await api.post<{
        feedback: AnswerFeedback;
        question: StudentQuestionView | null;
        attempt: AttemptView;
      }>(student(`/attempts/${state.attempt.id}/answers`), {
        questionId: state.question.id,
        given,
      });

      setRevealed(result.feedback.correctAnswer);
      show(result.feedback, () => {
        setBusy(false);
        setChosen(null);
        setRevealed(null);
        if (!result.question) {
          finish(result.attempt.id);
          return;
        }
        setState({ attempt: result.attempt, question: result.question });
      });
      setState((prev) => (prev ? { ...prev, attempt: result.attempt } : prev));
    } catch (err) {
      setBusy(false);
      setChosen(null);
      // Running out of time mid-answer is normal, not an error to shout about.
      if (err instanceof ApiError && err.status === 403) finish(state.attempt.id);
      else setError(err instanceof Error ? err.message : String(err));
    }
  };

  const expire = useCallback(() => {
    if (state) finish(state.attempt.id);
  }, [state, finish]);

  if (error) {
    return (
      <Message
        eyebrow="Quiz"
        title="This quiz is not open"
        action={
          <Button variant="primary" onClick={() => navigate('/s')}>
            Back
          </Button>
        }
      >
        {error}
      </Message>
    );
  }
  if (!state) {
    return (
      <Centred>
        <Wordmark size="lg" />
        <Spinner label="Getting ready…" />
      </Centred>
    );
  }

  const { attempt, question } = state;

  if (!started) {
    return (
      <StartScreen
        className={home.data?.className ?? ''}
        title={attempt.testTitle}
        poolSize={attempt.poolSize}
        target={attempt.targetCount}
        minutes={Math.round((attempt.deadlineAt ? attempt.secondsRemaining ?? 0 : 0) / 60) || 5}
        resuming={attempt.reachedIndex > 0}
        onStart={() => setStarted(true)}
      />
    );
  }

  return (
    <Screen className="py-6">
      {/* Quiz top bar (1a): close, progress line, counter. */}
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-6">
          <button
            type="button"
            onClick={() => finish(attempt.id)}
            aria-label="Hand in and leave"
            className="text-2xl leading-none text-ink-40 transition-colors hover:text-ink"
          >
            ×
          </button>
          <div className="flex items-center gap-5">
            {attempt.deadlineAt ? (
              <Countdown deadlineAt={attempt.deadlineAt} onExpire={expire} />
            ) : (
              <span className="label">Practice</span>
            )}
            <span className="tabular text-sm font-semibold text-ink-40">
              {question ? `${question.index} / ${question.total}` : ''}
            </span>
          </div>
        </div>
        <ProgressLine correct={attempt.correctCount} target={attempt.targetCount} />
      </header>

      <main className="flex flex-1 flex-col justify-center py-10">
        {feedback ? (
          <FeedbackFlash feedback={feedback} />
        ) : question ? (
          <QuestionCard
            question={question}
            disabled={busy}
            chosen={chosen}
            correctAnswer={revealed}
            onAnswer={answer}
          />
        ) : (
          <Spinner />
        )}
      </main>
    </Screen>
  );
}

/** Result screen (2b). */
function Score() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['student', 'attempt', attemptId],
    queryFn: () => api.get<AttemptState>(student(`/attempts/${attemptId}`)),
  });

  if (isLoading || !data) return <Centred><Spinner /></Centred>;
  const { attempt } = data;
  const missed = Math.max(0, attempt.reachedIndex - attempt.correctCount);

  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <span className="label">Quiz complete</span>
        {/*
          The brief calls for one huge score. Ours is uncapped, so the percentage
          is the number that carries the achievement — the raw count sits under
          it as meta, in the brief's secondary weight.
        */}
        <p className="text-display font-semibold">{attempt.percent}%</p>
        <p className="text-lg text-ink-60">
          {attempt.correctCount} correct of {attempt.targetCount} needed
          {missed > 0 ? ` · ${missed} missed` : ''}
        </p>
        <ProgressLine
          correct={attempt.correctCount}
          target={attempt.targetCount}
          className="mt-6 max-w-md"
        />
      </div>

      <div className="rule-t flex justify-center gap-4 pt-8">
        <Button onClick={() => navigate(`/s/attempts/${attempt.id}/review`)}>Review answers</Button>
        <Button variant="primary" onClick={() => navigate('/s')}>
          Continue
        </Button>
      </div>
    </Screen>
  );
}

interface ReviewRow {
  id: string;
  orderIndex: number;
  payload: QuestionPayload;
  correctAnswer: string;
  given: string | null;
  correct: boolean | null;
  reached: boolean;
}

function Review() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['student', 'review', attemptId],
    queryFn: () =>
      api.get<{ attempt: AttemptView; questions: ReviewRow[] }>(
        student(`/attempts/${attemptId}/review`),
      ),
  });

  if (isLoading) return <Centred><Spinner /></Centred>;
  if (error) {
    return (
      <Message
        eyebrow="Review"
        title="Not available yet"
        action={
          <Button variant="primary" onClick={() => navigate('/s')}>
            Back
          </Button>
        }
      >
        {(error as ApiError).message}
      </Message>
    );
  }
  if (!data) return null;

  const promptOf = (payload: QuestionPayload) => {
    switch (payload.type) {
      case 'translate_input':
      case 'mcq_translation':
        return payload.prompt;
      case 'mcq_definition':
        return `“${payload.definition}”`;
      case 'fill_blank':
        return payload.sentence.replace('___', '_______');
    }
  };

  const missed = data.questions.filter((q) => q.reached && q.correct === false);
  const notReached = data.questions.filter((q) => !q.reached);

  return (
    <Screen>
      <header className="rule-b flex items-baseline justify-between pb-5">
        <span className="label">{data.attempt.testTitle}</span>
        <Button size="sm" variant="quiet" onClick={() => navigate('/s')}>
          Close
        </Button>
      </header>

      <div className="flex flex-col gap-10 py-10">
        <p className="max-w-prose text-xl">
          {missed.length === 0
            ? 'Everything you reached was right.'
            : `${missed.length} to learn.`}
          {notReached.length > 0 ? (
            <span className="text-ink-40">
              {' '}
              You did not get to {notReached.length} of them.
            </span>
          ) : null}
        </p>

        <Rows>
          {data.questions.map((row) => {
            const wrong = row.reached && row.correct === false;
            return (
              <Row key={row.id}>
                <span className="tabular w-8 shrink-0 text-sm text-ink-40">
                  {String(row.orderIndex + 1).padStart(2, '0')}
                </span>

                {/* A miss is the thing worth looking at, so it is the only row
                    set at full strength. What you already knew recedes. */}
                <span
                  className={cx(
                    'min-w-40 flex-1 text-lg',
                    wrong ? 'text-ink' : row.reached ? 'text-ink-60' : 'text-ink-40',
                  )}
                >
                  {promptOf(row.payload)}
                </span>

                {wrong ? (
                  <span className="text-lg text-ink-40 line-through">{row.given}</span>
                ) : null}

                <span
                  className={cx(
                    'w-44 shrink-0 text-right text-lg',
                    wrong ? 'font-semibold text-ink' : row.reached ? 'text-ink-60' : 'text-ink-40',
                  )}
                >
                  {row.correctAnswer}
                </span>
              </Row>
            );
          })}
        </Rows>

        <div className="flex justify-center">
          <Button
            variant="primary"
            onClick={() => navigate(`/s/tests/${data.attempt.testId}/practice`)}
          >
            Practise these words
          </Button>
        </div>
      </div>
    </Screen>
  );
}

export function StudentApp() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/:token" element={<TokenLogin />} />
      <Route path="/tests/:testId/sprint" element={<Sprint mode="graded" />} />
      <Route path="/tests/:testId/practice" element={<Sprint mode="practice" />} />
      <Route path="/tests/:testId/words" element={<StudyList />} />
      <Route path="/tests/:testId/drill" element={<StudentDrill />} />
      <Route path="/attempts/:attemptId/score" element={<Score />} />
      <Route path="/attempts/:attemptId/review" element={<Review />} />
      <Route path="*" element={<Navigate to="/s" replace />} />
    </Routes>
  );
}
