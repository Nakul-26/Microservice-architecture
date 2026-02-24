type LogLevel = 'info' | 'warn' | 'error';

type LogMeta = Record<string, unknown>;

const serviceName = 'api_gateway';

const normalizeMeta = (meta: LogMeta): LogMeta => {
  const normalized: LogMeta = {};

  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Error) {
      normalized[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
};

const writeLog = (level: LogLevel, message: string, meta: LogMeta = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: serviceName,
    ...normalizeMeta(meta),
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
};

export const logger = {
  info: (message: string, meta?: LogMeta) => writeLog('info', message, meta),
  warn: (message: string, meta?: LogMeta) => writeLog('warn', message, meta),
  error: (message: string, meta?: LogMeta) => writeLog('error', message, meta),
};

