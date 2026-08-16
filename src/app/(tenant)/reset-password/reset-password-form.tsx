'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

/**
 * Sets the new password, using Better Auth's own reset endpoint.
 *
 * The token is the library's, and so is the validation and the hashing. All
 * this application does is build the link that carries the token on the right
 * institute's hostname, which is the one thing the library cannot do for a
 * platform of many hosts.
 *
 * The failure message is the same whether the token was never valid, has been
 * used, or has expired. Distinguishing them tells whoever is holding a stale
 * link which it is, and the legitimate holder needs a new link in every case.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const [pending, startTransition] = useTransition();

  if (state === 'done') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">Password changed.</p>
        <Link
          href="/sign-in"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-center"
        >
          Sign in
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

        startTransition(async () => {
          const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newPassword: String(password), token }),
          });
          setState(response.ok ? 'done' : 'error');
        });
      }}
    >
      <input
        name="password"
        type="password"
        required
        minLength={12}
        autoComplete="new-password"
        placeholder="At least 12 characters"
        className="rounded-md border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60"
      >
        {pending ? 'Saving...' : 'Set password'}
      </button>

      {state === 'error' && (
        <p className="text-destructive text-sm">
          That link is no longer usable.{' '}
          <Link href="/reset-password" className="underline">
            Ask for a new one
          </Link>
          .
        </p>
      )}
    </form>
  );
}
