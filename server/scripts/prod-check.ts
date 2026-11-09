import 'dotenv/config';
import {
  checkProdEnv,
  summarizeReadiness,
  type ReadinessLevel,
} from '../src/common/config/prod-readiness';

const MARK: Record<ReadinessLevel, string> = {
  pass: '  ผ่าน ',
  warn: ' เตือน ',
  fail: 'ต้องแก้',
};

const ORDER: Record<ReadinessLevel, number> = { fail: 0, warn: 1, pass: 2 };

function main(): void {
  const checks = checkProdEnv(process.env).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const summary = summarizeReadiness(checks);
  const width = Math.max(...checks.map((c) => c.id.length));

  console.log('\nตรวจความพร้อมของ env ก่อนขึ้น production');
  console.log(`NODE_ENV = ${process.env.NODE_ENV ?? '(ไม่ได้ตั้ง)'}`);
  console.log('');

  for (const check of checks) {
    console.log(`[${MARK[check.level]}] ${check.id.padEnd(width)}  ${check.message}`);
  }

  console.log(
    `\nสรุป: ต้องแก้ ${summary.fail} · เตือน ${summary.warn} · ผ่าน ${summary.pass}`,
  );

  if (!summary.ok) {
    console.log('\nยังขึ้น production ไม่ได้ — แก้ข้อที่ขึ้นว่า "ต้องแก้" ให้ครบก่อน');
    process.exitCode = 1;
    return;
  }

  if (summary.warn > 0) {
    console.log('\nไม่มีข้อที่บล็อก แต่ข้อที่ "เตือน" ต้องอ่านและตัดสินใจว่ายอมรับได้');
  }
}

main();
