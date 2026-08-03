import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, admin, api } from '../lib/api.ts';
import { Button, ErrorText, Field, Input, Spinner, Wordmark, cx } from '../components/ui.tsx';
import { Classes, ClassDetail } from './Classes.tsx';
import { Composer } from './Composer.tsx';
import { Board } from './Board.tsx';
import { Settings } from './Settings.tsx';
import { Team } from './Team.tsx';
import { AcceptInvite, Setup } from './Setup.tsx';

interface Me {
  id: string;
  email: string;
  isAdmin: boolean;
}

function useMe() {
  return useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => api.get<Me>(admin('/auth/me')),
    retry: false,
  });
}

function Login() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useMutation({
    mutationFn: () => api.post<Me>(admin('/auth/login'), { email, password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'me'] }),
  });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-12 px-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="label">Teacher</span>
        <Wordmark size="lg" />
      </div>
      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
      >
        <Field label="Email">
          <Input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorText>{signIn.error ? (signIn.error as ApiError).message : null}</ErrorText>
        <Button type="submit" variant="primary" size="lg" disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="text-center text-sm text-ink-40">
        No account? Ask an admin for an invitation link — voku does not have a sign-up page.
      </p>
    </div>
  );
}

function Layout({ me, children }: { me: Me; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const signOut = useMutation({
    mutationFn: () => api.post(admin('/auth/logout')),
    onSuccess: () => {
      queryClient.clear();
      navigate('/admin');
    },
  });

  const tabs = [
    {
      to: '/admin',
      label: 'Classes',
      match: (p: string) => p === '/admin' || p.startsWith('/admin/classes') || p.startsWith('/admin/tests'),
    },
    // Managing colleagues is an admin concern, so it is not even shown to others.
    ...(me.isAdmin
      ? [{ to: '/admin/team', label: 'Team', match: (p: string) => p.startsWith('/admin/team') }]
      : []),
    { to: '/admin/settings', label: 'Settings', match: (p: string) => p.startsWith('/admin/settings') },
  ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-8 py-8">
      <header className="rule-b flex flex-wrap items-baseline justify-between gap-6 pb-5">
        <Link to="/admin">
          <Wordmark size="sm" />
        </Link>
        <nav className="flex items-baseline gap-6">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={cx(
                'label transition-colors',
                tab.match(pathname) ? '!text-ink' : 'hover:!text-ink',
              )}
            >
              {tab.label}
            </Link>
          ))}
          <span className="hidden text-sm text-ink-40 sm:inline">{me.email}</span>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            className="label transition-colors hover:!text-ink"
          >
            Sign out
          </button>
        </nav>
      </header>
      <main className="flex flex-1 flex-col py-12">{children}</main>
    </div>
  );
}

function SignedIn({ me }: { me: Me }) {
  return (
    <Layout me={me}>
      <Routes>
        <Route path="/" element={<Classes />} />
        <Route path="/classes/:classId" element={<ClassDetail />} />
        <Route path="/tests/:testId" element={<Composer />} />
        <Route path="/tests/:testId/board" element={<Board />} />
        <Route path="/settings" element={<Settings />} />
        {me.isAdmin ? <Route path="/team" element={<Team meId={me.id} />} /> : null}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Layout>
  );
}

export function AdminApp() {
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () => api.get<{ claimed: boolean }>('/api/setup/status'),
  });
  const me = useMe();

  if (setup.isLoading || me.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <Routes>
      {/* Accepting an invitation has to work while signed out — it is matched
          before the gate below for exactly that reason. */}
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route
        path="*"
        element={
          setup.data?.claimed === false ? (
            <Setup />
          ) : me.error || !me.data ? (
            <Login />
          ) : (
            <SignedIn me={me.data} />
          )
        }
      />
    </Routes>
  );
}
