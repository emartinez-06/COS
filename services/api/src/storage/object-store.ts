/**
 * Object storage for uploaded document files.
 *
 * Only `file` documents reach this module. Authored text lives in Postgres as
 * revisions, so a club that never uploads anything never touches object
 * storage at all - which is what lets a self-hoster run this product with
 * nothing but a database if that is all they want.
 *
 * The interface is deliberately narrow: put, get, delete, by key. Everything
 * S3-specific stays behind it, so swapping the backend is a change to this
 * file. MinIO in development and R2 or AWS in production run the *same* code
 * path, which is why there is no filesystem driver here - a driver used only
 * in development is a driver whose bugs are found only in production.
 */

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {env} from '../env.js';

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

const client = new S3Client({
  region: env.STORAGE_REGION,
  // Empty endpoint means real AWS S3, which is addressed by region.
  ...(env.STORAGE_ENDPOINT ? {endpoint: env.STORAGE_ENDPOINT} : {}),
  forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  },
});

/**
 * Creates the bucket if it is missing, at most once per process.
 *
 * Done lazily on first use rather than at startup so the API still boots and
 * serves the calendar, the roster, and every text document when object storage
 * is unreachable. Only uploads fail, and they fail with a real error rather
 * than taking the whole service down with them.
 *
 * The promise is cached rather than the boolean, so concurrent first uploads
 * wait on one check instead of racing to create the same bucket. A failure
 * clears the cache so the next request retries rather than inheriting a
 * permanent failure - the same "a failure is a pause, not a halt" rule the
 * event subscription learned the hard way.
 */
let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await client.send(new HeadBucketCommand({Bucket: env.STORAGE_BUCKET}));
    } catch {
      // Missing, or we may not head it. Try to create; if it already exists
      // (another process won the race) that is success, not failure.
      try {
        await client.send(
          new CreateBucketCommand({Bucket: env.STORAGE_BUCKET}),
        );
      } catch (error) {
        const name = (error as {name?: string}).name ?? '';
        if (
          name !== 'BucketAlreadyOwnedByYou' &&
          name !== 'BucketAlreadyExists'
        ) {
          throw error;
        }
      }
    }
  })().catch((error: unknown) => {
    bucketReady = null;
    throw error;
  });

  return bucketReady;
}

/**
 * The storage key for one revision of a document's file.
 *
 * Namespaced by club so that a bucket listing is legible and a per-club
 * lifecycle rule or export is a prefix operation. The document id is already
 * unique, so the club prefix is for humans and tooling rather than for
 * collision avoidance.
 *
 * **Keyed by version**, which is what makes uploads append-only: replacing a
 * file writes new bytes at a new key instead of overwriting the old ones, so
 * an earlier revision stays downloadable and a failed upload cannot destroy
 * the file it was meant to replace.
 *
 * The uploaded filename is deliberately **not** part of the key. It arrives
 * from a browser, it can contain anything including `../`, and it is stored as
 * metadata in Postgres where it is data rather than a path.
 */
export function documentStorageKey(
  clubId: string,
  documentId: string,
  version: number,
): string {
  return `clubs/${clubId}/documents/${documentId}/v${version}`;
}

export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  await client.send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

/** Returns null when the key does not exist. */
export async function getObject(key: string): Promise<StoredObject | null> {
  await ensureBucket();
  try {
    const result = await client.send(
      new GetObjectCommand({Bucket: env.STORAGE_BUCKET, Key: key}),
    );
    if (!result.Body) {
      return null;
    }
    return {
      bytes: await result.Body.transformToByteArray(),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    if ((error as {name?: string}).name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

/**
 * Removes an object. Missing keys are not an error.
 *
 * Nothing in the request path calls this: deleting a document is a soft delete
 * in Postgres, and replacing a file writes a new versioned key rather than
 * overwriting the old one. It exists for the eventual purge job that hard
 * deletes a club's data on request, which is the only operation entitled to
 * destroy bytes.
 */
export async function deleteObject(key: string): Promise<void> {
  await ensureBucket();
  await client.send(
    new DeleteObjectCommand({Bucket: env.STORAGE_BUCKET, Key: key}),
  );
}
