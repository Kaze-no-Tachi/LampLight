'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { enrollAction } from '../actions';

/**
 * The one control on the course page that changes anything.
 *
 * Three states, decided server-side and passed in rather than worked out here,
 * because "may this person enrol" is exactly the question `can` already
 * answered while rendering the page:
 *
 *   - signed out: a link to sign-in, returning to this same course, per the
 *     round 2 decision that enrolling ignores price and needs no purchase flow
 *   - already enrolled: nothing to click, just the fact
 *   - may enrol: the button, which asks `can` again on the server before
 *     writing anything
 */
export function EnrollButton({
  slug,
  courseId,
  state,
}: {
  slug: string;
  courseId: string;
  state: 'signed-out' | 'already-enrolled' | 'can-enroll';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (state === 'already-enrolled') {
    return (
      <span className="text-muted-foreground text-sm">
        You are enrolled in this course.
      </span>
    );
  }

  if (state === 'signed-out') {
    return (
      <Link
        href={`/sign-in?next=${encodeURIComponent(`/catalogue/${slug}`)}`}
        className="bg-primary text-primary-foreground inline-block rounded-(--radius) px-4 py-2 text-sm font-medium"
      >
        Sign in to enrol
      </Link>
    );
  }

  function enroll() {
    startTransition(async () => {
      const outcome = await enrollAction(courseId, slug);
      if (outcome.status === 'error') {
        setError(outcome.message);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={enroll}
        className="bg-primary text-primary-foreground rounded-(--radius) px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {pending ? 'Enrolling...' : 'Enrol'}
      </button>
      {error && <span className="text-destructive text-sm">{error}</span>}
    </div>
  );
}
