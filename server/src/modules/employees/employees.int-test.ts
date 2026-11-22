import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import {
  bearerFor,
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  eventually,
  type HttpContext,
  type TestSql,
} from '../../test/int-helpers';

const PASSWORD = 'Test@12345';
const USER_PREFIX = 't8e_';
const CODE = (n: string) => `T8E_${n}`;

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;
let ids: Map<string, bigint>;
let company: string;

const clean = async () => {
  await sql`delete from "Employees" where "EmployeeCode" like 'T8E\\_%'`;
  await dropTestUsers(sql, [`${USER_PREFIX}%`]);
};

beforeAll(async () => {
  ctx = await bootHttpContext();
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());
});

beforeEach(async () => {
  await clean();
  ids = await createTestUsers(
    sql,
    [
      { username: `${USER_PREFIX}admin`, role: 'ADMIN' },
      { username: `${USER_PREFIX}company`, role: 'COMPANY_ADMIN' },
      { username: `${USER_PREFIX}viewer`, role: 'VIEWER' },
      { username: `${USER_PREFIX}leader`, role: 'OPERATOR' },
    ],
    await hashPassword(PASSWORD),
  );
  company = await bearerFor(http, `${USER_PREFIX}company`, PASSWORD);
});

afterAll(async () => {
  await clean();
  await ctx.close();
});

const create = (body: object, token = company) => http.post('/api/employees').set('Authorization', token).send(body);
const patch = (id: string, body: object, token = company) =>
  http.patch(`/api/employees/${id}`).set('Authorization', token).send(body);

describe('employees CRUD (COMPANY_ADMIN)', () => {
  it('creates an employee and returns the client row shape', async () => {
    const r = await create({
      employeeCode: ` ${CODE('001')} `,
      firstName: 'สมศักดิ์',
      lastName: 'ทดสอบ',
      phone: '0812345678',
      userId: String(ids.get(`${USER_PREFIX}leader`)),
      bookingEmployeeRef: 'T8E-BK-1',
    });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({
      id: expect.any(String),
      employeeCode: CODE('001'),
      firstName: 'สมศักดิ์',
      lastName: 'ทดสอบ',
      phone: '0812345678',
      userId: String(ids.get(`${USER_PREFIX}leader`)),
      bookingEmployeeRef: 'T8E-BK-1',
      status: 1,
    });
  });

  it('lists with the envelope, searches code / names / booking ref and filters by status', async () => {
    await create({ employeeCode: CODE('A'), firstName: 'Alpha', lastName: 'One', bookingEmployeeRef: 'T8E-REF-A' });
    const b = await create({ employeeCode: CODE('B'), firstName: 'Bravo', lastName: 'Two' });
    await patch(b.body.id, { status: 3 });

    const all = await http.get('/api/employees').query({ q: 'T8E_', pageSize: 10 }).set('Authorization', company);
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ page: 1, pageSize: 10, total: 2 });

    for (const q of ['alpha', 'T8E-REF-A', 'one']) {
      const r = await http.get('/api/employees').query({ q }).set('Authorization', company);
      expect(r.body.data.map((e: { employeeCode: string }) => e.employeeCode)).toContain(CODE('A'));
    }
    const resigned = await http.get('/api/employees').query({ q: 'T8E_', status: 3 }).set('Authorization', company);
    expect(resigned.body.data.map((e: { employeeCode: string }) => e.employeeCode)).toEqual([CODE('B')]);
  });

  it('PATCH updates fields, status, and clears links with null', async () => {
    const created = await create({
      employeeCode: CODE('P'),
      firstName: 'a',
      lastName: 'b',
      phone: '1',
      userId: String(ids.get(`${USER_PREFIX}leader`)),
      bookingEmployeeRef: 'T8E-BK-P',
    });
    const r = await patch(created.body.id, { firstName: 'Changed', status: 2, phone: null, userId: null, bookingEmployeeRef: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ firstName: 'Changed', status: 2, phone: null, userId: null, bookingEmployeeRef: null });
    expect((await patch(created.body.id, { status: 4 })).status).toBe(400);
  });

  it('DELETE soft-deletes; the code can be used again', async () => {
    const created = await create({ employeeCode: CODE('D'), firstName: 'a', lastName: 'b' });
    expect((await http.delete(`/api/employees/${created.body.id}`).set('Authorization', company)).status).toBe(204);
    const [row] = await sql`select "IsDeleted" from "Employees" where "Id" = ${created.body.id}`;
    expect(row.IsDeleted).toBe(true);
    const list = await http.get('/api/employees').query({ q: CODE('D') }).set('Authorization', company);
    expect(list.body.total).toBe(0);
    expect((await create({ employeeCode: CODE('D'), firstName: 'again', lastName: 'b' })).status).toBe(201);
    expect((await http.delete(`/api/employees/${created.body.id}`).set('Authorization', company)).status).toBe(404);
  });

  it('writes are audited', async () => {
    const created = await create({ employeeCode: CODE('AU'), firstName: 'a', lastName: 'b' });
    const row = await eventually(async () => {
      const [found] = await sql`select "Action", "Result", "ResourceType" from "AuditLogs"
                                where "Action" = 'CREATE_EMPLOYEE' and "ResourceId" = ${created.body.id}`;
      return found;
    });
    expect(row).toMatchObject({ Result: 1, ResourceType: 'Employees' });
  });
});

