/**
 * Line icons drawn to the same hairline weight as the rest of the interface —
 * 1.5px strokes in currentColor, no fills, no emoji. A filled glyph would read
 * as a different material from everything around it.
 */
function Glyph({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

export function AccountIcon({ label }: { label?: string }) {
  return (
    <Glyph label={label}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.75 20c0-3.6 3.25-6 7.25-6s7.25 2.4 7.25 6" />
    </Glyph>
  );
}

export function GearIcon({ label }: { label?: string }) {
  return (
    <Glyph label={label}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.65 5.35l-1.55 1.55M6.9 17.1l-1.55 1.55M18.65 18.65L17.1 17.1M6.9 6.9L5.35 5.35" />
    </Glyph>
  );
}

export function HelpIcon({ label }: { label?: string }) {
  return (
    <Glyph label={label}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.3a2.6 2.6 0 1 1 3.4 2.5c-.65.25-1.05.8-1.05 1.5v.5" />
      <path d="M11.85 17h.02" />
    </Glyph>
  );
}

export function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
