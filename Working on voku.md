# Working on voku

How to run the app on your own machine, look at a change, and put it live. Ask
Claude to do any of it for you — this file is here so it knows how, and so you
can see what it is doing.

## The short version

1. Change something (with Claude).
2. Run the app on your machine and **open the screen you changed**.
3. Happy? Push. That puts it live on its own — there is no separate deploy step.

Your machine is the staging server. Nothing is rehearsed anywhere else, so the
only thing between a change and a classroom is you looking at it.

## What you need once

**Node 22.22 or newer** — the installer from nodejs.org. The app is built and
tested on 22; a newer major version is not worth the surprise.

**Git for Windows** — gives you Git and, with it, Git Bash. The `ssh` and `gzip`
commands further down want Git Bash rather than PowerShell.

Then, in the project folder:

```
npm install
```

## Running it

Two processes: the API and the interface, separately, because the interface
rebuilds itself as you edit and the API does not.

```
npm run dev --workspace=@voku/server    # API on http://localhost:3000
npm run dev --workspace=@voku/web       # the app on http://localhost:5173
```

Open **http://localhost:5173**. Leave both running while you work.

> Do not use the bare `npm run dev` from the project root on Windows. It joins
> the two commands with `&`, which means "run these one after the other" to the
> Windows shell rather than "run both at once", so the second one never starts
> and the interface never comes up. Claude should start them as two background
> commands instead.

## Working against the real data

An empty database is a bad place to judge a change — half the screens have
nothing to show. Fetch yesterday's copy of the live one instead:

```
ssh voku-db > voku.db.gz
gzip -d voku.db.gz
```

Move `voku.db` to `apps/server/data/voku.db`, replacing what is there. **Delete
`voku.db-wal` and `voku.db-shm` in that folder if they exist** — they are
leftovers from the old database, and SQLite will happily replay them over the
file you just put in, quietly undoing the copy.

Two things about that copy: it holds real students' first names, so it is a class
list and should be treated as one; and the AI key has been stripped out of it,
which is why the next section exists.

## Turning the AI on for yourself

The app works without it — every AI button simply hides, and you can still build
a whole test from a pasted word list. But to try the AI parts locally you need
your own key, because the live one never leaves the server.

Make an account at openrouter.ai, create a key, and paste it into **Account →
Settings** in your local copy of the app. It is stored in your local database, so
you do this once, and it never goes near the repository or the live site. Pick a
fast model — `openai/gpt-5.4-mini` and similar. Avoid anything described as a
reasoning model; they take minutes and sometimes never answer.

## Before you push

Ask Claude to run the tests:

```
npm test
```

273 of them, about ten seconds, no internet needed. They answer the question your
eyes cannot: *did I break a screen I wasn't looking at?* They also run
automatically after you push, and the deploy is cancelled if they fail — but
finding out now is cheaper than finding out in two minutes.

Then push. Watch the **Actions** tab on GitHub: green tick, and it is live at
https://voku.tschieber.de.

## When it goes wrong

**The tests fail.** Nothing was deployed; the live site is untouched. Show Claude
the failure.

**The deploy fails its health check.** The server puts the previous version back
by itself, so the site keeps working — your change just is not on it. The database
is backed up before every single deploy, so nothing is lost either way.

**It is live and it is wrong.** Do not try to fix it under pressure. Go to the
**Actions** tab → **Deploy** → **Run workflow**, and give it the commit you were
on before. That puts the old version back within a couple of minutes. Fix it
properly afterwards.
