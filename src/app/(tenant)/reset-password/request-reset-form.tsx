'use client';

import { useState, useTransition } from 'react';

/**
 * Asks for a reset link.
 *
 * The confirmation is shown for every submission, including addresses that
 * hold no account and requests suppressed by the cooldown. Saying "no account
 * with that address" would be friendlier and would also answer, for anybody
 * who asks, whether a given person studies somewhere on this platform.
 */
export function RequestResetForm() {
  const [sent, setSent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="text-sm">
        Check your email. If that address has an account, a link is on its way.
        It works once and expires in an hour.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get('email');

        startTransition(async () => {
          const response = await fetch('/api/tenant/reset-request', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: String(email ?? '') }),
          });

          if (response.status === 400) {
            setInvalid(true);
            return;
          }

          setInvalid(false);
          setSent(true);
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
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60"
      >
        {pending ? 'Sending...' : 'Send me a link'}
      </button>

      {invalid && (
        <p className="text-destructive text-sm">
          That does not look like an email address.
        </p>
      )}
    </form>
  );
}
