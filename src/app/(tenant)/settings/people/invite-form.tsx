'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Input, Modal, Radio, RadioGroup } from 'rsuite';
import { inviteAction } from './actions';

/**
 * Inviting people by address, in bulk, because an institute enrolling a cohort
 * has a list and not one name.
 *
 * A dialog off the header button (mockup 10) rather than a permanent block
 * above the roster. Inviting is occasional and the roster is what the screen
 * is for; a form that is always open pushes the list somebody came to read
 * down the page every day to serve the week it is used.
 *
 * The result deliberately does not say what happened to each address. Whether
 * somebody already has an account, here or at another institute on Lamplight,
 * is not something this screen reports: it would turn an admin's own roster
 * into a way to test addresses against the whole platform.
 */
export function InviteForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setError(null);
          setOpen(true);
        }}
        className="bg-primary text-primary-foreground cursor-pointer rounded-(--radius) px-4 py-2.5 text-(length:--text-ui) font-medium"
      >
        Invite by email
      </button>

      <Modal open={open} onClose={() => setOpen(false)} size="sm">
        <Modal.Header>
          <Modal.Title>Invite people</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 text-(length:--text-label)">
              Addresses, one per line
              <Input
                as="textarea"
                rows={5}
                value={emails}
                onChange={(next: string) => setEmails(next)}
                placeholder={'student@example.com\nanother@example.com'}
                className="font-mono"
              />
            </label>

            <RadioGroup
              inline
              name="role"
              value={role}
              onChange={(next) => setRole(next as 'student' | 'admin')}
            >
              <Radio value="student">As students</Radio>
              <Radio value="admin">As administrators</Radio>
            </RadioGroup>

            <p className="text-muted-foreground text-(length:--text-label) leading-[1.55]">
              Each person gets a link to choose their own password. No account
              exists until they do, so an address entered by mistake creates
              nothing.
            </p>

            {result && (
              <p className="text-(length:--text-label)" role="status">
                {result}
              </p>
            )}
            {error && (
              <p className="text-destructive text-(length:--text-label)">
                {error}
              </p>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button onClick={() => setOpen(false)} disabled={pending}>
            Close
          </Button>
          <Button
            appearance="primary"
            loading={pending}
            disabled={emails.trim().length === 0}
            onClick={submit}
          >
            Send invitations
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
