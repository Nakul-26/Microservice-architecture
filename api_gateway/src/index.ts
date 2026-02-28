import express from 'express';
import type { Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import cors from 'cors';
import dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { logger } from './logger.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';
const notesServiceUrl = process.env.NOTES_SERVICE_URL ?? 'http://localhost:3002';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const upstreamTimeoutMs = Number.parseInt(process.env.UPSTREAM_TIMEOUT_MS ?? '5000', 10);
const usersRateLimitWindowMs = Number.parseInt(process.env.RATE_LIMIT_USERS_WINDOW_MS ?? '60000', 10);
const usersRateLimitMaxRequests = Number.parseInt(process.env.RATE_LIMIT_USERS_MAX_REQUESTS ?? '120', 10);
const notesRateLimitWindowMs = Number.parseInt(process.env.RATE_LIMIT_NOTES_WINDOW_MS ?? '60000', 10);
const notesRateLimitMaxRequests = Number.parseInt(process.env.RATE_LIMIT_NOTES_MAX_REQUESTS ?? '240', 10);
const loginRateLimitWindowMs = Number.parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS ?? '60000', 10);
const loginRateLimitMaxRequests = Number.parseInt(process.env.RATE_LIMIT_LOGIN_MAX_REQUESTS ?? '10', 10);
const circuitBreakerFailureThreshold = Number.parseInt(
  process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? '5',
  10
);
const circuitBreakerOpenMs = Number.parseInt(process.env.CIRCUIT_BREAKER_OPEN_MS ?? '30000', 10);
let server: Server | null = null;
let isShuttingDown = false;

type CircuitBreakerState = {
  targetService: 'user_service' | 'notes_service';
  consecutiveFailures: number;
  openedAt: number | null;
  openUntil: number;
};

const getSingleHeaderValue = (header: string | string[] | undefined): string => {
  if (typeof header === 'string') {
    return header;
  }

  if (Array.isArray(header) && header.length > 0) {
    return header[0] ?? '';
  }

  return '';
};

const sendUpstreamErrorResponse = (
  req: IncomingMessage & { requestId?: string },
  res: ServerResponse<IncomingMessage> | Socket,
  targetService: string,
  error: Error
) => {
  const requestId = getSingleHeaderValue(req.headers['x-request-id']) || req.requestId || 'n/a';
  const payload = JSON.stringify({
    error: {
      code: 'UPSTREAM_ERROR',
      message: 'Service unavailable',
      service: targetService,
    },
    requestId,
  });

  logger.error('Upstream service failure', {
    requestId,
    targetService,
    error: error.message,
  });

  if ('headersSent' in res && res.headersSent) {
    res.end();
    return;
  }

  if (!('setHeader' in res)) {
    res.destroy();
    return;
  }

  res.statusCode = 502;
  res.setHeader('Content-Type', 'application/json');
  res.end(payload);
};

const createCircuitBreaker = (
  targetService: 'user_service' | 'notes_service'
): CircuitBreakerState => ({
  targetService,
  consecutiveFailures: 0,
  openedAt: null,
  openUntil: 0,
});

const isCircuitOpen = (breaker: CircuitBreakerState) => Date.now() < breaker.openUntil;

const openCircuit = (breaker: CircuitBreakerState, reason: string) => {
  const now = Date.now();
  breaker.consecutiveFailures = 0;
  breaker.openedAt = now;
  breaker.openUntil = now + circuitBreakerOpenMs;

  logger.warn('Circuit breaker opened', {
    targetService: breaker.targetService,
    reason,
    openMs: circuitBreakerOpenMs,
    retryAfterMs: circuitBreakerOpenMs,
  });
};

const markCircuitFailure = (breaker: CircuitBreakerState, reason: string) => {
  const now = Date.now();

  if (now < breaker.openUntil) {
    return;
  }

  // If the circuit was previously open and the first recovery probe fails, reopen immediately.
  if (breaker.openedAt !== null && now >= breaker.openUntil) {
    openCircuit(breaker, `recovery_probe_failed:${reason}`);
    return;
  }

  breaker.consecutiveFailures += 1;

  if (breaker.consecutiveFailures >= circuitBreakerFailureThreshold) {
    openCircuit(breaker, `failure_threshold_reached:${reason}`);
  }
};

const markCircuitSuccess = (breaker: CircuitBreakerState) => {
  if (breaker.openedAt !== null) {
    logger.info('Circuit breaker closed', {
      targetService: breaker.targetService,
    });
  }

  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
  breaker.openUntil = 0;
};

const sendCircuitOpenResponse = (
  req: express.Request & { requestId?: string },
  res: express.Response,
  breaker: CircuitBreakerState
) => {
  const remainingMs = Math.max(0, breaker.openUntil - Date.now());
  const retryAfterSeconds = Math.ceil(remainingMs / 1000);
  const requestId = req.requestId ?? getSingleHeaderValue(req.headers['x-request-id']) ?? 'n/a';

  logger.warn('Circuit open: request rejected', {
    requestId,
    targetService: breaker.targetService,
    retryAfterSeconds,
    method: req.method,
    path: req.originalUrl,
  });

  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(503).json({
    error: {
      code: 'CIRCUIT_OPEN',
      message: 'Upstream service temporarily unavailable',
      service: breaker.targetService,
      retryAfterSeconds,
    },
    requestId,
  });
};

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

