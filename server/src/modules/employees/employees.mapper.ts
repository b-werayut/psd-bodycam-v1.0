import type { Employees } from '../../db/schema';

export const EMPLOYEE_STATUS = { ACTIVE: 1, SUSPENDED: 2, RESIGNED: 3 } as const;

/** Shape of client `EmployeeRow` (client/src/features/employees/employees.api.ts). */
export type EmployeeRowView = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  userId: string | null;
  bookingEmployeeRef: string | null;
  status: number;
};

export function toEmployeeRow(row: typeof Employees.$inferSelect): EmployeeRowView {
  return {
    id: row.Id.toString(),
    employeeCode: row.EmployeeCode,
    firstName: row.FirstName,
    lastName: row.LastName,
    phone: row.Phone,
    userId: row.UserId?.toString() ?? null,
    bookingEmployeeRef: row.BookingEmployeeRef,
    status: row.Status,
  };
}
