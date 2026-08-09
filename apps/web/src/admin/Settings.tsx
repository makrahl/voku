import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LlmSettingsPublic } from '@voku/shared';
import { ApiError, admin, api } from '../lib/api.ts';
import { Button, ErrorText, Field, Input, Note, Spinner, Status } from '../components/ui.tsx';
import { AdminSection } from './AdminSection.tsx';

type Settings = LlmSettingsPublic & { configured: boolean };

export function LlmSettings() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ baseUrl: '', model: '', visionModel: '', apiKey: '' });
  const [tested, setTested] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['admin', 'llm'],
    queryFn: () => api.get<Settings>(admin('/settings/llm')),
  });

  useEffect(() => {
    if (!settings.data) return;
    setForm((prev) => ({
      ...prev,
      baseUrl: settings.data.baseUrl,
      model: settings.data.model,
      visionModel: settings.data.visionModel ?? '',
    }));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<Settings>(admin('/settings/llm'), {
        baseUrl: form.baseUrl,
        model: form.model,
        visionModel: form.visionModel,
        // Left blank means "leave the stored key alone"; the field is write-only.
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      }),
    onSuccess: () => {
      setForm((prev) => ({ ...prev, apiKey: '' }));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'llm'] });
    },
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; model: string }>(admin('/settings/llm/test')),
    onSuccess: (result) => setTested(`Working — answered as ${result.model}.`),
    onError: () => setTested(null),
  });

  if (settings.isLoading) return <Spinner />;

  return (
    <AdminSection
      title="Language model"
      intro="Optional, and shared by everyone on this instance. Without one you can still build and run every test — you just write the gap sentences and definitions yourself."
    >
      <div className="flex max-w-xl flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <span className="label">Connection</span>
          <Status tone={settings.data?.configured ? 'accent' : 'quiet'}>
            {settings.data?.configured ? 'connected' : 'not configured'}
          </Status>
        </div>

        <Field
          label="API base URL"
          hint="OpenRouter, OpenAI, or anything that speaks the same dialect — including a model running on your own machine."
        >
          <Input
            value={form.baseUrl}
            placeholder="https://openrouter.ai/api/v1"
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </Field>

        <Field label="API key" hint={settings.data?.hasApiKey ? 'A key is saved. Leave blank to keep it.' : undefined}>
          <Input
            type="password"
            value={form.apiKey}
            autoComplete="off"
            placeholder={settings.data?.hasApiKey ? '••••••••••••' : 'sk-…'}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
        </Field>

        <Field label="Model">
          <Input
            value={form.model}
            placeholder="anthropic/claude-sonnet-4.5"
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        </Field>

        <Field
          label="Vision model (optional)"
          hint="Only used for photographing a textbook page. Leave blank to use the model above."
        >
          <Input
            value={form.visionModel}
            onChange={(e) => setForm({ ...form, visionModel: e.target.value })}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
          <Button onClick={() => test.mutate()} disabled={test.isPending || !settings.data?.configured}>
            {test.isPending ? 'Testing…' : 'Test connection'}
          </Button>
          {tested ? <span className="text-sm text-accent">{tested}</span> : null}
        </div>

        <ErrorText>
          {save.error ? (save.error as ApiError).message : null}
          {test.error ? (test.error as ApiError).message : null}
        </ErrorText>
      </div>

      <Note>
        One key for the whole instance — teachers do not bring their own. It is stored on your
        server, never sent back to the browser, and students never touch this part of the app.
        Everyone else is only told whether the AI is available, not what it is.
      </Note>
    </AdminSection>
  );
}
