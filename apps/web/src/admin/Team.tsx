import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, admin, api } from '../lib/api.ts';
import {
  Button,
  Empty,
  ErrorText,
  Field,
  Input,
  Note,
  Row,
  Rows,
  Spinner,
  Status,
} from '../components/ui.tsx';
import { AdminSection } from './AdminSection.tsx';

interface TeacherView {
  id: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
  classCount: number;
}

interface InviteView {
  id: string;
  email: string;
  isAdmin: boolean;
  url: string;
  expiresAt: string;
  expired: boolean;
}

/**
 * Admin-only. Invitations are links, not emails — the admin copies one and
 * sends it however they already talk to that colleague, which keeps a mail
 * server (and its spam filter) out of the deployment entirely.
 */
export function Team({ meId }: { meId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const team = useQuery({
    queryKey: ['admin', 'team'],
    queryFn: () => api.get<{ teachers: TeacherView[]; invites: InviteView[] }>(admin('/team')),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'team'] });
  const fail = (e: ApiError) => setError(e.message);

  const invite = useMutation({
    mutationFn: () => api.post<InviteView>(admin('/team/invites'), { email, isAdmin: asAdmin }),
    onSuccess: (created) => {
      setEmail('');
      setAsAdmin(false);
      setError(null);
      void refresh();
      void copy(created.url);
    },
    onError: fail,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(admin(`/team/invites/${id}`)),
    onSuccess: refresh,
    onError: fail,
  });

  const setRole = useMutation({
    mutationFn: ({ id, isAdmin }: { id: string; isAdmin: boolean }) =>
      api.patch(admin(`/team/teachers/${id}`), { isAdmin }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(admin(`/team/teachers/${id}`)),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: fail,
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused; the link is on screen either way.
    }
  }

  if (team.isLoading) return <Spinner />;
  const teachers = team.data?.teachers ?? [];
  const invites = team.data?.invites ?? [];

  return (
    <AdminSection
      title="Teachers"
      intro="Who can use this instance. Everyone sees only their own classes and results."
    >
      <ErrorText>{error}</ErrorText>

      <section className="flex flex-col gap-6 pt-4">
        <span className="label">Invite a colleague</span>
        <form
          className="flex max-w-2xl flex-wrap items-end gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) invite.mutate();
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label="Their email">
              <Input
                type="email"
                value={email}
                placeholder="frau.mueller@school.de"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={asAdmin}
              onChange={(e) => setAsAdmin(e.target.checked)}
              className="size-5 accent-[var(--color-accent)]"
            />
            Can manage the team
          </label>
          <Button type="submit" variant="primary" disabled={!email.trim() || invite.isPending}>
            Create link
          </Button>
        </form>
        <Note>
          Creating a link copies it to your clipboard. Send it however you like — voku does not send
          email. Links last seven days and work once.
        </Note>
      </section>

      {invites.length > 0 ? (
        <section className="flex flex-col gap-6">
          <span className="label">Waiting to be accepted</span>
          <Rows>
            {invites.map((row) => (
              <Row key={row.id}>
                <div className="min-w-48 flex-1">
                  <p className="text-lg">{row.email}</p>
                  <p className="truncate text-sm text-ink-25">{row.url}</p>
                </div>
                {row.isAdmin ? <Status tone="accent">admin</Status> : null}
                {row.expired ? <Status tone="quiet">expired</Status> : null}
                <Button size="sm" onClick={() => copy(row.url)}>
                  {copied === row.url ? 'Copied' : 'Copy link'}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => revoke.mutate(row.id)}>
                  Revoke
                </Button>
              </Row>
            ))}
          </Rows>
        </section>
      ) : null}

      <section className="flex flex-col gap-6">
        <span className="label">Teachers</span>
        {teachers.length === 0 ? (
          <Empty title="Nobody yet" />
        ) : (
          <Rows>
            {teachers.map((teacher) => (
              <Row key={teacher.id}>
                <span className="min-w-48 flex-1 text-lg">
                  {teacher.email}
                  {teacher.id === meId ? <span className="text-ink-25"> — you</span> : null}
                </span>
                <span className="text-sm text-ink-40">
                  {teacher.classCount} {teacher.classCount === 1 ? 'class' : 'classes'}
                </span>
                {teacher.isAdmin ? <Status tone="accent">admin</Status> : null}
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setRole.mutate({ id: teacher.id, isAdmin: !teacher.isAdmin })}
                >
                  {teacher.isAdmin ? 'Make teacher' : 'Make admin'}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    if (confirm(`Remove ${teacher.email} from voku?`)) remove.mutate(teacher.id);
                  }}
                >
                  Remove
                </Button>
              </Row>
            ))}
          </Rows>
        )}
        <Note>
          A teacher who still has classes cannot be removed — those classes and all their results
          would go with them.
        </Note>
      </section>
    </AdminSection>
  );
}
