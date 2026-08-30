import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_MIX,
  QUESTION_TYPES,
  type AchievedMix,
  type MixWeights,
  type QuestionType,
  type QuestionView,
  type RepeatCandidate,
  type TestView,
  type WordView,
} from '@voku/shared';
import { ApiError, admin, api, waitForJob } from '../lib/api.ts';
import type { JobView } from '@voku/shared';
import {
  Button,
  EditableHeading,
  Empty,
  ErrorText,
  Field,
  Input,
  Note,
  Row,
  Rows,
  Select,
  Spinner,
  Status,
  Textarea,
  cx,
} from '../components/ui.tsx';
import { QuestionEditor } from './QuestionEditor.tsx';

const TYPE_LABEL: Record<QuestionType, string> = {
  translate_input: 'Type the translation',
  mcq_translation: 'Multiple choice · translation',
  mcq_definition: 'Multiple choice · definition',
  fill_blank: 'Fill in the blank',
};

const STEPS = ['Text', 'Words', 'Design', 'Questions', 'Open'] as const;

export function Composer() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const test = useQuery({
    queryKey: ['admin', 'test', testId],
    queryFn: () => api.get<TestView>(admin(`/tests/${testId}`)),
  });

  const llm = useQuery({
    queryKey: ['admin', 'llm'],
    queryFn: () => api.get<{ configured: boolean }>(admin('/settings/llm')),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'test', testId] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'words', testId] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'questions', testId] });
  };

  const rename = useMutation({
    mutationFn: (title: string) => api.patch(admin(`/tests/${testId}`), { title }),
    onSuccess: () => {
      setBanner(null);
      refresh();
    },
    onError: (error: ApiError) => setBanner(error.message),
  });

  /**
   * AI work runs on the server, so the browser is free to walk away. Polling it
   * here rather than inside a step means switching steps, reloading, or coming
   * back to a backgrounded tab all rejoin the job instead of losing it.
   */
  const job = useQuery({
    queryKey: ['admin', 'active-job', testId],
    queryFn: () => api.get<{ job: JobView | null }>(admin(`/tests/${testId}/active-job`)),
    refetchInterval: (q) => {
      const j = q.state.data?.job;
      return j && j.status !== 'error' ? 1500 : false;
    },
  });

  const latest = job.data?.job ?? null;
  const running = latest && latest.status !== 'error' ? latest : null;
  const failed = latest && latest.status === 'error' ? latest : null;

  const wasRunning = useRef(false);
  useEffect(() => {
    // The moment it finishes, pull in whatever it produced.
    if (wasRunning.current && !running) refresh();
    wasRunning.current = Boolean(running);
  });

  const lifecycle = useMutation({
    mutationFn: (action: 'publish' | 'unpublish' | 'open' | 'close') =>
      api.post<TestView>(admin(`/tests/${testId}/${action}`)),
    onSuccess: () => {
      setBanner(null);
      refresh();
    },
    onError: (error: ApiError) => setBanner(error.message),
  });

  if (test.isLoading) return <Spinner />;
  if (!test.data) return null;
  const aiReady = llm.data?.configured === true;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link
            to={`/admin/classes/${test.data.classId}`}
            className="label transition-colors hover:!text-ink"
          >
            ← {test.data.className}
          </Link>
          {/* Renaming stays available even while the test is open — it is
              cosmetic, and everything that actually shapes the test is locked. */}
          <EditableHeading
            value={test.data.title}
            ariaLabel="Test name"
            onSave={(title) => rename.mutate(title)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Status tone={test.data.status === 'open' ? 'accent' : 'quiet'}>{test.data.status}</Status>
          {(test.data.status === 'open' || test.data.status === 'closed') && (
            <Button size="sm" onClick={() => navigate(`/admin/tests/${testId}/board`)}>
              Live board
            </Button>
          )}
        </div>
      </div>

      <nav className="rule-b flex flex-wrap gap-8 pb-4">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(index)}
            className={cx(
              'label py-1 transition-colors',
              step === index ? '!text-ink border-b-2 border-accent' : 'hover:!text-ink',
            )}
          >
            <span className="tabular">{String(index + 1).padStart(2, '0')}</span> {label}
          </button>
        ))}
      </nav>

      {test.data.status === 'open' ? (
        <Note>
          <b>This test is open.</b> Students are taking it right now, so it cannot be edited. Close
          it from the live board first.
        </Note>
      ) : null}

      {banner ? <ErrorText>{banner}</ErrorText> : null}

      {running ? <JobBanner job={running} /> : null}
      {failed ? (
        <div className="rule-t rule-b flex flex-col gap-2 py-5">
          <span className="label">The AI step did not finish</span>
          <p className="max-w-prose text-ink">{failed.error}</p>
          <p className="text-sm text-ink-40">
            Nothing was lost — try again, pick a different model in Settings, or build the test by
            hand.
          </p>
        </div>
      ) : null}

      {step === 0 ? <TextStep test={test.data} aiReady={aiReady} onDone={refresh} /> : null}
      {step === 1 ? <WordsStep test={test.data} aiReady={aiReady} onDone={refresh} /> : null}
      {step === 2 ? <DesignStep test={test.data} onDone={refresh} /> : null}
      {step === 3 ? <QuestionsStep test={test.data} aiReady={aiReady} onDone={refresh} /> : null}
      {step === 4 ? (
        <OpenStep
          test={test.data}
          onAction={(action) => lifecycle.mutate(action)}
          pending={lifecycle.isPending}
        />
      ) : null}

      <div className="rule-t flex justify-between pt-6">
        <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={step === STEPS.length - 1}
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * A running job, shown wherever you are in the composer. Some models take
 * minutes, so this states the elapsed time rather than pretending to know how
 * long is left.
 */
