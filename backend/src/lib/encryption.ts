import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard IV length

function getEncryptionKey(): Buffer {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey || masterKey.trim() === '') {
    // If not set, generate a fallback key for development but issue a warning
    console.warn('[WARNING] MASTER_ENCRYPTION_KEY env variable is not set. Using dev fallback key. Do NOT use this fallback in production!');
    return crypto.createHash('sha256').update('dev-fallback-secret-key-12345').digest();
  }
  return crypto.createHash('sha256').update(masterKey).digest();
}

/**
 * Encrypts a plaintext string to a colon-separated string: "iv:authTag:ciphertext"
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a colon-separated string: "iv:authTag:ciphertext" back to plaintext
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format. Expected iv:authTag:ciphertext');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2];

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
