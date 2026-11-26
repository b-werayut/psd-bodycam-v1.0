import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bangkokDateOf, shiftDay } from '@/features/tracking-history/historyRange';
import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { streamingApi, type WallDevice } from '../streaming/streaming.api';
import { EvidencePage } from './EvidencePage';
import { evidenceExportsApi, type EvidenceExportView } from './evidenceExports.api';

vi.mock('../streaming/components/StreamPlayer', () => ({ StreamPlayer: () => <div data-testid="player" /> }));
vi.mock('../streaming/streaming.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../streaming/streaming.api')>();
  return { ...actual, streamingApi: { ...actual.streamingApi, devices: vi.fn(), recordings: vi.fn() } };
});
vi.mock('./evidenceExports.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./evidenceExports.api')>();
  return {
    ...actual,
    evidenceExportsApi: { policy: vi.fn(), request: vi.fn(), get: vi.fn(), ticket: vi.fn() },
  };
});

const DAY = shiftDay(bangkokDateOf(new Date()), -1);
const view = (status: number, extra: Partial<EvidenceExportView> = {}): EvidenceExportView => ({
  id: '7',
  status,
  progress: 0,
  fileName: null,
  fileSizeBytes: null,
  startAt: '',
  endAt: '',
  expiresAt: null,
  errorMessage: null,
  ...extra,
});
const READY = view(3, {
  fileName: 'evidence_CAM-1_20261125-100000.mp4',
  fileSizeBytes: String(310 * 1024 ** 2),
});

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/evidence?deviceId=1&date=${DAY}`]}>
      <Routes>
        <Route path="/evidence" element={<EvidencePage />} />
      </Routes>
    </MemoryRouter>,
  );

const setRange = (from: string, to: string) => {
  fireEvent.change(document.getElementById('evidence-from')!, { target: { value: `${DAY}T${from}` } });
  fireEvent.change(document.getElementById('evidence-to')!, { target: { value: `${DAY}T${to}` } });
};
const exportButton = () => screen.queryByRole('button', { name: 'ดาวน์โหลด MP4' });
const tick = (ms = 2000) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('EvidencePage download', () => {
  let clicked: { href: string; download: string }[];
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    signIn(['playback:view', 'devices:read', 'evidence:export', 'evidence:download']);
    vi.mocked(streamingApi.devices).mockResolvedValue([
      { id: '1', deviceCode: 'CAM-1', name: 'CAM-1', platformState: 'online', status: 1, streamingEnabled: true },
    ] as WallDevice[]);
    vi.mocked(streamingApi.recordings).mockResolvedValue({ data: [], from: '', to: '' });
    vi.mocked(evidenceExportsApi.policy).mockResolvedValue({ maxMinutes: 120 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    signOut();
    vi.clearAllMocks();
  });

  it('hides the button without evidence:export', async () => {
    signIn(['playback:view', 'devices:read']);
    renderPage();
    await screen.findByText('ไม่พบวิดีโอของกล้องนี้ในวันที่เลือก');
    expect(exportButton()).toBeNull();
    expect(screen.queryByRole('region', { name: 'สถานะดาวน์โหลด MP4' })).toBeNull();
    expect(evidenceExportsApi.policy).not.toHaveBeenCalled();
  });

  it('hides download status before an export is requested', async () => {
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    expect(screen.queryByRole('region', { name: 'สถานะดาวน์โหลด MP4' })).toBeNull();
    expect(screen.queryByText('ยังไม่มีรายการดาวน์โหลด')).toBeNull();
    expect(evidenceExportsApi.request).not.toHaveBeenCalled();
  });

  it('shows pending download feedback with the range actions after clicking download', async () => {
    let resolveRequest!: (value: EvidenceExportView) => void;
    vi.mocked(evidenceExportsApi.request).mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);

    const range = screen.getByRole('region', { name: 'เลือกช่วงเวลาที่ต้องการดู' });
    const status = within(range).getByRole('region', { name: 'สถานะดาวน์โหลด MP4' });
    expect(within(range).getByRole('button', { name: 'ดาวน์โหลด MP4' })).toBeDisabled();
    expect(within(status).getByText('กำลังส่งคำขอ…')).toBeInTheDocument();
    await act(async () => resolveRequest(view(1)));
    expect(await within(status).findByText('รอคิว')).toBeInTheDocument();
  });

  it('disables the button and states the cap when the range is longer than the policy', async () => {
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '12:01:00');
    expect(exportButton()).toBeDisabled();
    setRange('10:00:00', '12:00:00');
    expect(exportButton()).toBeEnabled();
  });

  it('requests, polls Queued -> Processing 42% -> Ready, then downloads through a ticket', async () => {
    vi.mocked(evidenceExportsApi.request).mockResolvedValue(view(1));
    vi.mocked(evidenceExportsApi.get)
      .mockResolvedValueOnce(view(2, { progress: 42 }))
      .mockResolvedValueOnce(READY);
    vi.mocked(evidenceExportsApi.ticket).mockResolvedValue({
      url: '/api/evidence-exports/download?ticket=abc',
      fileName: 'evidence_CAM-1_20261125-100000.mp4',
    });
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    const status = screen.getByRole('region', { name: 'สถานะดาวน์โหลด MP4' });
    expect(await within(status).findByText('รอคิว')).toBeInTheDocument();
    expect(vi.mocked(evidenceExportsApi.request).mock.calls[0]![0]).toMatchObject({ deviceCode: 'CAM-1' });
    await tick();
    expect(await within(status).findByText('กำลังแปลงไฟล์ 42%')).toBeInTheDocument();
    await tick();
    expect(await within(status).findByText('พร้อมดาวน์โหลด')).toBeInTheDocument();
    const download = screen.getByRole('button', { name: /evidence_CAM-1_20261125-100000\.mp4/ });
    expect(download).toHaveTextContent('310 MB');
    // ready: polling has stopped
    await tick(6000);
    expect(evidenceExportsApi.get).toHaveBeenCalledTimes(2);
    await userEvent.click(download);
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]).toEqual({
      href: '/api/evidence-exports/download?ticket=abc',
      download: 'evidence_CAM-1_20261125-100000.mp4',
    });
  });

  it('shows a row that is already ready at once, without polling', async () => {
    vi.mocked(evidenceExportsApi.request).mockResolvedValue(READY);
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    expect(await screen.findByText('พร้อมดาวน์โหลด')).toBeInTheDocument();
    await tick(4000);
    expect(evidenceExportsApi.get).not.toHaveBeenCalled();
  });

  it('shows the ready state without a download button and a hint when evidence:download is missing', async () => {
    signIn(['playback:view', 'devices:read', 'evidence:export']);
    vi.mocked(evidenceExportsApi.request).mockResolvedValue(READY);
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    expect(await screen.findByText('พร้อมดาวน์โหลด')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /evidence_CAM-1/ })).toBeNull();
    expect(screen.getByText('ไม่มีสิทธิ์ดาวน์โหลดไฟล์')).toBeInTheDocument();
  });

  it('shows the failure message and retries with a new request', async () => {
    vi.mocked(evidenceExportsApi.request)
      .mockResolvedValueOnce(view(4, { errorMessage: 'แปลงไฟล์ไม่สำเร็จ' }))
      .mockResolvedValueOnce(view(1));
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    expect(await screen.findByText('แปลงไฟล์ไม่สำเร็จ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(await screen.findByText('รอคิว')).toBeInTheDocument();
    expect(evidenceExportsApi.request).toHaveBeenCalledTimes(2);
  });

  it('shows the server message when the request is refused', async () => {
    vi.mocked(evidenceExportsApi.request).mockRejectedValue(
      apiError(400, { code: 'INVALID_RANGE', message: 'ช่วงเวลาเกินกำหนด' }),
    );
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    expect(await screen.findByText('ช่วงเวลาเกินกำหนด')).toBeInTheDocument();
  });

  it('turns an expired ticket (404) into หมดอายุ with an export-again button', async () => {
    vi.mocked(evidenceExportsApi.request).mockResolvedValueOnce(READY).mockResolvedValueOnce(view(1));
    vi.mocked(evidenceExportsApi.ticket).mockRejectedValue(
      apiError(404, { code: 'EXPORT_EXPIRED', message: 'ไฟล์หมดอายุแล้ว' }),
    );
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    await userEvent.click(await screen.findByRole('button', { name: /evidence_CAM-1/ }));
    expect(await screen.findByText('หมดอายุ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ส่งออกอีกครั้ง' }));
    expect(await screen.findByText('รอคิว')).toBeInTheDocument();
    expect(evidenceExportsApi.request).toHaveBeenCalledTimes(2);
  });

  it('goes back to polling when the ticket says the file is not ready yet', async () => {
    vi.mocked(evidenceExportsApi.request).mockResolvedValue(READY);
    vi.mocked(evidenceExportsApi.ticket).mockRejectedValue(
      apiError(404, { code: 'EXPORT_NOT_READY', message: 'ยังไม่พร้อม' }),
    );
    vi.mocked(evidenceExportsApi.get).mockResolvedValue(view(2, { progress: 90 }));
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    await userEvent.click(await screen.findByRole('button', { name: /evidence_CAM-1/ }));
    await tick();
    expect(await screen.findByText('กำลังแปลงไฟล์ 90%')).toBeInTheDocument();
  });

  it('treats a 404 while polling as expired', async () => {
    vi.mocked(evidenceExportsApi.request).mockResolvedValue(view(1));
    vi.mocked(evidenceExportsApi.get).mockRejectedValue(apiError(404, { code: 'EXPORT_NOT_FOUND', message: 'x' }));
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    await screen.findByText('รอคิว');
    await tick();
    expect(await screen.findByText('หมดอายุ')).toBeInTheDocument();
  });

  it('clears the status when the range changes, and stops polling', async () => {
    vi.mocked(evidenceExportsApi.request).mockResolvedValue(view(1));
    vi.mocked(evidenceExportsApi.get).mockResolvedValue(view(1));
    renderPage();
    await screen.findByText('ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที');
    setRange('10:00:00', '10:30:00');
    fireEvent.click(exportButton()!);
    await screen.findByText('รอคิว');
    setRange('10:00:00', '10:45:00');
    expect(screen.queryByText('รอคิว')).toBeNull();
    expect(screen.queryByRole('region', { name: 'สถานะดาวน์โหลด MP4' })).toBeNull();
    const calls = vi.mocked(evidenceExportsApi.get).mock.calls.length;
    await tick(6000);
    expect(evidenceExportsApi.get).toHaveBeenCalledTimes(calls);
  });
});
