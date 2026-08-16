import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/env';

/**
 * The transport decision is the part worth testing directly.
 *
 * Getting it wrong is quiet in exactly the wrong direction: a production
 * instance that picks the console transport logs activation links to stderr
 * and tells every new user to check an inbox nothing was sent to. So the
 * decision is a pure function over configuration, and this is its table.
 */

const BASE = {
  NODE_ENV: 'development',
  MAIL_TRANSPORT: 'auto',
  SMTP_HOST: undefined,
  PLATFORM_APEX_DOMAIN: 'lamplight.school',
} as unknown as Env;

function env(overrides: Partial<Env>): Env {
  return { ...BASE, ...overrides } as Env;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('mail transport selection', () => {
  it('picks SMTP whenever a host is configured', async () => {
    const { resolveTransportKind } = await import('@/lib/mail');

    expect(resolveTransportKind(env({ SMTP_HOST: 'smtp.example.net' }))).toBe(
      'smtp',
    );
    expect(
      resolveTransportKind(
        env({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example.net' }),
      ),
    ).toBe('smtp');
  });

  it('captures rather than logs under test', async () => {
    const { resolveTransportKind } = await import('@/lib/mail');

    expect(resolveTransportKind(env({ NODE_ENV: 'test' }))).toBe('memory');
  });

  it('logs in development so the flow works with no mail server', async () => {
    const { resolveTransportKind } = await import('@/lib/mail');

    expect(resolveTransportKind(env({}))).toBe('console');
  });

  it('honours an explicit choice over the automatic one', async () => {
    const { resolveTransportKind } = await import('@/lib/mail');

    expect(
      resolveTransportKind(
        env({ MAIL_TRANSPORT: 'memory', SMTP_HOST: 'smtp.example.net' }),
      ),
    ).toBe('memory');
  });
});

describe('the outbox', () => {
  it('captures what was sent and drains once', async () => {
    vi.stubEnv('MAIL_TRANSPORT', 'memory');
    vi.stubEnv('DATABASE_URL', 'postgres://app:pw@localhost:5432/lamplight');
    vi.stubEnv(
      'DATABASE_ADMIN_URL',
      'postgres://admin:pw@localhost:5432/lamplight',
    );

    const { sendMail, drainOutbox } = await import('@/lib/mail');

    await sendMail({
      to: 'student@example.com',
      subject: 'Confirm your address',
      text: 'https://grace.lamplight.school/activate?token=abc',
    });

    const sent = drainOutbox();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('student@example.com');
    // Falls back to a platform address rather than an institute one, because
    // the platform domain is what passes SPF and DKIM.
    expect(sent[0]?.from).toContain('lamplight.school');

    expect(drainOutbox()).toHaveLength(0);
  });
});
