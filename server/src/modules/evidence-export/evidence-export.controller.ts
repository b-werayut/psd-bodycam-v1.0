import { BadRequestException, Body, Controller, Get, Logger, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ParseBigIntPipe } from '../../common/pipes/parse-bigint.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RequestExportDto } from './dto/request-export.dto';
import { EvidenceExportService } from './evidence-export.service';

@Controller('evidence-exports')
export class EvidenceExportController {
  private readonly logger = new Logger(EvidenceExportController.name);

  constructor(private readonly exports: EvidenceExportService) {}

  // Fixed routes stay above ':id', otherwise 'policy' / 'download' are taken as an id.
  @Get('policy')
  @RequirePermission('evidence:export')
  policy() {
    return this.exports.policy();
  }

  // @Public: the browser downloads with a plain link, so no Bearer header. The 60 s ticket is the credential
  // and the service re-checks the owner's account and evidence:download on every open.
  @Get('download')
  @Public()
  @RateLimit('evidence-download')
  async download(@Query('ticket') ticket: string | undefined, @Res() res: Response): Promise<void> {
    if (!ticket) throw new BadRequestException('ลิงก์ดาวน์โหลดไม่ครบ');
    const file = await this.exports.openDownload(ticket);
    // sendFile answers Range (206) and sets Content-Length; the path is server-derived, so dotfiles in parents are fine.
    await new Promise<void>((resolve) => {
      res.sendFile(
        file.absolutePath,
        {
          dotfiles: 'allow',
          cacheControl: false,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${file.fileName}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        },
        (err: (Error & { status?: number; statusCode?: number; headers?: Record<string, string> }) | undefined) => {
          // With a callback Express sends nothing on error, so answer here or the request would hang
          // (416 unsatisfiable Range, 412, file purged between stat and send). Client aborts: headers already sent.
          if (err && !res.headersSent) {
            const status = err.status ?? err.statusCode ?? 404;
            this.logger.warn(`Evidence download failed with status ${status}: ${err.message}`);
            for (const [name, value] of Object.entries(err.headers ?? {})) res.setHeader(name, value);
            res.status(status).json({
              statusCode: status,
              code: status === 416 ? 'RANGE_NOT_SATISFIABLE' : 'EXPORT_NOT_FOUND',
              message: status === 416 ? 'ช่วงข้อมูลที่ขอไม่ถูกต้อง' : 'ไม่พบไฟล์ หรือไฟล์หมดอายุแล้ว',
            });
          }
          resolve();
        },
      );
    });
  }

  @Post()
  @RequirePermission('evidence:export')
  @Audit('REQUEST_EVIDENCE_EXPORT', 'EvidenceExports')
  @RateLimit('evidence-export')
  create(@CurrentUser() user: AuthUser, @Body() dto: RequestExportDto) {
    return this.exports.request(user, dto);
  }

  // Polled every 2 s, so no @Audit.
  @Get(':id')
  @RequirePermission('evidence:export')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.exports.get(user, id);
  }

  // The point where data leaves the system is audited here (the download itself has no user).
  @Post(':id/download-ticket')
  @RequirePermission('evidence:download')
  @Audit('DOWNLOAD_EVIDENCE_EXPORT', 'EvidenceExports')
  ticket(@CurrentUser() user: AuthUser, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.exports.issueTicket(user, id);
  }
}
