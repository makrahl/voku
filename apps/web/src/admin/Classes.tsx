import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClassView, StudentView, TestView } from '@voku/shared';
import { ApiError, admin, api } from '../lib/api.ts';
import {
  Button,
  EditableHeading,
  Empty,
  ErrorText,
  Field,
  Input,
  Row,
  Rows,
  Spinner,
  Status,
  Textarea,
} from '../components/ui.tsx';

export function Classes() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const classes = useQuery({
    queryKey: ['admin', 'classes'],
    queryFn: () => api.get<ClassView[]>(admin('/classes')),
  });

  const create = useMutation({
    mutationFn: () => api.post<ClassView>(admin('/classes'), { name }),
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'classes'] });
    },
  });

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-3">
        <span className="label">Your classes</span>
        <h1 className="text-hero">Classes</h1>
      </div>

      <form
        className="flex max-w-md flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="flex-1">
          <Field label="New class">
            <Input value={name} placeholder="9b" onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
          Add
        </Button>
      </form>
      <ErrorText>{create.error ? (create.error as ApiError).message : null}</ErrorText>

      {classes.isLoading ? (
        <Spinner />
      ) : classes.data?.length === 0 ? (
        <Empty title="No classes yet">Add one above, then paste in your register.</Empty>
      ) : (
        <Rows>
          {classes.data?.map((cls) => (
            <Row key={cls.id}>
              <Link
                to={`/admin/classes/${cls.id}`}
                className="flex flex-1 flex-wrap items-baseline justify-between gap-4 py-1"
              >
                <span className="text-2xl font-semibold tracking-tight">{cls.name}</span>
                <span className="text-sm text-ink-40">
                  {cls.studentCount} students · {cls.testCount} tests
                </span>
              </Link>
              {cls.archivedAt ? <Status tone="quiet">archived</Status> : null}
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}

interface ClassDetailData {
  id: string;
  name: string;
  students: StudentView[];
}

export function ClassDetail() {
  const { classId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [names, setNames] = useState('');
  const [title, setTitle] = useState('');

  const detail = useQuery({
    queryKey: ['admin', 'class', classId],
    queryFn: () => api.get<ClassDetailData>(admin(`/classes/${classId}`)),
  });

  const tests = useQuery({
    queryKey: ['admin', 'tests', classId],
    queryFn: () => api.get<TestView[]>(admin(`/tests?classId=${classId}`)),
  });

  const addStudents = useMutation({
    mutationFn: () =>
      api.post<{ added: StudentView[]; skipped: string[] }>(admin(`/classes/${classId}/students`), {
        names,
      }),
    onSuccess: () => {
      setNames('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'class', classId] });
    },
  });

  const renameClass = useMutation({
    mutationFn: (name: string) => api.patch(admin(`/classes/${classId}`), { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'class', classId] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'classes'] });
    },
  });

  const renameStudent = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(admin(`/students/${id}`), { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'class', classId] }),
  });

  const rotate = useMutation({
    mutationFn: (studentId: string) => api.post(admin(`/students/${studentId}/rotate-token`)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'class', classId] }),
  });

  const archive = useMutation({
    mutationFn: (studentId: string) => api.patch(admin(`/students/${studentId}`), { archived: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'class', classId] }),
  });

  const newTest = useMutation({
    mutationFn: () => api.post<TestView>(admin('/tests'), { classId, title }),
    onSuccess: (test) => navigate(`/admin/tests/${test.id}`),
  });

  if (detail.isLoading) return <Spinner />;
  if (!detail.data) return null;

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-3">
        <Link to="/admin" className="label transition-colors hover:!text-ink">
          ← All classes
        </Link>
        <EditableHeading
          value={detail.data.name}
          ariaLabel="Class name"
          onSave={(name) => renameClass.mutate(name)}
        />
      </div>

      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <span className="label">Tests</span>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) newTest.mutate();
            }}
          >
            <Input
              value={title}
              placeholder="Unit 3"
              onChange={(e) => setTitle(e.target.value)}
              className="w-44"
            />
            <Button type="submit" variant="primary" disabled={!title.trim()}>
              New test
            </Button>
          </form>
        </div>

        {tests.data?.length === 0 ? (
          <Empty title="No tests yet">Name one above to start the composer.</Empty>
        ) : (
          <Rows>
            {tests.data?.map((test) => (
              <Row key={test.id}>
                {/* The whole title block is the link, so the row is a big target
                    rather than a small word at the end of it. */}
                <Link to={`/admin/tests/${test.id}`} className="flex-1 py-1">
                  <p className="text-xl font-semibold tracking-tight">{test.title}</p>
                  <p className="text-sm text-ink-40">
                    {test.includedCount} words · {test.questionCount} questions · target{' '}
                    {test.targetCount}
                  </p>
                </Link>
                <Status tone={test.status === 'open' ? 'accent' : 'quiet'}>{test.status}</Status>
                {test.status === 'open' || test.status === 'closed' ? (
                  <Button size="sm" onClick={() => navigate(`/admin/tests/${test.id}/board`)}>
                    Board
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => navigate(`/admin/tests/${test.id}`)}>
                  Edit
                </Button>
              </Row>
            ))}
          </Rows>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="label">Students</span>
          <a
            href={admin(`/classes/${classId}/qr-sheet`)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center border border-hairline-strong px-3 text-sm transition-colors hover:border-ink"
          >
            Print login codes
          </a>
        </div>

        <form
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (names.trim()) addStudents.mutate();
          }}
        >
          <Field label="Add students" hint="One name per line. Paste straight from your register.">
            <Textarea
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder={'Lena Berger\nTom Weiß\nJonas Ott'}
            />
          </Field>
          <div className="flex items-center gap-4">
            <Button type="submit" variant="primary" disabled={!names.trim()}>
              Add
            </Button>
            {addStudents.data?.skipped.length ? (
              <span className="text-sm text-ink-40">
                Already on the list: {addStudents.data.skipped.join(', ')}
              </span>
            ) : null}
          </div>
        </form>

        {detail.data.students.length === 0 ? (
          <Empty title="No students yet" />
        ) : (
          <Rows>
            {detail.data.students.map((s) => (
              <Row key={s.id}>
                <div className="flex-1">
                  <EditableHeading
                    value={s.name}
                    size="row"
                    ariaLabel={`Name of ${s.name}`}
                    onSave={(name) => renameStudent.mutate({ id: s.id, name })}
                  />
                </div>
                <Button size="sm" variant="quiet" onClick={() => rotate.mutate(s.id)}>
                  New code
                </Button>
                <Button size="sm" variant="quiet" onClick={() => archive.mutate(s.id)}>
                  Archive
                </Button>
              </Row>
            ))}
          </Rows>
        )}
      </section>
    </div>
  );
}