describe('uniqueness', () => {
  it('duplicate code ⇒ 409 EMPLOYEE_CODE_TAKEN', async () => {
    await create({ employeeCode: CODE('U1'), firstName: 'a', lastName: 'b' });
    const r = await create({ employeeCode: CODE('U1'), firstName: 'c', lastName: 'd' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('EMPLOYEE_CODE_TAKEN');
  });

  it('duplicate booking ref ⇒ 409 BOOKING_REF_TAKEN (create and update)', async () => {
    await create({ employeeCode: CODE('R1'), firstName: 'a', lastName: 'b', bookingEmployeeRef: 'T8E-DUP' });
    const second = await create({ employeeCode: CODE('R2'), firstName: 'a', lastName: 'b' });
    expect((await create({ employeeCode: CODE('R3'), firstName: 'a', lastName: 'b', bookingEmployeeRef: 'T8E-DUP' })).body.code).toBe(
      'BOOKING_REF_TAKEN',
    );
    expect((await patch(second.body.id, { bookingEmployeeRef: 'T8E-DUP' })).body.code).toBe('BOOKING_REF_TAKEN');
  });

  it('one user account linked to two employees ⇒ 409 USER_ALREADY_LINKED', async () => {
    const userId = String(ids.get(`${USER_PREFIX}leader`));
    await create({ employeeCode: CODE('L1'), firstName: 'a', lastName: 'b', userId });
    const r = await create({ employeeCode: CODE('L2'), firstName: 'a', lastName: 'b', userId });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('USER_ALREADY_LINKED');
  });
});

describe('account links and access', () => {
  it('COMPANY_ADMIN linking an ADMIN account ⇒ 404 (ADMIN accounts are invisible), unknown user ⇒ 404', async () => {
    const admin = await create({
      employeeCode: CODE('X1'),
      firstName: 'a',
      lastName: 'b',
      userId: String(ids.get(`${USER_PREFIX}admin`)),
    });
    expect(admin.status).toBe(404);
    expect(admin.body.code).toBe('NOT_FOUND');
    expect((await create({ employeeCode: CODE('X2'), firstName: 'a', lastName: 'b', userId: '999999999' })).status).toBe(404);
  });

  it('ADMIN may link an ADMIN account', async () => {
    const admin = await bearerFor(http, `${USER_PREFIX}admin`, PASSWORD);
    const r = await create(
      { employeeCode: CODE('X3'), firstName: 'a', lastName: 'b', userId: String(ids.get(`${USER_PREFIX}admin`)) },
      admin,
    );
    expect(r.status).toBe(201);
  });

  it('VIEWER reads (org:read) but cannot write (403)', async () => {
    const viewer = await bearerFor(http, `${USER_PREFIX}viewer`, PASSWORD);
    expect((await http.get('/api/employees').set('Authorization', viewer)).status).toBe(200);
    expect((await create({ employeeCode: CODE('V1'), firstName: 'a', lastName: 'b' }, viewer)).status).toBe(403);
  });

  it('bad body ⇒ 400 VALIDATION_FAILED', async () => {
    expect((await create({ employeeCode: '', firstName: 'a', lastName: 'b' })).body.code).toBe('VALIDATION_FAILED');
    expect((await create({ employeeCode: CODE('V2'), firstName: 'a', lastName: 'b', userId: 'abc' })).status).toBe(400);
  });
});
