import { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { randomBytes, timingSafeEqual } from 'crypto';

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  return (v == null || v === '') ? (fallback || '') : v;
}

// Generate a secure CSRF token
export function generateCSRFToken(): string {
  return randomBytes(32).toString('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i === -1) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = '';
    }
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export async function verifyAdminSessionFromRequest(req: Request): Promise<boolean> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['admin_session'];
  if (!token) return false;

  const secretRaw = getEnv('ADMIN_SESSION_SECRET') || getEnv('JWT_SECRET') || getEnv('ADMIN_API_KEY');
  if (!secretRaw) return false;

  try {
    const secret = new TextEncoder().encode(secretRaw);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (payload?.typ !== 'admin') return false;
    return true;
  } catch {
    return false;
  }
}

export function requireAdminSession() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ok = await verifyAdminSessionFromRequest(req);
    if (!ok) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  };
}

// CSRF Protection: Double-submit cookie pattern
// Requires that for POST/PUT/DELETE requests, the X-CSRF-Token header matches the csrf_token cookie
export function requireCSRF() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only check CSRF on state-changing methods
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
      return next();
    }

    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies['csrf_token'];
    const headerToken =
      typeof req.headers['x-csrf-token'] === 'string'
        ? req.headers['x-csrf-token']
        : '';

    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }

    return next();
  };
}
