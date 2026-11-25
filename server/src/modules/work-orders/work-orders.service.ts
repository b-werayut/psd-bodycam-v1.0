import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { AppException } from '../../common/errors/app-exception';
import { likePattern } from '../../common/http/page-query.dto';
import { paged, type Paged } from '../../common/http/paged';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { BookingJobs, Teams, Users, WorkOrderEvents, WorkOrders } from '../../db/schema';
import { resolveDeviceRefs } from '../devices/device-refs';
import { DeviceStatusDisplayService } from '../devices/device-status-display.service';
import type { QueryWorkOrdersDto } from './dto/query-work-orders.dto';
import {
  camerasOf,
  toWorkOrderDetail,
  toWorkOrderEvent,
  toWorkOrderRow,
  type WorkOrderRecord,
  type WorkOrderRow,
} from './work-order.view';

const notFound = () => new AppException(404, 'NOT_FOUND', 'ไม่พบใบงาน');

const recordColumns = {
  id: WorkOrders.Id,
  workOrderNo: WorkOrders.WorkOrderNo,
  title: WorkOrders.Title,
  status: WorkOrders.Status,
  closeReason: WorkOrders.CloseReason,
  needsReview: WorkOrders.NeedsReview,
  reviewReasons: WorkOrders.ReviewReasons,
  note: WorkOrders.Note,
  openedAt: WorkOrders.OpenedAt,
  closedAt: WorkOrders.ClosedAt,
  rowVersion: WorkOrders.RowVersion,
  teamId: Teams.Id,
  teamCode: Teams.Code,
  teamName: Teams.Name,
  leaderId: Users.Id,
  leaderFirstName: Users.FirstName,
  leaderLastName: Users.LastName,
  jobId: BookingJobs.Id,
  sourceSystem: BookingJobs.SourceSystem,
  externalJobId: BookingJobs.ExternalJobId,
  externalJobNo: BookingJobs.ExternalJobNo,
  doNo: BookingJobs.DoNo,
  shNo: BookingJobs.ShNo,
  jobStatus: BookingJobs.Status,
  rawStatus: BookingJobs.RawStatus,
  plannedStartAt: BookingJobs.PlannedStartAt,
  plannedEndAt: BookingJobs.PlannedEndAt,
  scheduledDate: BookingJobs.ScheduledDate,
  checkInAt: BookingJobs.BookingCheckInAt,
  checkOutAt: BookingJobs.BookingCheckOutAt,
  deviceRefs: BookingJobs.DeviceRefs,
  siteName: BookingJobs.SiteName,
  siteAddress: BookingJobs.SiteAddress,
  siteLat: BookingJobs.SiteLat,
  siteLng: BookingJobs.SiteLng,
  lastSyncedAt: BookingJobs.LastSyncedAt,
} as const;

/** Read side of work orders (the writer is the inbox processor, DL33). Every web role sees all of them. */
@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly display: DeviceStatusDisplayService,
  ) {}

  private base() {
    return this.db
      .select(recordColumns)
      .from(WorkOrders)
      .innerJoin(BookingJobs, eq(BookingJobs.Id, WorkOrders.BookingJobId))
      .leftJoin(Teams, eq(Teams.Id, WorkOrders.TeamId))
      .leftJoin(Users, eq(Users.Id, WorkOrders.LeaderUserId));
  }

  /** The cameras of every record, resolved and status-checked with one lookup each (DL45). */
  private async camerasFor(records: WorkOrderRecord[]) {
    const refs = [...new Set(records.flatMap((r) => r.deviceRefs ?? []))];
    const resolved = await resolveDeviceRefs(this.db, refs);
    const devices = new Map<string, { id: bigint; vendorDeviceId: string }>();
    for (const d of resolved.values()) devices.set(String(d.id), { id: d.id, vendorDeviceId: d.vendorDeviceId });
    const statuses = await this.display.statuses([...devices.values()]);
    return (record: WorkOrderRecord) => camerasOf(record.deviceRefs, resolved, statuses);
  }

  async list(query: QueryWorkOrdersDto): Promise<Paged<WorkOrderRow>> {
    const where: SQL[] = [];
    if (query.status !== undefined) where.push(eq(WorkOrders.Status, query.status));
    const q = query.q?.trim();
    if (q) {
      const pattern = likePattern(q);
      where.push(
        or(
          ilike(WorkOrders.WorkOrderNo, pattern),
          ilike(BookingJobs.ExternalJobNo, pattern),
          ilike(BookingJobs.ExternalJobId, pattern),
          ilike(BookingJobs.DoNo, pattern),
          ilike(BookingJobs.ShNo, pattern),
          ilike(Teams.Name, pattern),
        )!,
      );
    }
    const condition = where.length ? and(...where) : undefined;

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(WorkOrders)
      .innerJoin(BookingJobs, eq(BookingJobs.Id, WorkOrders.BookingJobId))
      .leftJoin(Teams, eq(Teams.Id, WorkOrders.TeamId))
      .where(condition);

    const records = await this.base()
      .where(condition)
      .orderBy(
        sql`case when ${WorkOrders.Status} in (6, 1) then 0 else 1 end`,
        desc(sql`coalesce(${WorkOrders.OpenedAt}, ${BookingJobs.PlannedStartAt}, ${WorkOrders.CreatedAt})`),
        desc(WorkOrders.Id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const camerasOf = await this.camerasFor(records);
    return paged(
      records.map((r) => toWorkOrderRow(r, camerasOf(r))),
      total,
      query.page,
      query.pageSize,
    );
  }

  async detail(id: string, fullBooking: boolean) {
    const record = await this.find(id);
    const camerasOf = await this.camerasFor([record]);
    return toWorkOrderDetail(record, camerasOf(record), fullBooking);
  }

  async events(id: string) {
    await this.find(id);
    const rows = await this.db
      .select({
        id: WorkOrderEvents.Id,
        eventType: WorkOrderEvents.EventType,
        fromStatus: WorkOrderEvents.FromStatus,
        toStatus: WorkOrderEvents.ToStatus,
        source: WorkOrderEvents.Source,
        actorUserId: WorkOrderEvents.ActorUserId,
        trackingSessionId: WorkOrderEvents.TrackingSessionId,
        reason: WorkOrderEvents.Reason,
        detail: WorkOrderEvents.Detail,
        occurredAt: WorkOrderEvents.OccurredAt,
      })
      .from(WorkOrderEvents)
      .where(eq(WorkOrderEvents.WorkOrderId, BigInt(id)))
      .orderBy(asc(WorkOrderEvents.OccurredAt), asc(WorkOrderEvents.Id));
    return { data: rows.map(toWorkOrderEvent) };
  }

  private async find(id: string): Promise<WorkOrderRecord> {
    if (!/^\d{1,18}$/.test(id)) throw notFound();
    const [record] = await this.base().where(eq(WorkOrders.Id, BigInt(id))).limit(1);
    if (!record) throw notFound();
    return record;
  }
}
