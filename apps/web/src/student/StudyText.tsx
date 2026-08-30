import { useEffect, useRef, useState } from 'react';
import { cx } from '../components/ui.tsx';

export interface Segment {
  text: string;
  wordId?: string;
  headwordEn?: string;
  translationDe?: string;
}

/**
 * The source text with the trained words marked.
 *
 * Touch first: a tap opens the translation and a second tap closes it, which is
 * the only gesture available on a tablet. Hover does the same on a pointer
 * device, and "show every translation" covers reading straight through.
 */
export function StudyText({
  segments,
  showAll,
}: {
  segments: Segment[];
  showAll: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={container} className="text-xl leading-loose">
      {segments.map((segment, index) => {
        if (!segment.wordId) {
          // Blank lines in the source are paragraph breaks.
          return (
            <span key={index} className="whitespace-pre-wrap">
              {segment.text}
            </span>
          );
        }

        const active = open === index || hovered === index;
        return (
          <span key={index} className="relative inline-block">
            <button
              type="button"
              aria-expanded={active}
              onClick={() => setOpen(open === index ? null : index)}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              className={cx(
                'border-b-2 transition-colors',
                active ? 'border-accent text-accent' : 'border-hairline-strong',
              )}
            >
              {segment.text}
            </button>

            {showAll ? (
              <span className="ml-1 align-baseline text-base text-ink-40">
                ({segment.translationDe})
              </span>
            ) : active ? (
              <span
                role="tooltip"
                className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap border border-hairline-strong bg-paper px-3 py-1.5 text-base leading-normal text-ink"
              >
                {segment.translationDe}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
