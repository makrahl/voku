import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './ui.tsx';

export interface Choice {
  id: string;
  name: string;
  /** Shown to the right of the name — context size, price, and so on. */
  meta?: string;
  /** A short mark before the meta, e.g. "vision". */
  tag?: string;
}

/**
 * Type-to-filter picker over a long list.
 *
 * A combobox rather than a select, deliberately: the field must still accept a
 * model the provider has not listed — one too new to appear, or a local server
 * that does not publish a catalogue. Whatever is typed is the value, and the
 * list is help rather than a constraint.
 *
 * Every space-separated term must match somewhere, so "claude sonnet" finds
 * "anthropic/claude-sonnet-4.5" without needing the punctuation.
 */
export function Combobox({
  value,
  onChange,
  choices,
  loading = false,
  placeholder,
  emptyHint,
}: {
  value: string;
  onChange: (value: string) => void;
  choices: Choice[];
  loading?: boolean;
  placeholder?: string;
  emptyHint?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
        // Typing and clicking away keeps what was typed: it may be a model the
        // provider never listed.
        onChange(query.trim());
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, query, onChange]);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return choices;

    const scored = choices
      .map((choice) => {
        const haystack = `${choice.id} ${choice.name}`.toLowerCase();
        if (!terms.every((term) => haystack.includes(term))) return null;
        // An id that starts with what you typed is almost certainly the one.
        const exact = choice.id.toLowerCase() === query.toLowerCase() ? 0 : 1;
        const prefix = choice.id.toLowerCase().startsWith(terms[0]!) ? 0 : 1;
        return { choice, rank: exact * 4 + prefix * 2 + choice.id.length / 1000 };
      })
      .filter((x): x is { choice: Choice; rank: number } => x !== null);

    scored.sort((a, b) => a.rank - b.rank);
    return scored.map((s) => s.choice);
  }, [choices, query]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [active, open]);

  const commit = (choice: Choice) => {
    onChange(choice.id);
    setQuery(choice.id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapper}>
      <input
        value={query}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, filtered.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const choice = filtered[active];
            if (open && choice) commit(choice);
            else {
              onChange(query.trim());
              setOpen(false);
            }
          } else if (event.key === 'Escape') {
            setQuery(value);
            setOpen(false);
          }
        }}
        className="w-full min-h-11 border-b border-hairline-strong bg-transparent px-0 py-2 text-ink placeholder:text-ink-25 focus:border-accent focus:outline-none"
      />

      {open ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-12 z-20 max-h-80 overflow-y-auto border border-hairline-strong bg-paper"
        >
          {loading ? (
            <li className="px-4 py-3 text-sm text-ink-40">Loading models…</li>
          ) : filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-40">
              {choices.length === 0
                ? (emptyHint ?? 'No models listed. Type the name yourself.')
                : `Nothing matches “${query}”. Press Enter to use it anyway.`}
            </li>
          ) : (
            filtered.slice(0, 200).map((choice, index) => (
              <li key={choice.id} data-index={index}>
                <button
                  type="button"
                  role="option"
                  aria-selected={choice.id === value}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(choice)}
                  className={cx(
                    'flex w-full items-baseline justify-between gap-4 px-4 py-2.5 text-left',
                    index === active && 'bg-accent-quiet',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{choice.id}</span>
                    <span className="block truncate text-sm text-ink-40">{choice.name}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm text-ink-40">
                    {choice.tag ? <span className="text-accent">{choice.tag} </span> : null}
                    {choice.meta}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
