# Security

## Token Storage (HIGH-5)

### Current Implementation

As of the latest version, Keyway CLI encrypts authentication tokens before storing them on disk using AES-256-GCM encryption.

**How it works:**
- Tokens are encrypted using a key derived from machine-specific data (username) and a random salt
- The salt is stored in the config file but the key is never persisted
- Each encryption uses a random initialization vector (IV) for additional security
- Authentication tags are used to detect tampering

**File permissions:**
- Config file is created with `0o600` permissions (read/write for owner only)
- Location: `~/.config/keyway/config.json` (Linux/macOS) or `%APPDATA%\keyway\config.json` (Windows)

### Security Level

⚠️ **This is obfuscation, not cryptographic security**

The current implementation provides protection against:
- Casual file browsing (tokens aren't in plaintext)
- Accidental token exposure in backups
- Basic file access by other users

It does NOT protect against:
- A determined attacker with access to your user account
- Memory dumps while the CLI is running
- Malware running as your user

### Recommended Improvements

For production use, consider implementing OS-native keychain storage:

**macOS/Linux:**
```bash
# Install keytar or @napi-rs/keyring
npm install keytar
# or
npm install @napi-rs/keyring
```

**Keytar example:**
```typescript
import keytar from 'keytar';

const SERVICE_NAME = 'keyway-cli';
const ACCOUNT_NAME = 'default';

export async function saveAuthToken(token: string) {
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
}

export async function getStoredAuth() {
  const token = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  return token ? { keywayToken: token } : null;
}
```

### Best Practices

1. **Use environment variables for CI/CD:**
   ```bash
   export KEYWAY_TOKEN="your-token-here"
   ```

2. **Rotate tokens regularly** through the GitHub settings

3. **Use fine-grained PATs** with minimal permissions (read-only metadata)

4. **Never commit** the config file to version control

## HTTPS Enforcement (HIGH-6)

### Current Implementation

The CLI now enforces HTTPS for all API connections with the following safeguards:

**Production Protection:**
- HTTPS is required for all non-localhost connections
- Will throw an error if `KEYWAY_API_URL` is set to an insecure HTTP URL
- Validates the protocol on module load

**Development Flexibility:**
- HTTP is allowed only for localhost/127.0.0.1/0.0.0.0
- Shows a warning when using HTTP even for local development
- Warning can be suppressed with `KEYWAY_DISABLE_SECURITY_WARNINGS=1`

### Certificate Verification

Node.js's built-in `fetch` API automatically:
- Validates SSL/TLS certificates
- Checks certificate chains
- Rejects expired or invalid certificates
- Uses the system's certificate store

**No custom certificate pinning is implemented** because:
1. The production API uses standard CA-signed certificates
2. Pinning can break during certificate rotation
3. System certificate stores are regularly updated
4. HTTPS provides sufficient protection for this use case

### Security Guarantees

✅ **Protected against:**
- Man-in-the-middle (MITM) attacks on production API
- Accidental HTTP configuration in production
- Certificate validation bypass

⚠️ **Not protected against:**
- Compromised system certificate store
- Active malware with root/admin access
- DNS hijacking to localhost (development warning still shows)

### Testing HTTPS

To verify HTTPS enforcement:

```bash
# This will fail (non-localhost HTTP):
KEYWAY_API_URL=http://example.com:3000 keyway login

# This will work but warn (localhost HTTP):
KEYWAY_API_URL=http://localhost:3000 keyway login

# This will work silently (HTTPS):
KEYWAY_API_URL=https://api.keyway.sh keyway login
```

## Environment Variables

### Sensitive Variables

- `KEYWAY_TOKEN` - Override stored authentication (use in CI/CD)
- `GITHUB_TOKEN` - Alternative token source (GitHub Actions)

### Configuration Variables

- `KEYWAY_API_URL` - API endpoint (default: `https://api.keyway.sh`)
- `KEYWAY_DISABLE_TELEMETRY` - Disable analytics (set to `1`)
- `KEYWAY_DISABLE_SECURITY_WARNINGS` - Suppress HTTP warnings (development only)

## Reporting Security Issues

If you discover a security vulnerability, please email: security@keyway.sh

**Please do not** open public GitHub issues for security vulnerabilities.

## Security Checklist for Contributors

When modifying security-sensitive code:

- [ ] Never log tokens or secrets
- [ ] Always use HTTPS for production endpoints
- [ ] Validate all user inputs
- [ ] Use constant-time comparisons for secrets
- [ ] Don't disable certificate verification
- [ ] Check file permissions on created files
- [ ] Avoid storing secrets in plaintext
- [ ] Test error paths (don't leak info in errors)
- [ ] Update this document if security model changes

## Future Enhancements

Planned security improvements:

1. **OS Keychain Integration** - Use native credential storage (Keychain, Credential Manager, Secret Service)
2. **Token Scoping** - Request minimal GitHub permissions
3. **Token Expiration** - Automatic renewal and short-lived tokens
4. **Audit Logging** - Track when and where tokens are used
5. **Multi-Factor Auth** - Support FIDO2/WebAuthn for high-security scenarios
