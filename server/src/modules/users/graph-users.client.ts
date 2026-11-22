import { setTimeout as delay } from 'node:timers/promises';
import type { EntraUser } from './entra-user-sync.plan';

export type DomainField = 'userPrincipalName' | 'mail';

export type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  allowedDomains: string[];
  domainField: DomainField;
  includeAll: boolean;
};

export class GraphConfigError extends Error {}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readGraphConfig(env: NodeJS.ProcessEnv): GraphConfig {
  const tenantId = (env.GRAPH_TENANT_ID || env.AZURE_AD_TENANT_ID || '').trim();
  const clientId = (env.GRAPH_CLIENT_ID || '').trim();
  const clientSecret = (env.GRAPH_CLIENT_SECRET || '').trim();

  const missing = [
    !tenantId ? 'GRAPH_TENANT_ID (หรือ AZURE_AD_TENANT_ID)' : null,
    !clientId ? 'GRAPH_CLIENT_ID' : null,
    !clientSecret ? 'GRAPH_CLIENT_SECRET' : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new GraphConfigError(`ยังไม่ได้ตั้ง: ${missing.join(', ')}`);
  }
  if (!GUID.test(tenantId) || !GUID.test(clientId)) {
    throw new GraphConfigError('GRAPH_TENANT_ID / GRAPH_CLIENT_ID ต้องเป็น GUID');
  }
  if (clientId === (env.AZURE_AD_CLIENT_ID || '').trim()) {
    throw new GraphConfigError(
      'GRAPH_CLIENT_ID ซ้ำกับ AZURE_AD_CLIENT_ID — ต้องใช้ App registration คนละตัวกับที่ใช้ทำ SSO',
    );
  }
  const domainSource = (env.GRAPH_ALLOWED_DOMAINS ?? env.AZURE_AD_ALLOWED_EMAIL_DOMAINS ?? '')
    .trim();

  return {
    tenantId,
    clientId,
    clientSecret,
    allowedDomains: domainSource
      .split(',')
      .map((d) => d.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
    domainField:
      (env.GRAPH_DOMAIN_FIELD ?? '').trim().toLowerCase() === 'mail' ? 'mail' : 'userPrincipalName',
    includeAll: (env.GRAPH_INCLUDE_ALL ?? '').trim().toLowerCase() === 'true',
  };
}

const odataString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export type UsersQueryFilter = {
  filter: string | null;
  advanced: boolean;
};

export function usersFilter(
  includeAll: boolean,
  allowedDomains: string[] = [],
  domainField: DomainField = 'userPrincipalName',
): UsersQueryFilter {
  if (includeAll) return { filter: null, advanced: false };

  const base = "accountEnabled eq true and userType eq 'Member'";
  if (allowedDomains.length === 0) return { filter: base, advanced: false };

  const domains = allowedDomains
    .map((domain) => `endsWith(${domainField},${odataString(`@${domain}`)})`)
    .join(' or ');
  return { filter: `${base} and (${domains})`, advanced: true };
}

export function keepAllowedDomains(users: EntraUser[], domains: string[]): EntraUser[] {
  if (domains.length === 0) return users;
  return users.filter((user) => {
    const upn = user.userPrincipalName.toLowerCase();
    const at = upn.lastIndexOf('@');
    return at >= 0 && domains.includes(upn.slice(at + 1));
  });
}

const LOGIN_BASE = 'https://login.microsoftonline.com';
const GRAPH_BASE = 'https://graph.microsoft.com';

async function getAppToken(
  config: GraphConfig,
  timeoutMs: number,
  loginBase: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(
    `${loginBase}/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`ขอ token จาก Microsoft ไม่สำเร็จ (${res.status}): ${json.error_description ?? ''}`);
  }
  return json.access_token;
}

export const GRAPH_SELECT_FIELDS = [
  'id',
  'userPrincipalName',
  'displayName',
  'mail',
  'mobilePhone',
  'accountEnabled',
  'userType',
  'givenName',
  'surname',
  'businessPhones',
  'jobTitle',
  'department',
  'companyName',
  'officeLocation',
  'employeeId',
  'employeeType',
  'onPremisesSamAccountName',
  'createdDateTime',
] as const;

const SELECT = GRAPH_SELECT_FIELDS.join(',');

type GraphPage = { value: unknown[]; '@odata.nextLink'?: string };

export function parseGraphUser(raw: unknown): EntraUser | null {
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const upn = typeof row.userPrincipalName === 'string' ? row.userPrincipalName : '';
  if (!id || !upn) return null;
  const str = (key: string): string | null =>
    typeof row[key] === 'string' && (row[key] as string).trim() ? (row[key] as string) : null;
  const list = (key: string): string[] =>
    Array.isArray(row[key])
      ? (row[key] as unknown[]).filter(
          (value): value is string => typeof value === 'string' && value.trim() !== '',
        )
      : [];
  return {
    id,
    userPrincipalName: upn,
    displayName: str('displayName'),
    mail: str('mail'),
    mobilePhone: str('mobilePhone'),
    accountEnabled: typeof row.accountEnabled === 'boolean' ? row.accountEnabled : null,
    userType: str('userType'),
    givenName: str('givenName'),
    surname: str('surname'),
    businessPhones: list('businessPhones'),
    jobTitle: str('jobTitle'),
    department: str('department'),
    companyName: str('companyName'),
    officeLocation: str('officeLocation'),
    employeeId: str('employeeId'),
    employeeType: str('employeeType'),
    onPremisesSamAccountName: str('onPremisesSamAccountName'),
    createdDateTime: str('createdDateTime'),
  };
}

export type FetchOptions = {
  timeoutMs?: number;
  maxPages?: number;
  onPage?: (count: number, total: number) => void;
  loginBaseUrl?: string;
  graphBaseUrl?: string;
};

export type FetchResult = {
  users: EntraUser[];
  fetched: number;
  droppedByDomain: number;
  filteredAtGraph: boolean;
  domainFilteredAtGraph: boolean;
  domainField: DomainField;
};

export async function fetchEntraUsers(
  config: GraphConfig,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxPages = options.maxPages ?? 100;
  const token = await getAppToken(config, timeoutMs, options.loginBaseUrl ?? LOGIN_BASE);

  const users: EntraUser[] = [];
  const { filter, advanced } = usersFilter(
    config.includeAll,
    config.allowedDomains,
    config.domainField,
  );
  let url: string | undefined =
    `${options.graphBaseUrl ?? GRAPH_BASE}/v1.0/users?$select=${SELECT}&$top=999` +
    (filter ? `&$filter=${encodeURIComponent(filter)}` : '') +
    (advanced ? '&$count=true' : '');

  for (let page = 0; url && page < maxPages; page += 1) {
    const res: Response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(advanced ? { ConsistencyLevel: 'eventual' } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? '5');
      await delay(Math.min(Math.max(wait, 1), 60) * 1000);
      page -= 1;
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Graph ตอบ ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as GraphPage;
    for (const raw of json.value ?? []) {
      const user = parseGraphUser(raw);
      if (user) users.push(user);
    }
    options.onPage?.(json.value?.length ?? 0, users.length);
    url = json['@odata.nextLink'];
  }

  const kept = advanced ? users : keepAllowedDomains(users, config.allowedDomains);
  return {
    users: kept,
    fetched: users.length,
    droppedByDomain: users.length - kept.length,
    filteredAtGraph: filter !== null,
    domainFilteredAtGraph: advanced,
    domainField: config.domainField,
  };
}
