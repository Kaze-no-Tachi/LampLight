import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which institute a piece of auth mail is being sent on behalf of.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Better Auth builds password reset links against a single configured base
 * URL. One value cannot be right for a platform where every institute has its
 * own hostname, and getting it wrong is not cosmetic: it sends somebody to
 * another institute's domain to type their password. The library hands the raw
 * token to the sendResetPassword callback, so the link can be built correctly,
 * but the callback is given no request and therefore no host.
 *
 * The host is known at the top of the request and needed at the bottom of a
 * library call, which is exactly what AsyncLocalStorage is for. The alternative
 * was a module-level variable, which races the moment two institutes request a
 * reset at the same time, and that race sends one institute's user a link on
 * the other's domain.
 *
 * Verified to hold across the library's internal awaits and to keep two
 * concurrent requests apart, rather than assumed.
 */

export type SendingInstitute = {
  /** The host the request arrived on, which is where links must point. */
  readonly host: string;
  /** The institute's display name, for the body of the message. */
  readonly name: string;
};

const storage = new AsyncLocalStorage<SendingInstitute>();

/** Runs `fn` with the institute available to anything it calls, at any depth. */
export function withSendingInstitute<T>(
  institute: SendingInstitute,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(institute, fn);
}

/**
 * The institute in scope, or null outside a request.
 *
 * Callers must treat null as "do not send". A message with no institute has
 * nowhere to point its links, and guessing a host is the failure this whole
 * module exists to prevent.
 */
export function getSendingInstitute(): SendingInstitute | null {
  return storage.getStore() ?? null;
}
