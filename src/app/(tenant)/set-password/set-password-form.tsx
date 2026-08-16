'use client';

import { useState, useTransition } from 'react';

/**
 * Posts to Better Auth's reset-password endpoint.
 *
 * The failure message is deliberately the same whether the token was never
 * valid, has already been used, or has expired. Distinguishing them would tell
 * whoever is holding a stale link which of those it is, and none of that helps
 * the legitimate holder, who needs a new link in every case.
 */
export function SetPasswordForm({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const [pending, startTransition] = useTransition();

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
        placeholder="At least 12 characters"
        className="rounded-md border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending || state === 'done'}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60"
      >
        {pending ? 'Saving...' : 'Set password'}
      </button>

      {state === 'done' && (
        <p className="text-sm">Password set. You can sign in now.</p>
      )}
      {state === 'error' && (
        <p className="text-destructive text-sm">
          That link is no longer usable. Ask for a new one.
        </p>
      )}
    </form>
  );
}
