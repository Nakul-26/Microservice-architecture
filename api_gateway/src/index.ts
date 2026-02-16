import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';
const notesServiceUrl = process.env.NOTES_SERVICE_URL ?? 'http://localhost:3002';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const target =
      req.path.startsWith('/users') ? userServiceUrl
      : req.path.startsWith('/notes') ? notesServiceUrl
      : 'api_gateway';

    console.log(
      `[gateway] ${req.method} ${req.originalUrl} -> ${target} ${res.statusCode} ${durationMs}ms`
    );
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
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    jwt.verify(token, jwtSecret);
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
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
  res.json({ status: 'ok' });
});

app.use(
  '/users',
  createProxyMiddleware({
    target: userServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => `/users${path}`,
    on: {
      proxyReq: fixRequestBody,
    },
  })
);

app.use(
  '/notes',
  createProxyMiddleware({
    target: notesServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => `/notes${path}`,
    on: {
      proxyReq: fixRequestBody,
    },
  })
);

app.listen(port, () => {
  console.log(`API gateway listening at http://localhost:${port}`);
  console.log(`Proxying /users -> ${userServiceUrl}`);
  console.log(`Proxying /notes -> ${notesServiceUrl}`);
});
