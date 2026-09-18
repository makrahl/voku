import { useState } from 'react';
import { Note, cx } from '../components/ui.tsx';

type Topic = {
  title: string;
  summary: string;
  body: React.ReactNode;
};

const TOPICS: Topic[] = [
  {
    title: 'Setting up a class',
    summary: 'Adding students, and printing their login codes.',
    body: (
      <>
        <p>
          Make a class, then paste your register into the <b>Add students</b> box — one name per
          line. Names already on the list are skipped, so pasting the same register twice is safe.
        </p>
        <p>
          <b>Print login codes</b> gives you a sheet of QR codes, one per student. Cut it up and
          hand them out; students keep the same code all year. Scanning it logs them straight in,
          so there is nothing to remember and no password to reset.
        </p>
        <p>
          A first name is all voku stores about a student. If a code goes astray, <b>New code</b>{' '}
          invalidates the old one — reprint the sheet afterwards. <b>Archive</b> removes a student
          from the class without deleting the work they have already done.
        </p>
      </>
    ),
  },
  {
    title: 'Building a test',
    summary: 'From a text or a pasted word list, with or without the AI.',
    body: (
      <>
        <p>
          The composer runs in seven steps, and you can jump between them freely. They follow the
          order of the classroom rather than the order of the software: build it, hand out the
          sheet, let them revise, then run the sprint.
        </p>
        <dl className="flex flex-col gap-3">
          <Step n="01" name="Text">
            Paste the reading text the class is working on, or photograph a textbook page. You can
            skip this entirely and go straight to a word list.
          </Step>
          <Step n="02" name="Words">
            The words to be tested, with their translations. The AI can pull them out of the text,
            or you can type and paste them yourself. <b>Words from an earlier test</b> brings back
            vocabulary from previous units so it keeps getting revisited.
          </Step>
          <Step n="03" name="Design">
            Minutes, target, direction, and the mix of question formats.
          </Step>
          <Step n="04" name="Questions">
            The actual questions. Read them before class — this is the step that catches a bad
            distractor or a translation you disagree with. Edit or delete anything that is wrong.
          </Step>
          <Step n="05" name="Worksheet">
            The sheet to hand out, in four versions — to learn from, with the German left blank,
            with the words missing from their own example sentences, or just the pairs. Print it,
            or download it as a table or a Word file to finish in your own template.
          </Step>
          <Step n="06" name="Practise">
            Publish the word list, which is what lets the class revise and practise. You can try
            the practice yourself here first, exactly as they will see it.
          </Step>
          <Step n="07" name="Open">
            Open the sprint when the lesson starts, and close it afterwards.
          </Step>
        </dl>
        <p>
          <b>Direction</b> decides which way round the words are asked. German → English is
          markedly harder, because recognising a word is easier than producing it.
        </p>
        <p>
          The <b>mix</b> is a set of preferences, not quotas. A text with three tricky words cannot
          support ten multiple-choice questions, and voku will tell you what it could not fill
          rather than inventing weak traps.
        </p>
      </>
    ),
  },
  {
    title: 'How the scoring works',
    summary: 'Why the target is not a maximum, and what the sprint measures.',
    body: (
      <>
        <p>
          The score is simply <b>correct answers ÷ target</b>, and it is <b>not capped</b>. If the
          target is 25, then 25 correct is 100% — and 38 correct is 152%. Going past 100% is the
          point of the format, not a rounding error.
        </p>
        <p>
          That is why the question pool is deliberately larger than the target. The Open step shows
          you the <b>highest possible</b> percentage; if it is not comfortably above 100%, add more
          words or lower the target, because a ceiling removes the reason for strong students to
          keep going.
        </p>
        <p>
          Questions are ordered easiest first and are <b>identical for everyone</b>, so "Lena got to
          question 18" means the same thing for every student in the room. Wrong answers cost
          nothing, so guessing is always worth it — which is exactly why multiple choice is reserved
          for genuinely hard or deceptive words. On an easy word it would be a free mark.
        </p>
        <p>
          <b>Spelling is marked strictly.</b> <i>recieve</i> is wrong. Spelling is the thing German
          learners actually get wrong, so accepting near-misses would measure nothing — but see the
          regrade panel below, which exists to make that liveable.
        </p>
        <p>
          The trade-off worth knowing: a slower student may never reach word 35. The sprint measures
          fluency and stamina alongside knowledge. It is not an instrument for certifying that every
          student met every word.
        </p>
      </>
    ),
  },
  {
    title: 'Running it in class',
    summary: 'Opening, watching the board, closing, and fixing a disputed answer.',
    body: (
      <>
        <p>
          <b>Publish the word list</b> a few days ahead, from the Practise step. Students can then
          open it on their own devices and revise, either reading the source text with the trained
          words highlighted, or as a plain list. Tapping a word shows its translation, and{' '}
          <b>Practise</b> drills the pairs.
        </p>
        <p>
          <b>Open the test</b> when the lesson starts. The word list disappears while the sprint is
          running and comes back once you close it. Each student's clock starts when <i>they</i> tap
          Start, so a latecomer still gets their full time, and a device with the wrong clock gains
          nothing — the server keeps time, not the iPad.
        </p>
        <p>
          The <b>live board</b> shows who is working, who has handed in, how far each student has
          reached and the class average. It also breaks down performance question by question, which
          is useful while the lesson is still happening: half the class stalling on question 7 is
          worth knowing before the bell. The board is private to you — there is no student-facing
          leaderboard, deliberately.
        </p>
        <p>
          Answers save as they are given, so a dead battery costs nothing. If something goes wrong
          for one student, <b>Reset</b> wipes their attempt and lets them start again.
        </p>
        <p>
          After you close the test, <b>Answers you might have accepted</b> lists wrong answers that
          look defensible — a synonym, a regional variant, a translation you would have allowed on
          paper. Accepting one re-marks every student who wrote it and remembers the decision for
          future tests. This panel is what makes strict spelling reasonable; it is worth a minute
          after every sprint.
        </p>
        <p>
          A test cannot be edited while it is open. Close it from the board first.
        </p>
      </>
    ),
  },
  {
    title: 'Connecting a language model',
    summary: 'What it does, what it costs, and what still works without one.',
    body: (
      <>
        <p>
          An administrator sets this up once for the whole instance, under{' '}
          <b>Settings → Language model</b>. Individual teachers do not need their own key.
        </p>
        <p>
          It takes any OpenAI-compatible endpoint — OpenRouter, OpenAI, or a model running on your
          own machine. The key is stored server-side and is never sent back to the browser.
        </p>
        <p>
          The AI does three jobs: finding the words in a pasted text, writing the questions, and
          reading a photographed page. That is all. <b>Everything else works without it</b>, and a
          complete test can be built by hand from a pasted word list — with no key configured, the
          AI buttons simply do not appear.
        </p>
        <p>
          <b>Avoid reasoning models.</b> They are slow enough to be unusable here, and can spend
          their entire token budget thinking instead of answering. A fast, cheap model does this
          work in seconds; a reasoning model took over two minutes per pass and sometimes returned
          nothing at all.
        </p>
        <p>
          The AI proposes, you dispose. Difficulty ratings are opinions, and near-synonyms
          occasionally slip through as distractors — <i>kaum → scarcely</i> offered against{' '}
          <i>barely</i>, which is also correct. The Questions step is the backstop, and reading it
          before class takes a couple of minutes.
        </p>
      </>
    ),
  },
  {
    title: 'Practice, and what students see afterwards',
    summary: 'Revising beforehand, retaking afterwards, and reviewing the misses.',
    body: (
      <>
        <p>
          Once you publish a test, its word list appears on every student's screen with a{' '}
          <b>Practise</b> button. That drills the word pairs — English to German and back — as often
          as they like, and offers a second round of just the ones they missed.
        </p>
        <p>
          It deliberately does <b>not</b> use the test's own questions. They would be the same
          questions in the same order on the day, so practising them would measure how many times a
          student clicked through rather than what they know — and a multiple-choice trap stops
          working once the four options are familiar. Nothing about practice is recorded: you are
          not told who revised, or how it went.
        </p>
        <p>
          When a student hands in, they see their percentage and a review of the questions they got
          wrong, with the right answer next to what they wrote. Misses come first — that is the part
          worth reading.
        </p>
        <p>
          From there they can run the same test again as <b>practice</b>. Practice attempts are
          never graded, never appear on your board and never affect the class statistics. It is
          there so a student who scored 40% can go again on the bus home without it counting against
          them.
        </p>
        <p>
          During the sprint, a near-miss is marked wrong but flagged <b>Almost</b>, so a student who
          typed <i>thorough</i> for <i>through</i> can see the difference rather than just a cross.
          It never earns marks.
        </p>
      </>
    ),
  },
];

