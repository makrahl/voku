# voku

In-class vocabulary sprints for German students learning English.

The teacher pastes (or photographs) an English text, trims the word list the AI
pulls out of it, and opens the test in class. Students scan a printed QR code on
their iPad and get **five minutes** — questions ramping from easy to hard, answer
as far as you can get.

**The score is `correct ÷ target`, and it is uncapped.** Reaching the target
(25 by default) is 100%; thirty-eight correct is 152%, and that is the number
worth chasing. The question pool is deliberately larger than the target so
strong students have runway.

The language model is optional. With no API key configured every AI button
hides and the app still builds and runs a complete test from a pasted word list.

---

## Quick start

```bash
npm install
npm run build
VOKU_ADMIN_PASSWORD=change-me npm run seed-admin -- you@school.de
npm start                       # http://localhost:3000/admin
```

For development, two processes:

```bash
npm run dev --workspace=@voku/server   # API on :3000, rebuilt on change
npm run dev --workspace=@voku/web      # UI on :5173, proxies /api to :3000
```

```bash
npm test          # 200 tests, no network required
npm run typecheck
```

---

## How it fits together

```
packages/shared    Zod schemas for every question payload. The LLM validator,
                   the database write, the API response and the React renderer
                   all agree because they share one definition.
apps/server        Express 5 + node:sqlite. No ORM, no native dependencies.
apps/web           Vite + React + Tailwind. Two route trees on one origin:
                   /admin/* is the teacher, /s/* is the student.
```

`npm run build` compiles the web app into `apps/server/public`, so production is
a single Node process serving both the API and the SPA.

### The four question formats

| Format | Needs a model? |
|---|---|
| Type the translation | no |
| Multiple choice · translation | no (distractors come from the other words on the list) |
| Multiple choice · definition | yes — someone has to write the definition |
| Fill in the blank | only if the word has no sentence in the source text |

### Two signals, not one

Word extraction returns **difficulty** (1–10) and **trickiness** (0–3) as
separate judgements, because they are separate things. *nevertheless* is hard
but honest; *become* is A1-easy and a total trap, since German *bekommen* means
to receive.

- **Difficulty** orders the sprint and drives the top-N cutoff.
- **Trickiness** decides which words become multiple choice.

That second rule is the anti-guessing mechanism. Wrong answers cost nothing, so
tapping a random option would be free marks — unless multiple choice is reserved
for words where the wrong options are genuine traps. The trickiness *reason*
("German *Gift* means poison") is fed straight into the distractor prompt.

The teacher's format mix is a set of **preferences, not quotas**. A text with
three tricky words cannot support ten multiple-choice questions, and the review
step reports the shortfall rather than inventing traps that are not there.

---

## Decisions worth knowing about

These were settled deliberately. If you change one, change it knowing what it
was trading against.

- **Spelling is strict.** *recieve* is wrong. To make that liveable, a near miss
  shows "Almost — receive" (scored zero, but they see the form), and after the
  test the results board groups every rejected answer by what students actually
  typed — one tap accepts a variant, re-marks the whole class, and remembers it
  for future tests.
- **No shuffling.** Every student gets the same questions in the same order, so
  position 12 is directly comparable across the class. The clock does the
  policing: a second spent looking sideways is a second not scoring.
- **No behavioural telemetry.** Nothing records whether a student switched apps.
  The only personal data in the system is a first name and a score.
- **The live board is private.** No leaderboard, nothing projectable.
- **The clock belongs to the server.** Each student's five minutes starts when
  *they* tap Start, so a latecomer is not punished. Answers after the deadline
  are refused regardless of what the device's clock says.
- **The sprint sacrifices coverage.** A slow student may never reach word 35.
  This measures fluency and stamina alongside knowledge; it is not an instrument
  for certifying that every student met every word.
- **Attempts resume.** Answers are saved as they are given, so a dead iPad costs
  nothing. The teacher can also reset one student's attempt from the board.

---

## Deploying

Runs as one Node process behind a reverse proxy. `deploy/` has a systemd unit, a
Caddyfile and a backup script; copy `.env.example` to `.env` and edit.

```bash
sudo cp deploy/voku.service /etc/systemd/system/
sudo systemctl enable --now voku
```

**HTTPS is not optional in practice.** `PUBLIC_BASE_URL` builds the QR login
links and decides whether cookies are marked `Secure`, and iOS will not always
open a plain `http://` link from a scanned code. Set it correctly *before*
printing the login cards.

Back up with `deploy/backup.sh` on a nightly cron. It uses `sqlite3 .backup`
rather than `cp`, because copying a live WAL database can produce a torn file.

### Environment

| Variable | Purpose |
|---|---|
| `PUBLIC_BASE_URL` | Origin for QR links; also decides the `Secure` cookie flag |
| `PORT` | Default 3000 |
| `DATABASE_PATH` | SQLite file, relative to `apps/server/` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Optional. Seeds the Settings page |
| `LLM_VISION_MODEL` | Optional. Only for photographing a page |

The API key is stored server-side and is never sent back to the browser.

---

## Accounts

One teacher account, created from the command line:

```bash
npm run seed-admin -- you@school.de      # prompts for a password
```

Running it again for the same email resets the password. Students have no
accounts and no passwords — each has one long-lived token in their QR code,
which you can rotate from the class page if a card goes astray.
