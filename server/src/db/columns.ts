import { bigint, boolean, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

/** Primary key: `bigint GENERATED ALWAYS AS IDENTITY` (bigint mode, serialized as string in JSON). */
export const pkId = () => bigint('Id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity();

export const fk = (name: string) => bigint(name, { mode: 'bigint' });

export const ref = (name: string, target: () => AnyPgColumn) =>
  bigint(name, { mode: 'bigint' }).references(target) as unknown as ReturnType<typeof fk>;

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => tstz('CreatedAt').notNull().defaultNow();

export const updatedAt = () =>
  tstz('UpdatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// `Users` lives in schema.ts, which imports this file. schema.ts binds the target once after
// defining `Users`; the FK callbacks below are evaluated lazily, so there is no import cycle.
let usersIdColumn: (() => AnyPgColumn) | undefined;

export function bindUsersIdColumn(get: () => AnyPgColumn): void {
  usersIdColumn = get;
}

/** FK to Users.Id. */
export const userRef = (name: string) =>
  ref(name, () => {
    if (!usersIdColumn) throw new Error('columns.ts: schema.ts did not call bindUsersIdColumn()');
    return usersIdColumn();
  });

/** `CreatedBy`, `UpdatedBy` -> Users. */
export const auditActor = () => ({ CreatedBy: userRef('CreatedBy'), UpdatedBy: userRef('UpdatedBy') });

/** Master-data soft delete columns. */
export const softDelete = () => ({
  IsDeleted: boolean('IsDeleted').notNull().default(false),
  DeletedAt: tstz('DeletedAt'),
  DeletedBy: userRef('DeletedBy'),
});

/** Partial-unique predicate for master data: `"IsDeleted" = false`. */
export const notDeleted = (t: { IsDeleted: unknown }): SQL => sql`${t.IsDeleted} = false`;
