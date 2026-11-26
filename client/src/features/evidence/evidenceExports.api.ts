import { api } from '@/lib/apiClient';

/** `EvidenceExports.Status` — same values as the server (`EVIDENCE_EXPORT_STATUS`). */
export const EVIDENCE_EXPORT_STATUS = {
  QUEUED: 1,
  PROCESSING: 2,
  READY: 3,
  FAILED: 4,
  EXPIRED: 5,
} as const;

export type EvidenceExportView = {
  id: string;
  status: number;
  progress: number;
  fileName: string | null;
  /** bigint as a string */
  fileSizeBytes: string | null;
  startAt: string;
  endAt: string;
  expiresAt: string | null;
  /** short Thai text from the server, shown as is */
  errorMessage: string | null;
};

export type EvidenceExportPolicy = { maxMinutes: number };
export type DownloadTicket = { url: string; fileName: string };
export type EvidenceExportRequest = { deviceCode: string; startAt: string; endAt: string };

export const evidenceExportsApi = {
  policy: () => api.get<EvidenceExportPolicy>('/evidence-exports/policy').then((r) => r.data),
  request: (payload: EvidenceExportRequest) =>
    api.post<EvidenceExportView>('/evidence-exports', payload).then((r) => r.data),
  get: (id: string) => api.get<EvidenceExportView>(`/evidence-exports/${id}`).then((r) => r.data),
  ticket: (id: string) =>
    api.post<DownloadTicket>(`/evidence-exports/${id}/download-ticket`).then((r) => r.data),
};
