'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * One failure message for every reason sign-in can fail.
 *
 * Wrong password, no such account, and an address that has never been
 * confirmed all read the same. Splitting them would rebuild the
 * account-existence oracle that the whole signup design exists to close, this
 * time on the sign-in form.
 */
export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        startTransition(async () => {
          const response = await fetch('/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email: String(form.get('email') ?? ''),
              password: String(form.get('password') ?? ''),
            }),
          });

          if (!response.ok) {
            setFailed(true);
            return;
          }

          setFailed(false);
          router.push(next);
          router.refresh();
        });
      }}
    >
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="rounded-md border px-3 py-2"
      />
      <input
        name="password"
        type="password"
        required
        autoComplete="current-password"
        placeholder="Password"
        className="rounded-md border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60"
      >
        {pending ? 'Signing in...' : 'Sign in'}
      </button>

      {failed && (
        <p className="text-destructive text-sm">
          That combination did not work. Check the address and password, or
          confirm your account from the link you were emailed.
        </p>
      )}
    </form>
  );
}
