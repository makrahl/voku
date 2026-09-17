# Working on voku

Read `README.md` first for what the app is. This file is for the things that
are not derivable from the code — decisions that were argued out, and the
reasoning behind them, so they do not get quietly undone.

## Your machine is staging

There is no staging server. The app running on this machine *is* it, and pushing
to `main` deploys to the live site by itself — so a push is a decision, not a
save.

That splits the checking in two, and both halves are needed:

- **"Does this look right?"** Only eyes answer that, on the actual screen, in a
  browser. This project has a history of bugs that survived careful reasoning
  about the UI and died the moment someone opened it — a heading that scrolled
  instead of wrapping, progress shown off screen, text below the contrast floor.
  Offer to run the app and say which screen to look at; do not report a visual
  change as done on the strength of the diff.
- **"Did I break something I wasn't looking at?"** `npm test` answers that. Run
  it before pushing rather than leaving it to CI, which runs it again and blocks
  the deploy on failure — the point is to know in ten seconds.

A failed deploy rolls itself back and the database is backed up before every one,
so the cost of being wrong is an unshipped change, not a broken lesson.

Setup, fetching a copy of the live data, and the rollback procedure are in
`Working on voku.md`. Deployment mechanics are `deploy/deploy.sh` and
`.github/workflows/deploy.yml`.

## The one idea everything hangs off

The score is `correct ÷ target` and it is **uncapped**. Reaching the target is
100%; 38 correct against a target of 25 is 152%, and chasing that is the point.
The question pool is deliberately larger than the target so strong students have
runway. Anything that caps, normalises or "fixes" the percentage breaks the
format — check before changing it.

## Decisions that were made deliberately

Do not reverse these without asking. Each was chosen over a named alternative.

| Decision | Why, and what it cost |
|---|---|
| **Strict spelling.** `recieve` is wrong. | Spelling is what German learners get wrong. Made liveable by the bulk-regrade panel, which is therefore load-bearing, not a nicety. |
| **No question shuffling.** Identical order for the whole class. | Makes position 12 comparable across students. Copying is possible; the clock does the policing. |
| **Multiple choice only for traps or hard words** — trickiness ≥ 2, or difficulty in the top 40% of *this test* (floor 4). | Wrong answers cost nothing, so MCQ on an easy word is free marks. The threshold is relative because models calibrate differently; a fixed cutoff silently emptied both MCQ formats when one scored conservatively. |
| **Format mix is preferences, not quotas.** | A text with three tricky words cannot support ten MCQs. The composer reports the shortfall instead of inventing traps. |
| **No behavioural telemetry.** Nothing records app-switching. | Monitoring minors, false-positives on notifications. The only personal data is a first name and a score. |
| **The live board is private to the teacher.** | A leaderboard would publicly identify the same struggling students every week. |
| **Server owns the clock.** Per-student, from `started_at`. | A latecomer still gets their full time; a device with a wrong clock gains nothing. |
| **The LLM is optional everywhere.** | With no key, AI buttons hide and a full test can still be built from a pasted word list. Never make a path AI-only without a manual equivalent. |
| **Invites are links, not emails.** | No SMTP in the deployment, so no school spam filter can silently break onboarding. |

**The accepted trade-off:** the sprint sacrifices coverage. A slow student may
never reach word 35. This measures fluency and stamina alongside knowledge; it
is not an instrument for certifying that every student met every word.

## Architecture notes

- `packages/shared` is the keystone. Question payloads are Zod schemas defined
  once, so the LLM validator, the DB write, the API response and the React
  renderer cannot drift apart. Add new question types there first.
- **`stripAnswer()` is the only path from a stored question to a student.** Do
  not hand-roll a student-facing response; the tests assert no answer field
  survives for any type.
- `node:sqlite`, no ORM. It **rejects named parameters the SQL does not use** —
  spreading a row into a query with a hardcoded `NULL` column will throw. All DB
  access goes through `Db` in `db/index.ts`; swapping to better-sqlite3 means
  rewriting that file and nothing else.
- Migrations in `db/migrations.ts` are append-only, keyed on `user_version`.
  Never edit one that has shipped.
- Express 5 types path params as `string | string[] | undefined` — use the
  `param(req, name)` helper rather than casting.
- Jobs (`services/jobs.ts`) are in-process and single-instance by design. One
  teacher on one small server does not need a queue.

## Testing

`npm test` runs 273 tests with no network access. Integration tests drive the
real Express app over real HTTP on an ephemeral port against an in-memory
database — cookies, middleware order and JSON parsing are exercised, not
stubbed. `test/mock-llm.ts` stands in for an OpenAI-compatible provider, so the
whole composer can be tested without a key.

`signInAsTeacher()` creates an **admin** by default, because in most suites that
account is the person who set the instance up. Pass `{ isAdmin: false }` to test
what a colleague can reach.

Prefer adding a test that states the decision ("is strict about spelling — this
is the decision, stated as a test") over one that merely covers a line.

## Design

Follow `Voku Design Brief.md`. In short: one flat `#fafaf8` plane, no cards and
no shadows, Inter 500/600, structure from hairlines. Terracotta `#c65d3b` is the
only accent and is limited to the progress fill, the correct/selected answer,
and primary buttons — plus the dot in the wordmark, which is the one decorative
exception. Light theme only.

Because there is only one accent, **a wrong answer is shown in plain near-black,
not red.** Right and wrong are distinguished by the presence of the accent, not
by two colours.

## Things that are genuinely unfinished

- **Near-synonym distractors.** For adverbs of degree the model still offers
  wrong answers that are also correct — "kaum → scarcely" against *barely*,
  *rarely*, *hardly ever*. The distractor prompt names this exact failure and it
  fixed the other cases but not this one. The review step is the backstop.
- **The UI has never been seen rendered.** It has been verified by driving the
  API and inspecting the compiled CSS. Layout judgements are inference, and
  several real bugs have come from that — a heading that scrolled instead of
  wrapping, progress shown off screen, text below the contrast floor.
- Fill-in-the-blank needs a context sentence, and there is no UI field for one,
  so that format is effectively AI-only.
- No export. "Can I get these into my markbook?" has no answer yet.
- No teacher preview: nobody can see a test as a student sees it without a
  second browser profile.
- Passkeys were deliberately deferred. Credentials live entirely in
  `services/auth.ts`; nothing in the invite or role code assumes a password, so
  WebAuthn is additive when wanted.

## What a real model taught us

Everything below came from running against a live provider, and none of it was
visible against the mock.

- **Model choice dominates.** A reasoning model took 138 seconds per pass and
  intermittently returned null content; `openai/gpt-5.4-mini` does the same work
  in 6–12 seconds. Reasoning tokens count against `max_tokens`, so a model can
  spend its whole budget thinking and never answer — that case is retried and
  reported in plain words.
- **Every LLM call needs a timeout.** Without one a hung provider leaves a job
  in `running` for ever, which is indistinguishable from thinking.
- **Difficulty is an opinion, not a measurement.** Hence the relative threshold
  above.

## Conventions

- Comments explain *why*, especially where a choice looks odd (expiry checked
  before the submitted flag; `target_snapshot` copied at attempt start).
- User-facing copy says what to do, not what went wrong: "Scan your code to
  start", not "You are not signed in".
- Commit messages explain the reasoning, not the diff.
