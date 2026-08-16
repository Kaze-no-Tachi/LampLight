import { describe, expect, it } from 'vitest';
import {
  parseQuestions,
  validateAnswers,
  type SignupQuestion,
} from '@/lib/signup/questions';

/**
 * Validation runs against the institute's own question list, server side.
 *
 * The browser sends field names and values, and anybody can post to the
 * endpoint without ever loading the form, so the definitions are the only
 * thing that decides what an institute ends up storing.
 */

const QUESTIONS: SignupQuestion[] = [
  {
    id: 'congregation',
    label: 'Home congregation',
    type: 'text',
    required: true,
  },
  {
    id: 'track',
    label: 'Which track?',
    type: 'select',
    required: true,
    options: ['Pastoral', 'Missions'],
  },
  { id: 'notes', label: 'Anything else?', type: 'textarea', required: false },
  { id: 'agrees', label: 'I agree', type: 'checkbox', required: true },
];

describe('parsing an institute question list', () => {
  it('accepts a well formed list', () => {
    expect(parseQuestions(QUESTIONS)).toHaveLength(4);
  });

  it('treats anything unparseable as no questions rather than throwing', () => {
    // Failing open matters here. The alternative is a signup form that throws
    // because a settings row is malformed, which closes enrolment over a
    // cosmetic problem. A missing question is a missing answer; a broken form
    // is a closed door.
    expect(parseQuestions('not a list')).toEqual([]);
    expect(parseQuestions([{ id: 'x' }])).toEqual([]);
    expect(parseQuestions(null)).toEqual([]);
  });

  it('rejects a duplicate id, which would silently overwrite an answer', () => {
    expect(
      parseQuestions([
        { id: 'same', label: 'One', type: 'text', required: false },
        { id: 'same', label: 'Two', type: 'text', required: false },
      ]),
    ).toEqual([]);
  });

  it('rejects a choice question with nothing to choose', () => {
    // It renders as an empty dropdown that a required question then refuses to
    // accept, so the form cannot be submitted and no message says why.
    expect(
      parseQuestions([
        { id: 'track', label: 'Track', type: 'select', required: true },
      ]),
    ).toEqual([]);
  });
});

describe('validating answers', () => {
  it('accepts a complete submission', () => {
    const result = validateAnswers(QUESTIONS, {
      congregation: '  Grace Chapel ',
      track: 'Missions',
      notes: '',
      agrees: 'on',
    });

    expect(result).toEqual({
      ok: true,
      answers: {
        congregation: 'Grace Chapel',
        track: 'Missions',
        agrees: true,
      },
    });
  });

  it('refuses a choice that was never offered', () => {
    // Without this, select is a free text field that merely looks constrained,
    // and an institute reading its own reports finds values it never offered.
    const result = validateAnswers(QUESTIONS, {
      congregation: 'Grace Chapel',
      track: 'Something Else',
      agrees: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.track).toBeTruthy();
  });

  it('holds required questions to being answered', () => {
    const result = validateAnswers(QUESTIONS, { track: 'Pastoral' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.congregation).toBeTruthy();
      expect(result.errors.agrees).toBeTruthy();
    }
  });

  it('drops answers to questions the institute is not asking', () => {
    // A caller can post anything. Storing it would let anybody write arbitrary
    // keys into the membership's profile through a public endpoint.
    const result = validateAnswers(QUESTIONS, {
      congregation: 'Grace Chapel',
      track: 'Pastoral',
      agrees: true,
      smuggled: 'should not be stored',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.smuggled).toBeUndefined();
  });

  it('rejects an answer long enough to be an attack rather than an answer', () => {
    const result = validateAnswers(QUESTIONS, {
      congregation: 'x'.repeat(5000),
      track: 'Pastoral',
      agrees: true,
    });

    expect(result.ok).toBe(false);
  });

  it('accepts an empty submission when nothing is required', () => {
    const optional: SignupQuestion[] = [
      {
        id: 'notes',
        label: 'Anything else?',
        type: 'textarea',
        required: false,
      },
    ];

    expect(validateAnswers(optional, {})).toEqual({ ok: true, answers: {} });
  });
});
