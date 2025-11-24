import Conf from 'conf';

export interface StoredAuth {
  keywayToken: string;
  githubLogin?: string;
  expiresAt?: string;
  createdAt: string;
}

const store = new Conf<{ auth?: StoredAuth }>({
  projectName: 'keyway',
  configName: 'config',
  fileMode: 0o600,
});

function isExpired(auth: StoredAuth): boolean {
  if (!auth.expiresAt) return false;
  const expires = Date.parse(auth.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires <= Date.now();
}

export function getStoredAuth(): StoredAuth | null {
  const auth = store.get('auth');
  if (auth && isExpired(auth)) {
    clearAuth();
    return null;
  }
  return auth ?? null;
}

export function saveAuthToken(token: string, meta?: { githubLogin?: string; expiresAt?: string }) {
  const auth: StoredAuth = {
    keywayToken: token,
    githubLogin: meta?.githubLogin,
    expiresAt: meta?.expiresAt,
    createdAt: new Date().toISOString(),
  };
  store.set('auth', auth);
}

export function clearAuth() {
  store.delete('auth');
}

export function getAuthFilePath(): string {
  return store.path;
}
