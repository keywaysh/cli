import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INTERNAL_API_URL } from '../config/internal.js';

const API_HEALTH_URL = `${process.env.KEYWAY_API_URL || INTERNAL_API_URL}/`;

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface DoctorSummary {
  checks: CheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  exitCode: number;
}

// Node version check
export async function checkNode(): Promise<CheckResult> {
  const nodeVersion = process.versions.node;
  const [major] = nodeVersion.split('.').map(Number);
  
  if (major >= 18) {
    return {
      id: 'node',
      name: 'Node.js version',
      status: 'pass',
      detail: `v${nodeVersion} (>=18.0.0 required)`
    };
  }
  
  return {
    id: 'node',
    name: 'Node.js version',
    status: 'fail',
    detail: `v${nodeVersion} (<18.0.0, please upgrade)`
  };
}

// Git check
export async function checkGit(): Promise<CheckResult> {
  try {
    const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
    
    try {
      execSync('git rev-parse --is-inside-work-tree', { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      return {
        id: 'git',
        name: 'Git repository',
        status: 'pass',
        detail: `${gitVersion} - inside repository`
      };
    } catch {
      return {
        id: 'git',
        name: 'Git repository',
        status: 'warn',
        detail: `${gitVersion} - not in a repository`
      };
    }
  } catch {
    return {
      id: 'git',
      name: 'Git repository',
      status: 'warn',
      detail: 'Git not installed'
    };
  }
}

// Network access check
export async function checkNetwork(): Promise<CheckResult> {
  const fetchFn = globalThis.fetch;
  if (!fetchFn) {
    return {
      id: 'network',
      name: 'API connectivity',
      status: 'warn',
      detail: 'Fetch API not available in this Node.js runtime'
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetchFn(API_HEALTH_URL, {
      method: 'HEAD',
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (response.ok || response.status < 500) {
      return {
        id: 'network',
        name: 'API connectivity',
        status: 'pass',
        detail: `Connected to ${API_HEALTH_URL}`
      };
    }
    
    return {
      id: 'network',
      name: 'API connectivity',
      status: 'warn',
      detail: `Server returned ${response.status}`
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return {
        id: 'network',
        name: 'API connectivity',
        status: 'warn',
        detail: 'Connection timeout (>2s)'
      };
    }
    
    if (error.code === 'ENOTFOUND') {
      return {
        id: 'network',
        name: 'API connectivity',
        status: 'fail',
        detail: 'DNS resolution failed'
      };
    }
    
    if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      return {
        id: 'network',
        name: 'API connectivity',
        status: 'fail',
        detail: 'SSL certificate error'
      };
    }
    
    return {
      id: 'network',
      name: 'API connectivity',
      status: 'warn',
      detail: error.message || 'Connection failed'
    };
  }
}

// File system write permissions check
export async function checkFileSystem(): Promise<CheckResult> {
  const testFile = join(tmpdir(), `.keyway-test-${Date.now()}.tmp`);
  
  try {
    writeFileSync(testFile, 'test');
    unlinkSync(testFile);
    
    return {
      id: 'filesystem',
      name: 'File system permissions',
      status: 'pass',
      detail: 'Write permissions verified'
    };
  } catch (error: any) {
    return {
      id: 'filesystem',
      name: 'File system permissions',
      status: 'fail',
      detail: `Cannot write to temp directory: ${error.message}`
    };
  }
}

// .gitignore check for env patterns
export async function checkGitignore(): Promise<CheckResult> {
  try {
    if (!existsSync('.gitignore')) {
      return {
        id: 'gitignore',
        name: '.gitignore configuration',
        status: 'warn',
        detail: 'No .gitignore file found'
      };
    }
    
    const gitignoreContent = readFileSync('.gitignore', 'utf-8');
    const hasEnvPattern = gitignoreContent.includes('*.env') || gitignoreContent.includes('.env*');
    const hasDotEnv = gitignoreContent.includes('.env');
    
    if (hasEnvPattern || hasDotEnv) {
      return {
        id: 'gitignore',
        name: '.gitignore configuration',
        status: 'pass',
        detail: 'Environment files are ignored'
      };
    }
    
    return {
      id: 'gitignore',
      name: '.gitignore configuration',
      status: 'warn',
      detail: 'Missing .env patterns in .gitignore'
    };
  } catch {
    return {
      id: 'gitignore',
      name: '.gitignore configuration',
      status: 'warn',
      detail: 'Could not read .gitignore'
    };
  }
}

// System clock check
export async function checkSystemClock(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch('https://api.keyway.sh/', {
      method: 'HEAD',
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    const serverDate = response.headers.get('date');
    if (!serverDate) {
      return {
        id: 'clock',
        name: 'System clock',
        status: 'pass',
        detail: 'Unable to verify (no server date)'
      };
    }
    
    const serverTime = new Date(serverDate).getTime();
    const localTime = Date.now();
    const diffMinutes = Math.abs(serverTime - localTime) / 1000 / 60;
    
    if (diffMinutes < 5) {
      return {
        id: 'clock',
        name: 'System clock',
        status: 'pass',
        detail: `Synchronized (drift: ${Math.round(diffMinutes * 60)}s)`
      };
    }
    
    return {
      id: 'clock',
      name: 'System clock',
      status: 'warn',
      detail: `Clock drift: ${Math.round(diffMinutes)} minutes`
    };
  } catch {
    return {
      id: 'clock',
      name: 'System clock',
      status: 'pass',
      detail: 'Unable to verify'
    };
  }
}

// Run all checks
export async function runAllChecks(options: { strict?: boolean } = {}): Promise<DoctorSummary> {
  const checks = await Promise.all([
    checkNode(),
    checkGit(),
    checkNetwork(),
    checkFileSystem(),
    checkGitignore(),
    checkSystemClock()
  ]);
  
  // Apply strict mode if requested
  if (options.strict) {
    checks.forEach(check => {
      if (check.status === 'warn') {
        check.status = 'fail';
      }
    });
  }
  
  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length
  };
  
  const exitCode = summary.fail > 0 ? 1 : 0;
  
  return {
    checks,
    summary,
    exitCode
  };
}
