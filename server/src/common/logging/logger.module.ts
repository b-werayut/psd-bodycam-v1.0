import type { DestinationStream } from 'pino';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';
import { resolveCorrelationId } from '../context/request-context';

export function createLoggerOptions(stream?: DestinationStream): Params {
  const isProd = process.env.NODE_ENV === 'production';
  const options = {
    level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    genReqId: (req: { headers: Record<string, string | string[] | undefined>; id?: unknown }) => {
      // Same derivation as RequestContextMiddleware; pino-http may run before it.
      const id = resolveCorrelationId(req);
      (req as { id?: unknown }).id = id;
      return id;
    },
    customProps: (req: { id?: unknown }) => ({ correlationId: req.id }),
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[Redacted]' },
    transport: !stream && !isProd ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
  };
  return { pinoHttp: stream ? [options, stream] : options } as Params;
}

export const AppLoggerModule = PinoLoggerModule.forRoot(createLoggerOptions());
