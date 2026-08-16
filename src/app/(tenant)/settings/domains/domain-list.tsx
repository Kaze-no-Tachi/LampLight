'use client';

import { useState, useTransition } from 'react';
import type { DomainRecord } from '@/db/repositories/domains';
import { removeDomainAction, setPrimaryAction } from './actions';

/**
 * The DNS records an institute has to create, shown exactly as Cloudflare
 * described them, with copy buttons (PRD section 5.3).
 *
 * Exactly matters. An institute's IT contact is going to paste these into a
 * DNS provider, and a value that has been prettified, truncated, or had a
 * trailing dot helpfully added is a support ticket that looks like a platform
 * bug for a day before anyone spots it.
 */
export function DomainList({
  domains,
  tenantHost,
}: {
  domains: DomainRecord[];
  tenantHost: string;
}) {
  if (domains.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No custom domains yet. Your institute is reachable at {tenantHost},
        which keeps working whatever you add here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {domains.map((domain) => (
        <DomainCard key={domain.id} domain={domain} />
      ))}
    </ul>
  );
}

function DomainCard({ domain }: { domain: DomainRecord }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    action: (data: FormData) => Promise<{ status: string; message?: string }>,
  ) {
    const data = new FormData();
    data.set('id', domain.id);
    startTransition(async () => {
      const result = await action(data);
      setError(result.status === 'error' ? (result.message ?? null) : null);
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{domain.hostname}</span>
        <StatusBadge status={domain.status} isPrimary={domain.isPrimary} />
      </div>

      {domain.status !== 'active' && domain.dnsRecords.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            Create these records with whoever manages your DNS. The CNAME sends
            visitors to us. The TXT proves the domain is yours, and can be
            deleted once the domain is live.
          </p>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-3 font-normal">Type</th>
                <th className="py-1 pr-3 font-normal">Name</th>
                <th className="py-1 font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {domain.dnsRecords.map((record) => (
                <tr key={`${record.type}:${record.name}`} className="align-top">
                  <td className="py-1 pr-3 font-mono">{record.type}</td>
                  <td className="py-1 pr-3 font-mono break-all">
                    <Copyable value={record.name} />
                  </td>
                  <td className="py-1 font-mono break-all">
                    <Copyable value={record.value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {domain.lastError && (
        <p className="text-muted-foreground text-sm">
          Cloudflare says: {domain.lastError}
        </p>
      )}

      <div className="flex gap-3">
        {domain.status === 'active' && !domain.isPrimary && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(setPrimaryAction)}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-60"
          >
            Make primary
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(removeDomainAction)}
          className="text-destructive rounded-md border px-3 py-1 text-sm disabled:opacity-60"
        >
          Remove
        </button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
    </li>
  );
}

function StatusBadge({
  status,
  isPrimary,
}: {
  status: DomainRecord['status'];
  isPrimary: boolean;
}) {
  const label = {
    pending: 'Waiting for DNS',
    verifying: 'Checking DNS',
    active: isPrimary ? 'Live, primary' : 'Live',
    failed: 'Not working',
  }[status];

  return (
    <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
      {label}
    </span>
  );
}

/**
 * Copy without a clipboard permission prompt where possible, and never a dead
 * button: if the clipboard API is unavailable the text is still selectable,
 * which is what somebody pasting into a DNS panel actually needs.
 */
function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
      className="text-left underline decoration-dotted"
    >
      {copied ? 'Copied' : value}
    </button>
  );
}
