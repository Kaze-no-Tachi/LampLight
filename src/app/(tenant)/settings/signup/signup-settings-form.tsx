'use client';

import { useState, useTransition } from 'react';
import { MAX_QUESTIONS, type SignupQuestion } from '@/lib/signup/questions';
import { saveSignupSettingsAction } from './actions';

/**
 * Editing the questions an institute asks.
 *
 * The question `id` is shown and editable, deliberately, because it is the key
 * answers are stored under. Changing it orphans every answer already collected
 * under the old one, so it is better for an admin to see the thing that
 * matters than for it to be generated invisibly from a label they later
 * reword. The warning next to it says so.
 */
export function SignupSettingsForm({
  mode,
  questions: initial,
}: {
  mode: 'open' | 'closed';
  questions: SignupQuestion[];
}) {
  const [signupMode, setSignupMode] = useState(mode);
  const [questions, setQuestions] = useState<SignupQuestion[]>(initial);
  const [result, setResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(index: number, patch: Partial<SignupQuestion>) {
    setQuestions((current) =>
      current.map((question, position) =>
        position === index ? { ...question, ...patch } : question,
      ),
    );
  }

  function save() {
    const data = new FormData();
    data.set('signupMode', signupMode);
    data.set('questions', JSON.stringify(questions));

    startTransition(async () => {
      const outcome = await saveSignupSettingsAction(data);
      setSaved(outcome.status === 'ok');
      setResult(outcome.status === 'error' ? outcome.message : null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Who can join</legend>
        {(['closed', 'open'] as const).map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="signupMode"
              className="mt-1"
              checked={signupMode === option}
              onChange={() => setSignupMode(option)}
            />
            <span>
              {option === 'closed' ? (
                <>
                  <strong>Closed.</strong> Nobody can create their own account.
                  You invite people, or they arrive by buying a course.
                </>
              ) : (
                <>
                  <strong>Open.</strong> Anyone with the address of your site
                  can ask to join. They still have to confirm their email before
                  the account exists.
                </>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">What you ask them</h2>
          <button
            type="button"
            disabled={questions.length >= MAX_QUESTIONS}
            onClick={() =>
              setQuestions((current) => [
                ...current,
                {
                  id: `question_${current.length + 1}`,
                  label: '',
                  type: 'text',
                  required: false,
                },
              ])
            }
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-60"
          >
            Add a question
          </button>
        </div>

        {questions.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Nothing extra. The form asks for a first name, a last name, and an
            email address.
          </p>
        )}

        {questions.map((question, index) => (
          <QuestionEditor
            key={index}
            question={question}
            onChange={(patch) => update(index, patch)}
            onRemove={() =>
              setQuestions((current) =>
                current.filter((_unused, position) => position !== index),
              )
            }
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60"
        >
          {pending ? 'Saving...' : 'Save'}
        </button>
        {saved && !result && <span className="text-sm">Saved.</span>}
        {result && <span className="text-destructive text-sm">{result}</span>}
      </div>
    </div>
  );
}

function QuestionEditor({
  question,
  onChange,
  onRemove,
}: {
  question: SignupQuestion;
  onChange: (patch: Partial<SignupQuestion>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex gap-3">
        <label className="flex w-full flex-col gap-1 text-sm">
          Question
          <input
            value={question.label}
            onChange={(event) => onChange({ label: event.target.value })}
            placeholder="Home congregation"
            className="rounded-md border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            value={question.type}
            onChange={(event) =>
              onChange({ type: event.target.value as SignupQuestion['type'] })
            }
            className="rounded-md border px-3 py-2"
          >
            <option value="text">Short answer</option>
            <option value="textarea">Long answer</option>
            <option value="select">Choice</option>
            <option value="checkbox">Tick box</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Help text, optional
        <input
          value={question.help ?? ''}
          onChange={(event) => onChange({ help: event.target.value })}
          placeholder="Why you are asking"
          className="rounded-md border px-3 py-2"
        />
      </label>

      {question.type === 'select' && (
        <label className="flex flex-col gap-1 text-sm">
          Options, one per line
          <textarea
            rows={3}
            value={(question.options ?? []).join('\n')}
            onChange={(event) =>
              onChange({
                options: event.target.value
                  .split('\n')
                  .map((option) => option.trim())
                  .filter(Boolean),
              })
            }
            className="rounded-md border px-3 py-2"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={question.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          Required
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Key</span>
          <input
            value={question.id}
            onChange={(event) => onChange({ id: event.target.value })}
            className="w-40 rounded-md border px-2 py-1 font-mono text-xs"
          />
        </label>

        <button
          type="button"
          onClick={onRemove}
          className="text-destructive ml-auto rounded-md border px-3 py-1 text-sm"
        >
          Remove
        </button>
      </div>

      <p className="text-muted-foreground text-xs">
        Answers are stored under the key. Changing it on a question people have
        already answered leaves those answers behind under the old one.
      </p>
    </div>
  );
}
