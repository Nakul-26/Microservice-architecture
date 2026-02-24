import type express from 'express';
import { logger } from './logger.js';

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const notFoundHandler: express.RequestHandler = (_req, _res, next) => {
  next(new AppError('Route not found', 404, 'NOT_FOUND'));
};

export const errorHandler: express.ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as express.Request & { requestId?: string }).requestId ?? 'n/a';
  const appError =
    err instanceof AppError
      ? err
      : new AppError('Internal server error', 500, 'INTERNAL_ERROR');

  logger.error('Unhandled Error', {
    requestId,
    code: appError.code,
    statusCode: appError.statusCode,
    error: err instanceof Error ? err.message : String(err),
  });

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
    },
    requestId,
  });
};

