'use client';

import { useState, useTransition } from 'react';
import type { SignupQuestion } from '@/lib/signup/questions';

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
export function SignUpForm({ questions }: { questions: SignupQuestion[] }) {
  const [sent, setSent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
              answers: Object.fromEntries(
                questions.map((question) => [
                  question.id,
                  question.type === 'checkbox'
                    ? form.get(question.id) !== null
                    : String(form.get(question.id) ?? ''),
                ]),
              ),
            }),
          });

          if (response.status === 400) {
            const body = (await response.json().catch(() => null)) as {
              errors?: Record<string, string>;
            } | null;
            setFieldErrors(body?.errors ?? {});
            // Only a shape problem with the name or address is reported
            // generally. Anything the server named a field for is shown
            // against that field instead.
            setInvalid(Object.keys(body?.errors ?? {}).length === 0);
            return;
          }

          setInvalid(false);
          setFieldErrors({});
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
      {questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          error={fieldErrors[question.id]}
        />
      ))}

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

/**
 * One of the institute's own questions.
 *
 * The `required` attribute is a convenience, not the check. The server
 * validates against the stored question list, because a caller can post
 * without ever loading this page.
 */
function QuestionField({
  question,
  error,
}: {
  question: SignupQuestion;
  error?: string;
}) {
  const described = question.help ? `${question.id}-help` : undefined;

  return (
    <div className="flex flex-col gap-1">
      {question.type === 'checkbox' ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            id={question.id}
            name={question.id}
            type="checkbox"
            className="mt-1"
            aria-describedby={described}
          />
          <span>{question.label}</span>
        </label>
      ) : (
        <>
          <label className="text-sm font-medium" htmlFor={question.id}>
            {question.label}
          </label>
          {question.type === 'textarea' && (
            <textarea
              id={question.id}
              name={question.id}
              required={question.required}
              rows={3}
              aria-describedby={described}
              className="rounded-md border px-3 py-2"
            />
          )}
          {question.type === 'text' && (
            <input
              id={question.id}
              name={question.id}
              required={question.required}
              aria-describedby={described}
              className="rounded-md border px-3 py-2"
            />
          )}
          {question.type === 'select' && (
            <select
              id={question.id}
              name={question.id}
              required={question.required}
              defaultValue=""
              aria-describedby={described}
              className="rounded-md border px-3 py-2"
            >
              <option value="" disabled>
                Choose one
              </option>
              {(question.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {question.help && (
        <p id={described} className="text-muted-foreground text-sm">
          {question.help}
        </p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
