import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  return (v == null || v === '') ? (fallback || '') : v;
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function requireAdminApiKey() {
  return (req: Request, res: Response, next: NextFunction) => {
    const required = getEnv('ADMIN_API_KEY');
    if (!required) {
      return res.status(503).json({ error: 'Admin API key not configured' });
    }

    const provided = typeof req.headers['x-admin-api-key'] === 'string' ? req.headers['x-admin-api-key'] : '';
    if (!provided || !safeEqual(provided, required)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  };
}