function Step({ n, name, children }: { n: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="tabular w-16 shrink-0 text-ink-40">
        {n} <span className="sr-only">{name}</span>
      </dt>
      <dd className="flex-1">
        <b>{name}</b> — {children}
      </dd>
    </div>
  );
}

export function Help() {
  // Everything is open on arrival: a teacher looking for one answer should be
  // able to use the browser's own find, not click five times first.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (title: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-3">
        <span className="label">Help</span>
        <h1 className="text-hero">How voku works</h1>
      </div>

      <Note>
        A sprint is five minutes of vocabulary against the clock, where the target is a pass mark
        rather than a ceiling. Everything below follows from that one idea.
      </Note>

      <div className="rule-t max-w-2xl">
        {TOPICS.map((topic) => {
          const open = !closed.has(topic.title);
          return (
            <section key={topic.title} className="rule-b py-6">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(topic.title)}
                className="group flex w-full items-baseline gap-4 text-left"
              >
                <span className="flex-1">
                  <span className="text-xl">{topic.title}</span>
                  <span className="mt-1 block text-ink-40">{topic.summary}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cx(
                    'shrink-0 text-ink-40 transition-transform group-hover:text-ink',
                    open && 'rotate-45',
                  )}
                >
                  +
                </span>
              </button>

              {open ? (
                <div className="mt-5 flex max-w-prose flex-col gap-4 leading-relaxed text-ink-60 [&_b]:text-ink">
                  {topic.body}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
