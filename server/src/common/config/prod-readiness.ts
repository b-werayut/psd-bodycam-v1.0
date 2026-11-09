import { resolveTrustProxy } from './trust-proxy';
import {
  REFRESH_TTL_ENV_DEVICE,
  REFRESH_TTL_ENV_WEB,
  resolveRefreshTtl,
} from './refresh-ttl';

export type ReadinessLevel = 'pass' | 'warn' | 'fail';

export type ReadinessCheck = {
  id: string;
  level: ReadinessLevel;
  message: string;
};

const MIN_SECRET_LENGTH = 32;

const has = (value: string | undefined): boolean => (value ?? '').trim().length > 0;

function checkCors(env: NodeJS.ProcessEnv): ReadinessCheck {
  const raw = (env.CORS_ORIGINS ?? '').trim();
  if (!raw) {
    return {
      id: 'CORS_ORIGINS',
      level: 'fail',
      message: 'ไม่ได้ตั้ง — ระบบจะใช้ค่า dev (localhost) แล้วหน้าเว็บจริงเรียก API ไม่ได้',
    };
  }
  if (raw.split(',').some((o) => o.trim() === '*')) {
    return {
      id: 'CORS_ORIGINS',
      level: 'fail',
      message: 'ห้ามใช้ `*` — refresh token เป็น httpOnly cookie ที่ต้อง credentials:true ซึ่งใช้กับ wildcard ไม่ได้',
    };
  }
  const insecure = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.startsWith('http://') && !o.includes('localhost') && !o.includes('127.0.0.1'));
  if (insecure.length > 0) {
    return {
      id: 'CORS_ORIGINS',
      level: 'warn',
      message: `origin ที่ยังเป็น http: ${insecure.join(', ')} — ไม่มี HTTPS browser จะบล็อก navigator.geolocation ทั้งระบบ (check-in ไม่มีพิกัด)`,
    };
  }
  return { id: 'CORS_ORIGINS', level: 'pass', message: raw };
}

function checkCookieSameSite(env: NodeJS.ProcessEnv): ReadinessCheck {
  const raw = (env.COOKIE_SAMESITE ?? '').trim().toLowerCase();

  if (raw && !['lax', 'none', 'strict'].includes(raw)) {
    return {
      id: 'COOKIE_SAMESITE',
      level: 'fail',
      message: `ค่า '${raw}' ใช้ไม่ได้ — รับเฉพาะ lax | none | strict (ระบบจะถอยไป lax ซึ่งอาจไม่ใช่ที่ต้องการ)`,
    };
  }

  if (raw === 'none') {
    return {
      id: 'COOKIE_SAMESITE',
      level: 'warn',
      message:
        "none = cookie กลายเป็น third-party · Safari บล็อกโดยค่าเริ่มต้นและ Chrome กำลังเลิกรองรับ — iPhone คือเครื่องหลักของช่างหน้างาน ถ้าย้ายหน้าเว็บกับ API มาไว้ใต้โดเมนแม่เดียวกันได้ ให้ใช้ lax แทน",
    };
  }

  if (raw === 'strict') {
    return {
      id: 'COOKIE_SAMESITE',
      level: 'warn',
      message: 'strict ทำให้ cookie ไม่ถูกส่งเมื่อผู้ใช้เข้าจากลิงก์ภายนอก (รวมลิงก์ในอีเมลแจ้งเตือน)',
    };
  }

  return {
    id: 'COOKIE_SAMESITE',
    level: 'pass',
    message: 'lax — ใช้ได้ทั้ง origin เดียวกันและ subdomain พี่น้องใต้โดเมนแม่เดียวกัน',
  };
}

function checkTrustProxy(env: NodeJS.ProcessEnv): ReadinessCheck {
  const { value, error } = resolveTrustProxy(env);
  if (error) return { id: 'TRUST_PROXY', level: 'fail', message: error };
  if (value === false) {
    return {
      id: 'TRUST_PROXY',
      level: 'warn',
      message:
        'ปิดการเชื่อ proxy ไว้ — ถูกเฉพาะเมื่อ Node รับคำขอจากอินเทอร์เน็ตตรง ๆ · มี nginx คั่นแล้ว req.ip จะเป็น IP ของ proxy ทุกคำขอ (AuditLogs.IpAddress ซ้ำกันหมด + โควตาต่อ IP กลายเป็นของทุกคนรวมกัน)',
    };
  }
  return {
    id: 'TRUST_PROXY',
    level: 'pass',
    message: `${Array.isArray(value) ? value.join(', ') : value} — ต้องตรงกับจำนวนชั้น proxy จริง`,
  };
}

const WEB_REFRESH_TTL_WARN_HOURS = 24;

function checkRefreshTtl(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const { webHours, deviceHours, warnings } = resolveRefreshTtl(env);
  const checks: ReadinessCheck[] = [];

  if (warnings.length) {
    checks.push({ id: REFRESH_TTL_ENV_WEB, level: 'warn', message: warnings.join(' · ') });
  } else if (webHours > WEB_REFRESH_TTL_WARN_HOURS) {
    checks.push({
      id: REFRESH_TTL_ENV_WEB,
      level: 'warn',
      message: `${webHours} ชม. — ค่านี้คุม session ของ "เว็บ" ซึ่งไม่มีทะเบียนเครื่องให้เพิกถอนรายเครื่อง (ทางเดียวคือรีเซ็ตรหัสผ่านซึ่งเตะทุกเครื่องของคนนั้น) · เครื่องที่ใช้ร่วมกันจะค้างล็อกอินอยู่นานเท่านี้ · ถ้าต้องการให้แอปมือถืออยู่ยาว ให้ตั้ง ${REFRESH_TTL_ENV_DEVICE} แทน`,
    });
  } else {
    checks.push({
      id: REFRESH_TTL_ENV_WEB,
      level: 'pass',
      message: `${webHours} ชม. (เว็บ — cookie และแถวใน RefreshTokens ใช้ค่าเดียวกัน)`,
    });
  }

  checks.push({
    id: REFRESH_TTL_ENV_DEVICE,
    level: 'pass',
    message:
      deviceHours === webHours
        ? `ไม่ได้ตั้ง — แอปมือถือใช้ค่าเดียวกับเว็บ (${webHours} ชม.) · ปิดแอปข้ามคืนแล้วต้องล็อกอินใหม่`
        : `${deviceHours} ชม. — ใช้เฉพาะ session ที่ลงทะเบียนเครื่องแล้ว (เพิกถอนรายเครื่องได้ที่หน้า /users)`,
  });

  return checks;
}

