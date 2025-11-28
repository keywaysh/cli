import Conf from 'conf';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

export interface StoredAuth {
  keywayToken: string;
  githubLogin?: string;
  expiresAt?: string;
  createdAt: string;
}

const store = new Conf<{ auth?: string; salt?: string }>({
  projectName: 'keyway',
  configName: 'config',
  fileMode: 0o600,
});

// WARNING: Token encryption key derived from machine-specific data
// This provides basic obfuscation but is NOT cryptographically secure storage.
// For production use, consider using OS-native keychain (keytar package).
// See: https://github.com/atom/node-keytar
const scryptAsync = promisify(scrypt);

async function getEncryptionKey(): Promise<Buffer> {
  // Use machine-specific data to derive encryption key
  const machineId = process.env.USER || process.env.USERNAME || 'keyway-user';
  let salt = store.get('salt');

  if (!salt) {
    salt = randomBytes(16).toString('hex');
    store.set('salt', salt);
  }

  const key = await scryptAsync(machineId, salt, 32) as Buffer;
  return key;
}

async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all hex encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function decryptToken(encryptedData: string): Promise<string> {
  const key = await getEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

function isExpired(auth: StoredAuth): boolean {
  if (!auth.expiresAt) return false;
  const expires = Date.parse(auth.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires <= Date.now();
}

export async function getStoredAuth(): Promise<StoredAuth | null> {
  const encryptedData = store.get('auth');
  if (!encryptedData) {
    return null;
  }

  try {
    const decrypted = await decryptToken(encryptedData);
    const auth = JSON.parse(decrypted) as StoredAuth;

    if (isExpired(auth)) {
      clearAuth();
      return null;
    }

    return auth;
  } catch (error) {
    // If decryption fails (corrupted data or wrong key), clear auth
    console.error('Failed to decrypt stored auth, clearing...');
    clearAuth();
    return null;
  }
}

export async function saveAuthToken(token: string, meta?: { githubLogin?: string; expiresAt?: string }) {
  const auth: StoredAuth = {
    keywayToken: token,
    githubLogin: meta?.githubLogin,
    expiresAt: meta?.expiresAt,
    createdAt: new Date().toISOString(),
  };

  const encrypted = await encryptToken(JSON.stringify(auth));
  store.set('auth', encrypted);
}

export function clearAuth() {
  store.delete('auth');
  // Keep salt for future encryption
}

export function getAuthFilePath(): string {
  return store.path;
}
