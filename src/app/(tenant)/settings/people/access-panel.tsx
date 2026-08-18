'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Checkbox, DatePicker, Input, SelectPicker } from 'rsuite';
import type { GrantableSource } from '@/db/repositories/entitlements';
import { grantAction, revokeAction } from './actions';

type Enrollment = {
  id: string;
  sourceKind: 'program' | 'course';
  sourceTitle: string;
  /** ISO, because a Date cannot cross the server boundary as a prop. */
  expiresAt: string | null;
  granted: boolean;
};

/**
 * What one person can reach, and the two things an admin can do about it
 * (mockup 10's sidebar).
 *
 * Moved here from the per-person page, which is where it used to be the whole
 * screen. Granting is the reason an admin opens People at all, and putting it
 * beside the roster means enrolling four people from a cheque is four clicks
 * rather than four navigations. The per-person page keeps what will not fit in
 * a 320px column: what somebody told the institute at signup.
 *
 * Expired rows stay visible rather than disappearing. "Their access ran out in
 * March" is the answer to the support question that brought the admin here,
 * and a row that vanished would read as though the enrolment never happened.
 *
 * WHAT "SCHOLARSHIP" DOES. It is a note in the audit record, not a state. The
 * entitlement it produces is the same one a purchase produces, which is
 * exactly the point: a student who was given a place and a student who paid
 * for one see identical screens, and nothing in the product tells the second
 * kind apart from the first.
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
  const router = useRouter();
  const [source, setSource] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [scholarship, setScholarship] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function grant() {
    if (!source) return;
    const data = new FormData();
    data.set('userId', userId);
    data.set('source', source);
    // The date input speaks local time; the column is a timestamp. Sent as the
    // plain day so the server reads the day the admin picked rather than the
    // day it happened to be in UTC when they picked it.
    data.set('expiresAt', expiresAt ? toPlainDate(expiresAt) : '');
    data.set('reason', scholarship ? `Scholarship. ${reason}`.trim() : reason);

    startTransition(async () => {
      const outcome = await grantAction(data);
      setError(outcome.status === 'error' ? outcome.message : null);
      setMessage(outcome.status === 'ok' ? 'Access granted' : null);
      if (outcome.status === 'ok') {
        setSource(null);
        setExpiresAt(null);
        setScholarship(false);
        setReason('');
        router.refresh();
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
      if (outcome.status === 'ok') router.refresh();
    });
  }

  return (
    <>
      <div className="border-border flex flex-col gap-2 border-t pt-3.5">
        <span className="text-muted-foreground text-[0.71875rem] font-medium tracking-[0.1em] uppercase">
          Entitlements
        </span>

        {enrollments.length === 0 ? (
          <p className="text-muted-foreground text-(length:--text-label) leading-[1.5]">
            Nothing yet. They can still hear any lesson the institute has marked
            as open to everyone.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {enrollments.map((enrollment) => (
              <li key={enrollment.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2.5">
                  <span className="flex-1 text-(length:--text-ui) leading-[1.4]">
                    {enrollment.sourceTitle}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => revoke(enrollment.id)}
                    className="text-muted-foreground cursor-pointer text-(length:--text-meta) underline underline-offset-[3px] disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
                <span className="text-muted-foreground text-(length:--text-meta)">
                  {describeSource(enrollment)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-border flex flex-col gap-2.5 border-t pt-3.5">
        <span className="text-muted-foreground text-[0.71875rem] font-medium tracking-[0.1em] uppercase">
          Grant access by hand
        </span>

        <SelectPicker
          data={sources.map((entry) => ({
            value: `${entry.kind}:${entry.id}`,
            label: entry.title,
            group: entry.kind === 'program' ? 'Programs' : 'Courses',
          }))}
          groupBy="group"
          value={source}
          onChange={setSource}
          placeholder="A program or a course"
          searchable={sources.length > 8}
          block
        />

        <Checkbox
          checked={scholarship}
          onChange={(_value, checked: boolean) => setScholarship(checked)}
        >
          <span className="text-(length:--text-label)">
            Scholarship, no charge
          </span>
        </Checkbox>

        <label className="text-muted-foreground flex flex-col gap-1 text-(length:--text-label)">
          Expires
          <DatePicker
            value={expiresAt}
            onChange={setExpiresAt}
            format="yyyy-MM-dd"
            placeholder="No end date"
            oneTap
            block
          />
        </label>

        <Input
          value={reason}
          onChange={(next: string) => setReason(next)}
          placeholder="Paid by cheque, staff access"
          aria-label="Note for the audit record"
        />
        <span className="text-muted-foreground text-(length:--text-meta)">
          The note is kept in the audit record and never shown to the student.
        </span>

        <button
          type="button"
          disabled={pending || !source}
          onClick={grant}
          className="bg-primary text-primary-foreground cursor-pointer rounded-(--radius) px-3.5 py-2.5 text-center text-(length:--text-label) font-medium disabled:opacity-60"
        >
          {pending ? 'Saving' : (message ?? 'Grant access')}
        </button>

        {error && (
          <span className="text-destructive text-(length:--text-meta)">
            {error}
          </span>
        )}

        <span className="text-muted-foreground text-(length:--text-meta) leading-[1.5]">
          A lapsed grant reads to the student exactly like no grant at all. They
          see the course, not a locked banner.
        </span>
      </div>
    </>
  );
}

/** yyyy-mm-dd in the admin's own timezone, not UTC's idea of the same moment. */
function toPlainDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "Course, purchased" / "Program, scholarship, to Jun 2027" / "expired Mar 2026". */
function describeSource(enrollment: Enrollment): string {
  const kind = enrollment.sourceKind === 'program' ? 'Program' : 'Course';
  const how = enrollment.granted ? 'granted' : 'purchased';

  if (!enrollment.expiresAt) return `${kind}, ${how}, no end date`;

  const when = new Date(enrollment.expiresAt);
  const formatted = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
  }).format(when);

  return when.getTime() < Date.now()
    ? `${kind}, ${how}, expired ${formatted}`
    : `${kind}, ${how}, to ${formatted}`;
}
