import express from 'express';
import type { Server } from 'node:http';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import rateLimit from 'express-rate-limit';
import userRoutes from './routes/userRoutes.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './errors.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME || 'app';
const apiVersionPrefix = process.env.API_VERSION_PREFIX ?? '/api/v1';
const globalRateLimitWindowMs = Number.parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS ?? '60000', 10);
const globalRateLimitMaxRequests = Number.parseInt(process.env.RATE_LIMIT_GLOBAL_MAX_REQUESTS ?? '200', 10);
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10);
let server: Server | null = null;
let isShuttingDown = false;

if (!mongoUri) {
  throw new Error('MONGODB_URI is not set');
}

app.use(express.json());
app.use(cors());
app.disable('x-powered-by');
app.set('trust proxy', Number.isNaN(trustProxyHops) ? 1 : trustProxyHops);
app.use((req, _res, next) => {
  const incomingHeader = req.headers['x-request-id'];
  const requestId =
    typeof incomingHeader === 'string' ? incomingHeader
    : Array.isArray(incomingHeader) ? incomingHeader[0]
    : undefined;

  if (requestId) {
    req.headers['x-request-id'] = requestId;
    (req as express.Request & { requestId?: string }).requestId = requestId;
  }

  next();
});
app.use(rateLimit({
  windowMs: globalRateLimitWindowMs,
  max: globalRateLimitMaxRequests,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  handler: (req, res) => {
    const requestId = (req as express.Request & { requestId?: string }).requestId ?? 'n/a';
    logger.warn('Rate limit exceeded', {
      requestId,
      limiter: 'global',
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      max: globalRateLimitMaxRequests,
      windowMs: globalRateLimitWindowMs,
    });

    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later.',
      },
      requestId,
    });
  },
}));
app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = (req as express.Request & { requestId?: string }).requestId ?? 'n/a';

  res.on('finish', () => {
    logger.info('HTTP Request', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

app.use('/users', userRoutes);
app.use(`${apiVersionPrefix}/users`, userRoutes);

app.get('/', (req, res) => {
  res.send('User Service Running');
});

app.get('/health', async (req, res) => {
  const db = req.app.locals.db as ReturnType<MongoClient['db']> | undefined;

  if (!db) {
    return res.status(503).json({
      status: 'degraded',
      uptime: process.uptime(),
      mongo: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    await db.command({ ping: 1 });

    return res.json({
      status: 'ok',
      uptime: process.uptime(),
      mongo: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      status: 'degraded',
      uptime: process.uptime(),
      mongo: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get(`${apiVersionPrefix}/health`, async (req, res) => {
  const db = req.app.locals.db as ReturnType<MongoClient['db']> | undefined;

  if (!db) {
    return res.status(503).json({
      status: 'degraded',
      version: 'v1',
      uptime: process.uptime(),
      mongo: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    await db.command({ ping: 1 });

    return res.json({
      status: 'ok',
      version: 'v1',
      uptime: process.uptime(),
      mongo: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      status: 'degraded',
      version: 'v1',
      uptime: process.uptime(),
      mongo: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

const client = new MongoClient(mongoUri);

const start = async () => {
  try {
    await client.connect();
    app.locals.db = client.db(mongoDbName);
    logger.info('Connected to MongoDB', {
      database: mongoDbName,
    });
    server = app.listen(port, () => {
      logger.info('User service started', {
        port,
        url: `http://localhost:${port}`,
      });
    });
  } catch (error) {
    logger.error('Error connecting to MongoDB', {
      error,
    });
  }
};

start();

const shutdown = async (signal: 'SIGTERM' | 'SIGINT') => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info('Shutdown signal received', { signal });

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    await client.close();
    logger.info('User service shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { signal, error });
    process.exit(1);
  }
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
