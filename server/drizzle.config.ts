import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// schema.partitioned.ts is excluded on purpose: AuditLogs DDL is hand-written custom SQL.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL as string },
});
