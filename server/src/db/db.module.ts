import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { DRIZZLE } from './db.constants';

let clientRef: Sql | undefined;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        const client = postgres(process.env.DATABASE_URL as string, { max: 10 });
        clientRef = client;
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DbModule.name);

  async onApplicationShutdown(): Promise<void> {
    await clientRef?.end();
    clientRef = undefined;
    this.logger.log('Postgres pool closed');
  }
}
