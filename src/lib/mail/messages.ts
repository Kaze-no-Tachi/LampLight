import type { MailMessage } from './index';

/**
 * The messages the signup flow sends.
 *
 * Kept together because what distinguishes them is a security property, not a
 * presentation choice, and reading them side by side is the only way to check
 * it. Both go to the address that was submitted and nowhere else, so neither
 * tells the person who filled in the form anything at all. What each one tells
 * the owner of the address is different, and that is the point: whoever
 * actually holds the mailbox learns exactly what happened, including that
 * somebody used their address without their knowledge.
 *
 * Plain text throughout. An activation link is the one thing that must survive
 * every client, including the ones that strip HTML, and a link a person can
 * read before clicking is worth more here than a styled button.
 */

const SIGNATURE = (institute: string) =>
  `\n\n${institute}\nSent by Lamplight on behalf of ${institute}.`;

/**
 * Sent when the address holds no account: follow this link, choose a password,
 * and you are in.
 */
export function activationEmail(params: {
  to: string;
  firstName: string;
  institute: string;
  url: string;
  expiresAt: Date;
}): MailMessage {
  const greeting = params.firstName ? `Hello ${params.firstName},` : 'Hello,';

  return {
    to: params.to,
    subject: `Confirm your ${params.institute} account`,
    text:
      `${greeting}\n\n` +
      `Someone asked to create an account for you at ${params.institute}. ` +
      'Open the link below to choose a password and finish setting it up.\n\n' +
      `${params.url}\n\n` +
      `The link works once and stops working on ${formatExpiry(params.expiresAt)}.\n\n` +
      'If this was not you, nothing has been created and you can ignore this ' +
      'message.' +
      SIGNATURE(params.institute),
  };
}

/**
 * Sent when the address already holds an account.
 *
 * Deliberately a different message to the same address. It tells the owner
 * that their address was used, which they are entitled to know, and it offers
 * the only safe way to join: sign in with the credentials they already have.
 * Nothing about their account has changed by the time this is sent, and this
 * message cannot change it either, because handing a stranger a way to attach
 * themselves to an existing account by naming its address would trade an
 * information leak for account takeover.
 */
export function existingAccountEmail(params: {
  to: string;
  institute: string;
  url: string;
}): MailMessage {
  return {
    to: params.to,
    subject: `About your account at ${params.institute}`,
    text:
      'Hello,\n\n' +
      `Someone used this address to sign up at ${params.institute}. ` +
      'This address already has a Lamplight account, so nothing was created ' +
      'and nothing about your account has changed.\n\n' +
      'If it was you, sign in with your existing password and you will be ' +
      `added to ${params.institute}:\n\n` +
      `${params.url}\n\n` +
      'If it was not you, there is nothing to do. Whoever filled in the form ' +
      'was not told whether this address has an account.' +
      SIGNATURE(params.institute),
  };
}

/**
 * Sent when somebody asks to reset a password and the address has an account.
 *
 * Nothing is sent when it does not, which is the one asymmetry in this file and
 * the reason the request endpoint answers identically either way: the response
 * has to carry no information, and an unsent message carries none to anybody
 * except the person who was not expecting one.
 */
export function passwordResetEmail(params: {
  to: string;
  institute: string;
  url: string;
  expiresAt: Date;
}): MailMessage {
  return {
    to: params.to,
    subject: `Reset your ${params.institute} password`,
    text:
      'Hello,\n\n' +
      `Somebody asked to reset the password for this address at ${params.institute}. ` +
      'Open the link below to choose a new one.\n\n' +
      `${params.url}\n\n` +
      `The link works once and stops working on ${formatExpiry(params.expiresAt)}.\n\n` +
      'If this was not you, your password has not changed and you can ignore ' +
      'this message.' +
      SIGNATURE(params.institute),
  };
}

/**
 * Sent to the first administrator when an operator provisions an institute.
 *
 * Same mechanism as a student invitation, different role and different words.
 * The operator never sees a password, and never sees this link either, so the
 * credential exists only between the mailbox and the person who owns it.
 */
export function adminInviteEmail(params: {
  to: string;
  institute: string;
  url: string;
  expiresAt: Date;
}): MailMessage {
  return {
    to: params.to,
    subject: `Set up ${params.institute} on Lamplight`,
    text:
      'Hello,\n\n' +
      `${params.institute} has been set up on Lamplight and you have been ` +
      'named its administrator. Open the link below to choose a password and ' +
      'sign in.\n\n' +
      `${params.url}\n\n` +
      `The link works once and stops working on ${formatExpiry(params.expiresAt)}.` +
      SIGNATURE(params.institute),
  };
}

/**
 * A date a person can read, in UTC.
 *
 * UTC rather than the institute's timezone because the recipient's is unknown
 * and guessing wrong by a day on an expiry is worse than being explicit.
 */
function formatExpiry(when: Date): string {
  return `${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Sent when an institute admin invites somebody who has not asked to join.
 *
 * Different from activationEmail in one way that matters: the recipient did not
 * fill in a form, so the message has to say who invited them and why they are
 * hearing from us at all. An unexplained link asking for a password is
 * indistinguishable from a phishing attempt, and a bible institute's students
 * are exactly the audience that should be suspicious of one.
 */
export function invitationEmail(params: {
  to: string;
  instituteName: string;
  url: string;
  expiresAt: Date;
  role: 'student' | 'admin';
}): MailMessage {
  const standing =
    params.role === 'admin'
      ? 'You have been invited to help administer'
      : 'You have been invited to study at';

  return {
    to: params.to,
    subject: `${params.instituteName} has invited you`,
    text:
      'Hello,\n\n' +
      `${standing} ${params.instituteName} on Lamplight. Open the link below ` +
      'to choose a password and finish setting up your account.\n\n' +
      `${params.url}\n\n` +
      `The link works once and stops working on ${formatExpiry(params.expiresAt)}.\n\n` +
      'If you were not expecting this, somebody at the institute entered your ' +
      'address. Nothing has been created, and ignoring this message leaves it ' +
      'that way.' +
      SIGNATURE(params.instituteName),
  };
}
