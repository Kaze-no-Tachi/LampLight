import { signObjectWrite, storageConfigured } from '@/lib/storage';

/**
 * Puts real audio behind the seeded lesson resources (task 50).
 *
 * WHY THIS EXISTS
 *
 * The fixture used to write lesson_resources rows pointing at object keys that
 * had never been uploaded. Every test passed, because a row is a row, and the
 * player was inert against seeded data: press play, nothing happens, and the
 * site reads as broken rather than as one recording being missing. A player
 * cannot be developed, let alone demonstrated, against silence.
 *
 * WHAT IT UPLOADS
 *
 * A generated tone, ninety seconds long, a different pitch per lesson so it is
 * audible which one is playing. Ninety seconds because the resume rule ignores
 * anything under fifteen seconds in and anything within fifteen seconds of the
 * end, so a shorter file cannot demonstrate resuming at all.
 *
 * It uploads through signObjectWrite, the same presigned path an instructor's
 * upload will use, so seeding exercises the real signing and key rules rather
 * than reaching around them with an admin client.
 *
 * Skipped entirely when storage is not configured, which is how CI runs. A
 * fixture that needed a bucket would make the test suite depend on one.
 */

const SAMPLE_RATE = 8_000;
const SECONDS = 90;

/**
 * A WAV file, built by hand.
 *
 * WAV rather than MP3 because a correct MP3 encoder is a dependency and a
 * correct WAV is a 44 byte header and some samples. Every browser plays it.
 */
function tone(hz: number): Buffer {
  const samples = SAMPLE_RATE * SECONDS;
  const data = Buffer.alloc(samples * 2);

  for (let index = 0; index < samples; index += 1) {
    const t = index / SAMPLE_RATE;
    // Quiet, and faded at both ends, because a full-amplitude square-edged
    // tone through headphones is genuinely unpleasant.
    const fade = Math.min(1, t / 2, (SECONDS - t) / 2);
    const value = Math.sin(2 * Math.PI * hz * t) * 0.15 * fade;
    data.writeInt16LE(Math.round(value * 32_767), index * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM header size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

export type SeedObject = {
  tenantId: string;
  key: string;
  /** Varied per lesson so the recordings are distinguishable by ear. */
  pitchHz: number;
};

/** Uploads every seeded recording, or reports why it did not. */
export async function uploadSeedMedia(objects: SeedObject[]): Promise<string> {
  if (!storageConfigured()) {
    return 'storage not configured, so no audio was uploaded';
  }

  let uploaded = 0;

  for (const object of objects) {
    const signed = await signObjectWrite(
      object.tenantId,
      object.key,
      'audio/wav',
    );

    const response = await fetch(signed.url, {
      method: 'PUT',
      // The content type has to match what was signed, or the signature is
      // for a different request and the bucket refuses it.
      headers: { 'content-type': 'audio/wav' },
      body: new Uint8Array(tone(object.pitchHz)),
    });

    if (!response.ok) {
      throw new Error(
        `upload failed for ${object.key}: ${response.status} ${await response.text()}`,
      );
    }
    uploaded += 1;
  }

  return `uploaded ${uploaded} recordings`;
}