const createRateLimiter = (
  limiterName: 'users' | 'notes' | 'login',
  windowMs: number,
  max: number,
  skip?: (req: express.Request) => boolean
) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip,
    handler: (req, res) => {
      const requestId = (req as express.Request & { requestId?: string }).requestId ?? 'n/a';
      logger.warn('Rate limit exceeded', {
        requestId,
        limiter: limiterName,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        max,
        windowMs,
      });

      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please try again later.',
          limiter: limiterName,
        },
        requestId,
      });
    },
  });

app.use('/users/login', createRateLimiter('login', loginRateLimitWindowMs, loginRateLimitMaxRequests));
app.use(
  '/users',
  createRateLimiter('users', usersRateLimitWindowMs, usersRateLimitMaxRequests, (req) => req.path === '/login')
);
app.use('/notes', createRateLimiter('notes', notesRateLimitWindowMs, notesRateLimitMaxRequests));

const userServiceCircuitBreaker = createCircuitBreaker('user_service');
const notesServiceCircuitBreaker = createCircuitBreaker('notes_service');

app.use('/users', (req, res, next) => {
  if (isCircuitOpen(userServiceCircuitBreaker)) {
    sendCircuitOpenResponse(
      req as express.Request & { requestId?: string },
      res,
      userServiceCircuitBreaker
    );
    return;
  }
  next();
});

app.use('/notes', (req, res, next) => {
  if (isCircuitOpen(notesServiceCircuitBreaker)) {
    sendCircuitOpenResponse(
      req as express.Request & { requestId?: string },
      res,
      notesServiceCircuitBreaker
    );
    return;
  }
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
  timeout: upstreamTimeoutMs,
  proxyTimeout: upstreamTimeoutMs,
  on: {
    proxyReq: (proxyReq, req) => {
      const requestId = getSingleHeaderValue(req.headers['x-request-id']);
      const authorization = getSingleHeaderValue(req.headers.authorization);
      const userId = getSingleHeaderValue(req.headers['x-user-id']);
      const userEmail = getSingleHeaderValue(req.headers['x-user-email']);
      const userRole = getSingleHeaderValue(req.headers['x-user-role']);

      if (requestId) {
        proxyReq.setHeader('x-request-id', requestId);
      }
      if (authorization) {
        proxyReq.setHeader('authorization', authorization);
      }
      if (userId) {
        proxyReq.setHeader('x-user-id', userId);
      }
      if (userEmail) {
        proxyReq.setHeader('x-user-email', userEmail);
      }
      if (userRole) {
        proxyReq.setHeader('x-user-role', userRole);
      }
    },
    error: (error, req, res) => {
      markCircuitFailure(userServiceCircuitBreaker, error.message || 'proxy_error');
      sendUpstreamErrorResponse(req, res, 'user_service', error);
    },
    proxyRes: (proxyRes) => {
      if ((proxyRes.statusCode ?? 500) >= 500) {
        markCircuitFailure(userServiceCircuitBreaker, `status_${proxyRes.statusCode ?? 500}`);
        return;
      }

      markCircuitSuccess(userServiceCircuitBreaker);
    },
  },
}));

app.use('/notes', createProxyMiddleware({
  target: notesServiceUrl,
  changeOrigin: true,
  pathRewrite: (path) => `/notes${path}`,
  timeout: upstreamTimeoutMs,
  proxyTimeout: upstreamTimeoutMs,
  on: {
    proxyReq: (proxyReq, req) => {
      const requestId = getSingleHeaderValue(req.headers['x-request-id']);
      const authorization = getSingleHeaderValue(req.headers.authorization);
      const userId = getSingleHeaderValue(req.headers['x-user-id']);
      const userEmail = getSingleHeaderValue(req.headers['x-user-email']);
      const userRole = getSingleHeaderValue(req.headers['x-user-role']);

      if (requestId) {
        proxyReq.setHeader('x-request-id', requestId);
      }
      if (authorization) {
        proxyReq.setHeader('authorization', authorization);
      }
      if (userId) {
        proxyReq.setHeader('x-user-id', userId);
      }
      if (userEmail) {
        proxyReq.setHeader('x-user-email', userEmail);
      }
      if (userRole) {
        proxyReq.setHeader('x-user-role', userRole);
      }
    },
    error: (error, req, res) => {
      markCircuitFailure(notesServiceCircuitBreaker, error.message || 'proxy_error');
      sendUpstreamErrorResponse(req, res, 'notes_service', error);
    },
    proxyRes: (proxyRes) => {
      if ((proxyRes.statusCode ?? 500) >= 500) {
        markCircuitFailure(notesServiceCircuitBreaker, `status_${proxyRes.statusCode ?? 500}`);
        return;
      }

      markCircuitSuccess(notesServiceCircuitBreaker);
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
