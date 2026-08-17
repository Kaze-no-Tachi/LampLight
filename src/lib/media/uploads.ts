/**
 * What an institute is allowed to upload.
 *
 * Pure, so the rules can be tested exhaustively without a bucket, and in one
 * place, so the answer does not depend on which screen asked.
 *
 * WHY A CONTENT TYPE ALLOW-LIST
 *
 * The content type is signed into the presigned PUT and the bucket serves it
 * back on download, so it decides what a browser does with the bytes later. A
 * file uploaded as text/html and served from the media host is a page running
 * on that host. The objects are on a separate origin and behind signed URLs,
 * which makes that hard to exploit, and an allow-list makes it moot.
 *
 * The list is what a bible institute actually records lectures as. It is not
 * exhaustive on purpose: a type nobody uses is a type nobody has tested the
 * player against.
 */

export const AUDIO_TYPES = [
  'audio/mpeg', // mp3, which is what almost everything exports
  'audio/mp4', // m4a from a phone or a Mac
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
] as const;

/**
 * Half a gigabyte, which is several hours of speech at any sane bitrate.
 *
 * A limit exists because there is no other backstop: the upload goes straight
 * to the bucket, so the application never sees the bytes and cannot stop a
 * mistake halfway. Somebody dragging in a video by accident is the ordinary
 * case this catches.
 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export type UploadCheck =
  { ok: true; contentType: string } | { ok: false; message: string };

/**
 * Whether this file may be uploaded, with a reason a person can act on.
 *
 * The declared size is checked here and the real size is checked again after
 * the upload, against the bucket, because this number comes from the browser.
 */
export function checkUpload(params: {
  contentType: string;
  byteSize: number;
}): UploadCheck {
  // Browsers send "audio/mpeg" but also sometimes "audio/mpeg; charset=..."
  // and, on Windows for an unfamiliar extension, an empty string.
  const type = params.contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (!type) {
    return {
      ok: false,
      message:
        'Your browser did not say what kind of file that is. Try an mp3 or m4a.',
    };
  }

  if (!(AUDIO_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      message: `${type} is not a kind of audio this accepts. Use mp3, m4a, wav, or ogg.`,
    };
  }

  if (!Number.isFinite(params.byteSize) || params.byteSize <= 0) {
    return { ok: false, message: 'That file appears to be empty.' };
  }

  if (params.byteSize > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `That file is ${formatBytes(params.byteSize)}. The limit is ${formatBytes(
        MAX_UPLOAD_BYTES,
      )}.`,
    };
  }

  return { ok: true, contentType: type };
}

/** For messages people read, so binary units are not worth the pedantry. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * A duration reported by a browser, or null.
 *
 * Read from a media element before upload, so it is Infinity for a stream, NaN
 * before metadata loads, and absent entirely if the browser could not decode
 * the file. Any of those means "we do not know", which is what the column
 * already holds for every lesson nobody has measured.
 */
export function readDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}
