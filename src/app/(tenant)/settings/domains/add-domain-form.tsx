'use client';

import { useState, useTransition } from 'react';
import { addDomainAction } from './actions';

export function AddDomainForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);

        startTransition(async () => {
          const result = await addDomainAction(data);
          setError(result.status === 'error' ? result.message : null);
          if (result.status === 'ok') form.reset();
        });
      }}
    >
      <label className="text-sm font-medium" htmlFor="hostname">
        Add a domain
      </label>
      <div className="flex gap-3">
        <input
          id="hostname"
          name="hostname"
          required
          placeholder="learn.yourinstitute.edu"
          className="w-full rounded-md border px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 whitespace-nowrap disabled:opacity-60"
        >
          {pending ? 'Adding...' : 'Add'}
        </button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}
