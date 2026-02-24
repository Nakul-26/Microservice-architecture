import express from 'express';
import type { Server } from 'node:http';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import noteRoutes from './routes/noteRoutes.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './errors.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3002;
let server: Server | null = null;
let isShuttingDown = false;

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

app.use('/notes', noteRoutes);

app.get('/', (req, res) => {
  res.send('Notes Service Running');
});

app.get('/health', (_req, res) => {
  const mongo =
    mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const status = mongo === 'connected' ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    uptime: process.uptime(),
    mongo,
    timestamp: new Date().toISOString(),
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

mongoose.connect(process.env.MONGODB_URI!)
  .then(() => {
    logger.info('Connected to MongoDB');
    server = app.listen(port, () => {
      logger.info('Notes service started', {
        port,
        url: `http://localhost:${port}`,
      });
    });
  })
  .catch((error) => {
    logger.error('Error connecting to MongoDB', {
      error,
    });
  });

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

    await mongoose.connection.close();
    logger.info('Notes service shutdown complete');
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
