import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl as getAwsSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

let s3Client = null;
let bucketName = null;

export function initStorage() {
  const {
    OBJECT_STORAGE_ENDPOINT,
    OBJECT_STORAGE_BUCKET,
    OBJECT_STORAGE_ACCESS_KEY,
    OBJECT_STORAGE_SECRET_KEY,
    OBJECT_STORAGE_REGION
  } = process.env;

  if (!OBJECT_STORAGE_ENDPOINT || !OBJECT_STORAGE_BUCKET || !OBJECT_STORAGE_ACCESS_KEY || !OBJECT_STORAGE_SECRET_KEY) {
    console.warn('Object storage credentials not fully configured. Storage features will be disabled.');
    return null;
  }

  bucketName = OBJECT_STORAGE_BUCKET;

  s3Client = new S3Client({
    region: OBJECT_STORAGE_REGION || 'auto',
    endpoint: OBJECT_STORAGE_ENDPOINT,
    credentials: {
      accessKeyId: OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: OBJECT_STORAGE_SECRET_KEY,
    },
    // Force path style for S3-compatible APIs like Cloudflare R2 / MinIO
    forcePathStyle: true,
  });

  console.log(`Configured S3-compatible storage with bucket: ${bucketName}`);
  return s3Client;
}

export async function uploadPhoto(roomCode, photoId, buffer) {
  if (!s3Client) return null;
  
  const key = `rooms/${roomCode}/photos/${photoId}.jpg`;
  
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
  });

  await s3Client.send(command);
  return key;
}

export async function uploadStrip(roomCode, stripId, buffer) {
  if (!s3Client) return null;
  
  const key = `rooms/${roomCode}/strips/${stripId}.png`;
  
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
  });

  await s3Client.send(command);
  return key;
}

export async function getSignedUrl(key, expiresInSeconds = 3600) {
  if (!s3Client) return null;
  
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await getAwsSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export async function deleteObject(key) {
  if (!s3Client) return;

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  try {
    await s3Client.send(command);
  } catch (err) {
    console.error(`Failed to delete object ${key}:`, err);
  }
}

export async function deleteRoomObjects(roomCode) {
  if (!s3Client) return;

  const prefix = `rooms/${roomCode}/`;
  
  try {
    let continuationToken = undefined;
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken
      });
      
      const listedObjects = await s3Client.send(listCommand);
      
      if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
        break;
      }
      
      for (const obj of listedObjects.Contents) {
        await deleteObject(obj.Key);
      }
      
      continuationToken = listedObjects.NextContinuationToken;
    } while (continuationToken);
  } catch (err) {
    console.error(`Failed to list/delete objects for room ${roomCode}:`, err);
  }
}
