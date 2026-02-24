import express from 'express';
import type { Server } from 'node:http';
import cors from 'cors';
import dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';
const notesServiceUrl = process.env.NOTES_SERVICE_URL ?? 'http://localhost:3002';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
let server: Server | null = null;
let isShuttingDown = false;

app.use(cors());
app.use((req, res, next) => {
  const incomingHeader = req.headers['x-request-id'];
  const incomingRequestId =
    typeof incomingHeader === 'string' ? incomingHeader.trim()
    : Array.isArray(incomingHeader) ? (incomingHeader[0] ?? '').trim()
    : '';

  const requestId = incomingRequestId || randomUUID();
  req.headers['x-request-id'] = requestId;
  (req as express.Request & { requestId?: string }).requestId = requestId;
  res.setHeader('x-request-id', requestId);

  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  const traceId = (req as express.Request & { requestId?: string }).requestId ?? '';

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const target =
      req.path.startsWith('/users') ? userServiceUrl
      : req.path.startsWith('/notes') ? notesServiceUrl
      : 'api_gateway';

    logger.info('HTTP Request', {
      requestId: traceId || 'n/a',
      method: req.method,
      path: req.originalUrl,
      target,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
});
app.use((req, res, next) => {
  const isUsersRoute = req.path.startsWith('/users');
  const isNotesRoute = req.path.startsWith('/notes');
  const isPublicRoute = req.path === '/users/login';

  if (!isUsersRoute && !isNotesRoute) {
    return next();
  }

  if (isPublicRoute) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, jwtSecret);
    if (typeof decoded === 'string') {
      return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
    }

    const userId = typeof decoded.sub === 'string' ? decoded.sub : '';
    const userEmail = typeof decoded.email === 'string' ? decoded.email : '';
    const userRole = decoded.role === 'admin' ? 'admin' : 'user';

    if (!userId) {
      return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
    }

    req.headers['x-user-id'] = userId;
    req.headers['x-user-email'] = userEmail;
    req.headers['x-user-role'] = userRole;

    next();
  } catch {
    return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
  }
});

app.get('/', (_req, res) => {
  res.json({
    service: 'api_gateway',
    status: 'ok',
    routes: {
      users: '/users',
      notes: '/notes',
      health: '/health',
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      userService: userServiceUrl,
      notesService: notesServiceUrl,
    },
  });
});

app.use('/users', createProxyMiddleware({
  target: userServiceUrl,
  changeOrigin: true,
  pathRewrite: (path) => `/users${path}`,
  on: {
    proxyReq: (proxyReq, req) => {
      const requestId = req.headers['x-request-id'];
      if (typeof requestId === 'string' && requestId) {
        proxyReq.setHeader('x-request-id', requestId);
      }
    },
  },
}));

app.use('/notes', createProxyMiddleware({
  target: notesServiceUrl,
  changeOrigin: true,
  pathRewrite: (path) => `/notes${path}`,
  on: {
    proxyReq: (proxyReq, req) => {
      const requestId = req.headers['x-request-id'];
      if (typeof requestId === 'string' && requestId) {
        proxyReq.setHeader('x-request-id', requestId);
      }
    },
  },
}));

app.use(notFoundHandler);
app.use(errorHandler);

server = app.listen(port, () => {
  logger.info('API gateway started', {
    port,
    url: `http://localhost:${port}`,
  });
  logger.info('Proxy configured', { route: '/users', target: userServiceUrl });
  logger.info('Proxy configured', { route: '/notes', target: notesServiceUrl });
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

    logger.info('API gateway shutdown complete');
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
