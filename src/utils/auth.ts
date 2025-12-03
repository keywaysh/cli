import Conf from 'conf';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export interface StoredAuth {
  keywayToken: string;
  githubLogin?: string;
  expiresAt?: string;
  createdAt: string;
}

const store = new Conf<{ auth?: string }>({
  projectName: 'keyway',
  configName: 'config',
  fileMode: 0o600,
});

// Security: Store encryption key in a separate file with restricted permissions (0600)
// This is more secure than deriving from $USER which is predictable and guessable.
// The key file is stored in ~/.keyway/.key and is NOT backed up or synced.
// (CRIT-3 fix: Use random key instead of $USER-derived key)
const KEY_DIR = join(homedir(), '.keyway');
const KEY_FILE = join(KEY_DIR, '.key');

function getOrCreateEncryptionKey(): Buffer {
  // Ensure key directory exists with restricted permissions
  if (!existsSync(KEY_DIR)) {
    mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  }

  if (existsSync(KEY_FILE)) {
    // Read existing key
    const keyHex = readFileSync(KEY_FILE, 'utf-8').trim();
    if (keyHex.length === 64) {
      return Buffer.from(keyHex, 'hex');
    }
    // Invalid key format, regenerate
  }

  // Generate new random key (256 bits = 32 bytes)
  const key = randomBytes(32);
  const keyHex = key.toString('hex');

  // Write key with restricted permissions (owner read/write only)
  writeFileSync(KEY_FILE, keyHex, { mode: 0o600 });

  // Ensure permissions are correct (writeFileSync mode may be affected by umask)
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    // Ignore chmod errors on Windows
  }

  return key;
}

function encryptToken(token: string): string {
  const key = getOrCreateEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all hex encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(encryptedData: string): string {
  const key = getOrCreateEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

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
    const decrypted = decryptToken(encryptedData);
    const auth = JSON.parse(decrypted) as StoredAuth;

    if (isExpired(auth)) {
      clearAuth();
      return null;
    }

    return auth;
  } catch {
    // If decryption fails (corrupted data, wrong key, or old format), clear auth
    console.error('Failed to decrypt stored auth, clearing...');
    clearAuth();
    return null;
  }
}

export async function saveAuthToken(
  token: string,
  meta?: { githubLogin?: string; expiresAt?: string }
) {
  const auth: StoredAuth = {
    keywayToken: token,
    githubLogin: meta?.githubLogin,
    expiresAt: meta?.expiresAt,
    createdAt: new Date().toISOString(),
  };

  const encrypted = encryptToken(JSON.stringify(auth));
  store.set('auth', encrypted);
}

export function clearAuth() {
  store.delete('auth');
  // Note: We keep the encryption key for future use
  // Deleting the key would invalidate all stored auth on re-login anyway
}

export function getAuthFilePath(): string {
  return store.path;
}
