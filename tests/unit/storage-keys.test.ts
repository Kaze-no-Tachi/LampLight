import { describe, expect, it } from 'vitest';
import {
  buildObjectKey,
  keyBelongsToTenant,
  sanitizeFilename,
  tenantPrefix,
} from '@/lib/storage/keys';

/**
 * The prefix is the isolation boundary in object storage, and unlike Postgres
 * there is no second layer beneath it. A wrong prefix is a wrong object, with
 * nothing to catch it, so these are exhaustive in a way the database tests do
 * not need to be.
 */

const GRACE = '11111111-1111-4111-8111-111111111111';
const CORNERSTONE = '22222222-2222-4222-8222-222222222222';

describe('building a key', () => {
  it('puts it under the institute prefix', () => {
    const key = buildObjectKey({
      tenantId: GRACE,
      purpose: 'lesson',
      objectId: 'abc',
      filename: 'lecture-one.mp3',
    });

    expect(key).toBe(`t/${GRACE}/lesson/abc/lecture-one.mp3`);
    expect(keyBelongsToTenant(key, GRACE)).toBe(true);
    expect(keyBelongsToTenant(key, CORNERSTONE)).toBe(false);
  });

  it('cannot be talked out of the prefix by the filename', () => {
    // The filename arrives from an upload form, so it is attacker controlled.
    for (const filename of [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      `/t/${CORNERSTONE}/lesson/steal.mp3`,
      '....//....//escape.mp3',
    ]) {
      const key = buildObjectKey({
        tenantId: GRACE,
        purpose: 'lesson',
        objectId: 'abc',
        filename,
      });

      expect(keyBelongsToTenant(key, GRACE), filename).toBe(true);
      expect(keyBelongsToTenant(key, CORNERSTONE), filename).toBe(false);
      expect(key.includes('..'), filename).toBe(false);
    }
  });
});

describe('verifying a key', () => {
  it('refuses another institute key', () => {
    expect(
      keyBelongsToTenant(`t/${CORNERSTONE}/lesson/abc/audio.mp3`, GRACE),
    ).toBe(false);
  });

  it('refuses a key that merely starts with the same characters', () => {
    // This is why the prefix carries its trailing slash. Without it, `t/abc`
    // is a prefix of `t/abcdef`, and one institute could read another whose id
    // happens to extend theirs.
    expect(keyBelongsToTenant('t/abcdef/lesson/x/a.mp3', 'abc')).toBe(false);
    expect(tenantPrefix('abc').endsWith('/')).toBe(true);
  });

  it('refuses traversal rather than resolving it', () => {
    // A key containing .. may mean something different to the storage provider
    // than it does to us. The safest reading of an ambiguous key is no.
    expect(
      keyBelongsToTenant(`t/${GRACE}/lesson/../../${CORNERSTONE}/x.mp3`, GRACE),
    ).toBe(false);
  });

  it('refuses an absolute key and an empty one', () => {
    expect(keyBelongsToTenant(`/t/${GRACE}/lesson/a.mp3`, GRACE)).toBe(false);
    expect(keyBelongsToTenant('', GRACE)).toBe(false);
  });
});

describe('sanitising a filename', () => {
  it('keeps something readable', () => {
    expect(sanitizeFilename('Lecture 01 - Genesis.mp3')).toBe(
      'Lecture-01-Genesis.mp3',
    );
  });

  it('never returns an empty name', () => {
    // An empty segment would make the key end in a slash, which is a prefix
    // rather than an object.
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('...')).toBe('file');
    expect(sanitizeFilename('///')).toBe('file');
  });

  it('bounds the length', () => {
    expect(sanitizeFilename(`${'a'.repeat(500)}.mp3`).length).toBeLessThan(130);
  });
});
