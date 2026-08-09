import { Navigate, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { StudentHomeView } from '@voku/shared';
import { admin, api, student } from './lib/api.ts';
import { Button, Spinner, Wordmark } from './components/ui.tsx';

/**
 * The signpost at the root.
 *
 * Two audiences arrive here and they want opposite things, so the page is a
 * fork rather than a home page — this is a tool a school runs for itself, not a
 * product with a front door to sell.
 *
 * Most arrivals never see it: anyone already signed in is sent straight on,
 * which is the common case once a student has scanned their code even once and
 * then bookmarks the address.
 */
export function Landing() {
  const navigate = useNavigate();

  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () => api.get<{ claimed: boolean }>('/api/setup/status'),
  });

  // Both probes 401 when signed out, which is the answer, not an error.
  const asStudent = useQuery({
    queryKey: ['student', 'me'],
    queryFn: () => api.get<StudentHomeView>(student('/me')),
    retry: false,
  });

  const asTeacher = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => api.get<{ email: string }>(admin('/auth/me')),
    retry: false,
  });

  if (setup.isLoading || asStudent.isLoading || asTeacher.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Nobody owns this instance yet — setting it up is the only thing to do.
  if (setup.data?.claimed === false) return <Navigate to="/admin" replace />;

  // A signed-in student typed the address instead of scanning. Send them in.
  if (asStudent.data) return <Navigate to="/s" replace />;

  const teacher = asTeacher.data;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-12 px-8 py-16">
      <div className="flex flex-col items-center gap-5 text-center">
        <Wordmark size="lg" />
        <p className="max-w-md text-lg text-ink-60">
          Five-minute vocabulary sprints for the English classroom.
        </p>
      </div>

      {teacher ? (
        <div className="flex flex-col items-center gap-4">
          <Button variant="primary" size="lg" onClick={() => navigate('/admin')}>
            Go to your classes
          </Button>
          <span className="text-sm text-ink-40">Signed in as {teacher.email}</span>
        </div>
      ) : (
        <div className="rule-t flex flex-col">
          <section className="rule-b flex flex-col gap-2 py-8">
            <span className="label">Students</span>
            <p className="text-ink-60">
              Scan the code your teacher gave you — it signs you in and keeps you signed in. There
              is no password to remember.
            </p>
          </section>

          <section className="rule-b flex flex-wrap items-center justify-between gap-4 py-8">
            <div className="flex flex-col gap-2">
              <span className="label">Teachers</span>
              <p className="text-ink-60">Build a test, open it, watch the room.</p>
            </div>
            <Button variant="primary" onClick={() => navigate('/admin')}>
              Sign in
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
