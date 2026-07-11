import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { env } from '../../config/index.js';
import { NotFoundError } from '../../core/errors/index.js';
import type { StorageProvider } from './StorageProvider.js';

/** Cloudflare R2 via the S3 API (also works against plain S3 endpoints). */
export class R2Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor() {
    // env.superRefine guarantees these when STORAGE_DRIVER is r2/s3.
    const accountId = env.R2_ACCOUNT_ID ?? '';
    this.bucket = env.R2_BUCKET ?? '';
    this.publicBaseUrl = (env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  async put(key: string, data: Buffer | Readable, contentType: string): Promise<void> {
    // lib-storage handles both buffers and unknown-length streams (multipart).
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: data, ContentType: contentType },
    });
    await upload.done();
  }

  async getStream(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new NotFoundError(`Object ${key}`);
      return res.Body as Readable;
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      throw new NotFoundError(`Object ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => typeof k === 'string');
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
