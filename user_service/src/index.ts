import express from 'express';
import type { Server } from 'node:http';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import userRoutes from './routes/userRoutes.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './errors.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME || 'app';
let server: Server | null = null;
let isShuttingDown = false;

if (!mongoUri) {
  throw new Error('MONGODB_URI is not set');
}

app.use(express.json());
app.use(cors());
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
