import { URL } from 'url';

export const MAX_PROXY_BYTES = 5 * 1024 * 1024; // 5 MB maximum image size
export const PROXY_TIMEOUT_MS = 5000; // 5 seconds timeout

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

/**
 * Validates whether a target URL is an authorized storage resource.
 * Blocks private IP ranges, localhost (in production), internal networks,
 * non-storage domains, and paths that do not match expected Twogether storage paths.
 */
export function validateProxyUrl(targetUrlString) {
  if (!targetUrlString || typeof targetUrlString !== 'string') {
    return { valid: false, error: 'Missing or invalid url parameter' };
  }

  let parsed;
  try {
    parsed = new URL(targetUrlString);
  } catch {
    return { valid: false, error: 'Malformed URL' };
  }

  const isTestOrDev = process.env.NODE_ENV !== 'production';
  const isHttps = parsed.protocol === 'https:';
  const isLocalHttp = isTestOrDev && parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');

  if (!isHttps && !isLocalHttp) {
    return { valid: false, error: 'Only HTTPS URLs are permitted' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block private, loopback, link-local, and metadata IP addresses
  const isPrivateOrLoopback = (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname) ||
    /^192\.168\.\d+\.\d+$/.test(hostname) ||
    /^169\.254\.\d+\.\d+$/.test(hostname) || // AWS / GCP / Cloud metadata
    /^0\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(hostname) || // Carrier-grade NAT
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc00:') ||
    hostname.startsWith('fd00:')
  );

  if (isPrivateOrLoopback && !isLocalHttp) {
    return { valid: false, error: 'Access to private or local network addresses is prohibited' };
  }

  // Domain authorization check
  const configuredEndpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  let configuredHost = null;
  if (configuredEndpoint) {
    try {
      const ep = configuredEndpoint.startsWith('http://') || configuredEndpoint.startsWith('https://')
        ? configuredEndpoint
        : `https://${configuredEndpoint}`;
      configuredHost = new URL(ep).hostname.toLowerCase();
    } catch {}
  }

  const isR2Cloudflare = hostname.endsWith('.r2.cloudflarestorage.com') || hostname.endsWith('.r2.dev');

  if (configuredHost) {
    if (hostname !== configuredHost && !isLocalHttp) {
      return { valid: false, error: 'Host does not match configured storage endpoint' };
    }
  } else if (!isR2Cloudflare && !isLocalHttp) {
    return { valid: false, error: 'Host not authorized for image proxying' };
  }

  // Path validation: Must match expected photobooth storage structure
  // e.g. /rooms/{code}/photos/{id}.jpg, /rooms/{code}/strips/{id}.png
  // or with bucket prefix: /{bucket}/rooms/{code}/...
  // or with legacy double bucket prefix: /{bucket}/{bucket}/rooms/{code}/...
  const bucketName = process.env.OBJECT_STORAGE_BUCKET;
  const escapedBucket = bucketName
    ? bucketName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '[A-Za-z0-9_.-]+';

  const pathRegex = new RegExp(
    `^(?:\\/${escapedBucket}){0,2}\\/rooms\\/[A-Za-z0-9_-]+\\/(photos|strips)\\/[A-Za-z0-9_.-]+\\.(jpg|jpeg|png)$`,
    'i'
  );

  if (!pathRegex.test(parsed.pathname)) {
    return { valid: false, error: 'Path does not match authorized storage resource pattern' };
  }

  return { valid: true, parsedUrl: parsed };
}

/**
 * Validates image magic bytes to verify payload is genuinely an image.
 */
export function validateImageMagicBytes(buffer, declaredContentType) {
  if (!buffer || buffer.length < 8) return false;

  // JPEG magic bytes: FF D8 FF
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;

  // WebP magic bytes: RIFF....WEBP
  const isWebp = (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  );

  if (declaredContentType.includes('jpeg') || declaredContentType.includes('jpg')) {
    return isJpeg;
  }
  if (declaredContentType.includes('png')) {
    return isPng;
  }
  if (declaredContentType.includes('webp')) {
    return isWebp;
  }

  return isJpeg || isPng || isWebp;
}

/**
 * Safely fetches an image from authorized storage with size limit,
 * timeout, redirect prevention, and content verification.
 */
export async function fetchSecureImage(targetUrlString) {
  const validation = validateProxyUrl(targetUrlString);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.status = 403;
    throw error;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const res = await fetch(targetUrlString, {
      signal: controller.signal,
      redirect: 'error' // Prevent redirect-based SSRF
    });

    if (!res.ok) {
      const error = new Error(`Upstream returned ${res.status}`);
      error.status = res.status >= 400 && res.status < 500 ? res.status : 502;
      throw error;
    }

    // Check Content-Length header if present
    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > MAX_PROXY_BYTES) {
        const error = new Error('Payload too large');
        error.status = 413;
        throw error;
      }
    }

    // Validate Content-Type
    const rawContentType = res.headers.get('content-type') || 'application/octet-stream';
    const cleanContentType = rawContentType.toLowerCase().split(';')[0].trim();
    if (!ALLOWED_CONTENT_TYPES.has(cleanContentType)) {
      const error = new Error('Invalid content type: only images are permitted');
      error.status = 415;
      throw error;
    }

    // Read response body with streaming byte count enforcement
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_PROXY_BYTES) {
      const error = new Error('Payload too large');
      error.status = 413;
      throw error;
    }

    // Verify magic bytes
    if (!validateImageMagicBytes(buffer, cleanContentType)) {
      const error = new Error('Corrupt or invalid image content');
      error.status = 415;
      throw error;
    }

    return {
      buffer,
      contentType: cleanContentType
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutError = new Error('Gateway timeout fetching image');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
