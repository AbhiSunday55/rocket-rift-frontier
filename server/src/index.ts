import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { config } from './config.js';
import { closePool, healthCheck } from './db.js';
import { closeRedis, initRedis, isRedisAvailable } from './redis.js';
import { authRouter } from './modules/auth.js';
import { playersRouter } from './modules/players.js';
import { inventoryRouter } from './modules/inventory.js';
import { missionsRouter } from './modules/missions.js';
import { marketplaceRouter } from './modules/marketplace.js';
import { tradingRouter } from './modules/trading.js';
import { runsRouter } from './modules/runs.js';
import { attachWebSocket, onlineCount } from './modules/websocket.js';

/**
 * ROCKET RIFT: FRONTIER — game API.
 *
 * Express + WebSockets. The server is authoritative for everything that matters:
 * ownership, currency, mission completion, and run rewards. The client is a
 * renderer and an input device; it is never trusted with a number that pays out.
 */

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin/no-origin requests and anything on the allow-list.
      if (!origin || config.corsOrigins.includes(origin) || !config.isProd) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '256kb' }));

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const db = await healthCheck();
  res.status(db ? 200 : 503).json({
    status: db ? 'ok' : 'degraded',
    env: config.env,
    database: db ? 'up' : 'down',
    redis: isRedisAvailable() ? 'up' : 'in-memory',
    websockets: onlineCount(),
    chainId: config.chainId,
    contractsConfigured: Boolean(config.contracts.marketplace),
    time: new Date().toISOString(),
  });
});

// ── Modules ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/players', playersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/missions', missionsRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/trades', tradingRouter);
app.use('/api/runs', runsRouter);

// ── 404 + error handling ────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] unhandled error', err);
  res.status(500).json({
    error: config.isProd ? 'Internal server error' : err.message,
  });
});

// ── Boot ────────────────────────────────────────────────────────────────────
const server = createServer(app);
attachWebSocket(server);

async function start(): Promise<void> {
  await initRedis();

  const dbUp = await healthCheck();
  if (!dbUp) {
    console.warn('[api] database unreachable — run `npm run migrate` and check DATABASE_URL');
  }

  server.listen(config.port, () => {
    console.log(`\n  ROCKET RIFT: FRONTIER API`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  http      http://localhost:${config.port}`);
    console.log(`  ws        ws://localhost:${config.port}/ws`);
    console.log(`  env       ${config.env}`);
    console.log(`  database  ${dbUp ? 'connected' : 'UNAVAILABLE'}`);
    console.log(`  redis     ${isRedisAvailable() ? 'connected' : 'in-memory fallback'}`);
    console.log(`  chain     ${config.chainId}\n`);
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[api] ${signal} received — shutting down`);
  server.close();
  await Promise.allSettled([closePool(), closeRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start().catch((err) => {
  console.error('[api] failed to start', err);
  process.exit(1);
});

export { app, server };
