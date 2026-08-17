'use client';

import { useState, useTransition } from 'react';
import type { GrantableSource } from '@/db/repositories/entitlements';
import { grantAction, revokeAction } from '../actions';

type Enrollment = {
  id: string;
  sourceKind: 'program' | 'course';
  sourceTitle: string;
  /** ISO, because a Date cannot cross the server boundary as a prop. */
  expiresAt: string | null;
  granted: boolean;
};

/**
 * What one person can reach, and the two things an admin can do about it.
 *
 * Expired rows stay visible rather than disappearing. "Their access ran out in
 * March" is the answer to the support question that brought the admin here, and
 * a row that vanished would read as though the enrollment never happened.
 */
export function AccessPanel({
  userId,
  enrollments,
  sources,
}: {
  userId: string;
  enrollments: Enrollment[];
  sources: GrantableSource[];
}) {
  const [source, setSource] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function grant() {
    const data = new FormData();
    data.set('userId', userId);
    data.set('source', source);
    data.set('expiresAt', expiresAt);
    data.set('reason', reason);

    startTransition(async () => {
      const outcome = await grantAction(data);
      setError(outcome.status === 'error' ? outcome.message : null);
      setMessage(outcome.status === 'ok' ? (outcome.message ?? null) : null);
      if (outcome.status === 'ok') {
        setSource('');
        setExpiresAt('');
        setReason('');
      }
    });
  }

  function revoke(enrollmentId: string) {
    const data = new FormData();
    data.set('enrollmentId', enrollmentId);
    data.set('userId', userId);

    startTransition(async () => {
      const outcome = await revokeAction(data);
      setError(outcome.status === 'error' ? outcome.message : null);
      setMessage(outcome.status === 'ok' ? (outcome.message ?? null) : null);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Access</h2>

      {enrollments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing yet. They can still hear any lesson the institute has marked
          as a free preview.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {enrollments.map((enrollment) => (
            <li
              key={enrollment.id}
              className="bg-card border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-(--radius) border p-3"
            >
              <span className="font-medium">{enrollment.sourceTitle}</span>
              <span className="text-muted-foreground text-sm">
                {enrollment.sourceKind === 'program' ? 'Program' : 'Course'}
                {enrollment.granted ? ', granted' : ', purchased'}
                {describeExpiry(enrollment.expiresAt)}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => revoke(enrollment.id)}
                className="text-destructive ml-auto rounded-md border px-3 py-1 text-sm disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Enrol them in something</h3>

        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
            Course or program
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="rounded-md border px-3 py-2"
            >
              <option value="">Choose one</option>
              <optgroup label="Programs">
                {sources
                  .filter((entry) => entry.kind === 'program')
                  .map((entry) => (
                    <option key={entry.id} value={`program:${entry.id}`}>
                      {entry.title}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Courses">
                {sources
                  .filter((entry) => entry.kind === 'course')
                  .map((entry) => (
                    <option key={entry.id} value={`course:${entry.id}`}>
                      {entry.title}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Access until, optional
            <input
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="rounded-md border px-3 py-2"
            />
            <span className="text-muted-foreground text-xs">
              Leave empty for no end date
            </span>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Note, optional
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Scholarship, paid by cheque, staff access"
            className="rounded-md border px-3 py-2"
          />
          <span className="text-muted-foreground text-xs">
            Kept in the audit record, not shown to the student
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending || !source}
            onClick={grant}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-60"
          >
            {pending ? 'Saving...' : 'Enrol'}
          </button>
          {message && <span className="text-sm">{message}</span>}
          {error && <span className="text-destructive text-sm">{error}</span>}
        </div>
      </div>
    </section>
  );
}

function describeExpiry(iso: string | null): string {
  if (!iso) return ', no end date';

  const when = new Date(iso);
  const formatted = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(when);

  return when.getTime() < Date.now()
    ? `, ended ${formatted}`
    : `, until ${formatted}`;
}
