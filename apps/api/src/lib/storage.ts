/**
 * Servicio de almacenamiento S3-compatible (MinIO en dev, R2/S3 en prod).
 * Genera URLs firmadas para subida y gestiona la eliminación de objetos.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";

let _s3: S3Client | null = null;

export function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return _s3;
}

/**
 * Genera una URL firmada para subir un archivo al bucket.
 * El cliente hace PUT directamente a esta URL.
 */
export async function generatePresignedUploadUrl(
  objectKey: string,
  mime: string,
  sizeBytes: number,
  expiresIn = 3600,
): Promise<{ url: string; headers: Record<string, string> }> {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: objectKey,
    ContentType: mime,
    ContentLength: sizeBytes,
  });

  const url = await getSignedUrl(getS3(), command, { expiresIn });

  return {
    url,
    headers: {
      "Content-Type": mime,
    },
  };
}

/**
 * Elimina un objeto del bucket.
 */
export async function deleteObject(objectKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: objectKey,
  });
  await getS3().send(command);
}

/**
 * Obtiene un objeto del bucket como Buffer.
 */
export async function getObjectBuffer(objectKey: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: objectKey,
  });
  const response = await getS3().send(command);
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Object not found: ${objectKey}`);
  return Buffer.from(bytes);
}

/**
 * Genera una clave única para un objeto en el bucket.
 * Formato: {prefix}/{userId}/{date}/{uuid}.{ext}
 */
export function generateObjectKey(
  userId: string,
  prefix: "meals" | "coach" | "corrections" | "avatars",
  ext: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const uuid = crypto.randomUUID();
  return `${prefix}/${userId}/${date}/${uuid}.${ext}`;
}

/**
 * Mapea MIME type a extensión de archivo.
 */
export function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
  };
  return map[mime] ?? "bin";
}
