import { getEnv, type Env } from '@/env';

/**
 * The mail port.
 *
 * Everything that sends mail goes through `sendMail`. There is one transport
 * chosen at boot from configuration, so the platform, a self-hoster, and a
 * developer with no mail server all run the same code path and differ only in
 * where the message lands.
 *
 * WHY THIS IS LOAD BEARING RATHER THAN A NICETY
 *
 * Account creation now depends on it. Nothing activates until a link sent to
 * the address is followed, which is what closes the account-existence oracle
 * described in docs/adr/0003. A silently dropped message is therefore not a
 * missing notification, it is an account nobody can ever finish creating. That
 * is why production refuses to start without a real transport (see
 * assertPlatformConfig in src/env.ts) rather than falling back to logging.
 */

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain text is required. HTML is an enhancement, never the only content. */
  text: string;
  html?: string;
};

export type SentMail = MailMessage & { from: string };

export type MailTransportKind = 'smtp' | 'console' | 'memory';

export interface MailTransport {
  readonly kind: MailTransportKind;
  send(message: SentMail): Promise<void>;
}

/**
 * Decides which transport a given configuration means.
 *
 * Pure and exported so the decision can be tested directly against a table of
 * environments, rather than inferred from what a running process did.
 */
export function resolveTransportKind(env: Env): MailTransportKind {
  if (env.MAIL_TRANSPORT !== 'auto') return env.MAIL_TRANSPORT;
  if (env.SMTP_HOST) return 'smtp';
  if (env.NODE_ENV === 'test') return 'memory';
  return 'console';
}

/**
 * Real delivery. nodemailer is imported lazily so that a developer or a test
 * run never loads it, and so the Next.js server bundle does not carry an SMTP
 * client into environments that will not open a socket.
 */
function createSmtpTransport(env: Env): MailTransport {
  if (!env.SMTP_HOST) {
    throw new Error(
      'MAIL_TRANSPORT is "smtp" but SMTP_HOST is not set. See .env.example.',
    );
  }
  const host = env.SMTP_HOST;

  // Built on first send rather than here, because constructing it opens no
  // connection but does pull in the dependency, and callers that never send
  // should pay neither.
  let client: Promise<{
    sendMail(options: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
    }): Promise<unknown>;
  }> | null = null;

  return {
    kind: 'smtp',
    async send(message) {
      client ??= import('nodemailer').then((nodemailer) =>
        nodemailer.default.createTransport({
          host,
          port: env.SMTP_PORT,
          // Implicit TLS on 465, STARTTLS upgrade on everything else.
          secure: env.SMTP_SECURE,
          auth: env.SMTP_USER
            ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' }
            : undefined,
        }),
      );

      await (await client).sendMail(message);
    },
  };
}

/**
 * Development delivery: writes the message where the developer already is.
 *
 * The full body is printed, links included, because the point is to be able to
 * complete an activation flow locally without running a mail server. This
 * transport is unreachable in production by configuration, not by convention.
 */
function createConsoleTransport(): MailTransport {
  return {
    kind: 'console',
    async send(message) {
      const banner = '-'.repeat(72);
      process.stderr.write(
        `${banner}\nMAIL (not sent, no SMTP configured)\n` +
          `to:      ${message.to}\n` +
          `from:    ${message.from}\n` +
          `subject: ${message.subject}\n\n` +
          `${message.text}\n${banner}\n`,
      );
    },
  };
}

const outbox: SentMail[] = [];

/** Test delivery: keeps messages in memory for assertions. */
function createMemoryTransport(): MailTransport {
  return {
    kind: 'memory',
    async send(message) {
      outbox.push(message);
    },
  };
}

/**
 * Everything the memory transport has captured, newest last, and clears it.
 * Only ever populated under MAIL_TRANSPORT=memory, which auto-selection picks
 * exclusively for NODE_ENV=test.
 */
export function drainOutbox(): SentMail[] {
  return outbox.splice(0, outbox.length);
}

function createTransport(env: Env): MailTransport {
  const kind = resolveTransportKind(env);

  // Reachable only by setting MAIL_TRANSPORT explicitly, since the automatic
  // choice in production is smtp and env validation refuses to serve without
  // it. Somebody did that deliberately, so this is a warning rather than a
  // refusal, but a production instance that is not delivering mail is one
  // where nobody can finish creating an account.
  if (env.NODE_ENV === 'production' && kind !== 'smtp') {
    process.stderr.write(
      `[mail] WARNING: MAIL_TRANSPORT is "${kind}" in production. ` +
        'No mail will be delivered, so no invitation can be acted on.\n',
    );
  }

  switch (kind) {
    case 'smtp':
      return createSmtpTransport(env);
    case 'memory':
      return createMemoryTransport();
    case 'console':
      return createConsoleTransport();
  }
}

let cached: MailTransport | null = null;

export function getMailTransport(): MailTransport {
  cached ??= createTransport(getEnv());
  return cached;
}

/** Drops a cached transport so a test can change configuration between cases. */
export function resetMailTransport(): void {
  cached = null;
}

/**
 * The default envelope sender.
 *
 * Deliberately one platform address rather than per institute. A tenant cannot
 * be allowed to nominate its own From, because the platform's domain is what
 * passes SPF and DKIM, and letting an institute set that header would either
 * fail delivery or let it send mail that appears to come from another
 * institute. Institute identity lives in the subject and body, and replies go
 * to the institute's own support address (PRD section 9).
 */
function defaultFrom(env: Env): string {
  return env.MAIL_FROM ?? `Lamplight <no-reply@${env.PLATFORM_APEX_DOMAIN}>`;
}

export async function sendMail(message: MailMessage): Promise<void> {
  await getMailTransport().send({ ...message, from: defaultFrom(getEnv()) });
}
