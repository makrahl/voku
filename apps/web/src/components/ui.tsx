import { useEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The wordmark. The dot is the one piece of the old identity kept, now in the
 * single accent — and it is the only decorative use of terracotta anywhere.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const scale = {
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-hero',
  }[size];
  return (
    <span className={cx('font-semibold tracking-tight leading-none', scale)}>
      Voku<span className="text-accent">.</span>
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="label">{children}</div>;
}

/**
 * A page heading you can type into. A textarea, not an input: headings wrap,
 * and a long title in a single-line field scrolls sideways out of view instead.
 *
 * Commits on blur or Enter, reverts on Escape, and refuses an empty value.
 */
export function EditableHeading({
  value,
  onSave,
  disabled = false,
  ariaLabel,
  size = 'hero',
}: {
  value: string;
  onSave: (next: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** `hero` for a page title, `row` for a name inside a list. */
  size?: 'hero' | 'row';
}) {
  const [draft, setDraft] = useState(value);
  const field = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => setDraft(value), [value]);
  useEffect(fit, [draft, size]);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onSave(next);
  };

  return (
    <textarea
      ref={field}
      rows={1}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        // A title is one line; Enter commits rather than adding a break.
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cx(
        'block w-full resize-none overflow-hidden border-b border-transparent bg-transparent px-0 text-ink',
        'focus:border-accent focus:outline-none',
        size === 'hero'
          ? 'max-w-3xl py-1 text-hero font-semibold tracking-tight'
          : 'text-xl leading-snug',
        !disabled && 'hover:border-hairline-strong',
        disabled && 'cursor-default',
      )}
    />
  );
}

/**
 * An icon button for the header. Square, hairline-free until hovered, so a row
 * of them reads as quiet chrome rather than three competing controls.
 */
export function IconButton({
  label,
  active = false,
  onClick,
  children,
  ...rest
}: ComponentPropsWithRef<'button'> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-[2px] transition-colors',
        active ? 'text-ink' : 'text-ink-40 hover:text-ink',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A dropdown anchored to an icon. It needs a surface to be readable over
 * content, so it is the one place a panel exists — kept to a hairline border on
 * the paper colour rather than becoming a floating card.
 */
export function Menu({
  trigger,
  label,
  children,
}: {
  trigger: (open: boolean) => ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[2px] px-1 transition-colors',
          open ? 'text-ink' : 'text-ink-40 hover:text-ink',
        )}
      >
        {trigger(open)}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-20 min-w-56 border border-hairline-strong bg-paper py-1"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="rule-b px-4 pb-2 pt-1.5 text-sm text-ink-40">
      <span className="truncate">{children}</span>
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-4 py-2.5 text-left text-ink transition-colors hover:bg-accent-quiet"
    >
      {children}
    </button>
  );
}

/**
 * A titled region separated by a hairline — the flat-plane replacement for a
 * card. Nothing here has a fill or a shadow.
 */
export function Section({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      {title || actions ? (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {title ? <h2 className="text-xl">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  // shrink-0 + nowrap: in a flex row a button would otherwise be squeezed until
  // its label wrapped, turning "New test" into a two-line block.
  const base =
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] font-medium transition-colors disabled:cursor-not-allowed';
  const sizes = {
    sm: 'min-h-9 px-3 text-sm',
    md: 'min-h-11 px-5',
    lg: 'min-h-14 px-10 text-lg',
  }[size];
  const variants = {
    // Disabled keeps the button's shape and swaps the fill for a neutral one:
    // an empty outline read as a broken box, and a faded terracotta as a
    // rendering fault. Text stays at 4.6:1 on the muted fill.
    primary: 'bg-accent text-paper hover:opacity-90 disabled:bg-inert disabled:text-ink-40',
    secondary:
      'border border-hairline-strong text-ink hover:border-ink disabled:border-transparent disabled:bg-inert disabled:text-ink-40',
    quiet: 'text-ink-60 hover:text-ink disabled:text-ink-40',
    danger: 'border border-hairline-strong text-ink-60 hover:border-ink hover:text-ink',
  }[variant];
  return <button className={cx(base, sizes, variants, className)} {...rest} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="text-sm text-ink-60">{hint}</span> : null}
    </label>
  );
}

/* Inputs are hairline-underlined rather than boxed, to keep the plane flat. */
const inputClass =
  'w-full min-h-11 border-b border-hairline-strong bg-transparent px-0 py-2 text-ink placeholder:text-ink-25 focus:border-accent';

export function Input(props: ComponentPropsWithRef<'input'>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

/**
 * Autocorrect is off everywhere a student types an answer. Grading is strict,
 * and an iPad on a German keyboard will happily turn "thorough" into "through" —
 * marking that wrong would be marking the keyboard, not the student.
 */
export function AnswerInput(props: ComponentPropsWithRef<'input'>) {
  return (
    <input
      {...props}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={cx(
        'w-full border-b-2 border-hairline-strong bg-transparent px-0 pb-3 pt-2',
        'text-center text-5xl font-medium tracking-tight text-ink',
        'placeholder:text-ink-25 focus:border-accent focus:outline-none',
        props.className,
      )}
    />
  );
}

export function Textarea(props: ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      {...props}
      className={cx(
        'w-full min-h-32 border border-hairline bg-transparent p-3 leading-relaxed',
        'text-ink placeholder:text-ink-25 focus:border-accent',
        props.className,
      )}
    />
  );
}

export function Select(props: ComponentPropsWithRef<'select'>) {
  const { children, className, ...rest } = props;
  return (
    <select {...rest} className={cx(inputClass, className)}>
      {children}
    </select>
  );
}

/**
 * Status is carried by weight and a hairline, not by a filled chip — filled
 * pills would reintroduce the boxes the brief removes.
 */
export function Status({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'quiet';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'text-ink border-hairline-strong',
    accent: 'text-accent border-accent',
    quiet: 'text-ink-40 border-hairline',
  }[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em]',
        tones,
      )}
    >
      {children}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-prose border-l border-hairline-strong pl-4 text-sm leading-relaxed text-ink-60">
      {children}
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rule-t rule-b py-14 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-ink-60">{children}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-60" role="status">
      <span className="size-3 animate-spin rounded-full border border-hairline-strong border-t-accent" />
      {label ?? 'Working…'}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-sm text-ink-60">{children}</p> : null;
}

/** A hairline-divided list — the flat-plane replacement for a stack of cards. */
export function Rows({ children }: { children: ReactNode }) {
  return <ul className="rule-t">{children}</ul>;
}

export function Row({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <li
      className={cx('rule-b', onClick && 'cursor-pointer hover:bg-accent-quiet', className)}
      onClick={onClick}
    >
      <div className="flex flex-wrap items-center gap-4 px-1 py-4">{children}</div>
    </li>
  );
}
