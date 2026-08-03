import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.ts';
import { Button, ErrorText, Field, Input, Note, Spinner, Wordmark } from '../components/ui.tsx';

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-10 px-8 py-12">
      {children}
    </div>
  );
}

/**
 * First run. Finding the URL is not the same as owning the instance, so the
 * claim needs the one-time code the server printed to its log at startup.
 */
export function Setup() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const claim = useMutation({
    mutationFn: () => api.post('/api/setup/claim', { code, email, password }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'me'] });
    },
  });

  const ready = code.trim() && email.trim() && password.length >= 10;

  return (
    <Centred>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="label">First run</span>
        <Wordmark size="lg" />
        <p className="text-ink-60">
          Nobody owns this instance yet. Claim it and you become its admin.
        </p>
      </div>

      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) claim.mutate();
        }}
      >
        <Field
          label="Setup code"
          hint="Printed in the server log when voku started. It is not shown anywhere else."
        >
          <Input
            value={code}
            placeholder="ABCD-EFGH-JKLM"
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field label="Your email">
          <Input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <ErrorText>{claim.error ? (claim.error as ApiError).message : null}</ErrorText>
        <Button type="submit" variant="primary" size="lg" disabled={!ready || claim.isPending}>
          {claim.isPending ? 'Setting up…' : 'Claim this instance'}
        </Button>
      </form>
    </Centred>
  );
}

/** Where an invited colleague lands. Works signed-out, by definition. */
export function AcceptInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ email: string; isAdmin: boolean }>(`/api/invites/${token}`),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.post(`/api/invites/${token}/accept`, { password }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'me'] });
      navigate('/admin', { replace: true });
    },
  });

  if (invite.isLoading) {
    return (
      <Centred>
        <Spinner />
      </Centred>
    );
  }

  if (invite.error) {
    return (
      <Centred>
        <div className="flex flex-col items-center gap-4 text-center">
          <Wordmark size="lg" />
          <h1 className="text-xl">This invitation is no longer valid</h1>
          <p className="text-ink-60">{(invite.error as ApiError).message}</p>
          <Note>Ask whoever invited you to send a fresh link — they expire after seven days.</Note>
        </div>
      </Centred>
    );
  }

  const matches = password.length >= 10 && password === confirm;

  return (
    <Centred>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="label">You have been invited</span>
        <Wordmark size="lg" />
        <p className="text-ink-60">
          Setting up the account for <span className="text-ink">{invite.data!.email}</span>
          {invite.data!.isAdmin ? ', with admin rights' : ''}.
        </p>
      </div>

      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches) accept.mutate();
        }}
      >
        <Field label="Choose a password" hint="At least 10 characters.">
          <Input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Again">
          <Input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>

        {confirm && password !== confirm ? (
          <ErrorText>Those two do not match.</ErrorText>
        ) : (
          <ErrorText>{accept.error ? (accept.error as ApiError).message : null}</ErrorText>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={!matches || accept.isPending}>
          {accept.isPending ? 'Joining…' : 'Join'}
        </Button>
      </form>
    </Centred>
  );
}
