/// <reference types="vitest/config" />
import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const SOCKET_CLOSED_CODES = ['ECONNABORTED', 'ECONNRESET', 'EPIPE'];
const logger = createLogger();
const logError = logger.error;
logger.error = (msg, options) => {
  const code = (options?.error as { code?: string } | undefined)?.code;
  const isWsProxyNoise =
    msg.indexOf('ws proxy socket error') !== -1 || msg.indexOf('ws proxy error') !== -1;
  if (isWsProxyNoise && code && SOCKET_CLOSED_CODES.indexOf(code) !== -1) return;
  logError(msg, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    maxWorkers: process.env.CI ? 2 : undefined,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
});
