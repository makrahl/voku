/**
 * How far a student has got through a word list, remembered on their own device.
 *
 * A list of fifty words is not learned in one sitting, and the class said so:
 * every practice round started from the whole list again. So a round is now a
 * stage of a dozen words, and the device remembers which words have been typed
 * right first time — enough to hand back the ones still missing next time.
 *
 * Deliberately *not* on the server. Voku stores a first name and a score per
 * student and nothing else; a per-child record of which words they cannot do
 * would be a different kind of data with a different kind of question attached
 * to it. The cost is that another iPad, or cleared browser data, starts fresh —
 * and that the teacher never sees any of this, which is the same rule the
 * "words to work on" list already follows.
 */
import type { Outcome } from './drill-round.ts';

/** A stage: short enough to finish in a sitting, long enough to be worth doing. */
export const STAGE_SIZE = 12;

export interface Progress {
  /** Words typed right first time, and not missed since. */
  known: string[];
  updatedAt: string;
}

export const EMPTY: Progress = { known: [], updatedAt: '' };

/**
 * Only "right first time" counts as known. Needing another go inside the round
 * is exactly the state this is meant to remember, not to forgive — and a word
 * that goes wrong later drops out again, so the list cannot silently rot.
 */
export function record(progress: Progress, outcomes: Record<string, Outcome>, now = new Date()): Progress {
  const known = new Set(progress.known);
  for (const [wordId, outcome] of Object.entries(outcomes)) {
    if (outcome === 'first') known.add(wordId);
    else known.delete(wordId);
  }
  return { known: [...known], updatedAt: now.toISOString() };
}

/** Counted against the list as it is now, so words the teacher removed do not inflate it. */
export function knownCount(wordIds: string[], progress: Progress): number {
  const known = new Set(progress.known);
  return wordIds.filter((id) => known.has(id)).length;
}

/**
 * The next stage: the words not yet known, in the list's own order, capped.
 *
 * Returns an empty list when the whole list is known — the caller then offers a
 * round of everything, because "finished" should mean "go again", not a wall.
 */
export function nextStage(wordIds: string[], progress: Progress, size = STAGE_SIZE): string[] {
  const known = new Set(progress.known);
  return wordIds.filter((id) => !known.has(id)).slice(0, size);
}

// ---------------------------------------------------------------------------
// The device's own memory
// ---------------------------------------------------------------------------

const key = (listKey: string) => `voku.practice.${listKey}`;

/**
 * Storage can be switched off, full, or refused outright in a private window,
 * and practice has to work anyway — so every failure here means "this device
 * remembers nothing", never an error on screen.
 */
export function load(listKey: string): Progress {
  try {
    const raw = window.localStorage.getItem(key(listKey));
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    const known = (parsed as Progress).known;
    if (!Array.isArray(known) || known.some((id) => typeof id !== 'string')) return EMPTY;
    return { known, updatedAt: String((parsed as Progress).updatedAt ?? '') };
  } catch {
    return EMPTY;
  }
}

export function save(listKey: string, progress: Progress): void {
  try {
    window.localStorage.setItem(key(listKey), JSON.stringify(progress));
  } catch {
    // Nothing to do and nothing to say: the round itself is unaffected.
  }
}

export function clear(listKey: string): void {
  try {
    window.localStorage.removeItem(key(listKey));
  } catch {
    // As above.
  }
}
