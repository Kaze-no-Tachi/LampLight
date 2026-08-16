import { getEnv, requireEnv } from '@/env';
import { keyBelongsToTenant } from './keys';

/**
 * Signed object access (PRD section 5.5, requirement P0-9).
 *
 * Nothing in the bucket is public. Lesson media is reachable only through a
 * short-lived signed URL, and a URL is only issued after the access predicate
 * has said yes. This module does the signing and nothing else: it has no
 * opinion about who may listen to what, and deliberately no access to the
 * tables that would let it form one.
 *
 * WHAT IT DOES ENFORCE, EVERY TIME
 *
 * That the key belongs to the institute the request resolved to. The callers
 * build keys with buildObjectKey and should never produce a wrong one, and
 * this checks anyway, because the day a caller is wrong is the day one
 * institute's lecture is served on another's domain. A key that does not
 * belong is refused, never rewritten.
 *
 * The transport is injectable for the same reason as the Cloudflare client:
 * the logic worth testing is the refusal, and proving it should not require a
 * bucket, credentials, or a network.
 */

export type SignedUrl = {
  readonly url: string;
  readonly expiresAt: Date;
};

export type SignRequest = {
  readonly key: string;
  readonly expiresInSeconds: number;
  /** Only set for uploads, where the client must not be free to send anything. */
  readonly contentType?: string;
};

/** Signs a request against the bucket. Anything shaped like this will do. */
export type StorageSigner = {
  signGet(request: SignRequest): Promise<string>;
  signPut(request: SignRequest): Promise<string>;
};

export class StorageAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageAccessError';
  }
}

/**
 * Issues a URL for reading an object, if it belongs to this institute.
 *
 * The TTL is short by configuration (SIGNED_URL_TTL_SECONDS, five minutes by
 * default) because a signed URL is a bearer token: whoever holds it can fetch
 * the object, and nothing about it can be revoked once issued. Short enough
 * that a leaked link is stale before it travels, long enough that an audio
 * player can start a lecture.
 */
export async function signObjectRead(
  tenantId: string,
  key: string,
  signer: StorageSigner | null = null,
): Promise<SignedUrl> {
  assertKeyBelongs(tenantId, key);

  const ttl = getEnv().SIGNED_URL_TTL_SECONDS;
  const url = await (signer ?? createSigner()).signGet({
    key,
    expiresInSeconds: ttl,
  });

  return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
}

/**
 * Issues a URL for writing an object.
 *
 * The key is built server-side by the caller and checked here. A presigned PUT
 * whose key came from the client is an arbitrary write into the bucket, which
 * on a shared bucket means an arbitrary write into somebody else's institute.
 *
 * The content type is part of what gets signed, so a caller that asked to
 * upload audio cannot use the same URL to upload something else. That matters
 * because these objects are later served back to browsers.
 */
export async function signObjectWrite(
  tenantId: string,
  key: string,
  contentType: string,
  signer: StorageSigner | null = null,
): Promise<SignedUrl> {
  assertKeyBelongs(tenantId, key);

  // Uploads get a longer window than reads, because a slow connection posting
  // a lecture recording is an ordinary situation and a failed upload halfway
  // through is expensive for the person doing it.
  const ttl = 15 * 60;
  const url = await (signer ?? createSigner()).signPut({
    key,
    expiresInSeconds: ttl,
    contentType,
  });

  return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
}

function assertKeyBelongs(tenantId: string, key: string): void {
  if (!keyBelongsToTenant(key, tenantId)) {
    // The message is for the log, not for a response. Callers turn this into
    // the same 404 everything else denies with.
    throw new StorageAccessError(
      `refusing to sign a key outside the institute prefix: ${key}`,
    );
  }
}

/** Whether object storage is configured at all. */
export function storageConfigured(): boolean {
  const env = getEnv();
  return Boolean(
    env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
  );
}

let cached: StorageSigner | null = null;

/**
 * The real signer, built lazily.
 *
 * The AWS SDK is imported dynamically so a request that never signs anything
 * does not load it, and so tests and the development server do not pay for a
 * dependency they replace anyway.
 */
export function createSigner(): StorageSigner {
  if (cached) return cached;

  const env = getEnv();
  const bucket = requireEnv('S3_BUCKET');

  const client = import('@aws-sdk/client-s3').then(
    ({ S3Client }) =>
      new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        // Minio addresses buckets by path. R2 does not, and setting this
        // against R2 produces URLs that 404 in a way that looks like a
        // permissions problem.
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
          secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
        },
      }),
  );

  cached = {
    async signGet(request) {
      const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
        import('@aws-sdk/client-s3'),
        import('@aws-sdk/s3-request-presigner'),
      ]);

      return getSignedUrl(
        await client,
        new GetObjectCommand({ Bucket: bucket, Key: request.key }),
        { expiresIn: request.expiresInSeconds },
      );
    },

    async signPut(request) {
      const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([
        import('@aws-sdk/client-s3'),
        import('@aws-sdk/s3-request-presigner'),
      ]);

      return getSignedUrl(
        await client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: request.key,
          ContentType: request.contentType,
        }),
        { expiresIn: request.expiresInSeconds },
      );
    },
  };

  return cached;
}

/** Drops the cached signer so a test can change configuration between cases. */
export function resetSigner(): void {
  cached = null;
}
