'use client';

import { useState, useTransition } from 'react';
import { inviteAction } from './actions';

/**
 * Inviting people by address, in bulk, because an institute enrolling a cohort
 * has a list and not one name.
 *
 * The result deliberately does not say what happened to each address. Whether
 * somebody already has an account, here or at another institute on Lamplight,
 * is not something this screen reports: it would turn an admin's own roster
 * into a way to test addresses against the whole platform.
 */
export function InviteForm() {
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<'student' | 'admin'>('student');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const data = new FormData();
    data.set('emails', emails);
    data.set('role', role);

    startTransition(async () => {
      const outcome = await inviteAction(data);
      if (outcome.status === 'error') {
        setError(outcome.message);
        setResult(null);
        return;
      }

      setError(null);
      setEmails('');
      setResult(
        `Invited ${outcome.invited}.` +
          (outcome.skipped.length > 0
            ? ` Not an address, so skipped: ${outcome.skipped.join(', ')}.`
            : ''),
      );
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Invite people</h2>

      <label className="flex flex-col gap-1 text-sm">
        Addresses, one per line
        <textarea
          rows={4}
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          placeholder={'student@example.com\nanother@example.com'}
          className="rounded-md border px-3 py-2 font-mono text-xs"
        />
      </label>

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">What they join as</legend>
        {(['student', 'admin'] as const).map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="radio"
              name="role"
              checked={role === option}
              onChange={() => setRole(option)}
            />
            {option === 'student' ? 'As students' : 'As administrators'}
          </label>
        ))}
      </fieldset>

      <p className="text-muted-foreground text-sm">
        Each person gets a link to choose their own password. No account exists
        until they do, so an address entered by mistake creates nothing.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || emails.trim().length === 0}
          onClick={submit}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-60"
        >
          {pending ? 'Sending...' : 'Send invitations'}
        </button>
        {result && <span className="text-sm">{result}</span>}
        {error && <span className="text-destructive text-sm">{error}</span>}
      </div>
    </section>
  );
}
