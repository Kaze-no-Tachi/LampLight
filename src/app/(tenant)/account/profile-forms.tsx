'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * The two things somebody wants from their own account page.
 *
 * The page listed courses and nothing else: no way to change a password, no
 * way to correct a name that was typed by whoever invited them. Password reset
 * existed only as the forgotten-password flow, which means the way to change a
 * password you still know was to claim you had forgotten it.
 *
 * These call Better Auth's own endpoints rather than going through server
 * actions. Password change has to verify the current password, and that check
 * belongs in the library that owns the hashing rather than in a copy of it
 * here.
 *
 * Both send a content type. Better Auth answers 415 without one, which is how
 * the sign-out button silently did nothing for an afternoon.
 */

type Status = { kind: 'ok' | 'error'; message: string } | null;

function Report({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      className={
        status.kind === 'error'
          ? 'text-destructive text-sm'
          : 'text-muted-foreground text-sm'
      }
    >
      {status.message}
    </p>
  );
}

export function ChangePasswordForm() {
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const next = String(data.get('newPassword') ?? '');

        if (next.length < 12) {
          setStatus({
            kind: 'error',
            message: 'Choose a password of at least 12 characters.',
          });
          return;
        }

        startTransition(async () => {
          const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              currentPassword: String(data.get('currentPassword') ?? ''),
              newPassword: next,
              // Anybody else holding a session for this account loses it. A
              // password change is usually somebody securing an account they
              // think is compromised, and leaving other sessions alive is the
              // one thing that would make the change pointless.
              revokeOtherSessions: true,
            }),
          });

          if (!response.ok) {
            setStatus({
              kind: 'error',
              message: 'That did not work. Check your current password.',
            });
            return;
          }

          form.reset();
          setStatus({
            kind: 'ok',
            message: 'Password changed. Other devices have been signed out.',
          });
        });
      }}
    >
      <input
        name="currentPassword"
        type="password"
        required
        autoComplete="current-password"
        placeholder="Current password"
        className="rounded-md border px-3 py-2"
      />
      <input
        name="newPassword"
        type="password"
        required
        autoComplete="new-password"
        placeholder="New password, 12 characters or more"
        className="rounded-md border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground self-start rounded-md px-4 py-2 text-sm disabled:opacity-60"
      >
        {pending ? 'Changing...' : 'Change password'}
      </button>
      <Report status={status} />
    </form>
  );
}

export function ChangeNameForm({ name }: { name: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const next = String(data.get('name') ?? '').trim();

        if (next.length < 2) {
          setStatus({
            kind: 'error',
            message: 'Names need a couple of letters.',
          });
          return;
        }

        startTransition(async () => {
          const response = await fetch('/api/auth/update-user', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: next }),
          });

          if (!response.ok) {
            setStatus({ kind: 'error', message: 'That did not save.' });
            return;
          }

          setStatus({ kind: 'ok', message: 'Saved.' });
          router.refresh();
        });
      }}
    >
      <input
        name="name"
        defaultValue={name}
        required
        autoComplete="name"
        className="rounded-md border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border px-4 py-2 text-sm disabled:opacity-60"
      >
        {pending ? 'Saving...' : 'Save name'}
      </button>
      <Report status={status} />
    </form>
  );
}
