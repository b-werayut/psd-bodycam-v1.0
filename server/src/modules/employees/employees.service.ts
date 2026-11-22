import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, ne, or, type SQL } from 'drizzle-orm';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app-exception';
import { likePattern } from '../../common/http/page-query.dto';
import { paged, type Paged } from '../../common/http/paged';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Employees, Roles, Users } from '../../db/schema';
import { canSeeUser } from '../users/admin-protection';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { QueryEmployeesDto } from './dto/query-employees.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EMPLOYEE_STATUS, toEmployeeRow, type EmployeeRowView } from './employees.mapper';

const UNIQUE_CODES: Record<string, [string, string]> = {
  UQ_Employees_Code: ['EMPLOYEE_CODE_TAKEN', 'รหัสพนักงานนี้ถูกใช้แล้ว'],
  UQ_Employees_BookingRef: ['BOOKING_REF_TAKEN', 'รหัสอ้างอิง Booking นี้ผูกกับพนักงานคนอื่นแล้ว'],
  UQ_Employees_User: ['USER_ALREADY_LINKED', 'บัญชีผู้ใช้นี้ผูกกับพนักงานคนอื่นแล้ว'],
};

@Injectable()
export class EmployeesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async list(q: QueryEmployeesDto): Promise<Paged<EmployeeRowView>> {
    const where = and(...filters(q));
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(Employees)
        .where(where)
        .orderBy(asc(Employees.EmployeeCode))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(Employees).where(where),
    ]);
    return paged(rows.map(toEmployeeRow), Number(total), q.page, q.pageSize);
  }

  async create(actor: AuthUser, dto: CreateEmployeeDto): Promise<EmployeeRowView> {
    const userId = dto.userId ? await this.linkableUser(actor, BigInt(dto.userId)) : null;
    await this.assertAvailable({ code: dto.employeeCode, bookingRef: dto.bookingEmployeeRef, userId });
    const [row] = await this.db
      .insert(Employees)
      .values({
        EmployeeCode: dto.employeeCode,
        FirstName: dto.firstName,
        LastName: dto.lastName,
        Phone: dto.phone ?? null,
        UserId: userId,
        BookingEmployeeRef: dto.bookingEmployeeRef ?? null,
        Status: EMPLOYEE_STATUS.ACTIVE,
        CreatedBy: actor.id,
        UpdatedBy: actor.id,
      })
      .returning()
      .catch(rethrowUnique);
    return toEmployeeRow(row);
  }

  async update(actor: AuthUser, id: bigint, dto: UpdateEmployeeDto): Promise<EmployeeRowView> {
    await this.live(id);
    const changes: Partial<typeof Employees.$inferInsert> = { UpdatedAt: new Date(), UpdatedBy: actor.id };
    if (dto.employeeCode !== undefined) changes.EmployeeCode = dto.employeeCode;
    if (dto.firstName !== undefined) changes.FirstName = dto.firstName;
    if (dto.lastName !== undefined) changes.LastName = dto.lastName;
    if (dto.phone !== undefined) changes.Phone = dto.phone;
    if (dto.bookingEmployeeRef !== undefined) changes.BookingEmployeeRef = dto.bookingEmployeeRef;
    if (dto.status !== undefined) changes.Status = dto.status;
    if (dto.userId !== undefined) {
      changes.UserId = dto.userId === null ? null : await this.linkableUser(actor, BigInt(dto.userId));
    }
    await this.assertAvailable(
      { code: dto.employeeCode, bookingRef: dto.bookingEmployeeRef, userId: changes.UserId },
      id,
    );

    const [row] = await this.db
      .update(Employees)
      .set(changes)
      .where(eq(Employees.Id, id))
      .returning()
      .catch(rethrowUnique);
    return toEmployeeRow(row);
  }

  async remove(actor: AuthUser, id: bigint): Promise<void> {
    await this.live(id);
    const now = new Date();
    await this.db
      .update(Employees)
      .set({ IsDeleted: true, DeletedAt: now, DeletedBy: actor.id, UpdatedAt: now, UpdatedBy: actor.id })
      .where(eq(Employees.Id, id));
  }

  private async live(id: bigint) {
    const [row] = await this.db
      .select({ Id: Employees.Id })
      .from(Employees)
      .where(and(eq(Employees.Id, id), eq(Employees.IsDeleted, false)))
      .limit(1);
    if (!row) throw new AppException(404, 'NOT_FOUND', 'ไม่พบพนักงาน');
    return row;
  }

  /** A live account the caller may see: unknown, deleted, or ADMIN for a non-ADMIN caller ⇒ 404 (DL55). */
  private async linkableUser(actor: AuthUser, userId: bigint): Promise<bigint> {
    const [user] = await this.db
      .select({ Id: Users.Id, RoleCode: Roles.Code })
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(eq(Users.Id, userId), eq(Users.IsDeleted, false)))
      .limit(1);
    if (!user || !canSeeUser(actor.roleCode, user.RoleCode)) {
      throw new AppException(404, 'NOT_FOUND', 'ไม่พบบัญชีผู้ใช้ที่จะผูก');
    }
    return user.Id;
  }

  private async assertAvailable(
    values: { code?: string; bookingRef?: string | null; userId?: bigint | null },
    exceptId?: bigint,
  ): Promise<void> {
    const checks: [string, SQL | undefined][] = [
      ['UQ_Employees_Code', values.code ? eq(Employees.EmployeeCode, values.code) : undefined],
      ['UQ_Employees_BookingRef', values.bookingRef ? eq(Employees.BookingEmployeeRef, values.bookingRef) : undefined],
      ['UQ_Employees_User', values.userId ? eq(Employees.UserId, values.userId) : undefined],
    ];
    for (const [constraint, condition] of checks) {
      if (!condition) continue;
      const [taken] = await this.db
        .select({ Id: Employees.Id })
        .from(Employees)
        .where(and(condition, eq(Employees.IsDeleted, false), exceptId ? ne(Employees.Id, exceptId) : undefined))
        .limit(1);
      if (taken) {
        const [code, message] = UNIQUE_CODES[constraint];
        throw new AppException(409, code, message);
      }
    }
  }
}

function filters(q: QueryEmployeesDto): SQL[] {
  const out: SQL[] = [eq(Employees.IsDeleted, false)];
  if (q.status) out.push(eq(Employees.Status, q.status));
  const term = q.q?.trim();
  if (term) {
    const like = likePattern(term);
    out.push(
      or(
        ilike(Employees.EmployeeCode, like),
        ilike(Employees.FirstName, like),
        ilike(Employees.LastName, like),
        ilike(Employees.BookingEmployeeRef, like),
      ) as SQL,
    );
  }
  return out;
}

function rethrowUnique(error: unknown): never {
  const pg = (error as { cause?: unknown })?.cause ?? error;
  const { code, constraint_name: constraint } = (pg ?? {}) as { code?: string; constraint_name?: string };
  if (code === '23505' && constraint && UNIQUE_CODES[constraint]) {
    const [appCode, message] = UNIQUE_CODES[constraint];
    throw new AppException(409, appCode, message);
  }
  throw error;
}
