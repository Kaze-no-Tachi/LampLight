'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

type Outcome = 'idle' | 'activated' | 'joined' | 'sign_in_required' | 'error';

/**
 * Finishes an activation.
 *
 * The failure message is the same whether the token was never valid, has been
 * used, or has expired. Distinguishing them tells whoever holds a stale link
 * which it is, and helps the legitimate holder not at all: they need a new
 * link in every one of those cases.
 */
export function ActivateForm({
  token,
  needsPassword,
  needsSignIn,
}: {
  token: string;
  needsPassword: boolean;
  needsSignIn: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const [pending, startTransition] = useTransition();

  // The link is carried through sign-in so the person lands back here and the
  // join completes, rather than arriving signed in with nothing to show for it.
  const signInHref = `/sign-in?next=${encodeURIComponent(
    `/activate?token=${token}`,
  )}`;

  if (needsSignIn && outcome === 'idle') {
    return (
      <div className="flex flex-col gap-3">
        <Link
          href={signInHref}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-center"
        >
          Sign in
        </Link>
        <SubmitButton
          label="I am already signed in"
          variant="quiet"
          pending={pending}
          onClick={() => submit()}
        />
      </div>
    );
  }

  function submit(password?: string) {
    startTransition(async () => {
      const response = await fetch('/api/tenant/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(password ? { token, password } : { token }),
      });

      const body = (await response.json().catch(() => null)) as {
        status?: string;
      } | null;

      if (body?.status === 'activated') setOutcome('activated');
      else if (body?.status === 'joined') setOutcome('joined');
      else if (body?.status === 'sign_in_required')
        setOutcome('sign_in_required');
      else setOutcome('error');
    });
  }

  if (outcome === 'activated' || outcome === 'joined') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {outcome === 'activated'
            ? 'Your account is ready.'
            : 'You have been added.'}
        </p>
        <Link
          href={outcome === 'joined' ? '/account' : '/sign-in'}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-center"
        >
          {outcome === 'joined' ? 'Continue' : 'Sign in'}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const password = new FormData(event.currentTarget).get('password');
        submit(password ? String(password) : undefined);
      }}
    >
      {needsPassword && (
        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          placeholder="At least 12 characters"
          className="rounded-md border px-3 py-2"
        />
      )}

      <SubmitButton
        label={needsPassword ? 'Create my account' : 'Continue'}
        pending={pending}
      />

      {outcome === 'sign_in_required' && (
        <p className="text-sm">
          This address already has an account.{' '}
          <Link href={signInHref} className="underline">
            Sign in
          </Link>{' '}
          and follow this link again.
        </p>
      )}
      {outcome === 'error' && (
        <p className="text-destructive text-sm">
          That link is no longer usable. Ask for a new one.
        </p>
      )}
    </form>
  );
}

function SubmitButton({
  label,
  pending,
  variant = 'primary',
  onClick,
}: {
  label: string;
  pending: boolean;
  variant?: 'primary' | 'quiet';
  onClick?: () => void;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={pending}
      className={
        variant === 'primary'
          ? 'bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60'
          : 'text-muted-foreground rounded-md border px-4 py-2 disabled:opacity-60'
      }
    >
      {pending ? 'Working...' : label}
    </button>
  );
}
