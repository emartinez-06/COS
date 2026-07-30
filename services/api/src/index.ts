/**
 * Server entry point: binds the port and shuts down cleanly.
 */

import {serve} from '@hono/node-server';

import {app} from './app.js';
import {closeDatabase} from './db/client.js';
import {env} from './env.js';

const server = serve({fetch: app.fetch, port: env.PORT}, (info) => {
  console.log(`COS API listening on http://localhost:${info.port}`);
  console.log(`  docs  http://localhost:${info.port}/docs`);
});

/**
 * Finish in-flight requests before dropping the pool. Without this, a redeploy
 * can cut a write mid-transaction.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });

  // Do not hang forever if a connection refuses to drain.
  setTimeout(() => {
    console.error('Shutdown timed out, exiting');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
