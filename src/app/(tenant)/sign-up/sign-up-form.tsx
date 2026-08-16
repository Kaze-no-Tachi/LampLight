'use client';

import { useState, useTransition } from 'react';

/**
 * Name and address, no password.
 *
 * There is deliberately no password field. Nothing exists to attach one to
 * until the address is confirmed, and asking for one here would put the
 * account-existence oracle straight back: choose a password, submit, then try
 * to sign in with it, and whether that works tells you whether the address was
 * already registered.
 *
 * The success message is shown for every submission, including addresses that
 * already hold accounts and submissions that were suppressed because a link
 * went out minutes ago.
 */
export function SignUpForm() {
  const [sent, setSent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="text-sm">
        Check your email. If that address can be registered here, a link is on
        its way. It works once and expires in three days.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        startTransition(async () => {
          const response = await fetch('/api/tenant/sign-up', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              firstName: String(form.get('firstName') ?? ''),
              lastName: String(form.get('lastName') ?? ''),
              email: String(form.get('email') ?? ''),
            }),
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
      <div className="flex gap-3">
        <input
          name="firstName"
          required
          autoComplete="given-name"
          placeholder="First name"
          className="w-full rounded-md border px-3 py-2"
        />
        <input
          name="lastName"
          required
          autoComplete="family-name"
          placeholder="Last name"
          className="w-full rounded-md border px-3 py-2"
        />
      </div>
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
          Check the name and address fields.
        </p>
      )}
    </form>
  );
}
