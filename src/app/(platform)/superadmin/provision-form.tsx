'use client';

import { useState, useTransition } from 'react';
import { Checkbox, Input } from 'rsuite';
import { provisionTenant, type ProvisionResult } from './actions';

/**
 * Provisioning an institute (mockup 12's form).
 *
 * A client component because it has to show what happened and because the
 * invitation checkbox changes what the paragraph beside it promises. The
 * operator never sees a credential either way: the link goes from the mail
 * server to the mailbox, and the password the admin chooses is one nobody here
 * can know.
 */

const FIELD_LABEL =
  'text-muted-foreground text-(length:--text-meta) font-medium tracking-[0.08em] uppercase';

export function ProvisionForm() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [sendInvitation, setSendInvitation] = useState(true);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function provision() {
    const data = new FormData();
    data.set('name', name);
    data.set('slug', slug);
    data.set('adminEmail', adminEmail);
    data.set('adminName', adminName);
    if (sendInvitation) data.set('sendInvitation', 'on');

    startTransition(async () => {
      const outcome = await provisionTenant(data);
      setResult(outcome);
      if (outcome.status === 'ok') {
        setName('');
        setSlug('');
        setAdminEmail('');
        setAdminName('');
      }
    });
  }

  return (
    <section className="border-border bg-card flex max-w-[560px] flex-col gap-3.5 rounded-(--radius) border px-6 py-[22px]">
      <h2 className="text-(length:--text-row-title) leading-tight">
        Provision an institute
      </h2>

      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-52 flex-1 flex-col gap-1.5">
          <span className={FIELD_LABEL}>Name</span>
          <Input
            value={name}
            onChange={(next: string) => setName(next)}
            placeholder="Bethel Bible Institute"
          />
        </label>
        <label className="flex w-[170px] flex-col gap-1.5">
          <span className={FIELD_LABEL}>Slug</span>
          <Input
            value={slug}
            onChange={(next: string) => setSlug(next)}
            placeholder="bethel"
            className="font-mono"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-52 flex-1 flex-col gap-1.5">
          <span className={FIELD_LABEL}>First admin</span>
          <Input
            value={adminEmail}
            onChange={(next: string) => setAdminEmail(next)}
            type="email"
            placeholder="admin@bethelbible.org"
          />
        </label>
        <label className="flex w-[170px] flex-col gap-1.5">
          <span className={FIELD_LABEL}>Their name</span>
          <Input
            value={adminName}
            onChange={(next: string) => setAdminName(next)}
            placeholder="Ada Nwosu"
          />
        </label>
      </div>

      <div className="flex flex-col">
        <Checkbox
          checked={sendInvitation}
          onChange={(_value, checked: boolean) => setSendInvitation(checked)}
        >
          <span className="text-(length:--text-label) font-medium">
            Send the invitation now
          </span>
        </Checkbox>
        <span className="text-muted-foreground pl-9 text-(length:--text-meta) leading-[1.5]">
          {sendInvitation
            ? 'They get a signed link that expires in seven days and can only be used once.'
            : 'The invitation is written but held. Provisioning again reissues it, so nothing is lost by waiting.'}
        </span>
      </div>

      <p className="text-muted-foreground text-(length:--text-meta) leading-[1.6]">
        Creates the institute on its own subdomain with that person as its only
        admin, and leaves payments unconfigured until they connect Stripe
        themselves. An institute is never left without an admin, because nobody
        here can act inside it on their behalf.
      </p>

      <button
        type="button"
        disabled={pending || !name || !slug || !adminEmail}
        onClick={provision}
        className="bg-primary text-primary-foreground w-fit cursor-pointer rounded-(--radius) px-4 py-[11px] text-(length:--text-ui) font-medium disabled:opacity-60"
      >
        {pending ? 'Provisioning' : 'Provision'}
      </button>

      {result?.status === 'error' && (
        <p className="text-destructive text-(length:--text-label)">
          {result.message}
        </p>
      )}

      {result?.status === 'ok' && (
        <div
          role="status"
          className="border-border flex flex-col gap-1 rounded-(--radius) border px-4 py-3 text-(length:--text-label)"
        >
          <span>
            <strong>{result.slug}</strong> is live at {result.host}
          </span>
          <span className="text-muted-foreground leading-[1.55]">
            {result.invited
              ? `A single-use invitation has been emailed to ${result.adminEmail}. It is not shown here and you cannot retrieve it: the link goes from the mail server to their mailbox, and the password they choose is one you never see. Provision again to reissue it.`
              : `The invitation for ${result.adminEmail} is written and held. Nothing has been sent. Provision again with the box ticked when you are ready for it to go out.`}
          </span>
        </div>
      )}
    </section>
  );
}
