/** List envelope used by every list endpoint. */
export type Paged<T> = { data: T[]; page: number; pageSize: number; total: number };

export function paged<T>(data: T[], total: number, page: number, pageSize: number): Paged<T> {
  return { data, page, pageSize, total };
}
