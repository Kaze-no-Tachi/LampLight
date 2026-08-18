'use client';

import { useEffect, useState } from 'react';

/**
 * The pieces every authoring screen repeats (mockups 6 to 9).
 *
 * Four screens, one field label, one save indicator, one card. Kept here so
 * that the eyebrow's tracking and the wording of "Unsaved changes" are decided
 * once: four copies of a label drift, and the drift is invisible until two of
 * these screens are open side by side.
 */

/**
 * The uppercase eyebrow the design puts above every field.
 *
 * The optional note is set back in sentence case beside it, which is how the
 * mockup writes the "what students search by" half: it reads as an aside
 * rather than as more label. Parenthesised rather than run on after the
 * uppercase, because the mockup separates the two with an em dash and this
 * project does not use them: without some mark, "TAGS what students search by"
 * reads as one long label.
 */
export function FieldLabel({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <span className="text-muted-foreground text-(length:--text-meta) font-medium tracking-[0.08em] uppercase">
      {children}
      {note && (
        <span className="font-normal tracking-normal normal-case">
          {' '}
          ({note})
        </span>
      )}
    </span>
  );
}

/** The card every authoring form sits in. */
export function FormCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border-border bg-card flex flex-col gap-5 rounded-(--radius) border px-[26px] py-6 ${className}`}
    >
      {children}
    </section>
  );
}

export type SaveState =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string };

/** How long "Saved just now" is still true. */
const JUST_NOW_MS = 60_000;

/**
 * What the form says about itself, in words beside the button.
 *
 * The design is explicit that this is never a toast: a toast is gone by the
 * time somebody looks up from the field they were typing in, and the one
 * question this line answers ("is what I can see on the screen what is
 * stored?") is asked at exactly that moment.
 *
 * "Saved just now" stops saying so after a minute rather than sitting there
 * all afternoon on a tab nobody closed. It goes quiet instead of counting up:
 * a form with nothing to report should look like a form with nothing to
 * report.
 */
export function SaveIndicator({ state }: { state: SaveState }) {
  const [stale, setStale] = useState(false);

  const savedAt = state.kind === 'saved' ? state.at : null;

  useEffect(() => {
    if (savedAt === null) return;
    setStale(false);
    const timer = setTimeout(() => setStale(true), JUST_NOW_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  if (state.kind === 'error') {
    return (
      <span
        role="status"
        className="text-destructive text-(length:--text-meta)"
      >
        {state.message}
      </span>
    );
  }

  const label =
    state.kind === 'dirty'
      ? 'Unsaved changes'
      : state.kind === 'saving'
        ? 'Saving'
        : state.kind === 'saved' && !stale
          ? 'Saved just now'
          : '';

  if (!label) return null;

  return (
    <span
      role="status"
      className="text-muted-foreground text-(length:--text-meta)"
    >
      {label}
    </span>
  );
}
