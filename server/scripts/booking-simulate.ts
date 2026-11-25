import 'dotenv/config';
import { readBookingInboundConfig } from '../src/modules/booking-integration/inbound/booking-inbound.config';
import { signBody } from '../src/modules/booking-integration/inbound/inbound-auth';
import { buildScenario, SIM_DEFAULTS, SIM_SCENARIOS, type SimScenario } from '../src/modules/booking-integration/simulator/scenarios';

const USAGE = `Usage: npm run booking:simulate -- <scenario> [--job <jobId>] [--camera <ref>] [--team <ref>] [--leader <ref>] [--url <baseUrl>] [--count <n>] [--dry-run]
Scenarios: ${SIM_SCENARIOS.join(' | ')}
Defaults: camera ${SIM_DEFAULTS.camera}, team ${SIM_DEFAULTS.team}, leader ${SIM_DEFAULTS.leader}, count ${SIM_DEFAULTS.count}, url http://localhost:3000`;

function parseArgs(argv: string[]): { scenario: SimScenario; flags: Map<string, string>; dryRun: boolean } {
  const flags = new Map<string, string>();
  let scenario: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--')) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      flags.set(a.slice(2), v);
    } else if (!scenario) scenario = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!scenario || !(SIM_SCENARIOS as readonly string[]).includes(scenario)) {
    throw new Error(`scenario must be one of: ${SIM_SCENARIOS.join(', ')}`);
  }
  return { scenario: scenario as SimScenario, flags, dryRun };
}

async function main(): Promise<void> {
  const { scenario, flags, dryRun } = parseArgs(process.argv.slice(2));
  const count = Number(flags.get('count') ?? SIM_DEFAULTS.count);
  if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive integer');
  const opts = {
    jobId: flags.get('job'),
    camera: flags.get('camera') ?? SIM_DEFAULTS.camera,
    team: flags.get('team') ?? SIM_DEFAULTS.team,
    leader: flags.get('leader') ?? SIM_DEFAULTS.leader,
    count,
  };
  const url = `${(flags.get('url') ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/integration/booking/jobs`;

  const cfg = readBookingInboundConfig(process.env);
  const secret = cfg.secrets[0];
  if (!secret) throw new Error('BOOKING_INBOUND_SECRETS is empty in server/.env (the simulator signs with the first secret)');

  const requests = buildScenario(scenario, opts, new Date());
  console.log(`${scenario}: ${requests.length} request(s) -> ${url}${dryRun ? ' (dry run, nothing sent)' : ''}`);

  for (const [i, { envelope, corruptSignature }] of requests.entries()) {
    const rawBody = JSON.stringify(envelope);
    const timestamp = String(Math.floor(Date.now() / 1000));
    let signature = signBody(secret, timestamp, rawBody);
    if (corruptSignature) signature = `sha256=${'0'.repeat(64)}`;
    const headers: Record<string, string> =
      cfg.auth === 'api-key'
        ? { 'content-type': 'application/json', 'x-api-key': secret }
        : { 'content-type': 'application/json', 'x-booking-timestamp': timestamp, 'x-booking-signature': signature };
    const label = `[${i + 1}/${requests.length}] job ${envelope.job.jobId} v${envelope.job.version} ${envelope.job.status}`;

    if (dryRun) {
      const shown = { ...headers };
      if (shown['x-api-key']) shown['x-api-key'] = '<hidden>';
      console.log(`${label}\n  POST ${url}\n  headers ${JSON.stringify(shown)}\n  body ${rawBody}`);
      continue;
    }
    try {
      const res = await fetch(url, { method: 'POST', headers, body: rawBody });
      console.log(`${label} -> ${res.status} ${await res.text()}`);
    } catch (e) {
      throw new Error(`cannot reach ${url} (${e instanceof Error ? e.message : String(e)}) - is the api running?`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  console.error(USAGE);
  process.exit(1);
});
