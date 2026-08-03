import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BLANK, type QuestionPayload, type QuestionView } from '@voku/shared';
import { ApiError, admin, api } from '../lib/api.ts';
import { Button, ErrorText, Field, Input, Textarea, cx } from '../components/ui.tsx';

/**
 * Inline editing for every format. The teacher gets the last word on anything a
 * model wrote — including which options are right, which is why the correct
 * answer is a radio button rather than something hidden in the payload.
 */
export function QuestionEditor({
  testId,
  question,
  onSaved,
}: {
  testId: string;
  question: QuestionView;
  onSaved: () => void;
}) {
  const [payload, setPayload] = useState<QuestionPayload>(question.payload);

  const save = useMutation({
    mutationFn: () => api.patch(admin(`/tests/${testId}/questions/${question.id}`), { payload }),
    onSuccess: onSaved,
  });

  const setOption = (index: number, value: string) => {
    if (payload.type !== 'mcq_translation' && payload.type !== 'mcq_definition') return;
    const options = [...payload.options];
    options[index] = value;
    setPayload({ ...payload, options });
  };

  return (
    <div className="flex flex-col gap-4 rule-t pt-6">
      {payload.type === 'translate_input' ? (
        <>
          <Field label="Shown to the student">
            <Input
              value={payload.prompt}
              onChange={(e) => setPayload({ ...payload, prompt: e.target.value })}
            />
          </Field>
          <Field
            label="Accepted answers"
            hint="One per line. Spelling is marked strictly, so add every form you would accept."
          >
            <Textarea
              value={payload.accepted.join('\n')}
              className="min-h-24"
              onChange={(e) =>
                setPayload({ ...payload, accepted: e.target.value.split('\n').map((s) => s.trim()) })
              }
            />
          </Field>
        </>
      ) : null}

      {payload.type === 'fill_blank' ? (
        <>
          <Field label="Sentence" hint={`Use exactly one ${BLANK} where the word belongs.`}>
            <Textarea
              value={payload.sentence}
              className="min-h-20"
              onChange={(e) => setPayload({ ...payload, sentence: e.target.value })}
            />
          </Field>
          <Field label="Accepted answers" hint="One per line — include the inflected form the gap needs.">
            <Textarea
              value={payload.accepted.join('\n')}
              className="min-h-20"
              onChange={(e) =>
                setPayload({ ...payload, accepted: e.target.value.split('\n').map((s) => s.trim()) })
              }
            />
          </Field>
          <Field label="Hint (optional)">
            <Input
              value={payload.hint ?? ''}
              onChange={(e) => setPayload({ ...payload, hint: e.target.value || undefined })}
            />
          </Field>
        </>
      ) : null}

      {payload.type === 'mcq_translation' || payload.type === 'mcq_definition' ? (
        <>
          <Field label={payload.type === 'mcq_translation' ? 'Word shown' : 'Definition shown'}>
            {payload.type === 'mcq_translation' ? (
              <Input
                value={payload.prompt}
                onChange={(e) => setPayload({ ...payload, prompt: e.target.value })}
              />
            ) : (
              <Textarea
                value={payload.definition}
                className="min-h-20"
                onChange={(e) => setPayload({ ...payload, definition: e.target.value })}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="label">
              Options — pick the right one
            </legend>
            {payload.options.map((option, index) => (
              <div key={index} className="flex items-center gap-3">
                <input
                  type="radio"
                  name={`correct-${question.id}`}
                  checked={payload.correctIndex === index}
                  onChange={() => setPayload({ ...payload, correctIndex: index })}
                  className="size-5 accent-[var(--color-accent)]"
                  aria-label={`Mark option ${index + 1} correct`}
                />
                <Input
                  value={option}
                  onChange={(e) => setOption(index, e.target.value)}
                  className={cx(payload.correctIndex === index && 'border-accent')}
                />
              </div>
            ))}
          </fieldset>
        </>
      ) : null}

      <ErrorText>
        {save.error
          ? `${(save.error as ApiError).message}${
              (save.error as ApiError).details
                ? ` — ${JSON.stringify((save.error as ApiError).details)}`
                : ''
            }`
          : null}
      </ErrorText>

      <div className="flex gap-2">
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save question
        </Button>
        <Button onClick={() => setPayload(question.payload)}>Undo</Button>
      </div>
    </div>
  );
}
