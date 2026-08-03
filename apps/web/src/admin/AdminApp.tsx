import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, admin, api } from '../lib/api.ts';
import {
  Button,
  ErrorText,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  Spinner,
  Wordmark,
  cx,
} from '../components/ui.tsx';
import { AccountIcon, ChevronIcon, GearIcon, HelpIcon } from '../components/icons.tsx';
import { Classes, ClassDetail } from './Classes.tsx';
import { Composer } from './Composer.tsx';
import { Board } from './Board.tsx';
import { Settings } from './Settings.tsx';
import { Team } from './Team.tsx';
import { AcceptInvite, Setup } from './Setup.tsx';
import { Help } from './Help.tsx';

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

  const onClasses =
    pathname === '/admin' || pathname.startsWith('/admin/classes') || pathname.startsWith('/admin/tests');

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-8 py-8">
      <header className="rule-b flex items-center justify-between gap-6 pb-4">
        <Link to="/admin">
          <Wordmark size="sm" />
        </Link>

        {/* One text link for the thing the app is actually for; everything else
            is chrome, and reads as chrome. */}
        <nav className="flex items-center gap-1">
          <Link
            to="/admin"
            className={cx('label mr-3 transition-colors', onClasses ? '!text-ink' : 'hover:!text-ink')}
          >
            Classes
          </Link>

          <IconButton
            label="Help"
            active={pathname.startsWith('/admin/help')}
            onClick={() => navigate('/admin/help')}
          >
            <HelpIcon />
          </IconButton>

          <IconButton
            label="Settings"
            active={pathname.startsWith('/admin/settings')}
            onClick={() => navigate('/admin/settings')}
          >
            <GearIcon />
          </IconButton>

          <Menu
            label="Your account"
            trigger={() => (
              <>
                <AccountIcon />
                <ChevronIcon />
              </>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>{me.email}</MenuLabel>
                {/* Managing colleagues is admin-only, so it is not even listed
                    for anyone else. */}
                {me.isAdmin ? (
                  <MenuItem
                    onClick={() => {
                      close();
                      navigate('/admin/team');
                    }}
                  >
                    Team
                  </MenuItem>
                ) : null}
                <MenuItem
                  onClick={() => {
                    close();
                    signOut.mutate();
                  }}
                >
                  Sign out
                </MenuItem>
              </>
            )}
          </Menu>
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
        <Route path="/help" element={<Help />} />
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
