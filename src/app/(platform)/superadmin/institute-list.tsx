'use client';

import { useMemo, useState } from 'react';
import { Input } from 'rsuite';
import type { TenantSummary } from './actions';

/**
 * The institute table, searchable and filterable (mockup 12).
 *
 * Client-side over a list already loaded, the same reasoning as the catalogue
 * and the teaching list: the platform has tens of institutes long before it has
 * thousands, and a round trip per keystroke buys nothing.
 *
 * "Awaiting DNS" is the filter worth having. The other three are states an
 * operator can see at a glance; this one answers "whose domain has not come up
 * yet", which is the question that brings anybody to this console after the
 * provisioning is done.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'dns', label: 'Awaiting DNS' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

/** A domain that exists and has not verified is the one worth flagging. */
function awaitingDns(tenant: TenantSummary): boolean {
  return tenant.primaryHost === null || tenant.primaryHostState !== 'active';
}

export function InstituteList({ tenants }: { tenants: TenantSummary[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return tenants.filter((tenant) => {
      if (filter === 'active' && tenant.status !== 'active') return false;
      if (filter === 'suspended' && tenant.status !== 'suspended') return false;
      if (filter === 'dns' && !awaitingDns(tenant)) return false;
      if (!needle) return true;

      return (
        tenant.name.toLowerCase().includes(needle) ||
        tenant.slug.includes(needle) ||
        (tenant.primaryHost ?? '').toLowerCase().includes(needle)
      );
    });
  }, [tenants, query, filter]);

  const narrowed = query.trim() !== '' || filter !== 'all';
  const count = narrowed
    ? `${matches.length} of ${tenants.length} institutes`
    : tenants.length === 1
      ? '1 institute'
      : `All ${tenants.length} institutes`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-65 flex-1">
          <Input
            value={query}
            onChange={(next: string) => setQuery(next)}
            placeholder="Search by name, slug or domain"
            aria-label="Search by name, slug or domain"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={filter === entry.key}
              onClick={() => setFilter(entry.key)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-(length:--text-label) font-medium transition-colors ${
                filter === entry.key
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'border-border hover:border-primary'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <span className="text-muted-foreground text-(length:--text-meta) whitespace-nowrap">
          {count}
        </span>
      </div>

      <div className="border-border bg-card overflow-hidden rounded-(--radius) border">
        <div className="border-border text-muted-foreground flex gap-4 border-b px-5 py-3 text-[0.6875rem] font-medium tracking-[0.1em] uppercase">
          <span className="flex-1">Institute</span>
          <span className="hidden w-[210px] md:block">Primary domain</span>
          <span className="w-[96px]">Members</span>
          <span className="hidden w-[78px] sm:block">Fee</span>
          <span className="w-[92px] text-center">Status</span>
        </div>

        {matches.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-(length:--text-label)">
            {tenants.length === 0
              ? 'None provisioned yet. The form below makes the first one.'
              : 'Nothing under that.'}
          </p>
        ) : (
          matches.map((tenant) => (
            <div
              key={tenant.id}
              className="border-border flex items-center gap-4 border-b px-5 py-3.5 last:border-b-0"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-(length:--text-ui) font-medium">
                  {tenant.name}
                </span>
                <span className="text-muted-foreground truncate font-mono text-(length:--text-meta)">
                  {tenant.slug}
                </span>
              </span>

              <span className="hidden w-[210px] flex-col gap-0.5 md:flex">
                <span className="truncate font-mono text-(length:--text-label)">
                  {tenant.primaryHost ?? 'none yet'}
                </span>
                {/*
                  The design sets this in #8a5a12, and there is no warning
                  token: the allow-list in src/lib/theme/theme.ts has brand,
                  accent, background and radius and nothing that means "not
                  finished yet". Hardcoding the hex would be the one colour in
                  the app a theme could not reach, so the emphasis is weight
                  and full contrast instead of hue. Worth a real token if a
                  second screen ever needs to say the same thing.
                */}
                <span
                  className={`text-[0.71875rem] ${
                    awaitingDns(tenant)
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                  }`}
                >
                  {tenant.primaryHost === null
                    ? 'no domain claimed'
                    : tenant.primaryHostState === 'active'
                      ? 'verified'
                      : 'awaiting DNS'}
                </span>
              </span>

              <span className="text-muted-foreground w-[96px] text-(length:--text-label)">
                {tenant.memberCount === 1
                  ? '1 member'
                  : `${tenant.memberCount} members`}
              </span>

              <span className="text-muted-foreground hidden w-[78px] font-mono text-(length:--text-label) sm:block">
                {tenant.applicationFeeBps} bps
              </span>

              <span
                className={`w-[92px] shrink-0 rounded-full px-2.5 py-1 text-center text-[0.71875rem] leading-none font-medium capitalize ${
                  tenant.status === 'active'
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {tenant.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
