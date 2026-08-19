/**
 * Server entry point: binds the port and shuts down cleanly.
 */

import {serve} from '@hono/node-server';
import {WebSocketServer} from 'ws';

import {app} from './app.js';
import {closeDatabase} from './db/client.js';
import {env} from './env.js';

// `noServer: true` because the underlying HTTP server already exists (below,
// via `serve()`) - this WebSocketServer only ever gets a connection through
// `@hono/node-server`'s own upgrade handling, matching `upgradeWebSocket`'s
// routes in canvas-presence.ts.
const wss = new WebSocketServer({noServer: true});

const server = serve(
  {fetch: app.fetch, port: env.PORT, websocket: {server: wss}},
  (info) => {
    console.log(`COS API listening on http://localhost:${info.port}`);
    console.log(`  docs  http://localhost:${info.port}/docs`);
  },
);

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
