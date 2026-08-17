import { describe, expect, it } from 'vitest';
import {
  AUDIO_TYPES,
  checkUpload,
  formatBytes,
  MAX_UPLOAD_BYTES,
  readDuration,
} from '@/lib/media/uploads';

/**
 * What an institute may upload.
 *
 * These run twice in production: once in the browser so somebody who picked
 * the wrong file is told before sending 400 MB, and once on the server, which
 * is the one that counts. The browser copy is a convenience and the server
 * copy is the control, and they are the same function so they cannot drift.
 */

describe('what is accepted', () => {
  it('takes the formats a lecture actually arrives in', () => {
    for (const contentType of AUDIO_TYPES) {
      expect(checkUpload({ contentType, byteSize: 5_000_000 }).ok).toBe(true);
    }
  });

  it('ignores the parameters a browser tacks on', () => {
    // Safari and some Windows browsers send a charset on audio types.
    const result = checkUpload({
      contentType: 'audio/mpeg; charset=binary',
      byteSize: 1_000,
    });

    expect(result.ok).toBe(true);
    // Normalised, because this exact string is what gets signed into the PUT
    // and then sent as a header. A mismatch is a signature failure that reads
    // like a permissions problem.
    expect(result.ok && result.contentType).toBe('audio/mpeg');
  });
});

describe('what is refused', () => {
  it('refuses a type that is not audio at all', () => {
    // The content type is signed into the upload and served back on download,
    // so it decides what a browser does with the bytes later.
    for (const contentType of [
      'text/html',
      'image/svg+xml',
      'application/pdf',
      'video/mp4',
    ]) {
      expect(checkUpload({ contentType, byteSize: 1_000 }).ok).toBe(false);
    }
  });

  it('refuses a file the browser could not identify', () => {
    const result = checkUpload({ contentType: '', byteSize: 1_000 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('mp3');
  });

  it('refuses an empty file', () => {
    expect(checkUpload({ contentType: 'audio/mpeg', byteSize: 0 }).ok).toBe(
      false,
    );
  });

  it('refuses one that is too big, and says how big', () => {
    const result = checkUpload({
      contentType: 'audio/mpeg',
      byteSize: MAX_UPLOAD_BYTES + 1,
    });

    expect(result.ok).toBe(false);
    // The message names both numbers, because "too large" without a limit is
    // an instruction to guess.
    expect(result.ok === false && result.message).toContain('512 MB');
  });

  it('accepts one right at the limit', () => {
    expect(
      checkUpload({ contentType: 'audio/mpeg', byteSize: MAX_UPLOAD_BYTES }).ok,
    ).toBe(true);
  });
});

describe('sizes people read', () => {
  it('picks a unit that suits the number', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(18_400_000)).toBe('18 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

describe('duration reported by a browser', () => {
  it('takes a real number of seconds', () => {
    expect(readDuration(1802.6)).toBe(1803);
  });

  it('refuses what a media element reports when it does not know', () => {
    // Infinity for a stream, NaN before metadata, 0 for a file it could not
    // decode. All of them mean "we do not know", which is what the column
    // already says for every lesson nobody has measured.
    for (const value of [Number.NaN, Infinity, 0, -5, '1800', null]) {
      expect(readDuration(value)).toBeNull();
    }
  });
});
