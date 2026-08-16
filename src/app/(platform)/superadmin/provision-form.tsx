'use client';

import { useState, useTransition } from 'react';
import { provisionTenant, type ProvisionResult } from './actions';

/**
 * The provisioning form.
 *
 * A client component only because it has to show the result: a single-use
 * setup link for the new admin. The operator passes it on and never learns a
 * password. Until invite emails land in P1, that hand-off is manual, but the
 * secret at the end of it is the admin's alone.
 */
export function ProvisionForm() {
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      action={(formData) => {
        startTransition(async () => {
          setResult(await provisionTenant(formData));
        });
      }}
    >
      <input
        name="name"
        placeholder="Grace Bible Institute"
        required
        className="rounded-md border px-3 py-2"
      />
      <input
        name="slug"
        placeholder="grace"
        required
        pattern="[a-z0-9][a-z0-9-]*"
        className="rounded-md border px-3 py-2"
      />
      <input
        name="adminEmail"
        type="email"
        placeholder="admin@gracebible.edu"
        required
        className="rounded-md border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60"
      >
        {pending ? 'Provisioning...' : 'Provision institute'}
      </button>

      {result?.status === 'error' && (
        <p className="text-destructive text-sm">{result.message}</p>
      )}

      {result?.status === 'ok' && (
        <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
          <span>
            <strong>{result.slug}</strong> is live at {result.host}
          </span>
          <span className="text-muted-foreground">
            Admin: {result.adminEmail}
          </span>
          {result.setupUrl ? (
            <span className="flex flex-col gap-1">
              <span>Single-use setup link, send this to the admin:</span>
              <code className="font-mono break-all">{result.setupUrl}</code>
              <span className="text-muted-foreground">
                It expires, is good once, and lets them choose a password you
                never see.
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              That address already had an account, so its credentials were left
              untouched and no setup link was issued.
            </span>
          )}
        </div>
      )}
    </form>
  );
}
