import { Note } from '../components/ui.tsx';

/**
 * Placeholder. The structure is here so the icon leads somewhere honest rather
 * than to an empty page — fill the sections in as the app settles.
 */
export function Help() {
  const sections = [
    { title: 'Setting up a class', body: 'Adding students, and printing their login codes.' },
    { title: 'Building a test', body: 'From a text or a pasted word list, with or without the AI.' },
    { title: 'How the scoring works', body: 'Why the target is not a maximum, and what the sprint measures.' },
    { title: 'Running it in class', body: 'Opening, watching the board, closing, and fixing a disputed answer.' },
    { title: 'Connecting a language model', body: 'What it does, what it costs, and what still works without one.' },
  ];

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-3">
        <span className="label">Help</span>
        <h1 className="text-hero">How voku works</h1>
      </div>

      <Note>Not written yet — these are the questions it will answer.</Note>

      <ul className="rule-t max-w-2xl">
        {sections.map((section) => (
          <li key={section.title} className="rule-b py-5">
            <p className="text-xl">{section.title}</p>
            <p className="mt-1 text-ink-40">{section.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