function JobBanner({ job }: { job: JobView }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [job.id]);

  const label =
    job.kind === 'extract'
      ? 'Reading the text for words worth training'
      : job.kind === 'generate'
        ? 'Writing the questions'
        : 'Reading the page';

  const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : null;

  return (
    <div className="rule-t rule-b flex flex-col gap-3 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-ink">
          {label}
          {pct !== null ? ` — ${job.progress} of ${job.total}` : '…'}
        </span>
        <span className="tabular text-sm text-ink-40">
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed
        </span>
      </div>

      <div className="relative h-px w-full bg-hairline">
        <div
          className={cx('absolute inset-y-0 left-0 bg-accent', pct === null && 'animate-pulse')}
          style={{ width: pct === null ? '100%' : `${pct}%` }}
        />
      </div>

      <p className="text-sm text-ink-40">
        This runs on the server — you can move around, or close the tab and come back.
        {elapsed > 60 ? ' Slower models can take several minutes.' : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1 — the text
// ---------------------------------------------------------------------------

function TextStep({
  test,
  aiReady,
  onDone,
}: {
  test: TestView;
  aiReady: boolean;
  onDone: () => void;
}) {
  const [text, setText] = useState(test.sourceText);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () => api.patch(admin(`/tests/${test.id}`), { sourceText: text }),
    onSuccess: onDone,
  });

  const transcribe = async (files: FileList) => {
    setError(null);
    setStatus('Reading the page…');
    try {
      const images = await Promise.all(
        [...files].slice(0, 6).map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('Could not read that file'));
              reader.readAsDataURL(file);
            }),
        ),
      );
      const { jobId } = await api.post<{ jobId: string }>(
        admin(`/tests/${test.id}/transcribe`),
        { images },
      );
      const result = await waitForJob<{ text: string }>(jobId);
      setText((prev) => (prev ? `${prev}\n\n${result.text}` : result.text));
      setStatus('Read it — check the text before going on.');
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Field
        label="The text"
        hint="Paste whatever you are reading with the class. This is only used to find the words."
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-64"
          placeholder="Paste the English text here…"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save text
        </Button>
        {aiReady ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && transcribe(e.target.files)}
            />
            <Button onClick={() => fileRef.current?.click()}>Photograph a page instead</Button>
          </>
        ) : null}
        {status ? <span className="text-sm text-ink-60">{status}</span> : null}
      </div>
      <ErrorText>{error}</ErrorText>

      {!aiReady ? (
        <Note>
          <b>No language model configured.</b> You can skip this step entirely — go to Words and
          paste a two-column list instead. Everything except gap sentences and English definitions
          works without one.
        </Note>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 — the word list
// ---------------------------------------------------------------------------

function WordsStep({
  test,
  aiReady,
  onDone,
}: {
  test: TestView;
  aiReady: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRepeats, setShowRepeats] = useState(false);

  const words = useQuery({
    queryKey: ['admin', 'words', test.id],
    queryFn: () => api.get<WordView[]>(admin(`/tests/${test.id}/words`)),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'words', test.id] });
    onDone();
  };

  const pasteWords = useMutation({
    mutationFn: () => api.post(admin(`/tests/${test.id}/words/paste`), { text: paste }),
    onSuccess: () => {
      setPaste('');
      invalidate();
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, included }: { id: string; included: boolean }) =>
      api.patch(admin(`/tests/${test.id}/words/${id}`), { included }),
    onSuccess: invalidate,
  });

  const setTrap = useMutation({
    mutationFn: ({ id, trickiness }: { id: string; trickiness: number }) =>
      api.patch(admin(`/tests/${test.id}/words/${id}`), { trickiness }),
    onSuccess: invalidate,
  });

  const cutoff = useMutation({
    mutationFn: (keep: number) => api.post(admin(`/tests/${test.id}/cutoff`), { keep }),
    onSuccess: invalidate,
  });

  const extract = async () => {
    setError(null);
    setBusy('Starting…');
    try {
      await api.post<{ jobId: string }>(admin(`/tests/${test.id}/extract-words`), { level: 'B1' });
      // The banner at the top of the composer takes it from here, so this step
      // does not have to stay mounted for the work to finish.
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const list = words.data ?? [];
  const included = list.filter((w) => w.included);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {aiReady ? (
          <Button variant="primary" onClick={extract} disabled={Boolean(busy)}>
            Find the words in the text
          </Button>
        ) : null}
        <Button onClick={() => setShowRepeats((v) => !v)}>Words from an earlier test</Button>
        {busy ? <Spinner label={busy} /> : null}
      </div>
      <ErrorText>{error}</ErrorText>

      {showRepeats ? <RepeatPicker test={test} onImported={invalidate} /> : null}

      <details className="rule-t rule-b py-6">
        <summary className="label cursor-pointer transition-colors hover:!text-ink">
          Paste a word list instead
        </summary>
        <div className="mt-4 flex flex-col gap-3">
          <Field
            label="One pair per line"
            hint="English first, then German — separated by a semicolon, a tab, or a spaced hyphen. The order you paste is taken as easiest-to-hardest."
          >
            <Textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'receive;bekommen\nthorough;gründlich\nnevertheless;dennoch'}
            />
          </Field>
          <Button
            variant="primary"
            disabled={!paste.trim() || pasteWords.isPending}
            onClick={() => pasteWords.mutate()}
          >
            Add these words
          </Button>
        </div>
      </details>

      {list.length === 0 ? (
        <Empty title="No words yet">
          Find them in the text, or paste a list — whichever is quicker today.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-ink-60">
              <strong className="text-ink">{included.length}</strong> of {list.length} words in the
              test
            </p>
            <label className="flex items-center gap-3 text-sm">
              <span className="text-ink-60">Keep the hardest</span>
              <input
                type="range"
                min={1}
                max={list.length}
                defaultValue={included.length}
                onMouseUp={(e) => cutoff.mutate(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => cutoff.mutate(Number((e.target as HTMLInputElement).value))}
                className="w-44 accent-[var(--color-accent)]"
              />
            </label>
          </div>

          <Rows>
            {list.map((word) => (
              <Row key={word.id} className={cx(!word.included && 'opacity-40')}>
                <input
                  type="checkbox"
                  checked={word.included}
                  onChange={() => toggle.mutate({ id: word.id, included: !word.included })}
                  className="size-5 accent-[var(--color-accent)]"
                  aria-label={`Include ${word.headwordEn}`}
                />
                <span className="tabular w-6 text-sm text-ink-25">{word.difficulty}</span>
                <span className="min-w-32 flex-1 text-lg">{word.headwordEn}</span>
                <span className="min-w-32 flex-1 text-lg text-ink-60">{word.translationDe}</span>
                {word.origin === 'repeat' ? <Status tone="quiet">repeat</Status> : null}
                {/*
                  Marking a trap is what earns a word multiple choice, so it has
                  to be settable by hand — otherwise a teacher working without a
                  language model could never flag a false friend they can see.
                */}
                <button
                  type="button"
                  title={
                    word.trickinessNote ??
                    'Mark as a false friend or confusable, so it gets multiple choice'
                  }
                  onClick={() =>
                    setTrap.mutate({ id: word.id, trickiness: word.trickiness >= 2 ? 0 : 3 })
                  }
                  className={cx(
                    'border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors',
                    word.trickiness >= 2
                      ? 'border-accent text-accent'
                      : 'border-hairline text-ink-25 hover:border-ink hover:text-ink-60',
                  )}
                >
                  trap
                </button>
              </Row>
            ))}
          </Rows>
          <p className="text-sm text-ink-60">
            The number is difficulty, and it sets the order of the sprint — easiest first.
            Multiple choice goes to words that are hard (7 and above) or marked as a trap —
            anywhere else it would just be a free guess. Tap “trap” to mark a false friend.
          </p>
        </>
      )}
    </div>
  );
}

