import { describe, expect, it } from 'vitest';
import {
  claimableHostname,
  classifyHost,
  isValidSlug,
  normalizeHost,
} from '@/lib/tenancy/host';

/**
 * The Host header is attacker-controlled and is the first thing every request
 * is routed on, so these are the rules the whole platform sits on.
 */

const APEX = 'lamplight.school';

describe('normalizeHost', () => {
  it.each([
    ['grace.lamplight.school', 'grace.lamplight.school'],
    ['GRACE.Lamplight.School', 'grace.lamplight.school'],
    ['grace.lamplight.school:3000', 'grace.lamplight.school'],
    // Fully qualified names may carry a trailing dot. Same host.
    ['grace.lamplight.school.', 'grace.lamplight.school'],
    ['  grace.lamplight.school  ', 'grace.lamplight.school'],
    ['GRACE.Lamplight.School.:443', 'grace.lamplight.school'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  it('keeps an IPv6 literal intact while dropping its port', () => {
    // Stripping at the first colon would truncate the address itself.
    expect(normalizeHost('[::1]:3000')).toBe('[::1]');
  });

  const rejected: [string | null | undefined, string][] = [
    [null, 'null'],
    [undefined, 'undefined'],
    ['', 'empty'],
    [':3000', 'port only'],
    ['grace..school', 'empty label'],
    ['grace lamplight.school', 'whitespace inside'],
    ['grace/../etc', 'path traversal characters'],
    ['grace\nHost: evil.test', 'header injection attempt'],
    ['[not-an-address]', 'malformed bracketed literal'],
  ];

  it.each(rejected)('rejects %j (%s)', (input, _label) => {
    expect(normalizeHost(input)).toBeNull();
  });
});

describe('classifyHost', () => {
  it('treats the apex and its www as the platform, not a tenant', () => {
    expect(classifyHost(APEX, APEX)).toEqual({ kind: 'apex' });
    // Otherwise the marketing site would try to resolve a tenant named "www".
    expect(classifyHost(`www.${APEX}`, APEX)).toEqual({ kind: 'apex' });
  });

  it('reads a single label under the apex as a tenant slug', () => {
    expect(classifyHost(`grace.${APEX}`, APEX)).toEqual({
      kind: 'subdomain',
      slug: 'grace',
    });
  });

  it('does not treat a deeper name under the apex as a tenant', () => {
    expect(classifyHost(`a.b.${APEX}`, APEX)).toEqual({
      kind: 'foreign',
      host: `a.b.${APEX}`,
    });
  });

  it('treats a custom domain as foreign, to be resolved against the database', () => {
    expect(classifyHost('learn.gracebible.test', APEX)).toEqual({
      kind: 'foreign',
      host: 'learn.gracebible.test',
    });
  });

  it('is not fooled by a lookalike suffix', () => {
    // notlamplight.school ends with "lamplight.school" as a string but is a
    // different domain. Matching on the dotted boundary is what prevents an
    // attacker registering evil-lamplight.school and being served a tenant.
    expect(classifyHost('evil-lamplight.school', APEX).kind).toBe('foreign');
    expect(classifyHost('notlamplight.school', APEX).kind).toBe('foreign');
  });
});

describe('isValidSlug', () => {
  it.each(['grace', 'cornerstone', 'a', 'grace-bible', 'inst1'])(
    'accepts %j',
    (slug) => expect(isValidSlug(slug)).toBe(true),
  );

  it.each([
    '-grace',
    'grace-',
    'Grace',
    'gr ace',
    'grace.bible',
    '',
    'a'.repeat(64),
  ])('rejects %j', (slug) => expect(isValidSlug(slug)).toBe(false));
});

describe('claimableHostname', () => {
  it('accepts an ordinary custom domain', () => {
    expect(claimableHostname('learn.institute.edu', APEX)).toEqual({
      ok: true,
      hostname: 'learn.institute.edu',
    });
  });

  it('normalizes before deciding, so case and a trailing dot do not matter', () => {
    expect(claimableHostname('  LEARN.Institute.EDU.  ', APEX)).toEqual({
      ok: true,
      hostname: 'learn.institute.edu',
    });
  });

  it.each([
    ['lamplight.school', 'the apex itself, which is the marketing site'],
    ['www.lamplight.school', 'the apex under its www alias'],
    ['grace.lamplight.school', "another institute's own subdomain"],
    ['anything.lamplight.school', 'an unclaimed subdomain, still not theirs'],
    ['a.b.lamplight.school', 'a deeper name under the apex'],
    ['LAMPLIGHT.SCHOOL', 'the apex in a different case'],
  ])('refuses %s (%s)', (candidate) => {
    // Resolution prefers a verified custom domain over slug parsing, so an
    // institute allowed to claim one of these would be serving its own site at
    // an address that belongs to the platform or to somebody else.
    expect(claimableHostname(candidate, APEX)).toEqual({
      ok: false,
      reason: 'platform',
    });
  });

  it.each([
    ['', 'empty'],
    ['institute', 'a bare label with no dot'],
    ['192.168.1.1', 'an address rather than a name'],
    ['*.institute.edu', 'a wildcard'],
    ['institute.edu:8443', 'a port'],
    ['https://institute.edu', 'a whole URL'],
    ['institute.edu/path', 'a path'],
    ['-bad.institute.edu', 'a label starting with a hyphen'],
    ['institute..edu', 'an empty label'],
  ])('refuses %s (%s) as malformed', (candidate) => {
    expect(claimableHostname(candidate, APEX).ok).toBe(false);
  });

  it('does not confuse a lookalike of the apex for the apex', () => {
    // evil-lamplight.school is a different registrable domain and somebody may
    // legitimately own it. Refusing it here would be wrong, and resolution
    // already treats it as foreign rather than as a subdomain.
    expect(claimableHostname('evil-lamplight.school', APEX).ok).toBe(true);
  });
});
