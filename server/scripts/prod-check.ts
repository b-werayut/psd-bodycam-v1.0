import 'dotenv/config';
import {
  checkProdEnv,
  summarizeReadiness,
  type ReadinessLevel,
} from '../src/common/config/prod-readiness';

const MARK: Record<ReadinessLevel, string> = {
  pass: ' PASS ',
  warn: ' WARN ',
  fail: ' FAIL ',
};

const ORDER: Record<ReadinessLevel, number> = { fail: 0, warn: 1, pass: 2 };

function main(): void {
  const checks = checkProdEnv(process.env).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const summary = summarizeReadiness(checks);
  const width = Math.max(...checks.map((c) => c.id.length));

  console.log('\nProduction readiness check of the environment');
  console.log(`NODE_ENV = ${process.env.NODE_ENV ?? '(not set)'}`);
  console.log('');

  for (const check of checks) {
    console.log(`[${MARK[check.level]}] ${check.id.padEnd(width)}  ${check.message}`);
  }

  console.log(
    `\nSummary: fail ${summary.fail} · warn ${summary.warn} · pass ${summary.pass}`,
  );

  if (!summary.ok) {
    console.log('\nNot ready for production - fix every item marked "FAIL" first');
    process.exitCode = 1;
    return;
  }

  if (summary.warn > 0) {
    console.log('\nNothing blocks, but read every "WARN" item and decide whether it is acceptable');
  }
}

main();