function RepeatPicker({ test, onImported }: { test: TestView; onImported: () => void }) {
  const [sourceId, setSourceId] = useState<string>('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const sources = useQuery({
    queryKey: ['admin', 'repeat-sources', test.id],
    queryFn: () =>
      api.get<Array<{ id: string; title: string; status: string }>>(
        admin(`/tests/${test.id}/repeat-sources`),
      ),
  });

  const candidates = useQuery({
    queryKey: ['admin', 'repeat-candidates', test.id, sourceId],
    queryFn: () =>
      api.get<RepeatCandidate[]>(
        admin(`/tests/${test.id}/repeat-candidates?fromTestId=${sourceId}`),
      ),
    enabled: Boolean(sourceId),
  });

  const importWords = useMutation({
    mutationFn: () =>
      api.post(admin(`/tests/${test.id}/import-words`), {
        fromTestId: sourceId,
        wordIds: [...picked],
      }),
    onSuccess: () => {
      setPicked(new Set());
      onImported();
    },
  });

  return (
    <div className="rule-t rule-b flex flex-col gap-6 py-8">
      <Field label="Take words from">
        <Select value={sourceId} onChange={(e) => setSourceId((e.target as HTMLSelectElement).value)}>
          <option value="">Choose an earlier test…</option>
          {sources.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
      </Field>

      {candidates.data ? (
        <>
          <p className="text-sm text-ink-60">
            The rate counts only students who actually reached the question — in a sprint most never
            get to the last few, and counting those as wrong would be unfair to the word.
          </p>
          <ul className="max-h-80 overflow-y-auto">
            {candidates.data.map((c) => (
              <li key={c.wordId} className="rule-t flex items-center gap-4 py-3">
                <input
                  type="checkbox"
                  checked={picked.has(c.wordId)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      next.has(c.wordId) ? next.delete(c.wordId) : next.add(c.wordId);
                      return next;
                    })
                  }
                  className="size-5 accent-[var(--color-accent)]"
                />
                <span className="flex-1 text-lg">{c.headwordEn}</span>
                <span className="flex-1 text-sm text-ink-60">{c.translationDe}</span>
                <span
                  className={cx(
                    'tabular text-sm',
                    c.correctRate === null ? 'text-ink-25' : 'text-ink-60',
                  )}
                >
                  {c.correctRate === null ? 'not reached' : `${c.correctRate}% right`}
                </span>
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            disabled={picked.size === 0 || importWords.isPending}
            onClick={() => importWords.mutate()}
          >
            Add {picked.size} word{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 — the design
// ---------------------------------------------------------------------------

function DesignStep({ test, onDone }: { test: TestView; onDone: () => void }) {
  const [mix, setMix] = useState<MixWeights>(test.mix ?? DEFAULT_MIX);
  const [duration, setDuration] = useState(test.durationSeconds);
  const [target, setTarget] = useState(test.targetCount);
  const [direction, setDirection] = useState(test.direction);

  const save = useMutation({
    mutationFn: () =>
      api.patch(admin(`/tests/${test.id}`), {
        mix,
        durationSeconds: duration,
        targetCount: target,
        direction,
      }),
    onSuccess: onDone,
  });

  const poolTooSmall = test.includedCount > 0 && test.includedCount <= target;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Minutes" hint="The clock starts when each student taps Start.">
          <Input
            type="number"
            min={1}
            max={60}
            value={Math.round(duration / 60)}
            onChange={(e) => setDuration(Math.max(1, Number(e.target.value)) * 60)}
          />
        </Field>
        <Field label="Target = 100%" hint="Getting past this is the point.">
          <Input
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(Math.max(1, Number(e.target.value)))}
          />
        </Field>
        <Field label="Direction">
          <Select
            value={direction}
            onChange={(e) => setDirection((e.target as HTMLSelectElement).value as TestView['direction'])}
          >
            <option value="de_en">German → English (harder)</option>
            <option value="en_de">English → German (easier)</option>
            <option value="mixed">Mixed</option>
          </Select>
        </Field>
      </div>

      {poolTooSmall ? (
        <Note>
          <b>Nobody could score above 100%.</b> There are {test.includedCount} words and the target
          is {target}. Add more words, or lower the target — otherwise the ceiling removes the
          reason to keep going.
        </Note>
      ) : (
        <p className="text-sm text-ink-60">
          {test.includedCount} questions against a target of {target} — a student who answers them
          all scores{' '}
          <strong className="text-ink">
            {target > 0 ? Math.round((test.includedCount / target) * 100) : 0}%
          </strong>
          .
        </p>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl">The mix</h2>
          <p className="text-sm text-ink-60">
            These are preferences, not quotas. Multiple choice only goes to words flagged as traps,
            so if the text has few, you will get fewer — and the next step says so plainly.
          </p>
        </div>
        {QUESTION_TYPES.map((type) => (
          <label key={type} className="flex flex-wrap items-center gap-3">
            <span className="min-w-56 text-lg">{TYPE_LABEL[type]}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={mix[type]}
              onChange={(e) => setMix({ ...mix, [type]: Number(e.target.value) })}
              className="w-52 accent-[var(--color-accent)]"
            />
            <span className="tabular w-10 text-sm text-ink-40">{mix[type]}</span>
          </label>
        ))}
      </div>

      <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
        Save design
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 — the questions
// ---------------------------------------------------------------------------

function QuestionsStep({
  test,
  aiReady,
  onDone,
}: {
  test: TestView;
  aiReady: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ['admin', 'questions', test.id],
    queryFn: () =>
      api.get<{ questions: QuestionView[]; report: AchievedMix | null }>(
        admin(`/tests/${test.id}/questions`),
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'questions', test.id] });
    onDone();
  };

  const generate = async (withAi: boolean) => {
    setError(null);
    setBusy(withAi ? 'Starting…' : 'Building the questions…');
    try {
      if (withAi) {
        await api.post<{ jobId: string }>(admin(`/tests/${test.id}/generate-questions`), {});
        onDone(); // the composer's banner follows it from here
      } else {
        await api.post(admin(`/tests/${test.id}/generate`));
        invalidate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(admin(`/tests/${test.id}/questions/${id}`)),
    onSuccess: invalidate,
  });

  const regenerate = useMutation({
    mutationFn: ({ id, type }: { id: string; type?: QuestionType }) =>
      api.post(admin(`/tests/${test.id}/questions/${id}/regenerate`), type ? { type } : {}),
    onSuccess: invalidate,
    onError: (e: ApiError) => setError(e.message),
  });

  const questions = data.data?.questions ?? [];
  const report = data.data?.report;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {aiReady ? (
          <Button variant="primary" onClick={() => generate(true)} disabled={Boolean(busy)}>
            Write the questions
          </Button>
        ) : null}
        <Button onClick={() => generate(false)} disabled={Boolean(busy)}>
          {aiReady ? 'Build without the AI' : 'Build the questions'}
        </Button>
        {busy ? <Spinner label={busy} /> : null}
      </div>
      <ErrorText>{error}</ErrorText>

      {report ? <MixReport report={report} /> : null}

      {questions.length === 0 ? (
        <Empty title="No questions yet">
          One question per word, in order of difficulty — the same order for every student.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {questions.map((question) => (
            <li key={question.id}>
              <div className="rule-b flex flex-col gap-4 py-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="tabular text-sm text-ink-25">
                      {String(question.orderIndex + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="text-xl font-semibold tracking-tight">{question.headwordEn}</p>
                      <span className="label">{TYPE_LABEL[question.type]}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Select
                      value={question.type}
                      onChange={(e) =>
                        regenerate.mutate({
                          id: question.id,
                          type: (e.target as HTMLSelectElement).value as QuestionType,
                        })
                      }
                      className="min-h-9 w-52 text-sm"
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TYPE_LABEL[type]}
                        </option>
                      ))}
                    </Select>
                    {aiReady ? (
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => regenerate.mutate({ id: question.id })}
                      >
                        Rewrite
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => setEditing(editing === question.id ? null : question.id)}
                    >
                      {editing === question.id ? 'Close' : 'Edit'}
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => remove.mutate(question.id)}>
                      Drop
                    </Button>
                  </div>
                </div>

                {editing === question.id ? (
                  <QuestionEditor
                    testId={test.id}
                    question={question}
                    onSaved={() => {
                      setEditing(null);
                      invalidate();
                    }}
                  />
                ) : (
                  <QuestionPreview question={question} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionPreview({ question }: { question: QuestionView }) {
  const p = question.payload;
  if (p.type === 'translate_input') {
    return (
      <p className="text-ink-60">
        {p.prompt} → <span className="text-ink">{p.accepted.join(' / ')}</span>
      </p>
    );
  }
  if (p.type === 'fill_blank') {
    return (
      <p className="text-ink-60">
        {p.sentence.replace('___', '______')} → <span className="text-ink">{p.accepted[0]}</span>
      </p>
    );
  }
  const prompt = p.type === 'mcq_translation' ? p.prompt : `“${p.definition}”`;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-ink">{prompt}</p>
      <ul className="flex flex-wrap gap-2">
        {p.options.map((option, index) => (
          <li
            key={option}
            className={cx(
              'border px-2 py-0.5',
              index === p.correctIndex ? 'border-accent text-accent' : 'border-hairline text-ink-40',
            )}
          >
            {option}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MixReport({ report }: { report: AchievedMix }) {
  return (
    <div className="rule-t rule-b flex flex-col gap-4 py-8">
      <span className="label">What the text actually supported</span>
      <ul className="grid gap-1 sm:grid-cols-2">
        {QUESTION_TYPES.map((type) => (
          <li key={type} className="flex justify-between gap-4 text-sm">
            <span className="text-ink-60">{TYPE_LABEL[type]}</span>
            <span className="tabular">{report.achieved[type]}</span>
          </li>
        ))}
      </ul>
      {report.shortfalls.length > 0 ? (
        <div className="rule-t flex flex-col gap-2 pt-4">
          {report.shortfalls.map((shortfall, index) => (
            <p key={index} className="text-sm text-ink-60">
              <strong>
                {TYPE_LABEL[shortfall.type]}: asked for {shortfall.wanted}, got {shortfall.got}.
              </strong>{' '}
              {shortfall.reason}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 — opening it
// ---------------------------------------------------------------------------

function OpenStep({
  test,
  onAction,
  pending,
}: {
  test: TestView;
  onAction: (action: 'publish' | 'unpublish' | 'open' | 'close') => void;
  pending: boolean;
}) {
  const ceiling = test.targetCount > 0 ? Math.round((test.questionCount / test.targetCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="rule-t rule-b flex flex-col gap-4 py-8">
        <span className="label">Ready?</span>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Stat label="Questions">{test.questionCount}</Stat>
          <Stat label="Target">{test.targetCount}</Stat>
          <Stat label="Time">{Math.round(test.durationSeconds / 60)} minutes</Stat>
          <Stat label="Highest possible">
            <span className={ceiling > 100 ? 'text-ink' : 'text-accent'}>{ceiling}%</span>
          </Stat>
        </dl>
      </div>

      <div className="flex flex-wrap gap-3">
        {test.status === 'draft' ? (
          <Button onClick={() => onAction('publish')} disabled={pending}>
            Publish the word list
          </Button>
        ) : null}
        {test.status === 'published' ? (
          <Button onClick={() => onAction('unpublish')} disabled={pending}>
            Unpublish
          </Button>
        ) : null}
        {test.status !== 'open' ? (
          <Button variant="primary" size="lg" onClick={() => onAction('open')} disabled={pending}>
            Open the test
          </Button>
        ) : (
          <Button variant="danger" size="lg" onClick={() => onAction('close')} disabled={pending}>
            Close the test
          </Button>
        )}
      </div>

      <p className="text-sm text-ink-60">
        Publishing shows students the word list to learn from. Opening starts the sprint — the list
        disappears while it runs, and comes back once you close it.
      </p>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rule-b flex justify-between gap-4 py-2">
      <dt className="text-ink-60">{label}</dt>
      <dd className="tabular">{children}</dd>
    </div>
  );
}
