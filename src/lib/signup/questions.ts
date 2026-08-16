import { z } from 'zod';

/**
 * The extra questions an institute asks at signup (PRD section 9, and the
 * seam left open when deferred activation shipped).
 *
 * WHERE THE ANSWERS LIVE, AND WHY IT IS NOT NEGOTIABLE
 *
 * On the membership, never on the global `users` row. These answers belong to
 * a relationship with one institute: a home congregation, an ordination year,
 * a pastor's reference. Storing them globally would carry Grace's intake
 * answers to Cornerstone the moment the same person enrolled there, and the
 * isolation suite would never see it, because the row is legitimately global.
 * The column is `memberships.profile_json` and this file is what fills it.
 *
 * WHAT AN INSTITUTE MAY ASK
 *
 * Four field types, deliberately few. Every one of them is a question a person
 * answers about themselves in a sentence or a choice. There is no file upload,
 * no date of birth picker, and no free-form HTML, because each of those turns
 * a signup form into a place where an institute collects something it then has
 * to protect, and the platform holds that data on their behalf.
 */

/** Ten questions is already a long form. The cap is a kindness to applicants. */
export const MAX_QUESTIONS = 10;
const MAX_ANSWER_LENGTH = 2000;
const MAX_OPTIONS = 20;

export const questionIdSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9_-]{0,38}[a-z0-9])?$/,
    'must be lowercase letters, digits, hyphens, and underscores',
  );

export const signupQuestionSchema = z.object({
  /**
   * Stable across edits. It is the key in `profile_json`, so renaming a label
   * keeps existing answers attached and changing an id orphans them.
   */
  id: questionIdSchema,
  label: z.string().min(1).max(200),
  /** Shown under the label. Use it for the reason you are asking. */
  help: z.string().max(300).optional(),
  type: z.enum(['text', 'textarea', 'select', 'checkbox']),
  required: z.boolean().default(false),
  /** Only meaningful for 'select'. */
  options: z.array(z.string().min(1).max(120)).max(MAX_OPTIONS).optional(),
});

export type SignupQuestion = z.infer<typeof signupQuestionSchema>;

export const signupQuestionsSchema = z
  .array(signupQuestionSchema)
  .max(MAX_QUESTIONS)
  .superRefine((questions, ctx) => {
    const seen = new Set<string>();
    for (const [index, question] of questions.entries()) {
      if (seen.has(question.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: `duplicate question id "${question.id}"`,
        });
      }
      seen.add(question.id);

      // A select with nothing to select from renders as an empty dropdown that
      // a required question then refuses to accept, which is a form nobody can
      // submit and no error message explains.
      if (question.type === 'select' && (question.options ?? []).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'options'],
          message: 'a choice question needs at least one option',
        });
      }
    }
  });

/**
 * Reads whatever is in `tenant_settings.signup_questions_json`, and treats
 * anything unparseable as no questions at all.
 *
 * Failing open to an empty list is deliberate. The alternative is a signup
 * form that throws because a settings row is malformed, which takes enrolment
 * down for an institute over a cosmetic problem. A missing question is a
 * missing answer; a broken form is a closed door.
 */
export function parseQuestions(value: unknown): SignupQuestion[] {
  const parsed = signupQuestionsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export type AnswerResult =
  | { ok: true; answers: Record<string, string | boolean> }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates submitted answers against this institute's own questions.
 *
 * Server side, and against the definitions rather than against whatever the
 * form said it was asking. The browser sends field names and values, and a
 * caller that skipped the form entirely can send anything at all, so the
 * question list is the only thing that decides what is accepted.
 *
 * Unknown keys are dropped rather than rejected. An institute that removes a
 * question while somebody has the old form open should not hand that person an
 * error they cannot act on, and keeping the answer would store data against a
 * question that no longer exists.
 */
export function validateAnswers(
  questions: SignupQuestion[],
  submitted: Record<string, unknown>,
): AnswerResult {
  const answers: Record<string, string | boolean> = {};
  const errors: Record<string, string> = {};

  for (const question of questions) {
    const raw = submitted[question.id];

    if (question.type === 'checkbox') {
      const checked = raw === true || raw === 'true' || raw === 'on';
      if (question.required && !checked) {
        errors[question.id] = 'This has to be ticked.';
        continue;
      }
      answers[question.id] = checked;
      continue;
    }

    const text = typeof raw === 'string' ? raw.trim() : '';

    if (!text) {
      if (question.required) errors[question.id] = 'This is required.';
      continue;
    }

    if (text.length > MAX_ANSWER_LENGTH) {
      errors[question.id] = 'That answer is too long.';
      continue;
    }

    // A choice has to be one of the offered choices. Without this, `select` is
    // a free text field that merely looks constrained, and an institute
    // reading its own reports would find values it never offered.
    if (
      question.type === 'select' &&
      !(question.options ?? []).includes(text)
    ) {
      errors[question.id] = 'Choose one of the options.';
      continue;
    }

    answers[question.id] = text;
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, answers };
}