function checkAzureAd(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const passwordOn = (env.AUTH_PASSWORD_LOGIN_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  const tenant = (env.AZURE_AD_TENANT_ID ?? '').trim();
  const client = (env.AZURE_AD_CLIENT_ID ?? '').trim();

  if (!tenant && !client) {
    return [
      {
        id: 'AZURE_AD_*',
        level: passwordOn ? 'warn' : 'fail',
        message: passwordOn
          ? 'ยังไม่ได้ตั้ง — ปุ่มเข้าสู่ระบบด้วยบัญชีองค์กรจะไม่แสดง เหลือแต่ชื่อผู้ใช้+รหัสผ่าน'
          : 'ไม่ได้ตั้ง SSO และปิด login ด้วยรหัสผ่านไว้ด้วย — จะไม่มีทางเข้าระบบเลย',
      },
    ];
  }
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const bad = [
    !tenant ? 'AZURE_AD_TENANT_ID (ไม่ได้ตั้ง)' : null,
    !client ? 'AZURE_AD_CLIENT_ID (ไม่ได้ตั้ง)' : null,
    tenant && !guid.test(tenant) ? 'AZURE_AD_TENANT_ID (ไม่ใช่ GUID)' : null,
    client && !guid.test(client) ? 'AZURE_AD_CLIENT_ID (ไม่ใช่ GUID)' : null,
  ].filter(Boolean);

  if (bad.length > 0) {
    return [{ id: 'AZURE_AD_*', level: 'fail', message: `ตั้งค่าไม่ถูกต้อง: ${bad.join(', ')}` }];
  }
  return [{ id: 'AZURE_AD_*', level: 'pass', message: `tenant ${tenant}` }];
}

export function checkProdEnv(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  checks.push(
    env.NODE_ENV === 'production'
      ? { id: 'NODE_ENV', level: 'pass', message: 'production' }
      : {
          id: 'NODE_ENV',
          level: 'warn',
          message: `ยังเป็น '${env.NODE_ENV ?? '(ไม่ได้ตั้ง)'}' — ตั้งเป็น production เพื่อปิด verbose log และให้ Nest ใช้โหมด production`,
        },
  );

  checks.push(
    has(env.DATABASE_URL)
      ? { id: 'DATABASE_URL', level: 'pass', message: 'ตั้งแล้ว' }
      : { id: 'DATABASE_URL', level: 'fail', message: 'ไม่ได้ตั้ง — โปรเซสจะ boot ไม่ขึ้น' },
  );

  const jwt = (env.JWT_ACCESS_SECRET ?? '').trim();
  if (!jwt) {
    checks.push({ id: 'JWT_ACCESS_SECRET', level: 'fail', message: 'ไม่ได้ตั้ง' });
  } else if (jwt.length < MIN_SECRET_LENGTH) {
    checks.push({
      id: 'JWT_ACCESS_SECRET',
      level: 'fail',
      message: `ยาว ${jwt.length} ตัว — ควรอย่างน้อย ${MIN_SECRET_LENGTH} ตัวที่สุ่มมา`,
    });
  } else {
    checks.push({ id: 'JWT_ACCESS_SECRET', level: 'pass', message: `${jwt.length} ตัวอักษร` });
  }

  checks.push(checkCors(env));

  checks.push(
    env.COOKIE_SECURE === 'true'
      ? { id: 'COOKIE_SECURE', level: 'pass', message: 'true' }
      : {
          id: 'COOKIE_SECURE',
          level: 'fail',
          message: 'ต้องเป็น true บน HTTPS — ไม่งั้น refresh cookie ถูกส่งผ่าน http ได้',
        },
  );

  checks.push(checkCookieSameSite(env));
  checks.push(checkTrustProxy(env));
  checks.push(...checkRefreshTtl(env));

  checks.push(
    has(env.REDIS_URL)
      ? { id: 'REDIS_URL', level: 'pass', message: 'ตั้งแล้ว' }
      : {
          id: 'REDIS_URL',
          level: 'fail',
          message: 'ไม่ได้ตั้ง — พิกัด/alert จาก worker ลง DB ครบแต่ไม่เด้งถึงหน้าจอ และงาน export ค้าง Queued ถาวร',
        },
  );

  checks.push(...checkAzureAd(env));
  if (has(env.SEED_DEMO_PASSWORD)) {
    checks.push({
      id: 'SEED_DEMO_PASSWORD',
      level: 'fail',
      message: 'production ต้องไม่ตั้งค่านี้ — เป็นรหัสของบัญชี demo ที่ใช้เฉพาะ db:seed (dev)',
    });
  }

  return checks;
}

export function summarizeReadiness(checks: ReadinessCheck[]): {
  ok: boolean;
  fail: number;
  warn: number;
  pass: number;
} {
  const count = (level: ReadinessLevel) => checks.filter((c) => c.level === level).length;
  const fail = count('fail');
  return { ok: fail === 0, fail, warn: count('warn'), pass: count('pass') };
}
