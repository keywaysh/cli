import pc from 'picocolors';
import { runAllChecks, DoctorSummary } from '../core/doctor.js';
import { trackEvent, AnalyticsEvents } from '../utils/analytics.js';
import { truncateMessage } from '../utils/api.js';

interface DoctorOptions {
  json?: boolean;
  strict?: boolean;
}

function formatSummary(results: DoctorSummary) {
  const parts = [
    pc.green(`${results.summary.pass} passed`),
    results.summary.warn > 0 ? pc.yellow(`${results.summary.warn} warnings`) : null,
    results.summary.fail > 0 ? pc.red(`${results.summary.fail} failed`) : null,
  ].filter(Boolean);
  return parts.join(', ');
}

export async function doctorCommand(options: DoctorOptions = {}) {
  try {
    const results = await runAllChecks({ strict: !!options.strict });

    trackEvent(AnalyticsEvents.CLI_DOCTOR, {
      pass: results.summary.pass,
      warn: results.summary.warn,
      fail: results.summary.fail,
      strict: !!options.strict,
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(results, null, 0) + '\n');
      process.exit(results.exitCode);
    }

    console.log(pc.cyan('\n🔍 Keyway Doctor - Environment Check\n'));

    results.checks.forEach((check) => {
      const icon =
        check.status === 'pass'
          ? pc.green('✓')
          : check.status === 'warn'
            ? pc.yellow('!')
            : pc.red('✗');
      const detail = check.detail ? pc.dim(` — ${check.detail}`) : '';
      console.log(`  ${icon} ${check.name}${detail}`);
    });

    console.log(`\nSummary: ${formatSummary(results)}`);

    if (results.summary.fail > 0) {
      console.log(pc.red('⚠ Some checks failed. Please resolve the issues above before using Keyway.'));
    } else if (results.summary.warn > 0) {
      console.log(pc.yellow('⚠ Some warnings detected. Keyway should work but consider addressing them.'));
    } else {
      console.log(pc.green('✨ All checks passed! Your environment is ready for Keyway.'));
    }

    process.exit(results.exitCode);
  } catch (error) {
    const message = error instanceof Error ? truncateMessage(error.message) : 'Doctor failed';
    trackEvent(AnalyticsEvents.CLI_DOCTOR, {
      pass: 0,
      warn: 0,
      fail: 1,
      strict: !!options.strict,
      error: 'doctor_failed',
    });

    if (options.json) {
      const errorResult = {
        checks: [],
        summary: { pass: 0, warn: 0, fail: 1 },
        exitCode: 1,
        error: message,
      };
      process.stdout.write(JSON.stringify(errorResult, null, 0) + '\n');
    } else {
      console.error(pc.red(`\n✗ ${message}`));
    }
    process.exit(1);
  }
}
