# Voku — Design Brief (Direction 1a, "Swiss Minimal")

Reference screens: `Voku Styles.dc.html` — sections `#1a` (quiz), `#2a` (start), `#2b` (result).

## Platform
Tablet, 4:3-ish canvas (1024×768 design frame).

## Visual language
- **Background:** off-white `#fafaf8`, no gradients, no shadows/cards — flat single-plane layout.
- **Text color:** near-black `#161613` for primary content; `rgba(22,22,19,.4–.6)` for secondary/meta text.
- **Accent color:** terracotta `#c65d3b` — used sparingly, only for the progress fill, the selected/correct answer state, and primary CTA buttons. Nowhere else.
- **Typography:** Inter throughout (500/600 weights). Large, confident display size for the core word/title (68–88px). Small uppercase tracked labels (14–15px, letter-spacing ~.14em) for eyebrow/meta text. No decorative or serif fonts.
- **Borders, not boxes:** answer rows and dividers are thin 1–1.5px hairlines, not filled cards or heavy shadows. Selected/answered state gets a heavier accent-colored border-bottom, not a background fill.
- **Buttons:** rectangular, sharp corners (2px radius max), solid terracotta fill with off-white text for primary actions; plain hairline border for secondary actions.
- **Spacing:** generous whitespace, centered content, no clutter — one focal element per screen.

## Screens included
1. **Quiz (1a):** top bar with close icon, thin progress line (terracotta fill), "X / 20" counter. Center: uppercase instruction label + large German word. Bottom: 3 answer rows stacked, divided by hairlines, each with a letter (A/B/C) aligned right.
2. **Start (2a):** fully centered — eyebrow category label, giant "Voku" wordmark, one-line quiz summary (word count / format / time estimate), terracotta "Start Quiz" button below.
3. **Result (2b):** "Deck complete" eyebrow, huge score (e.g. "16/20"), miss count subtext, two-button row at bottom (secondary "Review misses" hairline button + primary terracotta "Continue" button).

## Tone
Calm, editorial, confident — more "design tool" than "gamified app." No streaks, badges, or playful mascots. Motivation comes from clarity and restraint, not decoration.
